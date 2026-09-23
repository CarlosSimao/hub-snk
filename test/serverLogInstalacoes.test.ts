/**
 * Registro de onde o módulo `serverlog` está instalado.
 *
 * O que não pode quebrar: a leitura ao vivo registra a detecção a cada poucos segundos, e
 * isso NÃO pode empurrar o prazo de remoção nem apagar o que a verificação anotou — senão
 * o aviso de "tire o módulo da base" nunca venceria.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ServerLogInstalacoes, DIAS_PADRAO_REMOCAO } from '../src/sankhya/serverLogInstalacoes.ts';
import { dirTemporario } from './helpers.ts';

const BASE = 'https://amatools-teste.sankhyacloud.com.br';

function dataLocal(deslocamentoDias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

describe('ServerLogInstalacoes', () => {
  test('primeira detecção abre instalação com prazo padrão', () => {
    const dir = dirTemporario();
    const store = new ServerLogInstalacoes(dir.path);
    try {
      const i = store.registrarDeteccao(BASE, { clienteNome: 'AMATOOLS', botaoId: '125' });
      assert.equal(i.ativa, true);
      assert.equal(i.botaoId, '125');
      assert.equal(i.removerAte, dataLocal(DIAS_PADRAO_REMOCAO));
      assert.equal(i.vencida, false);
    } finally {
      store.close();
      dir.remove();
    }
  });

  test('detecções seguintes não empurram o prazo nem apagam o módulo anotado', () => {
    const dir = dirTemporario();
    const store = new ServerLogInstalacoes(dir.path);
    try {
      store.registrarDeteccao(BASE, { modulo: 'br.com.sankhya.dstech.serverlog', botaoId: '125' });
      store.atualizar(BASE, { removerAte: dataLocal(2), demanda: 'OS 4711' });

      // O que a leitura ao vivo faz a cada volta: conhece o botão, não o módulo.
      store.registrarDeteccao(BASE, { botaoId: '125' });
      const i = store.obter(BASE)!;

      assert.equal(i.removerAte, dataLocal(2));
      assert.equal(i.demanda, 'OS 4711');
      assert.equal(i.modulo, 'br.com.sankhya.dstech.serverlog');
    } finally {
      store.close();
      dir.remove();
    }
  });

  test('prazo de hoje ou passado entra nas pendências', () => {
    const dir = dirTemporario();
    const store = new ServerLogInstalacoes(dir.path);
    try {
      store.registrarDeteccao(BASE, { botaoId: '125' });
      store.atualizar(BASE, { removerAte: dataLocal(0) });
      assert.deepEqual(store.pendencias().map((p) => p.origin), [BASE]);

      store.atualizar(BASE, { removerAte: dataLocal(1) });
      assert.equal(store.pendencias().length, 0);
    } finally {
      store.close();
      dir.remove();
    }
  });

  test('removida sai das pendências, e detectar de novo reabre com prazo novo', () => {
    const dir = dirTemporario();
    const store = new ServerLogInstalacoes(dir.path);
    try {
      store.registrarDeteccao(BASE, { botaoId: '125' });
      store.atualizar(BASE, { removerAte: dataLocal(-3), demanda: 'antiga' });
      store.marcarRemovido(BASE);

      assert.equal(store.obter(BASE)!.ativa, false);
      assert.equal(store.pendencias().length, 0);

      // Reinstalado para outra demanda: não pode herdar o prazo vencido da anterior.
      const nova = store.registrarDeteccao(BASE, { botaoId: '130' });
      assert.equal(nova.ativa, true);
      assert.equal(nova.removidoEm, '');
      assert.equal(nova.demanda, '');
      assert.equal(nova.removerAte, dataLocal(DIAS_PADRAO_REMOCAO));
      assert.equal(nova.botaoId, '130');
    } finally {
      store.close();
      dir.remove();
    }
  });

  test('fim da demanda do cliente vira o prazo; se já passou, cai no padrão', () => {
    const dir = dirTemporario();
    const store = new ServerLogInstalacoes(dir.path);
    try {
      const comFim = store.registrarDeteccao(BASE, { botaoId: '125', removerAtePadrao: dataLocal(15) });
      assert.equal(comFim.removerAte, dataLocal(15));

      const outra = 'https://luxcar-teste.sankhyacloud.com.br';
      const fimVelho = store.registrarDeteccao(outra, { botaoId: '9', removerAtePadrao: dataLocal(-20) });
      assert.equal(fimVelho.removerAte, dataLocal(DIAS_PADRAO_REMOCAO));
      assert.equal(fimVelho.vencida, false);
    } finally {
      store.close();
      dir.remove();
    }
  });
});
