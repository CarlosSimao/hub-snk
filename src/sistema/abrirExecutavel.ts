import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { lancarProcesso, LancamentoFalhouError } from './lancarProcesso.ts';

/**
 * Despachante de cada sistema. Entregar o caminho a ele, em vez de executá-lo
 * direto, é o que faz `.exe`, `.lnk`, `.bat` e qualquer extensão associada
 * abrirem do mesmo jeito.
 *
 * Só o Windows resolve tudo pelo despachante. Fora dele o `open` e o `xdg-open`
 * despacham pela associação de tipo, que nem sempre é executar — veja
 * `montarLancamento`.
 */
const DESPACHANTE_DO_WINDOWS = 'explorer.exe';
const DESPACHANTE_DO_MACOS = 'open';
const DESPACHANTE_PADRAO = 'xdg-open';

/** Aplicativo do macOS é um pacote: o caminho escolhido é uma pasta `.app`, não um arquivo. */
const SUFIXO_DE_APLICATIVO_DO_MAC = '.app';

/**
 * Extensões que o macOS entrega ao despachante mesmo tendo bit de execução.
 *
 * O pacote `.app` só o `open` sabe iniciar. O `.command` existe justamente para
 * ser aberto pelo Terminal com dois cliques: executá-lo direto o rodaria escondido,
 * sem a janela que é o motivo de alguém escolher essa extensão.
 */
const SUFIXOS_DESPACHADOS_NO_MACOS = new Set([SUFIXO_DE_APLICATIVO_DO_MAC, '.command']);

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

export class FalhaAoIniciarExecutavelError extends Error {
  constructor(caminho: string, motivo: string) {
    super(`Não foi possível iniciar ${caminho}: ${motivo}`);
    this.name = 'FalhaAoIniciarExecutavelError';
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

function podeSerExecutadoDireto(informacoes: Stats): boolean {
  return (informacoes.mode & BITS_DE_EXECUCAO) !== 0;
}

/**
 * No Windows o despachante resolve tudo: `.exe`, `.lnk`, `.bat` e o que mais
 * estiver associado.
 *
 * Nos dois Unix, não. Tanto o `xdg-open` quanto o `open` despacham pela
 * associação de tipo, e para script a associação costuma ser um editor: um `.sh`
 * escolhido no seletor abriria no Xcode ou no bloco de notas em vez de rodar. Por
 * isso o arquivo com bit de execução é chamado direto, e o despachante fica para
 * o resto — o `.desktop` e o atalho web no Linux, o pacote `.app` e o `.command`
 * no macOS, que só ele sabe iniciar.
 */
function montarLancamento(caminho: string, informacoes: Stats): Lancamento {
  if (process.platform === 'win32') {
    return { comando: DESPACHANTE_DO_WINDOWS, argumentos: [caminho] };
  }

  if (process.platform === 'darwin') {
    const sufixo = extname(caminho).toLowerCase();

    return SUFIXOS_DESPACHADOS_NO_MACOS.has(sufixo) || !podeSerExecutadoDireto(informacoes)
      ? { comando: DESPACHANTE_DO_MACOS, argumentos: [caminho] }
      : { comando: caminho, argumentos: [] };
  }

  return podeSerExecutadoDireto(informacoes)
    ? { comando: caminho, argumentos: [] }
    : { comando: DESPACHANTE_PADRAO, argumentos: [caminho] };
}

/**
 * Inicia o programa cadastrado num atalho.
 *
 * A falha volta para quem chamou, em vez de virar linha de log: o botão de raio
 * não pode piscar "pronto" quando o programa nem chegou a subir.
 */
export async function abrirExecutavelNoSistema(caminho: string): Promise<void> {
  const informacoes = await inspecionarCaminho(caminho);
  const { comando, argumentos } = montarLancamento(caminho, informacoes);

  try {
    await lancarProcesso(comando, argumentos);
  } catch (erro) {
    if (erro instanceof LancamentoFalhouError) {
      throw new FalhaAoIniciarExecutavelError(caminho, erro.motivo);
    }
    throw erro;
  }
}
