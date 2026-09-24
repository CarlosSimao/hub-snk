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
