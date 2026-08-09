import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  ArquivoDeDadosInvalidoError,
  EsquemaMaisNovoError,
  gravarArquivoDeDados,
  guardarCopiaAntesDeMigrar,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
  VERSAO_ATUAL_DO_ESQUEMA,
  VERSAO_DE_ARQUIVO_SEM_ENVELOPE,
} from './arquivoDeDados.ts';

const CHAVE = 'clientes';

let diretorio: string;
let contador = 0;

before(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-teste-'));
});

after(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

async function arquivoCom(conteudo: string): Promise<string> {
  contador += 1;
  const caminho = join(diretorio, `dados-${contador}.json`);
  await writeFile(caminho, conteudo, 'utf8');
  return caminho;
}

async function lerJson(caminho: string): Promise<unknown> {
  return JSON.parse(await readFile(caminho, 'utf8'));
}

describe('lerArquivoDeDados', () => {
  it('devolve nulo quando o arquivo ainda não existe', async () => {
    assert.equal(await lerArquivoDeDados(join(diretorio, 'inexistente.json'), CHAVE), null);
  });

  it('lê o corpo de dentro do envelope', async () => {
    const caminho = await arquivoCom('{"versaoDoEsquema":1,"clientes":[{"nome":"Alfa"}]}');

    const conteudo = await lerArquivoDeDados(caminho, CHAVE);

    assert.deepEqual(conteudo?.corpo, [{ nome: 'Alfa' }]);
    assert.equal(conteudo?.versaoDeOrigem, VERSAO_ATUAL_DO_ESQUEMA);
    assert.equal(precisaMigrar(conteudo!), false);
  });

  it('trata arquivo sem envelope como versão zero, a migrar', async () => {
    const caminho = await arquivoCom('[{"nome":"Alfa"}]');

    const conteudo = await lerArquivoDeDados(caminho, CHAVE);

    assert.deepEqual(conteudo?.corpo, [{ nome: 'Alfa' }]);
    assert.equal(conteudo?.versaoDeOrigem, VERSAO_DE_ARQUIVO_SEM_ENVELOPE);
    assert.equal(precisaMigrar(conteudo!), true);
  });

  it('recusa arquivo gravado por uma versão mais nova do HUB SNK', async () => {
    const caminho = await arquivoCom('{"versaoDoEsquema":99,"clientes":[]}');

    await assert.rejects(() => lerArquivoDeDados(caminho, CHAVE), EsquemaMaisNovoError);
  });

  it('recusa envelope com versão que não é inteiro positivo', async () => {
    const caminho = await arquivoCom('{"versaoDoEsquema":"1","clientes":[]}');

    await assert.rejects(() => lerArquivoDeDados(caminho, CHAVE), ArquivoDeDadosInvalidoError);
  });

  it('recusa envelope sem a chave do corpo', async () => {
    const caminho = await arquivoCom('{"versaoDoEsquema":1}');

    await assert.rejects(() => lerArquivoDeDados(caminho, CHAVE), ArquivoDeDadosInvalidoError);
  });

  it('recusa arquivo que não é JSON', async () => {
    const caminho = await arquivoCom('{ isto não é json');

    await assert.rejects(() => lerArquivoDeDados(caminho, CHAVE), ArquivoDeDadosInvalidoError);
  });
});

describe('gravarArquivoDeDados', () => {
  it('grava o corpo dentro do envelope da versão atual', async () => {
    const caminho = join(diretorio, 'gravado.json');

    await gravarArquivoDeDados(caminho, CHAVE, [{ nome: 'Alfa' }]);

    assert.deepEqual(await lerJson(caminho), {
      versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
      clientes: [{ nome: 'Alfa' }],
    });
  });

  it('cria a pasta de dados quando ela ainda não existe', async () => {
    const caminho = join(diretorio, 'pasta-nova', 'dados.json');

    await gravarArquivoDeDados(caminho, CHAVE, []);

    assert.deepEqual(await lerJson(caminho), { versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA, clientes: [] });
  });
});

describe('migrarArquivoDeDados', () => {
  it('guarda o arquivo original antes de reescrevê-lo', async () => {
    const caminho = await arquivoCom('[{"nome":"Alfa"}]');

    await migrarArquivoDeDados({
      caminhoDoArquivo: caminho,
      chaveDoCorpo: CHAVE,
      corpo: [{ nome: 'Alfa', anotacoes: '' }],
      versaoDeOrigem: VERSAO_DE_ARQUIVO_SEM_ENVELOPE,
    });

    assert.deepEqual(await lerJson(`${caminho}.esquema0`), [{ nome: 'Alfa' }]);
    assert.deepEqual(await lerJson(caminho), {
      versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
      clientes: [{ nome: 'Alfa', anotacoes: '' }],
    });
  });

  it('preserva a cópia mais antiga quando a migração se repete', async () => {
    const caminho = await arquivoCom('["original"]');
    await guardarCopiaAntesDeMigrar(caminho, VERSAO_DE_ARQUIVO_SEM_ENVELOPE);

    await writeFile(caminho, '["restaurado por engano"]', 'utf8');
    await guardarCopiaAntesDeMigrar(caminho, VERSAO_DE_ARQUIVO_SEM_ENVELOPE);

    assert.deepEqual(await lerJson(`${caminho}.esquema0`), ['original']);
  });
});
