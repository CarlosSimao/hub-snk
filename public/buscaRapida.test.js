import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buscarItens,
  montarItensDaBusca,
  normalizarParaBusca,
  registrarUsoRecente,
} from './buscaRapida.js';

const ROTULOS_DE_TIPO_DE_BASE = { producao: 'Produção', teste: 'Teste', outro: 'Outro' };

function nomeDoRepositorio(repositorio) {
  return (repositorio.caminhoLocal ?? repositorio.url).split(/[\\/]/).pop();
}

const CLIENTE_ALFA = {
  id: 'c1',
  nome: 'Indústria Alfa',
  nomesCompletos: ['ALFA INDUSTRIA LTDA'],
  bases: [
    { id: 'b1', url: 'https://alfa.exemplo:8180/mge', tipo: 'producao', usuario: 'mge' },
    { id: 'b2', url: 'https://alfa.exemplo:8280/mge', tipo: 'teste', usuario: 'sup' },
  ],
  repositorios: [
    {
      id: 'r1',
      url: 'https://github.com/exemplo/addon-faturamento.git',
      caminhoLocal: 'C:\\dev\\addon-faturamento',
    },
  ],
  links: [{ id: 'l1', nome: 'Portal de chamados', url: 'https://chamados.exemplo' }],
  projetos: [
    {
      id: 'p1',
      nome: 'Integração bancária',
      links: [{ id: 'l2', nome: 'Especificação', url: 'https://docs.exemplo/spec' }],
    },
  ],
};

const CLIENTE_BETA = {
  id: 'c2',
  nome: 'Beta Comércio',
  nomesCompletos: [],
  bases: [{ id: 'b3', url: 'https://beta.exemplo/mge', tipo: 'teste', usuario: 'mge' }],
  repositorios: [],
  links: [],
  projetos: [],
};

function montar({ ocultas = [], ...fontes } = {}) {
  return montarItensDaBusca({
    clientes: [CLIENTE_ALFA, CLIENTE_BETA],
    contatos: [
      {
        id: 'k1',
        nome: 'Ana Souza',
        cargo: 'TI',
        telefone: '11 9999',
        email: 'ana@exemplo',
        clienteId: 'c1',
      },
      { id: 'k2', nome: 'Bruno Lima', cargo: '', telefone: '', email: '', clienteId: null },
    ],
    atalhos: [{ id: 'a1', nome: 'DBeaver', caminhoDoExecutavel: 'C:\\dbeaver.exe' }],
    basesLocais: [{ id: 'bl1', nome: 'Local 4.36', porta: 8080, caminhoWildfly: 'C:\\wildfly' }],
    visivel: (chave) => !ocultas.includes(chave),
    rotulosDeTipoDeBase: ROTULOS_DE_TIPO_DE_BASE,
    nomeDoRepositorio,
    ...fontes,
  });
}

function chaves(itens) {
  return itens.map((item) => item.chave);
}

describe('normalizarParaBusca', () => {
  it('tira acento, caixa e espaços das pontas', () => {
    assert.equal(normalizarParaBusca('  Indústria ALFA '), 'industria alfa');
  });

  it('trata ausência de valor como texto vazio', () => {
    assert.equal(normalizarParaBusca(undefined), '');
  });
});

describe('montarItensDaBusca', () => {
  it('indexa todos os tipos do cadastro', () => {
    const tipos = new Set(montar().map((item) => item.tipo));
    assert.deepEqual([...tipos].sort(), [
      'atalho',
      'base',
      'baseLocal',
      'cliente',
      'contato',
      'link',
      'linkDeProjeto',
      'projeto',
      'repositorio',
    ]);
  });

  it('dá à base o nome do cliente e o tipo como título', () => {
    const base = montar().find((item) => item.chave === 'base:b2');
    assert.equal(base.titulo, 'Indústria Alfa — Teste');
    assert.equal(base.abaDoCliente, 'bases');
  });

  it('deixa de fora o que está oculto nos acessos', () => {
    const itens = montar({ ocultas: ['cliente.repositorios', 'cliente.projetos', 'local'] });
    const tipos = new Set(itens.map((item) => item.tipo));
    assert.equal(tipos.has('repositorio'), false);
    assert.equal(tipos.has('projeto'), false);
    assert.equal(tipos.has('linkDeProjeto'), false);
    assert.equal(tipos.has('baseLocal'), false);
  });

  it('manda o contato para o menu Contatos quando a aba do cliente está oculta', () => {
    const contato = montar({ ocultas: ['cliente.contatos'] }).find(
      (item) => item.chave === 'contato:k1',
    );
    assert.equal(contato.clienteId, null);
    assert.equal(contato.abaDoCliente, null);
  });

  it('tira o contato sem cliente quando o menu Contatos está oculto', () => {
    const itens = montar({ ocultas: ['contatos'] });
    assert.equal(chaves(itens).includes('contato:k2'), false);
    assert.equal(chaves(itens).includes('contato:k1'), true);
  });
});

describe('buscarItens', () => {
  const itens = montar();

  it('ignora acento e caixa', () => {
    assert.ok(chaves(buscarItens(itens, 'INDUSTRIA')).includes('cliente:c1'));
  });

  it('exige que toda palavra digitada case', () => {
    const resultado = chaves(buscarItens(itens, 'alfa teste'));
    assert.ok(resultado.includes('base:b2'));
    assert.equal(resultado.includes('base:b1'), false);
    assert.equal(resultado.includes('base:b3'), false);
  });

  it('põe na frente quem casa no começo do título', () => {
    const [primeiro] = buscarItens(itens, 'beta');
    assert.equal(primeiro.chave, 'cliente:c2');
  });

  it('acha pelo que não está no título: URL, usuário, e-mail', () => {
    assert.deepEqual(chaves(buscarItens(itens, '8280')), ['base:b2']);
    assert.deepEqual(chaves(buscarItens(itens, 'ana@exemplo')), ['contato:k1']);
  });

  it('não devolve nada quando nenhuma palavra casa', () => {
    assert.deepEqual(buscarItens(itens, 'zzz'), []);
  });

  it('respeita o limite de resultados', () => {
    assert.equal(buscarItens(itens, 'a', [], 3).length, 3);
  });

  it('com consulta vazia devolve os recentes na ordem do histórico', () => {
    const resultado = buscarItens(itens, '  ', ['atalho:a1', 'removido:x', 'base:b1']);
    assert.deepEqual(chaves(resultado), ['atalho:a1', 'base:b1']);
  });

  it('desempata a favor do usado por último', () => {
    const semHistorico = chaves(buscarItens(itens, 'alfa'));
    const comHistorico = chaves(buscarItens(itens, 'alfa', ['base:b2']));
    assert.notEqual(semHistorico[0], 'base:b2');
    assert.equal(comHistorico[0], 'base:b2');
  });
});

describe('registrarUsoRecente', () => {
  it('põe o item na frente sem repetir', () => {
    assert.deepEqual(registrarUsoRecente(['a', 'b', 'c'], 'b'), ['b', 'a', 'c']);
  });

  it('corta no máximo', () => {
    assert.deepEqual(registrarUsoRecente(['a', 'b'], 'c', 2), ['c', 'a']);
  });
});
