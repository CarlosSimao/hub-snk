import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Cliente } from '../tipos.ts';
import {
  classificarRepositoriosDosClientes,
  sugerirRaizes,
  vincularClientes,
  type SituacaoDaPasta,
} from './sincronizacaoComClientes.ts';
import type { AlvoDoAutosync } from './tiposDoAutosync.ts';
import { montarVisao } from './visaoDoAutosync.ts';

function criarCliente(id: string, caminhos: (string | undefined)[]): Cliente {
  return {
    id,
    nome: `Cliente ${id}`,
    anotacoes: '',
    bases: [],
    repositorios: caminhos.map((caminhoLocal, indice) => ({
      id: `${id}-r${indice}`,
      url: `https://gitlab.exemplo/${id}/${indice}.git`,
      ...(caminhoLocal === undefined ? {} : { caminhoLocal }),
    })),
    links: [],
    projetos: [],
    nomesCompletos: [],
    criadoEm: '2026-01-01T00:00:00.000Z',
    atualizadoEm: '2026-01-01T00:00:00.000Z',
  };
}

function visaoCom(alvos: AlvoDoAutosync[]) {
  return montarVisao({
    instalado: true,
    versao: null,
    configuracao: { targets: alvos },
    status: null,
    tarefas: [],
    repositoriosPorRaiz: new Map(),
  });
}

const SEMPRE_REPOSITORIO = (): SituacaoDaPasta => 'repositorio';

describe('classificarRepositoriosDosClientes', () => {
  const alvos: AlvoDoAutosync[] = [
    { path: 'C:\\Proj\\proprio', type: 'repo', enabled: true },
    { path: 'C:\\Proj\\desligado', type: 'repo', enabled: false },
    { path: 'C:/Demandas', type: 'root', enabled: true, exclude: ['C:\\Demandas\\excluido'] },
  ];

  const casos: [string, string, SituacaoDaPasta, string, string | null][] = [
    ['fora do autosync', 'C:\\Outro\\novo', 'repositorio', 'fora', null],
    ['alvo próprio ativo', 'C:/proj/PROPRIO', 'repositorio', 'ativo', null],
    ['coberto pela raiz', 'C:\\Demandas\\coberto', 'repositorio', 'ativo', 'C:/Demandas'],
    ['excluído da raiz', 'C:\\Demandas\\excluido', 'repositorio', 'excluido', 'C:/Demandas'],
    ['alvo próprio desligado', 'C:\\Proj\\desligado', 'repositorio', 'desligado', null],
    ['pasta ausente', 'C:\\Proj\\proprio', 'ausente', 'pasta-ausente', null],
    ['não é repositório', 'C:\\Outro\\pasta', 'nao-e-repositorio', 'nao-e-repositorio', null],
    ['neto da raiz não é coberto', 'C:\\Demandas\\sub\\neto', 'repositorio', 'fora', null],
  ];

  for (const [nome, caminho, pasta, situacao, raiz] of casos) {
    it(nome, () => {
      const [repositorio] = classificarRepositoriosDosClientes(
        [criarCliente('a', [caminho])],
        visaoCom(alvos),
        () => pasta,
      );

      assert.equal(repositorio?.situacao, situacao);
      assert.equal(repositorio?.raiz, raiz);
    });
  }

  it('ignora repositório sem pasta local', () => {
    const repositorios = classificarRepositoriosDosClientes(
      [criarCliente('a', [undefined, '  '])],
      visaoCom([]),
      SEMPRE_REPOSITORIO,
    );

    assert.deepEqual(repositorios, []);
  });
});

describe('sugerirRaizes', () => {
  it('sugere o pai com três ou mais repositórios fora do autosync', () => {
    const repositorios = classificarRepositoriosDosClientes(
      [
        criarCliente('a', ['C:\\Demandas\\a', 'C:\\Demandas\\b']),
        criarCliente('b', ['C:\\demandas\\c', 'C:\\Outro\\d']),
      ],
      visaoCom([]),
      SEMPRE_REPOSITORIO,
    );

    const sugestoes = sugerirRaizes(repositorios);

    assert.equal(sugestoes.length, 1);
    assert.equal(sugestoes[0]?.quantidade, 3);
    assert.equal(sugestoes[0]?.pasta, 'C:\\Demandas');
  });
});

describe('vincularClientes', () => {
  it('marca o dono do repositório pelo caminho normalizado', () => {
    const visao = vincularClientes(visaoCom([{ path: 'C:/Proj/alfa', type: 'repo' }]), [
      criarCliente('x', ['c:\\proj\\alfa']),
    ]);

    assert.equal(visao.repositorios[0]?.clienteId, 'x');
    assert.equal(visao.repositorios[0]?.clienteNome, 'Cliente x');
  });
});
