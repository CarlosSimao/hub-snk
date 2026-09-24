import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { RepositorioClientesArquivo } from '../repositorio/repositorioClientesArquivo.ts';
import { RepositorioConfiguracaoArquivo } from '../repositorio/repositorioConfiguracaoArquivo.ts';
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
