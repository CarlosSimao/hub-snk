import { extname } from 'node:path';
import { garantirQueEhPasta } from '../pasta.ts';
import { lancarProcesso, LancamentoFalhouError, type Candidato } from './lancarProcesso.ts';
import {
  argumentosDoCmdParaScript,
  ArgumentoInseguroParaOCmdError,
} from './linhaDeComandoDoCmd.ts';

/**
 * Abertura de uma IDE qualquer já com a pasta do repositório carregada como
 * projeto.
 *
 * Sem lista de IDEs suportadas: o usuário aponta o executável dela uma vez na
 * configuração global, e a pasta é passada como argumento de linha de comando
 * — o que cobre IntelliJ, VS Code, WebStorm, Rider, Sublime e afins, todas com
 * o mesmo contrato de "caminho como argumento".
 */

export class IdeNaoConfiguradaError extends Error {
  constructor() {
    super('Nenhuma IDE configurada. Cadastre o executável em Configurações › Geral.');
    this.name = 'IdeNaoConfiguradaError';
  }
}

export class IdeIndisponivelError extends Error {
  constructor(caminhoDoExecutavel: string, motivo: string) {
    super(`Não foi possível abrir a IDE (${caminhoDoExecutavel}): ${motivo}`);
    this.name = 'IdeIndisponivelError';
  }
}

/** Pacote do macOS: só o `open` sabe iniciar, e a pasta vai em `--args`. */
const SUFIXO_DE_APLICATIVO_DO_MAC = '.app';

interface Lancamento extends Candidato {
  argumentosLiterais?: boolean;
}

/**
 * Script `.cmd`/`.bat` não é executável para o `spawn`: quem o interpreta é o
 * `cmd.exe` — nunca com `shell: true` —, com a linha citada do jeito que ele
 * entende (o `code.cmd` do VS Code é o caso comum).
 */
function montarLancamento(caminhoDoExecutavel: string, pasta: string): Lancamento {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(caminhoDoExecutavel)) {
    return {
      comando: 'cmd.exe',
      argumentos: argumentosDoCmdParaScript(caminhoDoExecutavel, [pasta]),
      argumentosLiterais: true,
    };
  }

  if (
    process.platform === 'darwin' &&
    extname(caminhoDoExecutavel).toLowerCase() === SUFIXO_DE_APLICATIVO_DO_MAC
  ) {
    return { comando: 'open', argumentos: ['-n', '-a', caminhoDoExecutavel, '--args', pasta] };
  }

  return { comando: caminhoDoExecutavel, argumentos: [pasta] };
}

export async function abrirIdeNaPasta(caminhoDoExecutavel: string, pasta: string): Promise<void> {
  if (caminhoDoExecutavel === '') {
    throw new IdeNaoConfiguradaError();
  }

  await garantirQueEhPasta(pasta);

  try {
    const { comando, argumentos, argumentosLiterais } = montarLancamento(
      caminhoDoExecutavel,
      pasta,
    );
    await lancarProcesso(comando, argumentos, {
      ocultarJanelaNoWindows: true,
      argumentosLiterais,
    });
  } catch (erro) {
    if (erro instanceof LancamentoFalhouError) {
      throw new IdeIndisponivelError(caminhoDoExecutavel, erro.motivo);
    }
    if (erro instanceof ArgumentoInseguroParaOCmdError) {
      throw new IdeIndisponivelError(caminhoDoExecutavel, erro.message);
    }
    throw erro;
  }
}
