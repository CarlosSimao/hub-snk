/**
 * Sessão da Experience empurrada pelo shell desktop, que lê o JWT da guia
 * Experience logada e o envia ao backend a cada renovação.
 *
 * Fica só em memória: se o backend reiniciar, o shell empurra de novo no ciclo
 * seguinte. Gravar em disco criaria mais uma cópia de um token de acesso sem
 * ganho nenhum.
 */

export interface SessaoEmpurrada {
  usuario: string;
  token: string;
  /** ISO-8601 do `exp` do JWT. Vazio quando o token não informa `exp`. */
  expira: string;
}

function estaExpirada(sessao: SessaoEmpurrada): boolean {
  if (!sessao.expira) {
    return false;
  }

  const expiraEm = Date.parse(sessao.expira);
  return Number.isFinite(expiraEm) && expiraEm <= Date.now();
}

export class SessaoDoDesktop {
  #sessao: SessaoEmpurrada | null = null;

  definir(sessao: SessaoEmpurrada): void {
    this.#sessao = { ...sessao };
  }

  /** `undefined` quando nada foi empurrado ou quando o `exp` do JWT já passou. */
  obter(): SessaoEmpurrada | undefined {
    if (!this.#sessao) {
      return undefined;
    }

    if (estaExpirada(this.#sessao)) {
      this.#sessao = null;
      return undefined;
    }

    return this.#sessao;
  }

  limpar(): void {
    this.#sessao = null;
  }
}
