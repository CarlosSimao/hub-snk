import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { NOME_DO_COOKIE_DO_TOKEN, registrarAutenticacaoDoPainel } from './autenticacaoDoPainel.ts';

const TOKEN_DO_SHELL = 'token-do-shell';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-autenticacao-'));
const arquivoDeToken = join(pasta, 'desktop-token.txt');
writeFileSync(arquivoDeToken, TOKEN_DO_SHELL);

after(() => rmSync(pasta, { recursive: true, force: true }));

function criarServidor({
  arquivoTokenDoDesktop = arquivoDeToken,
  desligada = false,
} = {}): FastifyInstance {
  const servidor = Fastify();
  registrarAutenticacaoDoPainel(servidor, { arquivoTokenDoDesktop, desligada });
  servidor.get('/api/healthz', async () => ({ ok: true }));
  servidor.get('/api/clientes', async () => [{ senha: 'segredo' }]);
  servidor.get('/index.html', async () => 'painel');
  return servidor;
}

describe('autenticação do painel', () => {
  it('recusa a API sem token', async () => {
    const resposta = await criarServidor().inject({ method: 'GET', url: '/api/clientes' });

    assert.equal(resposta.statusCode, 401);
  });

  it('recusa token errado, inclusive com o tamanho diferente', async () => {
    const servidor = criarServidor();

    const errado = await servidor.inject({
      method: 'GET',
      url: '/api/clientes',
      headers: { 'x-hub-token': 'token-do-outro' },
    });
    const curto = await servidor.inject({
      method: 'GET',
      url: '/api/clientes',
      headers: { cookie: `${NOME_DO_COOKIE_DO_TOKEN}=x` },
    });

    assert.equal(errado.statusCode, 401);
    assert.equal(curto.statusCode, 401);
  });

  it('aceita o token pelo cabeçalho do shell', async () => {
    const resposta = await criarServidor().inject({
      method: 'GET',
      url: '/api/clientes',
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
    });

    assert.equal(resposta.statusCode, 200);
  });

  it('aceita o token pelo cookie que o shell grava para o painel', async () => {
    const resposta = await criarServidor().inject({
      method: 'GET',
      url: '/api/clientes',
      headers: { cookie: `outro=1; ${NOME_DO_COOKIE_DO_TOKEN}=${TOKEN_DO_SHELL}` },
    });

    assert.equal(resposta.statusCode, 200);
  });

  it('confere a rota encontrada, não a escrita da URL', async () => {
    const resposta = await criarServidor().inject({ method: 'GET', url: '/%61pi/clientes' });

    assert.notEqual(resposta.statusCode, 200);
  });

  it('libera a sonda de vida e os arquivos do painel', async () => {
    const servidor = criarServidor();

    const sonda = await servidor.inject({ method: 'GET', url: '/api/healthz' });
    const painel = await servidor.inject({ method: 'GET', url: '/index.html' });

    assert.equal(sonda.statusCode, 200);
    assert.equal(painel.statusCode, 200);
  });

  it('responde 503 quando o shell ainda não gravou o token', async () => {
    const resposta = await criarServidor({
      arquivoTokenDoDesktop: join(pasta, 'inexistente.txt'),
    }).inject({ method: 'GET', url: '/api/clientes', headers: { 'x-hub-token': 'qualquer' } });

    assert.equal(resposta.statusCode, 503);
  });

  it('desligada, responde a API sem token', async () => {
    const resposta = await criarServidor({ desligada: true }).inject({
      method: 'GET',
      url: '/api/clientes',
    });

    assert.equal(resposta.statusCode, 200);
  });
});
