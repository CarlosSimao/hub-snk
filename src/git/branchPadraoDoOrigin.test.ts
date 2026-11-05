import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { lerBranchPadraoDoOrigin } from './branchPadraoDoOrigin.ts';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-origin-head-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

function criarRepositorio(nome: string, conteudoDoOriginHead?: string): string {
  const caminho = join(pasta, nome);
  const pastaDoOrigin = join(caminho, '.git', 'refs', 'remotes', 'origin');
  mkdirSync(pastaDoOrigin, { recursive: true });
  if (conteudoDoOriginHead !== undefined) {
    writeFileSync(join(pastaDoOrigin, 'HEAD'), conteudoDoOriginHead);
  }
  return caminho;
}

describe('lerBranchPadraoDoOrigin', () => {
  it('lê a branch do origin/HEAD, inclusive com barra no nome', async () => {
    const principal = criarRepositorio('a', 'ref: refs/remotes/origin/main\n');
    const comBarra = criarRepositorio('b', 'ref: refs/remotes/origin/release/2.x\n');

    assert.equal(await lerBranchPadraoDoOrigin(principal), 'main');
    assert.equal(await lerBranchPadraoDoOrigin(comBarra), 'release/2.x');
  });

  it('devolve null sem o arquivo, com conteúdo inesperado ou sem pasta', async () => {
    assert.equal(await lerBranchPadraoDoOrigin(criarRepositorio('c')), null);
    assert.equal(await lerBranchPadraoDoOrigin(criarRepositorio('d', 'abc123\n')), null);
    assert.equal(await lerBranchPadraoDoOrigin(join(pasta, 'inexistente')), null);
  });
});
