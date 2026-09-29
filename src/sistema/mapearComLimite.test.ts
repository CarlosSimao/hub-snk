import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mapearComLimite } from './mapearComLimite.ts';

describe('mapearComLimite', () => {
  it('devolve os resultados na ordem de entrada', async () => {
    const resultados = await mapearComLimite([30, 10, 20], 2, async (atraso) => {
      await new Promise((resolver) => setTimeout(resolver, atraso));
      return atraso * 2;
    });

    assert.deepEqual(resultados, [60, 20, 40]);
  });

  it('nunca passa do limite de tarefas em andamento', async () => {
    const LIMITE = 3;
    let emAndamento = 0;
    let maximo = 0;

    await mapearComLimite(
      Array.from({ length: 20 }, (_, indice) => indice),
      LIMITE,
      async () => {
        emAndamento += 1;
        maximo = Math.max(maximo, emAndamento);
        await new Promise((resolver) => setTimeout(resolver, 1));
        emAndamento -= 1;
      },
    );

    assert.equal(maximo, LIMITE);
  });
});
