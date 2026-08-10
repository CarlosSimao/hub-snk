import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { VERSAO_ATUAL_DO_ESQUEMA } from './arquivoDeDados.ts';
import {
  AcessoDeBaseDuplicadoError,
  BaseJaCadastradaError,
  ClienteNaoEncontradoError,
  FavoritoDuplicadoNaImportacaoError,
  NomeDeClienteDuplicadoError,
} from './repositorioClientes.ts';
import { RepositorioClientesArquivo } from './repositorioClientesArquivo.ts';

const BASE_DE_EXEMPLO = {
  url: 'https://erp.alfa.com.br:8180/mge',
  tipo: 'producao' as const,
  usuario: 'admin',
  senha: 'segredo',
};

let diretorio: string;
let repositorio: RepositorioClientesArquivo;

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-clientes-'));
  repositorio = new RepositorioClientesArquivo(diretorio);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

function caminhoDoArquivo(): string {
  return join(diretorio, 'clientes.json');
}

async function lerArquivoGravado(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(caminhoDoArquivo(), 'utf8'));
}

describe('RepositorioClientesArquivo', () => {
  it('começa vazio quando o arquivo ainda não existe', async () => {
    assert.deepEqual(await repositorio.listar(), []);
  });

  it('grava o cliente criado dentro do envelope da versão atual', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });

    const gravado = await lerArquivoGravado();
    assert.equal(gravado['versaoDoEsquema'], VERSAO_ATUAL_DO_ESQUEMA);
    assert.deepEqual(
      (gravado['clientes'] as { id: string }[]).map((c) => c.id),
      [cliente.id],
    );
  });

  it('devolve a lista ordenada por nome', async () => {
    await repositorio.criar({ nome: 'Zeta' });
    await repositorio.criar({ nome: 'alfa' });
    await repositorio.criar({ nome: 'Ômega' });

    const nomes = (await repositorio.listar()).map((cliente) => cliente.nome);

    assert.deepEqual(nomes, ['alfa', 'Ômega', 'Zeta']);
  });

  it('recusa nome repetido, ignorando caixa e espaços nas pontas', async () => {
    await repositorio.criar({ nome: 'Indústria Alfa' });

    await assert.rejects(
      () => repositorio.criar({ nome: '  indústria alfa  ' }),
      NomeDeClienteDuplicadoError,
    );
  });

  it('recusa operação em cliente inexistente', async () => {
    await assert.rejects(
      () => repositorio.remover('4fb3993a-f8b3-4e9a-be7d-c79556fa78e5'),
      ClienteNaoEncontradoError,
    );
  });

  it('aceita a mesma URL de base com usuários diferentes e recusa o par repetido', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });

    await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);
    await repositorio.adicionarBase(cliente.id, { ...BASE_DE_EXEMPLO, usuario: 'consulta' });

    await assert.rejects(
      () => repositorio.adicionarBase(cliente.id, { ...BASE_DE_EXEMPLO, senha: 'outra' }),
      AcessoDeBaseDuplicadoError,
    );
  });

  it('preserva o banco vinculado ao atualizar os dados da base', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    const base = await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);
    await repositorio.definirBancoDeDados(cliente.id, base.id, {
      host: '192.168.0.10',
      porta: 1521,
      nomeDoServico: 'ORCL',
      usuario: 'system',
      senha: 'segredo',
    });

    const atualizada = await repositorio.atualizarBase(cliente.id, base.id, {
      ...BASE_DE_EXEMPLO,
      usuario: 'outro',
    });

    assert.equal(atualizada.bancoDeDados?.nomeDoServico, 'ORCL');
  });

  it('reaproveita o cliente existente na importação, mesmo escrito de outro jeito', async () => {
    await repositorio.criar({ nome: 'Neco Truck' });

    const resultado = await repositorio.importarBases([
      { ...BASE_DE_EXEMPLO, nomeDoCliente: 'necotruck' },
      { ...BASE_DE_EXEMPLO, nomeDoCliente: 'Outra Empresa', url: 'https://outra.com.br/mge' },
    ]);

    assert.equal(resultado.clientesCriados, 1);
    assert.equal(resultado.basesImportadas, 2);
    assert.equal((await repositorio.listar()).length, 2);
  });

  it('aborta a importação inteira quando um item conflita', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);

    await assert.rejects(
      () =>
        repositorio.importarBases([
          { ...BASE_DE_EXEMPLO, nomeDoCliente: 'Empresa Nova', url: 'https://nova.com.br/mge' },
          { ...BASE_DE_EXEMPLO, nomeDoCliente: 'Indústria Alfa' },
        ]),
      BaseJaCadastradaError,
    );

    /* O primeiro item não pode ter sido gravado: o lote é tudo ou nada. */
    const nomes = (await repositorio.listar()).map((c) => c.nome);
    assert.deepEqual(nomes, ['Indústria Alfa']);
  });

  it('recusa lote que repete a mesma base duas vezes', async () => {
    await assert.rejects(
      () =>
        repositorio.importarBases([
          { ...BASE_DE_EXEMPLO, nomeDoCliente: 'Alfa' },
          { ...BASE_DE_EXEMPLO, nomeDoCliente: 'Alfa' },
        ]),
      FavoritoDuplicadoNaImportacaoError,
    );
  });

  it('relê o disco depois de descartar o cache', async () => {
    await repositorio.criar({ nome: 'Indústria Alfa' });

    /* Simula outra máquina gravando na pasta sincronizada. */
    await writeFile(
      caminhoDoArquivo(),
      JSON.stringify({
        versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
        clientes: [{ id: 'externo', nome: 'Veio De Fora' }],
      }),
      'utf8',
    );
    repositorio.descartarCache();

    const nomes = (await repositorio.listar()).map((cliente) => cliente.nome);
    assert.deepEqual(nomes, ['Veio De Fora']);
  });
});

describe('RepositorioClientesArquivo com arquivo no formato antigo', () => {
  const CADASTRO_ANTIGO = [
    {
      id: '4fb3993a-f8b3-4e9a-be7d-c79556fa78e5',
      nome: 'Indústria Alfa',
      repositorios: [{ id: 'r1', url: 'https://github.com/grupo/projeto-antigo.git' }],
      criadoEm: '2026-01-01T00:00:00.000Z',
      atualizadoEm: '2026-01-01T00:00:00.000Z',
    },
  ];

  beforeEach(async () => {
    await writeFile(caminhoDoArquivo(), JSON.stringify(CADASTRO_ANTIGO), 'utf8');
  });

  it('migra na primeira leitura, guardando o arquivo original', async () => {
    const clientes = await repositorio.listar();

    assert.equal(clientes.length, 1);
    assert.equal((await lerArquivoGravado())['versaoDoEsquema'], VERSAO_ATUAL_DO_ESQUEMA);

    const copia = JSON.parse(await readFile(`${caminhoDoArquivo()}.esquema0`, 'utf8'));
    assert.deepEqual(copia, CADASTRO_ANTIGO);
  });

  it('completa os campos que não existiam no formato antigo', async () => {
    const [cliente] = await repositorio.listar();

    assert.equal(cliente?.anotacoes, '');
    assert.deepEqual(cliente?.bases, []);
    assert.deepEqual(cliente?.links, []);
    /* Repositório gravado antes do campo `nome` recebe o fim da URL como rótulo. */
    assert.equal(cliente?.repositorios[0]?.nome, 'projeto-antigo');
  });
});
