/**
 * Menu em HTML por cima da janela inteira — guias, painel de comunicação e tudo.
 *
 * O menu nativo fecha a cada clique, e esconder várias guias exigia reabri-lo uma vez por
 * guia. Aqui marcar uma caixa não fecha: o item é executado e a lista é redesenhada com o
 * estado novo. Ação comum (Recarregar, Sair) fecha, como num menu qualquer.
 *
 * Os itens vêm de um `Menu` nativo, que continua sendo a única definição do que existe:
 * o menu do aplicativo segue registrado por causa dos atalhos de teclado.
 */
import { join } from 'node:path';
import { BrowserWindow, Menu, MenuItem, WebContents, WebContentsView } from 'electron';
import { logEvento } from './log';

/** Item como a página do menu o desenha: só dados, a função fica no `MenuItem`. */
interface ItemDoMenu {
  /** Caminho de índices no menu nativo (`"1.4"`), para achar o item de volta no clique. */
  id: string;
  tipo: 'titulo' | 'nota' | 'acao' | 'caixa';
  rotulo: string;
  marcado: boolean;
  atalho: string;
}

type ObterMenu = () => Menu | null;

/** Transparente: só o cartão do menu aparece, e o resto da camada é "clique fora". */
const FUNDO_TRANSPARENTE = '#00000000';

/** `CmdOrCtrl+1` → `Ctrl+1`: o shell só é distribuído para Windows e Linux. */
function atalhoLegivel(acelerador: string | null | undefined): string {
  return (acelerador ?? '').replace(/^(CmdOrCtrl|CommandOrControl)\+/, 'Ctrl+');
}

function tipoDoItem(item: MenuItem): ItemDoMenu['tipo'] {
  if (item.type === 'checkbox') return 'caixa';
  return item.enabled ? 'acao' : 'nota';
}

/** Submenu vira seção com título: o menu flutuante é uma lista só, sem cascata. */
function itensDoMenu(menu: Menu, prefixo = ''): ItemDoMenu[] {
  return menu.items.flatMap((item, indice): ItemDoMenu[] => {
    if (!item.visible || item.type === 'separator') return [];
    const id = prefixo ? `${prefixo}.${indice}` : String(indice);
    if (item.submenu) {
      const titulo: ItemDoMenu = {
        id,
        tipo: 'titulo',
        rotulo: item.label,
        marcado: false,
        atalho: '',
      };
      return [titulo, ...itensDoMenu(item.submenu, id)];
    }
    return [
      {
        id,
        tipo: tipoDoItem(item),
        rotulo: item.label,
        marcado: item.checked,
        atalho: atalhoLegivel(item.accelerator),
      },
    ];
  });
}

function localizarItem(menu: Menu, id: string): MenuItem | undefined {
  let itens = menu.items;
  let encontrado: MenuItem | undefined;
  for (const indice of id.split('.').map(Number)) {
    encontrado = itens[indice];
    if (!encontrado) return undefined;
    itens = encontrado.submenu?.items ?? [];
  }
  return encontrado;
}

export class MenuFlutuante {
  readonly #janela: BrowserWindow;
  #camada: WebContentsView | null = null;
  #obterMenu: ObterMenu | null = null;
  #posicao = { x: 0, y: 0 };

  constructor(janela: BrowserWindow) {
    this.#janela = janela;
  }

  /** Só a página do menu pode escolher item ou fechá-lo — o `main.ts` confere com isto. */
  ehRemetente(remetente: WebContents): boolean {
    return remetente === this.#camada?.webContents;
  }

  /**
   * `obterMenu` é chamado de novo a cada caixa marcada: o menu do aplicativo é
   * reconstruído quando uma guia muda, então o objeto de antes já não vale.
   */
  abrir(obterMenu: ObterMenu, x: number, y: number): void {
    this.#obterMenu = obterMenu;
    this.#posicao = { x: Math.round(x), y: Math.round(y) };
    const camada = this.#camada ?? this.#criarCamada();
    const [largura, altura] = this.#janela.getContentSize();
    // Readicionar leva a camada para o topo, acima de guia ou painel abertos depois dela.
    this.#janela.contentView.addChildView(camada);
    camada.setBounds({ x: 0, y: 0, width: largura, height: altura });
    camada.setVisible(true);
    camada.webContents.focus();
    // Na primeira abertura a página ainda está carregando: quem envia é o
    // `did-finish-load`, senão a mensagem chegaria antes de alguém a escutar.
    if (!camada.webContents.isLoading()) this.#enviarItens();
  }

  fechar(): void {
    if (!this.#camada?.getVisible()) return;
    this.#camada.setVisible(false);
    this.#obterMenu = null;
  }

  /** Caixa de marcar mantém o menu aberto; o resto fecha antes de executar. */
  escolher(id: string): boolean {
    const menu = this.#obterMenu?.();
    const item = menu ? localizarItem(menu, id) : undefined;
    if (!item || !item.enabled || item.submenu) return false;
    const manterAberto = item.type === 'checkbox';
    if (!manterAberto) this.fechar();
    // Chamar `click` também vira o `checked` e executa o `role` (Sair, Minimizar...),
    // exatamente como o clique no menu nativo.
    item.click({}, this.#janela, this.#janela.webContents);
    logEvento('menu-item-escolhido', { rotulo: item.label });
    if (manterAberto) this.#enviarItens();
    return true;
  }

  #criarCamada(): WebContentsView {
    const camada = new WebContentsView({
      webPreferences: {
        preload: join(__dirname, 'preloadMenu.js'),
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
    camada.webContents.on('did-finish-load', () => this.#enviarItens());
    camada.webContents.loadFile(join(__dirname, '..', 'menu.html'));
    this.#camada = camada;
    return camada;
  }

  #enviarItens(): void {
    const menu = this.#obterMenu?.();
    const camada = this.#camada;
    if (!menu || !camada) return;
    camada.webContents.send('menuFlutuante:mostrar', {
      itens: itensDoMenu(menu),
      ...this.#posicao,
    });
  }
}
