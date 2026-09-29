import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SessaoDoDesktop } from './sessaoDoDesktop.ts';

const UM_SEGUNDO_MS = 1000;

describe('SessaoDoDesktop', () => {
  it('não devolve nada antes de o shell empurrar uma sessão', () => {
    assert.equal(new SessaoDoDesktop().obter(), undefined);
  });

  it('devolve a sessão empurrada', () => {
    const sessao = new SessaoDoDesktop();
    sessao.definir({ usuario: 'usuario@sankhya.com.br', token: 'abc.def.ghi', expira: '' });

    assert.equal(sessao.obter()?.usuario, 'usuario@sankhya.com.br');
    assert.equal(sessao.obter()?.token, 'abc.def.ghi');
  });

  it('descarta sozinha a sessão cujo JWT já expirou', () => {
    const sessao = new SessaoDoDesktop();
    const expirouHaUmSegundo = new Date(Date.now() - UM_SEGUNDO_MS).toISOString();
    sessao.definir({ usuario: 'u', token: 't', expira: expirouHaUmSegundo });

    assert.equal(sessao.obter(), undefined);
  });

  it('mantém a sessão cujo JWT não informa expiração', () => {
    const sessao = new SessaoDoDesktop();
    sessao.definir({ usuario: 'u', token: 't', expira: '' });

    assert.notEqual(sessao.obter(), undefined);
  });

  it('esquece a sessão ao limpar, como no logout da Experience', () => {
    const sessao = new SessaoDoDesktop();
    sessao.definir({ usuario: 'u', token: 't', expira: '' });
    sessao.limpar();

    assert.equal(sessao.obter(), undefined);
  });

  it('substitui a sessão anterior quando o shell empurra de novo', () => {
    const sessao = new SessaoDoDesktop();
    sessao.definir({ usuario: 'u1', token: 't1', expira: '' });
    sessao.definir({ usuario: 'u2', token: 't2', expira: '' });

    assert.equal(sessao.obter()?.usuario, 'u2');
  });
});
