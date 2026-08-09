/*
 * Sincroniza o nome do cache do service worker com a versão do package.json.
 *
 * O navegador só busca o shell de novo quando o nome do cache muda. Sem isso,
 * uma versão nova instalada continuaria abrindo a janela com o HTML, o CSS e o
 * JavaScript da versão anterior — e o usuário juraria que a atualização não
 * chegou.
 *
 * Roda sozinho no `npm version`, pelo hook de mesmo nome.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raizDoProjeto = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAMINHO_DO_SERVICE_WORKER = join(raizDoProjeto, 'public', 'sw.js');
const CAMINHO_DO_PACOTE = join(raizDoProjeto, 'package.json');

const DECLARACAO_DO_CACHE = /^const VERSAO_DO_CACHE = '[^']*';$/m;

const { version } = JSON.parse(await readFile(CAMINHO_DO_PACOTE, 'utf8'));
const conteudo = await readFile(CAMINHO_DO_SERVICE_WORKER, 'utf8');

if (!DECLARACAO_DO_CACHE.test(conteudo)) {
  console.error(
    `Não encontrei a linha "const VERSAO_DO_CACHE = '...';" em ${CAMINHO_DO_SERVICE_WORKER}. ` +
      'Se ela foi renomeada, ajuste este script — sem o nome do cache mudando, a atualização ' +
      'não chega ao navegador de quem já usa o HUB SNK.',
  );
  process.exit(1);
}

const nomeDoCache = `hub-snk-v${version}`;
const atualizado = conteudo.replace(
  DECLARACAO_DO_CACHE,
  `const VERSAO_DO_CACHE = '${nomeDoCache}';`,
);

if (atualizado === conteudo) {
  console.log(`Cache do service worker já estava em ${nomeDoCache}.`);
  process.exit(0);
}

await writeFile(CAMINHO_DO_SERVICE_WORKER, atualizado, 'utf8');
console.log(`Cache do service worker atualizado para ${nomeDoCache}.`);
