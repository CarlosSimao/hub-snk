import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ultimoHorarioAgendado, type AgendaDoBackup } from './agendaDoBackup.ts';

const AGENDA: AgendaDoBackup = {
  frequencia: 'diaria',
  horario: '18:00',
  diaDaSemana: 5,
  diaDoMes: 1,
};

/* Quarta-feira, 14/10/2026, na hora local. */
const QUARTA_10H = new Date(2026, 9, 14, 10, 0);
const QUARTA_19H = new Date(2026, 9, 14, 19, 0);

describe('ultimoHorarioAgendado', () => {
  it('diária: o de hoje, se já passou; senão o de ontem', () => {
    assert.deepEqual(ultimoHorarioAgendado(QUARTA_19H, AGENDA), new Date(2026, 9, 14, 18, 0));
    assert.deepEqual(ultimoHorarioAgendado(QUARTA_10H, AGENDA), new Date(2026, 9, 13, 18, 0));
  });

  it('semanal: a última sexta no horário, inclusive a de hoje', () => {
    const semanal = { ...AGENDA, frequencia: 'semanal' } as const;
    assert.deepEqual(ultimoHorarioAgendado(QUARTA_10H, semanal), new Date(2026, 9, 9, 18, 0));
    const naSextaDepois = new Date(2026, 9, 16, 18, 30);
    assert.deepEqual(ultimoHorarioAgendado(naSextaDepois, semanal), new Date(2026, 9, 16, 18, 0));
    const naSextaAntes = new Date(2026, 9, 16, 17, 59);
    assert.deepEqual(ultimoHorarioAgendado(naSextaAntes, semanal), new Date(2026, 9, 9, 18, 0));
  });

  it('mensal: o dia deste mês, se já passou; senão o do mês anterior, também na virada do ano', () => {
    const mensal = { ...AGENDA, frequencia: 'mensal', diaDoMes: 20 } as const;
    assert.deepEqual(ultimoHorarioAgendado(QUARTA_10H, mensal), new Date(2026, 8, 20, 18, 0));
    assert.deepEqual(
      ultimoHorarioAgendado(new Date(2026, 9, 21, 8, 0), mensal),
      new Date(2026, 9, 20, 18, 0),
    );
    assert.deepEqual(
      ultimoHorarioAgendado(new Date(2027, 0, 5, 8, 0), mensal),
      new Date(2026, 11, 20, 18, 0),
    );
  });
});
