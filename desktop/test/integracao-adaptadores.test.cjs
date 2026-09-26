const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Transpila apenas os modulos puros em memoria; nao inicia Electron nem altera dist/.
require.extensions['.ts'] = (mod, arquivo) => {
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const js = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  mod._compile(js, arquivo);
};

const ev = require('../src/integracaoEventos.ts');
const { validarEvento } = require('../src/integracaoValidacao.ts');

const agora = new Date('2026-09-25T15:00:00.000Z');
const usuario = 'exp-usuario:ana@x.com';
const cliente = { id: 7, nome: 'Industria Alfa', experienceProjetoId: 10269, agendaCodparc: 5521, demandaFim: '2026-12-31' };
const validos = (lista) => { for (const e of lista) validarEvento(e); return lista; };

test('cliente.upsert liga projeto e codigo do parceiro do ERP', () => {
  const [c] = validos(ev.eventosClientes([cliente, { ...cliente, id: 8, nome: ' ' }], agora));
  assert.equal(c.data.externalId, 'hub-cliente-7');
  assert.equal(c.data.projectExternalId, 'exp-projeto-10269');
  assert.equal(c.data.erpPartnerCode, 5521);
  assert.equal(c.data.dueAt, '2026-12-31T23:59:59.000Z');
});

test('escopo: demanda, tarefa e so transicoes reais', () => {
  const escopo = {
    clienteId: 7,
    documentos: [{ id: 3, demanda: 'Marketplace', nome: 'escopo.docx', status: 'analisado', enviadoEm: '2026-09-20T10:00:00.000Z', analisadoEm: '' }],
    tarefas: [{ id: 41, documentoId: 3, titulo: 'Endpoint', grupo: 'Integracao', tipo: 'backend', estimativaHoras: 0, prioridade: 'alta', estado: 'em_andamento', ordem: 2, criadaEm: '2026-09-20T11:00:00.000Z', atualizadaEm: '2026-09-25T12:00:00.000Z' }],
  };
  const trans = [
    { id: 1, tarefaId: 41, de: '', para: 'em_revisao', em: '2026-09-25T00:00:00.000Z', origem: 'carga-inicial' },
    { id: 2, tarefaId: 41, de: '', para: 'backlog', em: '2026-09-20T11:00:00.000Z', origem: 'criada' },
    { id: 3, tarefaId: 41, de: 'backlog', para: 'em_andamento', em: '2026-09-25T12:00:00.000Z', origem: 'movida' },
    { id: 4, tarefaId: 41, de: 'em_andamento', para: 'removida', em: '2026-09-25T13:00:00.000Z', origem: 'removida' },
    { id: 5, tarefaId: 99, de: 'backlog', para: 'a_fazer', em: '2026-09-25T13:00:00.000Z', origem: 'movida' },
  ];
  const eventos = validos(ev.eventosEscopo(usuario, [escopo], trans, agora));
  assert.deepEqual(eventos.map((e) => e.type), ['demanda.upsert', 'tarefa.upsert', 'tarefa.transicao', 'tarefa.transicao']);
  const [d, t, t1, t2] = eventos;
  assert.equal(d.data.status, 'ANALISADO');
  assert.equal(d.data.analyzedAt, null);
  assert.equal(t.data.kind, 'BACKEND');
  assert.equal(t.data.priority, 'ALTA');
  assert.equal(t.data.status, 'EM_ANDAMENTO');
  assert.equal(t.data.estimatedMinutes, 1);
  assert.equal(t.data.demandExternalId, 'hub-demanda-3');
  assert.equal('from' in t1.data, false);
  assert.deepEqual(t2.data, { taskExternalId: 'hub-tarefa-41', from: 'BACKLOG', to: 'EM_ANDAMENTO' });
  assert.equal(t2.occurredAt, '2026-09-25T12:00:00.000Z');
});

test('planejamento: horario so em par valido; status fora do dominio nao entra', () => {
  const tarefas = [
    { id: 1, dia: '2026-09-26', horaInicio: '09:00', horaFim: '12:00', etapa: 'Homologacao', processo: 'Faturamento', taskStatus: 'Futura' },
    { id: 2, dia: '2026-09-26', horaInicio: '12:00', horaFim: '09:00', etapa: '', processo: '', taskStatus: 'Hoje' },
    { id: 3, dia: '2026-09-26', horaInicio: '', horaFim: '', etapa: '', processo: '', taskStatus: 'Concluida' },
  ];
  const [a, b, ...resto] = validos(ev.eventosPlanejamento(usuario, [{ projetoId: 10269, tarefas }], agora));
  assert.equal(resto.length, 0);
  assert.equal(a.data.startTime, '09:00');
  assert.equal(a.data.status, 'FUTURA');
  assert.equal('startTime' in b.data, false);
  assert.equal(b.data.status, 'HOJE');
});

test('agenda: hora local em ISO, exige codigo do parceiro e intervalo valido', () => {
  const e = { nuevento: 9910, nomeparc: 'Alfa', inicio: '2026-09-26 10:00:00', fim: '2026-09-26 12:00:00', allday: 'N', descrabrev: 'Reuniao', tipo: 'Reunião', confirmado: 'S', nufap: 5521 };
  const lista = validos(ev.eventosAgenda(usuario, [
    { cliente, eventos: [e, { ...e, nuevento: 1, fim: '2026-09-26 09:00:00' }] },
    { cliente: { ...cliente, id: 9, agendaCodparc: null }, eventos: [{ ...e, nuevento: 2 }] },
  ], agora));
  assert.equal(lista.length, 1);
  const [a] = lista;
  assert.equal(a.data.clientCode, 5521);
  assert.equal(a.data.kind, 'REUNIAO');
  assert.equal(a.data.confirmed, true);
  assert.equal(new Date(a.data.start).getTime(), new Date('2026-09-26T10:00:00').getTime());
});

test('horas.apontar leva os campos novos da OS', () => {
  const ordem = { id: 5, dia: '2026-09-10', descricao: 'x', horasFeitas: '01:30', totalProjetoPrevisto: '10:00', totalProjetoFeito: '02:00', coordenador: '',
    tipo: 'Desenvolvimento', etapa: 'Homologacao', processos: 'Faturamento', statusAceite: 'Concluído', numeroSankhya: '123', statusNumeroSankhya: 'LANCADO', horasExcedidas: false, pedido: 'PED-1' };
  const eventos = validos(ev.montarEventos({ email: 'ana@x.com', nome: 'Ana' }, [{ projetoId: 1, nome: 'C', ordens: [ordem] }], agora));
  const h = eventos.find((e) => e.type === 'horas.apontar');
  assert.equal(h.data.acceptance, 'CONCLUIDO');
  assert.equal(h.data.activityType, 'Desenvolvimento');
  assert.equal(h.data.exceeded, false);
  assert.equal(h.data.requestCode, 'PED-1');
});
