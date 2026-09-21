/**
 * Navegação e captura de tela para as skills do Claude Code.
 *
 * É o que permite a skill de documento de entrega tirar as evidências **dentro do hub**,
 * com a sessão que já está autenticada no ERP, em vez de subir um navegador à parte e
 * pedir login de novo.
 *
 * ## Por que uma janela oculta, e não mais uma aba
 *
 * A primeira versão criava uma aba na janela principal. A captura saía com **zero
 * bytes**: uma `WebContentsView` sem posição na janela não tem superfície para pintar, e
 * `capturePage()` fotografa o que foi pintado. Dar posição a ela significaria colocá-la
 * na frente do que a pessoa está usando.
 *
 * Uma `BrowserWindow` com `show: false` resolve os dois lados: renderiza (o Electron
 * pinta janela oculta por padrão) e não aparece na tela nem rouba foco. Ela nasce na
 * MESMA partição das abas de cima, então a sessão do Sankhya vem junto — que é a razão
 * de a captura passar pelo hub.
 *
 * Quem chama não é a skill diretamente: é o servidor MCP do hub (`src/mcpNavegador.ts`),
 * que fala com este arquivo pelo bridge em 127.0.0.1. Nada aqui decide o que capturar; a
 * skill conduz, este arquivo executa e devolve o caminho do PNG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { BrowserWindow, app } from 'electron';
import { PARTICAO } from './config';
import { logEvento } from './log';
import type { TabId, TabManager } from './tabs';

/**
 * Tamanho da janela de captura.
 *
 * Fixo de propósito: a evidência precisa sair igual entre máquinas, e amarrar ao tamanho
 * da janela do usuário faria o mesmo teste gerar imagens diferentes em cada notebook.
 */
const LARGURA = 1440;
const ALTURA = 900;

let janela: BrowserWindow | null = null;

export class NavegacaoIndisponivelError extends Error {}

/** Onde as capturas caem quando a skill não informa caminho. */
function pastaPadrao(): string {
  return join(app.getPath('userData'), 'capturas');
}

function exigirJanela(): BrowserWindow {
  if (!janela || janela.isDestroyed()) {
    throw new NavegacaoIndisponivelError('nenhuma página aberta para a skill — use a ferramenta abrir primeiro');
  }
  return janela;
}

/** As abas do hub e a página de trabalho da skill, com o endereço de cada uma. */
export function listar(tabs: TabManager | null): { abas: { id: string; titulo: string; url: string }[] } {
  const abas: { id: string; titulo: string; url: string }[] = [];

  if (tabs) {
    for (const id of ['hub', 'erp', 'experience'] as TabId[]) {
      const view = tabs.aba(id);
      if (!view) continue;
      abas.push({ id, titulo: view.webContents.getTitle(), url: view.webContents.getURL() });
    }
  }

  if (janela && !janela.isDestroyed()) {
    abas.push({ id: 'evidencias', titulo: janela.webContents.getTitle(), url: janela.webContents.getURL() });
  }

  return { abas };
}

/** Abre a URL na página de trabalho da skill, criando a janela oculta se necessário. */
export async function abrir(_tabs: TabManager | null, url: string): Promise<{ id: string; url: string }> {
  if (!/^https?:\/\//i.test(url)) throw new NavegacaoIndisponivelError(`URL inválida: ${url}`);

  if (!janela || janela.isDestroyed()) {
    janela = new BrowserWindow({
      show: false,
      width: LARGURA,
      height: ALTURA,
      webPreferences: {
        partition: PARTICAO,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        // Sem isto o Chromium reduz o ritmo de pintura da janela oculta, e a captura
        // pode sair com o quadro anterior.
        backgroundThrottling: false,
      },
    });
    janela.on('closed', () => {
      janela = null;
    });
    logEvento('skill-janela-evidencias-criada', {});
  }

  await janela.webContents.loadURL(url);
  await esperarCarregar(janela.webContents);
  return { id: 'evidencias', url: janela.webContents.getURL() };
}

export async function navegar(tabs: TabManager | null, _id: string, url: string): Promise<{ url: string }> {
  const { url: destino } = await abrir(tabs, url);
  return { url: destino };
}

/**
 * Captura a página e grava PNG.
 *
 * `capturePage()` fotografa o CONTEÚDO, e não a tela: funciona com a janela oculta e sem
 * roubar o foco de quem está trabalhando — o contrário de um automatizador de desktop.
 */
export async function capturar(
  _tabs: TabManager | null,
  _id: string,
  caminho: string,
): Promise<{ arquivo: string; bytes: number }> {
  const alvo = exigirJanela();
  const imagem = await alvo.webContents.capturePage();
  const png = imagem.toPNG();

  if (!png.length) {
    throw new NavegacaoIndisponivelError('a captura saiu vazia — a página ainda não pintou nada');
  }

  const arquivo = caminho && isAbsolute(caminho) ? caminho : join(pastaPadrao(), caminho || `captura-${Date.now()}.png`);
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, png);
  logEvento('skill-captura', { arquivo, bytes: png.length });
  return { arquivo, bytes: png.length };
}

export function clicar(_tabs: TabManager | null, _id: string, x: number, y: number): { ok: true } {
  const alvo = exigirJanela();
  const posicao = { x: Math.round(x), y: Math.round(y) };
  alvo.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...posicao });
  alvo.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...posicao });
  return { ok: true };
}

export function digitar(_tabs: TabManager | null, _id: string, texto: string): { ok: true } {
  const alvo = exigirJanela();
  for (const caractere of texto) {
    alvo.webContents.sendInputEvent({ type: 'char', keyCode: caractere });
  }
  return { ok: true };
}

export function tecla(_tabs: TabManager | null, _id: string, nome: string): { ok: true } {
  const alvo = exigirJanela();
  alvo.webContents.sendInputEvent({ type: 'keyDown', keyCode: nome });
  alvo.webContents.sendInputEvent({ type: 'keyUp', keyCode: nome });
  return { ok: true };
}

/**
 * O texto visível da página.
 *
 * Sem isto a skill só teria a imagem, e decidir "cheguei na tela certa?" a partir de um
 * PNG é caro em token e frágil. O texto responde onde a navegação parou.
 */
export async function texto(
  _tabs: TabManager | null,
  _id: string,
  limite = 4000,
): Promise<{ texto: string }> {
  const alvo = exigirJanela();
  const conteudo = (await alvo.webContents.executeJavaScript(
    'document.body ? document.body.innerText : ""',
    true,
  )) as string;
  return { texto: conteudo.slice(0, limite) };
}

/** Fecha a página de trabalho. A skill não precisa chamar: o shell leva junto ao sair. */
export function fechar(): { ok: true } {
  if (janela && !janela.isDestroyed()) janela.destroy();
  janela = null;
  return { ok: true };
}

/** Espera o carregamento terminar; o Sankhya demora e capturar antes pega tela em branco. */
function esperarCarregar(webContents: Electron.WebContents, timeoutMs = 30_000): Promise<void> {
  if (!webContents.isLoading()) return Promise.resolve();
  return new Promise((resolva) => {
    const prazo = setTimeout(finalizar, timeoutMs);
    function finalizar(): void {
      clearTimeout(prazo);
      webContents.off('did-stop-loading', finalizar);
      resolva();
    }
    webContents.once('did-stop-loading', finalizar);
  });
}
