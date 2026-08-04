import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { dirTemporario } from './helpers.ts';
import type { Alert } from '../src/types.ts';

let dir: ReturnType<typeof dirTemporario>;
let store: Store;

beforeEach(() => {
  dir = dirTemporario();
  store = new Store(dir.path);
});

afterEach(() => {
  store.close();
  dir.remove();
});

const alerta = (id: string, ts: number): Alert => ({
  id,
  ts,
  serviceId: 's',
  serviceName: 'S',
  checkId: 'c',
  checkName: 'C',
  from: 'up',
  to: 'down',
  detail: 'caiu',
  severity: 'critical',
});

describe('store — histórico', () => {
  test('devolve as amostras da mais antiga para a mais nova', () => {
    const t = Date.now();
    store.record('k', t - 2000, 'up', 10, 'ok');
    store.record('k', t - 1000, 'down', null, 'caiu');
    store.record('k', t, 'up', 12, 'voltou');

    const h = store.history('k', 0);
    assert.equal(h.length, 3);
    assert.deepEqual(h.map((p) => p.status), ['up', 'down', 'up']);
    assert.equal(h[0]!.latencyMs, 10);
    assert.equal(h[1]!.latencyMs, null);
  });

  test('respeita a janela e corta as mais antigas pelo limite', () => {
    const t = Date.now();
    for (let i = 0; i < 10; i++) store.record('k', t - i * 1000, 'up', i, 'ok');

    assert.equal(store.history('k', t - 4500).length, 5);
    // O limite corta as MAIS ANTIGAS, preservando as recentes.
    const limitado = store.history('k', 0, 3);
    assert.equal(limitado.length, 3);
    assert.equal(limitado.at(-1)!.ts, t);
  });

  test('não mistura chaves de checks diferentes', () => {
    store.record('a', Date.now(), 'up', 1, 'ok');
    store.record('b', Date.now(), 'down', null, 'x');
    assert.equal(store.history('a', 0).length, 1);
    assert.equal(store.history('b', 0).length, 1);
  });
});

describe('store — uptime', () => {
  test('degraded conta como disponível: o serviço respondeu', () => {
    const t = Date.now();
    store.record('k', t - 3000, 'up', 1, '');
    store.record('k', t - 2000, 'degraded', 1, '');
    store.record('k', t - 1000, 'up', 1, '');
    store.record('k', t, 'down', null, '');

    const { uptimePct, samples } = store.uptime('k', 0);
    assert.equal(samples, 4);
    assert.equal(uptimePct, 75);
  });

  test('unknown fica fora do denominador — não foi medido', () => {
    const t = Date.now();
    store.record('k', t - 1000, 'up', 1, '');
    store.record('k', t, 'unknown', null, '');

    const { uptimePct, samples } = store.uptime('k', 0);
    assert.equal(samples, 1);
    assert.equal(uptimePct, 100);
  });

  test('sem amostras devolve null em vez de fingir 0% ou 100%', () => {
    assert.deepEqual(store.uptime('vazio', 0), { uptimePct: null, samples: 0 });
  });
});

describe('store — snapshots', () => {
  test('grava e relê o último resultado por check', () => {
    store.saveSnapshot('k', 123, { status: 'up', indicators: [] });
    const carregado = store.loadSnapshots();
    assert.equal(carregado.get('k')?.ts, 123);
    assert.deepEqual(carregado.get('k')?.payload, { status: 'up', indicators: [] });
  });

  test('sobrescreve em vez de acumular', () => {
    store.saveSnapshot('k', 1, { v: 1 });
    store.saveSnapshot('k', 2, { v: 2 });
    assert.equal(store.loadSnapshots().size, 1);
    assert.deepEqual(store.loadSnapshots().get('k')?.payload, { v: 2 });
  });

  test('descarta snapshots de checks que sumiram do YAML', () => {
    store.saveSnapshot('vivo', 1, {});
    store.saveSnapshot('removido', 1, {});
    store.pruneSnapshots(new Set(['vivo']));

    const restantes = store.loadSnapshots();
    assert.ok(restantes.has('vivo'));
    assert.ok(!restantes.has('removido'));
  });
});

describe('store — alertas', () => {
  test('lista do mais novo para o mais antigo e respeita o limite', () => {
    const t = Date.now();
    store.recordAlert(alerta('a', t - 2000));
    store.recordAlert(alerta('b', t - 1000));
    store.recordAlert(alerta('c', t));

    assert.deepEqual(store.recentAlerts().map((a) => a.id), ['c', 'b', 'a']);
    assert.deepEqual(store.recentAlerts(2).map((a) => a.id), ['c', 'b']);
  });

  test('sobrevive a reabrir o banco — o feed persiste', () => {
    store.recordAlert(alerta('a', Date.now()));
    store.close();

    const reaberto = new Store(dir.path);
    assert.equal(reaberto.recentAlerts().length, 1);
    reaberto.close();
    store = new Store(dir.path); // para o afterEach fechar algo válido
  });

  test('poda alertas fora da retenção', () => {
    const t = Date.now();
    store.recordAlert(alerta('velho', t - 10_000));
    store.recordAlert(alerta('novo', t));

    assert.equal(store.pruneAlerts(t - 5_000), 1);
    assert.deepEqual(store.recentAlerts().map((a) => a.id), ['novo']);
  });
});

describe('store — poda', () => {
  test('remove amostras fora da janela e devolve a contagem', () => {
    const t = Date.now();
    store.record('k', t - 10_000, 'up', 1, '');
    store.record('k', t, 'up', 1, '');

    assert.equal(store.prune(t - 5_000), 1);
    assert.equal(store.history('k', 0).length, 1);
  });
});
