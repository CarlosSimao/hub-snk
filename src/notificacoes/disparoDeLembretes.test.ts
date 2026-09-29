import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Lembrete } from '../tipos.ts';
import {
  ExpressaoCronInvalidaError,
  ocorrenciaDevida,
  proximasOcorrencias,
  proximoDisparo,
  validarExpressaoCron,
} from './disparoDeLembretes.ts';

function lembrete(campos: Partial<Lembrete>): Lembrete {
  return {
    id: 'l1',
    resumo: 'Relatório',
    texto: 'Enviar relatório',
    tipo: 'unico',
    dataHora: '',
    expressaoCron: '',
    clienteId: null,
    projetoId: null,
    enviarEmail: false,
    contatoIds: [],
    ativo: true,
    ultimoDisparoEm: '',
    criadoEm: new Date(2026, 8, 28, 8, 0).toISOString(),
    atualizadoEm: new Date(2026, 8, 28, 8, 0).toISOString(),
    ...campos,
  };
}

describe('ocorrenciaDevida — único', () => {
  const quando = new Date(2026, 8, 28, 10, 0);

  it('dispara quando a data chegou e ainda não disparou', () => {
    const devida = ocorrenciaDevida(lembrete({ dataHora: quando.toISOString() }), quando);
    assert.equal(devida?.getTime(), quando.getTime());
  });

  it('não dispara antes da hora', () => {
    const antes = new Date(2026, 8, 28, 9, 59);
    assert.equal(ocorrenciaDevida(lembrete({ dataHora: quando.toISOString() }), antes), null);
  });

  it('não dispara de novo depois de disparado', () => {
    const disparado = lembrete({
      dataHora: quando.toISOString(),
      ultimoDisparoEm: quando.toISOString(),
    });
    assert.equal(ocorrenciaDevida(disparado, new Date(2026, 8, 29)), null);
  });

  it('não dispara desligado', () => {
    const desligado = lembrete({ dataHora: quando.toISOString(), ativo: false });
    assert.equal(ocorrenciaDevida(desligado, quando), null);
  });
});

describe('ocorrenciaDevida — recorrente', () => {
  const diario = lembrete({ tipo: 'recorrente', expressaoCron: '0 9 * * *' });

  it('não dispara a ocorrência anterior à criação', () => {
    const criadoAs8 = lembrete({
      ...diario,
      atualizadoEm: new Date(2026, 8, 28, 10, 0).toISOString(),
    });
    assert.equal(ocorrenciaDevida(criadoAs8, new Date(2026, 8, 28, 12, 0)), null);
  });

  it('dispara a primeira ocorrência depois da referência', () => {
    const devida = ocorrenciaDevida(diario, new Date(2026, 8, 28, 9, 0, 20));
    assert.equal(devida?.getTime(), new Date(2026, 8, 28, 9, 0).getTime());
  });

  it('conta a partir do último disparo', () => {
    const disparadoHoje = lembrete({
      ...diario,
      ultimoDisparoEm: new Date(2026, 8, 28, 9, 0, 20).toISOString(),
    });
    assert.equal(ocorrenciaDevida(disparadoHoje, new Date(2026, 8, 28, 18, 0)), null);
    assert.equal(
      ocorrenciaDevida(disparadoHoje, new Date(2026, 8, 29, 9, 0))?.getTime(),
      new Date(2026, 8, 29, 9, 0).getTime(),
    );
  });
});

describe('proximoDisparo', () => {
  it('é nulo para o único já disparado', () => {
    const disparado = lembrete({
      dataHora: new Date(2026, 8, 28, 10).toISOString(),
      ultimoDisparoEm: new Date(2026, 8, 28, 10).toISOString(),
    });
    assert.equal(proximoDisparo(disparado, new Date(2026, 8, 28, 11)), null);
  });

  it('é nulo para o único com data ilegível, editada à mão no arquivo', () => {
    const ilegivel = lembrete({ dataHora: 'amanhã cedo' });
    assert.equal(proximoDisparo(ilegivel, new Date(2026, 8, 28, 11)), null);
  });

  it('é a ocorrência pendente do recorrente, quando há uma', () => {
    const diario = lembrete({ tipo: 'recorrente', expressaoCron: '30 14 * * *' });
    assert.equal(
      proximoDisparo(diario, new Date(2026, 8, 28, 15, 0))?.getTime(),
      new Date(2026, 8, 28, 14, 30).getTime(),
    );
  });

  it('é a próxima ocorrência do recorrente em dia', () => {
    const diario = lembrete({
      tipo: 'recorrente',
      expressaoCron: '30 14 * * *',
      ultimoDisparoEm: new Date(2026, 8, 28, 14, 30, 10).toISOString(),
    });
    assert.equal(
      proximoDisparo(diario, new Date(2026, 8, 28, 15, 0))?.getTime(),
      new Date(2026, 8, 29, 14, 30).getTime(),
    );
  });
});

describe('validarExpressaoCron', () => {
  it('aceita cinco campos', () => {
    assert.doesNotThrow(() => validarExpressaoCron('0 9 * * 1-5'));
  });

  it('recusa seis campos, que o croner leria como segundos', () => {
    assert.throws(() => validarExpressaoCron('0 0 9 * * 1'), ExpressaoCronInvalidaError);
  });

  it('recusa valor fora da faixa', () => {
    assert.throws(() => validarExpressaoCron('0 25 * * *'), ExpressaoCronInvalidaError);
  });
});

describe('proximasOcorrencias', () => {
  it('lista os próximos dias úteis', () => {
    // 02/10/2026 é sexta-feira: depois das 10h, os próximos são segunda e terça.
    const ocorrencias = proximasOcorrencias('0 9 * * 1-5', new Date(2026, 9, 2, 10, 0), 2);
    assert.deepEqual(
      ocorrencias.map((data) => data.getTime()),
      [new Date(2026, 9, 5, 9, 0).getTime(), new Date(2026, 9, 6, 9, 0).getTime()],
    );
  });
});
