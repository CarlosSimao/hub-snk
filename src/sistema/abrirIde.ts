import { extname } from 'node:path';
import { garantirQueEhPasta } from './pasta.ts';
import { lancarProcesso, LancamentoFalhouError, type Candidato } from './lancarProcesso.ts';

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

/**
 * Script `.cmd`/`.bat` não é executável para o `spawn`: quem o interpreta é o
 * `cmd.exe`, chamado com os argumentos separados — nunca com `shell: true` —
 * para que continuem argumentos e não linha de comando.
 */
function montarLancamento(caminhoDoExecutavel: string, pasta: string): Candidato {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(caminhoDoExecutavel)) {
    return { comando: 'cmd.exe', argumentos: ['/c', caminhoDoExecutavel, pasta] };
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

  const { comando, argumentos } = montarLancamento(caminhoDoExecutavel, pasta);

  try {
    await lancarProcesso(comando, argumentos, { ocultarJanelaNoWindows: true });
  } catch (erro) {
    if (erro instanceof LancamentoFalhouError) {
      throw new IdeIndisponivelError(caminhoDoExecutavel, erro.motivo);
    }
    throw erro;
  }
}
