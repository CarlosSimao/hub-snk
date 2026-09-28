import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriaDoEvento, diasDoEvento, minutosPrevistos, osDoEvento } from '../src/agendaPainel.ts';

const ev = (nomeparc: string, codparc: number | null, descrabrev: string) => ({ nomeparc, codparc, descrabrev, descrlonga: '' });

test('categoria: parceiro é atendimento; sem parceiro, ausência pelo título ou interno', () => {
  assert.equal(categoriaDoEvento(ev('AMATOOLS', 78764, 'AMATOOLS')), 'CLIENTE');
  assert.equal(categoriaDoEvento(ev('', null, 'Férias')), 'AUSENCIA');
  assert.equal(categoriaDoEvento(ev('', null, 'Atestado Médico')), 'AUSENCIA');
  assert.equal(categoriaDoEvento(ev('', null, 'Particular ')), 'AUSENCIA');
  assert.equal(categoriaDoEvento(ev('', null, 'Treinamento Addon Studio')), 'INTERNO');
});

test('previsto: dia 08-18 vale a jornada de 8 h; ausência não prevê; vários dias contam só os úteis', () => {
  const dia = { inicio: '2026-09-22 08:00:00', fim: '2026-09-22 18:00:00', allday: 'N' };
  assert.equal(minutosPrevistos(dia, 'CLIENTE'), 480);
  assert.equal(minutosPrevistos({ ...dia, fim: '2026-09-22 12:00:00' }, 'CLIENTE'), 240);
  assert.equal(minutosPrevistos(dia, 'AUSENCIA'), 0);
  // 25/09 (sex) a 29/09 (ter): sex, seg, ter = 3 dias úteis
  assert.equal(minutosPrevistos({ inicio: '2026-09-25 08:00:00', fim: '2026-09-29 18:00:00', allday: 'N' }, 'INTERNO'), 1440);
  assert.deepEqual(diasDoEvento('2026-08-03 08:00:00', '2026-08-07 18:00:00').length, 5);
});

test('OS do agendamento: só as dos dias que ele cobre, somando a duração', () => {
  const ordens = [
    { dia: '2026-09-22', horasFeitas: '08:00' },
    { dia: '2026-09-22', horasFeitas: '01:30' },
    { dia: '2026-09-23', horasFeitas: '08:00' },
  ];
  assert.deepEqual(osDoEvento({ inicio: '2026-09-22 08:00:00', fim: '2026-09-22 18:00:00' }, ordens), { qtd: 2, minutos: 570 });
  assert.deepEqual(osDoEvento({ inicio: '2026-09-24 08:00:00', fim: '2026-09-24 18:00:00' }, ordens), { qtd: 0, minutos: 0 });
});
