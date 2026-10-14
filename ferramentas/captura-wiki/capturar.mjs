/**
 * Gera os prints da wiki (`site/wiki/img/<macro>/`) rodando o HUB SNK desktop de verdade
 * sobre a pasta de dados fictícia de `preparar-dados.mjs`.
 *
 *   node capturar.mjs [macro...]    (sem macro, todas as de `roteiros/`)
 *
 * O aplicativo sobe isolado do HUB SNK do dia a dia: perfil do Electron, pasta de dados,
 * portas e pasta de IPC próprios. Pode rodar com o HUB SNK instalado aberto ao lado.
 *
 * O print é a janela inteira — barra de guias, barra lateral e a guia ativa — montada a
 * partir das capturas de cada `WebContentsView`, sem depender do que estiver por cima da
 * janela na tela.
 */
import { _electron } from 'playwright-core';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepararDados } from './preparar-dados.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_DO_REPOSITORIO = resolve(AQUI, '..', '..');
const PASTA_DAS_IMAGENS = join(RAIZ_DO_REPOSITORIO, 'site', 'wiki', 'img');
const RAIZ_DA_CAPTURA = join(tmpdir(), 'hub-snk-captura');
const ELECTRON = join(
  RAIZ_DO_REPOSITORIO,
  'desktop',
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron',
);

// Portas fora das do HUB SNK instalado (4100 e 4103), para os dois conviverem.
const PORTA_DO_PAINEL = 4120;
const PORTA_DA_PONTE = 4123;
const QUALIDADE_WEBP = 0.85;
const ESPERA_DO_PAINEL_MS = 30_000;
// Área da janela fixa, a do aplicativo aberto pela primeira vez (1280x860 com a borda): sem
// isto, numa tela menor (o runner do Actions tem 1024x768) a janela encolhe e o painel
// muda de layout.
const LARGURA_DA_JANELA = 1264;
const ALTURA_DA_JANELA = 821;

/** Situação fixa das bases: os endereços `.example` não respondem, e o print sairia vermelho. */
function respostaDeBaseOperacional() {
  const agora = Date.now();
  const historico = Array.from({ length: 30 }, (_, i) => ({
    em: new Date(agora - (29 - i) * 30_000).toISOString(),
    urlOk: true,
  }));
  return { urlOk: true, versaoDaPlataforma: '4.32b146', historico };
}

/**
 * Os dois temas do HUB SNK, com o sufixo do arquivo de cada um. O escuro é o padrão do
 * aplicativo e o print sem sufixo; a wiki troca pelo `-claro` no tema claro.
 */
const TEMAS = [
  { tema: 'dark', sufixo: '' },
  { tema: 'light', sufixo: '-claro' },
];
const CHAVE_DO_TEMA_NO_PAINEL = 'hub-snk:tema';

async function abrirAplicativo(tema) {
  const pastaDeDados = prepararDados(RAIZ_DA_CAPTURA);
  const aplicativo = await _electron.launch({
    executablePath: ELECTRON,
    args: [
      join(RAIZ_DO_REPOSITORIO, 'desktop'),
      `--user-data-dir=${join(RAIZ_DA_CAPTURA, 'perfil')}`,
    ],
    env: {
      ...process.env,
      HUB_DADOS_DIR: pastaDeDados,
      SANKHYA_HUB_URL: `http://127.0.0.1:${PORTA_DO_PAINEL}`,
      SANKHYA_DESKTOP_BRIDGE_PORT: String(PORTA_DA_PONTE),
      SANKHYA_HUB_IPC_DIR: join(RAIZ_DA_CAPTURA, 'ipc'),
    },
  });

  const painel = await aplicativo
    .context()
    .waitForEvent('page', {
      predicate: (pagina) => pagina.url().includes(`:${PORTA_DO_PAINEL}/`),
      timeout: ESPERA_DO_PAINEL_MS,
    })
    .catch(() =>
      aplicativo
        .context()
        .pages()
        .find((p) => p.url().includes(`:${PORTA_DO_PAINEL}/`)),
    );
  if (!painel) throw new Error('A guia Painel não abriu.');
  await aplicativo.evaluate(
    ({ BrowserWindow }, [largura, altura]) => {
      const janela = BrowserWindow.getAllWindows().find((j) => j.isVisible());
      janela.unmaximize();
      janela.setContentSize(largura, altura);
    },
    [LARGURA_DA_JANELA, ALTURA_DA_JANELA],
  );

  const moldura = aplicativo
    .context()
    .pages()
    .find((p) => p.url().startsWith('file:'));
  await painel.route('**/api/clientes/*/bases/*/situacao', (rota) =>
    rota.fulfill({ json: respostaDeBaseOperacional() }),
  );
  await painel.waitForSelector('#btn-visualizacao-clientes');
  await painel.evaluate(
    ([chave, valor]) => localStorage.setItem(chave, valor),
    [CHAVE_DO_TEMA_NO_PAINEL, tema],
  );
  await painel.reload();
  await painel.waitForSelector('#btn-visualizacao-clientes');
  // O indicador do Git chega depois e empurra a barra do topo: espera ele para a tela parar.
  await painel.waitForSelector('#indicador-git-global:not([hidden])');
  return { aplicativo, painel, moldura };
}

/** Capturas da janela e de cada guia visível, com a posição de cada uma. */
async function capturarCamadas(aplicativo) {
  return aplicativo.evaluate(async ({ BrowserWindow }) => {
    const janela = BrowserWindow.getAllWindows().find((j) => j.isVisible());
    const [largura, altura] = janela.getContentSize();
    const camadas = [
      { imagem: (await janela.webContents.capturePage()).toDataURL(), x: 0, y: 0, largura, altura },
    ];
    for (const view of janela.contentView.children) {
      const limites = view.getBounds();
      if (!view.getVisible() || limites.width === 0 || limites.height === 0) continue;
      camadas.push({
        imagem: (await view.webContents.capturePage()).toDataURL(),
        x: limites.x,
        y: limites.y,
        largura: limites.width,
        altura: limites.height,
      });
    }
    return { largura, altura, camadas };
  });
}

/** Junta as camadas num canvas da própria moldura e devolve o WebP. */
async function comporWebp(moldura, { largura, altura, camadas }) {
  const dataUrl = await moldura.evaluate(
    async ({ largura, altura, camadas, qualidade }) => {
      const canvas = document.createElement('canvas');
      canvas.width = largura;
      canvas.height = altura;
      const contexto = canvas.getContext('2d');
      for (const camada of camadas) {
        const imagem = new Image();
        imagem.src = camada.imagem;
        await imagem.decode();
        contexto.drawImage(imagem, camada.x, camada.y, camada.largura, camada.altura);
      }
      return canvas.toDataURL('image/webp', qualidade);
    },
    { largura, altura, camadas, qualidade: QUALIDADE_WEBP },
  );
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

/**
 * Contorno chamativo em volta do que o passo manda clicar. Vai para dentro do `<dialog>`
 * aberto quando o alvo está num: fora dele, ficaria atrás do fundo escurecido do modal.
 */
async function destacar(painel, alvo) {
  const localizador = typeof alvo === 'string' ? painel.locator(alvo).first() : alvo;
  await localizador.evaluate((alvo) => {
    const caixa = alvo.getBoundingClientRect();
    const marca = document.createElement('div');
    marca.className = 'marca-da-wiki';
    const folga = 4;
    Object.assign(marca.style, {
      position: 'fixed',
      left: `${caixa.left - folga}px`,
      top: `${caixa.top - folga}px`,
      width: `${caixa.width + folga * 2}px`,
      height: `${caixa.height + folga * 2}px`,
      border: '3px solid #f59e0b',
      borderRadius: '10px',
      boxShadow: '0 0 0 4px rgba(245, 158, 11, 0.25)',
      pointerEvents: 'none',
      zIndex: '2147483647',
    });
    (alvo.closest('dialog[open]') ?? document.body).append(marca);
  });
}

async function limparDestaques(painel) {
  await painel.evaluate(() =>
    document.querySelectorAll('.marca-da-wiki').forEach((m) => m.remove()),
  );
}

function criarContexto(aplicativo, painel, moldura, macro, sufixo) {
  const pasta = join(PASTA_DAS_IMAGENS, macro);
  mkdirSync(pasta, { recursive: true });

  return {
    painel,
    aplicativo,
    /** Grava `<nome>.webp`, com o contorno em cada seletor ou localizador de `destacando`. */
    async print(nome, { destacando = [] } = {}) {
      // Deixa a transição de abertura de modal e o redesenho terminarem antes de medir o
      // alvo: medido antes, o contorno fica fora do lugar quando a tela ainda se mexe.
      await painel.waitForTimeout(400);
      for (const alvo of destacando) await destacar(painel, alvo);
      const arquivo = join(pasta, `${nome}${sufixo}.webp`);
      writeFileSync(arquivo, await comporWebp(moldura, await capturarCamadas(aplicativo)));
      await limparDestaques(painel);
      console.log(`  ${macro}/${nome}${sufixo}.webp`);
    },
  };
}

async function main() {
  const pedidas = process.argv.slice(2);
  const macros = pedidas.length
    ? pedidas
    : readdirSync(join(AQUI, 'roteiros')).map((arquivo) => arquivo.replace(/\.mjs$/, ''));

  // Um aplicativo novo por tema: os roteiros mudam o cadastro, e cada tema precisa partir
  // dos mesmos dados para os dois prints mostrarem a mesma coisa.
  for (const { tema, sufixo } of TEMAS) {
    const { aplicativo, painel, moldura } = await abrirAplicativo(tema);
    try {
      for (const macro of macros) {
        console.log(`${macro} (${tema})`);
        const { roteiro } = await import(`./roteiros/${macro}.mjs`);
        await roteiro(criarContexto(aplicativo, painel, moldura, macro, sufixo));
      }
    } finally {
      await aplicativo.close();
    }
  }
}

await main();
