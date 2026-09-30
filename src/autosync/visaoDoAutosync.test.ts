import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EntradasDaVisao } from './visaoDoAutosync.ts';
import { montarVisao, normalizarCaminho } from './visaoDoAutosync.ts';

function entradas(parcial: Partial<EntradasDaVisao>): EntradasDaVisao {
  return {
    instalado: true,
    versao: '4.0.0',
    configuracao: null,
    status: null,
    tarefas: [],
    repositoriosPorRaiz: new Map(),
    ...parcial,
  };
}

describe('normalizarCaminho', () => {
  it('casa barras e maiúsculas misturadas, sem barra final', () => {
    assert.equal(normalizarCaminho('C:\\Users\\X\\Repo\\'), normalizarCaminho('c:/users/x/repo'));
  });
});

describe('montarVisao', () => {
  it('une alvo próprio, repositórios da raiz e o que só consta no status', () => {
    const visao = montarVisao(
      entradas({
        configuracao: {
          targets: [
            { path: 'C:\\Proj\\alfa', type: 'repo', enabled: true },
            { path: 'C:/Demandas', type: 'root', enabled: true },
          ],
        },
        status: {
          lastSyncRun: '2026-09-29 17:30:00',
          repos: { 'C:\\Antigo\\removido': { success: true, message: 'ok' } },
        },
        repositoriosPorRaiz: new Map([['C:/Demandas', ['C:\\Demandas\\beta']]]),
      }),
    );

    assert.deepEqual(
      visao.repositorios.map((r) => [r.caminho, r.alvo, r.alvoProprio, r.ativo]),
      [
        ['C:\\Antigo\\removido', '', false, false],
        ['C:\\Demandas\\beta', 'C:/Demandas', false, true],
        ['C:\\Proj\\alfa', 'C:\\Proj\\alfa', true, true],
      ],
    );
    assert.equal(visao.ultimaExecucao, '2026-09-29 17:30:00');
  });

  it('repositório no exclude da raiz fica na lista, mas inativo', () => {
    const visao = montarVisao(
      entradas({
        configuracao: {
          targets: [
            {
              path: 'C:/Demandas',
              type: 'root',
              exclude: ['C:\\DEMANDAS\\gama'],
            },
          ],
        },
        repositoriosPorRaiz: new Map([['C:/Demandas', ['C:\\Demandas\\gama']]]),
      }),
    );

    assert.equal(visao.repositorios[0]?.ativo, false);
    assert.equal(visao.repositorios[0]?.alvo, 'C:/Demandas');
  });

  it('alvo próprio com enabled false fica inativo', () => {
    const visao = montarVisao(
      entradas({
        configuracao: { targets: [{ path: 'C:\\Proj\\alfa', type: 'repo', enabled: false }] },
      }),
    );

    assert.equal(visao.repositorios[0]?.ativo, false);
  });

  it('não junta duas vezes o mesmo repositório escrito de formas diferentes', () => {
    const visao = montarVisao(
      entradas({
        configuracao: { targets: [{ path: 'C:/Proj/Alfa', type: 'repo' }] },
        status: { repos: { 'c:\\proj\\alfa': { success: false, message: 'recusado: .env' } } },
      }),
    );

    assert.equal(visao.repositorios.length, 1);
    assert.equal(visao.repositorios[0]?.estado?.message, 'recusado: .env');
  });

  it('acha a política pelo caminho normalizado', () => {
    const visao = montarVisao(
      entradas({
        configuracao: {
          targets: [{ path: 'C:/Proj/alfa', type: 'repo' }],
          repoPolicies: { 'C:\\Proj\\alfa': { maxFileBytes: 1024 } },
        },
      }),
    );

    assert.deepEqual(visao.repositorios[0]?.politica, { maxFileBytes: 1024 });
  });

  it('usa os padrões do autosync quando o config ainda não existe', () => {
    const visao = montarVisao(entradas({ instalado: false, versao: null }));

    assert.equal(visao.instalado, false);
    assert.deepEqual(visao.horarios, []);
    assert.deepEqual(visao.ia, { ligada: false, agente: 'auto' });
    assert.equal(visao.ramoDoMr, 'main');
    assert.equal(visao.bandeja, false);
  });
});
