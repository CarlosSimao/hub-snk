import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { join } from 'node:path';
import { connect } from 'node:net';
import { extrairVersaoDaPlataforma } from './versaoDaPlataforma.ts';

/**
 * Controle de processo do WildFly local — sem docker, sem daemon central pra
 * consultar. Iniciar dispara `standalone`; parar e reiniciar falam com a
 * management interface via `jboss-cli` (é o desligamento limpo do próprio
 * WildFly, não um `taskkill`).
 *
 * A porta de management é a padrão de instalação (9990) e vale pra qualquer
 * base cadastrada — não há campo por base pra isso ainda.
 */

const PORTA_DE_MANAGEMENT_PADRAO = 9990;
const CONTEXTO_DA_APLICACAO = '/mge/';
/*
 * Vale só para as checagens internas do reinício (esperar as portas caírem),
 * que não passam pela configuração global. As checagens de situação recebem o
 * tempo limite configurado pelo usuário.
 */
const TEMPO_LIMITE_DA_ESPERA_DE_PORTA_MS = 3000;
const INTERVALO_DE_ESPERA_DA_PORTA_MS = 500;
const TENTATIVAS_MAXIMAS_DE_ESPERA_DA_PORTA = 60;

export class WildflyIndisponivelError extends Error {
  constructor(caminhoDoScript: string) {
    super(
      `Script não encontrado: ${caminhoDoScript}. Verifique o caminho do WildFly cadastrado na base.`,
    );
    this.name = 'WildflyIndisponivelError';
  }
}

export class WildflyComandoFalhouError extends Error {
  constructor(comando: string, saida: string) {
    super(`${comando} falhou: ${saida || 'sem saída'}`);
    this.name = 'WildflyComandoFalhouError';
  }
}

/**
 * WildFly extraído de um zip ou copiado de um sistema de arquivos do Windows
 * chega ao Linux e ao macOS sem o bit de execução nos scripts do `bin`. Sem
 * este erro, o `spawn` falharia com um `EACCES` cru e a tela mostraria uma
 * mensagem que não diz o que fazer.
 */
export class WildflySemPermissaoDeExecucaoError extends Error {
  constructor(caminhoDoScript: string) {
    super(
      `Sem permissão para executar ${caminhoDoScript}. Rode "chmod +x" nos scripts da pasta "bin" do WildFly.`,
    );
    this.name = 'WildflySemPermissaoDeExecucaoError';
  }
}

function caminhoDoScript(caminhoWildfly: string, nomeBase: 'standalone' | 'jboss-cli'): string {
  const arquivo = process.platform === 'win32' ? `${nomeBase}.bat` : `${nomeBase}.sh`;
  return join(caminhoWildfly, 'bin', arquivo);
}

/**
 * O script precisa existir e, fora do Windows, ser executável — lá quem
 * interpreta o `.bat` é o `cmd.exe`, e o bit de execução do POSIX não existe.
 */
function garantirQueOScriptPodeRodar(caminhoDoScriptEncontrado: string): void {
  if (!existsSync(caminhoDoScriptEncontrado)) {
    throw new WildflyIndisponivelError(caminhoDoScriptEncontrado);
  }

  if (process.platform === 'win32') {
    return;
  }

  try {
    accessSync(caminhoDoScriptEncontrado, constants.X_OK);
  } catch {
    throw new WildflySemPermissaoDeExecucaoError(caminhoDoScriptEncontrado);
  }
}

/**
 * Erro de `spawn` vira erro de domínio: a checagem anterior pode ter passado e
 * a permissão mudar no meio do caminho, e a mensagem crua do sistema não diz o
 * que fazer.
 */
function traduzirFalhaDeLancamento(erro: unknown, caminhoDoScriptAlvo: string): Error {
  const falha = erro as NodeJS.ErrnoException;

  if (falha.code === 'EACCES' || falha.code === 'EPERM') {
    return new WildflySemPermissaoDeExecucaoError(caminhoDoScriptAlvo);
  }

  if (falha.code === 'ENOENT') {
    return new WildflyIndisponivelError(caminhoDoScriptAlvo);
  }

  return erro instanceof Error ? erro : new Error(String(erro));
}

/**
 * Dispara o script e resolve assim que o processo nasce — o WildFly continua
 * subindo em segundo plano, solto do servidor do HUB SNK (`detached` + `unref`).
 */
function dispararScript(caminhoDoScriptAlvo: string, argumentos: string[]): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    /* No Windows, `detached` junto de `windowsHide` faz o Node ignorar o hide
     * (bug conhecido: nodejs/node#21825) — por isso aqui só windowsHide. */
    const processo =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', caminhoDoScriptAlvo, ...argumentos], {
            stdio: 'ignore',
            windowsHide: true,
          })
        : spawn(caminhoDoScriptAlvo, argumentos, { detached: true, stdio: 'ignore' });

    processo.once('spawn', () => {
      processo.unref();
      resolver();
    });
    processo.once('error', (erro) =>
      rejeitar(traduzirFalhaDeLancamento(erro, caminhoDoScriptAlvo)),
    );
  });
}

/** Executa um comando e aguarda terminar — o `jboss-cli` precisa confirmar que o shutdown foi aceito. */
function executarEAguardar(caminhoDoScriptAlvo: string, argumentos: string[]): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const processo =
      process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', caminhoDoScriptAlvo, ...argumentos], { windowsHide: true })
        : spawn(caminhoDoScriptAlvo, argumentos);

    let saida = '';
    processo.stdout?.on('data', (dado: Buffer) => {
      saida += dado.toString();
    });
    processo.stderr?.on('data', (dado: Buffer) => {
      saida += dado.toString();
    });

    processo.once('error', (erro) =>
      rejeitar(traduzirFalhaDeLancamento(erro, caminhoDoScriptAlvo)),
    );
    processo.once('close', (codigo) => {
      if (codigo === 0) {
        resolver();
      } else {
        rejeitar(new WildflyComandoFalhouError('jboss-cli', saida.trim()));
      }
    });
  });
}

export async function iniciarWildfly(caminhoWildfly: string): Promise<void> {
  const script = caminhoDoScript(caminhoWildfly, 'standalone');
  garantirQueOScriptPodeRodar(script);
  await dispararScript(script, []);
}

export async function pararWildfly(caminhoWildfly: string): Promise<void> {
  const script = caminhoDoScript(caminhoWildfly, 'jboss-cli');
  garantirQueOScriptPodeRodar(script);
  await executarEAguardar(script, [
    '--connect',
    `--controller=localhost:${PORTA_DE_MANAGEMENT_PADRAO}`,
    '--command=:shutdown',
  ]);
}

function esperar(tempoMs: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, tempoMs));
}

/** Confirma só a conexão TCP — não fala o protocolo de quem está do outro lado. */
function portaEstaAberta(porta: number, tempoLimiteMs: number): Promise<boolean> {
  return new Promise((resolver) => {
    const conexao = connect({ host: 'localhost', port: porta });

    const finalizar = (aberta: boolean) => {
      conexao.destroy();
      resolver(aberta);
    };

    conexao.setTimeout(tempoLimiteMs);
    conexao.once('connect', () => finalizar(true));
    conexao.once('timeout', () => finalizar(false));
    conexao.once('error', () => finalizar(false));
  });
}

/**
 * O `:shutdown` do jboss-cli retorna assim que o comando é aceito, não quando
 * o processo de fato termina — management e HTTP continuam ocupados por um
 * tempo enquanto o WildFly termina de desfazer o deploy das aplicações (pode
 * levar bem mais que alguns segundos com o Sankhya OM). Sem esperar as duas
 * portas caírem, o `standalone.bat` seguinte tenta subir em cima do processo
 * antigo ainda morrendo e falha ao bindar.
 */
async function esperarPortasLiberadas(portaHttp: number): Promise<void> {
  for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS_DE_ESPERA_DA_PORTA; tentativa++) {
    const [managementAberta, httpAberta] = await Promise.all([
      portaEstaAberta(PORTA_DE_MANAGEMENT_PADRAO, TEMPO_LIMITE_DA_ESPERA_DE_PORTA_MS),
      portaEstaAberta(portaHttp, TEMPO_LIMITE_DA_ESPERA_DE_PORTA_MS),
    ]);

    if (!managementAberta && !httpAberta) {
      return;
    }

    await esperar(INTERVALO_DE_ESPERA_DA_PORTA_MS);
  }
}

/**
 * Sequencial: só para se já estiver rodando (senão o `jboss-cli` falha por não
 * ter servidor pra conectar) e espera as portas caírem antes de subir de novo.
 */
export async function reiniciarWildfly(caminhoWildfly: string, portaHttp: number): Promise<void> {
  if (await wildflyEstaRodando(TEMPO_LIMITE_DA_ESPERA_DE_PORTA_MS)) {
    await pararWildfly(caminhoWildfly);
    await esperarPortasLiberadas(portaHttp);
  }

  await iniciarWildfly(caminhoWildfly);
}

/**
 * Nível 1 da situação da base local: a porta de management (9990) aceita
 * conexão TCP — mais barato que abrir uma sessão de management inteira só
 * para checar se está de pé.
 */
export function wildflyEstaRodando(tempoLimiteMs: number): Promise<boolean> {
  return portaEstaAberta(PORTA_DE_MANAGEMENT_PADRAO, tempoLimiteMs);
}

export interface SituacaoDaPaginaInicial {
  paginaInicialOk: boolean;
  /** `null` quando a página não respondeu ou quando não trouxe o link de versão. */
  versaoDaPlataforma: string | null;
}

/**
 * Nível 2 da situação da base local: a aplicação Sankhya em
 * `localhost:<porta>/mge/` responde HTTP 200, na porta cadastrada na base. Só
 * faz sentido consultar depois de confirmar o nível 1 — sem processo de pé, a
 * conexão nem chega a ser tentada.
 *
 * Aproveita a mesma requisição para extrair a versão da plataforma. É por isso
 * que o alvo é o contexto `/mge/` e não a raiz: a raiz devolve apenas um
 * `<META HTTP-EQUIV="Refresh" ... URL=/mge/">` — 200, mas sem `SYSVERSION`, que
 * o `fetch` não segue por não ser redirecionamento HTTP.
 */
export async function consultarPaginaInicial(
  porta: number,
  tempoLimiteMs: number,
): Promise<SituacaoDaPaginaInicial> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);

  try {
    const resposta = await fetch(`http://localhost:${porta}${CONTEXTO_DA_APLICACAO}`, {
      signal: controlador.signal,
    });
    if (resposta.status !== 200) {
      return { paginaInicialOk: false, versaoDaPlataforma: null };
    }

    const html = await resposta.text();
    return { paginaInicialOk: true, versaoDaPlataforma: extrairVersaoDaPlataforma(html) };
  } catch {
    return { paginaInicialOk: false, versaoDaPlataforma: null };
  } finally {
    clearTimeout(temporizador);
  }
}
