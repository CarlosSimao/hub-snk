/**
 * Captura do token da Experience (localStorage, com decodificação de `exp`) e
 * diagnóstico de cookies do ERP — só para status na UI local, nunca repassado ao
 * backend (a Agenda vai pelo bridge, não por cookie replicado; ver
 * desktop/src/agenda.ts e a Seção 6.2 da especificação). Porta de
 * `poc-desktop/src/main.js`.
 */
import { session, type WebContents, type WebContentsView } from 'electron';
import { DOMINIOS_ERP, ERP_URL, PARTICAO } from './config';
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

/** Diagnóstico local: nomes/contagem de cookies, nunca o valor. */
export async function diagnosticoCookiesErp(): Promise<{
  total: number;
  httpOnly: number;
  nomes: string[];
}> {
  const ses = session.fromPartition(PARTICAO);
  const porUrl = await ses.cookies.get({ url: ERP_URL });
  const porDominio = (
    await Promise.all(DOMINIOS_ERP.map((d) => ses.cookies.get({ domain: d })))
  ).flat();
  const unicos = new Map(
    [...porUrl, ...porDominio].map((c) => [`${c.domain}|${c.name}|${c.path}`, c]),
  );
  const lista = [...unicos.values()];
  return {
    total: lista.length,
    httpOnly: lista.filter((c) => c.httpOnly).length,
    nomes: lista.map((c) => c.name),
  };
}
