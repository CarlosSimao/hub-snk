import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { Credenciais } from '../sankhya/credenciais.ts';
import { HubHelper } from '../sankhya/helper.ts';
import { PonteDoDesktop } from '../sankhya/ponteDoDesktop.ts';
import { SessaoDoDesktop } from '../sankhya/sessaoDoDesktop.ts';
import { registrarRotasDeSankhya } from './rotasSankhya.ts';

/* Porta 1 é reservada e nunca escuta: conexão recusada na hora. */
const URL_SEM_NINGUEM_ESCUTANDO = 'http://127.0.0.1:1';
const TOKEN_DO_SHELL = 'token-do-shell';
const CAMINHO_DA_EXPERIENCE = '/api/sankhya/desktop/sessao/sankhya-experience';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-rotas-sankhya-'));
const arquivoDeToken = join(pasta, 'desktop-token.txt');
writeFileSync(arquivoDeToken, TOKEN_DO_SHELL);

after(() => rmSync(pasta, { recursive: true, force: true }));

function criarServidor(arquivoTokenDoDesktop = arquivoDeToken): {
  servidor: FastifyInstance;
  sessaoDoDesktop: SessaoDoDesktop;
} {
  const sessaoDoDesktop = new SessaoDoDesktop();
  const credenciais = new Credenciais(
    new PonteDoDesktop(URL_SEM_NINGUEM_ESCUTANDO, arquivoTokenDoDesktop),
    new HubHelper(URL_SEM_NINGUEM_ESCUTANDO, arquivoTokenDoDesktop),
    sessaoDoDesktop,
  );
  const servidor = Fastify();
  registrarRotasDeSankhya(servidor, credenciais, sessaoDoDesktop, arquivoTokenDoDesktop);
  return { servidor, sessaoDoDesktop };
}

describe('rotas de sessão do shell desktop', () => {
  it('guarda a sessão empurrada com o token do shell', async () => {
    const { servidor, sessaoDoDesktop } = criarServidor();

    const resposta = await servidor.inject({
      method: 'POST',
      url: CAMINHO_DA_EXPERIENCE,
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
      payload: { usuario: 'usuario', token: 'jwt', expira: '' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(sessaoDoDesktop.obter()?.token, 'jwt');
  });

  it('recusa quem não apresenta o token do shell', async () => {
    const { servidor, sessaoDoDesktop } = criarServidor();

    const semToken = await servidor.inject({
      method: 'POST',
      url: CAMINHO_DA_EXPERIENCE,
      payload: { usuario: 'usuario', token: 'jwt' },
    });
    const tokenErrado = await servidor.inject({
      method: 'POST',
      url: CAMINHO_DA_EXPERIENCE,
      headers: { 'x-hub-token': 'outro' },
      payload: { usuario: 'usuario', token: 'jwt' },
    });

    assert.equal(semToken.statusCode, 401);
    assert.equal(tokenErrado.statusCode, 401);
    assert.equal(sessaoDoDesktop.obter(), undefined);
  });

  it('responde 503 quando o shell não gravou o token', async () => {
    const { servidor } = criarServidor(join(pasta, 'nao-existe.txt'));

    const resposta = await servidor.inject({
      method: 'POST',
      url: CAMINHO_DA_EXPERIENCE,
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
      payload: { usuario: 'usuario', token: 'jwt' },
    });

    assert.equal(resposta.statusCode, 503);
  });

  it('só aceita sessão empurrada da Experience', async () => {
    const { servidor } = criarServidor();

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/sankhya/desktop/sessao/sankhya-erp',
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
      payload: { usuario: 'usuario', token: 'jwt' },
    });

    assert.equal(resposta.statusCode, 404);
  });

  it('recusa sessão sem token', async () => {
    const { servidor } = criarServidor();

    const resposta = await servidor.inject({
      method: 'POST',
      url: CAMINHO_DA_EXPERIENCE,
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
      payload: { usuario: 'usuario', token: '' },
    });

    assert.equal(resposta.statusCode, 400);
  });

  it('esquece a sessão no DELETE', async () => {
    const { servidor, sessaoDoDesktop } = criarServidor();
    sessaoDoDesktop.definir({ usuario: 'usuario', token: 'jwt', expira: '' });

    const resposta = await servidor.inject({
      method: 'DELETE',
      url: CAMINHO_DA_EXPERIENCE,
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(sessaoDoDesktop.obter(), undefined);
  });
});
