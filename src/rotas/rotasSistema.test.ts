import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { registrarRotasDeSistema } from './rotasSistema.ts';

const TOKEN_DO_SHELL = 'token-do-shell';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-rotas-sistema-'));
const arquivoDeToken = join(pasta, 'desktop-token.txt');
writeFileSync(arquivoDeToken, TOKEN_DO_SHELL);

after(() => rmSync(pasta, { recursive: true, force: true }));

function criarServidor(): { servidor: FastifyInstance; pedidosDeEncerramento: () => number } {
  let pedidos = 0;
  const servidor = Fastify();
  registrarRotasDeSistema(servidor, {
    arquivoTokenDoDesktop: arquivoDeToken,
    encerrar: () => {
      pedidos += 1;
    },
  });
  return { servidor, pedidosDeEncerramento: () => pedidos };
}

/* O encerramento é agendado com `setImmediate`, depois da resposta. */
function aguardarAgendamentos(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('GET /api/healthz', () => {
  it('responde 200 para a sonda de vida do shell desktop', async () => {
    const { servidor } = criarServidor();

    const resposta = await servidor.inject({ method: 'GET', url: '/api/healthz' });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), { ok: true });
  });
});

describe('POST /api/sistema/encerrar', () => {
  it('encerra depois de responder quando o pedido vem do shell', async () => {
    const { servidor, pedidosDeEncerramento } = criarServidor();

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/sistema/encerrar',
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
    });
    await aguardarAgendamentos();

    assert.equal(resposta.statusCode, 202);
    assert.equal(pedidosDeEncerramento(), 1);
  });

  it('não encerra sem o token do shell', async () => {
    const { servidor, pedidosDeEncerramento } = criarServidor();

    const semToken = await servidor.inject({ method: 'POST', url: '/api/sistema/encerrar' });
    const tokenErrado = await servidor.inject({
      method: 'POST',
      url: '/api/sistema/encerrar',
      headers: { 'x-hub-token': 'outro' },
    });
    await aguardarAgendamentos();

    assert.equal(semToken.statusCode, 401);
    assert.equal(tokenErrado.statusCode, 401);
    assert.equal(pedidosDeEncerramento(), 0);
  });
});
