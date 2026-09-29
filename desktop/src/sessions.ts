/**
 * Captura do token da Experience (localStorage, com decodificação de `exp`). Cookie do
 * ERP nunca é repassado ao backend: a Agenda vai pela ponte, consultada pela janela
 * oculta de `janelaAgendaOculta.ts`.
 */
import { type WebContents, type WebContentsView } from 'electron';
import { logEvento } from './log';

export interface SessaoExperience {
  presente: boolean;
  usuario: string;
  token: string;
  expIso: string;
}

function origemPermitida(url: string, lista: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    return lista.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function decodificarJwt(token: string): { email: string; expIso: string } {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
      email?: string;
      sub?: string;
    };
    return {
      email: json.email ?? json.sub ?? '',
      expIso: json.exp ? new Date(json.exp * 1000).toISOString() : '',
    };
  } catch {
    return { email: '', expIso: '' };
  }
}

const VAZIA: SessaoExperience = { presente: false, usuario: '', token: '', expIso: '' };

/**
 * Lê o `localStorage.token` de um `WebContents` já na origem da Experience — serve tanto
 * para a aba visível quanto para a janela oculta. Não loga evento: quem chama decide.
 */
export async function capturarTokenDeWebContents(wc: WebContents): Promise<SessaoExperience> {
  if (!origemPermitida(wc.getURL(), ['sankhya.com.br'])) return VAZIA;

  const token = (await wc.executeJavaScript(
    "(() => { try { return window.localStorage.getItem('token') || ''; } catch (e) { return ''; } })()",
    true,
  )) as string;
  if (!token) return VAZIA;

  const { email, expIso } = decodificarJwt(token);
  return { presente: true, usuario: email, token, expIso };
}

/** Captura o `localStorage.token` da aba Experience — mesma chave que o app usa hoje. */
export async function capturarTokenExperience(
  view: WebContentsView | undefined,
): Promise<SessaoExperience> {
  if (!view) return VAZIA;

  const sessao = await capturarTokenDeWebContents(view.webContents);
  logEvento('experience-token-capturado', { presente: sessao.presente, expIso: sessao.expIso });
  return sessao;
}
