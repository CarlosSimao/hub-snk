/**
 * Adaptadores da Integração API: dados da Experience -> eventos do contrato.
 *
 * Mapeamento decidido em `docs/specs/integracao-api-mapeamento.md`:
 *  - `usuario.upsert`: o consultor desta instalação (e-mail do JWT da Experience);
 *  - `os.upsert`: o PROJETO (FAP) de cada cliente cadastrado com ID de projeto;
 *  - `os.progresso`: horas feitas / previstas do projeto, só quando o feito muda;
 *  - `horas.apontar`: cada OS lançada pelo consultor na Experience.
 *
 * Tudo aqui é puro: recebe o que o backend já devolveu e monta os eventos. Os IDs são
 * determinísticos — consultar de novo o mesmo dado gera o mesmo `event.id`, e a fila
 * descarta o repetido (ou o receptor responde `duplicate`). Nada é sintetizado: projeto
 * sem OS no período não gera evento, porque não há de onde tirar o total de horas.
 */
import { createHash } from 'node:crypto';
import type { EventoApi } from './integracaoValidacao';

/** O pedaço da OS da Experience que interessa (ver `OrdemExperience` em src/types.ts). */
export interface OrdemFonte {
  id: number;
  /** `YYYY-MM-DD`. */
  dia: string;
  descricao: string;
  /** Duração desta OS, `HH:MM`. */
  horasFeitas: string;
  /** Acumulados do PROJETO, repetidos em toda OS, `HH:MM`. */
  totalProjetoPrevisto: string;
  totalProjetoFeito: string;
  coordenador: string;
  /* Opcionais do horas.apontar (contrato de 2026-09-25). Ausentes = não enviados. */
  tipo?: string;
  etapa?: string;
  processos?: string;
  /** `Gerado`, `Concluído` ou vazio (sem aceite). */
  statusAceite?: string;
  numeroSankhya?: string;
  statusNumeroSankhya?: string;
  horasExcedidas?: boolean;
  pedido?: string;
  /** ID da demanda (Solicitação de Serviços DS) resolvido pelo hub; vazio = sem vínculo. */
  demanda?: string;
}

export interface ProjetoFonte {
  projetoId: number;
  /** Nome do cliente no hub. */
  nome: string;
  ordens: OrdemFonte[];
}

export interface ConsultorFonte {
  email: string;
  nome: string;
  /** Dashboards v1.1: cargo no ERP e equipe informada na instalacao. */
  cargo?: string;
  equipe?: string;
}

const hash8 = (...partes: unknown[]) =>
  createHash('sha256').update(partes.map(String).join('|')).digest('hex').slice(0, 8);

/** `HH:MM` (horas podem passar de 99) em minutos; qualquer outra coisa vira 0. */
export function minutos(hhmm: string): number {
  const m = /^(\d+):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Só letras, números e `. _ : @ / -` passam no contrato; o resto vira `_`. */
function idSeguro(texto: string): string {
  return texto.toLowerCase().replace(/[^A-Za-z0-9._:@/-]/g, '_');
}

const corte = (texto: string, max: number) => texto.trim().slice(0, max);

export function externalIdUsuario(email: string): string {
  return `exp-usuario:${idSeguro(email)}`.slice(0, 120);
}

function progressoDoProjeto(ordens: OrdemFonte[]): { feito: number; progress: number; status: string } {
  // Os totais vêm repetidos em toda OS; a primeira com valor serve.
  const comTotal = ordens.find((o) => minutos(o.totalProjetoFeito) > 0 || minutos(o.totalProjetoPrevisto) > 0);
  const previsto = comTotal ? minutos(comTotal.totalProjetoPrevisto) : 0;
  const feito = comTotal ? minutos(comTotal.totalProjetoFeito) : 0;
  const progress = previsto > 0 ? Math.min(100, Math.round((feito / previsto) * 100)) : 0;
  return { feito, progress, status: previsto > 0 && feito >= previsto ? 'CONCLUIDO' : 'EM_ANDAMENTO' };
}

/**
 * Monta os eventos de um ciclo. `agora` é o `occurredAt` de todos: a Experience não
 * informa quando a mudança aconteceu, só como está.
 */
/**
 * `demandasEnviadas`: IDs cujo `demanda.upsert` sai neste mesmo ciclo. Só a OS de uma
 * delas leva o vínculo — referenciar demanda que o receptor não tem recusa o apontamento.
 * Ausente = interruptor desligado, as horas saem como sempre saíram.
 */
export function montarEventos(
  consultor: ConsultorFonte,
  projetos: ProjetoFonte[],
  agora: Date,
  demandasEnviadas?: Set<string>,
  /** Dashboards v1.1 ligado: horas levam `workDate`. */
  painelV11 = false,
): EventoApi[] {
  if (!consultor.email) return [];
  const occurredAt = agora.toISOString();
  const usuarioId = externalIdUsuario(consultor.email);
  const nome = corte(consultor.nome || consultor.email, 180);
  const email = consultor.email.trim().toLowerCase();

  // Cargo e equipe entram no hash so quando existem: desligado, o evento e o de sempre.
  const perfil: Record<string, unknown> = {};
  if (painelV11 && consultor.cargo?.trim()) perfil['role'] = corte(consultor.cargo, 120);
  if (painelV11 && consultor.equipe?.trim()) perfil['team'] = corte(consultor.equipe, 120);
  const hashUsuario = Object.keys(perfil).length ? hash8(nome, email, true, JSON.stringify(perfil)) : hash8(nome, email, true);
  const eventos: EventoApi[] = [
    {
      id: `usuario:${usuarioId}:${hashUsuario}`.slice(0, 120),
      type: 'usuario.upsert',
      occurredAt,
      data: { externalId: usuarioId, name: nome, ...(email.length <= 254 ? { email } : {}), active: true, ...perfil },
    },
  ];

  for (const projeto of projetos) {
    const ordens = projeto.ordens.filter((o) => Number.isInteger(o.id) && o.id > 0);
    if (!ordens.length) continue;

    const osId = `exp-projeto-${projeto.projetoId}`;
    const code = `FAP-${projeto.projetoId}`;
    const title = corte(projeto.nome || code, 240) || code;
    const coordenador = corte(ordens.find((o) => o.coordenador.trim())?.coordenador ?? '', 5000);
    const { feito, progress, status } = progressoDoProjeto(ordens);

    eventos.push({
      id: `os:${projeto.projetoId}:${hash8(code, title, status, coordenador)}`,
      type: 'os.upsert',
      occurredAt,
      data: {
        externalId: osId,
        userExternalId: usuarioId,
        code,
        title,
        status,
        progress,
        ...(coordenador ? { description: `Coordenador: ${coordenador}`.slice(0, 5000) } : {}),
      },
    });

    eventos.push({
      id: `prog:${projeto.projetoId}:${feito}`,
      type: 'os.progresso',
      occurredAt,
      data: { osExternalId: osId, progress, status },
    });

    for (const ordem of ordens) {
      const min = minutos(ordem.horasFeitas);
      // O contrato aceita de 1 a 10080 minutos; OS sem duração não é apontamento.
      if (min < 1 || min > 10080) continue;
      const descricao = corte(ordem.descricao, 500);
      const dia = /^\d{4}-\d\d-\d\d$/.test(ordem.dia) ? ordem.dia : '';
      const extras = extrasDaOrdem(ordem);
      const demanda = (ordem.demanda ?? '').trim();
      if (demandasEnviadas && demanda && demandasEnviadas.has(demanda)) {
        extras['demandExternalId'] = externalIdDemandaErp(demanda);
        extras['demandCode'] = demanda;
      }
      // O dia da OS em campo proprio: `startedAt` a meia-noite UTC cai no dia anterior
      // para quem converte para Brasilia.
      if (painelV11 && dia) extras['workDate'] = dia;
      eventos.push({
        id: `horas:${ordem.id}:${hash8(min, descricao, dia, JSON.stringify(extras))}`,
        type: 'horas.apontar',
        occurredAt,
        data: {
          externalId: `exp-os-${ordem.id}`,
          osExternalId: osId,
          userExternalId: usuarioId,
          minutes: min,
          ...(descricao ? { description: descricao } : {}),
          ...(dia ? { startedAt: `${dia}T00:00:00.000Z` } : {}),
          ...extras,
        },
      });
    }
  }
  return eventos;
}

/** Campos opcionais do `horas.apontar`: só os que a OS da Experience tem. */
function extrasDaOrdem(o: OrdemFonte): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  const texto = (campo: string, valor: string | undefined, max: number) => {
    const v = corte(valor ?? '', max);
    if (v) extras[campo] = v;
  };
  texto('activityType', o.tipo, 120);
  texto('stage', o.etapa, 160);
  texto('process', o.processos, 240);
  texto('erpNumber', o.numeroSankhya, 120);
  texto('erpStatus', o.statusNumeroSankhya, 120);
  texto('requestCode', o.pedido, 120);
  if (o.statusAceite !== undefined) {
    const aceite = semAcento(o.statusAceite).toUpperCase();
    extras['acceptance'] = aceite === 'GERADO' ? 'GERADO' : aceite === 'CONCLUIDO' ? 'CONCLUIDO' : 'PENDENTE';
  }
  if (typeof o.horasExcedidas === 'boolean') extras['exceeded'] = o.horasExcedidas;
  return extras;
}

const semAcento = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

/** `em andamento` / `Reunião` -> `EM_ANDAMENTO` / `REUNIAO` (formato canônico do contrato). */
function canonico(t: string, max = 80): string {
  return semAcento(t).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max);
}

export const externalIdCliente = (id: number) => `hub-cliente-${id}`;

/** Demanda do ERP (Solicitação de Serviços DS) — prefixo próprio, não colide com as do kanban. */
export const externalIdDemandaErp = (codigo: string | number) => `erp-demanda-${codigo}`;

/** O pedaço da Solicitação de Serviços que o hub já guarda (ver `SolicitacaoServico`). */
export interface SolicitacaoFonte {
  codigo: number;
  descricao: string;
  /** Rótulo do status do orçamento, ex.: "Orçamento Aprovado". */
  statusOrcamento: string;
  /** `DD/MM/YYYY HH:mm:ss`, horário de Brasília, como o ERP devolve. */
  dtAbertura: string;
  dtAprovacao: string;
  /** Dashboards v1.1. */
  horasEstimadas?: number | null;
  /** Rotulo do tipo da solicitacao, ex.: "Personalização e Customização". */
  tipo?: string;
}

/**
 * O contrato só aceita ENVIADO, ANALISANDO, ANALISADO ou FALHOU. O status do orçamento
 * do ERP cai neles assim: aprovado encerrou a análise; em orçamento, aguardando aprovação,
 * em negociação e pendente de correção ainda estão sendo analisados; reprovado, cancelado
 * e prazo excedido não seguiram; o resto (não iniciado, pendente atendimento) só foi enviado.
 */
export function statusDemandaErp(rotulo: string): 'ENVIADO' | 'ANALISANDO' | 'ANALISADO' | 'FALHOU' {
  const r = semAcento(rotulo).toUpperCase();
  if (r.includes('APROVADO')) return 'ANALISADO';
  if (r.includes('REPROVADO') || r.includes('CANCELADO') || r.includes('EXCEDIDO')) return 'FALHOU';
  if (r.includes('ORCAMENTO') || r.includes('AGUARDANDO') || r.includes('NEGOCIACAO') || r.includes('CORRECAO')) {
    return 'ANALISANDO';
  }
  return 'ENVIADO';
}

/** `DD/MM/YYYY HH:mm[:ss]` de Brasília -> ISO em UTC; vazio se não casar. */
export function dataErpParaIso(valor: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec((valor ?? '').trim());
  if (!m) return '';
  const d = new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}.000-03:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/** `demanda.upsert` de cada demanda do ERP de um cliente (sem data de abertura não sai). */
export function eventosDemandasErp(
  demandas: { clienteId: number; solicitacoes: SolicitacaoFonte[] }[],
  agora: Date,
  /** Dashboards v1.1 ligado: horas estimadas, tipo e status original do ERP. */
  painelV11 = false,
): EventoApi[] {
  const occurredAt = agora.toISOString();
  const eventos: EventoApi[] = [];
  const vistas = new Set<number>();
  for (const { clienteId, solicitacoes } of demandas) {
    for (const s of solicitacoes) {
      if (!Number.isInteger(s.codigo) || s.codigo <= 0 || vistas.has(s.codigo)) continue;
      const createdAt = dataErpParaIso(s.dtAbertura);
      if (!createdAt) continue;
      vistas.add(s.codigo);
      const primeiraLinha = (s.descricao ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? '';
      const name = corte(`ID ${s.codigo}${primeiraLinha ? ` - ${primeiraLinha}` : ''}`, 240);
      const status = statusDemandaErp(s.statusOrcamento);
      const analyzedAt = dataErpParaIso(s.dtAprovacao);
      const data: Record<string, unknown> = {
        externalId: externalIdDemandaErp(s.codigo),
        clientExternalId: externalIdCliente(clienteId),
        name,
        status,
        createdAt,
        ...(analyzedAt ? { analyzedAt } : {}),
        active: true,
      };
      const extras: Record<string, unknown> = {};
      if (painelV11) {
        const minutosEstimados = Math.round((s.horasEstimadas ?? 0) * 60);
        if (minutosEstimados >= 1 && minutosEstimados <= 600_000) extras['estimatedMinutes'] = minutosEstimados;
        const tipo = canonico(s.tipo ?? '');
        if (tipo) extras['requestType'] = tipo;
        const rotulo = corte(s.statusOrcamento ?? '', 80);
        if (rotulo) extras['erpStatusLabel'] = rotulo;
      }
      Object.assign(data, extras);
      const extrasHash = Object.keys(extras).length ? JSON.stringify(extras) : '';
      eventos.push({
        id: `demanda-erp:${s.codigo}:${extrasHash ? hash8(name, status, createdAt, analyzedAt, clienteId, extrasHash) : hash8(name, status, createdAt, analyzedAt, clienteId)}`,
        type: 'demanda.upsert',
        occurredAt,
        data,
      });
    }
  }
  return eventos;
}

/* ------------------------------ cliente.upsert ------------------------------ */

export interface ClienteFonte {
  id: number;
  nome: string;
  experienceProjetoId: number | null;
  agendaCodparc: number | null;
  /** `YYYY-MM-DD` do fim da demanda, ou vazio. */
  demandaFim: string;
}

/**
 * `codparcResolvido`: parceiro achado pelo nome para cadastro sem parceiro (o hub casa
 * pelo nome, so candidato unico). Sem ele a agenda desse cliente nao chegaria ao receptor.
 */
export function eventosClientes(
  clientes: ClienteFonte[],
  agora: Date,
  codparcResolvido: Map<number, number> = new Map(),
): EventoApi[] {
  const occurredAt = agora.toISOString();
  return clientes
    .filter((c) => c.id > 0 && c.nome.trim())
    .map((c) => {
      const data: Record<string, unknown> = { externalId: externalIdCliente(c.id), name: corte(c.nome, 180), active: true };
      if (c.experienceProjetoId) data['projectExternalId'] = `exp-projeto-${c.experienceProjetoId}`;
      // A agenda do ERP localiza o cliente por este código (contrato 3.2 / 3.9).
      const codparc = c.agendaCodparc ?? codparcResolvido.get(c.id) ?? null;
      if (codparc) data['erpPartnerCode'] = codparc;
      if (/^\d{4}-\d\d-\d\d$/.test(c.demandaFim)) data['dueAt'] = `${c.demandaFim}T23:59:59.000Z`;
      return { id: `cliente:${c.id}:${hash8(JSON.stringify(data))}`, type: 'cliente.upsert' as const, occurredAt, data };
    });
}

/* ------------------- demanda.upsert, tarefa.upsert, tarefa.transicao ------------------- */

export interface DocumentoFonte {
  id: number;
  demanda: string;
  nome: string;
  status: string;
  enviadoEm: string;
  analisadoEm: string;
}

export interface TarefaFonte {
  id: number;
  documentoId: number | null;
  titulo: string;
  grupo: string;
  tipo: string;
  estimativaHoras: number;
  prioridade: string;
  estado: string;
  ordem: number;
  criadaEm: string;
  atualizadaEm: string;
}

export interface EscopoFonte {
  clienteId: number;
  documentos: DocumentoFonte[];
  tarefas: TarefaFonte[];
}

export interface TransicaoFonte {
  id: number;
  tarefaId: number;
  de: string;
  para: string;
  em: string;
  origem: string;
}

const ESTADOS_KANBAN = new Set(['BACKLOG', 'A_FAZER', 'EM_ANDAMENTO', 'EM_REVISAO', 'CONCLUIDO']);
const TIPOS_TAREFA = new Set(['BACKEND', 'FRONTEND', 'DADOS', 'RELATORIO', 'BI', 'INTEGRACAO', 'CONFIGURACAO', 'TESTE', 'DOCUMENTACAO', 'OUTRO']);
const PRIORIDADES = new Set(['ALTA', 'MEDIA', 'BAIXA']);
const STATUS_DEMANDA = new Set(['ENVIADO', 'ANALISANDO', 'ANALISADO', 'FALHOU']);

/** ISO do hub (`toISOString`) passa; qualquer outra coisa não entra como data. */
const iso = (t: string) => (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,3})?Z$/.test(t ?? '') ? t : '');

export function eventosEscopo(usuarioId: string, escopos: EscopoFonte[], transicoes: TransicaoFonte[], agora: Date): EventoApi[] {
  const occurredAt = agora.toISOString();
  const eventos: EventoApi[] = [];
  const tarefasEnviadas = new Set<number>();

  for (const escopo of escopos) {
    const clienteId = externalIdCliente(escopo.clienteId);
    const demandas = new Set<number>();
    for (const d of escopo.documentos) {
      const status = canonico(d.status);
      const criado = iso(d.enviadoEm);
      if (!STATUS_DEMANDA.has(status) || !criado) continue;
      const data: Record<string, unknown> = {
        externalId: `hub-demanda-${d.id}`,
        clientExternalId: clienteId,
        name: corte(d.demanda || d.nome, 240) || `Demanda ${d.id}`,
        status,
        createdAt: criado,
        analyzedAt: iso(d.analisadoEm) || null,
        active: true,
      };
      eventos.push({ id: `demanda:${d.id}:${hash8(JSON.stringify(data))}`, type: 'demanda.upsert', occurredAt, data });
      demandas.add(d.id);
    }

    for (const t of escopo.tarefas) {
      const status = canonico(t.estado);
      const criada = iso(t.criadaEm);
      if (!ESTADOS_KANBAN.has(status) || !criada || !t.titulo.trim()) continue;
      const kind = canonico(t.tipo);
      const priority = canonico(t.prioridade);
      const data: Record<string, unknown> = {
        externalId: `hub-tarefa-${t.id}`,
        userExternalId: usuarioId,
        clientExternalId: clienteId,
        ...(t.documentoId !== null && demandas.has(t.documentoId) ? { demandExternalId: `hub-demanda-${t.documentoId}` } : {}),
        title: corte(t.titulo, 240),
        ...(t.grupo.trim() ? { group: corte(t.grupo, 160) } : {}),
        kind: TIPOS_TAREFA.has(kind) ? kind : 'OUTRO',
        priority: PRIORIDADES.has(priority) ? priority : 'MEDIA',
        // O contrato exige de 1 a 960 minutos; tarefa sem estimativa vai com 1 minuto.
        estimatedMinutes: Math.min(960, Math.max(1, Math.round(t.estimativaHoras * 60))),
        status,
        position: Math.min(1_000_000, Math.max(0, Math.trunc(t.ordem))),
        createdAt: criada,
        updatedAt: iso(t.atualizadaEm) || criada,
        active: true,
      };
      eventos.push({ id: `tarefa:${t.id}:${hash8(JSON.stringify(data))}`, type: 'tarefa.upsert', occurredAt, data });
      tarefasEnviadas.add(t.id);
    }
  }

  // Só transições reais: `carga-inicial` é o estado em que a tarefa foi encontrada (já
  // vai no upsert) e `removida` não existe no domínio do contrato.
  for (const x of transicoes) {
    if (!tarefasEnviadas.has(x.tarefaId) || !['criada', 'movida'].includes(x.origem)) continue;
    const para = canonico(x.para);
    const de = canonico(x.de);
    const em = iso(x.em);
    if (!ESTADOS_KANBAN.has(para) || !em || de === para) continue;
    eventos.push({
      id: `tarefa-mov:${x.id}`,
      type: 'tarefa.transicao',
      occurredAt: em,
      data: { taskExternalId: `hub-tarefa-${x.tarefaId}`, ...(de && ESTADOS_KANBAN.has(de) ? { from: de } : {}), to: para },
    });
  }
  return eventos;
}

/* ----------------------------- planejamento.upsert ----------------------------- */

export interface PlanejamentoFonte {
  id: number;
  /** `YYYY-MM-DD`. */
  dia: string;
  horaInicio: string;
  horaFim: string;
  etapa: string;
  processo: string;
  /** `Hoje`, `Futura`, `Atrasada` (classificação da Experience). */
  taskStatus: string;
}

const HORA = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function eventosPlanejamento(
  usuarioId: string,
  projetos: { projetoId: number; tarefas: PlanejamentoFonte[] }[],
  agora: Date,
): EventoApi[] {
  const occurredAt = agora.toISOString();
  const eventos: EventoApi[] = [];
  for (const p of projetos) {
    for (const t of p.tarefas) {
      const status = canonico(t.taskStatus);
      if (!['HOJE', 'FUTURA', 'ATRASADA'].includes(status) || !/^\d{4}-\d\d-\d\d$/.test(t.dia)) continue;
      // Os dois horários ou nenhum, e o fim depois do início (contrato 3.8).
      const ini = (t.horaInicio ?? '').trim();
      const fim = (t.horaFim ?? '').trim();
      const comHorario = HORA.test(ini) && HORA.test(fim) && ini < fim;
      const data: Record<string, unknown> = {
        externalId: `exp-tarefa-${t.id}`,
        osExternalId: `exp-projeto-${p.projetoId}`,
        userExternalId: usuarioId,
        plannedDate: t.dia,
        ...(comHorario ? { startTime: ini, endTime: fim } : {}),
        ...(t.etapa?.trim() ? { stage: corte(t.etapa, 160) } : {}),
        ...(t.processo?.trim() ? { process: corte(t.processo, 240) } : {}),
        status,
        active: true,
      };
      eventos.push({ id: `plan:${t.id}:${hash8(JSON.stringify(data))}`, type: 'planejamento.upsert', occurredAt, data });
    }
  }
  return eventos;
}

/* ---------------------------- agenda.evento.upsert ---------------------------- */

export interface EventoAgendaFonte {
  nuevento: number | null;
  nomeparc: string;
  /** `YYYY-MM-DD HH:mm:ss`, hora local. */
  inicio: string;
  fim: string;
  allday: string;
  descrabrev: string;
  tipo: string;
  confirmado: string;
  nufap: number | null;
  /** Demanda do agendamento (DESCRLONGA ou vínculo manual) e o confronto do dia. */
  demanda?: string;
  conferencia?: { status: string };
}

/** Status do confronto agenda x Experience no formato do contrato (maiúsculas e _). */
export const STATUS_DEMANDA_AGENDA = [
  'SEM_DEMANDA', 'DEMANDA_SEM_OS', 'OS_SEM_DEMANDA', 'DIVERGENTE', 'CONFERE', 'SEM_EXPERIENCE',
] as const;

/** Hora local do ERP (`YYYY-MM-DD HH:mm:ss`) em ISO UTC. */
function localParaIso(t: string): string {
  const m = /^(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d(:\d\d)?)$/.exec((t ?? '').trim());
  if (!m) return '';
  const d = new Date(`${m[1]}T${m[2]}`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
}

/**
 * Só a agenda do PRÓPRIO consultor (contrato 3.9): quem chama passa os eventos já
 * recortados pelo recurso do consultor no cadastro do cliente.
 */
/**
 * `demandasEnviadas`: como em `montarEventos` — presente = interruptor ligado. Aí o evento
 * leva `demandCode` e `demandStatus` (o confronto do dia), e `demandExternalId` só quando o
 * `demanda.upsert` da demanda sai no mesmo ciclo.
 */
export function eventosAgenda(
  usuarioId: string,
  clientes: { cliente: ClienteFonte; eventos: EventoAgendaFonte[] }[],
  agora: Date,
  demandasEnviadas?: Set<string>,
): EventoApi[] {
  const occurredAt = agora.toISOString();
  const eventos: EventoApi[] = [];
  for (const { cliente, eventos: lista } of clientes) {
    if (!cliente.agendaCodparc) continue; // sem erpPartnerCode o receptor não acha o cliente
    for (const e of lista) {
      if (!e.nuevento) continue;
      const start = localParaIso(e.inicio);
      const end = localParaIso(e.fim);
      if (!start || !end || end <= start) continue;
      const data: Record<string, unknown> = {
        externalId: `erp-evento-${e.nuevento}`,
        userExternalId: usuarioId,
        clientCode: cliente.agendaCodparc,
        clientName: corte(e.nomeparc || cliente.nome, 180),
        start,
        end,
        allDay: e.allday === 'S' || e.allday === 'true',
        title: corte(e.descrabrev ?? '', 240) || `Evento ${e.nuevento}`,
        kind: canonico(e.tipo ?? '') || 'OUTRO',
        confirmed: e.confirmado === 'S',
        ...(e.nufap ? { fapCode: e.nufap } : {}),
        active: true,
      };
      if (demandasEnviadas) {
        const demanda = (e.demanda ?? '').trim();
        const status = canonico(e.conferencia?.status ?? '');
        if (demanda) data['demandCode'] = demanda;
        if (demanda && demandasEnviadas.has(demanda)) data['demandExternalId'] = externalIdDemandaErp(demanda);
        if ((STATUS_DEMANDA_AGENDA as readonly string[]).includes(status)) data['demandStatus'] = status;
      }
      eventos.push({ id: `agenda:${e.nuevento}:${hash8(JSON.stringify(data))}`, type: 'agenda.evento.upsert', occurredAt, data });
    }
  }
  return eventos;
}

/* ------------------------ dashboards v1.1: agenda completa ------------------------ */

/** Um agendamento como `/api/integracao/painel` devolve (ver src/routesExperience.ts). */
export interface AgendaPainelFonte extends EventoAgendaFonte {
  codparc: number | null;
  descrlonga?: string;
  clienteId: number | null;
  categoria: 'CLIENTE' | 'AUSENCIA' | 'INTERNO';
  minutosPrevistos: number;
  qtdOs?: number;
  minutosOs?: number;
}

export const externalIdParceiroErp = (codparc: number) => `erp-parceiro-${codparc}`;

/** `cliente.upsert` para parceiro que aparece na agenda do consultor e nao esta cadastrado. */
export function eventosClientesAutomaticos(
  eventos: AgendaPainelFonte[],
  codparcsCadastrados: Set<number>,
  agora: Date,
): EventoApi[] {
  const occurredAt = agora.toISOString();
  const vistos = new Map<number, string>();
  for (const e of eventos) {
    if (e.categoria !== 'CLIENTE' || !e.codparc || e.clienteId !== null || codparcsCadastrados.has(e.codparc)) continue;
    if (!vistos.has(e.codparc)) vistos.set(e.codparc, corte(e.nomeparc || `Parceiro ${e.codparc}`, 180));
  }
  return [...vistos].map(([codparc, nome]) => {
    const data = { externalId: externalIdParceiroErp(codparc), name: nome, erpPartnerCode: codparc, active: true };
    return { id: `cliente-erp:${codparc}:${hash8(JSON.stringify(data))}`, type: 'cliente.upsert' as const, occurredAt, data };
  });
}

/**
 * `agenda.evento.upsert` de toda a agenda do consultor, com os campos da v1.1. Ausencia e
 * compromisso interno saem sem `clientCode`; atendimento sai com o parceiro do evento.
 */
export function eventosAgendaPainel(
  usuarioId: string,
  eventos: AgendaPainelFonte[],
  agora: Date,
  demandasEnviadas?: Set<string>,
): EventoApi[] {
  const occurredAt = agora.toISOString();
  const saida: EventoApi[] = [];
  for (const e of eventos) {
    if (!e.nuevento) continue;
    const start = localParaIso(e.inicio);
    const end = localParaIso(e.fim);
    if (!start || !end || end <= start) continue;
    const cliente = e.categoria === 'CLIENTE';
    if (cliente && !e.codparc) continue;
    const data: Record<string, unknown> = {
      externalId: `erp-evento-${e.nuevento}`,
      userExternalId: usuarioId,
      ...(cliente ? { clientCode: e.codparc } : {}),
      clientName: corte(e.nomeparc || e.descrabrev || 'Compromisso', 180) || 'Compromisso',
      start,
      end,
      allDay: e.allday === 'S' || e.allday === 'true',
      title: corte(e.descrabrev ?? '', 240) || `Evento ${e.nuevento}`,
      kind: canonico(e.tipo ?? '') || 'OUTRO',
      confirmed: e.confirmado === 'S',
      ...(e.nufap ? { fapCode: e.nufap } : {}),
      category: e.categoria,
      plannedMinutes: Math.max(0, Math.round(e.minutosPrevistos || 0)),
      ...(e.qtdOs !== undefined ? { osCount: e.qtdOs, osMinutes: Math.max(0, Math.round(e.minutosOs ?? 0)) } : {}),
      active: true,
    };
    if (demandasEnviadas) {
      const demanda = (e.demanda ?? '').trim();
      const status = canonico(e.conferencia?.status ?? '');
      if (demanda) data['demandCode'] = demanda;
      if (demanda && demandasEnviadas.has(demanda)) data['demandExternalId'] = externalIdDemandaErp(demanda);
      if (cliente && (STATUS_DEMANDA_AGENDA as readonly string[]).includes(status)) data['demandStatus'] = status;
    }
    saida.push({ id: `agenda:${e.nuevento}:${hash8(JSON.stringify(data))}`, type: 'agenda.evento.upsert', occurredAt, data });
  }
  return saida;
}

/**
 * Agendamentos que ja foram enviados, cairiam na janela atual e sumiram do ERP: saem de
 * novo com `active: false`, sobre o ultimo conteudo enviado. `anteriores` e o que o DS
 * guardou do ultimo envio (externalId -> data).
 */
export function agendaInativada(
  anteriores: Record<string, Record<string, unknown>>,
  atuais: Set<string>,
  janela: { de: string; ate: string },
  agora: Date,
): EventoApi[] {
  const occurredAt = agora.toISOString();
  const saida: EventoApi[] = [];
  for (const [externalId, data] of Object.entries(anteriores)) {
    if (atuais.has(externalId) || data['active'] === false) continue;
    const dia = String(data['start'] ?? '').slice(0, 10);
    if (!dia || dia < janela.de || dia > janela.ate) continue;
    const inativo = { ...data, active: false };
    saida.push({ id: `agenda:${externalId.replace(/^erp-evento-/, '')}:inativo`, type: 'agenda.evento.upsert', occurredAt, data: inativo });
  }
  return saida;
}
