/**
 * Confere os links internos da wiki (`site/wiki`): página que não existe, âncora que a
 * página não tem e print que não foi gerado. Sai com código 1 se achar algum.
 *
 *   node verificar-links.mjs
 *
 * Links para fora da wiki (`../`, `http`) não são conferidos.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_DA_WIKI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'wiki');

const paginas = readdirSync(PASTA_DA_WIKI).filter((arquivo) => arquivo.endsWith('.html'));
const idsPorPagina = new Map(
  paginas.map((pagina) => {
    const html = readFileSync(join(PASTA_DA_WIKI, pagina), 'utf8');
    return [pagina, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))];
  }),
);

function ehExterno(endereco) {
  return /^(https?:|mailto:|\.\.\/)/.test(endereco) || endereco === './';
}

const problemas = [];
for (const pagina of paginas) {
  const html = readFileSync(join(PASTA_DA_WIKI, pagina), 'utf8');

  for (const [, endereco] of html.matchAll(/\shref="([^"]+)"/g)) {
    if (ehExterno(endereco) || endereco.endsWith('.css')) continue;
    const [arquivo, ancora] = endereco.split('#');
    const destino = arquivo || pagina;
    if (!idsPorPagina.has(destino)) {
      problemas.push(`${pagina}: página inexistente ${destino}`);
    } else if (ancora && !idsPorPagina.get(destino).has(ancora)) {
      problemas.push(`${pagina}: âncora inexistente ${destino}#${ancora}`);
    }
  }

  for (const [, origem] of html.matchAll(/\ssrc="([^"]+)"/g)) {
    if (ehExterno(origem) || origem.endsWith('.js')) continue;
    if (!existsSync(join(PASTA_DA_WIKI, origem)))
      problemas.push(`${pagina}: print inexistente ${origem}`);
  }
}

for (const problema of problemas) console.log(problema);
console.log(`${problemas.length} problema(s) em ${paginas.length} página(s).`);
process.exitCode = problemas.length ? 1 : 0;
