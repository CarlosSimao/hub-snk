import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  CaminhoForaDaPastaError,
  ItemJaExisteError,
  NomeInvalidoError,
  criarArquivo,
  criarPasta,
  excluir,
  listarPasta,
  renomear,
  resolverDentro,
} from './exploradorDeArquivos.ts';

const base = mkdtempSync(join(tmpdir(), 'hub-snk-explorador-'));
after(() => rmSync(base, { recursive: true, force: true }));

function novaRaiz(): string {
  const raiz = mkdtempSync(join(base, 'raiz-'));
  mkdirSync(join(raiz, 'docs'));
  writeFileSync(join(raiz, 'docs', 'a.txt'), 'a');
  writeFileSync(join(raiz, 'b.txt'), 'bb');
  return raiz;
}

describe('explorador de arquivos', () => {
  it('lista pastas antes dos arquivos', async () => {
    const { itens, cortada } = await listarPasta(novaRaiz(), '');
    assert.deepEqual(
      itens.map((item) => [item.nome, item.tipo]),
      [
        ['docs', 'pasta'],
        ['b.txt', 'arquivo'],
      ],
    );
    assert.equal(itens[1]?.tamanho, 2);
    assert.equal(cortada, false);
  });

  it('recusa caminho que sai da raiz', async () => {
    const raiz = novaRaiz();
    await assert.rejects(resolverDentro(raiz, '../fora'), CaminhoForaDaPastaError);
    await assert.rejects(resolverDentro(raiz, 'docs/../../fora'), CaminhoForaDaPastaError);
    await assert.rejects(resolverDentro(raiz, '/etc'), CaminhoForaDaPastaError);
    await assert.rejects(listarPasta(raiz, '..'), CaminhoForaDaPastaError);
  });

  it('cria pasta e arquivo sem sobrescrever', async () => {
    const raiz = novaRaiz();
    await criarPasta(raiz, 'docs', 'novas');
    assert.ok(existsSync(join(raiz, 'docs', 'novas')));
    await assert.rejects(criarPasta(raiz, 'docs', 'novas'), ItemJaExisteError);

    await criarArquivo(raiz, '', 'c.txt', Buffer.from('oi'));
    assert.equal(readFileSync(join(raiz, 'c.txt'), 'utf8'), 'oi');
    await assert.rejects(criarArquivo(raiz, '', 'c.txt', Buffer.from('x')), ItemJaExisteError);
    assert.equal(readFileSync(join(raiz, 'c.txt'), 'utf8'), 'oi');
  });

  it('valida nomes', async () => {
    const raiz = novaRaiz();
    for (const nome of ['', '  ', '..', 'a/b', 'a\\b', 'x:y', 'con', 'fim.']) {
      await assert.rejects(criarPasta(raiz, '', nome), NomeInvalidoError, `nome "${nome}"`);
    }
  });

  it('renomeia e não deixa renomear sobre outro item nem a raiz', async () => {
    const raiz = novaRaiz();
    await renomear(raiz, 'b.txt', 'renomeado.txt');
    assert.ok(existsSync(join(raiz, 'renomeado.txt')));
    await assert.rejects(renomear(raiz, 'renomeado.txt', 'docs'), ItemJaExisteError);
    await assert.rejects(renomear(raiz, '', 'outra'), CaminhoForaDaPastaError);
  });

  it('exclui arquivo e pasta, mas nunca a raiz', async () => {
    const raiz = novaRaiz();
    await excluir(raiz, 'docs');
    await excluir(raiz, 'b.txt');
    assert.deepEqual((await listarPasta(raiz, '')).itens, []);
    await assert.rejects(excluir(raiz, ''), CaminhoForaDaPastaError);
    assert.ok(existsSync(raiz));
  });
});
