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
import * as cofre from './cofreCredenciais';
import { logEvento } from './log';
import { capturar, resolverUrl, type ResultadoCaptura } from './navegador';
import { preencherESubmeterLogin } from './loginOcultoSankhya';
import type { TabManager } from './tabs';

/** Tempo para o POST de login terminar e a página redirecionar antes de ler cookie/token. */
const PAUSA_APOS_SENHA_MS = 2_000;
const TENTATIVAS_DE_CAPTURA = 5;
/** Evita reentrar a cada `did-finish-load` da própria navegação que este módulo dispara. */
const COOLDOWN_MS = 20_000;

const emAndamento = new Set<cofre.Sistema>();
const ultimaTentativa = new Map<cofre.Sistema, number>();

export function podeTentar(sistema: cofre.Sistema): boolean {
  if (emAndamento.has(sistema)) return false;
  const anterior = ultimaTentativa.get(sistema);
  return !anterior || Date.now() - anterior > COOLDOWN_MS;
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  if (!podeTentar(sistema)) {
    return { ok: false, cookies: 0, erro: 'login automático já em andamento ou tentado há pouco' };
  }

  const segredo = cofre.revelar(sistema);
  if (!segredo.usuario || !segredo.senha) {
    return { ok: false, cookies: 0, erro: 'sem usuário/senha salvos para este sistema' };
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
    view.webContents.loadURL(resolverUrl(sistema, ''));
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

    await pausa(PAUSA_APOS_SENHA_MS);
    for (let tentativa = 0; tentativa < TENTATIVAS_DE_CAPTURA; tentativa++) {
      const resultado = await capturar(tabs, sistema);
      if (resultado.ok) {
        logEvento('autologin-sankhya-concluido', { sistema });
        return resultado;
      }
      await pausa(1_000);
    }
    return {
      ok: false,
      cookies: 0,
      erro: 'login automático preencheu a senha, mas a sessão não veio — confira usuário e senha salvos',
    };
  } finally {
    emAndamento.delete(sistema);
  }
}
