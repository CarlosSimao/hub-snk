import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  conferirPacote,
  extrairPacote,
  impressaoDosDados,
  montarPacote,
  NOME_DO_MANIFESTO,
  PacoteInvalidoError,
} from './pacoteDeDados.ts';
import { criarZip, lerZip } from './zip.ts';

const AGORA = new Date('2026-10-07T17:30:00.000Z');

let dados: string;

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), 'hub-snk-pacote-'));
});

afterEach(async () => {
  await rm(dados, { recursive: true, force: true });
});

function montar() {
  return montarPacote({ diretorioDeDados: dados, versaoDoAplicativo: '2.7.0', agora: AGORA });
}

async function gravar(relativo: string, conteudo: string): Promise<void> {
  const caminho = join(dados, relativo);
  await mkdir(join(caminho, '..'), { recursive: true });
  await writeFile(caminho, conteudo);
}

function manifestoCom(campos: Record<string, unknown>): Buffer {
  return criarZip([
    {
      nome: NOME_DO_MANIFESTO,
      dados: Buffer.from(JSON.stringify({ geradoPor: 'hub-snk', versaoDoEsquema: 1, ...campos })),
      modificadoEm: AGORA,
    },
  ]);
}

describe('montarPacote', () => {
  it('leva os arquivos de dados e as subpastas, com o manifesto', async () => {
    await gravar('clientes.json', '{"versaoDoEsquema":1,"clientes":[]}');
    await gravar('kanbans/abc/1-escopo.pdf', 'pdf');

    const pacote = await montar();

    assert.deepEqual(
      lerZip(pacote)
        .map((entrada) => entrada.nome)
        .sort(),
      ['clientes.json', NOME_DO_MANIFESTO, 'kanbans/abc/1-escopo.pdf'],
    );
    assert.deepEqual(conferirPacote(pacote), {
      geradoPor: 'hub-snk',
      geradoEm: AGORA.toISOString(),
      versaoDoAplicativo: '2.7.0',
      versaoDoEsquema: 1,
      arquivos: 2,
    });
  });

  it('deixa de fora gravação pela metade, auxiliares do SQLite e as pastas que não são do cadastro', async () => {
    await gravar('clientes.json', '{}');
    await gravar('clientes.json.tmp', 'pela metade');
    await gravar('sankhya.db-wal', 'wal');
    await gravar('sankhya.db-shm', 'shm');
    await gravar('log/backend.log', 'log');
    await gravar('backup/estado.json', '{}');
    await gravar('suporte/id.txt', 'id');

    const nomes = lerZip(await montar()).map((entrada) => entrada.nome);

    assert.deepEqual(nomes.sort(), ['clientes.json', NOME_DO_MANIFESTO]);
  });

  it('leva do banco o que ainda está no -wal, com a conexão aberta', async () => {
    const banco = new DatabaseSync(join(dados, 'sankhya.db'));
    banco.exec('PRAGMA journal_mode = WAL; CREATE TABLE t (valor TEXT);');
    banco.exec("INSERT INTO t VALUES ('gravado e ainda no wal')");

    try {
      const retrato = lerZip(await montar()).find((entrada) => entrada.nome === 'sankhya.db');
      const copia = join(dados, 'copia-para-conferir.sqlite');
      await writeFile(copia, retrato?.extrair() ?? Buffer.alloc(0));

      const lido = new DatabaseSync(copia);
      try {
        const linhas = lido.prepare('SELECT valor FROM t').all();
        assert.deepEqual(
          linhas.map((linha) => linha.valor),
          ['gravado e ainda no wal'],
        );
      } finally {
        lido.close();
      }
    } finally {
      banco.close();
    }
  });
});

describe('impressaoDosDados', () => {
  it('é a mesma enquanto nada muda, e muda com o conteúdo, com arquivo novo e com o -wal', async () => {
    await gravar('clientes.json', '{}');
    await gravar('sankhya.db', 'banco');
    const inicial = await impressaoDosDados(dados);
    assert.equal(await impressaoDosDados(dados), inicial);

    await gravar('clientes.json', '{"mudou":true}');
    const comConteudoNovo = await impressaoDosDados(dados);
    assert.notEqual(comConteudoNovo, inicial);

    await gravar('contatos.json', '{}');
    const comArquivoNovo = await impressaoDosDados(dados);
    assert.notEqual(comArquivoNovo, comConteudoNovo);

    await gravar('sankhya.db-wal', 'gravação recente');
    assert.notEqual(await impressaoDosDados(dados), comArquivoNovo);
  });

  it('percebe a regravação do mesmo tamanho, pela data', async () => {
    await gravar('clientes.json', '{"a":1}');
    await utimes(join(dados, 'clientes.json'), new Date(1_000_000), new Date(1_000_000));
    const antes = await impressaoDosDados(dados);

    await gravar('clientes.json', '{"a":2}');

    assert.notEqual(await impressaoDosDados(dados), antes);
  });

  it('ignora o que fica fora do pacote', async () => {
    await gravar('clientes.json', '{}');
    const antes = await impressaoDosDados(dados);

    await gravar('log/backend.log', 'linha nova');
    await gravar('clientes.json.tmp', 'pela metade');

    assert.equal(await impressaoDosDados(dados), antes);
  });

  it('funciona sem a pasta de dados, que só nasce na primeira gravação', async () => {
    assert.equal(typeof (await impressaoDosDados(join(dados, 'nao-existe'))), 'string');
  });
});

describe('conferirPacote', () => {
  it('recusa zip sem manifesto, manifesto de outro programa e o que não é zip', () => {
    const semManifesto = criarZip([
      { nome: 'clientes.json', dados: Buffer.from('{}'), modificadoEm: AGORA },
    ]);

    assert.throws(() => conferirPacote(semManifesto), PacoteInvalidoError);
    assert.throws(() => conferirPacote(manifestoCom({ geradoPor: 'outro' })), PacoteInvalidoError);
    assert.throws(() => conferirPacote(Buffer.from('lixo')), PacoteInvalidoError);
  });

  it('recusa backup feito por uma versão de esquema mais novo', () => {
    assert.throws(
      () => conferirPacote(manifestoCom({ versaoDoEsquema: 99, versaoDoAplicativo: '9.0.0' })),
      /versão 9\.0\.0.*Atualize o HUB SNK/,
    );
  });
});

describe('extrairPacote', () => {
  it('volta a pasta ao estado do backup: restaura, e tira o que foi criado depois', async () => {
    await gravar('clientes.json', 'do backup');
    await gravar('kanbans/abc/escopo.pdf', 'pdf do backup');
    const pacote = await montar();

    await gravar('clientes.json', 'alterado depois');
    await gravar('contatos.json', 'criado depois');
    await rm(join(dados, 'kanbans'), { recursive: true });

    await extrairPacote(pacote, dados);

    assert.equal(await readFile(join(dados, 'clientes.json'), 'utf8'), 'do backup');
    assert.equal(await readFile(join(dados, 'kanbans/abc/escopo.pdf'), 'utf8'), 'pdf do backup');
    assert.equal(existsSync(join(dados, 'contatos.json')), false);
    assert.equal(existsSync(join(dados, NOME_DO_MANIFESTO)), false);
  });

  it('tira o -wal e o -shm antigos do banco restaurado', async () => {
    await gravar('sankhya.db', 'banco');
    const pacote = await montar();
    await gravar('sankhya.db-wal', 'wal antigo');
    await gravar('sankhya.db-shm', 'shm antigo');

    await extrairPacote(pacote, dados);

    assert.equal(existsSync(join(dados, 'sankhya.db-wal')), false);
    assert.equal(existsSync(join(dados, 'sankhya.db-shm')), false);
  });

  it('não mexe nas pastas que não são do cadastro', async () => {
    await gravar('clientes.json', '{}');
    const pacote = await montar();
    await gravar('log/backend.log', 'log');

    await extrairPacote(pacote, dados);

    assert.equal(await readFile(join(dados, 'log/backend.log'), 'utf8'), 'log');
  });

  for (const nome of ['../fora.json', '/fora.json', 'C:/fora.json', 'pasta/../../fora.json']) {
    it(`recusa a entrada "${nome}", que sairia da pasta de dados, sem apagar nada`, async () => {
      await gravar('clientes.json', 'intacto');
      const malicioso = criarZip([
        { nome, dados: Buffer.from('x'), modificadoEm: AGORA },
        {
          nome: NOME_DO_MANIFESTO,
          dados: Buffer.from(JSON.stringify({ geradoPor: 'hub-snk', versaoDoEsquema: 1 })),
          modificadoEm: AGORA,
        },
      ]);

      await assert.rejects(extrairPacote(malicioso, dados), /sai da pasta de dados/);
      assert.equal(await readFile(join(dados, 'clientes.json'), 'utf8'), 'intacto');
    });
  }
});
