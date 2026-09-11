/**
 * O parceiro do evento, e nao a lane, e quem identifica o cliente.
 *
 * A lane da Agenda de Recursos e do CONSULTOR: todos os clientes dele caem na mesma
 * lane. Estes testes prendem essa regra — trocar o filtro para a lane faria a agenda de
 * um cliente mostrar os dias de todos os outros, sem erro nenhum aparecer.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AgendaRecursos } from '../src/sankhya/agenda.ts';
import { parsearAgenda } from '../src/sankhya/agendaParser.ts';
import { dirTemporario } from './helpers.ts';

const $ = (valor: string | number) => ({ $: String(valor) });

interface Evento {
  nuevento: number;
  dia: string;
  parceiro: string;
  codparc: number | null;
  titulo?: string;
}

function payload(lanes: { nome: string; eventos: Evento[] }[]): unknown {
  return {
    status: $('1'),
    responseBody: {
      timeLine: {
        lane: lanes.map((l) => ({
          CODUSU: $(l.nome.length),
          NOMEUSU: $(l.nome),
          DESCRCARGO: $('Consultor'),
          COLOR: $('0x00FF00'),
          task: l.eventos.map((e) => ({
            NUEVENTO: $(e.nuevento),
            NOMEUSU: $(l.nome),
            NOMEPARC: $(e.parceiro),
            ...(e.codparc === null ? {} : { CODPARC: $(e.codparc) }),
            start: $(`${e.dia} 08:00`),
            end: $(`${e.dia} 12:00`),
            DESCRABREV: $(e.titulo ?? `evento ${e.nuevento}`),
          })),
        })),
      },
    },
  };
}

/**
 * Duas lanes, tres parceiros — o suficiente para distinguir lane de parceiro.
 *
 * Fecha o banco antes de apagar a pasta: no Windows, `rmSync` num arquivo SQLite ainda
 * aberto falha com EPERM e derruba o teste depois de ele ja ter passado.
 */
function comAgenda(prova: (agenda: AgendaRecursos) => void): void {
  const dir = dirTemporario();
  const agenda = montar(dir.path);
  try {
    prova(agenda);
  } finally {
    agenda.close();
    dir.remove();
  }
}

function montar(dir: string): AgendaRecursos {
  const agenda = new AgendaRecursos(dir);
  agenda.importar(
    parsearAgenda(
      payload([
        {
          nome: 'FLAVIANO.SANTOS',
          eventos: [
            { nuevento: 1, dia: '03/08/2026', parceiro: 'AMATOOLS COMERCIAL E IMPORTADORA LTDA', codparc: 78764 },
            { nuevento: 2, dia: '03/08/2026', parceiro: 'AMATOOLS COMERCIAL E IMPORTADORA LTDA', codparc: 78764, titulo: 'segundo do dia' },
            { nuevento: 3, dia: '10/09/2026', parceiro: 'AMATOOLS COMERCIAL E IMPORTADORA LTDA', codparc: 78764 },
            { nuevento: 4, dia: '05/08/2026', parceiro: 'FLAPS PRODUTOS AUTOMOTIVOS', codparc: 73379 },
            { nuevento: 5, dia: '06/08/2026', parceiro: '', codparc: null },
          ],
        },
        {
          nome: 'OUTRO.CONSULTOR',
          eventos: [
            { nuevento: 6, dia: '04/08/2026', parceiro: 'AMATOOLS COMERCIAL E IMPORTADORA LTDA', codparc: 78764 },
          ],
        },
      ]),
    ),
  );
  return agenda;
}

describe('AgendaRecursos — parceiros', () => {
  test('agrupa por parceiro e ignora evento sem parceiro', () => {
    comAgenda((agenda) => {
      const parceiros = agenda.parceiros('FLAVIANO.SANTOS');

      assert.equal(parceiros.length, 2, 'o evento sem NOMEPARC não vira parceiro');
      assert.deepEqual(
        parceiros.map((p) => p.codparc),
        [78764, 73379],
        'ordenado pelo número de eventos, do maior para o menor',
      );
      assert.equal(parceiros[0]?.eventos, 3);
      assert.equal(parceiros[0]?.primeiroDia, '2026-08-03');
      assert.equal(parceiros[0]?.ultimoDia, '2026-09-10');
    });
  });

  test('sem usuário, soma os parceiros de todas as lanes', () => {
    comAgenda((agenda) => {
      const amatools = agenda.parceiros().find((p) => p.codparc === 78764);

      // 3 da minha lane + 1 da lane do outro consultor.
      assert.equal(amatools?.eventos, 4);
    });
  });
});

describe('AgendaRecursos — casarParceiro', () => {
  const casos: [string, number | null][] = [
    ['AMATOOLS COMERCIAL E IMPORTADORA LTDA', 78764],
    // O cadastro é digitado à mão: caixa, acento e sufixo societário não podem decidir.
    ['Amatools Comercial e Importadora Ltda', 78764],
    ['Amatools', 78764],
    ['Flaps Produtos Automotivos', 73379],
    ['Larifo Transportes', null],
    ['', null],
  ];

  for (const [nome, esperado] of casos) {
    test(`"${nome}" -> ${esperado ?? 'nenhum'}`, () => {
      comAgenda((agenda) => {
        assert.equal(agenda.casarParceiro(nome, 'FLAVIANO.SANTOS')?.codparc ?? null, esperado);
      });
    });
  }
});

describe('AgendaRecursos — atuacao', () => {
  test('um dia com dois eventos é um dia, com os dois títulos', () => {
    comAgenda((agenda) => {
      const atuacao = agenda.atuacao(78764, 'FLAVIANO.SANTOS');

      assert.equal(atuacao.nomeparc, 'AMATOOLS COMERCIAL E IMPORTADORA LTDA');
      assert.deepEqual(
        atuacao.dias.map((d) => d.dia),
        ['2026-08-03', '2026-09-10'],
        'traz passado e futuro, em ordem cronológica',
      );
      assert.equal(atuacao.dias[0]?.eventos, 2);
      assert.deepEqual(atuacao.dias[0]?.titulos, ['evento 1', 'segundo do dia']);
    });
  });

  test('filtra pela lane do consultor, não pelo parceiro sozinho', () => {
    comAgenda((agenda) => {
      // O mesmo parceiro aparece na lane do outro consultor, em 04/08. Ele não pode
      // entrar na MINHA atuação — seria dia de trabalho de outra pessoa no meu painel.
      assert.ok(!agenda.atuacao(78764, 'FLAVIANO.SANTOS').dias.some((d) => d.dia === '2026-08-04'));
      assert.ok(agenda.atuacao(78764).dias.some((d) => d.dia === '2026-08-04'));
    });
  });
});
