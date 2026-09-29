import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ContatoNaoEncontradoError, type DadosDeContato } from './repositorioContatos.ts';
import { RepositorioContatosArquivo } from './repositorioContatosArquivo.ts';

let diretorio: string;
let repositorio: RepositorioContatosArquivo;

const CONTATO: DadosDeContato = {
  nome: '  Ana Souza  ',
  telefone: ' (11) 99999-0000 ',
  email: ' ana@cliente.com.br ',
  cargo: ' Coordenadora ',
  clienteId: 'cliente-1',
};

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-contatos-'));
  repositorio = new RepositorioContatosArquivo(diretorio);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

describe('RepositorioContatosArquivo', () => {
  it('começa vazio quando o arquivo ainda não existe', async () => {
    assert.deepEqual(await repositorio.listar(), []);
  });

  it('cadastra com os campos aparados e grava no disco', async () => {
    const contato = await repositorio.criar(CONTATO);

    assert.equal(contato.nome, 'Ana Souza');
    assert.equal(contato.email, 'ana@cliente.com.br');
    assert.equal(contato.cargo, 'Coordenadora');

    repositorio.descartarCache();
    assert.deepEqual(await repositorio.listar(), [contato]);
  });

  it('atualiza preservando o id e a data de criação', async () => {
    const criado = await repositorio.criar(CONTATO);

    const alterado = await repositorio.atualizar(criado.id, { ...CONTATO, nome: 'Ana S.' });

    assert.equal(alterado.id, criado.id);
    assert.equal(alterado.criadoEm, criado.criadoEm);
    assert.equal(alterado.nome, 'Ana S.');
  });

  it('recusa atualizar ou remover contato que não existe', async () => {
    await assert.rejects(repositorio.atualizar('nenhum', CONTATO), ContatoNaoEncontradoError);
    await assert.rejects(repositorio.remover('nenhum'), ContatoNaoEncontradoError);
  });

  it('remove o contato', async () => {
    const contato = await repositorio.criar(CONTATO);

    await repositorio.remover(contato.id);

    assert.deepEqual(await repositorio.listar(), []);
  });

  it('desvincula do cliente excluído sem apagar os contatos', async () => {
    const doCliente = await repositorio.criar(CONTATO);
    const deOutro = await repositorio.criar({ ...CONTATO, clienteId: 'cliente-2' });

    await repositorio.desvincularDoCliente('cliente-1');

    const contatos = await repositorio.listar();
    assert.equal(contatos.find((contato) => contato.id === doCliente.id)?.clienteId, null);
    assert.equal(contatos.find((contato) => contato.id === deOutro.id)?.clienteId, 'cliente-2');
  });
});
