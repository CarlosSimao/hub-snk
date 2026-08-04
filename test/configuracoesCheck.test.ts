import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfiguracoesCheck } from '../src/configuracoesCheck.ts';
import { dirTemporario } from './helpers.ts';

const ALPHA = 'alpha';
const BETA = 'beta';

describe('ConfiguracoesCheck', () => {
  test('check sem override devolve undefined', () => {
    const dir = dirTemporario();
    try {
      const c = new ConfiguracoesCheck(dir.path);
      assert.equal(c.overridesDe(ALPHA, 'c1'), undefined);
    } finally {
      dir.remove();
    }
  });

  test('definir grava, relê e sobrevive a reabrir', () => {
    const dir = dirTemporario();
    try {
      const c = new ConfiguracoesCheck(dir.path);
      c.definir(ALPHA, 'c1', { intervalMs: 5000, timeoutMs: 3000 });
      assert.deepEqual(c.overridesDe(ALPHA, 'c1'), { intervalMs: 5000, timeoutMs: 3000 });

      const outro = new ConfiguracoesCheck(dir.path);
      assert.deepEqual(outro.overridesDe(ALPHA, 'c1'), { intervalMs: 5000, timeoutMs: 3000 });
    } finally {
      dir.remove();
    }
  });

  test('definir de novo substitui o override anterior do mesmo check', () => {
    const dir = dirTemporario();
    try {
      const c = new ConfiguracoesCheck(dir.path);
      c.definir(ALPHA, 'c1', { intervalMs: 5000, timeoutMs: 3000 });
      c.definir(ALPHA, 'c1', { intervalMs: 9000, timeoutMs: 4000 });
      assert.deepEqual(c.overridesDe(ALPHA, 'c1'), { intervalMs: 9000, timeoutMs: 4000 });
    } finally {
      dir.remove();
    }
  });

  test('o mesmo checkId em projetos diferentes é independente', () => {
    const dir = dirTemporario();
    try {
      const c = new ConfiguracoesCheck(dir.path);
      c.definir(ALPHA, 'c1', { intervalMs: 5000, timeoutMs: 3000 });
      c.definir(BETA, 'c1', { intervalMs: 9000, timeoutMs: 4000 });

      assert.deepEqual(c.overridesDe(ALPHA, 'c1'), { intervalMs: 5000, timeoutMs: 3000 });
      assert.deepEqual(c.overridesDe(BETA, 'c1'), { intervalMs: 9000, timeoutMs: 4000 });
    } finally {
      dir.remove();
    }
  });

  test('definir outro check do mesmo projeto não mexe no primeiro', () => {
    const dir = dirTemporario();
    try {
      const c = new ConfiguracoesCheck(dir.path);
      c.definir(ALPHA, 'c1', { intervalMs: 5000, timeoutMs: 3000 });
      c.definir(ALPHA, 'c2', { intervalMs: 9000, timeoutMs: 4000 });

      assert.deepEqual(c.overridesDe(ALPHA, 'c1'), { intervalMs: 5000, timeoutMs: 3000 });
      assert.deepEqual(c.overridesDe(ALPHA, 'c2'), { intervalMs: 9000, timeoutMs: 4000 });
    } finally {
      dir.remove();
    }
  });

  test('arquivo ilegível vira "nenhum override" em vez de exceção', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(join(dir.path, 'configuracoes-check.json'), '{ isto não é json');
      const c = new ConfiguracoesCheck(dir.path);
      assert.equal(c.overridesDe(ALPHA, 'c1'), undefined);
    } finally {
      dir.remove();
    }
  });

  test('entrada sem intervalMs/timeoutMs numéricos é descartada', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(
        join(dir.path, 'configuracoes-check.json'),
        JSON.stringify({
          [ALPHA]: {
            ok: { intervalMs: 5000, timeoutMs: 3000 },
            ruim: { intervalMs: 'não é número', timeoutMs: 3000 },
            incompleto: { intervalMs: 5000 },
          },
        }),
      );
      const c = new ConfiguracoesCheck(dir.path);
      assert.deepEqual(c.overridesDe(ALPHA, 'ok'), { intervalMs: 5000, timeoutMs: 3000 });
      assert.equal(c.overridesDe(ALPHA, 'ruim'), undefined);
      assert.equal(c.overridesDe(ALPHA, 'incompleto'), undefined);
    } finally {
      dir.remove();
    }
  });

  test('o arquivo gravado é JSON aninhado por projeto', () => {
    const dir = dirTemporario();
    try {
      new ConfiguracoesCheck(dir.path).definir(ALPHA, 'c1', { intervalMs: 5000, timeoutMs: 3000 });
      const bruto = JSON.parse(readFileSync(join(dir.path, 'configuracoes-check.json'), 'utf8'));
      assert.deepEqual(bruto, { alpha: { c1: { intervalMs: 5000, timeoutMs: 3000 } } });
    } finally {
      dir.remove();
    }
  });
});
