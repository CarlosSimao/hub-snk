import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Engine, type FonteDeDesativados, type FonteDeConfiguracoesCheck } from '../src/engine.ts';
import { Store } from '../src/store.ts';
import { DockerClient } from '../src/docker.ts';
import { parseConfig } from '../src/config.ts';
import { dirTemporario, servidorHttp, esperar, type Servidor } from './helpers.ts';
import type { Alert } from '../src/types.ts';

/** Fake em memória de `Desativados`, mutável a qualquer momento pelo teste. */
class DesativadosFake implements FonteDeDesativados {
  #servicos = new Set<string>();
  #checks = new Map<string, Set<string>>();

  servicoDesabilitado(serviceId: string): boolean {
    return this.#servicos.has(serviceId);
  }

  checkDesabilitado(serviceId: string, checkId: string): boolean {
    return this.#checks.get(serviceId)?.has(checkId) ?? false;
  }

  definirServico(serviceId: string, desabilitado: boolean): void {
    if (desabilitado) this.#servicos.add(serviceId);
    else this.#servicos.delete(serviceId);
  }

  definirCheck(serviceId: string, checkId: string, desabilitado: boolean): void {
    const atual = this.#checks.get(serviceId) ?? new Set<string>();
    if (desabilitado) atual.add(checkId);
    else atual.delete(checkId);
    this.#checks.set(serviceId, atual);
  }
}

/** Fake em memória de `ConfiguracoesCheck`, mutável a qualquer momento pelo teste. */
class ConfiguracoesFake implements FonteDeConfiguracoesCheck {
  #overrides = new Map<string, { intervalMs: number; timeoutMs: number }>();

  overridesDe(serviceId: string, checkId: string) {
    return this.#overrides.get(`${serviceId}:${checkId}`);
  }

  definir(serviceId: string, checkId: string, override: { intervalMs: number; timeoutMs: number }): void {
    this.#overrides.set(`${serviceId}:${checkId}`, override);
  }
}

/**
 * Estes testes sobem o Engine de verdade contra um servidor HTTP local que eles
 * controlam. Nada de mock do proprio motor: o que esta sob teste sao justamente as
 * REGRAS de quando interromper alguem, e elas so aparecem no fluxo completo
 * (medicao -> limiar de falhas -> transicao -> alerta).
 */

let dir: ReturnType<typeof dirTemporario>;
let store: Store;
let engine: Engine;
let alvo: Servidor<import('node:http').Server>;
let saudavel = true;
let alertas: Alert[] = [];

const yaml = (port: number, extras: string, alerts = '') => `
retentionHours: 1
startupDelayMs: 0
alerts:
  enabled: true
${alerts}
services:
  - id: s
    name: Serviço
    checks:
      - id: api
        name: API
        type: http
        url: http://127.0.0.1:${port}/
        intervalMs: 2000
        timeoutMs: 1500
        failureThreshold: 1
${extras}
`;

async function subir(
  extras = '',
  alerts = '',
  desativados?: FonteDeDesativados,
  configuracoes?: FonteDeConfiguracoesCheck,
): Promise<void> {
  dir = dirTemporario();
  store = new Store(dir.path);
  engine = new Engine(
    parseConfig(yaml(alvo.port, extras, alerts)),
    store,
    new DockerClient(''),
    undefined,
    desativados,
    configuracoes,
  );
  alertas = [];
  engine.on('alert', (a: Alert) => alertas.push(a));
  engine.start();
}

beforeEach(async () => {
  saudavel = true;
  alvo = await servidorHttp((_q, r) => r.writeHead(saudavel ? 200 : 500).end());
});

afterEach(async () => {
  engine?.stop();
  store?.close();
  dir?.remove();
  await alvo.close();
});

/**
 * Espera ate a condicao valer ou estourar o prazo — evita sleep fixo.
 *
 * Os prazos sao generosos de proposito: estes testes dependem de tempo real (ciclos de
 * 2s do scheduler) e rodam tambem em runner de CI compartilhado, onde jitter de
 * escalonamento e comum. Prazo curto aqui viraria teste intermitente, que e pior que
 * teste ausente.
 */
async function ate(cond: () => boolean, limite = 15000): Promise<boolean> {
  const fim = Date.now() + limite;
  while (Date.now() < fim) {
    if (cond()) return true;
    await esperar(120);
  }
  return cond();
}

describe('engine — alertas', () => {
  /**
   * Sem isto, reiniciar o hub com um servico ja fora do ar re-notificaria tudo — e o
   * estado restaurado do snapshot faria transicoes falsas parecerem novidade.
   */
  test('a primeira medição nunca alerta', async () => {
    saudavel = false;
    await subir();

    await ate(() => engine.snapshot().services[0]!.checks[0]!.status !== 'unknown');
    assert.equal(alertas.length, 0, 'primeira medição não pode alertar');
  });

  test('queda depois de estável gera um alerta crítico', async () => {
    await subir();
    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

    saudavel = false;
    assert.ok(await ate(() => alertas.length > 0), 'deveria ter alertado');
    assert.equal(alertas.length, 1);
    assert.equal(alertas[0]!.severity, 'critical');
    assert.equal(alertas[0]!.from, 'up');
    assert.equal(alertas[0]!.to, 'down');
    assert.equal(alertas[0]!.serviceName, 'Serviço');
  });

  test('estado estável não repete alerta a cada ciclo', async () => {
    await subir();
    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

    saudavel = false;
    await ate(() => alertas.length > 0);
    const depoisDaQueda = alertas.length;

    await esperar(5000); // vários ciclos com o alvo ainda caído
    assert.equal(alertas.length, depoisDaQueda, 'vermelho contínuo não pode notificar de novo');
  });

  test('recuperação gera alerta próprio', async () => {
    await subir();
    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

    saudavel = false;
    await ate(() => alertas.length > 0);

    saudavel = true;
    assert.ok(await ate(() => alertas.length > 1), 'deveria alertar a recuperação');
    assert.equal(alertas.at(-1)!.severity, 'recovery');
    assert.equal(alertas.at(-1)!.to, 'up');
  });

  test('onRecovery: false silencia a volta, mas não a queda', async () => {
    await subir('', '  onRecovery: false\n');
    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

    saudavel = false;
    await ate(() => alertas.length > 0);
    saudavel = true;

    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');
    await esperar(2500);
    assert.equal(alertas.filter((a) => a.severity === 'recovery').length, 0);
  });

  test('check muted nunca alerta', async () => {
    const mutado = `      - id: quieto
        name: Quieto
        type: http
        url: http://127.0.0.1:${0}/
        intervalMs: 2000
        failureThreshold: 1
        muted: true`;
    await subir(mutado.replace('127.0.0.1:0', `127.0.0.1:${alvo.port}`));

    await ate(() => engine.snapshot().services[0]!.checks.every((c) => c.status !== 'unknown'));
    saudavel = false;
    await ate(() => alertas.length > 0);
    await esperar(2500);

    assert.ok(alertas.every((a) => a.checkId !== 'quieto'), 'check silenciado não pode alertar');
  });

  /** Variavel faltando e problema de configuracao do hub, nao incidente do servico. */
  test('transições envolvendo unknown nunca alertam', async () => {
    const semVar = `      - id: semvar
        name: Sem variável
        type: oracle
        host: \${VARIAVEL_QUE_NAO_EXISTE}
        serviceName: XE
        user: u
        password: p
        intervalMs: 2000`;
    await subir(semVar);

    await ate(() => engine.snapshot().services[0]!.checks.some((c) => c.checkId === 'semvar' && c.status === 'unknown'));
    saudavel = false;
    await ate(() => alertas.length > 0);

    assert.ok(alertas.every((a) => a.from !== 'unknown' && a.to !== 'unknown'));
    assert.ok(alertas.every((a) => a.checkId !== 'semvar'));
  });

  test('alertas ficam persistidos e disponíveis no feed', async () => {
    await subir();
    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');
    saudavel = false;
    await ate(() => alertas.length > 0);

    const feed = engine.recentAlerts();
    assert.equal(feed.length, 1);
    assert.equal(feed[0]!.severity, 'critical');
    assert.equal(engine.snapshot().alerts.length, 1);
  });

  test('emitTestAlert dispara sem depender de nenhum serviço real', async () => {
    await subir();
    const a = engine.emitTestAlert();
    assert.equal(a.severity, 'critical');
    assert.ok(alertas.some((x) => x.id === a.id));
  });
});

describe('engine — limiar de falhas', () => {
  test('failureThreshold 2 pinta amarelo na 1ª falha e vermelho na 2ª', async () => {
    dir = dirTemporario();
    store = new Store(dir.path);
    const cfg = parseConfig(`
retentionHours: 1
startupDelayMs: 0
services:
  - id: s
    name: S
    checks:
      - id: api
        name: API
        type: http
        url: http://127.0.0.1:${alvo.port}/
        intervalMs: 2000
        timeoutMs: 1500
        failureThreshold: 2
`);
    engine = new Engine(cfg, store, new DockerClient(''));
    engine.start();

    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

    saudavel = false;
    // Uma falha isolada (deploy, GC, rede piscando) não pode virar vermelho.
    assert.ok(await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'degraded', 8000));
    assert.ok(await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'down', 12000));
  });
});

describe('engine — agregação do serviço', () => {
  test('check muted não contamina o status do card', async () => {
    const mutado = `      - id: quieto
        name: Quieto
        type: tcp
        host: 127.0.0.1
        port: 1
        intervalMs: 2000
        failureThreshold: 1
        muted: true`;
    await subir(mutado);

    await ate(() => engine.snapshot().services[0]!.checks.every((c) => c.status !== 'unknown'));

    const snap = engine.snapshot();
    assert.equal(snap.services[0]!.checks.find((c) => c.checkId === 'quieto')!.status, 'down');
    assert.equal(snap.services[0]!.status, 'up', 'o card não pode ficar vermelho por um check silenciado');
  });
});

describe('engine — desabilitado', () => {
  test('check desabilitado nasce sem bater no servidor e fica congelado', async () => {
    let hits = 0;
    const contado = await servidorHttp((_q, r) => {
      hits += 1;
      r.writeHead(200).end();
    });
    try {
      const extras = `      - id: pausado
        name: Pausado
        type: http
        url: http://127.0.0.1:${contado.port}/
        intervalMs: 2000
        timeoutMs: 1500
        failureThreshold: 1`;

      const desativados = new DesativadosFake();
      desativados.definirCheck('s', 'pausado', true);
      await subir(extras, '', desativados);

      // Da tempo pra pelo menos um ciclo do intervalo de 2s passar.
      await esperar(2500);
      assert.equal(hits, 0, 'check desabilitado não pode gerar requisição nenhuma');

      const pausado = engine.snapshot().services[0]!.checks.find((c) => c.checkId === 'pausado')!;
      assert.equal(pausado.status, 'unknown');
      assert.equal(pausado.disabled, true);
      assert.match(pausado.message, /desabilitado/);
    } finally {
      await contado.close();
    }
  });

  test('refreshDisabled reabilita e mede na hora, sem esperar o próximo ciclo', async () => {
    const desativados = new DesativadosFake();
    desativados.definirCheck('s', 'api', true);
    await subir('', '', desativados);

    await esperar(300);
    assert.equal(engine.snapshot().services[0]!.checks[0]!.status, 'unknown');

    desativados.definirCheck('s', 'api', false);
    engine.refreshDisabled();

    assert.ok(await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up'));
  });

  test('desabilitar em runtime para o timer — sem requisição nova depois do toggle', async () => {
    let hits = 0;
    const contado = await servidorHttp((_q, r) => {
      hits += 1;
      r.writeHead(200).end();
    });
    try {
      const extras = `      - id: alvo2
        name: Alvo 2
        type: http
        url: http://127.0.0.1:${contado.port}/
        intervalMs: 2000
        timeoutMs: 1500
        failureThreshold: 1`;

      const desativados = new DesativadosFake();
      await subir(extras, '', desativados);

      assert.ok(await ate(() => hits > 0), 'deveria ter batido pelo menos uma vez habilitado');

      desativados.definirCheck('s', 'alvo2', true);
      engine.refreshDisabled();
      const hitsNoToggle = hits;

      await esperar(4500); // mais de dois ciclos de 2s
      assert.equal(hits, hitsNoToggle, 'desabilitado não pode continuar batendo no servidor');

      const alvo2 = engine.snapshot().services[0]!.checks.find((c) => c.checkId === 'alvo2')!;
      assert.equal(alvo2.status, 'unknown');
      assert.equal(alvo2.disabled, true);
    } finally {
      await contado.close();
    }
  });

  test('projeto desabilitado não contamina o semáforo global', async () => {
    const outro = await servidorHttp((_q, r) => r.writeHead(200).end());
    try {
      dir = dirTemporario();
      store = new Store(dir.path);
      const cfg = parseConfig(`
retentionHours: 1
startupDelayMs: 0
services:
  - id: quebrado
    name: Quebrado
    checks:
      - id: api
        name: API
        type: http
        url: http://127.0.0.1:${alvo.port}/
        intervalMs: 2000
        timeoutMs: 1500
        failureThreshold: 1
  - id: saudavel
    name: Saudável
    checks:
      - id: api
        name: API
        type: http
        url: http://127.0.0.1:${outro.port}/
        intervalMs: 2000
        timeoutMs: 1500
        failureThreshold: 1
`);
      const desativados = new DesativadosFake();
      desativados.definirServico('quebrado', true);
      saudavel = false; // "quebrado" apontaria pro alvo derrubado, se chegasse a rodar

      engine = new Engine(cfg, store, new DockerClient(''), undefined, desativados);
      engine.start();

      assert.ok(
        await ate(() => engine.snapshot().services.find((s) => s.id === 'saudavel')!.checks[0]!.status === 'up'),
      );

      const snap = engine.snapshot();
      assert.equal(snap.services.find((s) => s.id === 'quebrado')!.disabled, true);
      assert.equal(snap.status, 'up', 'projeto desabilitado não pode derrubar o semáforo global');
    } finally {
      await outro.close();
    }
  });
});

describe('engine — configurações do check', () => {
  test('refreshCheckConfig reflete o intervalo e o timeout novos no snapshot', async () => {
    const configuracoes = new ConfiguracoesFake();
    await subir('', '', undefined, configuracoes);

    await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

    configuracoes.definir('s', 'api', { intervalMs: 5000, timeoutMs: 3000 });
    engine.refreshCheckConfig('s', 'api');

    const check = engine.snapshot().services[0]!.checks[0]!;
    assert.equal(check.intervalMs, 5000);
    assert.equal(check.timeoutMs, 3000);
  });

  // Garante que o override chega de verdade no `runCheck`, e não só no campo ecoado
  // pelo snapshot — um bug em `#comEfetivo` que perdesse o timeout não apareceria
  // no teste acima.
  test('refreshCheckConfig com timeout menor derruba um check lento na próxima execução', async () => {
    const lento = await servidorHttp((_q, r) => {
      setTimeout(() => r.writeHead(200).end(), 300);
    });
    try {
      dir = dirTemporario();
      store = new Store(dir.path);
      const cfg = parseConfig(`
retentionHours: 1
startupDelayMs: 0
services:
  - id: s
    name: S
    checks:
      - id: api
        name: API
        type: http
        url: http://127.0.0.1:${lento.port}/
        intervalMs: 2000
        timeoutMs: 5000
        failureThreshold: 1
`);
      const configuracoes = new ConfiguracoesFake();
      engine = new Engine(cfg, store, new DockerClient(''), undefined, undefined, configuracoes);
      engine.start();

      await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up');

      configuracoes.definir('s', 'api', { intervalMs: 2000, timeoutMs: 100 });
      engine.refreshCheckConfig('s', 'api');

      assert.ok(
        await ate(() => engine.snapshot().services[0]!.checks[0]!.status !== 'up'),
        'timeout novo (100ms) devia derrubar um check que responde em 300ms',
      );
    } finally {
      await lento.close();
    }
  });

  test('reabilitar um check com override usa o intervalo/timeout salvos, não os do YAML', async () => {
    const desativados = new DesativadosFake();
    const configuracoes = new ConfiguracoesFake();
    configuracoes.definir('s', 'api', { intervalMs: 9000, timeoutMs: 4000 });
    desativados.definirCheck('s', 'api', true);

    await subir('', '', desativados, configuracoes);
    await esperar(300);
    assert.equal(engine.snapshot().services[0]!.checks[0]!.status, 'unknown');

    desativados.definirCheck('s', 'api', false);
    engine.refreshDisabled();

    assert.ok(await ate(() => engine.snapshot().services[0]!.checks[0]!.status === 'up'));
    const check = engine.snapshot().services[0]!.checks[0]!;
    assert.equal(check.intervalMs, 9000);
    assert.equal(check.timeoutMs, 4000);
  });
});
