/*
 * Busca rápida (Ctrl+K): índice do cadastro e ordenação dos resultados.
 *
 * Cada item vira uma entrada com título, detalhe e o texto em que a busca
 * procura, já sem acento e em minúsculas — normalizar uma vez na montagem
 * poupa refazer isso a cada tecla.
 *
 * O módulo é puro de propósito — nada de DOM — porque o mesmo código precisa
 * rodar fora do navegador nos testes. O que depende da tela (rótulos, nome de
 * exibição do repositório, acessos) chega por parâmetro.
 */

export const LIMITE_DE_RESULTADOS = 30;

/* Quantos itens usados por último o histórico guarda. */
export const MAXIMO_DE_RECENTES = 10;

export const ROTULOS_DOS_TIPOS = {
  cliente: 'Cliente',
  base: 'Base',
  repositorio: 'Repositório',
  link: 'Link',
  projeto: 'Projeto',
  linkDeProjeto: 'Link de projeto',
  contato: 'Contato',
  atalho: 'Atalho',
  baseLocal: 'Base local',
};

/* Desempate entre itens com a mesma pontuação: o que mais se abre vem antes. */
const ORDEM_DOS_TIPOS = Object.keys(ROTULOS_DOS_TIPOS);

/*
 * Pontos por palavra digitada, conforme onde ela casa. Começo do título pesa
 * mais que começo de qualquer palavra dele, que pesa mais que o resto do
 * texto (cliente, URL, usuário), que pesa mais que um trecho no meio.
 */
const PONTOS_NO_INICIO_DO_TITULO = 8;
const PONTOS_NO_INICIO_DE_PALAVRA_DO_TITULO = 4;
const PONTOS_NO_INICIO_DE_PALAVRA_DOS_TERMOS = 2;
const PONTOS_EM_TRECHO = 1;

/* Bônus máximo do item usado por último; cai até zero ao longo do histórico. */
const PONTOS_DE_USO_RECENTE = 3;

const DIACRITICOS = /\p{Diacritic}/gu;
const FORA_DE_LETRA_OU_DIGITO = /[^\p{L}\p{N}]+/u;

export function normalizarParaBusca(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(DIACRITICOS, '')
    .toLowerCase()
    .trim();
}

function palavrasDe(textoNormalizado) {
  return textoNormalizado.split(FORA_DE_LETRA_OU_DIGITO).filter(Boolean);
}

function criarItem({
  chave,
  tipo,
  titulo,
  detalhe = '',
  termos = [],
  clienteId = null,
  aba = null,
  dados,
}) {
  const tituloNormalizado = normalizarParaBusca(titulo);
  const termosNormalizados = normalizarParaBusca([titulo, detalhe, ...termos].join(' '));

  return {
    chave,
    tipo,
    titulo,
    detalhe,
    clienteId,
    abaDoCliente: aba,
    dados,
    indice: {
      titulo: tituloNormalizado,
      termos: termosNormalizados,
      palavrasDoTitulo: palavrasDe(tituloNormalizado),
      palavrasDosTermos: palavrasDe(termosNormalizados),
    },
  };
}

function juntarDetalhes(...partes) {
  return partes.filter(Boolean).join(' · ');
}

function itemDoCliente(cliente) {
  return criarItem({
    chave: `cliente:${cliente.id}`,
    tipo: 'cliente',
    titulo: cliente.nome,
    detalhe: (cliente.nomesCompletos ?? []).join(' · '),
    clienteId: cliente.id,
    dados: { cliente },
  });
}

function itemDaBase(cliente, base, rotulosDeTipoDeBase) {
  const rotuloDoTipo = rotulosDeTipoDeBase[base.tipo] ?? base.tipo;
  return criarItem({
    chave: `base:${base.id}`,
    tipo: 'base',
    titulo: `${cliente.nome} — ${rotuloDoTipo}`,
    detalhe: juntarDetalhes(base.url, base.usuario),
    clienteId: cliente.id,
    aba: 'bases',
    dados: { cliente, base },
  });
}

function itemDoRepositorio(cliente, repositorio, nomeDoRepositorio) {
  return criarItem({
    chave: `repositorio:${repositorio.id}`,
    tipo: 'repositorio',
    titulo: nomeDoRepositorio(repositorio),
    detalhe: juntarDetalhes(cliente.nome, repositorio.caminhoLocal ?? repositorio.url),
    termos: [repositorio.url],
    clienteId: cliente.id,
    aba: 'repositorios',
    dados: { cliente, repositorio },
  });
}

function itemDoLink(cliente, link) {
  return criarItem({
    chave: `link:${link.id}`,
    tipo: 'link',
    titulo: link.nome,
    detalhe: juntarDetalhes(cliente.nome, link.url),
    clienteId: cliente.id,
    aba: 'geral',
    dados: { cliente, link },
  });
}

function itensDoProjeto(cliente, projeto) {
  const itemDoProjeto = criarItem({
    chave: `projeto:${projeto.id}`,
    tipo: 'projeto',
    titulo: projeto.nome,
    detalhe: cliente.nome,
    clienteId: cliente.id,
    aba: 'projetos',
    dados: { cliente, projeto },
  });

  const itensDosLinks = (projeto.links ?? []).map((link) =>
    criarItem({
      chave: `link:${link.id}`,
      tipo: 'linkDeProjeto',
      titulo: link.nome,
      detalhe: juntarDetalhes(cliente.nome, projeto.nome, link.url),
      clienteId: cliente.id,
      aba: 'projetos',
      dados: { cliente, projeto, link },
    }),
  );

  return [itemDoProjeto, ...itensDosLinks];
}

function itensDoCliente(cliente, contexto) {
  const { visivel, rotulosDeTipoDeBase, nomeDoRepositorio } = contexto;
  const itens = [itemDoCliente(cliente)];

  if (visivel('cliente.bases')) {
    itens.push(...cliente.bases.map((base) => itemDaBase(cliente, base, rotulosDeTipoDeBase)));
  }
  if (visivel('cliente.repositorios')) {
    itens.push(
      ...cliente.repositorios.map((repositorio) =>
        itemDoRepositorio(cliente, repositorio, nomeDoRepositorio),
      ),
    );
  }
  itens.push(...(cliente.links ?? []).map((link) => itemDoLink(cliente, link)));
  if (visivel('cliente.projetos')) {
    itens.push(...(cliente.projetos ?? []).flatMap((projeto) => itensDoProjeto(cliente, projeto)));
  }

  return itens;
}

/*
 * O contato só entra se houver onde mostrá-lo: na aba Contatos do cliente dele
 * ou no menu Contatos. Quem abre é a tela, que decide entre os dois.
 */
function itemDoContato(contato, clientesPorId, visivel) {
  const cliente = contato.clienteId ? clientesPorId.get(contato.clienteId) : null;
  const visivelNoCliente = Boolean(cliente) && visivel('cliente.contatos');
  if (!visivelNoCliente && !visivel('contatos')) {
    return null;
  }

  return criarItem({
    chave: `contato:${contato.id}`,
    tipo: 'contato',
    titulo: contato.nome,
    detalhe: juntarDetalhes(contato.cargo, cliente?.nome, contato.telefone, contato.email),
    clienteId: visivelNoCliente ? cliente.id : null,
    aba: visivelNoCliente ? 'contatos' : null,
    dados: { contato, cliente: visivelNoCliente ? cliente : null },
  });
}

function itemDoAtalho(atalho) {
  return criarItem({
    chave: `atalho:${atalho.id}`,
    tipo: 'atalho',
    titulo: atalho.nome,
    detalhe: atalho.caminhoDoExecutavel,
    dados: { atalho },
  });
}

function itemDaBaseLocal(base) {
  return criarItem({
    chave: `baseLocal:${base.id}`,
    tipo: 'baseLocal',
    titulo: base.nome,
    detalhe: juntarDetalhes(`localhost:${base.porta}`, base.caminhoWildfly),
    dados: { base },
  });
}

/**
 * Monta a lista de itens em que a busca procura.
 *
 * `visivel(chave)` responde se a funcionalidade está visível em Configurações ›
 * Acessos: o que a tela esconde a busca também não mostra.
 */
export function montarItensDaBusca({
  clientes = [],
  contatos = [],
  atalhos = [],
  basesLocais = [],
  visivel,
  rotulosDeTipoDeBase,
  nomeDoRepositorio,
}) {
  const contexto = { visivel, rotulosDeTipoDeBase, nomeDoRepositorio };
  const clientesPorId = new Map(clientes.map((cliente) => [cliente.id, cliente]));

  return [
    ...clientes.flatMap((cliente) => itensDoCliente(cliente, contexto)),
    ...contatos.map((contato) => itemDoContato(contato, clientesPorId, visivel)).filter(Boolean),
    ...atalhos.map(itemDoAtalho),
    ...(visivel('local') ? basesLocais.map(itemDaBaseLocal) : []),
  ];
}

function pontosDaPalavra(indice, palavra) {
  if (indice.titulo.startsWith(palavra)) {
    return PONTOS_NO_INICIO_DO_TITULO;
  }
  if (indice.palavrasDoTitulo.some((candidata) => candidata.startsWith(palavra))) {
    return PONTOS_NO_INICIO_DE_PALAVRA_DO_TITULO;
  }
  if (indice.palavrasDosTermos.some((candidata) => candidata.startsWith(palavra))) {
    return PONTOS_NO_INICIO_DE_PALAVRA_DOS_TERMOS;
  }
  return indice.termos.includes(palavra) ? PONTOS_EM_TRECHO : 0;
}

/* Toda palavra digitada precisa casar: uma que não case descarta o item (nulo). */
function pontosDoItem(item, palavras, posicoesRecentes) {
  let pontos = 0;
  for (const palavra of palavras) {
    const pontosDaVez = pontosDaPalavra(item.indice, palavra);
    if (pontosDaVez === 0) {
      return null;
    }
    pontos += pontosDaVez;
  }

  const posicao = posicoesRecentes.get(item.chave);
  if (posicao !== undefined) {
    pontos += (PONTOS_DE_USO_RECENTE * (MAXIMO_DE_RECENTES - posicao)) / MAXIMO_DE_RECENTES;
  }
  return pontos;
}

function compararResultados(a, b) {
  return (
    b.pontos - a.pontos ||
    ORDEM_DOS_TIPOS.indexOf(a.item.tipo) - ORDEM_DOS_TIPOS.indexOf(b.item.tipo) ||
    a.item.titulo.localeCompare(b.item.titulo, 'pt-BR')
  );
}

/**
 * Itens que casam com a consulta, do mais relevante ao menos.
 *
 * Consulta vazia devolve os usados por último, na ordem do histórico — é o que
 * a busca mostra ao abrir.
 */
export function buscarItens(itens, consulta, recentes = [], limite = LIMITE_DE_RESULTADOS) {
  const palavras = palavrasDe(normalizarParaBusca(consulta));

  if (palavras.length === 0) {
    const itensPorChave = new Map(itens.map((item) => [item.chave, item]));
    return recentes
      .map((chave) => itensPorChave.get(chave))
      .filter(Boolean)
      .slice(0, limite);
  }

  const posicoesRecentes = new Map(recentes.map((chave, posicao) => [chave, posicao]));
  return itens
    .map((item) => ({ item, pontos: pontosDoItem(item, palavras, posicoesRecentes) }))
    .filter((resultado) => resultado.pontos !== null)
    .sort(compararResultados)
    .slice(0, limite)
    .map((resultado) => resultado.item);
}

/** Histórico com o item recém-usado na frente, sem repetição e no tamanho máximo. */
export function registrarUsoRecente(recentes, chave, maximo = MAXIMO_DE_RECENTES) {
  return [chave, ...recentes.filter((outra) => outra !== chave)].slice(0, maximo);
}
