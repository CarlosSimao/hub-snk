import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Desativados } from '../src/desativados.ts';
import { dirTemporario } from './helpers.ts';

const ALPHA = 'alpha';
const BETA = 'beta';

describe('Desativados', () => {
  test('projeto e check começam habilitados', () => {
    const dir = dirTemporario();
    try {
      const d = new Desativados(dir.path);
      assert.equal(d.servicoDesabilitado(ALPHA), false);
      assert.equal(d.checkDesabilitado(ALPHA, 'c1'), false);
    } finally {
      dir.remove();
    }
  });

  test('definirServico grava, relê e sobrevive a reabrir', () => {
    const dir = dirTemporario();
    try {
      const d = new Desativados(dir.path);
      d.definirServico(ALPHA, true);
      assert.equal(d.servicoDesabilitado(ALPHA), true);

      const outro = new Desativados(dir.path);
      assert.equal(outro.servicoDesabilitado(ALPHA), true);
    } finally {
      dir.remove();
    }
  });

  test('definirServico(false) reabilita', () => {
    const dir = dirTemporario();
    try {
      const d = new Desativados(dir.path);
      d.definirServico(ALPHA, true);
      d.definirServico(ALPHA, false);
      assert.equal(d.servicoDesabilitado(ALPHA), false);
    } finally {
      dir.remove();
    }
  });

  test('definirCheck não mexe no projeto, nem em outro check', () => {
    const dir = dirTemporario();
    try {
      const d = new Desativados(dir.path);
      d.definirCheck(ALPHA, 'c1', true);

      assert.equal(d.checkDesabilitado(ALPHA, 'c1'), true);
      assert.equal(d.checkDesabilitado(ALPHA, 'c2'), false);
      assert.equal(d.servicoDesabilitado(ALPHA), false);
    } finally {
      dir.remove();
    }
  });

  // Espaço de nomes por projeto, mesma ideia do Cofre: dois projetos podem ter um
  // check "c1" cada, desabilitar um não pode afetar o outro.
  test('o mesmo checkId em projetos diferentes é independente', () => {
    const dir = dirTemporario();
    try {
      const d = new Desativados(dir.path);
      d.definirCheck(ALPHA, 'c1', true);
      d.definirCheck(BETA, 'c1', false);

      assert.equal(d.checkDesabilitado(ALPHA, 'c1'), true);
      assert.equal(d.checkDesabilitado(BETA, 'c1'), false);
    } finally {
      dir.remove();
    }
  });

  test('reabilitar o único check desabilitado remove o projeto do arquivo', () => {
    const dir = dirTemporario();
    try {
      const d = new Desativados(dir.path);
      d.definirCheck(ALPHA, 'c1', true);
      d.definirCheck(ALPHA, 'c1', false);

      const bruto = JSON.parse(readFileSync(join(dir.path, 'desativados.json'), 'utf8'));
      assert.deepEqual(bruto, { services: [], checks: {} });
    } finally {
      dir.remove();
    }
  });

  test('arquivo ilegível vira "nada desabilitado" em vez de exceção', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(join(dir.path, 'desativados.json'), '{ isto não é json');
      const d = new Desativados(dir.path);
      assert.equal(d.servicoDesabilitado(ALPHA), false);
      assert.equal(d.checkDesabilitado(ALPHA, 'c1'), false);
    } finally {
      dir.remove();
    }
  });

  test('entrada não-string na lista é descartada', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(
        join(dir.path, 'desativados.json'),
        JSON.stringify({ services: [ALPHA, 42], checks: { [ALPHA]: ['c1', null] } }),
      );
      const d = new Desativados(dir.path);
      assert.equal(d.servicoDesabilitado(ALPHA), true);
      assert.equal(d.checkDesabilitado(ALPHA, 'c1'), true);
    } finally {
      dir.remove();
    }
  });
});
