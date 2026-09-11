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

/**
 * Molde copiado de uma resposta REAL do Sankhya, não do documento de descoberta: os
 * campos ficam sob `properties`, e `allDay`/`start`/`end` são atributos diretos do task,
 * em texto cru. O documento descrevia tudo no nó, e um parser escrito por ele lia vazio.
 */
const LANE_BASE = {
  description: 'FLAVIANO.SANTOS',
  properties: {
    CODUSU: $(12229),
    NOMEUSU: $('FLAVIANO.SANTOS'),
    CODCARGO: $(7),
    DESCRCARGO: $('Consultor'),
    COLOR: $('0x0000FF'),
    CONFLICTCOLOR: $('0xFF0000'),
    CONNECTIONPROBLEM: $('N'),
  },
};

const TASK_BASE = {
  allDay: 'false',
  start: '20/08/2026 08:00',
  end: '20/08/2026 18:00',
  color: {},
  description: $('Implantação'),
  properties: {
    NUEVENTO: $(9001),
    CODUSU: $(12229),
    NOMEUSU: $('FLAVIANO.SANTOS'),
    NOMEPARC: $('AMATOOLS'),
    CODPARC: $(2996),
    CONFIRMADO: $('S'),
    SINCRONIZAR: $('S'),
    TIPO: $('ESTATICO'),
    USULANCADOR: $('SANKHYAEXPERIENCE'),
    DHLCTO: $('19/08/2026 17:57'),
    DESCRABREV: $('Implantação'),
    DESCRLONGA: $('Processos: Atendimento'),
    NUMETAPA: $(1),
    NUFAP: $(25981),
  },
};

/** Um task com `properties` trocado, mantendo os atributos diretos. */
function taskCom(props: Record<string, unknown>) {
  return { ...TASK_BASE, properties: { ...TASK_BASE.properties, ...props } };
}

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
  /**
   * A armadilha que só apareceu com payload real: os campos ficam sob `properties`.
   * Lidos do nó, todos vêm vazios e a importação grava um snapshot de fantasmas —
   * recursos sem nome, eventos sem descrição, e nenhum erro em lugar nenhum.
   */
  test('lê os campos de dentro de `properties`, não do nó', () => {
    const { recursos } = parsearAgenda(payload([{ ...LANE_BASE, task: [TASK_BASE] }]));

    assert.equal(recursos.length, 1);
    assert.equal(recursos[0]!.recurso.nomeusu, 'FLAVIANO.SANTOS');
    assert.equal(recursos[0]!.recurso.codusu, 12229);
    assert.equal(recursos[0]!.recurso.corHex, '#0000FF');
    assert.equal(recursos[0]!.recurso.descrcargo, 'Consultor');

    const evento = recursos[0]!.eventos[0]!;
    assert.equal(evento.descrabrev, 'Implantação');
    assert.equal(evento.nuevento, 9001);
    assert.equal(evento.nomeparc, 'AMATOOLS');
    assert.equal(evento.usulancador, 'SANKHYAEXPERIENCE');
  });

  test('allDay/start/end vêm do task direto, em texto cru', () => {
    const { recursos } = parsearAgenda(payload([{ ...LANE_BASE, task: [TASK_BASE] }]));
    const evento = recursos[0]!.eventos[0]!;

    assert.equal(evento.inicio, '2026-08-20 08:00:00');
    assert.equal(evento.fim, '2026-08-20 18:00:00');
  });

  /** `allDay` vem `true`/`false`; o resto do Sankhya usa `S`/`N`. Padronizamos em S/N. */
  test('allDay "true"/"false" vira S/N', () => {
    const comDiaTodo = parsearAgenda(
      payload([{ ...LANE_BASE, task: [{ ...TASK_BASE, allDay: 'true' }] }]),
    );
    assert.equal(comDiaTodo.recursos[0]!.eventos[0]!.allday, 'S');

    const semDiaTodo = parsearAgenda(payload([{ ...LANE_BASE, task: [TASK_BASE] }]));
    assert.equal(semDiaTodo.recursos[0]!.eventos[0]!.allday, 'N');
  });

  /** Formato do documento de descoberta, sem a camada `properties`. */
  test('ainda lê o formato antigo, com os campos no próprio nó', () => {
    const { recursos } = parsearAgenda(
      payload([
        {
          CODUSU: $(1),
          NOMEUSU: $('ANTIGO'),
          COLOR: $('0x00FF00'),
          task: { NUEVENTO: $(5), DESCRABREV: $('x'), start: $('01/01/2026 09:00') },
        },
      ]),
    );

    assert.equal(recursos[0]!.recurso.nomeusu, 'ANTIGO');
    assert.equal(recursos[0]!.eventos[0]!.nuevento, 5);
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
      payload([{ ...LANE_BASE, task: [TASK_BASE, taskCom({ NUEVENTO: $(9002) })] }]),
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
      payload([
        {
          properties: { CODUSU: $(1) },
          task: { start: '01/01/2026 09:00', properties: { NUEVENTO: $(5) } },
        },
      ]),
    );

    const evento = recursos[0]!.eventos[0]!;
    assert.equal(evento.nomeparc, '');
    assert.equal(evento.codparc, null);
    assert.equal(evento.fim, '', 'sem `end` a data fica vazia em vez de inventada');
    assert.equal(recursos[0]!.recurso.corHex, '');
    // Campos que o payload real não traz não podem quebrar a leitura.
    assert.equal(evento.diastraso, null);
    assert.equal(evento.financiallate, '');
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
