import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PayloadInvalidoError,
  converterCor,
  converterData,
  parsearAgenda,
} from '../src/sankhya/agendaParser.ts';

/** Como o Sankhya legado embrulha todo valor de folha. */
const $ = (valor: string | number) => ({ $: String(valor) });

function payload(lanes: unknown): unknown {
  return {
    status: $('1'),
    serviceName: $('AgendaRecursosSP.carregarAgendas'),
    responseBody: { timeLine: { lane: lanes } },
  };
}

const LANE_BASE = {
  CODUSU: $(12229),
  NOMEUSU: $('FLAVIANO.SANTOS'),
  CODCARGO: $(7),
  DESCRCARGO: $('Consultor'),
  COLOR: $('0x0000FF'),
  CONFLICTCOLOR: $('0xFF0000'),
  CONNECTIONPROBLEM: $('N'),
};

const TASK_BASE = {
  NUEVENTO: $(9001),
  CODUSU: $(12229),
  NOMEUSU: $('FLAVIANO.SANTOS'),
  NOMEPARC: $('AMATOOLS'),
  CODPARC: $(2996),
  CONFIRMADO: $('S'),
  TIPO: $('A'),
  DESCRABREV: $('Implantação'),
  allDay: $('N'),
  start: $('20/08/2026 08:00'),
  end: $('20/08/2026 18:00'),
};

describe('agendaParser — conversões', () => {
  test('data DD/MM/YYYY HH:mm vira YYYY-MM-DD HH:mm:ss', () => {
    assert.equal(converterData('20/08/2026 08:00'), '2026-08-20 08:00:00');
  });

  test('data sem hora assume meia-noite', () => {
    assert.equal(converterData('01/12/2026'), '2026-12-01 00:00:00');
  });

  test('data com segundos preserva os segundos', () => {
    assert.equal(converterData('05/03/2026 14:30:45'), '2026-03-05 14:30:45');
  });

  test('data fora do formato vira vazio em vez de data inventada', () => {
    assert.equal(converterData('2026-08-20'), '');
    assert.equal(converterData(''), '');
  });

  test('a ordem lexicográfica da data convertida é a ordem cronológica', () => {
    // É disto que as consultas dependem para comparar período sem conversão.
    const antes = converterData('09/08/2026 23:00');
    const depois = converterData('10/08/2026 01:00');
    assert.ok(antes < depois);
  });

  test('cor 0xRRGGBB vira #RRGGBB em maiúsculas', () => {
    assert.equal(converterCor('0x0000ff'), '#0000FF');
  });

  test('cor curta é completada com zero à esquerda', () => {
    assert.equal(converterCor('0xFF'), '#0000FF');
  });

  test('cor inválida vira vazio', () => {
    assert.equal(converterCor('azul'), '');
    assert.equal(converterCor(''), '');
  });
});

describe('agendaParser — estrutura', () => {
  test('desembrulha { $: valor } em lane e task', () => {
    const { recursos } = parsearAgenda(payload([{ ...LANE_BASE, task: [TASK_BASE] }]));

    assert.equal(recursos.length, 1);
    assert.equal(recursos[0]!.recurso.nomeusu, 'FLAVIANO.SANTOS');
    assert.equal(recursos[0]!.recurso.codusu, 12229);
    assert.equal(recursos[0]!.recurso.corHex, '#0000FF');
    assert.equal(recursos[0]!.eventos[0]!.descrabrev, 'Implantação');
    assert.equal(recursos[0]!.eventos[0]!.inicio, '2026-08-20 08:00:00');
  });

  /**
   * A armadilha nº 5 do documento de descoberta: com UM evento o Sankhya manda objeto,
   * não array. Sem normalizar, o recurso aparece na lista com zero eventos e ninguém
   * percebe — não há erro, só dado faltando.
   */
  test('task como OBJETO (um evento só) não é perdida', () => {
    const { recursos, totalEventos } = parsearAgenda(
      payload([{ ...LANE_BASE, task: TASK_BASE }]),
    );

    assert.equal(totalEventos, 1);
    assert.equal(recursos[0]!.eventos.length, 1);
    assert.equal(recursos[0]!.eventos[0]!.nuevento, 9001);
  });

  test('task como ARRAY com vários eventos', () => {
    const { totalEventos } = parsearAgenda(
      payload([{ ...LANE_BASE, task: [TASK_BASE, { ...TASK_BASE, NUEVENTO: $(9002) }] }]),
    );
    assert.equal(totalEventos, 2);
  });

  test('recurso sem nenhum evento entra na lista mesmo assim', () => {
    const { recursos, totalEventos } = parsearAgenda(payload([LANE_BASE]));

    assert.equal(recursos.length, 1);
    assert.equal(recursos[0]!.eventos.length, 0);
    assert.equal(totalEventos, 0);
  });

  test('lane como OBJETO (um recurso só) não é perdida', () => {
    const { recursos } = parsearAgenda(payload({ ...LANE_BASE, task: TASK_BASE }));
    assert.equal(recursos.length, 1);
  });

  test('campo ausente vira vazio ou null, não quebra', () => {
    const { recursos } = parsearAgenda(
      payload([{ CODUSU: $(1), task: { NUEVENTO: $(5), start: $('01/01/2026 09:00') } }]),
    );

    const evento = recursos[0]!.eventos[0]!;
    assert.equal(evento.nomeparc, '');
    assert.equal(evento.codparc, null);
    assert.equal(evento.fim, '');
    assert.equal(recursos[0]!.recurso.corHex, '');
  });
});

describe('agendaParser — recusas', () => {
  test('status "0" é recusado em vez de importar vazio por cima do snapshot bom', () => {
    const ruim = { status: $('0'), responseBody: { timeLine: { lane: [LANE_BASE] } } };
    assert.throws(() => parsearAgenda(ruim), PayloadInvalidoError);
  });

  test('payload sem timeLine.lane é recusado', () => {
    assert.throws(() => parsearAgenda({ status: $('1'), responseBody: {} }), PayloadInvalidoError);
  });

  test('conteúdo que não é objeto é recusado', () => {
    assert.throws(() => parsearAgenda('nada disso'), PayloadInvalidoError);
    assert.throws(() => parsearAgenda(null), PayloadInvalidoError);
  });
});
