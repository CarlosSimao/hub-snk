import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CacheComValidade } from './cacheComValidade.ts';

const VALIDADE_MS = 1000;

function criarCache() {
  const relogio = { agora: 0 };
  const cache = new CacheComValidade<string, number>(VALIDADE_MS, () => relogio.agora);
  let buscas = 0;
  const buscar = async () => (buscas += 1);
  return { cache, relogio, buscar, buscas: () => buscas };
}

describe('CacheComValidade', () => {
  it('reusa o valor dentro da validade', async () => {
    const { cache, buscar, buscas } = criarCache();

    await cache.obter('a', buscar);
    await cache.obter('a', buscar);

    assert.equal(buscas(), 1);
  });

  it('busca de novo depois de vencer', async () => {
    const { cache, relogio, buscar, buscas } = criarCache();

    await cache.obter('a', buscar);
    relogio.agora = VALIDADE_MS;
    assert.equal(await cache.obter('a', buscar), 2);
    assert.equal(buscas(), 2);
  });

  it('consultas simultâneas da mesma chave viram uma', async () => {
    const { cache, buscar, buscas } = criarCache();

    await Promise.all([cache.obter('a', buscar), cache.obter('a', buscar)]);

    assert.equal(buscas(), 1);
  });

  it('não guarda falha', async () => {
    const { cache, buscar, buscas } = criarCache();

    await assert.rejects(
      cache.obter('a', async () => {
        throw new Error('fora do ar');
      }),
    );
    assert.equal(await cache.obter('a', buscar), 1);
    assert.equal(buscas(), 1);
  });

  it('descartarTudo força nova busca', async () => {
    const { cache, buscar, buscas } = criarCache();

    await cache.obter('a', buscar);
    cache.descartarTudo();
    await cache.obter('a', buscar);

    assert.equal(buscas(), 2);
  });
});
