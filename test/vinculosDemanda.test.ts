import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VinculosDemanda } from '../src/sankhya/vinculosDemanda.ts';

function comBanco(corpo: (v: VinculosDemanda) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'vinc-'));
  const v = new VinculosDemanda(dir);
  try {
    corpo(v);
  } finally {
    v.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

const tarefa = (pedido: string, observacoes: string) => ({ pedido, observacoes });
const os = (id: number, pedido: string, descricao = '') => ({ id, pedido, descricao });

test('aprende o pedido pelas tarefas e guarda depois que a tarefa some (dado real 2026-09)', () => {
  comBanco((v) => {
    v.aprender(10269, [tarefa('5585742', 'TECH | ID 2996 - AMATOOLS COMERCIAL E IMPORTADORA LTDA')]);
    v.aprender(10269, []); // tarefa fechou: a Experience não lista mais
    const r = v.resolver(10269, [os(1, '5585742'), os(2, '5585746')], ['2996', '3100']);
    assert.deepEqual(r.get(1), { demanda: '2996', origem: 'tarefa' });
    assert.deepEqual(r.get(2), { demanda: '', origem: '' }, 'pedido desconhecido com várias demandas fica sem');
  });
});

test('manual vence o aprendido; exceção por OS vence o pedido; null volta ao automático', () => {
  comBanco((v) => {
    v.aprender(10269, [tarefa('5585742', 'ID 2996')]);
    v.definirPedido(10269, '5585742', '3100');
    v.aprender(10269, [tarefa('5585742', 'ID 2996')]);
    assert.deepEqual(v.resolver(10269, [os(1, '5585742')], []).get(1), { demanda: '3100', origem: 'pedido' });

    v.definirOs(1, '4000');
    assert.deepEqual(v.resolver(10269, [os(1, '5585742')], []).get(1), { demanda: '4000', origem: 'os' });

    v.definirOs(1, null);
    v.definirPedido(10269, '5585742', null);
    v.aprender(10269, [tarefa('5585742', 'ID 2996')]);
    assert.deepEqual(v.resolver(10269, [os(1, '5585742')], []).get(1), { demanda: '2996', origem: 'tarefa' });
  });
});

test('pedido com tarefas de demandas diferentes não é aprendido; cai no texto ou na única', () => {
  comBanco((v) => {
    v.aprender(10269, [tarefa('77', 'ID 2996'), tarefa('77', 'ID 3100')]);
    const r = v.resolver(10269, [os(1, '77', 'Ajuste da demanda ID 5000'), os(2, '77')], ['2996']);
    assert.deepEqual(r.get(1), { demanda: '5000', origem: 'texto' });
    assert.deepEqual(r.get(2), { demanda: '2996', origem: 'unica' });
  });
});
