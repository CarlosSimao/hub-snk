import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  ContatoNaoEncontradoError,
  GestorInvalidoError,
  type DadosDeContato,
} from '../repositorioContatos.ts';
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

  it('não perde cadastro quando vários chegam ao mesmo tempo', async () => {
    const QUANTIDADE = 5;
    await Promise.all(
      Array.from({ length: QUANTIDADE }, (_, indice) =>
        repositorio.criar({ ...CONTATO, nome: `Contato ${indice}` }),
      ),
    );

    repositorio.descartarCache();
    assert.equal((await repositorio.listar()).length, QUANTIDADE);
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

describe('gestor do contato', () => {
  it('arquivo de antes do gestor chega sem gestor e sem "Gerente"', async () => {
    const {
      gestorId: _gestorId,
      gerente: _gerente,
      ...antigo
    } = {
      ...CONTATO,
      id: 'a',
      criadoEm: '',
      atualizadoEm: '',
      gestorId: null,
      gerente: false,
    };
    await writeFile(join(diretorio, 'contatos.json'), JSON.stringify([antigo]));

    const [contato] = await repositorio.listar();

    assert.equal(contato?.gestorId, null);
    assert.equal(contato?.gerente, false);
  });

  it('cadastra sem gestor e desmarcado quando os campos não vêm', async () => {
    const contato = await repositorio.criar(CONTATO);

    assert.equal(contato.gestorId, null);
    assert.equal(contato.gerente, false);
  });

  it('quem vira gestor fica com "Gerente" marcado; alterar sem os campos mantém', async () => {
    const gestor = await repositorio.criar({ ...CONTATO, nome: 'Paulo' });
    const contato = await repositorio.criar({ ...CONTATO, gestorId: gestor.id });

    const alterado = await repositorio.atualizar(contato.id, { ...CONTATO, nome: 'Ana S.' });

    assert.equal(alterado.gestorId, gestor.id);
    const lidos = await repositorio.listar();
    assert.equal(lidos.find((item) => item.id === gestor.id)?.gerente, true);
  });

  it('o usuário desmarca "Gerente" e continua gestor', async () => {
    const gestor = await repositorio.criar({ ...CONTATO, nome: 'Paulo' });
    await repositorio.criar({ ...CONTATO, gestorId: gestor.id });

    const desmarcado = await repositorio.atualizar(gestor.id, { ...CONTATO, gerente: false });

    assert.equal(desmarcado.gerente, false);
  });

  it('recusa o próprio contato, um subordinado e gestor que não existe', async () => {
    const emne = await repositorio.criar({ ...CONTATO, nome: 'Emne' });
    const paulo = await repositorio.criar({ ...CONTATO, nome: 'Paulo', gestorId: emne.id });
    const everton = await repositorio.criar({ ...CONTATO, nome: 'Everton', gestorId: paulo.id });

    await assert.rejects(
      repositorio.atualizar(emne.id, { ...CONTATO, gestorId: emne.id }),
      GestorInvalidoError,
    );
    await assert.rejects(
      repositorio.atualizar(emne.id, { ...CONTATO, gestorId: everton.id }),
      /subordinado/,
    );
    await assert.rejects(
      repositorio.criar({ ...CONTATO, gestorId: 'nenhum' }),
      /Gestor não encontrado/,
    );
  });

  it('remover o gestor deixa os subordinados sem gestor', async () => {
    const gestor = await repositorio.criar({ ...CONTATO, nome: 'Paulo' });
    const contato = await repositorio.criar({ ...CONTATO, gestorId: gestor.id });

    await repositorio.remover(gestor.id);

    const [restante] = await repositorio.listar();
    assert.equal(restante?.id, contato.id);
    assert.equal(restante?.gestorId, null);
  });
});
