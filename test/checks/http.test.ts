import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { runHttpCheck } from '../../src/checks/http.ts';
import { runTcpCheck } from '../../src/checks/tcp.ts';
import { check, servidorHttp, servidorTcp, portaFechada, esperar } from '../helpers.ts';

describe('check http', () => {
  test('200 acende verde e mede latência', async () => {
    const s = await servidorHttp((_q, r) => r.writeHead(200).end('ok'));
    after(() => s.close());

    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/` }));
    assert.equal(out.status, 'up');
    assert.match(out.message, /HTTP 200/);
    assert.ok(typeof out.latencyMs === 'number' && out.latencyMs >= 0);
    assert.ok(out.indicators.some((i) => i.id === 'latency'));
  });

  test('sem expectStatus, 204 passa', async () => {
    const s = await servidorHttp((_q, r) => r.writeHead(204).end());
    after(() => s.close());

    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/`, method: 'HEAD' }));
    assert.equal(out.status, 'up');
    assert.match(out.message, /HTTP 204/);
  });

  test('segue redirect e avalia o destino final', async () => {
    const s = await servidorHttp((q, r) => {
      if (q.url === '/destino') r.writeHead(200).end('chegou');
      else r.writeHead(301, { location: '/destino' }).end();
    });
    after(() => s.close());

    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/` }));
    assert.equal(out.status, 'up');
    assert.match(out.message, /HTTP 200/);
  });

  test('500 derruba quando o esperado é 2xx', async () => {
    const s = await servidorHttp((_q, r) => r.writeHead(500).end('boom'));
    after(() => s.close());

    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/` }));
    assert.equal(out.status, 'down');
    assert.match(out.message, /HTTP 500/);
  });

  test('expectStatus permite tratar 401 como saudável', async () => {
    const s = await servidorHttp((_q, r) => r.writeHead(401).end());
    after(() => s.close());

    const ok = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/`, expectStatus: [401] }));
    assert.equal(ok.status, 'up');

    const nok = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/`, expectStatus: [200] }));
    assert.equal(nok.status, 'down');
    assert.match(nok.message, /esperado 200/);
  });

  test('expectBodyContains reprova corpo que não bate', async () => {
    const s = await servidorHttp((_q, r) => r.writeHead(200).end('{"ok":false}'));
    after(() => s.close());

    const out = await runHttpCheck(
      check('http', { url: `http://127.0.0.1:${s.port}/`, expectBodyContains: '"ok":true' }),
    );
    assert.equal(out.status, 'down');
    assert.match(out.message, /corpo não contém/);
  });

  test('degradedAboveMs pinta amarelo sem derrubar', async () => {
    const s = await servidorHttp(async (_q, r) => {
      await esperar(120);
      r.writeHead(200).end('ok');
    });
    after(() => s.close());

    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/`, degradedAboveMs: 20 }));
    assert.equal(out.status, 'degraded');
    assert.match(out.message, /lento/);
  });

  test('timeout vira mensagem legível, não erro cru do undici', async () => {
    const s = await servidorHttp(async (_q, r) => {
      await esperar(2000);
      r.writeHead(200).end();
    });
    after(() => s.close());

    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${s.port}/`, timeoutMs: 300 }));
    assert.equal(out.status, 'down');
    assert.match(out.message, /timeout após 300ms/);
    assert.equal(out.latencyMs, null);
  });

  test('conexão recusada explica a causa provável', async () => {
    const porta = await portaFechada();
    const out = await runHttpCheck(check('http', { url: `http://127.0.0.1:${porta}/`, timeoutMs: 2000 }));
    assert.equal(out.status, 'down');
    assert.match(out.message, /recusada/);
  });
});

describe('check tcp', () => {
  test('porta aberta acende verde', async () => {
    const s = await servidorTcp();
    after(() => s.close());

    const out = await runTcpCheck(check('tcp', { host: '127.0.0.1', port: s.port }));
    assert.equal(out.status, 'up');
    assert.match(out.message, /aberta/);
    assert.ok(out.indicators.some((i) => i.id === 'latency'));
  });

  test('porta fechada derruba com a causa', async () => {
    const porta = await portaFechada();
    const out = await runTcpCheck(check('tcp', { host: '127.0.0.1', port: porta }));
    assert.equal(out.status, 'down');
    assert.match(out.message, /recusada/);
  });

  test('host inexistente é reportado como não resolvido', async () => {
    const out = await runTcpCheck(
      check('tcp', { host: 'host-que-nao-existe.invalid', port: 80, timeoutMs: 4000 }),
    );
    assert.equal(out.status, 'down');
    assert.match(out.message, /não resolvido|ENOTFOUND|EAI_AGAIN/i);
  });
});
