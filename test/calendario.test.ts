/**
 * O cruzamento entre a Agenda de Recursos do ERP e a Experience.
 *
 * Esta e a regra que decide o que o painel acusa como pendencia, e ela mora no
 * frontend de proposito (ver o comentario de `resumirMes`). Testar daqui mantem a
 * decisao presa: e barato marcar um dia como "trabalhado sem OS" por engano, e quem
 * olha a tela nao tem como desconfiar.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  cruzarDia,
  montarGrade,
  resumirMes,
  type Cruzamento,
} from '../web/src/lib/calendario.ts';
import type { EventoComRecurso, OrdemExperience, TarefaExperience } from '../src/types.ts';

const HOJE = '2026-09-11';

/** So os campos que a regra le; o resto do objeto real nao muda o veredito. */
function tarefa(dia: string, status = 'Em andamento'): TarefaExperience {
  return { dia, taskStatus: status } as unknown as TarefaExperience;
}

function ordem(dia: string, statusAceite = ''): OrdemExperience {
  return { id: Number(dia.slice(-2)), dia, statusAceite } as unknown as OrdemExperience;
}

function evento(dia: string, ate = dia): EventoComRecurso {
  return {
    id: Number(dia.slice(-2)),
    inicio: `${dia} 08:00:00`,
    fim: `${ate} 18:00:00`,
  } as unknown as EventoComRecurso;
}

describe('cruzarDia', () => {
  const casos: [string, { eventos: number; ordens: number; tarefas: number }, string, Cruzamento][] = [
    ['dia passado alocado e faturado', { eventos: 1, ordens: 1, tarefas: 0 }, '2026-09-01', 'casado'],
    ['dia passado alocado sem OS', { eventos: 1, ordens: 0, tarefas: 0 }, '2026-09-01', 'alocado-sem-os'],
    ['OS num dia sem alocação', { eventos: 0, ordens: 1, tarefas: 0 }, '2026-09-01', 'os-sem-alocacao'],
    ['só tarefa em aberto', { eventos: 0, ordens: 0, tarefas: 1 }, '2026-09-01', 'so-experience'],
    ['dia sem nada', { eventos: 0, ordens: 0, tarefas: 0 }, '2026-09-01', 'vazio'],
    // O futuro nao pode virar cobranca: um dia alocado que ainda nao chegou nao e OS
    // que faltou. Sem esta regra, importar a agenda acenderia o mes inteiro de amarelo.
    ['dia futuro alocado', { eventos: 1, ordens: 0, tarefas: 0 }, '2026-09-30', 'so-erp'],
    ['hoje alocado, ainda sem OS', { eventos: 1, ordens: 0, tarefas: 0 }, HOJE, 'so-erp'],
  ];

  for (const [nome, quantos, dia, esperado] of casos) {
    test(`${nome} -> ${esperado}`, () => {
      const veredito = cruzarDia(
        {
          dia,
          eventos: Array.from({ length: quantos.eventos }, () => evento(dia)),
          ordens: Array.from({ length: quantos.ordens }, () => ordem(dia)),
          tarefas: Array.from({ length: quantos.tarefas }, () => tarefa(dia)),
        },
        HOJE,
      );
      assert.equal(veredito, esperado);
    });
  }
});

describe('montarGrade — cruzamento', () => {
  test('evento de vários dias marca todos os dias que cobre', () => {
    const grade = montarGrade(
      '2026-09',
      { tarefas: [], ordens: [] },
      [evento('2026-09-01', '2026-09-03')],
      HOJE,
    );
    const dias = grade.filter((d) => d.cruzamento === 'alocado-sem-os').map((d) => d.dia);

    assert.deepEqual(dias, ['2026-09-01', '2026-09-02', '2026-09-03']);
  });

  test('sem eventos, nenhum dia é acusado de alocação', () => {
    const grade = montarGrade(
      '2026-09',
      { tarefas: [tarefa('2026-09-02')], ordens: [ordem('2026-09-02')] },
      [],
      HOJE,
    );

    assert.ok(!grade.some((d) => d.cruzamento === 'alocado-sem-os'));
    // Sem o lado do ERP, uma OS não tem como estar "fora de alocação" — a tela só
    // mostra o placar quando os dois lados estão cadastrados, mas a regra também não
    // pode inventar divergência a partir de um lado só.
    assert.equal(grade.find((d) => d.dia === '2026-09-02')?.cruzamento, 'os-sem-alocacao');
  });
});

describe('resumirMes — com a agenda do ERP', () => {
  const agenda = {
    tarefas: [tarefa('2026-09-02')],
    ordens: [ordem('2026-09-02', 'Concluído'), ordem('2026-09-08', 'Concluído')],
  };
  const eventos = [evento('2026-09-02'), evento('2026-09-03'), evento('2026-09-30')];

  test('conta os três estados do cruzamento', () => {
    const resumo = resumirMes('2026-09', agenda, eventos, HOJE);

    assert.equal(resumo.diasCasados, 1, '02/09 tem evento e OS');
    assert.equal(resumo.diasAlocadosSemOs, 1, '03/09 é passado, alocado e sem OS');
    assert.equal(resumo.diasOsSemAlocacao, 1, '08/09 tem OS e nenhum evento');
  });

  test('dia alocado sem OS acende o amarelo', () => {
    assert.equal(resumirMes('2026-09', agenda, eventos, HOJE).status, 'atencao');

    // Sem o 03/09 solto, nada resta pendente — as duas OS estão concluídas.
    const semPendencia = resumirMes('2026-09', agenda, [evento('2026-09-02')], HOJE);
    assert.equal(semPendencia.status, 'ok');
  });

  test('dia só com evento entra em diasComAtuacao', () => {
    // Antes do cruzamento este dia não contava: só tarefa e OS contavam como atuação,
    // e um dia alocado no ERP passava batido.
    assert.ok(resumirMes('2026-09', agenda, eventos, HOJE).diasComAtuacao >= 3);
  });

  test('sem eventos, o resumo não muda de comportamento', () => {
    const resumo = resumirMes('2026-09', agenda, [], HOJE);

    assert.equal(resumo.diasAlocadosSemOs, 0);
    assert.equal(resumo.diasCasados, 0);
  });
});
