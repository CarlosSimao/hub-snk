/**
 * Ciclo de vida do backend do HUB SNK dentro do shell.
 *
 * Três modos, decididos em ordem:
 *
 *   1. `SANKHYA_HUB_BACKEND=externo` — não sobe nada, só espera. É o modo de quem roda
 *      `npm run dev` noutra janela para desenvolver o backend.
 *   2. Já existe alguém respondendo em `/api/healthz` — reusa. Sem isto, abrir o shell
 *      com um `npm run dev` no ar daria EADDRINUSE na 4100 e o diagnóstico seria confuso.
 *   3. Ninguém respondendo — spawn do backend e espera ele ficar de pé.
 *
 * O backend roda sempre no Node embutido no Electron (`ELECTRON_RUN_AS_NODE`), direto do
 * `src/index.ts`: o HUB SNK não exige Node instalado na máquina.
 *
 * O processo filho é o único: o Fastify não forka. Então pedir o encerramento a ele, e
 * no pior caso `kill()`, basta, sem árvore de processos para caçar.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import {
  ARQUIVO_TOKEN_BRIDGE,
  BRIDGE_HOST,
  BRIDGE_PORT,
  DIRETORIO_DE_DADOS,
  ENTRYPOINT_BACKEND,
  HUB_URL,
  MODO_BACKEND,
  PORTA_HUB,
  RAIZ_PROJETO,
  TZ_PADRAO,
} from './config';
import { logEvento } from './log';
import { garantirToken } from './tokenStore';

/** Quanto esperamos o backend responder `/api/healthz` antes de desistir. */
const TIMEOUT_BOOT_MS = 45_000;
/** Quanto esperamos o backend fechar sozinho depois de pedir o encerramento. */
const TIMEOUT_ENCERRAMENTO_MS = 5_000;
/** Guardadas só para a mensagem de erro — o log completo vai para o arquivo. */
const LINHAS_DIAGNOSTICO = 25;

export type ModoResolvido = 'externo' | 'gerenciado' | 'falhou';

export interface ResultadoBackend {
  modo: ModoResolvido;
  /** Preenchido só quando `modo === 'falhou'`; pronto para exibição. */
  erro: string;
}

let processo: ChildProcess | null = null;
let arquivoSaida: WriteStream | null = null;
let ultimasLinhas: string[] = [];
let encerrandoDeProposito = false;

function registrarSaida(texto: string): void {
  for (const linha of texto.split(/\r?\n/)) {
    if (!linha.trim()) continue;
    ultimasLinhas.push(linha);
    if (ultimasLinhas.length > LINHAS_DIAGNOSTICO) ultimasLinhas.shift();
  }
}

function abrirArquivoDeSaida(): WriteStream {
  if (arquivoSaida) return arquivoSaida;
  const pasta = join(app.getPath('userData'), 'log');
  if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
  arquivoSaida = createWriteStream(join(pasta, 'backend.log'), { flags: 'a' });
  return arquivoSaida;
}

/** Health check do backend, seja ele nosso ou de terceiros. */
async function backendRespondendo(timeoutMs = 1500): Promise<boolean> {
  try {
    const resposta = await fetch(`${HUB_URL}/api/healthz`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

/**
 * Ambiente do backend.
 *
 * `HUB_HOST=127.0.0.1` é explícito mesmo sendo o padrão do backend: o painel não tem
 * autenticação e devolve senhas pela API, então um `HUB_HOST` herdado do ambiente do
 * usuário não pode expô-lo à rede sem ninguém perceber.
 */
function montarAmbiente(): NodeJS.ProcessEnv {
  const ambiente: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HUB_PORTA: String(PORTA_HUB),
    HUB_HOST: '127.0.0.1',
    HUB_DADOS_DIR: DIRETORIO_DE_DADOS,
    TZ: process.env['TZ'] ?? TZ_PADRAO,
    SANKHYA_DESKTOP_BRIDGE_URL: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
    DESKTOP_BRIDGE_TOKEN_FILE: ARQUIVO_TOKEN_BRIDGE,
  };

  return ambiente;
}

/** Espera o `/api/healthz` responder, desistindo cedo se o processo já morreu. */
async function esperarSubir(timeoutMs: number): Promise<boolean> {
  const limite = Date.now() + timeoutMs;
  while (Date.now() < limite) {
    if (await backendRespondendo()) return true;
    if (processo && processo.exitCode !== null) return false;
    await new Promise((resolva) => setTimeout(resolva, 300));
  }
  return false;
}

function diagnostico(): string {
  return ultimasLinhas.length ? ultimasLinhas.join('\n') : '(o backend não escreveu nada na saída)';
}

export async function iniciarBackend(): Promise<ResultadoBackend> {
  if (MODO_BACKEND === 'externo') {
    logEvento('backend-modo-externo', { url: HUB_URL });
    const respondeu = await esperarSubir(10_000);
    if (respondeu) return { modo: 'externo', erro: '' };
    return {
      modo: 'falhou',
      erro:
        `SANKHYA_HUB_BACKEND=externo, mas ninguém respondeu em ${HUB_URL}/api/healthz.\n` +
        'Suba o backend com `npm run dev` na raiz do projeto ou remova a variável ' +
        'para o shell subir o backend sozinho.',
    };
  }

  if (await backendRespondendo()) {
    // `npm run dev` rodando noutra janela. Reusar evita EADDRINUSE e, pior, dois
    // backends disputando o mesmo `sankhya.db`.
    logEvento('backend-externo-detectado', { url: HUB_URL });
    return { modo: 'externo', erro: '' };
  }

  if (!existsSync(ENTRYPOINT_BACKEND)) {
    return {
      modo: 'falhou',
      erro: `Backend não encontrado: ${ENTRYPOINT_BACKEND} não existe.`,
    };
  }

  const saida = abrirArquivoDeSaida();
  ultimasLinhas = [];
  encerrandoDeProposito = false;

  logEvento('backend-iniciando', { runtime: process.execPath, entrypoint: ENTRYPOINT_BACKEND });

  processo = spawn(process.execPath, [ENTRYPOINT_BACKEND], {
    // A raiz, e não `src/`: é onde o Node acha o `package.json` com `"type": "module"`
    // e o `node_modules`.
    cwd: RAIZ_PROJETO,
    env: montarAmbiente(),
    // Nenhum console preto aparece.
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  processo.stdout?.on('data', (pedaco: Buffer) => {
    const texto = pedaco.toString('utf8');
    saida.write(texto);
    registrarSaida(texto);
  });
  processo.stderr?.on('data', (pedaco: Buffer) => {
    const texto = pedaco.toString('utf8');
    saida.write(texto);
    registrarSaida(texto);
  });

  processo.on('exit', (codigo, sinal) => {
    logEvento('backend-encerrado', { codigo, sinal, deProposito: encerrandoDeProposito });
    processo = null;
  });

  const subiu = await esperarSubir(TIMEOUT_BOOT_MS);
  if (subiu) {
    logEvento('backend-pronto', { url: HUB_URL });
    return { modo: 'gerenciado', erro: '' };
  }

  await pararBackend();
  return {
    modo: 'falhou',
    erro:
      `O backend não respondeu em ${HUB_URL}/api/healthz após ${TIMEOUT_BOOT_MS / 1000}s.\n\n` +
      `Últimas linhas:\n${diagnostico()}`,
  };
}

/**
 * Pede ao backend que feche sozinho (conexões e SQLite). No Windows é o único jeito de
 * um encerramento limpo: `kill()` não entrega sinal, termina o processo na hora.
 */
async function pedirEncerramento(): Promise<boolean> {
  try {
    const resposta = await fetch(`${HUB_URL}/api/sistema/encerrar`, {
      method: 'POST',
      headers: { 'x-hub-token': garantirToken() },
      signal: AbortSignal.timeout(2_000),
    });
    return resposta.ok;
  } catch {
    return false;
  }
}

function esperarSair(alvo: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (alvo.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolva) => {
    const prazo = setTimeout(() => resolva(false), timeoutMs);
    alvo.once('exit', () => {
      clearTimeout(prazo);
      resolva(true);
    });
  });
}

export async function pararBackend(): Promise<void> {
  const alvo = processo;
  if (!alvo || alvo.exitCode !== null) return;

  encerrandoDeProposito = true;
  logEvento('backend-parando', { pid: alvo.pid });

  const aceitou = await pedirEncerramento();
  const saiuSozinho = aceitou && (await esperarSair(alvo, TIMEOUT_ENCERRAMENTO_MS));

  if (!saiuSozinho) {
    // Pedido recusado, backend travado ou conexão SSE pendurada: o shell não pode ficar
    // preso esperando.
    logEvento('backend-kill-forcado', { pid: alvo.pid, aceitouOPedido: aceitou });
    alvo.kill();
    if (!(await esperarSair(alvo, TIMEOUT_ENCERRAMENTO_MS))) alvo.kill('SIGKILL');
  }

  arquivoSaida?.end();
  arquivoSaida = null;
  processo = null;
}

/** Para a barra de diagnóstico do shell: quem está servindo o painel agora. */
export function backendGerenciado(): boolean {
  return processo !== null && processo.exitCode === null;
}
