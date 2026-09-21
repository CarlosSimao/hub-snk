/**
 * Sessao da Experience empurrada pelo shell desktop (`desktop/`), guardada em memoria
 * do processo do backend — nao precisa persistir em disco: se o backend reiniciar, o
 * shell desktop empurra de novo assim que a aba Experience revalidar o token.
 *
 * So existe para `sankhya-experience`: a Agenda do ERP nao usa sessao empurrada — vai
 * por `DesktopBridge`, que executa o fetch dentro da propria aba autenticada (ver
 * desktopBridge.ts e a Secao 6.2 da especificacao sobre por que replicar cookie nao
 * e' homologado).
 */

export interface SessaoDesktop {
  usuario: string;
  token: string;
  /** ISO-8601 do `exp` do JWT, quando ha um. Vazio quando o token nao informa `exp`. */
  expira: string;
  capturadoEm: number;
}

function expirada(sessao: SessaoDesktop): boolean {
  if (!sessao.expira) return false;
  const expiraEm = Date.parse(sessao.expira);
  return Number.isFinite(expiraEm) && expiraEm <= Date.now();
}

export class SessaoDesktopStore {
  #sessao: SessaoDesktop | null = null;

  definir(dados: { usuario: string; token: string; expira: string }): void {
    this.#sessao = { ...dados, capturadoEm: Date.now() };
  }

  /** `undefined` quando nunca foi empurrada ou quando o `exp` do JWT já passou. */
  obter(): SessaoDesktop | undefined {
    if (!this.#sessao) return undefined;
    if (expirada(this.#sessao)) {
      this.#sessao = null;
      return undefined;
    }
    return this.#sessao;
  }

  limpar(): void {
    this.#sessao = null;
  }
}
