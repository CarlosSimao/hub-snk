/**
 * Menu do aplicativo.
 *
 * Substitui o menu padrão do Electron (File/Edit/View/Window, em inglês e cheio de itens
 * que não significam nada aqui) por um menu que fala das guias do hub.
 *
 * O item que motivou o menu é o último: a página que as skills usam para navegar no
 * Sankhya nasce OCULTA, e quando o login expira alguém precisa vê-la para digitar a
 * senha. Sem um lugar para trazê-la à tela, a skill pedia "faça login na aba" e não havia
 * aba nenhuma para clicar.
 */
import { Menu, app, shell, type BrowserWindow, type MenuItem } from 'electron';
import { HUB_URL } from './config';
import * as navegacaoSkill from './navegacaoSkill';
import type { TabManager } from './tabs';
import { definirRuffleAtivo, ruffleAtivo } from './ruffle';

export function montarMenu(janela: () => BrowserWindow | null, tabs: () => TabManager | null): void {
  const gerenciador = tabs();
  const guias = gerenciador?.guiasAbertas() ?? [];
  const menu = Menu.buildFromTemplate([
    {
      label: 'Hub',
      submenu: [
        {
          label: 'Recarregar a guia atual',
          accelerator: 'CmdOrCtrl+R',
          click: () => tabs()?.recarregar(''),
        },
        { type: 'separator' },
        {
          // Vale para as telas abertas depois do clique: a que já está aberta mantém o
          // estado que tinha — recarregar a guia aplica na hora.
          label: 'Ruffle (Flash) nas telas do Sankhya',
          type: 'checkbox',
          checked: ruffleAtivo(),
          click: (item: MenuItem) => definirRuffleAtivo(item.checked),
        },
        { type: 'separator' },
        { label: 'Sair', role: 'quit' },
      ],
    },
    {
      label: 'Guias',
      submenu: [
        { label: 'Ir para o Painel', accelerator: 'CmdOrCtrl+1', click: () => tabs()?.mostrar('hub') },
        { label: 'Ir para o Sankhya Om', accelerator: 'CmdOrCtrl+2', click: () => tabs()?.mostrar('erp') },
        { label: 'Ir para a Experience', accelerator: 'CmdOrCtrl+3', click: () => tabs()?.mostrar('experience') },
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
            if (!alterou) montarMenu(janela, tabs);
          },
        })),
      ],
    },
    {
      label: 'Skills',
      submenu: [
        {
          // O caso do login: a skill avisa que precisa de sessão, e é por aqui que a
          // página aparece para digitar usuário e senha.
          label: 'Mostrar a página de navegação das skills',
          click: () => navegacaoSkill.exibir(),
        },
        {
          label: 'Ocultar a página de navegação das skills',
          click: () => navegacaoSkill.esconder(),
        },
        { type: 'separator' },
        {
          label: 'Fechar a página de navegação das skills',
          click: () => navegacaoSkill.fechar(),
        },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { label: 'Minimizar', role: 'minimize' },
        { label: 'Tela cheia', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: 'Ferramentas de desenvolvedor',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => janela()?.webContents.toggleDevTools(),
        },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        { label: 'Abrir o painel no navegador', click: () => void shell.openExternal(HUB_URL) },
        { label: `Versão ${app.getVersion()}`, enabled: false },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
  // O menu nativo nao e' reativo: abrir ou fechar uma aba exige reconstruir a lista.
  gerenciador?.aoMudarGuias(() => montarMenu(janela, tabs));
}
