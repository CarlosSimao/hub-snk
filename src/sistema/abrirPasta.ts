import { lancarProcesso, LancamentoFalhouError } from './lancarProcesso.ts';
import { garantirQueEhPasta } from './pasta.ts';

/**
 * Gerenciador de arquivos de cada sistema. O Linux e os demais Unix caem no
 * `xdg-open`, que é o despachante padrão do freedesktop.
 */
const COMANDOS_POR_PLATAFORMA: Record<string, string> = {
  win32: 'explorer.exe',
  darwin: 'open',
};
const COMANDO_PADRAO = 'xdg-open';

export class GerenciadorDeArquivosIndisponivelError extends Error {
  constructor(motivo: string) {
    super(
      `Não foi possível abrir o gerenciador de arquivos: ${motivo}. ` +
        'No Linux, instale o "xdg-utils".',
    );
    this.name = 'GerenciadorDeArquivosIndisponivelError';
  }
}

/**
 * Abre a pasta no gerenciador de arquivos do sistema.
 *
 * A falha é esperada e devolvida a quem chamou, em vez de registrada e
 * esquecida: sem `xdg-open` na máquina, o botão não abriria nada e a tela ainda
 * assim diria que abriu.
 */
export async function abrirPastaNoSistema(caminho: string): Promise<void> {
  await garantirQueEhPasta(caminho);

  const comando = COMANDOS_POR_PLATAFORMA[process.platform] ?? COMANDO_PADRAO;

  try {
    await lancarProcesso(comando, [caminho]);
  } catch (erro) {
    if (erro instanceof LancamentoFalhouError) {
      throw new GerenciadorDeArquivosIndisponivelError(erro.motivo);
    }
    throw erro;
  }
}
