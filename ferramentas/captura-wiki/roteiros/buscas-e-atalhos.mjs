/**
 * Prints da página Buscas e atalhos da wiki (`site/wiki/buscas-e-atalhos.html`).
 *
 * Nenhum programa é iniciado: os atalhos têm caminhos fictícios e a rota que os executa é
 * respondida aqui. Pasta, terminal e IDE do repositório só aparecem destacados, sem clique.
 * O menu ☰, a barra do Ctrl+F e a lista de teclas são do aplicativo (a moldura), e não do
 * Painel: são lidos pelas páginas `file:` dele.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ESPERA_DA_TELA_MS = 5_000;
const INTERVALO_DE_PROCURA_MS = 100;
const MARGEM_DA_JANELA_DE_TECLAS = 24;
/** O tamanho da janela Ajuda › Atalhos (`desktop/src/interface/janelaDeAtalhos.ts`). */
const TAMANHO_DA_JANELA_DE_TECLAS = { largura: 520, altura: 840 };
const LIMITE_DE_RESULTADOS_DA_BUSCA = 30;

const ATALHOS = [
  ['DataGrip', 'C:\\Program Files\\JetBrains\\DataGrip\\bin\\datagrip64.exe'],
  ['IntelliJ IDEA', 'C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe'],
  ['DBeaver', 'C:\\Program Files\\DBeaver\\dbeaver.exe'],
  ['WinSCP', 'C:\\Program Files (x86)\\WinSCP\\WinSCP.exe'],
  ['Notepad++', 'C:\\Program Files\\Notepad++\\notepad++.exe'],
  ['VPN da Fazenda Boa Vista', 'C:\\Ferramentas\\vpn-boavista.bat'],
];

function id(apelido) {
  const h = createHash('md5').update(apelido).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Seis atalhos: um a mais que o limite em que a lista do raio ganha o campo de busca. */
export function semear(pastaDeDados) {
  const arquivo = join(pastaDeDados, 'configuracao.json');
  const conteudo = JSON.parse(readFileSync(arquivo, 'utf8'));
  conteudo.configuracao.atalhos = ATALHOS.map(([nome, caminhoDoExecutavel]) => ({
    id: id(`at-${nome}`),
    nome,
    caminhoDoExecutavel,
  }));
  writeFileSync(arquivo, JSON.stringify(conteudo, null, 2));
}

/** Página `file:` do aplicativo (moldura, menu, barra de busca), que pode nascer depois. */
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

async function abrirMenu(aplicativo) {
  const moldura = await paginaDoAplicativo(aplicativo, 'index.html');
  await moldura.click('#menu');
  const menu = await paginaDoAplicativo(aplicativo, 'menu.html');
  await menu.locator('#menu:not([hidden])').waitFor();
  return menu;
}

/**
 * Ajuda › Atalhos abre uma janela própria, que o print da janela principal não pega. A
 * mesma página, com a mesma lista, entra por um momento no meio da janela principal.
 */
async function mostrarTeclasNaJanelaPrincipal(aplicativo) {
  const endereco = await aplicativo.evaluate(async ({ BrowserWindow }) => {
    for (let tentativa = 0; tentativa < 50; tentativa++) {
      const janela = BrowserWindow.getAllWindows().find((j) => j.getTitle() === 'Atalhos');
      if (janela && !janela.webContents.isLoading()) {
        const url = janela.webContents.getURL();
        janela.destroy();
        return url;
      }
      await new Promise((pronto) => setTimeout(pronto, 100));
    }
    throw new Error('A janela Atalhos não abriu.');
  });

  await aplicativo.evaluate(
    async ({ BrowserWindow, WebContentsView }, [url, margem, tamanho]) => {
      const principal = BrowserWindow.getAllWindows().find((j) => j.isVisible());
      const [largura, altura] = principal.getContentSize();
      const escala = Math.min(1, (altura - margem * 2) / tamanho.altura);
      const largo = Math.round(tamanho.largura * escala);
      const alto = Math.round(tamanho.altura * escala);
      const vista = new WebContentsView();
      vista.setBackgroundColor('#1b1f27');
      vista.setBounds({
        x: Math.round((largura - largo) / 2),
        y: Math.round((altura - alto) / 2),
        width: largo,
        height: alto,
      });
      principal.contentView.addChildView(vista);
      await vista.webContents.loadURL(url);
      vista.webContents.setZoomFactor(escala);
      globalThis.vistaDeTeclasDaWiki = vista;
    },
    [endereco, MARGEM_DA_JANELA_DE_TECLAS, TAMANHO_DA_JANELA_DE_TECLAS],
  );
}

async function tirarTeclasDaJanelaPrincipal(aplicativo) {
  await aplicativo.evaluate(({ BrowserWindow }) => {
    const vista = globalThis.vistaDeTeclasDaWiki;
    BrowserWindow.getAllWindows()
      .find((j) => j.isVisible())
      .contentView.removeChildView(vista);
    vista.webContents.close();
  });
}

/** Nada de programa de verdade: pasta, terminal, IDE e seletor de arquivo só respondem. */
async function simularAcoesDoSistema(painel) {
  await painel.route('**/api/atalhos/*/abrir', (rota) => rota.fulfill({ status: 204 }));
  await painel.route('**/api/atalhos/selecionar-executavel', (rota) =>
    rota.fulfill({ status: 204 }),
  );
  await painel.route('**/api/clientes/*/repositorios/*/abrir-*', (rota) =>
    rota.fulfill({ status: 204 }),
  );
}

export async function roteiro({ painel, aplicativo, print, printDoSistema }) {
  const linhaSelecionada = painel.locator('.busca-rapida-item.selecionado');
  /* Desce na lista até a linha do tipo pedido: Enter num repositório abriria a pasta. */
  const selecionarTipo = async (tipo) => {
    for (let passo = 0; passo < LIMITE_DE_RESULTADOS_DA_BUSCA; passo++) {
      const atual = await linhaSelecionada.locator('.busca-rapida-tipo').textContent();
      if (atual === tipo) return;
      await painel.keyboard.press('ArrowDown');
    }
    throw new Error(`Nenhum resultado do tipo ${tipo} na busca.`);
  };
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const abrirBusca = async (texto) => {
    await painel.keyboard.press('Control+KeyK');
    await painel.waitForSelector('#modal-busca-rapida[open]');
    if (texto) await painel.fill('#campo-busca-rapida', texto);
  };
  const printNoAplicativo = async (nome, destacando) => {
    await print(nome, { destacando });
    await limparContornosDoAplicativo(aplicativo);
  };

  await simularAcoesDoSistema(painel);

  // Busca rápida
  await print('busca-rapida-01-lupa', { destacando: ['#btn-busca-rapida'] });
  await abrirBusca();
  await print('busca-rapida-02-aberta', { destacando: ['#campo-busca-rapida'] });
  await painel.fill('#campo-busca-rapida', 'alfa');
  await print('busca-rapida-03-resultados', { destacando: ['#lista-busca-rapida'] });
  await painel.keyboard.press('ArrowDown');
  await painel.keyboard.press('ArrowDown');
  await print('busca-rapida-04-navegar', {
    destacando: [linhaSelecionada, '.busca-rapida-dica'],
  });
  await painel.keyboard.press('Escape');

  // Abrir o item: cliente e atalho
  await abrirBusca('fazenda boa vista');
  await selecionarTipo('Cliente');
  await print('abrir-item-01-cliente', { destacando: [linhaSelecionada] });
  await painel.keyboard.press('Enter');
  await painel.waitForSelector('.detalhe-abas');
  await print('abrir-item-02-aberto', {
    destacando: [painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' })],
  });
  await abrirBusca('datagrip');
  await selecionarTipo('Atalho');
  await painel.keyboard.press('Enter');
  await painel.waitForSelector('.aviso');
  await print('abrir-item-03-atalho', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Ctrl+Enter: o cliente do item
  await abrirBusca('alfa teste');
  await selecionarTipo('Base');
  await print('abrir-cliente-do-item-01-base', { destacando: [linhaSelecionada] });
  await painel.keyboard.press('Control+Enter');
  await painel.locator('.detalhe h2', { hasText: 'Indústria Alfa' }).waitFor();
  await print('abrir-cliente-do-item-02-bases', { destacando: ['.detalhe-abas'] });

  // Pasta, terminal e IDE do repositório (só destacados)
  await abrirBusca('pesagem');
  await print('acoes-do-repositorio-01-botoes', { destacando: ['.busca-rapida-acoes'] });
  await painel.keyboard.press('Escape');

  // Itens usados por último
  await abrirBusca();
  await print('recentes-01-lista', { destacando: ['#lista-busca-rapida'] });
  await painel.keyboard.press('Escape');

  // Cadastrar atalhos
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-atalhos');
  await print('cadastrar-atalhos-01-aba', { destacando: ['#aba-configuracao-atalhos'] });
  await painel.click('#btn-adicionar-atalho');
  const linhaNova = painel.locator('.linha-atalho-config').last();
  await linhaNova.locator('input').first().fill('Planilha de horas');
  await linhaNova.locator('input').last().fill('C:\\Ferramentas\\planilha-de-horas.xlsx');
  await print('cadastrar-atalhos-02-linha', { destacando: [linhaNova] });
  await print('cadastrar-atalhos-03-escolher-e-remover', {
    destacando: [
      linhaNova.locator('[aria-label="Escolher o executável"]'),
      linhaNova.locator('[aria-label="Remover atalho"]'),
    ],
  });
  await painel.click('#btn-salvar-configuracao');
  await painel.waitForSelector('.aviso');
  await print('cadastrar-atalhos-04-salvo', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Lista de atalhos do raio
  await print('lista-de-atalhos-01-raio', { destacando: ['#btn-atalhos'] });
  await painel.click('#btn-atalhos');
  await print('lista-de-atalhos-02-lista', { destacando: ['#lista-atalhos'] });
  await painel.fill('.busca-atalhos', 'data');
  await print('lista-de-atalhos-03-buscar', { destacando: ['.busca-atalhos'] });
  await painel.locator('.item-atalho', { hasText: 'DataGrip' }).click();
  await painel.waitForSelector('.aviso');
  await print('lista-de-atalhos-04-iniciado', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Buscar na página (Ctrl+F), pelo menu ☰
  let menu = await abrirMenu(aplicativo);
  await printNoAplicativo('buscar-na-pagina-01-menu', [
    menu.locator('#menu button.item', { hasText: 'Buscar na página' }),
  ]);
  await menu.locator('#menu button.item', { hasText: 'Buscar na página' }).click();
  const barra = await paginaDoAplicativo(aplicativo, 'barraDeBusca.html');
  await barra.fill('#campo', 'Boa Vista');
  await barra.locator('#contador', { hasText: '/' }).waitFor();
  await printNoAplicativo('buscar-na-pagina-02-barra', [barra.locator('#barra')]);
  await barra.press('#campo', 'Escape');

  // Lista de teclas de atalho (Ajuda › Atalhos)
  menu = await abrirMenu(aplicativo);
  const itemAtalhos = menu.locator('#menu button.item', { hasText: /^Atalhos$/ });
  await printNoAplicativo('teclas-de-atalho-01-menu', [itemAtalhos]);
  await itemAtalhos.click();
  await mostrarTeclasNaJanelaPrincipal(aplicativo);
  await print('teclas-de-atalho-02-lista');
  await tirarTeclasDaJanelaPrincipal(aplicativo);

  // Menu do ícone da bandeja, na área de trabalho fictícia do Windows
  await printDoSistema('atalho-global-01-bandeja', {
    cena: 'menu',
    destaque: 'Atalho global (Ctrl+Shift+Space)',
  });
}
