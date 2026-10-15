/**
 * Prints da página Bandeja e segundo plano da wiki (`site/wiki/bandeja.html`).
 *
 * O ícone da bandeja, o menu dele e o aviso do Windows são do sistema e ficam fora do
 * capturador: só o Sair do menu ☰, que é da moldura do aplicativo, sai daqui.
 */
const ESPERA_DA_TELA_MS = 5_000;
const INTERVALO_DE_PROCURA_MS = 100;

/** Página `file:` do aplicativo (moldura, menu), que pode nascer depois. */
async function paginaDoAplicativo(aplicativo, arquivo) {
  const limite = Date.now() + ESPERA_DA_TELA_MS;
  while (Date.now() < limite) {
    const pagina = aplicativo
      .context()
      .pages()
      .find((p) => p.url().startsWith('file:') && p.url().split('?')[0].endsWith(`/${arquivo}`));
    if (pagina) return pagina;
    await new Promise((pronto) => setTimeout(pronto, INTERVALO_DE_PROCURA_MS));
  }
  throw new Error(`A tela ${arquivo} do aplicativo não abriu.`);
}

export async function roteiro({ aplicativo, painel, print }) {
  const moldura = await paginaDoAplicativo(aplicativo, 'index.html');
  await moldura.click('#menu');
  await painel.waitForTimeout(600);
  const menu = await paginaDoAplicativo(aplicativo, 'menu.html');
  await menu.waitForSelector('#menu:not([hidden])');
  // O menu passa um pouco da janela: rola até o Sair, no fim do grupo Hub.
  await menu.evaluate(() => {
    for (const item of document.querySelectorAll('#menu .item')) {
      if (item.children[1]?.textContent !== 'Sair') continue;
      item.scrollIntoView({ block: 'center' });
      Object.assign(item.style, {
        outline: '3px solid #f59e0b',
        outlineOffset: '-3px',
        borderRadius: '8px',
        boxShadow: 'inset 0 0 0 6px rgba(245, 158, 11, 0.25)',
      });
    }
  });
  await print('sair-01-menu');
  await menu.evaluate(() => window.menuHub.fechar());
}
