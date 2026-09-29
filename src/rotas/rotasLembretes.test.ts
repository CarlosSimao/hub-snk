import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepositorioClientesArquivo } from '../repositorio/repositorioClientesArquivo.ts';
import { RepositorioContatosArquivo } from '../repositorio/repositorioContatosArquivo.ts';
import { RepositorioLembretesArquivo } from '../repositorio/repositorioLembretesArquivo.ts';
import { registrarRotasDeLembretes } from './rotasLembretes.ts';

let diretorio: string;
let servidor: FastifyInstance;
let clientes: RepositorioClientesArquivo;
let lembretes: RepositorioLembretesArquivo;
let contatos: RepositorioContatosArquivo;

const LEMBRETE_UNICO = {
  resumo: 'Relatório de horas',
  texto: 'Enviar relatório',
  tipo: 'unico',
  dataHora: '2026-10-01T12:00:00.000Z',
};

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-rotas-lembretes-'));
  clientes = new RepositorioClientesArquivo(diretorio);
  lembretes = new RepositorioLembretesArquivo(diretorio);
  contatos = new RepositorioContatosArquivo(diretorio);
  servidor = Fastify();
  registrarRotasDeLembretes(servidor, lembretes, clientes, contatos);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

describe('POST /api/lembretes', () => {
  it('cadastra o único com o próximo disparo', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/lembretes',
      payload: LEMBRETE_UNICO,
    });

    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().proximoDisparo, LEMBRETE_UNICO.dataHora);
    assert.equal(resposta.json().expressaoCron, '');
  });

  it('recusa o único sem data', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/lembretes',
      payload: { ...LEMBRETE_UNICO, dataHora: '' },
    });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /data e a hora/);
  });

  it('recusa a data sem fuso, que seria lida como UTC', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/lembretes',
      payload: { ...LEMBRETE_UNICO, dataHora: '2026-10-01' },
    });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /Data e hora inválidas/);
  });

  it('recusa o recorrente com cron inválido', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/lembretes',
      payload: { resumo: 'Ponto', texto: 'Ponto', tipo: 'recorrente', expressaoCron: '0 9 * *' },
    });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /cinco campos/);
  });

  it('recusa projeto de outro cliente', async () => {
    const alfa = await clientes.criar({ nome: 'Alfa' });
    const beta = await clientes.criar({ nome: 'Beta' });
    const projetoDoBeta = await clientes.adicionarProjeto(beta.id, { nome: 'Portal' });

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/lembretes',
      payload: { ...LEMBRETE_UNICO, clienteId: alfa.id, projetoId: projetoDoBeta.id },
    });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /Projeto não encontrado/);
  });

  it('aceita cliente e projeto dele', async () => {
    const alfa = await clientes.criar({ nome: 'Alfa' });
    const projeto = await clientes.adicionarProjeto(alfa.id, { nome: 'Portal' });

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/lembretes',
      payload: { ...LEMBRETE_UNICO, clienteId: alfa.id, projetoId: projeto.id },
    });

    assert.equal(resposta.statusCode, 201);
    assert.equal(resposta.json().projetoId, projeto.id);
  });
});

describe('POST /api/lembretes — resumo e contatos', () => {
  const CONTATO = { telefone: '', cargo: '', clienteId: null };

  function cadastrar(payload: Record<string, unknown>) {
    return servidor.inject({ method: 'POST', url: '/api/lembretes', payload });
  }

  it('recusa sem resumo', async () => {
    const resposta = await cadastrar({ ...LEMBRETE_UNICO, resumo: ' ' });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /resumo/);
  });

  it('grava os contatos quando envia e-mail', async () => {
    const ana = await contatos.criar({ ...CONTATO, nome: 'Ana', email: 'ana@alfa.com' });

    const resposta = await cadastrar({
      ...LEMBRETE_UNICO,
      enviarEmail: true,
      contatoIds: [ana.id],
    });

    assert.equal(resposta.statusCode, 201);
    assert.deepEqual(resposta.json().contatoIds, [ana.id]);
  });

  it('descarta os contatos quando não envia e-mail', async () => {
    const ana = await contatos.criar({ ...CONTATO, nome: 'Ana', email: 'ana@alfa.com' });

    const resposta = await cadastrar({
      ...LEMBRETE_UNICO,
      enviarEmail: false,
      contatoIds: [ana.id],
    });

    assert.equal(resposta.statusCode, 201);
    assert.deepEqual(resposta.json().contatoIds, []);
  });

  it('recusa contato sem e-mail', async () => {
    const ana = await contatos.criar({ ...CONTATO, nome: 'Ana', email: '' });

    const resposta = await cadastrar({
      ...LEMBRETE_UNICO,
      enviarEmail: true,
      contatoIds: [ana.id],
    });

    assert.equal(resposta.statusCode, 400);
    assert.match(resposta.json().mensagem, /não tem e-mail/);
  });

  it('recusa contato de outro cliente e aceita o sem cliente', async () => {
    const alfa = await clientes.criar({ nome: 'Alfa' });
    const beta = await clientes.criar({ nome: 'Beta' });
    const doBeta = await contatos.criar({
      ...CONTATO,
      nome: 'Bia',
      email: 'bia@beta.com',
      clienteId: beta.id,
    });
    const semCliente = await contatos.criar({ ...CONTATO, nome: 'Caio', email: 'caio@x.com' });

    const recusado = await cadastrar({
      ...LEMBRETE_UNICO,
      clienteId: alfa.id,
      enviarEmail: true,
      contatoIds: [doBeta.id],
    });
    const aceito = await cadastrar({
      ...LEMBRETE_UNICO,
      clienteId: alfa.id,
      enviarEmail: true,
      contatoIds: [semCliente.id],
    });

    assert.equal(recusado.statusCode, 400);
    assert.match(recusado.json().mensagem, /outro cliente/);
    assert.equal(aceito.statusCode, 201);
  });

  it('aceita contato de qualquer cliente quando o lembrete não tem cliente', async () => {
    const beta = await clientes.criar({ nome: 'Beta' });
    const doBeta = await contatos.criar({
      ...CONTATO,
      nome: 'Bia',
      email: 'bia@beta.com',
      clienteId: beta.id,
    });

    const resposta = await cadastrar({
      ...LEMBRETE_UNICO,
      enviarEmail: true,
      contatoIds: [doBeta.id],
    });

    assert.equal(resposta.statusCode, 201);
  });
});

describe('PUT /api/lembretes/:id', () => {
  it('mudar só o texto não rearma o único já disparado', async () => {
    const criado = await lembretes.criar({
      ...LEMBRETE_UNICO,
      tipo: 'unico',
      expressaoCron: '',
      clienteId: null,
      projetoId: null,
      enviarEmail: false,
      contatoIds: [],
      ativo: true,
    });
    await lembretes.registrarDisparo(criado.id, new Date('2026-10-01T12:00:10.000Z'));

    const resposta = await servidor.inject({
      method: 'PUT',
      url: `/api/lembretes/${criado.id}`,
      payload: { ...LEMBRETE_UNICO, texto: 'Enviar relatório mensal' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.notEqual(resposta.json().ultimoDisparoEm, '');
    assert.equal(resposta.json().proximoDisparo, null);
  });

  it('mudar a data rearma o único', async () => {
    const criado = await lembretes.criar({
      ...LEMBRETE_UNICO,
      tipo: 'unico',
      expressaoCron: '',
      clienteId: null,
      projetoId: null,
      enviarEmail: false,
      contatoIds: [],
      ativo: true,
    });
    await lembretes.registrarDisparo(criado.id, new Date('2026-10-01T12:00:10.000Z'));

    const resposta = await servidor.inject({
      method: 'PUT',
      url: `/api/lembretes/${criado.id}`,
      payload: { ...LEMBRETE_UNICO, dataHora: '2026-10-02T12:00:00.000Z' },
    });

    assert.equal(resposta.json().ultimoDisparoEm, '');
  });

  it('responde 404 para lembrete inexistente', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/lembretes/nao-existe',
      payload: LEMBRETE_UNICO,
    });

    assert.equal(resposta.statusCode, 404);
  });
});

describe('GET /api/lembretes/previa', () => {
  it('devolve as três próximas ocorrências', async () => {
    const resposta = await servidor.inject({
      method: 'GET',
      url: `/api/lembretes/previa?expressao=${encodeURIComponent('0 9 * * 1-5')}`,
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().ocorrencias.length, 3);
  });
});
