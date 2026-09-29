/**
 * Peças comuns às janelas ocultas que logam no Sankhya sozinhas (Agenda de Recursos e
 * Experience): criar a janela invisível e preencher/submeter o login web com a credencial
 * do cofre. Cada janela cuida do seu próprio critério de "pronto" depois disso (a Agenda
 * espera a tela abrir; a Experience espera o token aparecer).
 *
 * Login WEB de propósito: provado que o login por API cria sessão com ACL restrito. A
 * senha só existe em claro entre estas funções e a página de destino — nunca é logada.
 */
import { BrowserWindow, type WebContents } from 'electron';
import { paginaNoHost, scriptAutofillTick, scriptSubmeterLogin } from './autofill';
import { HOSTS_DE_LOGIN_SANKHYA } from './config';

const JANELA_PREENCHIMENTO_MS = 90_000;
const INTERVALO_MS = 1_000;

function hostDoSankhya(host: string): boolean {
  return HOSTS_DE_LOGIN_SANKHYA.some((dominio) => host === dominio || host.endsWith(`.${dominio}`));
}

/** Janela invisível com partição própria, sem estrangular timers (o Angular do Sankhya conta requisições). */
export function criarJanelaOculta(particao: string): BrowserWindow {
  return new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      partition: particao,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
}

/** Roda o autofill em ticks até a senha ser preenchida (login em duas etapas: usuário, depois senha). */
function esperarSenhaPreenchida(wc: WebContents, usuario: string, senha: string): Promise<boolean> {
  return new Promise((resolve) => {
    const inicio = Date.now();
    let preencheuUsuario = false;
    const intervalo = setInterval(() => {
      void (async () => {
        if (wc.isDestroyed() || Date.now() - inicio > JANELA_PREENCHIMENTO_MS) {
          clearInterval(intervalo);
          resolve(false);
          return;
        }
        // Fora do Sankhya (redirect, página intermediária), espera o próximo tick sem preencher.
        if (!paginaNoHost(wc, hostDoSankhya)) return;
        try {
          const resultado = (await wc.executeJavaScript(
            scriptAutofillTick(usuario, senha, preencheuUsuario),
            true,
          )) as { ok: boolean; etapa?: string };
          if (resultado.ok && resultado.etapa === 'senha') {
            clearInterval(intervalo);
            resolve(true);
          } else if (resultado.ok && resultado.etapa === 'usuario') {
            preencheuUsuario = true;
          }
        } catch {
          clearInterval(intervalo);
          resolve(false);
        }
      })();
    }, INTERVALO_MS);
    wc.once('destroyed', () => {
      clearInterval(intervalo);
      resolve(false);
    });
  });
}

/**
 * Preenche usuário/senha na tela de login e submete. `true` quando conseguiu submeter; o
 * critério de sucesso do login em si (redirect, token, tela) é de quem chama.
 */
export async function preencherESubmeterLogin(
  wc: WebContents,
  usuario: string,
  senha: string,
): Promise<boolean> {
  const preencheu = await esperarSenhaPreenchida(wc, usuario, senha);
  if (!preencheu) return false;
  await wc.executeJavaScript(scriptSubmeterLogin(), true).catch(() => false);
  return true;
}
