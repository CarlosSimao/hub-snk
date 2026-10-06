/**
 * Camada em HTML por cima das guias, para o que o shell precisa mostrar na frente delas:
 * a lista de arquivos baixados (como a do navegador) e o aviso de "o HUB já está aberto".
 *
 * As guias são views que cobrem a janela abaixo da barra, então nada desenhado na barra
 * apareceria sobre elas. A camada é uma view própria, readicionada ao topo a cada uso.
 *
 * O download é salvo na pasta Downloads, sem diálogo — igual ao navegador. A página da
 * camada só enxerga id, nome, tamanho e estado: o caminho fica aqui, e abrir o arquivo é
 * sempre pelo id.
 */
import { existsSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { app, BrowserWindow, shell, WebContents, WebContentsView } from 'electron';
import { logEvento } from '../log';

type EstadoDoDownload = 'baixando' | 'concluido' | 'cancelado' | 'interrompido';

interface Download {
  id: number;
  nome: string;
  caminho: string;
  recebidos: number;
  total: number;
  estado: EstadoDoDownload;
  /** O arquivo foi apagado ou movido depois de baixado. */
  sumiu: boolean;
}

/** O que a barra e a camada recebem de cada download — sem o caminho. */
export interface DownloadVisivel {
  id: number;
  nome: string;
  recebidos: number;
  total: number;
  estado: EstadoDoDownload;
  sumiu: boolean;
}

const LIMITE_DA_LISTA = 30;
const FUNDO_TRANSPARENTE = '#00000000';
const LARGURA_DO_AVISO = 380;
const ALTURA_DO_AVISO = 96;
const MARGEM = 16;
const DURACAO_DO_AVISO_MS = 5_000;

/** `relatorio.pdf` que já existe vira `relatorio (1).pdf`: nunca sobrescreve. */
export function nomeLivre(pasta: string, nome: string, existe: (c: string) => boolean): string {
  const limpo = basename(nome) || 'download';
  const ext = extname(limpo);
  const base = limpo.slice(0, limpo.length - ext.length);
  let candidato = limpo;
  for (let n = 1; existe(join(pasta, candidato)); n++) candidato = `${base} (${n})${ext}`;
  return join(pasta, candidato);
}

export class CamadaDoHub {
  readonly #janela: BrowserWindow;
  readonly #downloads: Download[] = [];
  #proximoId = 1;
  #camada: WebContentsView | null = null;
  #modo: 'downloads' | 'aviso' | null = null;
  #ancora = { x: 0, y: 0 };
  #avisoAtual: { titulo: string; texto: string } | null = null;
  #temporizadorDoAviso: NodeJS.Timeout | null = null;
  #aoMudarDownloads: ((lista: DownloadVisivel[]) => void) | null = null;

  constructor(janela: BrowserWindow) {
    this.#janela = janela;
  }

  ehRemetente(remetente: WebContents): boolean {
    return remetente === this.#camada?.webContents;
  }

  aoMudarDownloads(cb: (lista: DownloadVisivel[]) => void): void {
    this.#aoMudarDownloads = cb;
  }

  listaDeDownloads(): DownloadVisivel[] {
    return this.#downloads.map(({ caminho: _caminho, ...visivel }) => visivel);
  }

  /** Chamado no `will-download` de qualquer sessão: define o destino e acompanha. */
  acompanhar(item: Electron.DownloadItem): void {
    const pasta = app.getPath('downloads');
    const caminho = nomeLivre(pasta, item.getFilename(), existsSync);
    item.setSavePath(caminho);
    const download: Download = {
      id: this.#proximoId++,
      nome: basename(caminho),
      caminho,
      recebidos: 0,
      total: item.getTotalBytes(),
      estado: 'baixando',
      sumiu: false,
    };
    this.#downloads.unshift(download);
    this.#downloads.length = Math.min(this.#downloads.length, LIMITE_DA_LISTA);
    item.on('updated', (_e, estado) => {
      download.recebidos = item.getReceivedBytes();
      download.total = item.getTotalBytes();
      if (estado === 'interrupted') download.estado = 'interrompido';
      this.#publicar();
    });
    item.once('done', (_e, estado) => {
      download.recebidos = item.getReceivedBytes();
      download.estado =
        estado === 'completed'
          ? 'concluido'
          : estado === 'cancelled'
            ? 'cancelado'
            : 'interrompido';
      this.#publicar();
    });
    this.#publicar();
  }

  /** Abre o arquivo no programa padrão; `false` se ele já não existe. */
  abrirDownload(id: number): boolean {
    const download = this.#downloads.find((d) => d.id === id);
    if (!download || download.estado !== 'concluido') return false;
    if (!existsSync(download.caminho)) {
      download.sumiu = true;
      this.#publicar();
      return false;
    }
    void shell.openPath(download.caminho).then((erro) => {
      if (erro) logEvento('download-abrir-falhou', { erro });
    });
    return true;
  }

  mostrarNaPasta(id: number): boolean {
    const download = this.#downloads.find((d) => d.id === id);
    if (!download) return false;
    if (!existsSync(download.caminho)) {
      download.sumiu = true;
      this.#publicar();
      return false;
    }
    shell.showItemInFolder(download.caminho);
    return true;
  }

  limparConcluidos(): void {
    for (let i = this.#downloads.length - 1; i >= 0; i--) {
      if (this.#downloads[i]!.estado !== 'baixando') this.#downloads.splice(i, 1);
    }
    this.#publicar();
    if (this.#downloads.length === 0) this.fechar();
  }

  abrirPainelDeDownloads(x: number, y: number): void {
    this.#cancelarAviso();
    this.#modo = 'downloads';
    this.#ancora = { x: Math.round(x), y: Math.round(y) };
    const [largura, altura] = this.#janela.getContentSize();
    this.#exibir({ x: 0, y: 0, width: largura, height: altura });
    this.#enviar();
  }

  /** Aviso de canto, sem pegar clique fora do cartão: a view só tem o tamanho dele. */
  mostrarAviso(titulo: string, texto: string): void {
    this.#cancelarAviso();
    this.#modo = 'aviso';
    this.#avisoAtual = { titulo, texto };
    const [largura] = this.#janela.getContentSize();
    this.#exibir({
      x: Math.max(0, largura - LARGURA_DO_AVISO - MARGEM),
      y: MARGEM + 40,
      width: LARGURA_DO_AVISO,
      height: ALTURA_DO_AVISO,
    });
    this.#enviar();
    this.#temporizadorDoAviso = setTimeout(() => this.fechar(), DURACAO_DO_AVISO_MS);
  }

  fechar(): void {
    this.#cancelarAviso();
    if (!this.#camada?.getVisible()) return;
    this.#camada.setVisible(false);
    this.#modo = null;
  }

  /** Janela redimensionada: o painel fecha; o aviso volta ao canto. */
  reposicionar(): void {
    if (this.#modo === 'downloads') this.fechar();
    else if (this.#modo === 'aviso' && this.#avisoAtual) {
      this.mostrarAviso(this.#avisoAtual.titulo, this.#avisoAtual.texto);
    }
  }

  #cancelarAviso(): void {
    if (this.#temporizadorDoAviso) clearTimeout(this.#temporizadorDoAviso);
    this.#temporizadorDoAviso = null;
  }

  #publicar(): void {
    this.#aoMudarDownloads?.(this.listaDeDownloads());
    if (this.#modo === 'downloads') this.#enviar();
  }

  #exibir(limites: Electron.Rectangle): void {
    const camada = this.#camada ?? this.#criarCamada();
    // Readicionar leva a camada para o topo, acima de guia ou painel abertos depois dela.
    this.#janela.contentView.addChildView(camada);
    camada.setBounds(limites);
    camada.setVisible(true);
    if (this.#modo === 'downloads') camada.webContents.focus();
  }

  #criarCamada(): WebContentsView {
    const camada = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, '..', 'preloads', 'preloadCamada.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    camada.setBackgroundColor(FUNDO_TRANSPARENTE);
    camada.webContents.on('will-navigate', (evento) => evento.preventDefault());
    camada.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    camada.webContents.on('did-finish-load', () => this.#enviar());
    camada.webContents.loadFile(join(__dirname, '..', '..', 'telas', 'camada.html'));
    this.#camada = camada;
    return camada;
  }

  #enviar(): void {
    const camada = this.#camada;
    if (!camada || camada.webContents.isLoading() || !this.#modo) return;
    camada.webContents.send('camada:mostrar', {
      modo: this.#modo,
      downloads: this.listaDeDownloads(),
      aviso: this.#avisoAtual,
      ...this.#ancora,
    });
  }
}
