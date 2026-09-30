/**
 * Menu do aplicativo.
 *
 * Substitui o menu padrão do Electron (File/Edit/View/Window, em inglês e cheio de itens
 * que não significam nada aqui) por um menu que fala das guias do hub.
 */
import { Menu, app, shell, type BrowserWindow, type MenuItem } from 'electron';
import { HUB_URL } from './config';
import type { SituacaoDoAtalhoGlobal } from './atalhoGlobal';
import { abrirJanelaDeAtalhos } from './janelaDeAtalhos';
import { alternarRuffle, ruffleLigado } from './ruffle';
import type { TabManager } from './tabs';

/** O que o menu aciona fora dele: a busca rápida e o estado do atalho global. */
export interface AcoesDoMenu {
  abrirBuscaRapida(): void;
  situacaoDoAtalhoGlobal(): SituacaoDoAtalhoGlobal;
}

export function montarMenu(
  janela: () => BrowserWindow | null,
  tabs: () => TabManager | null,
  acoes: AcoesDoMenu,
): void {
  const gerenciador = tabs();
  const guiaBloqueada = (id: string): boolean => gerenciador?.guiaBloqueada(id) ?? false;
  const guias = (gerenciador?.guiasAbertas() ?? []).filter((guia) => !guiaBloqueada(guia.id));
  const menu = Menu.buildFromTemplate([
    {
      label: 'Hub',
      submenu: [
        {
          label: 'Recarregar a guia atual',
          accelerator: 'CmdOrCtrl+R',
          click: () => tabs()?.recarregar(),
        },
        // No menu, e não só no painel: dentro da guia do SankhyaOm ou de uma base, o
        // Ctrl+K nunca chegaria à página do painel.
        {
          label: 'Busca rápida',
          accelerator: 'CmdOrCtrl+K',
          click: () => acoes.abrirBuscaRapida(),
        },
        { type: 'separator' },
        // Vale para as telas abertas depois: a tela Flex já aberta segue como está até
        // recarregar a guia.
        {
          label: 'Compatibilidade com Flash (Ruffle)',
          type: 'checkbox',
          checked: ruffleLigado(),
          click: () => alternarRuffle(),
        },
        { type: 'separator' },
        { label: 'Sair', role: 'quit' },
      ],
    },
    {
      label: 'Guias',
      submenu: [
        {
          label: 'Ir para o Painel',
          accelerator: 'CmdOrCtrl+1',
          click: () => tabs()?.mostrar('hub'),
        },
        // Com o acesso de terceiro, as duas guias nem existem para o usuário.
        {
          label: 'Ir para o SankhyaOm',
          accelerator: 'CmdOrCtrl+2',
          visible: !guiaBloqueada('erp'),
          click: () => tabs()?.mostrar('erp'),
        },
        {
          label: 'Ir para a Experience',
          accelerator: 'CmdOrCtrl+3',
          visible: !guiaBloqueada('experience'),
          click: () => tabs()?.mostrar('experience'),
        },
        { type: 'separator' },
        { label: 'Mostrar na barra', enabled: false },
        // Uma caixa por guia: marcada = aparece na barra. Esconder nao fecha nem
        // recarrega — a guia continua viva, so' sai de vista.
        ...guias.map((guia) => ({
          label: guia.rotulo,
          type: 'checkbox' as const,
          checked: guia.visivel,
          click: (itemMenu: MenuItem) => {
            const gerenciador = tabs();
            if (!gerenciador) return;
            // O estado real da caixa e' a fonte da visibilidade. Inclusive a ultima
            // guia pode ser ocultada: a view continua carregada em segundo plano.
            const alterou = gerenciador.definirGuiaVisivel(guia.id, itemMenu.checked);
            if (!alterou) montarMenu(janela, tabs, acoes);
          },
        })),
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Tela cheia', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Ferramentas de desenvolvedor da guia atual',
          accelerator: 'F12',
          click: () => tabs()?.alternarFerramentasDesenvolvedor(),
        },
        {
          label: 'Ferramentas de desenvolvedor da barra superior',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => janela()?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Atalhos',
          click: () => {
            const principal = janela();
            if (principal) abrirJanelaDeAtalhos(principal, acoes.situacaoDoAtalhoGlobal());
          },
        },
        { label: 'Abrir o painel no navegador', click: () => void shell.openExternal(HUB_URL) },
        { label: `Versão ${app.getVersion()}`, enabled: false },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
  // O menu nativo nao e' reativo: abrir ou fechar uma aba exige reconstruir a lista.
  gerenciador?.aoMudarGuias(() => montarMenu(janela, tabs, acoes));
}
