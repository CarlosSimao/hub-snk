import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { ExecutavelNaoEncontradoError } from '../sistema/processos/abrirExecutavel.ts';
import type { ConfiguracaoGlobal } from '../tipos.ts';
import {
  registrarRotasDeWebConnection,
  type DependenciasDoWebConnection,
} from './rotasWebConnection.ts';

const CAMINHO = 'C:\\Sankhya web\\executar\\iniciar_web_connection.exe';

function criarServidor(dependencias: Partial<DependenciasDoWebConnection>) {
  const gravados: string[] = [];
  const abertos: string[] = [];
  const repositorio = {
    ler: async () => ({ caminhoDoWebConnection: CAMINHO }) as ConfiguracaoGlobal,
    definirCaminhoDoWebConnection: async (caminho: string) => {
      gravados.push(caminho);
      return {} as ConfiguracaoGlobal;
    },
  } as unknown as RepositorioConfiguracao;

  const servidor = Fastify();
  registrarRotasDeWebConnection(servidor, repositorio, {
    consultar: async () => ({ ligado: false }),
    abrirExecutavel: async (caminho) => void abertos.push(caminho),
    selecionarArquivo: async () => null,
    ...dependencias,
  });
  return { servidor, gravados, abertos };
}

describe('POST /api/web-connection/iniciar', () => {
  it('desligado, abre o executável configurado', async () => {
    const { servidor, abertos } = criarServidor({});

    const resposta = await servidor.inject({ method: 'POST', url: '/api/web-connection/iniciar' });

    assert.equal(resposta.statusCode, 204);
    assert.deepEqual(abertos, [CAMINHO]);
  });

  it('já ligado, não abre outra instância', async () => {
    const { servidor, abertos } = criarServidor({
      consultar: async () => ({ ligado: true, versao: '2.0b725', tempoLigado: '0:01:00' }),
    });

    const resposta = await servidor.inject({ method: 'POST', url: '/api/web-connection/iniciar' });

    assert.equal(resposta.statusCode, 204);
    assert.deepEqual(abertos, []);
  });

  it('executável sumiu: pede para localizar', async () => {
    const { servidor } = criarServidor({
      abrirExecutavel: async (caminho) => {
        throw new ExecutavelNaoEncontradoError(caminho);
      },
    });

    const resposta = await servidor.inject({ method: 'POST', url: '/api/web-connection/iniciar' });

    assert.equal(resposta.statusCode, 409);
    assert.equal(resposta.json().caminhoPendente, true);
  });
});

describe('POST /api/web-connection/localizar', () => {
  it('grava o executável escolhido', async () => {
    const { servidor, gravados } = criarServidor({ selecionarArquivo: async () => CAMINHO });

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/web-connection/localizar',
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(gravados, [CAMINHO]);
  });

  it('cancelar não grava nada', async () => {
    const { servidor, gravados } = criarServidor({});

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/web-connection/localizar',
    });

    assert.equal(resposta.statusCode, 204);
    assert.deepEqual(gravados, []);
  });
});
