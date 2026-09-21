/**
 * `SessaoDesktopStore` guarda em memoria o que o shell desktop empurra para a
 * Experience — so' importa aqui que ela expire sozinha e que `limpar` funcione, ja' que
 * e' isso que impede um logout real de voltar a valer por atraso de rede (ver Secao 6.4
 * da especificacao de desktop).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SessaoDesktopStore } from '../src/sankhya/sessaoDesktop.ts';

describe('SessaoDesktopStore', () => {
  test('sem sessao empurrada, obter devolve undefined', () => {
    const store = new SessaoDesktopStore();
    assert.equal(store.obter(), undefined);
  });

  test('devolve o que foi empurrado', () => {
    const store = new SessaoDesktopStore();
    store.definir({ usuario: 'flaviano.santos@sankhya.com.br', token: 'abc.def.ghi', expira: '' });
    assert.deepEqual(store.obter()?.usuario, 'flaviano.santos@sankhya.com.br');
    assert.deepEqual(store.obter()?.token, 'abc.def.ghi');
  });

  test('sessao expirada some sozinha', () => {
    const store = new SessaoDesktopStore();
    store.definir({ usuario: 'u', token: 't', expira: new Date(Date.now() - 1000).toISOString() });
    assert.equal(store.obter(), undefined);
  });

  test('sessao sem exp informado nunca expira por tempo', () => {
    const store = new SessaoDesktopStore();
    store.definir({ usuario: 'u', token: 't', expira: '' });
    assert.notEqual(store.obter(), undefined);
  });

  test('limpar remove mesmo sem expiracao', () => {
    const store = new SessaoDesktopStore();
    store.definir({ usuario: 'u', token: 't', expira: '' });
    store.limpar();
    assert.equal(store.obter(), undefined);
  });

  test('definir de novo substitui a sessao anterior', () => {
    const store = new SessaoDesktopStore();
    store.definir({ usuario: 'u1', token: 't1', expira: '' });
    store.definir({ usuario: 'u2', token: 't2', expira: '' });
    assert.equal(store.obter()?.usuario, 'u2');
  });
});
