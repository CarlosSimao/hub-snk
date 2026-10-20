/**
 * Prints da página Guias e navegação da wiki (`site/wiki/guias-e-navegacao.html`).
 *
 * Quase tudo aqui é da moldura do aplicativo (barra de guias, menu ☰, Downloads), lida
 * pelas páginas `file:` dele. Nenhuma página de terceiro aparece: o endereço fictício
 * `portal.boavista.example` é respondido por uma página de exemplo local, e a página
 * inicial da guia nova (o Google) por uma página em branco.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ESPERA_DA_TELA_MS = 5_000;
const INTERVALO_DE_PROCURA_MS = 100;
const PORTAL = 'portal.boavista.example';
const PARTICAO_DA_GUIA_NOVA = 'persist:hub-navegacao-avulsa';
const PARTICAO_DO_LINK = `link:https://${PORTAL}`;
const PASTA_DE_DOWNLOADS = join(
  tmpdir(),
  `hub-snk-captura-${process.env['CAPTURA_INSTANCIA'] ?? 0}-downloads`,
);

const PAGINA_DE_EXEMPLO = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Portal de chamados</title>
  <style>
    body { margin: 0; background: #f4f6f8; color: #1f2937; font-family: 'Segoe UI', Arial, sans-serif; }
    header { background: #2f5d50; color: #fff; padding: 18px 32px; font-size: 20px; }
    main { padding: 32px; }
    .cartao { max-width: 720px; padding: 8px 24px 20px; background: #fff; border: 1px solid #d9dee5; border-radius: 8px; }
    li { margin: 8px 0; }
    footer { padding: 0 32px; color: #6b7280; font-size: 12px; }
  </style>
</head>
<body>
  <header>Fazenda Boa Vista · Portal de chamados</header>
  <main>
    <div class="cartao">
      <h2>Chamados abertos</h2>
      <ul>
        <li>#1042 — Pesagem em grupo não fecha o lote</li>
        <li>#1039 — Relatório de rebanho sem a coluna de lote</li>
      </ul>
      <a href="/relatorio-de-chamados.pdf">Baixar o relatório de chamados (PDF)</a>
    </div>
  </main>
  <footer>Página de exemplo da wiki do HUB SNK.</footer>
</body>
</html>`;

/** Página `file:` do aplicativo (moldura, menu, camada de downloads), que pode nascer depois. */
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

/** O `print` só limpa o contorno do Painel; o das páginas do aplicativo sai aqui. */
async function limparContornosDoAplicativo(aplicativo) {
  for (const pagina of aplicativo.context().pages()) {
    if (!pagina.url().startsWith('file:')) continue;
    await pagina
      .evaluate(() => document.querySelectorAll('.marca-da-wiki').forEach((m) => m.remove()))
      .catch(() => undefined);
  }
}

/**
 * Responde, nas partições da guia nova e do link do portal, o endereço fictício com a
 * página de exemplo (e um PDF qualquer para o download) e o Google com uma página vazia.
 * O resto passa adiante. Os downloads vão para uma pasta temporária, e não para a do usuário.
 */
async function servirPaginasDeExemplo(aplicativo) {
  // Vazia a cada rodada: com o arquivo da anterior, o novo viria como "(1).pdf".
  rmSync(PASTA_DE_DOWNLOADS, { recursive: true, force: true });
  mkdirSync(PASTA_DE_DOWNLOADS, { recursive: true });
  await aplicativo.evaluate(
    ({ app, session }, [particoes, portal, pagina, downloads]) => {
      app.setPath('downloads', downloads);
      for (const particao of particoes) {
        const sessao = session.fromPartition(particao);
        sessao.protocol.handle('https', (requisicao) => {
          const { hostname, pathname } = new URL(requisicao.url);
          if (hostname === portal && pathname.endsWith('.pdf')) {
            return new Response('%PDF-1.4\n% exemplo\n', {
              headers: {
                'content-type': 'application/pdf',
                'content-disposition': 'attachment; filename="relatorio-de-chamados.pdf"',
              },
            });
          }
          if (hostname === portal) {
            return new Response(pagina, {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            });
          }
          if (hostname === 'www.google.com') {
            return new Response('<!doctype html><title>Nova guia</title>', {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            });
          }
          return sessao.fetch(requisicao, { bypassCustomProtocolHandlers: true });
        });
      }
    },
    [[PARTICAO_DA_GUIA_NOVA, PARTICAO_DO_LINK], PORTAL, PAGINA_DE_EXEMPLO, PASTA_DE_DOWNLOADS],
  );
}

/** Baixa o PDF da página de exemplo pela própria guia, como o clique no link faria. */
async function baixarDoPortal(aplicativo) {
  await aplicativo.evaluate(({ webContents }, portal) => {
    const guia = webContents.getAllWebContents().find((w) => w.getURL().includes(portal));
    guia.downloadURL(`https://${portal}/relatorio-de-chamados.pdf`);
  }, PORTAL);
}

export async function roteiro({ painel, aplicativo, print }) {
  const moldura = await paginaDoAplicativo(aplicativo, 'index.html');
  const printNoAplicativo = async (nome, destacando) => {
    await print(nome, { destacando });
    await limparContornosDoAplicativo(aplicativo);
  };
  const abrirMenu = async () => {
    await moldura.click('#menu');
    const menu = await paginaDoAplicativo(aplicativo, 'menu.html');
    await menu.locator('#menu:not([hidden])').waitFor();
    return menu;
  };
  const itemDoMenu = (menu, rotulo) => menu.locator('#menu button.item', { hasText: rotulo });

  await servirPaginasDeExemplo(aplicativo);

  // Guias fixas
  await printNoAplicativo('guias-fixas-01-barra', [moldura.locator('#abas')]);

  // Sankhya Web Connection: no Actions ele não roda e o indicador sai desligado; numa
  // máquina com ele no ar, sai ligado. Os dois servem ao print.
  await painel.locator('#indicador-web-connection:is(.ligado, .desligado)').waitFor();
  await print('web-connection-01-indicador', { destacando: ['#indicador-web-connection'] });

  // Menu ☰
  await printNoAplicativo('menu-do-aplicativo-01-botao', [moldura.locator('#menu')]);
  let menu = await abrirMenu();
  await printNoAplicativo('menu-do-aplicativo-02-menu', [menu.locator('#menu')]);

  // Ruffle (só destacado: ligar baixaria o motor)
  await printNoAplicativo('flash-ruffle-01-caixa', [
    itemDoMenu(menu, 'Compatibilidade com Flash (Ruffle)'),
  ]);

  // Mostrar e esconder guias
  const caixaDaGuia = (rotulo) =>
    menu.locator('#menu button.item.caixa', { hasText: new RegExp(`^${rotulo}$`) });
  await printNoAplicativo('mostrar-e-esconder-guias-01-caixas', [
    caixaDaGuia('Painel'),
    caixaDaGuia('SankhyaOm'),
    caixaDaGuia('Experience'),
  ]);
  await caixaDaGuia('Experience').click();
  await moldura
    .locator('#abas button[data-id="experience"][hidden]')
    .waitFor({ state: 'attached' });
  await menu.keyboard.press('Escape');
  await printNoAplicativo('mostrar-e-esconder-guias-02-escondida', [moldura.locator('#abas')]);
  menu = await abrirMenu();
  await caixaDaGuia('Experience').click();
  await moldura.locator('#abas button[data-id="experience"]:not([hidden])').waitFor();
  await menu.keyboard.press('Escape');

  // Guia nova, barra de endereço, voltar e avançar
  await printNoAplicativo('nova-guia-01-botao', [moldura.locator('#novaGuia')]);
  await moldura.click('#novaGuia');
  await moldura.locator('#barraEndereco:not([hidden])').waitFor();
  // Só depois da página inicial carregada o Voltar tem para onde voltar.
  await aplicativo.evaluate(async ({ webContents }) => {
    for (let tentativa = 0; tentativa < 100; tentativa++) {
      const guia = webContents.getAllWebContents().find((w) => w.getURL().includes('google.com'));
      if (guia && !guia.isLoading()) return;
      await new Promise((pronto) => setTimeout(pronto, 100));
    }
    throw new Error('A guia nova não carregou a página inicial.');
  });
  await moldura.fill('#endereco', PORTAL);
  await moldura.press('#endereco', 'Enter');
  await moldura.locator('.aba-avulsa', { hasText: 'Portal de chamados' }).waitFor();
  await moldura.locator('#voltar:not([disabled])').waitFor();
  await printNoAplicativo('nova-guia-02-endereco', [moldura.locator('#barraEndereco')]);
  await printNoAplicativo('nova-guia-03-voltar', [
    moldura.locator('#voltar'),
    moldura.locator('#avancar'),
  ]);

  // Downloads
  await baixarDoPortal(aplicativo);
  await moldura.locator('#baixados:not([hidden])').waitFor();
  await moldura.locator('#baixados:not(.baixando)').waitFor();
  await printNoAplicativo('downloads-01-botao', [moldura.locator('#baixados')]);
  await moldura.click('#baixados');
  const camada = await paginaDoAplicativo(aplicativo, 'camada.html');
  // Na primeira vez a camada nasce com o clique e pode perder o pedido de abrir.
  if (!(await camada.locator('#downloads:not([hidden])').isVisible())) {
    await camada.waitForTimeout(1000);
    await moldura.click('#baixados');
  }
  await camada.locator('#downloads:not([hidden])').waitFor();
  await printNoAplicativo('downloads-02-lista', [camada.locator('#downloads')]);
  await camada.keyboard.press('Escape');

  // Fechar e recarregar
  await printNoAplicativo('fechar-e-recarregar-01-botoes', [
    moldura.locator('.aba-avulsa .fechar'),
    moldura.locator('#recarregar'),
  ]);
  await moldura.click('#abas button[data-id="hub"]', { button: 'right' });
  menu = await paginaDoAplicativo(aplicativo, 'menu.html');
  await itemDoMenu(menu, 'Recarregar sem cache').waitFor();
  await printNoAplicativo('fechar-e-recarregar-02-menu', [menu.locator('#menu')]);
  await menu.keyboard.press('Escape');
  await moldura.click('.aba-avulsa .fechar');
  await moldura.locator('.aba-avulsa').waitFor({ state: 'detached' });

  // Onde os links abrem
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-geral');
  await painel.locator('#campo-destino-dos-links').scrollIntoViewIfNeeded();
  await print('onde-os-links-abrem-01-configuracao', {
    destacando: [painel.locator('.campo', { has: painel.locator('#campo-destino-dos-links') })],
  });
  await painel.click('#btn-cancelar-configuracao');
  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' }).click();
  await painel.locator('a.recurso-nome', { hasText: 'Portal de chamados' }).click();
  await moldura.locator('#abasClientes .aba-cliente').waitFor();
  await printNoAplicativo('onde-os-links-abrem-02-guia', [moldura.locator('#abasClientes')]);
}
