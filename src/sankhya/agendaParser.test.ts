import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  converterCor,
  converterData,
  parsearAgenda,
  PayloadInvalidoError,
} from './agendaParser.ts';

const embrulhar = (valor: string) => ({ $: valor });

function criarTarefa(nuevento: string) {
  return {
    allDay: 'false',
    start: '17/08/2026 09:00',
    end: '17/08/2026 12:30',
    properties: {
      NUEVENTO: embrulhar(nuevento),
      CODPARC: embrulhar('77'),
      NOMEPARC: embrulhar('Indústria Alfa'),
    },
  };
}

function criarPayload(tarefa: unknown) {
  return {
    status: '1',
    responseBody: {
      timeLine: {
        lane: {
          properties: { NOMEUSU: embrulhar('Consultor'), COLOR: embrulhar('0x00FF00') },
          task: tarefa,
        },
      },
    },
  };
}

describe('converterData', () => {
  it('converte para o formato que ordena como texto', () => {
    assert.equal(converterData('17/08/2026 09:05'), '2026-08-17 09:05:00');
  });

  it('completa a hora quando só vem a data', () => {
    assert.equal(converterData('17/08/2026'), '2026-08-17 00:00:00');
  });

  it('devolve vazio para formato desconhecido', () => {
    assert.equal(converterData('2026-08-17'), '');
  });
});

describe('converterCor', () => {
  it('troca o prefixo 0x por # e põe em maiúsculas', () => {
    assert.equal(converterCor('0x00ff00'), '#00FF00');
  });

  it('completa com zero à esquerda quando o Sankhya corta', () => {
    assert.equal(converterCor('0xFF'), '#0000FF');
  });

  it('devolve vazio para valor que não é cor', () => {
    assert.equal(converterCor('verde'), '');
  });
});

describe('parsearAgenda', () => {
  it('lê os campos de dentro de properties, desembrulhando o "$"', () => {
    const { recursos, totalEventos } = parsearAgenda(
      criarPayload([criarTarefa('1'), criarTarefa('2')]),
    );

    assert.equal(totalEventos, 2);
    assert.equal(recursos[0]?.recurso.nomeusu, 'Consultor');
    assert.equal(recursos[0]?.recurso.corHex, '#00FF00');
    assert.equal(recursos[0]?.eventos[0]?.codparc, 77);
    assert.equal(recursos[0]?.eventos[0]?.inicio, '2026-08-17 09:00:00');
    assert.equal(recursos[0]?.eventos[0]?.allday, 'N');
  });

  it('não perde o recurso que tem um único evento (task vem como objeto)', () => {
    const { totalEventos } = parsearAgenda(criarPayload(criarTarefa('1')));

    assert.equal(totalEventos, 1);
  });

  it('recusa resposta em que o Sankhya recusou a chamada, para não apagar o snapshot', () => {
    assert.throws(() => parsearAgenda({ status: '0' }), PayloadInvalidoError);
  });

  it('recusa payload sem lane', () => {
    assert.throws(() => parsearAgenda({ status: '1', responseBody: {} }), PayloadInvalidoError);
  });

  it('recusa conteúdo que não é objeto', () => {
    assert.throws(() => parsearAgenda('texto'), PayloadInvalidoError);
  });
});
