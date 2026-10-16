import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  montarCorpoDaOs,
  montarInformacoesAdicionais,
  validarHorariosDaOs,
} from './lancamentoDeOs.ts';

describe('validarHorariosDaOs', () => {
  it('aceita o dia comum com uma hora de almoço', () => {
    assert.equal(
      validarHorariosDaOs({ horaInicio: '09:00', horaFim: '18:00', intervalo: '01:00' }),
      null,
    );
  });

  it('recusa fim antes ou igual ao início', () => {
    assert.match(
      validarHorariosDaOs({ horaInicio: '18:00', horaFim: '09:00', intervalo: '00:00' }) ?? '',
      /antes da hora final/,
    );
    assert.ok(validarHorariosDaOs({ horaInicio: '09:00', horaFim: '09:00', intervalo: '00:00' }));
  });

  it('recusa intervalo que come o tempo todo', () => {
    assert.match(
      validarHorariosDaOs({ horaInicio: '09:00', horaFim: '10:00', intervalo: '01:00' }) ?? '',
      /intervalo/,
    );
  });

  it('recusa hora fora do formato', () => {
    assert.ok(validarHorariosDaOs({ horaInicio: '9:00', horaFim: '18:00', intervalo: '01:00' }));
    assert.ok(validarHorariosDaOs({ horaInicio: '09:00', horaFim: '24:00', intervalo: '01:00' }));
  });
});

describe('montarCorpoDaOs', () => {
  it('reproduz o corpo que a tela da Experience manda', () => {
    const tarefa = { id: 4496670, task_date: '15/10/2026', horas_previstas: '08:20' };
    const corpo = montarCorpoDaOs({
      implantationId: 9245,
      personId: 2208,
      dia: '2026-10-15',
      horarios: { horaInicio: '09:00', horaFim: '18:00', intervalo: '01:00' },
      informacoesAdicionais: montarInformacoesAdicionais(
        'Etapa: Atendimento\nProcessos: Atendimento Avulso',
        '  Homologação iniciada.  ',
      ),
      tipo: 'CONFORMIDADE',
      tarefas: [tarefa],
    });

    assert.deepEqual(corpo, {
      implantation_id: 9245,
      person_id: 2208,
      date_done: '2026-10-15',
      hour_to_start: '09:00',
      hour_to_finish: '18:00',
      hour_to_lunch: '01:00',
      additional_information:
        'Etapa: Atendimento\nProcessos: Atendimento Avulso\n' +
        '--- Informações Adicionais ---\nHomologação iniciada.',
      additional_notes: '',
      tasks: [tarefa],
      order_type: 'CONFORMIDADE',
      order_email_observation: false,
      assessment_data: null,
    });
  });
});
