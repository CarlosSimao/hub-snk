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
import { cp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  baixarComCache,
  copiarProgramaParaPasta,
  instalarDependenciasDeProducao,
  lerVersaoDoProjeto,
  pastaDoCache,
  raizDoProjeto,
  VERSAO_DO_NODE_EMBUTIDO,
} from './empacotar-comum.mjs';

const ARQUITETURA = 'win-x64';
const ARQUIVOS_DO_INSTALADOR = ['abrir-hub-snk.vbs'];

const pastaDaDistribuicao = join(raizDoProjeto, 'dist', 'windows');

/*
 * O node.exe é publicado avulso, sem compactação em volta — dá para gravar a
 * resposta direto, sem precisar de um descompactador.
 */
async function obterNodeEmbutido() {
  return baixarComCache(
    `https://nodejs.org/dist/${VERSAO_DO_NODE_EMBUTIDO}/${ARQUITETURA}/node.exe`,
    join(pastaDoCache, `node-${VERSAO_DO_NODE_EMBUTIDO}-${ARQUITETURA}.exe`),
  );
}

/* O Inno Setup lê a versão daqui para carimbar o instalador e o "Programas e Recursos". */
async function gravarVersaoParaOInstalador(versao) {
  const caminho = join(raizDoProjeto, 'dist', 'versao.iss');
  await writeFile(caminho, `#define VersaoDoHubSnk "${versao}"\n`, 'utf8');
}

const caminhoDoNode = await obterNodeEmbutido();
const caminhoDoNodeModules = await instalarDependenciasDeProducao();

await copiarProgramaParaPasta(pastaDaDistribuicao, caminhoDoNodeModules);

for (const arquivo of ARQUIVOS_DO_INSTALADOR) {
  await cp(join(raizDoProjeto, 'instalador', arquivo), join(pastaDaDistribuicao, arquivo));
}

await cp(caminhoDoNode, join(pastaDaDistribuicao, 'node.exe'));
await cp(join(raizDoProjeto, 'LICENSE'), join(pastaDaDistribuicao, 'LICENSE.txt'));

const versao = await lerVersaoDoProjeto();
await gravarVersaoParaOInstalador(versao);

console.log(`\nDistribuição da versão ${versao} pronta em ${pastaDaDistribuicao}`);
console.log('Compile o instalador com: ISCC.exe instalador\\hub-snk.iss');
