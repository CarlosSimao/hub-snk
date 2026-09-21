/**
 * Cifra e decifra segredo avulso — senha de base de cliente (cartao.ts) e senha do app
 * do Gmail (emailInterno.ts). Fase 3 da migracao "sem Docker".
 *
 * Estes valores nao cabem no cofre por sistema: sao N por cliente, e quem sabe a qual
 * base cada um pertence e' o hub. O blob volta cifrado e e' o SQLite do hub que o guarda.
 *
 * Dois produtores de blob convivem, e e' por isso que existe um PREFIXO:
 *
 *  - `hub-helper.ps1`, via `/secret/*` — `ProtectedData` (DPAPI). Blob em base64 puro.
 *  - shell desktop, via bridge — `safeStorage`, que TAMBEM e' DPAPI no Windows, mas com
 *    envelope proprio. Blob marcado com `sb1:`.
 *
 * Um nao abre o blob do outro. Sem a marca, a unica forma de descobrir isso seria
 * tentar decifrar e falhar — e falha de decifragem e' indistinguivel de "senha gravada
 * noutro usuario do Windows", que e' um problema real e de outra natureza. A marca
 * torna a escolha deterministica.
 */
import { DesktopBridgeIndisponivelError, type DesktopBridge } from './desktopBridge.ts';
import type { HubHelper } from './helper.ts';

/** Envelope do `safeStorage`. Blob sem marca e' do formato antigo (helper PowerShell). */
export const PREFIXO_SHELL = 'sb1:';

export function ehFormatoShell(cifrada: string): boolean {
  return cifrada.startsWith(PREFIXO_SHELL);
}

export class Cifra {
  readonly #helper: HubHelper;
  readonly #bridge: DesktopBridge | undefined;

  constructor(helper: HubHelper, bridge?: DesktopBridge) {
    this.#helper = helper;
    this.#bridge = bridge;
  }

  /**
   * Shell primeiro; helper como retaguarda.
   *
   * Cifrar e' sempre seguro de redirecionar: o resultado carrega a marca do formato, e
   * quem decifra depois olha a marca.
   */
  async cifrar(valor: string): Promise<string> {
    if (this.#bridge) {
      try {
        const corpo = await this.#bridge.cifrarSegredo<{ valor: string }>(valor);
        return corpo.valor ?? '';
      } catch (err) {
        if (!(err instanceof DesktopBridgeIndisponivelError)) throw err;
      }
    }

    const corpo = await this.#helper.requisitar<{ valor: string }>('/secret/encrypt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor }),
    });
    return corpo.valor ?? '';
  }

  /**
   * Decifrar NAO e' redirecionavel: quem cifrou e' quem sabe abrir. A marca decide, e
   * mandar para o lado errado devolveria "não consegui decriptar" — mensagem que faria
   * o usuario procurar defeito na credencial dele.
   */
  async decifrar(cifrada: string): Promise<string | null> {
    if (!cifrada) return null;

    if (ehFormatoShell(cifrada)) {
      if (!this.#bridge) {
        throw new DesktopBridgeIndisponivelError(
          'esta senha foi gravada pelo Sankhya Hub Desktop e só ele consegue abri-la — abra o aplicativo',
        );
      }
      const corpo = await this.#bridge.decifrarSegredo<{ valor: string }>(cifrada);
      return corpo.valor ?? null;
    }

    const corpo = await this.#helper.requisitar<{ valor: string }>('/secret/decrypt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor: cifrada }),
    });
    return corpo.valor ?? null;
  }

  /**
   * Regrava um blob antigo no formato do shell, quando os dois lados estao disponiveis.
   *
   * Devolve `null` quando nao ha o que fazer (ja e' do formato novo, sem shell no ar, ou
   * o helper nao abriu o blob) — o chamador so grava quando vem valor.
   */
  async migrar(cifrada: string): Promise<string | null> {
    if (!cifrada || ehFormatoShell(cifrada) || !this.#bridge) return null;

    try {
      const claro = await this.decifrar(cifrada);
      if (!claro) return null;
      const novo = await this.cifrar(claro);
      return ehFormatoShell(novo) ? novo : null;
    } catch {
      // Helper fora do ar ou blob de outro usuario do Windows: mantem o valor como esta'.
      // Migracao e' oportunista — perder o segredo aqui seria bem pior que adiar.
      return null;
    }
  }
}
