import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepositorioConfiguracaoArquivo } from '../repositorio/repositorioConfiguracaoArquivo.ts';
import { registrarRotasDeConfiguracao } from './rotasConfiguracao.ts';

const CONFIGURACAO_SEM_ABERTURA_DE_LINKS = {
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

describe('PUT /api/configuracao — abertura de links', () => {
  it('aplica o padrão quando a tela não manda a escolha', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: CONFIGURACAO_SEM_ABERTURA_DE_LINKS,
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json().aberturaDeLinks, {
      bases: 'hub',
      linksGerais: 'navegador-padrao',
      linksDeProjeto: 'navegador-padrao',
    });
  });

  it('completa com o padrão o tipo de link que faltou', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: { ...CONFIGURACAO_SEM_ABERTURA_DE_LINKS, aberturaDeLinks: { linksGerais: 'hub' } },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json().aberturaDeLinks, {
      bases: 'hub',
      linksGerais: 'hub',
      linksDeProjeto: 'navegador-padrao',
    });
  });

  it('recusa um destino desconhecido', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/configuracao',
      payload: {
        ...CONFIGURACAO_SEM_ABERTURA_DE_LINKS,
        aberturaDeLinks: { bases: 'firefox' },
      },
    });

    assert.equal(resposta.statusCode, 400);
  });
});
