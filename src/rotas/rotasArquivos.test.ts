import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { PastasDoExplorador } from '../arquivos/pastasDoExplorador.ts';
import { RepositorioClientesArquivo } from '../repositorio/arquivo/repositorioClientesArquivo.ts';
import { registrarRotasDeArquivos } from './rotasArquivos.ts';

const base = mkdtempSync(join(tmpdir(), 'hub-snk-rotas-arquivos-'));
after(() => rmSync(base, { recursive: true, force: true }));

async function criarCenario() {
  const dados = mkdtempSync(join(base, 'dados-'));
  const raiz = mkdtempSync(join(base, 'raiz-'));
  mkdirSync(join(raiz, 'docs'));
  writeFileSync(join(raiz, 'leia-me.txt'), 'oi');
  const clientes = new RepositorioClientesArquivo(dados);
  const cliente = await clientes.criar({ nome: 'Cliente' });
  const projeto = await clientes.adicionarProjeto(cliente.id, { nome: 'Projeto' });
  const servidor: FastifyInstance = Fastify();
  registrarRotasDeArquivos(servidor, clientes, new PastasDoExplorador(join(dados, 'estado')));
  return { servidor, raiz, cliente, projeto };
}

describe('rotas do explorador de arquivos', () => {
  it('sem pasta escolhida, lista vazio e recusa alterações', async () => {
    const { servidor, cliente } = await criarCenario();
    const lista = await servidor.inject(`/api/clientes/${cliente.id}/arquivos`);
    assert.equal(lista.json().pasta, null);
    const criar = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${cliente.id}/arquivos/criar-pasta`,
      payload: { caminho: '', nome: 'x' },
    });
    assert.equal(criar.statusCode, 409);
  });

  it('vincula a pasta, lista, cria, renomeia e exclui', async () => {
    const { servidor, raiz, cliente } = await criarCenario();
    const url = `/api/clientes/${cliente.id}/arquivos`;
    const vinculo = await servidor.inject({
      method: 'PUT',
      url: `${url}/pasta`,
      payload: { pasta: raiz },
    });
    assert.equal(vinculo.statusCode, 204);

    const lista = (await servidor.inject(url)).json();
    assert.deepEqual(
      lista.itens.map((item: { nome: string }) => item.nome),
      ['docs', 'leia-me.txt'],
    );

    const nova = await servidor.inject({
      method: 'POST',
      url: `${url}/criar-pasta`,
      payload: { caminho: 'docs', nome: 'nova' },
    });
    assert.equal(nova.statusCode, 204);
    assert.ok(existsSync(join(raiz, 'docs', 'nova')));

    const repetida = await servidor.inject({
      method: 'POST',
      url: `${url}/criar-pasta`,
      payload: { caminho: 'docs', nome: 'nova' },
    });
    assert.equal(repetida.statusCode, 409);

    const envio = await servidor.inject({
      method: 'POST',
      url: `${url}/enviar`,
      payload: {
        caminho: 'docs',
        nome: 'a.txt',
        conteudoBase64: Buffer.from('abc').toString('base64'),
      },
    });
    assert.equal(envio.statusCode, 204);

    const renomeio = await servidor.inject({
      method: 'POST',
      url: `${url}/renomear`,
      payload: { caminho: 'docs/a.txt', nome: 'b.txt' },
    });
    assert.equal(renomeio.statusCode, 204);
    assert.ok(existsSync(join(raiz, 'docs', 'b.txt')));

    const exclusao = await servidor.inject({
      method: 'POST',
      url: `${url}/excluir`,
      payload: { caminho: 'docs' },
    });
    assert.equal(exclusao.statusCode, 204);
    assert.equal(existsSync(join(raiz, 'docs')), false);
  });

  it('recusa caminho fora da pasta e programa executável', async () => {
    const { servidor, raiz, cliente } = await criarCenario();
    const url = `/api/clientes/${cliente.id}/arquivos`;
    await servidor.inject({ method: 'PUT', url: `${url}/pasta`, payload: { pasta: raiz } });
    writeFileSync(join(raiz, 'setup.exe'), '');

    const fora = await servidor.inject(`${url}?caminho=${encodeURIComponent('../')}`);
    assert.equal(fora.statusCode, 400);
    const excluirFora = await servidor.inject({
      method: 'POST',
      url: `${url}/excluir`,
      payload: { caminho: '../' },
    });
    assert.equal(excluirFora.statusCode, 400);
    const executar = await servidor.inject({
      method: 'POST',
      url: `${url}/abrir`,
      payload: { caminho: 'setup.exe' },
    });
    assert.equal(executar.statusCode, 400);
  });

  it('cada projeto tem a própria pasta, separada da do cliente', async () => {
    const { servidor, raiz, cliente, projeto } = await criarCenario();
    const urlDoProjeto = `/api/clientes/${cliente.id}/projetos/${projeto.id}/arquivos`;
    await servidor.inject({
      method: 'PUT',
      url: `${urlDoProjeto}/pasta`,
      payload: { pasta: raiz },
    });
    assert.equal((await servidor.inject(urlDoProjeto)).json().pasta, raiz);
    assert.equal(
      (await servidor.inject(`/api/clientes/${cliente.id}/arquivos`)).json().pasta,
      null,
    );
    const inexistente = await servidor.inject(
      `/api/clientes/${cliente.id}/projetos/nao-existe/arquivos`,
    );
    assert.equal(inexistente.statusCode, 404);
  });
});
