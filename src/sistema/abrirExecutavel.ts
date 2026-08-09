import { spawn } from 'node:child_process';
import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';

/**
 * Despachante de cada sistema. Entregar o caminho a ele, em vez de executá-lo
 * direto, é o que faz `.exe`, `.lnk`, `.bat` e qualquer extensão associada
 * abrirem do mesmo jeito.
 *
 * O Linux fica de fora do mapa de propósito: lá o despachante não serve para
 * todos os casos (veja `montarLancamento`).
 */
const DESPACHANTES_POR_PLATAFORMA: Record<string, string> = {
  win32: 'explorer.exe',
  darwin: 'open',
};
const DESPACHANTE_PADRAO = 'xdg-open';

/** Aplicativo do macOS é um pacote: o caminho escolhido é uma pasta `.app`, não um arquivo. */
const SUFIXO_DE_APLICATIVO_DO_MAC = '.app';

/** Bits de execução do modo POSIX (dono, grupo e outros). */
const BITS_DE_EXECUCAO = 0o111;

interface Lancamento {
  comando: string;
  argumentos: string[];
}

export class ExecutavelNaoEncontradoError extends Error {
  constructor(caminho: string) {
    super(`O arquivo não existe ou não é um executável: ${caminho}`);
    this.name = 'ExecutavelNaoEncontradoError';
  }
}

function ehAplicativoDoMac(caminho: string, informacoes: Stats): boolean {
  return (
    process.platform === 'darwin' &&
    informacoes.isDirectory() &&
    extname(caminho).toLowerCase() === SUFIXO_DE_APLICATIVO_DO_MAC
  );
}

/**
 * Confirma que o caminho aponta para algo lançável e devolve o que se sabe
 * dele — o modo do arquivo decide como lançar no Linux.
 */
async function inspecionarCaminho(caminho: string): Promise<Stats> {
  let informacoes: Stats;
  try {
    informacoes = await stat(caminho);
  } catch {
    throw new ExecutavelNaoEncontradoError(caminho);
  }

  if (!informacoes.isFile() && !ehAplicativoDoMac(caminho, informacoes)) {
    throw new ExecutavelNaoEncontradoError(caminho);
  }

  return informacoes;
}

/**
 * No Windows e no macOS o despachante do sistema resolve tudo — inclusive o
 * pacote `.app`, que o `open` sabe iniciar.
 *
 * No Linux não: o `xdg-open` despacha pelo tipo MIME e abre um binário ou um
 * `.sh` no editor de texto em vez de executá-lo. Por isso o arquivo com bit de
 * execução é chamado direto, e o despachante fica para o resto — `.desktop`,
 * atalho web e afins, que só ele sabe abrir.
 */
function montarLancamento(caminho: string, informacoes: Stats): Lancamento {
  const despachante = DESPACHANTES_POR_PLATAFORMA[process.platform];
  if (despachante) {
    return { comando: despachante, argumentos: [caminho] };
  }

  return (informacoes.mode & BITS_DE_EXECUCAO) === 0
    ? { comando: DESPACHANTE_PADRAO, argumentos: [caminho] }
    : { comando: caminho, argumentos: [] };
}

/**
 * Inicia o programa cadastrado num atalho.
 *
 * O caminho vai como argumento separado para o `spawn`, nunca interpolado numa
 * linha de comando: sem shell no meio, um caminho com aspas, `&&` ou `;` é
 * tratado como texto e não como comando.
 *
 * O processo é solto (`detached` + `unref`) porque o programa continua vivo
 * depois da resposta HTTP e não deve prender o servidor.
 */
export async function abrirExecutavelNoSistema(caminho: string): Promise<void> {
  const informacoes = await inspecionarCaminho(caminho);
  const { comando, argumentos } = montarLancamento(caminho, informacoes);

  const processo = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });

  // A falha só aparece depois que a resposta já foi enviada; resta registrar.
  processo.on('error', (erro) => {
    console.error(`Falha ao executar "${comando}" para abrir ${caminho}:`, erro);
  });

  processo.unref();
}
