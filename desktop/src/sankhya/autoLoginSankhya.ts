/**
 * Login automático nas abas erp/experience do próprio shell, usando a credencial já
 * salva no cofre — substitui o fluxo manual "abrir aba > logar na mão > capturar
 * sessão" por um clique só (ou nenhum: também roda sozinho no boot e quando a Agenda
 * recebe sessão expirada).
 *
 * Reusa o mesmo script de preenchimento do `autofill.ts` (bases de cliente), só que o
 * alvo aqui é a tela de login do próprio Sankhya ERP/Experience e o critério de
 * sucesso não é "preencheu a senha" e sim "a sessão pôde ser capturada depois" — o
 * preenchimento pode disparar SSO, MFA ou um redirect que só resolve alguns segundos
 * depois de o formulário submeter.
 */
import type { WebContents } from 'electron';
import * as cofre from './cofreCredenciais';
import { URL_WORKSPACE_ERP } from '../config';
import { logEvento } from '../log';
import { capturar, urlDeLogin, type ResultadoCaptura } from './navegador';
import { preencherESubmeterLogin } from './loginOcultoSankhya';
import type { TabManager } from '../interface/tabs';

/** Tempo para o POST de login terminar e a página redirecionar antes de ler cookie/token. */
const PAUSA_APOS_SENHA_MS = 2_000;
const TENTATIVAS_DE_CAPTURA = 5;
/** Tempo para o SankhyaOm sair da tela de login e abrir o workspace. */
const ESPERA_WORKSPACE_MS = 30_000;
const INTERVALO_MS = 1_000;
/** Evita reentrar a cada `did-finish-load` da própria navegação que este módulo dispara. */
const COOLDOWN_MS = 20_000;

const emAndamento = new Set<cofre.Sistema>();
const ultimaTentativa = new Map<cofre.Sistema, number>();

export function podeTentar(sistema: cofre.Sistema): boolean {
  if (emAndamento.has(sistema) || cofre.loginAutomaticoSuspenso()) return false;
  const anterior = ultimaTentativa.get(sistema);
  return !anterior || Date.now() - anterior > COOLDOWN_MS;
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * O SankhyaOm pede a senha na própria `/mge/` e deixa cookie antes do login: nem a URL
 * nem a captura dizem se a senha foi aceita. Só a chegada ao workspace diz.
 */
async function chegouAoWorkspaceDoErp(wc: WebContents): Promise<boolean> {
  const inicio = Date.now();
  while (!wc.isDestroyed() && Date.now() - inicio < ESPERA_WORKSPACE_MS) {
    if (wc.getURL().startsWith(URL_WORKSPACE_ERP)) return true;
    await pausa(INTERVALO_MS);
  }
  return false;
}

/**
 * Preenche e submete o login na aba já aberta do sistema, e só então captura a sessão.
 * Nunca troca a guia visível: opera na `WebContentsView` em segundo plano, então o
 * usuário só percebe se estiver com aquela guia em foco no momento.
 */
export async function autoLoginSankhya(
  tabs: TabManager | null,
  sistema: cofre.Sistema,
): Promise<ResultadoCaptura> {
  if (cofre.loginAutomaticoSuspenso()) {
    return { ok: false, cookies: 0, erro: cofre.MENSAGEM_DE_LOGIN_SUSPENSO };
  }
  if (!podeTentar(sistema)) {
    return { ok: false, cookies: 0, erro: 'login automático já em andamento ou tentado há pouco' };
  }

  const segredo = cofre.revelar(sistema);
  if (!segredo.usuario || !segredo.senha) {
    return { ok: false, cookies: 0, erro: 'sem Sankhya ID (usuário e senha) salvo' };
  }

  const id = sistema === 'sankhya-erp' ? 'erp' : 'experience';
  const view = tabs?.aba(id);
  if (!view) {
    return { ok: false, cookies: 0, erro: 'a aba do sistema ainda não abriu' };
  }

  emAndamento.add(sistema);
  ultimaTentativa.set(sistema, Date.now());
  logEvento('autologin-sankhya-iniciado', { sistema });
  try {
    view.webContents.loadURL(urlDeLogin(sistema));
    const preencheu = await preencherESubmeterLogin(
      view.webContents,
      segredo.usuario,
      segredo.senha,
    );
    if (!preencheu) {
      logEvento('autologin-sankhya-sem-tela-reconhecida', { sistema });
      return {
        ok: false,
        cookies: 0,
        erro: 'não reconheci a tela de login para preencher sozinho — faça o login na guia e capture manualmente',
      };
    }

    if (sistema === 'sankhya-erp' && !(await chegouAoWorkspaceDoErp(view.webContents))) {
      cofre.registrarLoginAutomatico(sistema, false);
      return {
        ok: false,
        cookies: 0,
        erro: 'o SankhyaOm não aceitou o login automático — confira usuário e senha salvos',
      };
    }

    await pausa(PAUSA_APOS_SENHA_MS);
    for (let tentativa = 0; tentativa < TENTATIVAS_DE_CAPTURA; tentativa++) {
      const resultado = await capturar(tabs, sistema);
      if (resultado.ok) {
        cofre.registrarLoginAutomatico(sistema, true);
        logEvento('autologin-sankhya-concluido', { sistema });
        return resultado;
      }
      await pausa(INTERVALO_MS);
    }
    cofre.registrarLoginAutomatico(sistema, false);
    return {
      ok: false,
      cookies: 0,
      erro: 'login automático preencheu a senha, mas a sessão não veio — confira usuário e senha salvos',
    };
  } finally {
    emAndamento.delete(sistema);
  }
}
