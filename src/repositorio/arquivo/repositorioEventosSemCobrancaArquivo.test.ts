import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { RepositorioEventosSemCobrancaArquivo } from './repositorioEventosSemCobrancaArquivo.ts';

let diretorio: string;
let repositorio: RepositorioEventosSemCobrancaArquivo;

beforeEach(async () => {
  diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-sem-cobranca-'));
  repositorio = new RepositorioEventosSemCobrancaArquivo(diretorio);
});

afterEach(async () => {
  await rm(diretorio, { recursive: true, force: true });
});

describe('RepositorioEventosSemCobrancaArquivo', () => {
  it('começa vazio quando o arquivo ainda não existe', async () => {
    assert.deepEqual(await repositorio.listar(), new Set());
  });

  it('marca, grava no disco e desmarca', async () => {
    await repositorio.definir('123', true);
    await repositorio.definir('72965-2026-11-09 08:00:00', true);

    repositorio.descartarCache();
    assert.deepEqual(await repositorio.listar(), new Set(['123', '72965-2026-11-09 08:00:00']));

    await repositorio.definir('123', false);
    repositorio.descartarCache();
    assert.deepEqual(await repositorio.listar(), new Set(['72965-2026-11-09 08:00:00']));
  });

  it('marcar de novo ou desmarcar o que não está marcado não é erro', async () => {
    await repositorio.definir('123', true);
    await repositorio.definir('123', true);
    await repositorio.definir('999', false);

    assert.deepEqual(await repositorio.listar(), new Set(['123']));
  });

  it('a lista devolvida é cópia: alterá-la não marca nada', async () => {
    (await repositorio.listar()).add('123');

    assert.deepEqual(await repositorio.listar(), new Set());
  });
});
