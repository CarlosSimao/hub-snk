import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepositorioClientesArquivo } from '../repositorio/arquivo/repositorioClientesArquivo.ts';
import { RepositorioContatosArquivo } from '../repositorio/arquivo/repositorioContatosArquivo.ts';
import { registrarRotasDeContatos } from './rotasContatos.ts';

let diretorio: string;
let servidor: FastifyInstance;
let clientes: RepositorioClientesArquivo;

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-rotas-contatos-'));
  clientes = new RepositorioClientesArquivo(diretorio);
  servidor = Fastify();
  registrarRotasDeContatos(servidor, new RepositorioContatosArquivo(diretorio), clientes);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

function cadastrar(payload: Record<string, unknown>) {
  return servidor.inject({ method: 'POST', url: '/api/contatos', payload });
}

describe('POST /api/contatos', () => {
  it('cadastra só com o nome, com os outros campos vazios', async () => {
    const resposta = await cadastrar({ nome: 'Ana' });

    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().email, '');
    assert.equal(resposta.json().clienteId, null);
  });

  it('recusa sem nome', async () => {
    const resposta = await cadastrar({ nome: '  ' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /nome/);
  });

  it('recusa e-mail inválido', async () => {
    const resposta = await cadastrar({ nome: 'Ana', email: 'ana@' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /E-mail inválido/);
  });

  it('vincula a um cliente que existe', async () => {
    const cliente = await clientes.criar({ nome: 'Alfa' });

    const resposta = await cadastrar({ nome: 'Ana', clienteId: cliente.id });

    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().clienteId, cliente.id);
  });

  it('recusa cliente que não existe', async () => {
    const resposta = await cadastrar({ nome: 'Ana', clienteId: 'nenhum' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /Cliente não encontrado/);
  });
});

describe('PUT e DELETE /api/contatos/:id', () => {
  it('altera e depois remove', async () => {
    const { id } = (await cadastrar({ nome: 'Ana' })).json();

    const alterado = await servidor.inject({
      method: 'PUT',
      url: `/api/contatos/${id}`,
      payload: { nome: 'Ana Souza', cargo: 'Coordenadora' },
    });
    assert.equal(alterado.statusCode, 200);
    assert.equal(alterado.json().cargo, 'Coordenadora');

    const removido = await servidor.inject({ method: 'DELETE', url: `/api/contatos/${id}` });
    assert.equal(removido.statusCode, 204);

    const lista = await servidor.inject({ method: 'GET', url: '/api/contatos' });
    assert.deepEqual(lista.json().contatos, []);
  });

  it('responde 404 para contato que não existe', async () => {
    const resposta = await servidor.inject({ method: 'DELETE', url: '/api/contatos/nenhum' });

    assert.equal(resposta.statusCode, 404);
  });
});
