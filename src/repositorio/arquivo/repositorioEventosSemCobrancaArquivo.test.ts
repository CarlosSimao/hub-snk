import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { DecisaoDeCobranca } from '../../tipos.ts';
import {
  NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA,
  RepositorioEventosSemCobrancaArquivo,
} from './repositorioEventosSemCobrancaArquivo.ts';

const NAO_COBRAR: DecisaoDeCobranca = { modo: 'nao-cobrar', gestorConfirmadoId: null };
const COM_GESTOR: DecisaoDeCobranca = { modo: 'com-gestor', gestorConfirmadoId: 'bruno' };

let diretorio: string;
let repositorio: RepositorioEventosSemCobrancaArquivo;

function gravarCorpo(eventos: unknown) {
  return writeFile(
    join(diretorio, NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA),
    JSON.stringify({ versaoDoEsquema: 1, eventos }),
  );
}

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-sem-cobranca-'));
  repositorio = new RepositorioEventosSemCobrancaArquivo(diretorio);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

describe('RepositorioEventosSemCobrancaArquivo', () => {
  it('começa vazio quando o arquivo ainda não existe', async () => {
    assert.deepEqual(await repositorio.listar(), new Map());
  });

  it('grava a decisão no disco e a apaga', async () => {
    await repositorio.definir('123', NAO_COBRAR);
    await repositorio.definir('72965-2026-11-09 08:00:00', COM_GESTOR);

    repositorio.descartarCache();
    assert.deepEqual(
      await repositorio.listar(),
      new Map([
        ['123', NAO_COBRAR],
        ['72965-2026-11-09 08:00:00', COM_GESTOR],
      ]),
    );

    await repositorio.definir('123', null);
    repositorio.descartarCache();
    assert.deepEqual(
      await repositorio.listar(),
      new Map([['72965-2026-11-09 08:00:00', COM_GESTOR]]),
    );
  });

  it('apagar o que não tem decisão não grava nada', async () => {
    await repositorio.definir('999', null);

    await assert.rejects(readFile(join(diretorio, NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA)));
  });

  it('lê a lista da v2.26.0 como "não cobrar"', async () => {
    await gravarCorpo(['123', '456']);

    assert.deepEqual(
      await repositorio.listar(),
      new Map([
        ['123', NAO_COBRAR],
        ['456', NAO_COBRAR],
      ]),
    );
  });

  it('descarta modo desconhecido e "com gestor" sem gestor confirmado', async () => {
    await gravarCorpo({
      a: { modo: 'qualquer' },
      b: { modo: 'com-gestor', gestorConfirmadoId: null },
      c: { modo: 'so-hub', gestorConfirmadoId: 'sobra' },
    });

    assert.deepEqual(
      await repositorio.listar(),
      new Map([['c', { modo: 'so-hub', gestorConfirmadoId: null }]]),
    );
  });

  it('o mapa devolvido é cópia: alterá-lo não decide nada', async () => {
    (await repositorio.listar()).set('123', NAO_COBRAR);

    assert.deepEqual(await repositorio.listar(), new Map());
  });
});
