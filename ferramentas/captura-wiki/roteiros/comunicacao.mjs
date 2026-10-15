/**
 * Prints da página WhatsApp, Gmail e Google da wiki (`site/wiki/comunicacao.html`).
 *
 * A barra lateral e o menu da engrenagem são da moldura do aplicativo, lidos pelas páginas
 * `file:` dele. O painel de cada serviço mostra as telas fictícias de
 * `comunicacao-ficticia.mjs`, no lugar do WhatsApp Web e do Google.
 */
import { servirComunicacaoFicticia } from '../comunicacao-ficticia.mjs';

const ESPERA_DA_TELA_MS = 10_000;
const INTERVALO_DE_PROCURA_MS = 100;
const HOST_DO_SERVICO = {
  whatsapp: 'web.whatsapp.com',
  gmail: 'mail.google.com',
  chat: 'chat.google.com',
  agenda: 'calendar.google.com',
  meet: 'meet.google.com',
};

/** Página do aplicativo ou do painel cujo endereço passa no teste, que pode nascer depois. */
async function esperarPagina(aplicativo, teste, descricao) {
  const limite = Date.now() + ESPERA_DA_TELA_MS;
  while (Date.now() < limite) {
    const pagina = aplicativo
      .context()
      .pages()
      .find((p) => teste(p.url()));
    if (pagina) return pagina;
    await new Promise((pronto) => setTimeout(pronto, INTERVALO_DE_PROCURA_MS));
  }
  throw new Error(`${descricao} não abriu.`);
}

const paginaDoAplicativo = (aplicativo, arquivo) =>
  esperarPagina(
    aplicativo,
    (url) => url.startsWith('file:') && url.split('?')[0].endsWith(`/${arquivo}`),
    `A tela ${arquivo} do aplicativo`,
  );

/** O `print` só contorna o que está no Painel: o contorno da moldura sai aqui. */
function contornar(pagina, seletores) {
  return pagina.evaluate((seletores) => {
    for (const seletor of seletores) {
      const caixa = document.querySelector(seletor).getBoundingClientRect();
      const marca = document.createElement('div');
      marca.className = 'marca-da-wiki';
      Object.assign(marca.style, {
        position: 'fixed',
        left: `${caixa.left - 2}px`,
        top: `${caixa.top - 2}px`,
        width: `${caixa.width + 4}px`,
        height: `${caixa.height + 4}px`,
        border: '3px solid #f59e0b',
        borderRadius: '10px',
        boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.25)',
        pointerEvents: 'none',
        zIndex: '2147483647',
      });
      document.body.append(marca);
    }
  }, seletores);
}

const limparContornos = (pagina) =>
  pagina.evaluate(() => document.querySelectorAll('.marca-da-wiki').forEach((m) => m.remove()));

/** Mesmo desenho do contorno, nos itens do menu flutuante (outra página). */
function contornarItensDoMenu(menu, rotulos) {
  return menu.evaluate((rotulos) => {
    for (const item of document.querySelectorAll('#menu .item')) {
      if (!rotulos.includes(item.children[1]?.textContent)) continue;
      Object.assign(item.style, {
        outline: '3px solid #f59e0b',
        outlineOffset: '-3px',
        borderRadius: '8px',
        boxShadow: 'inset 0 0 0 6px rgba(245, 158, 11, 0.25)',
      });
    }
  }, rotulos);
}

export async function roteiro({ aplicativo, painel, print }) {
  await servirComunicacaoFicticia(aplicativo);
  const moldura = await paginaDoAplicativo(aplicativo, 'index.html');
  const botao = (servico) => `#servicos [data-servico="${servico}"]`;

  const printDaMoldura = async (nome, seletores = []) => {
    await contornar(moldura, seletores);
    await print(nome);
    await limparContornos(moldura);
  };
  /** Clica no botão do serviço e espera a tela fictícia dele carregar no painel. */
  const abrirServico = async (servico) => {
    await moldura.click(botao(servico));
    const pagina = await esperarPagina(
      aplicativo,
      (url) => new URL(url).hostname === HOST_DO_SERVICO[servico],
      `O painel do ${servico}`,
    );
    await pagina.waitForSelector(`#${servico}.ativa`);
    await painel.waitForTimeout(600);
    return pagina;
  };

  // Barra de comunicação
  await printDaMoldura('barra-01-botoes', ['#servicos']);
  await abrirServico('whatsapp');
  await printDaMoldura('barra-02-painel', [botao('whatsapp')]);
  await moldura.click(botao('whatsapp'));
  await painel.waitForTimeout(400);
  await printDaMoldura('barra-03-alca', ['#alternarLateral']);
  await moldura.click('#alternarLateral');
  await painel.waitForTimeout(400);
  await printDaMoldura('barra-04-oculta', ['#alternarLateral']);
  await moldura.click('#alternarLateral');

  // Cada serviço no painel
  await abrirServico('whatsapp');
  await print('whatsapp-01-conversas');
  await abrirServico('gmail');
  await printDaMoldura('gmail-01-caixa', [botao('gmail')]);
  await abrirServico('chat');
  await printDaMoldura('google-01-chat', [botao('chat')]);
  await abrirServico('agenda');
  await printDaMoldura('google-02-agenda', [botao('agenda')]);
  await abrirServico('meet');
  await printDaMoldura('google-03-meet', [botao('meet')]);
  await moldura.click(botao('meet'));

  // Avisos: os três primeiros serviços já carregados acendem os contadores
  await moldura.waitForFunction(
    () => document.querySelectorAll('#servicos .contador:not([hidden])').length === 3,
  );
  await printDaMoldura('avisos-01-contadores', [botao('whatsapp'), botao('gmail'), botao('chat')]);

  // Engrenagem da barra
  await moldura.click('#configurarServicos');
  await painel.waitForTimeout(600);
  const menu = await paginaDoAplicativo(aplicativo, 'menu.html');
  await menu.waitForSelector('#menu:not([hidden])');
  await contornarItensDoMenu(menu, [
    'WhatsApp',
    'Gmail',
    'Google Chat',
    'Google Agenda',
    'Google Meet',
  ]);
  await print('escolher-01-botoes');
  await menu.evaluate(() => window.menuHub.fechar());
  await moldura.click('#configurarServicos');
  await painel.waitForTimeout(600);
  await menu.waitForSelector('#menu:not([hidden])');
  await contornarItensDoMenu(menu, ['Carregar WhatsApp e Google Chat']);
  await print('escolher-02-carregar-ao-abrir');
  await menu.evaluate(() => window.menuHub.fechar());
}
