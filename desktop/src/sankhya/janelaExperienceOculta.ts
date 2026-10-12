/**
 * Janela invisível dedicada ao Sankhya Experience, que loga sozinha pela web e mantém o
 * JWT disponível para o backend — a mesma ideia da janela oculta da Agenda.
 *
 * Por que existe: a aba OS chama a API da Experience (AWS) com `Authorization: Bearer
 * <JWT>`. Antes esse JWT era lido da aba Experience VISÍVEL e empurrado ao backend; se o
 * usuário não estivesse logado nela (sessão expirada, logout, primeiro boot), a aba OS
 * quebrava. Aqui a janela oculta cuida do login e da renovação sem depender da aba visível.
 *
 * A janela não chama a API: só produz o token. O backend (`src/sankhya/experience.ts`)
 * continua fazendo as chamadas server-side, com paginação e limite de concorrência.
 */
import { type BrowserWindow, type WebContents } from 'electron';
import * as cofre from './cofreCredenciais';
import { EXPERIENCE_URL } from '../config';
import { logEvento } from '../log';
import { criarJanelaOculta, preencherESubmeterLogin } from './loginOcultoSankhya';
import { capturarTokenDeWebContents, type SessaoExperience } from './sessions';

const PARTICAO_EXPERIENCE = 'persist:sankhya-hub-experience';
const INTERVALO_MS = 1_000;
/** Tempo para o login web assentar e o token aparecer no `localStorage`. */
const LOGIN_TIMEOUT_MS = 120_000;
/** Renova o token com folga antes de expirar, para uma consulta nunca pegar token vencido. */
const MARGEM_RENOVACAO_MS = 10 * 60_000;

const SEM_SESSAO: SessaoExperience = { presente: false, usuario: '', token: '', expIso: '' };

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tokenValido(sessao: SessaoExperience): boolean {
  if (!sessao.presente || !sessao.token) return false;
  if (!sessao.expIso) return true;
  return Date.parse(sessao.expIso) - Date.now() > MARGEM_RENOVACAO_MS;
}

export class JanelaExperienceOculta {
  #janela: BrowserWindow | null = null;
  /** Serializa: um login por vez, nunca dois setups concorrentes. */
  #fila: Promise<unknown> = Promise.resolve();

  /** Garante login e devolve a sessão (token/usuário/expiração). `presente:false` se falhar. */
  obterSessao(): Promise<SessaoExperience> {
    const execucao = this.#fila.then(() => this.#garantirLogado());
    this.#fila = execucao.catch(() => undefined);
    return execucao;
  }

  destruir(): void {
    if (this.#janela && !this.#janela.isDestroyed()) this.#janela.destroy();
    this.#janela = null;
  }

  async #garantirLogado(): Promise<SessaoExperience> {
    if (this.#janela && !this.#janela.isDestroyed()) {
      const atual = await capturarTokenDeWebContents(this.#janela.webContents).catch(
        () => SEM_SESSAO,
      );
      if (tokenValido(atual)) return atual;
    }

    const segredo = cofre.revelar('sankhya-experience');
    if (!segredo.usuario || !segredo.senha) return SEM_SESSAO;
    if (cofre.loginAutomaticoSuspenso()) return SEM_SESSAO;

    this.#criarJanela();
    const wc = this.#janela!.webContents;
    try {
      await wc.loadURL(EXPERIENCE_URL);
    } catch (erro) {
      // A Experience redireciona para `login.sankhya.com.br`; o `loadURL` rejeita com
      // ERR_ABORTED quando o redirect substitui a navegação — mas a página de login carrega
      // normalmente, então seguimos. Só outros erros (rede, DNS) abortam de verdade.
      if (!String(erro).includes('ERR_ABORTED')) {
        logEvento('experience-oculta-falha-abrir', { erro: String(erro) });
        return SEM_SESSAO;
      }
    }

    const submeteu = await preencherESubmeterLogin(wc, segredo.usuario, segredo.senha);
    if (!submeteu) {
      // A partição é persistente: com a sessão ainda viva, a Experience abre logada e não
      // há tela de login — o token já está lá.
      const jaLogada = await capturarTokenDeWebContents(wc).catch(() => SEM_SESSAO);
      if (jaLogada.presente) return jaLogada;
      logEvento('experience-oculta-sem-tela-de-login');
      return SEM_SESSAO;
    }
    const sessao = await this.#esperarToken(wc);
    cofre.registrarLoginAutomatico('sankhya-experience', sessao.presente);
    return sessao;
  }

  #criarJanela(): void {
    this.destruir();
    this.#janela = criarJanelaOculta(PARTICAO_EXPERIENCE);
    logEvento('experience-oculta-janela-criada');
  }

  /** Espera o token aparecer no `localStorage` depois do login. */
  async #esperarToken(wc: WebContents): Promise<SessaoExperience> {
    const inicio = Date.now();
    while (Date.now() - inicio < LOGIN_TIMEOUT_MS) {
      if (wc.isDestroyed()) return SEM_SESSAO;
      const sessao = await capturarTokenDeWebContents(wc).catch(() => SEM_SESSAO);
      if (sessao.presente) {
        logEvento('experience-oculta-token-pronto', { expIso: sessao.expIso });
        return sessao;
      }
      await pausa(INTERVALO_MS);
    }
    logEvento('experience-oculta-token-timeout');
    return SEM_SESSAO;
  }
}
