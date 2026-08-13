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

describe('RepositorioClientesArquivo.importarCadastros', () => {
  const BANCO_DE_EXEMPLO = {
    host: '192.168.0.10',
    porta: 1521,
    nomeDoServico: 'ORCL',
    usuario: 'system',
    senha: 'segredo',
  };

  async function primeiraBaseDe(nome: string) {
    const clientes = await repositorio.listar();
    return clientes.find((cliente) => cliente.nome === nome)?.bases[0];
  }

  it('cria o cliente e a base que ainda não existem', async () => {
    const resultado = await repositorio.importarCadastros([
      { nome: 'Indústria Alfa', bases: [{ ...BASE_DE_EXEMPLO, substituir: false }] },
    ]);

    assert.deepEqual(resultado, {
      clientesCriados: 1,
      basesCriadas: 1,
      basesSubstituidas: 0,
      basesIgnoradas: 0,
    });
    assert.equal((await primeiraBaseDe('Indústria Alfa'))?.usuario, 'admin');
  });

  it('cria o cliente sem base nenhuma', async () => {
    const resultado = await repositorio.importarCadastros([{ nome: 'Gama SA', bases: [] }]);

    assert.equal(resultado.clientesCriados, 1);
    assert.deepEqual(
      (await repositorio.listar()).map((cliente) => cliente.nome),
      ['Gama SA'],
    );
  });

  it('reaproveita o cliente existente escrito de outro jeito', async () => {
    await repositorio.criar({ nome: 'Neco Truck' });

    const resultado = await repositorio.importarCadastros([
      { nome: 'necotruck', bases: [{ ...BASE_DE_EXEMPLO, substituir: false }] },
    ]);

    assert.equal(resultado.clientesCriados, 0);
    assert.equal((await repositorio.listar()).length, 1);
    assert.equal((await primeiraBaseDe('Neco Truck'))?.url, BASE_DE_EXEMPLO.url);
  });

  it('ignora a base de URL já cadastrada quando não é para substituir', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);

    const resultado = await repositorio.importarCadastros([
      {
        nome: 'Indústria Alfa',
        bases: [{ ...BASE_DE_EXEMPLO, usuario: 'invasor', substituir: false }],
      },
    ]);

    assert.deepEqual(resultado, {
      clientesCriados: 0,
      basesCriadas: 0,
      basesSubstituidas: 0,
      basesIgnoradas: 1,
    });
    assert.equal((await primeiraBaseDe('Indústria Alfa'))?.usuario, 'admin');
  });

  it('não mexe no `atualizadoEm` do cliente cujas bases foram todas ignoradas', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);
    const antes = (await repositorio.buscarPorId(cliente.id))?.atualizadoEm;

    await repositorio.importarCadastros([
      { nome: 'Indústria Alfa', bases: [{ ...BASE_DE_EXEMPLO, substituir: false }] },
    ]);

    assert.equal((await repositorio.buscarPorId(cliente.id))?.atualizadoEm, antes);
  });

  it('substitui a base de URL já cadastrada quando é para substituir', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    const base = await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);

    const resultado = await repositorio.importarCadastros([
      {
        nome: 'Indústria Alfa',
        bases: [{ ...BASE_DE_EXEMPLO, tipo: 'teste', usuario: 'novo', substituir: true }],
      },
    ]);

    assert.equal(resultado.basesSubstituidas, 1);
    const substituida = await primeiraBaseDe('Indústria Alfa');
    /* O id sobrevive: é substituição da mesma base, não base nova. */
    assert.equal(substituida?.id, base.id);
    assert.equal(substituida?.tipo, 'teste');
    assert.equal(substituida?.usuario, 'novo');
  });

  it('grava o banco de dados que veio no arquivo', async () => {
    await repositorio.importarCadastros([
      {
        nome: 'Indústria Alfa',
        bases: [{ ...BASE_DE_EXEMPLO, bancoDeDados: BANCO_DE_EXEMPLO, substituir: false }],
      },
    ]);

    assert.deepEqual((await primeiraBaseDe('Indústria Alfa'))?.bancoDeDados, BANCO_DE_EXEMPLO);
  });

  it('preserva o banco já vinculado quando o arquivo não trouxe banco', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    const base = await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);
    await repositorio.definirBancoDeDados(cliente.id, base.id, BANCO_DE_EXEMPLO);

    await repositorio.importarCadastros([
      { nome: 'Indústria Alfa', bases: [{ ...BASE_DE_EXEMPLO, tipo: 'teste', substituir: true }] },
    ]);

    assert.deepEqual((await primeiraBaseDe('Indústria Alfa'))?.bancoDeDados, BANCO_DE_EXEMPLO);
  });

  it('preserva a credencial gravada quando o arquivo veio sem usuário e sem senha', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);

    await repositorio.importarCadastros([
      {
        nome: 'Indústria Alfa',
        bases: [{ ...BASE_DE_EXEMPLO, tipo: 'teste', usuario: '', senha: '', substituir: true }],
      },
    ]);

    const substituida = await primeiraBaseDe('Indústria Alfa');
    assert.equal(substituida?.tipo, 'teste');
    assert.equal(substituida?.usuario, 'admin');
    assert.equal(substituida?.senha, 'segredo');
  });

  it('sobrescreve a credencial quando o arquivo trouxe usuário', async () => {
    const cliente = await repositorio.criar({ nome: 'Indústria Alfa' });
    await repositorio.adicionarBase(cliente.id, BASE_DE_EXEMPLO);

    await repositorio.importarCadastros([
      {
        nome: 'Indústria Alfa',
        bases: [{ ...BASE_DE_EXEMPLO, usuario: 'consulta', senha: '', substituir: true }],
      },
    ]);

    const substituida = await primeiraBaseDe('Indústria Alfa');
    assert.equal(substituida?.usuario, 'consulta');
    assert.equal(substituida?.senha, '');
  });

  it('importa várias bases do mesmo cliente numa passada', async () => {
    const resultado = await repositorio.importarCadastros([
      {
        nome: 'Indústria Alfa',
        bases: [
          { ...BASE_DE_EXEMPLO, substituir: false },
          {
            ...BASE_DE_EXEMPLO,
            url: 'https://erp.alfa.com.br:8280/mge',
            tipo: 'teste',
            substituir: false,
          },
        ],
      },
    ]);

    assert.equal(resultado.basesCriadas, 2);
    const clientes = await repositorio.listar();
    assert.equal(clientes[0]?.bases.length, 2);
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
