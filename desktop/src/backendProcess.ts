/**
 * Ciclo de vida do backend do hub DENTRO do shell — Fase 1 da migração "sem Docker".
 *
 * Até aqui o backend morava num container Linux e o shell era acessório: falava com ele
 * por HTTP e pelo bridge da porta 4103. A relação se inverte aqui — quem hospeda o
 * processo é o Electron, e o container deixa de ser necessário para o hub subir.
 *
 * Três modos, decididos em ordem:
 *
 *   1. `SANKHYA_HUB_BACKEND=externo` — não sobe nada, só espera. É o modo de quem roda
 *      `scripts/desenvolver.ps1` ou ainda mantém o container de pé.
 *   2. Já existe alguém respondendo em `/api/healthz` — reusa. Sem isto, abrir o shell
 *      com o container no ar daria EADDRINUSE na 4000 e o diagnóstico seria confuso.
 *   3. Ninguém respondendo — spawn do backend e espera ele ficar de pé.
 *
 * O processo filho é o único: o Fastify não forka. Então `kill()` no encerramento basta,
 * sem árvore de processos para caçar.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, type WriteStream } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { app } from 'electron';
import {
  ARQUIVO_TOKEN_BRIDGE,
  ARQUIVO_TOKEN_HELPER,
  BRIDGE_HOST,
  BRIDGE_PORT,
  DATA_DIR,
  DOCKER_SOCKET,
  ENTRYPOINT_BACKEND,
  HELPER_URL,
  HUB_URL,
  MODO_BACKEND,
  PORTA_HUB,
  RAIZ_PROJETO,
  SERVICES_YAML,
  TZ_PADRAO,
} from './config';
import { logEvento } from './log';

/** Quanto esperamos o backend responder `/api/healthz` antes de desistir. */
const TIMEOUT_BOOT_MS = 45_000;
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
    const resposta = await fetch(`${HUB_URL}/api/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    return resposta.ok;
  } catch {
    return false;
  }
}

function acharNoPath(executavel: string): string {
  for (const pasta of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!pasta) continue;
    try {
      const alvo = join(pasta, executavel);
      if (existsSync(alvo)) return alvo;
    } catch {
      // Entrada inválida ou inacessível no PATH — o Windows tem várias.
    }
  }
  return '';
}

interface RuntimeNode {
  caminho: string;
  /** Electron rodando como Node (`ELECTRON_RUN_AS_NODE`) em vez de um `node.exe` real. */
  viaElectron: boolean;
}

/**
 * Qual binário roda o backend.
 *
 * O caminho bom é um `node.exe` de verdade. O fallback (`ELECTRON_RUN_AS_NODE` no
 * próprio binário do Electron) mantém o hub de pé numa máquina sem Node instalado, com
 * uma ressalva: `oracledb` é addon nativo compilado contra o ABI do Node, e o ABI do
 * Electron é outro — um check `type: oracle` falharia ao carregar o módulo. O
 * `services.yaml` não usa mais esse tipo de check (virou `tcp` + `docker`), então a
 * ressalva só vale para quem o reativar; nesse caso, `electron-rebuild` resolve.
 */
function resolverRuntimeNode(): RuntimeNode {
  const explicito = process.env['SANKHYA_HUB_NODE'] ?? '';
  if (explicito && existsSync(explicito)) return { caminho: explicito, viaElectron: false };

  const executavel = process.platform === 'win32' ? 'node.exe' : 'node';
  const noPath = acharNoPath(executavel);
  if (noPath) return { caminho: noPath, viaElectron: false };

  // O instalador padrão do Windows põe o Node aqui mas nem sempre o PATH do processo
  // filho herda a alteração (sessão aberta antes da instalação).
  const padraoWindows = 'C:\\Program Files\\nodejs\\node.exe';
  if (process.platform === 'win32' && existsSync(padraoWindows)) {
    return { caminho: padraoWindows, viaElectron: false };
  }

  // App aberto pelo Finder não herda o PATH do shell: o Node do Homebrew (Apple Silicon
  // e Intel) ou do instalador oficial fica invisível para o `acharNoPath`.
  if (process.platform === 'darwin') {
    const padraoMac = ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find((c) => existsSync(c));
    if (padraoMac) return { caminho: padraoMac, viaElectron: false };
  }

  return { caminho: process.execPath, viaElectron: true };
}

/**
 * Ambiente do backend.
 *
 * Difere do `docker-compose.yml` em dois pontos que importam:
 *
 *   - `HOST=127.0.0.1`. O default do `src/index.ts` é `0.0.0.0`, que dentro do container
 *     era inofensivo porque a publicação da porta já prendia em `127.0.0.1`. Rodando
 *     nativo no Windows não existe essa segunda barreira: sem isto, o painel — que não
 *     tem autenticação nenhuma e grava credenciais — ficaria exposto à rede local.
 *   - Os endereços do helper e do bridge deixam de ser `host.docker.internal` e passam a
 *     ser `127.0.0.1`: agora é tudo a mesma máquina, e o mesmo processo de sistema.
 */
function montarAmbiente(viaElectron: boolean): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORTA_HUB),
    HOST: '127.0.0.1',
    CONFIG_PATH: SERVICES_YAML,
    DATA_DIR,
    DOCKER_SOCKET,
    TZ: process.env['TZ'] ?? TZ_PADRAO,
    HUB_HELPER_URL: HELPER_URL,
    HUB_HELPER_TOKEN_FILE: ARQUIVO_TOKEN_HELPER,
    SANKHYA_DESKTOP_BRIDGE_URL: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
    DESKTOP_BRIDGE_TOKEN_FILE: ARQUIVO_TOKEN_BRIDGE,

    // Os alvos do `services.yaml` são alcançados por `host.docker.internal`, que só
    // existe porque o hub rodava em container. O nome até resolve no Windows (o Docker
    // Desktop o escreve no `hosts`), mas resolve para o IP da máquina na LAN — e
    // depender do Docker Desktop instalado justamente para dispensá-lo seria frágil.
    // Aqui os alvos são locais, então `localhost`. Valor já definido no ambiente vence.
    WILDFLY_URL: process.env['WILDFLY_URL'] ?? 'http://localhost:8080/mge/',
    ORACLE_HOST: process.env['ORACLE_HOST'] ?? 'localhost',
  };

  if (viaElectron) base['ELECTRON_RUN_AS_NODE'] = '1';
  // Herdada do shell, faria o backend se anunciar como Electron para si mesmo.
  else delete base['ELECTRON_RUN_AS_NODE'];

  return base;
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
        'Suba o backend (scripts/desenvolver.ps1 ou docker compose up -d) ou remova a variável ' +
        'para o shell subir o backend sozinho.',
    };
  }

  if (await backendRespondendo()) {
    // Container ainda de pé, ou `desenvolver.ps1` rodando noutra janela. Reusar evita
    // EADDRINUSE e, pior, dois backends disputando o mesmo SQLite de histórico.
    logEvento('backend-externo-detectado', { url: HUB_URL });
    return { modo: 'externo', erro: '' };
  }

  if (!existsSync(ENTRYPOINT_BACKEND)) {
    return {
      modo: 'falhou',
      erro:
        `Backend não compilado: ${ENTRYPOINT_BACKEND} não existe.\n` +
        `Rode \`npm run build\` em ${RAIZ_PROJETO}.`,
    };
  }

  const runtime = resolverRuntimeNode();
  const saida = abrirArquivoDeSaida();
  ultimasLinhas = [];
  encerrandoDeProposito = false;

  logEvento('backend-iniciando', {
    runtime: runtime.caminho,
    viaElectron: runtime.viaElectron,
    entrypoint: ENTRYPOINT_BACKEND,
  });

  processo = spawn(runtime.caminho, [ENTRYPOINT_BACKEND], {
    cwd: dirname(ENTRYPOINT_BACKEND),
    env: montarAmbiente(runtime.viaElectron),
    // A razão de existir desta fase: nenhum console preto aparece.
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
    logEvento('backend-pronto', { url: HUB_URL, viaElectron: runtime.viaElectron });
    return { modo: 'gerenciado', erro: '' };
  }

  const aviso = runtime.viaElectron
    ? '\n\nNode.js não foi encontrado na máquina, então o backend rodou pelo próprio Electron. ' +
      'Nesse modo o check do Oracle não carrega (módulo nativo com ABI diferente). ' +
      'Instalar o Node resolve por ora; a Fase 2 remove a dependência.'
    : '';

  await pararBackend();
  return {
    modo: 'falhou',
    erro: `O backend não respondeu em ${HUB_URL}/api/healthz após ${TIMEOUT_BOOT_MS / 1000}s.\n\n` +
      `Últimas linhas:\n${diagnostico()}${aviso}`,
  };
}

export async function pararBackend(): Promise<void> {
  const alvo = processo;
  if (!alvo || alvo.exitCode !== null) return;

  encerrandoDeProposito = true;
  logEvento('backend-parando', { pid: alvo.pid });
  alvo.kill();

  // O Fastify fecha o servidor antes de sair; se travar (conexão SSE pendurada), o
  // shell não pode ficar preso esperando.
  await new Promise<void>((resolva) => {
    const prazo = setTimeout(() => {
      if (alvo.exitCode === null) {
        logEvento('backend-kill-forcado', { pid: alvo.pid });
        alvo.kill('SIGKILL');
      }
      resolva();
    }, 5_000);
    alvo.once('exit', () => {
      clearTimeout(prazo);
      resolva();
    });
  });

  arquivoSaida?.end();
  arquivoSaida = null;
  processo = null;
}

/** Para a barra de diagnóstico do shell: quem está servindo o painel agora. */
export function backendGerenciado(): boolean {
  return processo !== null && processo.exitCode === null;
}

/**
 * Derruba e sobe de novo. Só vale para backend que este shell gerencia — um backend
 * externo (container, `desenvolver.ps1`) não é nosso para reiniciar.
 *
 * Existe por causa do Instant Client que chega depois do boot: `initOracleClient()` roda
 * uma vez, no carregamento do módulo, então só um processo novo enxerga o Thick mode.
 */
export async function reiniciarBackend(): Promise<ResultadoBackend> {
  if (!backendGerenciado()) return { modo: 'externo', erro: '' };
  await pararBackend();
  return iniciarBackend();
}
