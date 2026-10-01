/**
 * Ponte do shell com a busca rápida do painel (`public/js/app.js`).
 *
 * O painel é página servida pelo backend e não recebe preload: o único canal até ele é o
 * `executeJavaScript` da guia Hub, que chama o `window.buscaRapidaDoHub` exposto pelo
 * painel. O `true` do segundo argumento marca a chamada como gesto do usuário: sem ele, o
 * foco que a busca pede para o campo pode ser negado a uma página que ninguém clicou.
 */
import { logEvento } from '../log';
import type { TabManager } from './tabs';

/** Vale no Windows inteiro, mesmo com o HUB SNK escondido na bandeja. */
export const ATALHO_GLOBAL_DA_BUSCA = 'CommandOrControl+Shift+Space';

async function chamarNoPainel<T>(tabs: TabManager, codigo: string): Promise<T | null> {
  const painel = tabs.aba('hub')?.webContents;
  if (!painel || painel.isDestroyed()) return null;
  try {
    return (await painel.executeJavaScript(codigo, true)) as T;
  } catch (erro) {
    logEvento('busca-rapida-falhou', { erro: (erro as Error).message });
    return null;
  }
}

export async function abrirBuscaRapida(tabs: TabManager): Promise<void> {
  if (!tabs.mostrar('hub')) return;
  // Sem o foco na guia, as teclas iriam para a barra de guias e não para o campo da busca.
  tabs.aba('hub')?.webContents.focus();
  await chamarNoPainel(tabs, 'window.buscaRapidaDoHub?.abrir()');
}
