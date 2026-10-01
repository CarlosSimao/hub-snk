/**
 * Barra do Ctrl+F: busca de texto na guia ativa, como a do Chrome.
 *
 * O Electron só traz a API (`findInPage`), não a barra. Ela é uma camada própria no canto
 * superior direito da guia, e não um campo dentro da página: a Experience e o SankhyaOm
 * são páginas de terceiros, e a busca precisa funcionar em qualquer uma delas.
 */
import { join } from 'node:path';
import { BrowserWindow, WebContents, WebContentsView, type Result } from 'electron';

/** Tamanho da camada: o cartão da barra mais a folga da sombra em volta. */
const LARGURA = 400;
const ALTURA = 64;
/** Distância entre a camada e a borda direita da guia, como no Chrome. */
const MARGEM_DA_GUIA = 12;
/** Transparente: só o cartão aparece; a folga da sombra não cobre a página. */
const FUNDO_TRANSPARENTE = '#00000000';
/** Teto do texto buscado: o campo é digitado, nada legítimo chega perto disto. */
const TAMANHO_MAXIMO_DO_TEXTO = 500;

type ObterGuiaAtiva = () => WebContentsView | undefined;

export class BarraDeBusca {
  readonly #janela: BrowserWindow;
  readonly #obterGuiaAtiva: ObterGuiaAtiva;
  #camada: WebContentsView | null = null;
  #alvo: WebContents | null = null;
  /** Texto da busca em andamento: o mesmo texto de novo é "próxima", outro é busca nova. */
  #textoAtual = '';
  readonly #aoEncontrar = (_evento: Electron.Event, resultado: Result): void => {
    this.#camada?.webContents.send('barraDeBusca:resultado', {
      atual: resultado.activeMatchOrdinal,
      total: resultado.matches,
    });
  };

  constructor(janela: BrowserWindow, obterGuiaAtiva: ObterGuiaAtiva) {
    this.#janela = janela;
    this.#obterGuiaAtiva = obterGuiaAtiva;
  }

  /** Só a página da barra pode buscar ou fechá-la — o `main.ts` confere com isto. */
  ehRemetente(remetente: WebContents): boolean {
    return remetente === this.#camada?.webContents;
  }

  abrir(): void {
    const guia = this.#obterGuiaAtiva();
    if (!guia) return;
    this.#trocarAlvo(guia.webContents);
    const camada = this.#camada ?? this.#criarCamada();
    // Readicionar leva a camada para o topo, acima de guia ou painel abertos depois dela.
    this.#janela.contentView.addChildView(camada);
    this.#posicionar(camada, guia);
    camada.setVisible(true);
    camada.webContents.focus();
    // Na primeira abertura a página ainda está carregando: quem avisa é o `did-finish-load`.
    if (!camada.webContents.isLoading()) camada.webContents.send('barraDeBusca:abrir');
  }

  fechar(): void {
    if (!this.#camada?.getVisible()) return;
    this.#camada.setVisible(false);
    this.#encerrarBusca();
    this.#alvo?.focus();
  }

  /** Texto vazio limpa o destaque; o mesmo texto de antes avança para a próxima ocorrência. */
  buscar(texto: unknown, paraTras: unknown): boolean {
    if (typeof texto !== 'string' || texto.length > TAMANHO_MAXIMO_DO_TEXTO) return false;
    if (!this.#alvo || this.#alvo.isDestroyed()) return false;

    if (!texto) {
      this.#encerrarBusca();
      this.#camada?.webContents.send('barraDeBusca:resultado', { atual: 0, total: 0 });
      return true;
    }
    const buscaNova = texto !== this.#textoAtual;
    this.#textoAtual = texto;
    this.#alvo.findInPage(texto, { forward: paraTras !== true, findNext: buscaNova });
    return true;
  }

  /** A guia mudou de tamanho: a barra acompanha o canto dela. */
  reposicionar(): void {
    const guia = this.#obterGuiaAtiva();
    if (!this.#camada?.getVisible() || !guia) return;
    this.#posicionar(this.#camada, guia);
  }

  #posicionar(camada: WebContentsView, guia: WebContentsView): void {
    const area = guia.getBounds();
    camada.setBounds({
      x: Math.max(area.x, area.x + area.width - LARGURA - MARGEM_DA_GUIA),
      y: area.y,
      width: Math.min(LARGURA, area.width),
      height: ALTURA,
    });
  }

  /** Busca aberta numa guia e Ctrl+F em outra: a primeira perde o destaque e o ouvinte. */
  #trocarAlvo(alvo: WebContents): void {
    if (alvo === this.#alvo) return;
    this.#encerrarBusca();
    this.#alvo?.removeListener('found-in-page', this.#aoEncontrar);
    this.#alvo = alvo;
    alvo.on('found-in-page', this.#aoEncontrar);
  }

  /** `keepSelection`, como o Chrome: a ocorrência atual fica selecionada ao fechar. */
  #encerrarBusca(): void {
    this.#textoAtual = '';
    if (this.#alvo && !this.#alvo.isDestroyed()) this.#alvo.stopFindInPage('keepSelection');
  }

  #criarCamada(): WebContentsView {
    const camada = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '..', 'preloads', 'preloadBarraDeBusca.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    camada.setBackgroundColor(FUNDO_TRANSPARENTE);
    // Página local com preload: navegar para fora entregaria a ponte a outra página.
    camada.webContents.on('will-navigate', (evento) => evento.preventDefault());
    camada.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    camada.webContents.on('did-finish-load', () => camada.webContents.send('barraDeBusca:abrir'));
    camada.webContents.loadFile(join(__dirname, '..', '..', 'telas', 'barraDeBusca.html'));
    this.#camada = camada;
    return camada;
  }
}
