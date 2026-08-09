/*
 * Leitura do arquivo de favoritos do navegador.
 *
 * O usuário não escolhe o navegador: o formato é descoberto pelo conteúdo do
 * arquivo. Três formatos cobrem Chrome, Edge, Opera, Firefox e Safari:
 *
 * - JSON do Chromium (`roots`): arquivo `Bookmarks` do perfil do Chrome, do
 *   Edge e do Opera;
 * - JSON do Firefox (`text/x-moz-place`): backup em `.json`;
 * - HTML no formato Netscape (`<DT><A HREF>`): exportação de qualquer um dos
 *   cinco navegadores, e o único caminho aberto do Safari.
 *
 * O módulo é puro de propósito — nada de DOM — porque o mesmo código precisa
 * rodar fora do navegador nos testes.
 */

const TIPO_DE_NO_PASTA_DO_CHROMIUM = 'folder';
const TIPO_DE_NO_FAVORITO_DO_CHROMIUM = 'url';

/* Raízes do Chromium que não trazem nome próprio no arquivo. */
const ROTULOS_DE_RAIZ_DO_CHROMIUM = {
  bookmark_bar: 'Barra de favoritos',
  other: 'Outros favoritos',
  synced: 'Favoritos do celular',
};

const TIPO_DE_NO_PASTA_DO_FIREFOX = 'text/x-moz-place-container';
const TIPO_DE_NO_FAVORITO_DO_FIREFOX = 'text/x-moz-place';

/* As raízes do Firefox vêm com título técnico ("menu", "toolbar"). */
const ROTULOS_DE_RAIZ_DO_FIREFOX = {
  toolbarFolder: 'Barra de favoritos',
  bookmarksMenuFolder: 'Menu de favoritos',
  unfiledBookmarksFolder: 'Outros favoritos',
  mobileFolder: 'Favoritos do celular',
};

const NOME_DE_PASTA_SEM_TITULO = 'Sem nome';

/* Assinatura do backup compactado do Firefox (`bookmarks-*.jsonlz4`). */
const ASSINATURA_DO_BACKUP_COMPACTADO_DO_FIREFOX = 'mozLz40';

const NAVEGADORES_SUPORTADOS = 'Chrome, Edge, Opera, Firefox ou Safari';

/*
 * Um passo do HTML Netscape: abertura de lista, fechamento de lista, título de
 * pasta (`H3`) ou favorito (`A`). O arquivo é malformado por definição — as
 * tags `<DT>` e `<p>` nunca fecham —, então a hierarquia sai do par `DL`/`/DL`,
 * não de um parser de HTML.
 */
const PASSO_DO_HTML_NETSCAPE =
  /<dl\b|<\/dl\s*>|<h3\b[^>]*>([\s\S]*?)<\/h3\s*>|<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;

const ENTIDADES_HTML = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

const REFERENCIA_DE_ENTIDADE = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g;

/** O HTML Netscape escapa nomes e URLs; sem DOM, a decodificação é manual. */
function decodificarEntidades(texto) {
  return texto.replace(REFERENCIA_DE_ENTIDADE, (referencia, corpo) => {
    if (corpo.startsWith('#')) {
      const codigo =
        corpo[1] === 'x' || corpo[1] === 'X'
          ? Number.parseInt(corpo.slice(2), 16)
          : Number.parseInt(corpo.slice(1), 10);
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : referencia;
    }

    return ENTIDADES_HTML[corpo.toLowerCase()] ?? referencia;
  });
}

function criarPasta(nome) {
  return { pasta: true, nome: nome.trim() || NOME_DE_PASTA_SEM_TITULO, filhos: [] };
}

/*
 * Nome e URL podem se repetir no mesmo arquivo, então a chave vem de um
 * contador — é ela que identifica o favorito na seleção da árvore.
 */
function criarFavorito(nome, url, contador) {
  contador.proximo += 1;
  const endereco = url.trim();
  return {
    pasta: false,
    chave: `favorito-${contador.proximo}`,
    nome: nome.trim() || endereco,
    url: endereco,
  };
}

/** Pastas vazias só poluiriam a árvore: o usuário não tem o que marcar nelas. */
function podarPastasVazias(nos) {
  const podados = [];

  for (const no of nos) {
    if (!no.pasta) {
      podados.push(no);
      continue;
    }

    no.filhos = podarPastasVazias(no.filhos);
    if (no.filhos.length > 0) {
      podados.push(no);
    }
  }

  return podados;
}

function converterNosDoChromium(nos, contador) {
  const convertidos = [];

  for (const no of nos) {
    if (no?.type === TIPO_DE_NO_PASTA_DO_CHROMIUM) {
      const pasta = criarPasta(no.name ?? '');
      pasta.filhos = converterNosDoChromium(no.children ?? [], contador);
      convertidos.push(pasta);
      continue;
    }

    if (no?.type === TIPO_DE_NO_FAVORITO_DO_CHROMIUM && typeof no.url === 'string') {
      convertidos.push(criarFavorito(no.name ?? '', no.url, contador));
    }
  }

  return convertidos;
}

/*
 * Todas as raízes entram, não uma lista fixa: cada navegador Chromium inventa
 * as suas (`workspaces_v2` no Edge, `custom_root` no Opera).
 */
function lerFavoritosDoChromium(dados) {
  const contador = { proximo: 0 };
  const pastas = [];

  for (const [chave, raiz] of Object.entries(dados.roots)) {
    if (!Array.isArray(raiz?.children)) {
      continue;
    }

    const pasta = criarPasta(raiz.name?.trim() || ROTULOS_DE_RAIZ_DO_CHROMIUM[chave] || chave);
    pasta.filhos = converterNosDoChromium(raiz.children, contador);
    pastas.push(pasta);
  }

  return pastas;
}

function converterNosDoFirefox(nos, contador) {
  const convertidos = [];

  for (const no of nos) {
    if (no?.type === TIPO_DE_NO_PASTA_DO_FIREFOX) {
      const pasta = criarPasta(ROTULOS_DE_RAIZ_DO_FIREFOX[no.root] || no.title || '');
      pasta.filhos = converterNosDoFirefox(no.children ?? [], contador);
      convertidos.push(pasta);
      continue;
    }

    if (no?.type === TIPO_DE_NO_FAVORITO_DO_FIREFOX && typeof no.uri === 'string') {
      convertidos.push(criarFavorito(no.title ?? '', no.uri, contador));
    }
  }

  return convertidos;
}

function lerFavoritosDoFirefox(dados) {
  const contador = { proximo: 0 };
  return converterNosDoFirefox(dados.children ?? [], contador);
}

/**
 * Percorre o HTML Netscape mantendo uma pilha de pastas abertas.
 *
 * Um `<H3>` anuncia a pasta, mas quem a abre é o `<DL>` seguinte; qualquer
 * outro passo entre os dois descarta o anúncio, para que um arquivo truncado
 * não empilhe pasta nenhuma.
 */
function lerFavoritosDoHtmlNetscape(conteudo) {
  const contador = { proximo: 0 };
  const raiz = criarPasta('');
  const pilha = [raiz];
  let pastaAnunciada = null;

  PASSO_DO_HTML_NETSCAPE.lastIndex = 0;

  for (const passo of conteudo.matchAll(PASSO_DO_HTML_NETSCAPE)) {
    const [texto, tituloDaPasta, urlComAspasDuplas, urlComAspasSimples, urlSemAspas, nomeDoFavorito] =
      passo;

    if (tituloDaPasta !== undefined) {
      pastaAnunciada = criarPasta(decodificarEntidades(tituloDaPasta));
      pilha.at(-1).filhos.push(pastaAnunciada);
      continue;
    }

    if (texto.toLowerCase().startsWith('</dl')) {
      pastaAnunciada = null;
      if (pilha.length > 1) {
        pilha.pop();
      }
      continue;
    }

    if (texto.toLowerCase().startsWith('<dl')) {
      pilha.push(pastaAnunciada ?? pilha.at(-1));
      pastaAnunciada = null;
      continue;
    }

    const url = urlComAspasDuplas ?? urlComAspasSimples ?? urlSemAspas ?? '';
    pastaAnunciada = null;
    pilha
      .at(-1)
      .filhos.push(
        criarFavorito(decodificarEntidades(nomeDoFavorito), decodificarEntidades(url), contador),
      );
  }

  return raiz.filhos;
}

function lerFavoritosDeJson(conteudo) {
  let dados;
  try {
    dados = JSON.parse(conteudo);
  } catch {
    throw new Error('O arquivo escolhido não é um JSON válido.');
  }

  if (dados?.roots && typeof dados.roots === 'object') {
    return lerFavoritosDoChromium(dados);
  }

  if (Array.isArray(dados?.children)) {
    return lerFavoritosDoFirefox(dados);
  }

  throw new Error(
    `O arquivo não é um arquivo de favoritos de ${NAVEGADORES_SUPORTADOS}: nenhuma lista de favoritos foi reconhecida.`,
  );
}

/**
 * Descobre o formato pelo conteúdo e devolve a árvore de pastas e favoritos.
 *
 * Lança `Error` com a mensagem exibida ao usuário quando o arquivo não é de
 * favoritos ou quando não sobrou nenhum favorito para importar.
 */
export function lerArvoreDeFavoritos(conteudo) {
  const texto = conteudo.trimStart();

  if (texto.startsWith(ASSINATURA_DO_BACKUP_COMPACTADO_DO_FIREFOX)) {
    throw new Error(
      'O backup .jsonlz4 do Firefox é compactado e não pode ser lido. No Firefox, use "Importar e fazer backup > Exportar favoritos para HTML".',
    );
  }

  const pastas = podarPastasVazias(
    texto.startsWith('{') ? lerFavoritosDeJson(texto) : lerFavoritosDoHtmlNetscape(texto),
  );

  if (pastas.length === 0) {
    throw new Error(
      `Nenhum favorito encontrado no arquivo. Selecione o arquivo de favoritos de ${NAVEGADORES_SUPORTADOS}.`,
    );
  }

  return pastas;
}
