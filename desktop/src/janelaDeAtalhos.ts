/**
 * Janela com os atalhos de teclado do HUB SNK (Ajuda › Atalhos).
 *
 * A lista sai do menu do aplicativo — a mesma fonte do menu flutuante —, então uma tecla
 * nova no menu aparece aqui sem mudar mais nada. O que não está no menu (o atalho global e
 * as teclas da busca rápida no painel) entra fixo.
 */
import { join } from 'node:path';
import { BrowserWindow, Menu } from 'electron';
import type { SituacaoDoAtalhoGlobal } from './atalhoGlobal';
import { ATALHO_GLOBAL_DA_BUSCA } from './buscaRapida';
import { ICONE } from './config';
import { atalhoLegivel } from './menuFlutuante';

interface Atalho {
  teclas: string;
  descricao: string;
}

interface SecaoDeAtalhos {
  titulo: string;
  atalhos: Atalho[];
}

/** O mesmo fundo do cartão da página: sem ele a janela pisca branca antes de desenhar. */
const COR_DE_FUNDO = '#1b1f27';
/* Cabe a lista inteira sem rolagem, com as descrições longas numa linha só. */
const LARGURA = 520;
const ALTURA = 840;

const AVISOS_DO_ATALHO_GLOBAL: Record<SituacaoDoAtalhoGlobal, string> = {
  ativo: '',
  desligado: ' (desligado na bandeja)',
  recusado: ' (em uso por outro programa)',
};

function secaoDoAtalhoGlobal(situacao: SituacaoDoAtalhoGlobal): SecaoDeAtalhos {
  return {
    titulo: 'Em qualquer programa',
    atalhos: [
      {
        teclas: atalhoLegivel(ATALHO_GLOBAL_DA_BUSCA),
        descricao: `Trazer o HUB SNK com a busca rápida aberta${AVISOS_DO_ATALHO_GLOBAL[situacao]}`,
      },
    ],
  };
}

const SECAO_DA_BUSCA_RAPIDA: SecaoDeAtalhos = {
  titulo: 'Na busca rápida',
  atalhos: [
    { teclas: '↑ / ↓', descricao: 'Escolher o resultado' },
    { teclas: 'Enter', descricao: 'Abrir o item' },
    { teclas: 'Ctrl+Enter', descricao: 'Abrir o cliente do item no painel' },
    { teclas: 'Esc', descricao: 'Fechar a busca' },
  ],
};

const SECAO_DA_BUSCA_NA_PAGINA: SecaoDeAtalhos = {
  titulo: 'Na busca na página',
  atalhos: [
    { teclas: 'Enter', descricao: 'Próxima ocorrência' },
    { teclas: 'Shift+Enter', descricao: 'Ocorrência anterior' },
    { teclas: 'Esc', descricao: 'Fechar a busca' },
  ],
};

/** Cada submenu vira uma seção, só com os itens visíveis que têm tecla. */
function secoesDoMenu(menu: Menu): SecaoDeAtalhos[] {
  return menu.items
    .filter((item) => item.visible && item.submenu)
    .map((item) => ({
      titulo: item.label,
      atalhos: (item.submenu?.items ?? [])
        .filter((subitem) => subitem.visible && subitem.accelerator)
        .map((subitem) => ({
          teclas: atalhoLegivel(subitem.accelerator),
          descricao: subitem.label,
        })),
    }))
    .filter((secao) => secao.atalhos.length > 0);
}

let janelaAberta: BrowserWindow | null = null;

export function abrirJanelaDeAtalhos(
  pai: BrowserWindow,
  situacaoDoAtalhoGlobal: SituacaoDoAtalhoGlobal,
): void {
  if (janelaAberta && !janelaAberta.isDestroyed()) {
    janelaAberta.focus();
    return;
  }

  const menu = Menu.getApplicationMenu();
  const secoes = [
    ...(menu ? secoesDoMenu(menu) : []),
    secaoDoAtalhoGlobal(situacaoDoAtalhoGlobal),
    SECAO_DA_BUSCA_RAPIDA,
    SECAO_DA_BUSCA_NA_PAGINA,
  ];

  const janela = new BrowserWindow({
    parent: pai,
    modal: true,
    width: LARGURA,
    height: ALTURA,
    // O tamanho é o da página: a barra de título do Windows fica por fora dele.
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Atalhos',
    icon: ICONE,
    backgroundColor: COR_DE_FUNDO,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  janela.setMenu(null);
  // Página local sem ponte nenhuma, mas navegar para fora dela não tem motivo de existir.
  janela.webContents.on('will-navigate', (evento) => evento.preventDefault());
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.once('ready-to-show', () => janela.show());
  janela.on('closed', () => {
    janelaAberta = null;
  });
  // A lista vai pela query: a página não precisa de preload para recebê-la.
  void janela.loadFile(join(__dirname, '..', 'atalhos.html'), {
    query: { secoes: JSON.stringify(secoes) },
  });
  janelaAberta = janela;
}
