import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conferirDia, demandaDoTexto } from '../src/conferenciaDemanda.ts';

const DESCRLONGA = 'Processos: Vendas\nOBS:\n- TECH | ID 2996 - AMATOOLS COMERCIAL E IMPORTADORA LTDA\nDesenvolvimento';

test('lê o ID do DESCRLONGA; o vínculo manual vale por cima', () => {
  assert.deepEqual(demandaDoTexto(DESCRLONGA, undefined), { demanda: '2996', origem: 'texto' });
  assert.deepEqual(demandaDoTexto('Treinamento interno', undefined), { demanda: '', origem: '' });
  assert.deepEqual(demandaDoTexto(DESCRLONGA, '3100'), { demanda: '3100', origem: 'manual' });
});

test('os cinco status do dia reservado', () => {
  const t = (demanda: string) => [{ id: 1, demanda, origem: 'texto' as const }];
  const o = (...demandas: string[]) => demandas.map((demanda, i) => ({ id: 10 + i, demanda }));

  assert.equal(conferirDia('', t('2996'), o('2996'), true).status, 'sem-demanda');
  assert.equal(conferirDia('2996', t('2996'), [], true).status, 'demanda-sem-os');
  assert.equal(conferirDia('2996', [], o(''), true).status, 'os-sem-demanda');
  assert.equal(conferirDia('2996', t('3100'), o('2996'), true).status, 'divergente', 'tarefa de outra demanda');
  assert.equal(conferirDia('2996', t('2996'), o('2996', '3100'), true).status, 'divergente', 'OS de outra demanda');
  assert.equal(conferirDia('2996', t('2996'), o('2996'), true).status, 'confere');
  assert.equal(conferirDia('2996', [], o('2996'), true).status, 'confere', 'tarefa já fechada: agenda x OS basta');
  assert.equal(conferirDia('2996', [], [], false).status, 'sem-experience', 'sem Experience não afirma falta de OS');
});
