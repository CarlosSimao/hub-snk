import { lancarProcesso, LancamentoFalhouError } from './lancarProcesso.ts';

export class NavegadorIndisponivelError extends Error {
  constructor(motivo: string) {
    super(`Não foi possível abrir o navegador padrão: ${motivo}.`);
    this.name = 'NavegadorIndisponivelError';
  }
}

interface Despachante {
  comando: string;
  argumentos: (endereco: string) => string[];
}

/*
 * No Windows o `rundll32` entrega o endereço ao navegador padrão sem passar por shell:
 * o `start` do `cmd.exe` interpretaria os `&` da URL como separador de comando.
 */
const DESPACHANTES_POR_PLATAFORMA: Record<string, Despachante> = {
  win32: {
    comando: 'rundll32.exe',
    argumentos: (endereco) => ['url.dll,FileProtocolHandler', endereco],
  },
  darwin: { comando: 'open', argumentos: (endereco) => [endereco] },
};
const DESPACHANTE_PADRAO: Despachante = {
  comando: 'xdg-open',
  argumentos: (endereco) => [endereco],
};

/**
 * Abre o endereço no navegador padrão do sistema, fora do HUB SNK.
 *
 * Existe para o consentimento do Google: ele recusa o login OAuth dentro de navegador
 * embutido em aplicativo, então a guia do HUB SNK não serve.
 */
export async function abrirNoNavegadorPadrao(endereco: string): Promise<void> {
  const protocolo = new URL(endereco).protocol;
  if (protocolo !== 'https:' && protocolo !== 'http:') {
    throw new NavegadorIndisponivelError(`endereço com protocolo "${protocolo}" não é aberto`);
  }

  const despachante = DESPACHANTES_POR_PLATAFORMA[process.platform] ?? DESPACHANTE_PADRAO;
  try {
    await lancarProcesso(despachante.comando, despachante.argumentos(endereco));
  } catch (erro) {
    if (erro instanceof LancamentoFalhouError) {
      throw new NavegadorIndisponivelError(erro.motivo);
    }
    throw erro;
  }
}
