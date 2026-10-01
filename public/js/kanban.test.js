import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cartoesDaColuna, indiceAoSoltar, progressoDasTarefas } from './kanban.js';

function tarefa(id, demandaId, estado, ordem, estimativaHoras = 0) {
  return { id, demandaId, estado, ordem, estimativaHoras };
}

describe('progressoDasTarefas', () => {
  it('soma tarefas e horas, e o que já está concluído', () => {
    const progresso = progressoDasTarefas([
      tarefa(1, 1, 'backlog', 0, 4),
      tarefa(2, 1, 'concluido', 0, 2.5),
      tarefa(3, 1, 'concluido', 1, 1),
    ]);

    assert.deepEqual(progresso, { total: 3, concluidas: 2, horas: 7.5, horasConcluidas: 3.5 });
  });
});

describe('cartoesDaColuna', () => {
  it('ordena pela ordem de cada kanban e desempata pelo kanban', () => {
    const tarefas = [
      tarefa(1, 2, 'backlog', 0),
      tarefa(2, 1, 'backlog', 1),
      tarefa(3, 1, 'backlog', 0),
      tarefa(4, 1, 'concluido', 0),
    ];

    assert.deepEqual(
      cartoesDaColuna(tarefas, 'backlog').map((cartao) => cartao.id),
      [3, 1, 2],
    );
  });
});

describe('indiceAoSoltar', () => {
  const coluna = [
    tarefa(10, 1, 'a_fazer', 0),
    tarefa(20, 2, 'a_fazer', 0),
    tarefa(11, 1, 'a_fazer', 1),
  ];

  it('conta só os cartões do mesmo kanban antes do ponto de soltura', () => {
    const movida = tarefa(12, 1, 'backlog', 0);

    assert.equal(indiceAoSoltar(coluna, movida, coluna[1]), 1);
    assert.equal(indiceAoSoltar(coluna, movida, coluna[0]), 0);
    assert.equal(indiceAoSoltar(coluna, movida, null), 2);
  });

  it('ignora o próprio cartão ao reordenar dentro da coluna', () => {
    const movida = coluna[0];

    assert.equal(indiceAoSoltar(coluna, movida, null), 1);
    assert.equal(indiceAoSoltar(coluna, movida, coluna[2]), 0);
  });
});
