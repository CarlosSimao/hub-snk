/**
 * Navegacao de pastas nativa (Fase 3 da migracao "sem Docker"), no lugar da rota
 * `/pastas` do `hub-helper.ps1`.
 *
 * Dois detalhes do helper que parecem acidente e nao sao — e que este teste existe para
 * travar: pasta OCULTA aparece (senao um repositorio dentro de uma delas some da tela) e
 * o `pai` e' vazio no topo de uma unidade (e' dali que o "voltar" leva de volta a' lista
 * de unidades).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, parse } from 'node:path';
import { Pastas, PastaInacessivelError } from '../src/pastas.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';
import { dirTemporario } from './helpers.ts';

const helperInutil = {
  requisitar: () => Promise.reject(new Error('o teste nativo nao deveria chamar o helper')),
} as unknown as HubHelper;

describe('Pastas — listagem nativa', () => {
  test('lista subpastas e marca as que sao repositorio git', async (t) => {
    if (process.platform !== 'win32') return t.skip('listagem nativa e do Windows');

    const dir = dirTemporario();
    try {
      mkdirSync(join(dir.path, 'projeto-com-git', '.git'), { recursive: true });
      mkdirSync(join(dir.path, 'pasta-comum'), { recursive: true });
      writeFileSync(join(dir.path, 'arquivo.txt'), 'nao e pasta', 'utf8');

      const listagem = await new Pastas(helperInutil).listar(dir.path);
      const nomes = listagem.pastas.map((p) => p.nome).sort();

      assert.deepEqual(nomes, ['pasta-comum', 'projeto-com-git']);
      assert.equal(listagem.pastas.find((p) => p.nome === 'projeto-com-git')?.git, true);
      assert.equal(listagem.pastas.find((p) => p.nome === 'pasta-comum')?.git, false);
      // Arquivo solto não entra na navegação de pastas.
      assert.equal(listagem.pastas.some((p) => p.nome === 'arquivo.txt'), false);
    } finally {
      dir.remove();
    }
  });

  test('pasta oculta aparece — senao o repositorio dentro dela sumiria', async (t) => {
    if (process.platform !== 'win32') return t.skip('listagem nativa e do Windows');

    const dir = dirTemporario();
    try {
      mkdirSync(join(dir.path, '.oculta'), { recursive: true });

      const listagem = await new Pastas(helperInutil).listar(dir.path);

      assert.equal(listagem.pastas.some((p) => p.nome === '.oculta'), true);
    } finally {
      dir.remove();
    }
  });

  test('sem caminho, devolve as unidades do disco', async (t) => {
    if (process.platform !== 'win32') return t.skip('unidades sao do Windows');

    const listagem = await new Pastas(helperInutil).listar('');

    assert.equal(listagem.atual, '');
    assert.equal(listagem.pai, '');
    assert.ok(listagem.pastas.length > 0, 'ao menos uma unidade');
    assert.ok(
      listagem.pastas.some((u) => /^C:$/i.test(u.nome)),
      'a unidade C: deveria aparecer',
    );
  });

  test('o pai e vazio no topo da unidade, para o voltar cair nas unidades', async (t) => {
    if (process.platform !== 'win32') return t.skip('unidades sao do Windows');

    const raiz = parse(process.cwd()).root;
    const listagem = await new Pastas(helperInutil).listar(raiz);

    assert.equal(listagem.pai, '');
  });

  test('pasta comum tem pai preenchido', async (t) => {
    if (process.platform !== 'win32') return t.skip('listagem nativa e do Windows');

    const dir = dirTemporario();
    try {
      const filha = join(dir.path, 'filha');
      mkdirSync(filha, { recursive: true });

      const listagem = await new Pastas(helperInutil).listar(filha);

      assert.equal(listagem.pai, dir.path);
      assert.equal(listagem.atual, filha);
    } finally {
      dir.remove();
    }
  });

  test('caminho inexistente vira erro proprio, nao "helper indisponivel"', async (t) => {
    if (process.platform !== 'win32') return t.skip('listagem nativa e do Windows');

    await assert.rejects(
      () => new Pastas(helperInutil).listar('C:\\isto\\nao\\existe\\mesmo'),
      PastaInacessivelError,
    );
  });

  test('arquivo no lugar de pasta tambem e recusado', async (t) => {
    if (process.platform !== 'win32') return t.skip('listagem nativa e do Windows');

    const dir = dirTemporario();
    try {
      const arquivo = join(dir.path, 'arquivo.txt');
      writeFileSync(arquivo, 'conteudo', 'utf8');

      await assert.rejects(() => new Pastas(helperInutil).listar(arquivo), PastaInacessivelError);
    } finally {
      dir.remove();
    }
  });
});
