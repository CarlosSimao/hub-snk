import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { ArquivoDeEstadoDoAlertaDaAgenda } from './estadoDoAlertaDaAgenda.ts';

let pasta: string;

beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'hub-snk-estado-alerta-'));
});

afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

describe('ArquivoDeEstadoDoAlertaDaAgenda', () => {
  it('começa vazio e devolve o que gravou numa nova abertura', async () => {
    assert.deepEqual(await new ArquivoDeEstadoDoAlertaDaAgenda(pasta).ler(), {
      ultimaVerificacaoEm: '',
      emailsAoGestor: [],
    });

    const estado = {
      ultimaVerificacaoEm: '2026-11-09T12:00:00.000Z',
      emailsAoGestor: ['1#2026-11-09'],
    };
    await new ArquivoDeEstadoDoAlertaDaAgenda(pasta).gravar(estado);

    assert.deepEqual(await new ArquivoDeEstadoDoAlertaDaAgenda(pasta).ler(), estado);
  });

  it('arquivo ilegível começa do zero', async () => {
    await writeFile(join(pasta, 'estado.json'), '{ quebrado', 'utf8');

    assert.equal((await new ArquivoDeEstadoDoAlertaDaAgenda(pasta).ler()).ultimaVerificacaoEm, '');
  });
});
