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

test('demanda do ERP vira demanda.upsert com status do contrato e data de Brasilia', () => {
  const [d] = validos(ev.eventosDemandasErp([{
    clienteId: 7,
    solicitacoes: [{ codigo: 2996, descricao: 'Aos cuidados de Clayton;\nresto', statusOrcamento: 'Orçamento Aprovado', dtAbertura: '16/07/2026 11:10:15', dtAprovacao: '' }],
  }], agora));
  assert.equal(d.type, 'demanda.upsert');
  assert.equal(d.data.externalId, 'erp-demanda-2996');
  assert.equal(d.data.clientExternalId, 'hub-cliente-7');
  assert.equal(d.data.name, 'ID 2996 - Aos cuidados de Clayton;');
  assert.equal(d.data.status, 'ANALISADO');
  assert.equal(d.data.createdAt, '2026-07-16T14:10:15.000Z');
  assert.equal(ev.statusDemandaErp('Em Orçamento'), 'ANALISANDO');
  assert.equal(ev.statusDemandaErp('Orçamento Reprovado'), 'FALHOU');
  assert.equal(ev.statusDemandaErp('Não Iniciado'), 'ENVIADO');
});

test('horas levam a demanda so quando ela sai no mesmo ciclo', () => {
  const ordem = { id: 539845, dia: '2026-09-23', descricao: 'x', horasFeitas: '08:00', totalProjetoPrevisto: '', totalProjetoFeito: '', coordenador: '', demanda: '2996' };
  const outra = { ...ordem, id: 539846, demanda: '3100' };
  const projetos = [{ projetoId: 10269, nome: 'Alfa', ordens: [ordem, outra] }];
  const horas = (set) => validos(ev.montarEventos({ email: 'ana@x.com', nome: 'Ana' }, projetos, agora, set)).filter((e) => e.type === 'horas.apontar');
  const [a, b] = horas(new Set(['2996']));
  assert.equal(a.data.demandExternalId, 'erp-demanda-2996');
  assert.equal(a.data.demandCode, '2996');
  assert.equal(b.data.demandExternalId, undefined, 'demanda sem demanda.upsert nao e referenciada');
  const semFlag = horas(undefined);
  assert.ok(semFlag.every((e) => e.data.demandExternalId === undefined), 'interruptor desligado nao muda as horas');
});

test('agenda leva demanda e status do confronto so com o interruptor ligado', () => {
  const cliente = { id: 7, nome: 'Alfa', experienceProjetoId: 10269, agendaCodparc: 5521, demandaFim: '' };
  const e = { nuevento: 48636202, nomeparc: 'Alfa', inicio: '2026-09-23 08:00:00', fim: '2026-09-23 18:00:00', allday: 'N', descrabrev: 'Alfa', tipo: 'ESTATICO', confirmado: 'S', nufap: 32503, demanda: '2996', conferencia: { status: 'demanda-sem-os' } };
  const semId = { ...e, nuevento: 48636203, demanda: '', conferencia: { status: 'sem-demanda' } };
  const [a, b] = validos(ev.eventosAgenda(usuario, [{ cliente, eventos: [e, semId] }], agora, new Set(['2996'])));
  assert.equal(a.data.demandExternalId, 'erp-demanda-2996');
  assert.equal(a.data.demandCode, '2996');
  assert.equal(a.data.demandStatus, 'DEMANDA_SEM_OS');
  assert.equal(b.data.demandCode, undefined);
  assert.equal(b.data.demandStatus, 'SEM_DEMANDA');
  const [c] = validos(ev.eventosAgenda(usuario, [{ cliente, eventos: [e] }], agora));
  assert.equal(c.data.demandStatus, undefined, 'desligado: evento igual ao de hoje');
});

test('v1.1: agenda completa com categoria, previsto e OS; ausencia sem clientCode', () => {
  const base = { nuevento: 1, nomeparc: 'Alfa', codparc: 5521, clienteId: 7, inicio: '2026-09-22 08:00:00', fim: '2026-09-22 18:00:00', allday: 'N', descrabrev: 'Alfa', tipo: 'ESTATICO', confirmado: 'S', nufap: null, categoria: 'CLIENTE', minutosPrevistos: 480, qtdOs: 1, minutosOs: 480, demanda: '2996', conferencia: { status: 'confere' } };
  const ferias = { ...base, nuevento: 2, nomeparc: '', codparc: null, clienteId: null, descrabrev: 'Ferias', categoria: 'AUSENCIA', minutosPrevistos: 0, qtdOs: undefined, minutosOs: undefined, demanda: '', conferencia: { status: 'sem-demanda' } };
  const [a, b] = validos(ev.eventosAgendaPainel(usuario, [base, ferias], agora, new Set(['2996'])));
  assert.equal(a.data.category, 'CLIENTE');
  assert.equal(a.data.plannedMinutes, 480);
  assert.equal(a.data.osCount, 1);
  assert.equal(a.data.demandStatus, 'CONFERE');
  assert.equal(b.data.category, 'AUSENCIA');
  assert.equal(b.data.clientCode, undefined);
  assert.equal(b.data.osCount, undefined, 'sem Experience nao afirma zero OS');
  assert.equal(b.data.demandStatus, undefined, 'ausencia nao entra na conformidade');
});

test('v1.1: validacao exige clientCode so para atendimento', () => {
  const { validarEvento } = require('../src/integracaoValidacao.ts');
  const evento = (data) => ({ id: 'agenda:9:x', type: 'agenda.evento.upsert', occurredAt: agora.toISOString(), data: { externalId: 'erp-evento-9', userExternalId: usuario, clientName: 'X', start: '2026-09-22T11:00:00.000Z', end: '2026-09-22T21:00:00.000Z', allDay: false, title: 'X', kind: 'ESTATICO', confirmed: true, ...data } });
  assert.doesNotThrow(() => validarEvento(evento({ category: 'AUSENCIA' })));
  assert.throws(() => validarEvento(evento({ category: 'CLIENTE' })), /clientCode/);
  assert.throws(() => validarEvento(evento({})), /clientCode/);
  assert.throws(() => validarEvento(evento({ category: 'FERIAS', clientCode: 1 })), /category/);
});

test('v1.1: parceiro fora do cadastro vira cliente automatico; cadastrado nao', () => {
  const e = (codparc, clienteId) => ({ nuevento: codparc, nomeparc: `P${codparc}`, codparc, clienteId, categoria: 'CLIENTE' });
  const auto = validos(ev.eventosClientesAutomaticos([e(75742, null), e(75742, null), e(5521, 7), e(62230, null)], new Set([5521, 62230]), agora));
  assert.deepEqual(auto.map((x) => x.data.externalId), ['erp-parceiro-75742']);
  assert.equal(auto[0].data.erpPartnerCode, 75742);
});

test('v1.1: agendamento que sumiu da janela vira active false; fora da janela fica', () => {
  const anteriores = {
    'erp-evento-1': { externalId: 'erp-evento-1', start: '2026-09-23T11:00:00.000Z', active: true },
    'erp-evento-2': { externalId: 'erp-evento-2', start: '2026-05-01T11:00:00.000Z', active: true },
    'erp-evento-3': { externalId: 'erp-evento-3', start: '2026-09-24T11:00:00.000Z', active: true },
  };
  const inativos = ev.agendaInativada(anteriores, new Set(['erp-evento-3']), { de: '2026-08-01', ate: '2026-11-30' }, agora);
  assert.deepEqual(inativos.map((x) => x.data.externalId), ['erp-evento-1']);
  assert.equal(inativos[0].data.active, false);
});

test('v1.1: OS leva workDate; usuario leva cargo e equipe; demanda leva estimado e tipo', () => {
  const ordem = { id: 1, dia: '2026-09-22', descricao: 'x', horasFeitas: '08:00', totalProjetoPrevisto: '', totalProjetoFeito: '', coordenador: '' };
  const evs = validos(ev.montarEventos({ email: 'ana@x.com', nome: 'Ana', cargo: 'DEVELOPER I', equipe: 'Sul' }, [{ projetoId: 1, nome: 'C', ordens: [ordem] }], agora, undefined, true));
  assert.equal(evs.find((e) => e.type === 'horas.apontar').data.workDate, '2026-09-22');
  const u = evs.find((e) => e.type === 'usuario.upsert');
  assert.equal(u.data.role, 'DEVELOPER I');
  assert.equal(u.data.team, 'Sul');
  const semV11 = ev.montarEventos({ email: 'ana@x.com', nome: 'Ana', cargo: 'DEVELOPER I' }, [{ projetoId: 1, nome: 'C', ordens: [ordem] }], agora);
  assert.equal(semV11[0].data.role, undefined);
  assert.equal(semV11.find((e) => e.type === 'horas.apontar').data.workDate, undefined);
  const [d] = validos(ev.eventosDemandasErp([{ clienteId: 7, solicitacoes: [{ codigo: 2996, descricao: 'x', statusOrcamento: 'Orçamento Aprovado', dtAbertura: '16/07/2026 11:10:15', dtAprovacao: '', horasEstimadas: 174, tipo: 'Personalização e Customização' }] }], agora, true));
  assert.equal(d.data.estimatedMinutes, 10440);
  assert.equal(d.data.requestType, 'PERSONALIZACAO_E_CUSTOMIZACAO');
  assert.equal(d.data.erpStatusLabel, 'Orçamento Aprovado');
});
