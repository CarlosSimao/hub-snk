export const CAMINHO_API = '/public/serverFunction/60689/15/execute';
export type TipoEvento =
  | 'usuario.upsert'
  | 'cliente.upsert'
  | 'os.upsert'
  | 'os.progresso'
  | 'demanda.upsert'
  | 'tarefa.upsert'
  | 'tarefa.transicao'
  | 'planejamento.upsert'
  | 'agenda.evento.upsert'
  | 'horas.apontar';
export interface EventoApi { id: string; type: TipoEvento; occurredAt: string; data: Record<string, unknown> }

type Regra = number | 'id' | 'date' | 'boolean' | 'progress' | 'minutes' | 'integer' | 'bigMinutes' | 'string' | 'stringNumber'
  | 'plannedDate' | 'time' | readonly string[];
interface Formato { obrigatorios: Record<string, Regra>; opcionais: Record<string, Regra>; nulos?: readonly string[] }

const id = /^[A-Za-z0-9._:@/-]{1,120}$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_DEMANDA = ['ENVIADO', 'ANALISANDO', 'ANALISADO', 'FALHOU'] as const;
const TIPOS_TAREFA = ['BACKEND', 'FRONTEND', 'DADOS', 'RELATORIO', 'BI', 'INTEGRACAO', 'CONFIGURACAO', 'TESTE', 'DOCUMENTACAO', 'OUTRO'] as const;
const PRIORIDADES_TAREFA = ['ALTA', 'MEDIA', 'BAIXA'] as const;
const STATUS_TAREFA = ['BACKLOG', 'A_FAZER', 'EM_ANDAMENTO', 'EM_REVISAO', 'CONCLUIDO'] as const;
const STATUS_PLANEJAMENTO = ['HOJE', 'FUTURA', 'ATRASADA'] as const;
const ACEITES = ['GERADO', 'CONCLUIDO', 'PENDENTE'] as const;
// Contrato de dashboards v1.1: categoria do agendamento.
const CATEGORIAS_AGENDA = ['CLIENTE', 'AUSENCIA', 'INTERNO'] as const;
const STATUS_DEMANDA_AGENDA = ['SEM_DEMANDA', 'DEMANDA_SEM_OS', 'OS_SEM_DEMANDA', 'DIVERGENTE', 'CONFERE', 'SEM_EXPERIENCE'] as const;

const formatos: Record<TipoEvento, Formato> = {
  'usuario.upsert': {
    obrigatorios: { externalId: 'id', name: 180 },
    opcionais: { email: 254, active: 'boolean', role: 120, team: 120 },
  },
  'cliente.upsert': {
    obrigatorios: { externalId: 'id', name: 180 },
    opcionais: { projectExternalId: 'id', erpPartnerCode: 'stringNumber', dueAt: 'date', active: 'boolean' },
  },
  'os.upsert': {
    obrigatorios: { externalId: 'id', userExternalId: 'id', code: 120, title: 240, status: 80, progress: 'progress' },
    opcionais: { description: 5000, priority: 40, dueAt: 'date', active: 'boolean', demandExternalId: 'id' },
  },
  'os.progresso': {
    obrigatorios: { osExternalId: 'id', progress: 'progress', status: 80 },
    opcionais: {},
  },
  'demanda.upsert': {
    obrigatorios: { externalId: 'id', clientExternalId: 'id', name: 240, status: STATUS_DEMANDA, createdAt: 'date' },
    opcionais: {
      analyzedAt: 'date', active: 'boolean',
      // Dashboards v1.1: horas estimadas, tipo e status original da solicitacao do ERP.
      estimatedMinutes: 'bigMinutes', requestType: 80, erpStatusLabel: 80,
    },
    nulos: ['analyzedAt'],
  },
  'tarefa.upsert': {
    obrigatorios: {
      externalId: 'id', userExternalId: 'id', clientExternalId: 'id', title: 240,
      kind: TIPOS_TAREFA, priority: PRIORIDADES_TAREFA, estimatedMinutes: 'integer',
      status: STATUS_TAREFA, position: 'integer', createdAt: 'date', updatedAt: 'date',
    },
    opcionais: { demandExternalId: 'id', group: 160, active: 'boolean' },
  },
  'tarefa.transicao': {
    obrigatorios: { taskExternalId: 'id', to: STATUS_TAREFA },
    opcionais: { from: STATUS_TAREFA },
  },
  'planejamento.upsert': {
    obrigatorios: {
      externalId: 'id', osExternalId: 'id', userExternalId: 'id', plannedDate: 'plannedDate',
      status: STATUS_PLANEJAMENTO,
    },
    opcionais: { startTime: 'time', endTime: 'time', stage: 160, process: 240, active: 'boolean' },
  },
  'agenda.evento.upsert': {
    obrigatorios: {
      externalId: 'id', userExternalId: 'id', clientName: 180,
      start: 'date', end: 'date', allDay: 'boolean', title: 240, kind: 80, confirmed: 'boolean',
    },
    opcionais: {
      fapCode: 'stringNumber', active: 'boolean',
      // Campos novos (2026-09-28): demanda do agendamento e o confronto com a Experience.
      demandExternalId: 'id', demandCode: 'stringNumber', demandStatus: STATUS_DEMANDA_AGENDA,
      // Dashboards v1.1. clientCode continua obrigatorio para atendimento (ver validarEvento).
      clientCode: 'stringNumber', category: CATEGORIAS_AGENDA,
      plannedMinutes: 'integer', osCount: 'integer', osMinutes: 'integer',
    },
  },
  'horas.apontar': {
    obrigatorios: { externalId: 'id', osExternalId: 'id', userExternalId: 'id', minutes: 'minutes' },
    opcionais: {
      description: 500, startedAt: 'date', endedAt: 'date', activityType: 120, stage: 160,
      process: 240, acceptance: ACEITES, erpNumber: 'stringNumber', erpStatus: 'string',
      exceeded: 'boolean', requestCode: 'stringNumber',
      // Campos novos (2026-09-28): a demanda da OS. Só saem com o interruptor ligado.
      demandExternalId: 'id', demandCode: 'stringNumber',
      // Dashboards v1.1: dia da OS, sem depender de fuso.
      workDate: 'plannedDate',
    },
  },
};

export function validarConfig(apiUrl: string, installationId: string): void {
  let url: URL;
  try { url = new URL(apiUrl); } catch { throw new Error('URL da API invalida'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== CAMINHO_API) {
    throw new Error(`URL HTTPS deve terminar exatamente em ${CAMINHO_API}`);
  }
  if (!uuid.test(installationId)) throw new Error('ID da instalacao deve ser UUID valido');
}

function dataValida(valor: unknown): boolean {
  if (typeof valor !== 'string' || valor.length > 35 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(valor)) return false;
  const timestamp = Date.parse(valor);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().startsWith(valor.slice(0, 19));
}

function dataPlanejadaValida(valor: unknown): boolean {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const [ano, mes, dia] = valor.split('-').map(Number);
  const data = new Date(Date.UTC(ano!, mes! - 1, dia));
  return data.getUTCFullYear() === ano && data.getUTCMonth() === mes! - 1 && data.getUTCDate() === dia;
}

const horaValida = (valor: unknown): valor is string =>
  typeof valor === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(valor);
const segundos = (hora: string): number => {
  const [h, m, s = 0] = hora.split(':').map(Number);
  return h! * 3600 + m! * 60 + s;
};

function regraValida(valor: unknown, regra: Regra, campo: string): boolean {
  if (regra === 'id') return typeof valor === 'string' && id.test(valor);
  if (regra === 'date') return dataValida(valor);
  if (regra === 'boolean') return typeof valor === 'boolean';
  if (regra === 'progress') return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor <= 100;
  if (regra === 'minutes') return typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 10080;
  if (regra === 'string') return typeof valor === 'string' && valor.length > 0;
  if (regra === 'bigMinutes') return typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 && valor <= 600_000;
  if (regra === 'integer') {
    if (typeof valor !== 'number' || !Number.isInteger(valor)) return false;
    return campo === 'estimatedMinutes' ? valor >= 1 && valor <= 960 : valor >= 0 && valor <= 1_000_000;
  }
  if (regra === 'stringNumber') return (typeof valor === 'string' && valor.length > 0) || (typeof valor === 'number' && Number.isFinite(valor));
  if (regra === 'plannedDate') return dataPlanejadaValida(valor);
  if (regra === 'time') return horaValida(valor);
  if (Array.isArray(regra)) return typeof valor === 'string' && regra.includes(valor);
  return typeof regra === 'number' && typeof valor === 'string' && valor.length >= 1 && valor.length <= regra;
}

export function validarEvento(valor: unknown): asserts valor is EventoApi {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) throw new Error('Evento deve ser objeto');
  const e = valor as Record<string, unknown>;
  if (typeof e.id !== 'string' || !id.test(e.id)) throw new Error('event.id invalido');
  if (typeof e.type !== 'string' || !(e.type in formatos)) throw new Error('event.type invalido');
  if (!dataValida(e.occurredAt)) throw new Error('event.occurredAt deve ser ISO UTC');
  if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data)) throw new Error('event.data invalido');
  if (Object.keys(e).some(k => !['id', 'type', 'occurredAt', 'data'].includes(k))) throw new Error('Campo extra no evento');
  const data = e.data as Record<string, unknown>;
  const f = formatos[e.type as TipoEvento];
  if (Object.keys(data).some(k => !(k in f.obrigatorios) && !(k in f.opcionais))) throw new Error('Campo extra em event.data');
  for (const [campo, regra] of Object.entries({ ...f.obrigatorios, ...f.opcionais })) {
    const v = data[campo];
    if (v === undefined && campo in f.obrigatorios) throw new Error(`${campo} obrigatorio`);
    if (v === undefined) continue;
    if (v === null && f.nulos?.includes(campo)) continue;
    if (!regraValida(v, regra, campo)) throw new Error(`${campo} invalido`);
  }

  if (e.type === 'planejamento.upsert') {
    const inicio = data.startTime;
    const fim = data.endTime;
    if ((inicio === undefined) !== (fim === undefined) || (typeof inicio === 'string' && typeof fim === 'string' && segundos(inicio) >= segundos(fim))) {
      throw new Error('Intervalo planejado invalido');
    }
  }
  // Ausencia e compromisso interno nao tem parceiro no ERP; atendimento precisa dele.
  if (e.type === 'agenda.evento.upsert' && data.clientCode === undefined
    && data.category !== 'AUSENCIA' && data.category !== 'INTERNO') {
    throw new Error('clientCode obrigatorio');
  }
  if (e.type === 'agenda.evento.upsert' && Date.parse(String(data.end)) <= Date.parse(String(data.start))) {
    throw new Error('Intervalo de agenda invalido');
  }
  if (e.type === 'horas.apontar' && data.startedAt !== undefined && data.endedAt !== undefined
    && Date.parse(String(data.endedAt)) <= Date.parse(String(data.startedAt))) {
    throw new Error('Intervalo de apontamento invalido');
  }
  if (e.type === 'tarefa.transicao' && data.from !== undefined && data.from === data.to) {
    throw new Error('Transicao sem mudanca de status');
  }
}
