import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fapsDoParceiro,
  parsearNegociacoes,
  PayloadDeNegociacoesInvalidoError,
} from './negociacoes.ts';

function criarPayload(negociacao: unknown) {
  return { status: '1', responseBody: { negociacoes: { negociacao } } };
}

describe('parsearNegociacoes', () => {
  it('aceita uma única negociação vinda como objeto', () => {
    const lista = parsearNegociacoes(
      criarPayload({ numNegociacao: '5', tipo: '2', dscNatureza: 'HORAS DE IMPLANTACAO' }),
    );

    assert.deepEqual(lista, [{ numNegociacao: 5, tipo: '2', dscNatureza: 'HORAS DE IMPLANTACAO' }]);
  });

  it('devolve lista vazia quando o parceiro não tem negociação', () => {
    assert.deepEqual(parsearNegociacoes({ status: '1', responseBody: {} }), []);
  });

  it('recusa resposta com status de falha', () => {
    assert.throws(() => parsearNegociacoes({ status: '0' }), PayloadDeNegociacoesInvalidoError);
  });
});

describe('fapsDoParceiro', () => {
  it('considera só o tipo 2 e remove repetidos', () => {
    const faps = fapsDoParceiro([
      { numNegociacao: 1, tipo: '0', dscNatureza: '' },
      { numNegociacao: 2, tipo: '2', dscNatureza: '' },
      { numNegociacao: 2, tipo: '2', dscNatureza: '' },
      { numNegociacao: 3, tipo: '2', dscNatureza: '' },
    ]);

    assert.deepEqual(faps, [2, 3]);
  });
});
