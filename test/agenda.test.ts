import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaRecursos } from '../src/sankhya/agenda.ts';
import { parsearAgenda } from '../src/sankhya/agendaParser.ts';
import { dirTemporario } from './helpers.ts';

const $ = (valor: string | number) => ({ $: String(valor) });

function payload(lanes: unknown[]): unknown {
  return { status: $('1'), responseBody: { timeLine: { lane: lanes } } };
}

function lane(nome: string, eventos: { nuevento: number; de: string; ate: string }[]): unknown {
  return {
    CODUSU: $(nome.length),
    NOMEUSU: $(nome),
    DESCRCARGO: $('Consultor'),
    COLOR: $('0x00FF00'),
    task: eventos.map((e) => ({
      NUEVENTO: $(e.nuevento),
      NOMEUSU: $(nome),
      NOMEPARC: $('CLIENTE X'),
      start: $(e.de),
      end: $(e.ate),
      DESCRABREV: $(`evento ${e.nuevento}`),
    })),
  };
}

describe('AgendaRecursos', () => {
  test('importa recursos e eventos e conta certo', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      const estado = agenda.importar(
        parsearAgenda(
          payload([
            lane('ANA', [{ nuevento: 1, de: '10/08/2026 08:00', ate: '10/08/2026 12:00' }]),
            lane('BRUNO', [
              { nuevento: 2, de: '11/08/2026 08:00', ate: '11/08/2026 18:00' },
              { nuevento: 3, de: '12/08/2026 08:00', ate: '12/08/2026 18:00' },
            ]),
          ]),
        ),
      );

      assert.equal(estado.recursos, 2);
      assert.equal(estado.eventos, 3);
      assert.ok(estado.importadoEm && estado.importadoEm > 0);
      agenda.close();
    } finally {
      dir.remove();
    }
  });

  /**
   * A armadilha nº 1 do documento de descoberta: `AUTOINCREMENT` não reinicia depois de
   * `DELETE`. Reimportar e assumir que os recursos voltam a ser 1..N deixaria todo
   * evento apontando para recurso inexistente, e o JOIN devolveria zero linhas.
   */
  test('reimportar não deixa evento órfão', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      const dados = parsearAgenda(
        payload([lane('ANA', [{ nuevento: 1, de: '10/08/2026 08:00', ate: '10/08/2026 12:00' }])]),
      );

      agenda.importar(dados);
      agenda.importar(dados);
      const estado = agenda.importar(dados);

      assert.equal(estado.recursos, 1, 'importar de novo substitui, não acumula');
      assert.equal(estado.eventos, 1);

      // A soma dos totais do JOIN tem que bater com a contagem direta da tabela.
      const soma = agenda.recursos().reduce((t, r) => t + r.totalEventos, 0);
      assert.equal(soma, estado.eventos, 'evento órfão sumiria do JOIN');
      agenda.close();
    } finally {
      dir.remove();
    }
  });

  test('consulta por período traz quem CRUZA o período, não só quem começa nele', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      agenda.importar(
        parsearAgenda(
          payload([
            // Férias de uma semana: começa antes e termina depois da janela consultada.
            lane('ANA', [{ nuevento: 1, de: '10/08/2026 00:00', ate: '20/08/2026 23:59' }]),
            lane('BRUNO', [{ nuevento: 2, de: '01/09/2026 08:00', ate: '01/09/2026 18:00' }]),
          ]),
        ),
      );

      const semana = agenda.eventos('2026-08-15 00:00:00', '2026-08-16 23:59:59');
      assert.equal(semana.length, 1);
      assert.equal(semana[0]!.nuevento, 1);
      agenda.close();
    } finally {
      dir.remove();
    }
  });

  /**
   * O `NOMEUSU` repetido dentro do evento é dado denormalizado e pode divergir da lane.
   * Quem manda é o recurso: a lane é que define de quem é aquela agenda.
   */
  test('o filtro segue o recurso, não o NOMEUSU repetido dentro do evento', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      agenda.importar(
        parsearAgenda(
          payload([
            {
              CODUSU: $(2),
              NOMEUSU: $('BRUNO'),
              task: {
                NUEVENTO: $(7),
                // Diverge de propósito da lane onde o evento está.
                NOMEUSU: $('ANA'),
                start: $('10/08/2026 08:00'),
                end: $('10/08/2026 12:00'),
              },
            },
          ]),
        ),
      );

      const janela = ['2026-08-01 00:00:00', '2026-08-31 23:59:59'] as const;
      assert.equal(agenda.eventos(janela[0], janela[1], 'BRUNO').length, 1, 'vale a lane');
      assert.equal(agenda.eventos(janela[0], janela[1], 'ANA').length, 0, 'não o campo do evento');
      agenda.close();
    } finally {
      dir.remove();
    }
  });

  test('filtro por usuário reduz o resultado, e vazio traz todos', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      agenda.importar(
        parsearAgenda(
          payload([
            lane('ANA', [{ nuevento: 1, de: '10/08/2026 08:00', ate: '10/08/2026 12:00' }]),
            lane('BRUNO', [{ nuevento: 2, de: '10/08/2026 08:00', ate: '10/08/2026 12:00' }]),
          ]),
        ),
      );

      const janela = ['2026-08-01 00:00:00', '2026-08-31 23:59:59'] as const;
      assert.equal(agenda.eventos(janela[0], janela[1]).length, 2);
      assert.equal(agenda.eventos(janela[0], janela[1], 'ANA').length, 1);
      assert.equal(agenda.eventos(janela[0], janela[1], 'NINGUEM').length, 0);
      agenda.close();
    } finally {
      dir.remove();
    }
  });

  test('o evento carrega cargo e cor do recurso dele', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      agenda.importar(
        parsearAgenda(
          payload([lane('ANA', [{ nuevento: 1, de: '10/08/2026 08:00', ate: '10/08/2026 12:00' }])]),
        ),
      );

      const [evento] = agenda.eventos('2026-08-01 00:00:00', '2026-08-31 23:59:59');
      assert.equal(evento!.descrcargo, 'Consultor');
      assert.equal(evento!.corHex, '#00FF00');
      agenda.close();
    } finally {
      dir.remove();
    }
  });

  test('estado começa zerado', () => {
    const dir = dirTemporario();
    try {
      const agenda = new AgendaRecursos(dir.path);
      const estado = agenda.estado();
      assert.equal(estado.recursos, 0);
      assert.equal(estado.eventos, 0);
      assert.equal(estado.importadoEm, null);
      agenda.close();
    } finally {
      dir.remove();
    }
  });
});
