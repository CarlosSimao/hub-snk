import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepositorioConfiguracaoArquivo } from '../repositorio/repositorioConfiguracaoArquivo.ts';
import { registrarRotasDeConfiguracao } from './rotasConfiguracao.ts';

const CONFIGURACAO_SEM_DESTINO_DOS_LINKS = {
  scriptPadrao: '',
  intervaloDeExecucaoAutomaticaSegundos: 30,
  tempoLimiteSegundos: 5,
};

let diretorio: string;
let servidor: FastifyInstance;

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-rotas-configuracao-'));
  servidor = Fastify();
  registrarRotasDeConfiguracao(servidor, new RepositorioConfiguracaoArquivo(diretorio));
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

describe('PUT /api/configuracao — destino dos links', () => {
  it('aplica o padrão quando a tela não manda a escolha', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: CONFIGURACAO_SEM_DESTINO_DOS_LINKS,
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().destinoDosLinks, 'hub');
  });

  it('grava a escolha mandada', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: { ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS, destinoDosLinks: 'navegador-padrao' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().destinoDosLinks, 'navegador-padrao');
  });

  it('recusa um destino desconhecido', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: {
        ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS,
        destinoDosLinks: 'firefox',
      },
    });

    assert.equal(resposta.statusCode, 400);
  });
});

describe('PUT /api/configuracao — acessos', () => {
  it('grava o perfil e as funcionalidades ocultas', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: {
        ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS,
        perfil: 'consultor',
        funcionalidadesOcultas: ['cliente.repositorios', 'agenda'],
      },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().perfil, 'consultor');
    assert.deepEqual(resposta.json().funcionalidadesOcultas, ['cliente.repositorios', 'agenda']);
  });

  it('grava e devolve o acesso de terceiro', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: { ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS, terceiro: true },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().terceiro, true);
  });

  it('recusa um terceiro que não é booleano', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: { ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS, terceiro: 'sim' },
    });

    assert.equal(resposta.statusCode, 400);
  });

  it('recusa um perfil desconhecido', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: { ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS, perfil: 'estagiario' },
    });

    assert.equal(resposta.statusCode, 400);
  });

  it('recusa ocultar Clientes, que não é ocultável', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: { ...CONFIGURACAO_SEM_DESTINO_DOS_LINKS, funcionalidadesOcultas: ['clientes'] },
    });

    assert.equal(resposta.statusCode, 400);
  });
});

describe('GET /api/configuracao/perfis', () => {
  it('devolve o preset de cada perfil', async () => {
    const resposta = await servidor.inject({ method: 'GET', url: '/api/configuracao/perfis' });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), {
      desenvolvedor: [],
      consultor: ['cliente.repositorios'],
      analista: ['cliente.repositorios'],
      'gerente-de-projeto': ['cliente.repositorios', 'local'],
    });
  });
});

describe('PUT /api/configuracao/sankhya-om-codusu', () => {
  it('grava o CODUSU sem mexer no resto', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao/sankhya-om-codusu',
      payload: { sankhyaOmCodUsu: ' 4817 ' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().sankhyaOmCodUsu, '4817');
    assert.equal(resposta.json().destinoDosLinks, 'hub');
  });

  it('recusa CODUSU com letras', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao/sankhya-om-codusu',
      payload: { sankhyaOmCodUsu: '67a' },
    });

    assert.equal(resposta.statusCode, 400);
  });

  it('o PUT das configurações não apaga o CODUSU gravado', async () => {
    await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao/sankhya-om-codusu',
      payload: { sankhyaOmCodUsu: '4817' },
    });

    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: CONFIGURACAO_SEM_DESTINO_DOS_LINKS,
    });

    assert.equal(resposta.json().sankhyaOmCodUsu, '4817');
  });
});
