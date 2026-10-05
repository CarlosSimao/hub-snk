/**
 * Prepara a versão de correção (PATCH) que vai sair com um pull request do Mano.
 *
 * Faz, no branch do pull request, o mesmo que o passo a passo de "Publicando uma versão"
 * em docs/manutencao.md: sobe o número na raiz e no `desktop/` (o workflow de
 * Distribuição recusa a tag se os dois não baterem com ela) e move o `[Não publicado]`
 * do CHANGELOG para uma seção com o número e a data.
 *
 * Sempre PATCH: o Mano publica correção. Versão com funcionalidade nova ou mudança de
 * formato de dados (MINOR/MAJOR) continua saindo pelo processo manual. A parte MAJOR só
 * sobe por ordem explícita do dono (o projeto fica na linha 2.x.x).
 *
 * Uso: node .github/mano/preparar-versao.cjs "<título do pull request>"
 * Imprime o número novo na saída padrão.
 */
const fs = require('node:fs');

const REPOSITORIO = 'https://github.com/CarlosSimao/hub-snk';

function proximaVersao(atual) {
  const partes = /^(\d+)\.(\d+)\.(\d+)$/.exec(atual);
  if (!partes) throw new Error(`versão fora do formato X.Y.Z: ${atual}`);
  return `${partes[1]}.${partes[2]}.${Number(partes[3]) + 1}`;
}

/** Troca só as `quantas` primeiras ocorrências: no lock, são a do topo e a do pacote raiz. */
function trocarVersao(texto, antiga, nova, quantas) {
  let trocadas = 0;
  const alvo = `"version": "${antiga}"`;
  const resultado = texto.replaceAll(alvo, (achado) => {
    trocadas += 1;
    return trocadas <= quantas ? `"version": "${nova}"` : achado;
  });
  if (trocadas < quantas)
    throw new Error(`esperava ${quantas} ocorrência(s) da versão ${antiga}, achei ${trocadas}`);
  return resultado;
}

function atualizarChangelog(texto, antiga, nova, data, titulo) {
  const marcador = '## [Não publicado]';
  const inicio = texto.indexOf(marcador);
  if (inicio === -1) throw new Error('CHANGELOG sem a seção [Não publicado]');
  const depois = inicio + marcador.length;
  const proxima = texto.indexOf('\n## [', depois);
  if (proxima === -1) throw new Error('CHANGELOG sem versão anterior');

  let conteudo = texto.slice(depois, proxima).trim();
  // Sem nada anotado, a entrada sai do título do pull request.
  if (!conteudo) conteudo = `### Corrigido\n\n- ${titulo.replace(/^mano:\s*/i, '').trim()}`;

  let resultado = `${texto.slice(0, depois)}\n\n## [${nova}] - ${data}\n\n${conteudo}\n${texto.slice(proxima)}`;

  const linkAnterior = `[${antiga}]: `;
  const posicaoDoLink = resultado.indexOf(`\n${linkAnterior}`);
  if (posicaoDoLink === -1) throw new Error(`CHANGELOG sem o link da versão ${antiga}`);
  resultado =
    `${resultado.slice(0, posicaoDoLink + 1)}[${nova}]: ${REPOSITORIO}/compare/v${antiga}...v${nova}\n` +
    resultado.slice(posicaoDoLink + 1);
  return resultado;
}

function preparar(titulo, data) {
  const antiga = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  const doDesktop = JSON.parse(fs.readFileSync('desktop/package.json', 'utf8')).version;
  if (doDesktop !== antiga) throw new Error(`raiz está em ${antiga} e desktop em ${doDesktop}`);
  const nova = proximaVersao(antiga);

  for (const [arquivo, quantas] of [
    ['package.json', 1],
    ['desktop/package.json', 1],
    ['package-lock.json', 2],
    ['desktop/package-lock.json', 2],
  ]) {
    fs.writeFileSync(
      arquivo,
      trocarVersao(fs.readFileSync(arquivo, 'utf8'), antiga, nova, quantas),
    );
  }
  fs.writeFileSync(
    'CHANGELOG.md',
    atualizarChangelog(fs.readFileSync('CHANGELOG.md', 'utf8'), antiga, nova, data, titulo),
  );
  return nova;
}

if (require.main === module) {
  const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  process.stdout.write(preparar(process.argv[2] ?? 'correção', hoje));
}

module.exports = { proximaVersao, trocarVersao, atualizarChangelog };
