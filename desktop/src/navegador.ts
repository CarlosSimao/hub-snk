/**
 * Abertura das guias do Sankhya e captura da sessão delas para o cofre do shell.
 *
 * O shell é o navegador: as guias ERP e Experience estão abertas aqui, e ler a sessão é
 * `session.cookies` — sem CDP e sem um Chrome paralelo.
 */
import { session } from 'electron';
import { DOMINIOS_ERP, ERP_URL, EXPERIENCE_URL, PARTICAO } from './config';
import { capturarTokenExperience } from './sessions';
import { gravarSessao, type Sistema } from './cofreCredenciais';
import { logEvento } from './log';
import type { TabManager } from './tabs';

const URL_LOGIN: Record<Sistema, string> = {
  'sankhya-erp': ERP_URL,
  'sankhya-experience': EXPERIENCE_URL,
};

/**
 * Onde mora o que REALMENTE autentica cada sistema.
 *
 * Medido: a API da Experience responde 403 com o cookie e 200 com
 * `Authorization: Bearer <localStorage.token>`. O cookie de sessao nao serve para ela, e
 * considerar a captura bem-sucedida sem o JWT daria uma sessao que nao funciona.
 */
const USA_TOKEN: Record<Sistema, boolean> = {
  'sankhya-erp': false,
  'sankhya-experience': true,
};

export function urlDeLogin(sistema: Sistema): string {
  return URL_LOGIN[sistema];
}

/** Origem + caminho, sem hash nem query — para comparar "já estou nessa página". */
function paginaBase(urlTexto: string): string {
  try {
    const u = new URL(urlTexto);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

/**
 * Traz a guia do sistema para a frente, na página de entrada dele.
 *
 * Só navega quando a guia está noutra página: recarregar `system.jsp` derruba o Angular
 * que acabou de logar, e o Sankhya volta para a tela de login mesmo com cookie válido.
 */
export async function abrir(tabs: TabManager | null, sistema: Sistema): Promise<string> {
  const url = urlDeLogin(sistema);
  const id = sistema === 'sankhya-erp' ? 'erp' : 'experience';
  const view = tabs?.aba(id);
  if (!view) throw new Error('as abas do Sankhya ainda não abriram');

  if (paginaBase(view.webContents.getURL()) !== paginaBase(url)) {
    await view.webContents.loadURL(url);
  }
  tabs?.mostrar(id);
  logEvento('navegador-abrir', { sistema });
  return url;
}

export interface ResultadoCaptura {
  ok: boolean;
  cookies: number;
  token?: boolean;
  expira?: string;
  erro?: string;
}

/**
 * Le a sessao da aba e guarda no cofre do shell.
 *
 * Duas regras, e as duas evitam "capturei" mentiroso:
 *
 *  - para a Experience, a ausencia do TOKEN e' o unico teste honesto de "esta logado" —
 *    cookie anonimo existe antes do login e daria falso positivo;
 *  - para o ERP, sem cookie nenhum do dominio nao ha o que capturar.
 */
export async function capturar(
  tabs: TabManager | null,
  sistema: Sistema,
): Promise<ResultadoCaptura> {
  const particao = session.fromPartition(PARTICAO);

  const cookies = (
    await Promise.all(DOMINIOS_ERP.map((dominio) => particao.cookies.get({ domain: dominio })))
  ).flat();

  let token = '';
  let expira = '';
  if (USA_TOKEN[sistema]) {
    const sessao = await capturarTokenExperience(tabs?.aba('experience'));
    token = sessao.token;
    expira = sessao.expIso;

    if (!token) {
      return {
        ok: false,
        cookies: cookies.length,
        erro: 'a aba não está logada nesse sistema — faça o login nela e capture de novo',
      };
    }
  } else if (!cookies.length) {
    return {
      ok: false,
      cookies: 0,
      erro: 'nenhum cookie desse domínio — faça o login na aba do Sankhya antes de capturar',
    };
  }

  const cabecalho = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  gravarSessao(sistema, {
    ...(cookies.length ? { sessao: cabecalho } : {}),
    ...(token ? { token } : {}),
    ...(expira ? { expira } : {}),
  });

  logEvento('navegador-sessao-capturada', {
    sistema,
    cookies: cookies.length,
    token: Boolean(token),
  });
  return { ok: true, cookies: cookies.length, token: Boolean(token), expira };
}
