/**
 * Menu do aplicativo.
 *
 * Substitui o menu padrão do Electron (File/Edit/View/Window, em inglês e cheio de itens
 * que não significam nada aqui) por um menu que fala das guias do hub.
 */
import { Menu, app, type BrowserWindow, type MenuItem } from 'electron';
import type { SituacaoDoAtalhoGlobal } from './atalhoGlobal';
import { abrirJanelaDeAtalhos } from './janelaDeAtalhos';
import { alternarRuffle, ruffleLigado } from './ruffle';
import {
  alternarAtualizacaoAutomatica,
  atualizacaoAutomaticaLigada,
  reiniciarParaAtualizar,
  versaoProntaParaInstalar,
} from './atualizacao';
import type { TabManager } from './tabs';

/** O que o menu aciona fora dele: as duas buscas e o estado do atalho global. */
export interface AcoesDoMenu {
  abrirBuscaRapida(): void;
  buscarNaPagina(): void;
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
  const versaoPronta = versaoProntaParaInstalar();
  const menu = Menu.buildFromTemplate([
    {
      label: 'Hub',
      submenu: [
        {
          label: 'Recarregar a guia atual',
          accelerator: 'CmdOrCtrl+R',
          click: () => tabs()?.recarregar(),
        },
        {
          label: 'Recarregar sem cache',
          accelerator: 'CmdOrCtrl+F5',
          click: () => tabs()?.recarregarSemCache(),
        },
        // Segunda tecla do mesmo comando, como no Chrome: o Electron aceita uma só por item,
        // e o item invisível continua respondendo ao atalho no Windows.
        {
          label: 'Recarregar sem cache',
          accelerator: 'CmdOrCtrl+Shift+R',
          visible: false,
          click: () => tabs()?.recarregarSemCache(),
        },
        // No menu, e não só no painel: dentro da guia do SankhyaOm ou de uma base, o
        // Ctrl+K nunca chegaria à página do painel.
        {
          label: 'Busca rápida',
          accelerator: 'CmdOrCtrl+K',
          click: () => acoes.abrirBuscaRapida(),
        },
        // Pelo menu, como o Ctrl+K: com o foco na Experience, a tecla nunca sairia da página.
        {
          label: 'Buscar na página',
          accelerator: 'CmdOrCtrl+F',
          click: () => acoes.buscarNaPagina(),
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
          click: () => tabs()?.mostrar('hub'),
        },
        // Com o acesso de terceiro, as duas guias nem existem para o usuário.
        {
          label: 'Ir para o SankhyaOm',
          visible: !guiaBloqueada('erp'),
          click: () => tabs()?.mostrar('erp'),
        },
        {
          label: 'Ir para a Experience',
          visible: !guiaBloqueada('experience'),
          click: () => tabs()?.mostrar('experience'),
        },
        {
          label: 'Nova guia',
          accelerator: 'CmdOrCtrl+T',
          click: () => tabs()?.abrirAbaAvulsa(),
        },
        // Só agem na guia avulsa: o resto das guias ignora.
        { label: 'Voltar', accelerator: 'Alt+Left', click: () => tabs()?.voltar() },
        { label: 'Avançar', accelerator: 'Alt+Right', click: () => tabs()?.avancar() },
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
        { type: 'separator' },
        {
          label: `Reiniciar para atualizar para a versão ${versaoPronta ?? ''}`,
          visible: versaoPronta !== null,
          click: () => reiniciarParaAtualizar(),
        },
        {
          label: 'Atualizar automaticamente',
          type: 'checkbox',
          checked: atualizacaoAutomaticaLigada(),
          click: () => alternarAtualizacaoAutomatica(),
        },
        { label: `Versão ${app.getVersion()}`, enabled: false },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
  // O menu nativo nao e' reativo: abrir ou fechar uma aba exige reconstruir a lista.
  gerenciador?.aoMudarGuias(() => montarMenu(janela, tabs, acoes));
}

/** Clique direito numa guia: age nela, mesmo que não seja a que está na tela. */
export function menuDaGuia(tabs: () => TabManager | null, id: string): Menu {
  return Menu.buildFromTemplate([
    { label: 'Recarregar', click: () => tabs()?.recarregar(id) },
    { label: 'Recarregar sem cache', click: () => tabs()?.recarregarSemCache(id) },
  ]);
}
