/**
 * Ciclo dos adaptadores: lê do backend local o que o hub já tem e enfileira os eventos
 * dos 10 tipos do contrato (`contrato_api_desktop.md`).
 *
 * Fontes, todas do próprio backend (nada é consultado de fora):
 *  - `/api/clientes` -> `cliente.upsert`;
 *  - `/api/experience/resumo` -> projetos/OS/horas (só as OS do PRÓPRIO consultor, pelo
 *    `person_id` do cadastro), planejamento (tarefas da Experience) e agenda do ERP já
 *    recortada pelo recurso do consultor no cadastro do cliente — a agenda de terceiros
 *    não sai (contrato 3.9). O mês anterior entra na primeira semana, para OS lançada com
 *    atraso no fim do mês não ficar de fora;
 *  - `/api/clientes/:id/escopo` -> demandas e tarefas do kanban;
 *  - `/api/escopo/transicoes` -> mudanças de coluna do kanban.
 *
 * Só roda com a integração configurada (URL, instalação e chave): sem identidade não há
 * fila, e enfileirar antes misturaria eventos de instalações. O envio segue as regras da
 * fila/remetente (`integracaoFila.ts`, `integracaoCanal.ts`).
 */
import { HUB_URL } from './config';
import * as cofre from './integracaoCofre';
import { enfileirarEventos } from './integracaoCanal';
import {
  eventosAgenda,
  eventosClientes,
  eventosEscopo,
  eventosPlanejamento,
  externalIdUsuario,
  montarEventos,
  type ClienteFonte,
  type EscopoFonte,
  type EventoAgendaFonte,
  type OrdemFonte,
  type PlanejamentoFonte,
  type ProjetoFonte,
  type TransicaoFonte,
} from './integracaoEventos';
import { validarEvento } from './integracaoValidacao';
import { logEvento } from './log';

const INTERVALO_MS = 15 * 60_000;
const PRIMEIRO_CICLO_MS = 60_000;

interface ClienteResumo {
  cliente: ClienteFonte;
  eventos?: EventoAgendaFonte[];
  agenda?: { ordens: OrdemFonte[]; tarefas: PlanejamentoFonte[] };
  erro?: string;
}

async function getJson<T>(caminho: string): Promise<T | null> {
  try {
    const r = await fetch(`${HUB_URL}${caminho}`, { signal: AbortSignal.timeout(60_000) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function meses(agora: Date): string[] {
  const mes = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const lista = [mes(agora)];
  if (agora.getDate() <= 7) lista.unshift(mes(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)));
  return lista;
}

interface Coleta {
  projetos: ProjetoFonte[];
  planejamentos: { projetoId: number; tarefas: PlanejamentoFonte[] }[];
  agenda: { cliente: ClienteFonte; eventos: EventoAgendaFonte[] }[];
}

/** Junta os meses do resumo por projeto/cliente, sem repetir OS, tarefa ou evento. */
async function coletarResumo(agora: Date): Promise<Coleta> {
  const projetos = new Map<number, ProjetoFonte>();
  const planejamentos = new Map<number, Map<number, PlanejamentoFonte>>();
  const agenda = new Map<number, { cliente: ClienteFonte; eventos: Map<number, EventoAgendaFonte> }>();
  for (const mes of meses(agora)) {
    const resumo = await getJson<{ clientes?: ClienteResumo[] }>(`/api/experience/resumo?mes=${mes}`);
    for (const c of resumo?.clientes ?? []) {
      const projetoId = c.cliente.experienceProjetoId;
      if (projetoId !== null && c.agenda) {
        const atual = projetos.get(projetoId) ?? { projetoId, nome: c.cliente.nome, ordens: [] };
        for (const o of c.agenda.ordens) if (!atual.ordens.some((x) => x.id === o.id)) atual.ordens.push(o);
        projetos.set(projetoId, atual);
        const plan = planejamentos.get(projetoId) ?? new Map<number, PlanejamentoFonte>();
        for (const t of c.agenda.tarefas ?? []) plan.set(t.id, t);
        planejamentos.set(projetoId, plan);
      }
      const ag = agenda.get(c.cliente.id) ?? { cliente: c.cliente, eventos: new Map<number, EventoAgendaFonte>() };
      for (const e of c.eventos ?? []) if (e.nuevento) ag.eventos.set(e.nuevento, e);
      agenda.set(c.cliente.id, ag);
    }
  }
  return {
    projetos: [...projetos.values()],
    planejamentos: [...planejamentos].map(([projetoId, m]) => ({ projetoId, tarefas: [...m.values()] })),
    agenda: [...agenda.values()].map((a) => ({ cliente: a.cliente, eventos: [...a.eventos.values()] })),
  };
}

async function coletarEscopos(clientes: ClienteFonte[]): Promise<EscopoFonte[]> {
  const escopos: EscopoFonte[] = [];
  for (const c of clientes) {
    const e = await getJson<Omit<EscopoFonte, 'clienteId'>>(`/api/clientes/${c.id}/escopo`);
    if (e) escopos.push({ clienteId: c.id, documentos: e.documentos ?? [], tarefas: e.tarefas ?? [] });
  }
  return escopos;
}

async function ciclo(obterEmail: () => string): Promise<void> {
  const cfg = cofre.estado();
  if (!cfg.temChave || !cfg.apiUrl || !cfg.installationId) return;
  const email = obterEmail();
  if (!email) return;

  const agora = new Date();
  const clientes = (await getJson<{ clientes?: ClienteFonte[] }>('/api/clientes'))?.clientes ?? [];
  const { projetos, planejamentos, agenda } = await coletarResumo(agora);
  const escopos = await coletarEscopos(clientes);
  const transicoes = (await getJson<{ transicoes?: TransicaoFonte[] }>('/api/escopo/transicoes'))?.transicoes ?? [];

  // Nome do consultor: o mesmo `person_name` que o cadastro usa, pelo primeiro projeto.
  const primeiro = projetos[0]?.projetoId;
  const eu = primeiro ? await getJson<{ nome?: string }>(`/api/experience/person-id?projetoId=${primeiro}`) : null;
  const usuarioId = externalIdUsuario(email);

  // `montarEventos` já abre com o `usuario.upsert`; a fila reordena pela dependência.
  const eventos = [
    ...montarEventos({ email, nome: eu?.nome ?? '' }, projetos, agora),
    ...eventosClientes(clientes, agora),
    ...eventosEscopo(usuarioId, escopos, transicoes, agora),
    ...eventosPlanejamento(usuarioId, planejamentos, agora),
    ...eventosAgenda(usuarioId, agenda, agora),
  ];
  // Um registro ruim (campo fora do contrato) não pode travar os outros: o lote inteiro
  // seria recusado na validação. Descarta só o inválido e registra por tipo, sem conteúdo.
  const validos = [];
  const descartados: Record<string, number> = {};
  for (const e of eventos) {
    try {
      validarEvento(e);
      validos.push(e);
    } catch {
      descartados[e.type] = (descartados[e.type] ?? 0) + 1;
    }
  }
  if (Object.keys(descartados).length) logEvento('integracao-eventos-descartados', descartados);
  try {
    const novos = enfileirarEventos(validos);
    if (novos) logEvento('integracao-eventos-enfileirados', { novos, total: validos.length });
  } catch (err) {
    logEvento('integracao-enfileirar-falhou', { erro: String((err as Error).message ?? err).slice(0, 200) });
  }
}

/** Liga o ciclo. `obterEmail` devolve o e-mail da sessão Experience capturada (ou vazio). */
export function iniciarAdaptadores(obterEmail: () => string): () => void {
  let rodando = false;
  const executar = () => {
    if (rodando) return;
    rodando = true;
    void ciclo(obterEmail).finally(() => {
      rodando = false;
    });
  };
  const primeiro = setTimeout(executar, PRIMEIRO_CICLO_MS);
  const timer = setInterval(executar, INTERVALO_MS);
  timer.unref();
  return () => {
    clearTimeout(primeiro);
    clearInterval(timer);
  };
}
