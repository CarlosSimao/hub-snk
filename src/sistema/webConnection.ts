/**
 * Sankhya Web Connection: o programa da máquina que as telas do SankhyaOm chamam para
 * imprimir, ler certificado e acessar arquivos locais. Roda separado do HUB SNK; aqui só
 * se descobre se ele está no ar, onde está o executável que o inicia, e se o inicia.
 */
import { execFile } from 'node:child_process';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  abrirExecutavelNoSistema,
  ExecutavelNaoEncontradoError,
  FalhaAoIniciarExecutavelError,
} from './processos/abrirExecutavel.ts';
import { lancarProcesso, LancamentoFalhouError } from './processos/lancarProcesso.ts';

/**
 * Rota de informações do próprio Web Connection (`.info`), na porta HTTP padrão dele. Só
 * lê: devolve versão e tempo ligado. A porta é a que o SankhyaOm espera, por isso fixa.
 */
const URL_DE_INFORMACOES = 'http://127.0.0.1:9096/.info';
const TEMPO_LIMITE_DA_CONSULTA_MS = 2000;

/** Onde o instalador do Web Connection 64 bits o coloca, e o que o atalho dele abre. */
const CAMINHO_PADRAO_NO_WINDOWS = join(
  homedir(),
  'Sankhya web',
  'Sankhya_web_connectionx64',
  'executar',
  'iniciar_web_connection.exe',
);

export type SituacaoDoWebConnection =
  { ligado: false } | { ligado: true; versao: string; tempoLigado: string };

/**
 * Lê a resposta do `.info`, no formato `dados do sistema:  versao: 2.0b725 uptime: 5:45:42`.
 * Sem `versao:`, quem respondeu na porta não é o Web Connection.
 */
export function interpretarInformacoes(texto: string): SituacaoDoWebConnection {
  const versao = /versao:\s*(\S+)/.exec(texto)?.[1];
  if (!versao) {
    return { ligado: false };
  }
  const tempoLigado = /uptime:\s*(\S+)/.exec(texto)?.[1] ?? '';
  return { ligado: true, versao, tempoLigado };
}

/** Porta fechada, tempo esgotado ou resposta de outro programa: desligado. */
export async function consultarWebConnection(
  buscar: typeof fetch = fetch,
): Promise<SituacaoDoWebConnection> {
  try {
    const resposta = await buscar(URL_DE_INFORMACOES, {
      signal: AbortSignal.timeout(TEMPO_LIMITE_DA_CONSULTA_MS),
    });
    if (!resposta.ok) {
      return { ligado: false };
    }
    return interpretarInformacoes(await resposta.text());
  } catch {
    // Conexão recusada é o caso comum de desligado, não uma falha a relatar.
    return { ligado: false };
  }
}

/**
 * O executável que inicia o Web Connection: o escolhido pelo usuário ou, sem escolha, o da
 * instalação padrão no Windows, se existir. `null` quando não há nenhum dos dois.
 */
export async function caminhoDoExecutavel(configurado: string): Promise<string | null> {
  if (configurado !== '') {
    return configurado;
  }
  if (process.platform !== 'win32') {
    return null;
  }
  return (await ehArquivo(CAMINHO_PADRAO_NO_WINDOWS)) ? CAMINHO_PADRAO_NO_WINDOWS : null;
}

function ehArquivo(caminho: string): Promise<boolean> {
  return stat(caminho).then(
    (informacoes) => informacoes.isFile(),
    () => false,
  );
}

const executarArquivo = promisify(execFile);

/** Código de saída do `taskkill` quando não há processo com o nome pedido. */
const TASKKILL_NENHUM_PROCESSO = 128;

/**
 * Encerra cópias do iniciador que ficaram para trás. Só para chamar com o Web Connection
 * fora do ar.
 *
 * O `iniciar_web_connection.exe` fica rodando como pai do Web Connection e não encerra
 * quando ele fecha: fica preso, gastando CPU e segurando a trava de instância única. Com
 * ele vivo, todo novo início (pelo HUB SNK ou pelo atalho do instalador) sai na hora sem
 * abrir nada. Fora do Windows não há esse iniciador.
 */
export async function encerrarCopiasPresas(caminho: string): Promise<void> {
  if (process.platform !== 'win32' || extname(caminho).toLowerCase() !== '.exe') {
    return;
  }
  try {
    await executarArquivo('taskkill', ['/F', '/IM', basename(caminho)], { windowsHide: true });
  } catch (erro) {
    if ((erro as { code?: unknown }).code !== TASKKILL_NENHUM_PROCESSO) {
      throw erro;
    }
  }
}

/** Bits de execução do modo POSIX (dono, grupo e outros). */
const BITS_DE_EXECUCAO = 0o111;
/** O `.command` do macOS é feito para abrir no Terminal: fica com o despachante. */
const SUFIXO_DO_TERMINAL_DO_MAC = '.command';

/**
 * Se o arquivo roda direto, na pasta dele, em vez de ir pelo despachante do sistema.
 *
 * O `iniciar_web_connection.exe` procura o `web_connection.exe` na pasta de trabalho, e o
 * despachante do Windows (`explorer.exe`) o abre na pasta do HUB SNK. Lá ele não acha o
 * programa e fica parado segurando a trava de instância única, que impede até o atalho do
 * instalador de iniciá-lo depois. Por isso o `.exe` roda direto, na pasta dele, como faz o
 * atalho; no Linux e no macOS, o arquivo com bit de execução, pelo mesmo motivo. Atalho
 * `.lnk`, pacote `.app` (uma pasta), `.command` e script sem bit de execução seguem pelo
 * despachante, que não recebe pasta de trabalho.
 */
export function rodaDiretoNaPastaDele(
  caminho: string,
  informacoes: Pick<Stats, 'isFile' | 'mode'>,
  plataforma: NodeJS.Platform = process.platform,
): boolean {
  if (!informacoes.isFile()) {
    return false;
  }
  const extensao = extname(caminho).toLowerCase();
  if (plataforma === 'win32') {
    return extensao === '.exe';
  }
  if (plataforma === 'darwin' && extensao === SUFIXO_DO_TERMINAL_DO_MAC) {
    return false;
  }
  return (informacoes.mode & BITS_DE_EXECUCAO) !== 0;
}

export async function iniciarExecutavel(caminho: string): Promise<void> {
  const informacoes = await stat(caminho).catch(() => null);
  if (informacoes === null) {
    throw new ExecutavelNaoEncontradoError(caminho);
  }
  if (!rodaDiretoNaPastaDele(caminho, informacoes)) {
    return abrirExecutavelNoSistema(caminho);
  }

  try {
    // Sem esconder, o console do iniciador fica aberto enquanto o Web Connection roda.
    await lancarProcesso(caminho, [], {
      pastaDeTrabalho: dirname(caminho),
      ocultarJanelaNoWindows: true,
    });
  } catch (erro) {
    if (erro instanceof LancamentoFalhouError) {
      throw new FalhaAoIniciarExecutavelError(caminho, erro.motivo);
    }
    throw erro;
  }
}
