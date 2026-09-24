import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import { registrarRotasDeSistema } from './rotasSistema.ts';

describe('GET /api/healthz', () => {
  it('responde 200 para a sonda de vida do shell desktop', async () => {
    const servidor = Fastify();
    registrarRotasDeSistema(servidor);

    const resposta = await servidor.inject({ method: 'GET', url: '/api/healthz' });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), { ok: true });
  });
});
