import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { interpretarVersaoSemantica, versaoEhMaisNova } from './comparacaoDeVersao.ts';

describe('interpretarVersaoSemantica', () => {
  it('lê a versão com e sem o "v" da tag', () => {
    assert.deepEqual(interpretarVersaoSemantica('1.2.3'), {
      maior: 1,
      menor: 2,
      correcao: 3,
      ehPreLancamento: false,
    });

    assert.deepEqual(interpretarVersaoSemantica('v1.2.3'), {
      maior: 1,
      menor: 2,
      correcao: 3,
      ehPreLancamento: false,
    });
  });

  it('marca pré-lançamento', () => {
    assert.equal(interpretarVersaoSemantica('1.2.0-beta.1')?.ehPreLancamento, true);
  });

  it('devolve nulo para tag fora do formato', () => {
    assert.equal(interpretarVersaoSemantica('release-2024'), null);
    assert.equal(interpretarVersaoSemantica('1.2'), null);
    assert.equal(interpretarVersaoSemantica(''), null);
  });
});

describe('versaoEhMaisNova', () => {
  it('reconhece versão publicada mais nova em cada parte do número', () => {
    assert.equal(versaoEhMaisNova('v2.0.0', '1.9.9'), true);
    assert.equal(versaoEhMaisNova('v1.3.0', '1.2.9'), true);
    assert.equal(versaoEhMaisNova('v1.2.4', '1.2.3'), true);
  });

  it('compara número a número, não como texto', () => {
    assert.equal(versaoEhMaisNova('v1.10.0', '1.9.0'), true);
    assert.equal(versaoEhMaisNova('v1.9.0', '1.10.0'), false);
  });

  it('fica calado quando as versões são iguais', () => {
    assert.equal(versaoEhMaisNova('v1.0.0', '1.0.0'), false);
  });

  it('fica calado quando a versão local está à frente da publicada', () => {
    assert.equal(versaoEhMaisNova('v1.0.0', '1.1.0'), false);
  });

  it('não avisa sobre pré-lançamento', () => {
    assert.equal(versaoEhMaisNova('v1.1.0-beta.1', '1.0.0'), false);
  });

  it('não avisa quando algum dos lados é ilegível', () => {
    assert.equal(versaoEhMaisNova('release-2024', '1.0.0'), false);
    assert.equal(versaoEhMaisNova('v1.1.0', 'desenvolvimento'), false);
  });
});
