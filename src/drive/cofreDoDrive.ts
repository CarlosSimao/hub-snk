import type { PonteDoDesktop } from '../sankhya/ponteDoDesktop.ts';

/** O que fica guardado da conta conectada. O token de acesso não: vive uma hora, em memória. */
export interface SegredoDoDrive {
  refreshToken: string;
  email: string;
  /** Escopos que o usuário concedeu na tela do Google, que pode desmarcar um deles. */
  escopos: string[];
}

/**
 * Onde o token da conta do Google fica guardado.
 *
 * Nunca na pasta de dados: ela é o que o backup copia e o que sobe para o próprio Drive.
 */
export interface CofreDoDrive {
  ler(): Promise<SegredoDoDrive | null>;
  gravar(segredo: SegredoDoDrive): Promise<void>;
  remover(): Promise<void>;
}

const CAMINHO_NA_PONTE = '/segredos/google-drive';

function ehSegredo(valor: unknown): valor is SegredoDoDrive {
  if (typeof valor !== 'object' || valor === null) {
    return false;
  }
  const { refreshToken, email, escopos } = valor as Record<string, unknown>;
  return (
    typeof refreshToken === 'string' &&
    refreshToken !== '' &&
    typeof email === 'string' &&
    Array.isArray(escopos) &&
    escopos.every((escopo) => typeof escopo === 'string')
  );
}

/**
 * Cofre do shell desktop (`safeStorage`, DPAPI no Windows), pela ponte. Sem o shell no ar
 * as chamadas falham com `PonteDoDesktopIndisponivelError`, que quem chama trata.
 */
export class CofreDoDriveNaPonte implements CofreDoDrive {
  readonly #ponte: PonteDoDesktop;

  constructor(ponte: PonteDoDesktop) {
    this.#ponte = ponte;
  }

  async ler(): Promise<SegredoDoDrive | null> {
    const { valor } = await this.#ponte.requisitar<{ valor: string | null }>(CAMINHO_NA_PONTE);
    if (!valor) {
      return null;
    }

    try {
      const segredo: unknown = JSON.parse(valor);
      return ehSegredo(segredo) ? segredo : null;
    } catch {
      // Valor ilegível vale como conta não conectada: o usuário conecta de novo.
      return null;
    }
  }

  async gravar(segredo: SegredoDoDrive): Promise<void> {
    await this.#ponte.requisitar(CAMINHO_NA_PONTE, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor: JSON.stringify(segredo) }),
    });
  }

  async remover(): Promise<void> {
    await this.#ponte.requisitar(CAMINHO_NA_PONTE, { method: 'DELETE' });
  }
}
