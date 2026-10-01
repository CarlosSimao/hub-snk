/**
 * Notificações do próprio HUB SNK (lembrete, agenda sem tarefa, falha da consulta) fora
 * do Painel: aviso do Windows, como o das mensagens do WhatsApp, e o ícone piscando na
 * barra de tarefas.
 *
 * A fonte é o mesmo fluxo SSE que o Painel escuta. O shell assina com o token dele, como
 * em qualquer outra chamada ao backend — o Painel não tem ponte com o shell para avisar.
 */
import { Notification, type BrowserWindow } from 'electron';
import { HUB_URL, ICONE } from './config';
import { janelaEmUso } from './janelaEmUso';
import { logEvento } from './log';
import type { TabManager } from './tabs';
import { garantirToken } from './tokenStore';

const URL_DO_FLUXO = `${HUB_URL}/api/notificacoes/fluxo`;

/** Backend subindo ou reiniciando: tenta de novo sem martelar a porta. */
const ESPERA_PARA_RECONECTAR_MS = 5_000;

const EVENTO_DE_NOTIFICACAO = 'notificacao';

/** O que o Painel (public/app.js) escuta para abrir o painel do sino. */
const EVENTO_ABRIR_NOTIFICACOES = 'hub-snk:abrir-notificacoes';

/**
 * Lembrete gravado antes de existir o resumo: o título é esse texto fixo, e o Painel sobe
 * a mensagem para o destaque — o aviso do Windows faz o mesmo (ver `public/app.js`).
 */
const TITULO_DO_LEMBRETE_SEM_RESUMO = 'Lembrete';

/** O pedaço da notificação do backend (`src/tipos.ts`) que o aviso mostra. */
interface NotificacaoDoHub {
  origem: string;
  titulo: string;
  mensagem: string;
}

function tituloECorpo(notificacao: NotificacaoDoHub): { titulo: string; corpo: string } {
  const semResumo =
    notificacao.origem === 'lembrete' && notificacao.titulo === TITULO_DO_LEMBRETE_SEM_RESUMO;
  return semResumo
    ? { titulo: notificacao.mensagem, corpo: '' }
    : { titulo: notificacao.titulo, corpo: notificacao.mensagem };
}

/** Um bloco SSE (`event:`/`data:`); o batimento é comentário e não tem evento. */
function notificacaoDoBloco(bloco: string): NotificacaoDoHub | null {
  const linhas = bloco.split('\n');
  const evento = linhas.find((linha) => linha.startsWith('event:'))?.slice('event:'.length);
  if (evento?.trim() !== EVENTO_DE_NOTIFICACAO) return null;
  const dados = linhas
    .filter((linha) => linha.startsWith('data:'))
    .map((linha) => linha.slice('data:'.length).trimStart())
    .join('\n');
  return JSON.parse(dados) as NotificacaoDoHub;
}

export class AvisosDoHub {
  readonly #janela: BrowserWindow;
  readonly #tabs: TabManager;
  /**
   * Referência forte aos avisos na tela: sem ela o coletor de lixo pode levar o objeto e,
   * com ele, o clique que abre o sino.
   */
  readonly #notificacoes = new Set<Notification>();
  /** Só a troca de estado vai para o log: o backend fora do ar repetiria a cada 5 s. */
  #conectado = false;

  constructor(janela: BrowserWindow, tabs: TabManager) {
    this.#janela = janela;
    this.#tabs = tabs;
  }

  iniciar(): void {
    void this.#assinar();
  }

  async #assinar(): Promise<void> {
    try {
      await this.#lerFluxo();
    } catch (erro) {
      if (this.#conectado) logEvento('avisos-do-hub-fluxo-caiu', { erro: String(erro) });
    }
    this.#conectado = false;
    setTimeout(() => void this.#assinar(), ESPERA_PARA_RECONECTAR_MS);
  }

  async #lerFluxo(): Promise<void> {
    const resposta = await fetch(URL_DO_FLUXO, {
      headers: { 'x-hub-token': garantirToken(), accept: 'text/event-stream' },
    });
    if (!resposta.ok || !resposta.body) throw new Error(`HTTP ${resposta.status}`);
    this.#conectado = true;
    logEvento('avisos-do-hub-fluxo-conectado');

    const decodificador = new TextDecoder();
    let pendente = '';
    for await (const pedaco of resposta.body) {
      pendente += decodificador.decode(pedaco, { stream: true });
      const blocos = pendente.split('\n\n');
      pendente = blocos.pop() ?? '';
      for (const bloco of blocos) this.#tratarBloco(bloco);
    }
  }

  #tratarBloco(bloco: string): void {
    let notificacao: NotificacaoDoHub | null;
    try {
      notificacao = notificacaoDoBloco(bloco);
    } catch (erro) {
      logEvento('avisos-do-hub-evento-invalido', { erro: String(erro) });
      return;
    }
    if (notificacao) this.#avisar(notificacao);
  }

  /** O aviso sai sempre: o Painel não tem mais cartão próprio, só o som e o sino. */
  #avisar(notificacao: NotificacaoDoHub): void {
    this.#mostrarNotificacao(notificacao);
    // O Windows pisca o ícone até a janela ganhar foco: quem para é o `focus` da janela.
    if (!janelaEmUso(this.#janela)) this.#janela.flashFrame(true);
  }

  /** Sem som: o Painel toca o dele ao receber, e os dois juntos soariam como dois avisos. */
  #mostrarNotificacao(notificacao: NotificacaoDoHub): void {
    if (!Notification.isSupported()) return;
    const { titulo, corpo } = tituloECorpo(notificacao);
    const aviso = new Notification({ title: titulo, body: corpo, icon: ICONE, silent: true });
    this.#notificacoes.add(aviso);
    aviso.on('click', () => {
      this.#notificacoes.delete(aviso);
      this.#abrirNotificacoesNoPainel();
    });
    aviso.on('close', () => this.#notificacoes.delete(aviso));
    aviso.show();
    logEvento('avisos-do-hub-notificacao-mostrada', { origem: notificacao.origem });
  }

  #abrirNotificacoesNoPainel(): void {
    if (this.#janela.isMinimized()) this.#janela.restore();
    this.#janela.show();
    this.#janela.focus();
    if (!this.#tabs.mostrar('hub')) return;
    const script = `window.dispatchEvent(new CustomEvent(${JSON.stringify(EVENTO_ABRIR_NOTIFICACOES)}))`;
    this.#tabs
      .aba('hub')
      ?.webContents.executeJavaScript(script)
      .catch((erro: unknown) => {
        logEvento('avisos-do-hub-abrir-sino-falhou', { erro: String(erro) });
      });
  }
}
