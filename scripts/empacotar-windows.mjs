/**
 * Monta a pasta que o instalador do Windows empacota.
 *
 * O resultado é autossuficiente: leva o próprio `node.exe` e as dependências já
 * instaladas, para que a máquina de destino não precise de Node, de npm nem de
 * rede. É o que separa "instalar e usar" de "primeiro instale o Node, depois
 * confira a versão, depois rode npm install".
 *
 * Uso: npm run empacotar-windows
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSAO_DO_NODE_EMBUTIDO = 'v22.18.0';
const ARQUITETURA = 'win-x64';
const BYTES_POR_MEGABYTE = 1024 * 1024;

const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pastaDaDistribuicao = join(raizDoProjeto, 'dist', 'windows');
const pastaDoCache = join(raizDoProjeto, 'dist', 'cache');
const caminhoDoNodeEmCache = join(pastaDoCache, `node-${VERSAO_DO_NODE_EMBUTIDO}-${ARQUITETURA}.exe`);

/* Só o que o programa precisa para rodar. Testes, docs e o .git ficam de fora. */
const ITENS_COPIADOS = ['src', 'public', 'node_modules', 'package.json'];
const ARQUIVOS_DO_INSTALADOR = ['abrir-hub-snk.vbs'];

function megabytes(bytes) {
  return `${(bytes / BYTES_POR_MEGABYTE).toFixed(1)} MB`;
}

async function existe(caminho) {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * O node.exe é publicado avulso, sem zip em volta — dá para gravar a resposta
 * direto, sem precisar de um descompactador.
 *
 * Fica em cache porque são ~80 MB: repetir o empacotamento não deve repetir o
 * download.
 */
async function obterNodeEmbutido() {
  if (await existe(caminhoDoNodeEmCache)) {
    console.log(`node.exe ${VERSAO_DO_NODE_EMBUTIDO} reaproveitado do cache.`);
    return;
  }

  const endereco = `https://nodejs.org/dist/${VERSAO_DO_NODE_EMBUTIDO}/${ARQUITETURA}/node.exe`;
  console.log(`Baixando ${endereco} ...`);

  const resposta = await fetch(endereco);
  if (!resposta.ok) {
    throw new Error(
      `Download do node.exe falhou: HTTP ${resposta.status}. ` +
        `Confira se a versão ${VERSAO_DO_NODE_EMBUTIDO} existe em nodejs.org/dist.`,
    );
  }

  await mkdir(pastaDoCache, { recursive: true });
  const conteudo = Buffer.from(await resposta.arrayBuffer());
  await writeFile(caminhoDoNodeEmCache, conteudo);
  console.log(`node.exe baixado (${megabytes(conteudo.length)}).`);
}

/**
 * As dependências vão para a distribuição sem as de desenvolvimento. O
 * `npm ci` é executado numa pasta própria para não mexer no `node_modules` de
 * quem está desenvolvendo.
 */
async function instalarDependenciasDeProducao() {
  const pastaDeInstalacao = join(raizDoProjeto, 'dist', 'dependencias');

  await rm(pastaDeInstalacao, { recursive: true, force: true });
  await mkdir(pastaDeInstalacao, { recursive: true });

  for (const arquivo of ['package.json', 'package-lock.json']) {
    await cp(join(raizDoProjeto, arquivo), join(pastaDeInstalacao, arquivo));
  }

  console.log('Instalando dependências de produção ...');
  /* No Windows o executável é o `npm.cmd`; chamá-lo direto evita passar por shell. */
  const executavelDoNpm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(executavelDoNpm, ['ci', '--omit=dev', '--ignore-scripts'], {
    cwd: pastaDeInstalacao,
    stdio: 'inherit',
  });

  return join(pastaDeInstalacao, 'node_modules');
}

async function montarDistribuicao(caminhoDoNodeModules) {
  await rm(pastaDaDistribuicao, { recursive: true, force: true });
  await mkdir(pastaDaDistribuicao, { recursive: true });

  for (const item of ITENS_COPIADOS) {
    const origem = item === 'node_modules' ? caminhoDoNodeModules : join(raizDoProjeto, item);
    await cp(origem, join(pastaDaDistribuicao, item), {
      recursive: true,
      /* Os testes moram ao lado do código que testam e não vão para a máquina do usuário. */
      filter: (caminho) => !caminho.endsWith('.test.ts'),
    });
  }

  for (const arquivo of ARQUIVOS_DO_INSTALADOR) {
    await cp(join(raizDoProjeto, 'instalador', arquivo), join(pastaDaDistribuicao, arquivo));
  }

  await cp(caminhoDoNodeEmCache, join(pastaDaDistribuicao, 'node.exe'));
  await cp(join(raizDoProjeto, 'LICENSE'), join(pastaDaDistribuicao, 'LICENSE.txt'));
}

/* O Inno Setup lê a versão daqui para carimbar o instalador e o "Programas e Recursos". */
async function gravarVersaoParaOInstalador() {
  const { version } = JSON.parse(await readFile(join(raizDoProjeto, 'package.json'), 'utf8'));
  const caminho = join(raizDoProjeto, 'dist', 'versao.iss');

  await writeFile(caminho, `#define VersaoDoHubSnk "${version}"\n`, 'utf8');
  return version;
}

await obterNodeEmbutido();
const caminhoDoNodeModules = await instalarDependenciasDeProducao();
await montarDistribuicao(caminhoDoNodeModules);
const versao = await gravarVersaoParaOInstalador();

console.log(`\nDistribuição da versão ${versao} pronta em ${pastaDaDistribuicao}`);
console.log('Compile o instalador com: ISCC.exe instalador\\hub-snk.iss');
