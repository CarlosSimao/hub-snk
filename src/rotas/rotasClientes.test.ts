import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepositorioClientesArquivo } from '../repositorio/arquivo/repositorioClientesArquivo.ts';
import { RepositorioConfiguracaoArquivo } from '../repositorio/arquivo/repositorioConfiguracaoArquivo.ts';
import { registrarRotasDeClientes } from './rotasClientes.ts';

const TOKEN_DO_SHELL = 'token-do-shell';
const ID_INEXISTENTE = '00000000-0000-4000-8000-000000000000';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-rotas-clientes-'));
const arquivoDeToken = join(pasta, 'desktop-token.txt');
writeFileSync(arquivoDeToken, TOKEN_DO_SHELL);

after(() => rmSync(pasta, { recursive: true, force: true }));

async function criarCenario(): Promise<{
  servidor: FastifyInstance;
  caminhoDaSenha: string;
}> {
  const pastaDeDados = mkdtempSync(join(pasta, 'dados-'));
  const repositorio = new RepositorioClientesArquivo(pastaDeDados);
  const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
  const base = await repositorio.adicionarBase(cliente.id, {
    url: 'https://alfa.sankhyacloud.com.br/mge',
    tipo: 'producao',
    usuario: 'usuario',
    senha: 'senha-da-base',
  });

  const servidor = Fastify();
  registrarRotasDeClientes(
    servidor,
    repositorio,
    new RepositorioConfiguracaoArquivo(pastaDeDados),
    arquivoDeToken,
  );

  return { servidor, caminhoDaSenha: `/api/clientes/${cliente.id}/bases/${base.id}/senha` };
}

describe('POST /api/clientes/:id/bases/:idBase/senha', () => {
  it('entrega a senha da base ao shell desktop', async () => {
    const { servidor, caminhoDaSenha } = await criarCenario();

    const resposta = await servidor.inject({
      method: 'POST',
      url: caminhoDaSenha,
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), { senha: 'senha-da-base' });
  });

  it('não entrega a senha sem o token do shell', async () => {
    const { servidor, caminhoDaSenha } = await criarCenario();

    const resposta = await servidor.inject({ method: 'POST', url: caminhoDaSenha });

    assert.equal(resposta.statusCode, 401);
    assert.equal(resposta.body.includes('senha-da-base'), false);
  });

  it('responde 404 para base que não existe', async () => {
    const { servidor, caminhoDaSenha } = await criarCenario();
    const caminhoDeOutraBase = caminhoDaSenha.replace(/bases\/[^/]+/, `bases/${ID_INEXISTENTE}`);

    const resposta = await servidor.inject({
      method: 'POST',
      url: caminhoDeOutraBase,
      headers: { 'x-hub-token': TOKEN_DO_SHELL },
    });

    assert.equal(resposta.statusCode, 404);
  });
});

describe('DELETE /api/clientes/:id', () => {
  it('avisa quem depende do cliente depois de excluí-lo', async () => {
    const pastaDeDados = mkdtempSync(join(pasta, 'dados-'));
    const repositorio = new RepositorioClientesArquivo(pastaDeDados);
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    const removidos: string[] = [];
    const servidor = Fastify();
    registrarRotasDeClientes(
      servidor,
      repositorio,
      new RepositorioConfiguracaoArquivo(pastaDeDados),
      arquivoDeToken,
      async (clienteId) => {
        removidos.push(clienteId);
      },
    );

    const resposta = await servidor.inject({
      method: 'DELETE',
      url: `/api/clientes/${cliente.id}`,
    });

    assert.equal(resposta.statusCode, 204);
    assert.deepEqual(removidos, [cliente.id]);
  });
});

describe('branchPrincipal do repositório', () => {
  async function criarCenarioDeRepositorios(): Promise<{
    servidor: FastifyInstance;
    idDoCliente: string;
    pastaDoRepositorio: string;
  }> {
    const pastaDeDados = mkdtempSync(join(pasta, 'dados-'));
    const repositorio = new RepositorioClientesArquivo(pastaDeDados);
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    const servidor = Fastify();
    registrarRotasDeClientes(
      servidor,
      repositorio,
      new RepositorioConfiguracaoArquivo(pastaDeDados),
      arquivoDeToken,
    );

    const pastaDoRepositorio = mkdtempSync(join(pasta, 'repo-'));
    const pastaDoOrigin = join(pastaDoRepositorio, '.git', 'refs', 'remotes', 'origin');
    mkdirSync(pastaDoOrigin, { recursive: true });
    writeFileSync(join(pastaDoOrigin, 'HEAD'), 'ref: refs/remotes/origin/develop\n');

    return { servidor, idDoCliente: cliente.id, pastaDoRepositorio };
  }

  it('exige a branch principal ao cadastrar', async () => {
    const { servidor, idDoCliente, pastaDoRepositorio } = await criarCenarioDeRepositorios();
    const corpo = { url: 'https://exemplo.com/alfa.git', caminhoLocal: pastaDoRepositorio };

    const semBranch = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/repositorios`,
      payload: corpo,
    });
    const vazia = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/repositorios`,
      payload: { ...corpo, branchPrincipal: '   ' },
    });
    const informada = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/repositorios`,
      payload: { ...corpo, branchPrincipal: ' main ' },
    });

    assert.equal(semBranch.statusCode, 400);
    assert.equal(vazia.statusCode, 400);
    assert.equal(informada.statusCode, 201);
    assert.equal(informada.json().branchPrincipal, 'main');
  });

  it('exige a branch principal ao editar', async () => {
    const { servidor, idDoCliente, pastaDoRepositorio } = await criarCenarioDeRepositorios();
    const criado = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/repositorios`,
      payload: {
        url: 'https://exemplo.com/alfa.git',
        caminhoLocal: pastaDoRepositorio,
        branchPrincipal: 'main',
      },
    });

    const resposta = await servidor.inject({
      method: 'PUT',
      url: `/api/clientes/${idDoCliente}/repositorios/${criado.json().id}`,
      payload: { url: 'https://exemplo.com/alfa.git', caminhoLocal: pastaDoRepositorio },
    });

    assert.equal(resposta.statusCode, 400);
  });

  it('na importação em lote, a branch é opcional e vem do origin/HEAD quando ausente', async () => {
    const { servidor, pastaDoRepositorio } = await criarCenarioDeRepositorios();
    const semOrigin = mkdtempSync(join(pasta, 'sem-origin-'));

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/clientes/importacao-de-repositorios',
      payload: {
        repositorios: [
          {
            nomeDoCliente: 'Beta',
            url: 'https://exemplo.com/beta.git',
            caminhoLocal: pastaDoRepositorio,
          },
          {
            nomeDoCliente: 'Gama',
            url: 'https://exemplo.com/gama.git',
            caminhoLocal: semOrigin,
            branchPrincipal: 'producao',
          },
          {
            nomeDoCliente: 'Delta',
            url: 'https://exemplo.com/delta.git',
            caminhoLocal: mkdtempSync(join(pasta, 'sem-head-')),
          },
        ],
      },
    });
    const clientes = (await servidor.inject({ method: 'GET', url: '/api/clientes' })).json();
    const branchPorNome = Object.fromEntries(
      clientes.map((item: { nome: string; repositorios: { branchPrincipal?: string }[] }) => [
        item.nome,
        item.repositorios[0]?.branchPrincipal,
      ]),
    );

    assert.equal(resposta.statusCode, 201);
    assert.equal(branchPorNome['Beta'], 'develop');
    assert.equal(branchPorNome['Gama'], 'producao');
    assert.equal(branchPorNome['Delta'], undefined);
  });
});
