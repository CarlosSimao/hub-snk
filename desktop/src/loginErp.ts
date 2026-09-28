/**
 * Login automático da aba ERP corporativa, com o usuário e a senha guardados em
 * Sankhya › Credenciais (cofre local, `cofreCredenciais.ts`).
 *
 * Mesmo mecanismo das bases de cliente com "Entrar automaticamente" (`autofill.ts`):
 * preenche e clica Prosseguir/Entrar na PRÓPRIA página de login. Simular o login por
 * fora da aba não serve no corporativo — a sessão criada assim é negada pelo
 * `service.sbr` (medido em 2026-09-24).
 *
 * Quando o login entra, pede ao backend a atualização da agenda na hora: sem isso, o DS
 * aberto antes do login só traria a agenda no próximo tique do sincronizador.
 */
import type { WebContentsView } from 'electron';
import { observarLogin } from './autofill';
import * as cofre from './cofreCredenciais';
import { DOMINIOS_ERP, HUB_URL } from './config';
import { logEvento } from './log';

/** Senha errada recarrega a tela de login; mais que isso em 10 min é repetição, não login. */
const MAX_TENTATIVAS = 2;
const JANELA_TENTATIVAS_MS = 10 * 60_000;

function doErp(url: string): URL | null {
  try {
    const u = new URL(url);
    return DOMINIOS_ERP.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`)) ? u : null;
  } catch {
    return null;
  }
}

/**
 * Candidata a tela de login: página do ERP fora do workspace. O login aparece tanto em
 * `/mge/login.jsp?expired=true` quanto na raiz `/mge/` (medido 2026-09-28, sem mudar a
 * URL). Se não for login, o próprio autofill descarta (campos demais, nenhum reconhecido).
 */
export function ehTelaDeLogin(url: string): boolean {
  const u = doErp(url);
  return Boolean(u && !/\/system\.jsp$/i.test(u.pathname));
}

/** O workspace já logado (`/mge/system.jsp`). */
export function ehSistemaLogado(url: string): boolean {
  const u = doErp(url);
  return Boolean(u && /\/system\.jsp$/i.test(u.pathname));
}

async function pedirAtualizacaoDaAgenda(): Promise<void> {
  try {
    await fetch(`${HUB_URL}/api/agenda/sincronizar`, { method: 'POST', signal: AbortSignal.timeout(180_000) });
    logEvento('login-erp-agenda-atualizada');
  } catch (err) {
    logEvento('login-erp-agenda-falhou', { erro: String(err) });
  }
}

export function instalarLoginErp(view: WebContentsView): void {
  const tentativas: number[] = [];
  let observando = false;
  let passouPeloLogin = false;

  const talvezEntrar = (url: string) => {
    if (!ehTelaDeLogin(url) || observando) return;
    passouPeloLogin = true;

    const agora = Date.now();
    while (tentativas.length && agora - tentativas[0]! > JANELA_TENTATIVAS_MS) tentativas.shift();
    if (tentativas.length >= MAX_TENTATIVAS) {
      logEvento('login-erp-tentativas-esgotadas');
      return;
    }

    const { usuario, senha } = cofre.disponivel() ? cofre.revelar('sankhya-erp') : { usuario: '', senha: '' };
    if (!usuario || !senha) {
      logEvento('login-erp-sem-credencial');
      return;
    }

    tentativas.push(agora);
    observando = true;
    logEvento('login-erp-iniciado');
    void observarLogin(view, usuario, senha, true, { aba: 'erp' }).finally(() => {
      observando = false;
    });
  };

  view.webContents.on('did-finish-load', () => talvezEntrar(view.webContents.getURL()));
  view.webContents.on('did-navigate', (_e, url) => {
    if (ehSistemaLogado(url) && passouPeloLogin) {
      passouPeloLogin = false;
      tentativas.length = 0;
      logEvento('login-erp-concluido');
      void pedirAtualizacaoDaAgenda();
    }
  });

  // A aba pode já ter carregado antes de o observador existir.
  if (!view.webContents.isLoading()) talvezEntrar(view.webContents.getURL());
}
