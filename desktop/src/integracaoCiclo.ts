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
import { join } from 'node:path';
import { app } from 'electron';
import { HUB_URL } from './config';
import { gravarJson, lerJson } from './integracaoArquivo';
import * as cofre from './integracaoCofre';
import { enfileirarEventos } from './integracaoCanal';
import {
  agendaInativada,
  eventosAgenda,
  eventosAgendaPainel,
  eventosClientes,
  eventosClientesAutomaticos,
  eventosDemandasErp,
  eventosEscopo,
  eventosPlanejamento,
  externalIdUsuario,
  montarEventos,
  type AgendaPainelFonte,
  type ClienteFonte,
  type EscopoFonte,
  type EventoAgendaFonte,
  type OrdemFonte,
  type PlanejamentoFonte,
  type ProjetoFonte,
  type SolicitacaoFonte,
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
  /** Solicitações de Serviços DS das demandas do cliente (snapshot do hub). */
  solicitacoes?: SolicitacaoFonte[];
  /** Parceiro do cliente: o do cadastro ou o achado pelo nome. */
  codparc?: number | null;
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
  demandasErp: { clienteId: number; solicitacoes: SolicitacaoFonte[] }[];
  codparcs: Map<number, number>;
}

/** Junta os meses do resumo por projeto/cliente, sem repetir OS, tarefa ou evento. */
async function coletarResumo(agora: Date): Promise<Coleta> {
  const projetos = new Map<number, ProjetoFonte>();
  const planejamentos = new Map<number, Map<number, PlanejamentoFonte>>();
  const agenda = new Map<number, { cliente: ClienteFonte; eventos: Map<number, EventoAgendaFonte> }>();
  const demandasErp = new Map<number, Map<number, SolicitacaoFonte>>();
  const codparcs = new Map<number, number>();
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
      // Cadastro sem parceiro usa o achado pelo nome no hub: sem ele a agenda do cliente
      // não sairia (o receptor localiza o cliente da agenda pelo código do parceiro).
      const clienteAgenda = { ...c.cliente, agendaCodparc: c.cliente.agendaCodparc ?? c.codparc ?? null };
      const ag = agenda.get(c.cliente.id) ?? { cliente: clienteAgenda, eventos: new Map<number, EventoAgendaFonte>() };
      for (const e of c.eventos ?? []) if (e.nuevento) ag.eventos.set(e.nuevento, e);
      agenda.set(c.cliente.id, ag);
      if (c.codparc) codparcs.set(c.cliente.id, c.codparc);
      const sol = demandasErp.get(c.cliente.id) ?? new Map<number, SolicitacaoFonte>();
      for (const s of c.solicitacoes ?? []) sol.set(s.codigo, s);
      demandasErp.set(c.cliente.id, sol);
    }
  }
  return {
    projetos: [...projetos.values()],
    planejamentos: [...planejamentos].map(([projetoId, m]) => ({ projetoId, tarefas: [...m.values()] })),
    agenda: [...agenda.values()].map((a) => ({ cliente: a.cliente, eventos: [...a.eventos.values()] })),
    demandasErp: [...demandasErp].map(([clienteId, m]) => ({ clienteId, solicitacoes: [...m.values()] })),
    codparcs,
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

/* ------------------------- dashboards v1.1: agenda completa ------------------------- */

const dataIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Do primeiro dia do mes anterior ao ultimo do segundo mes seguinte (contrato v1.1, 3.4). */
export function janelaPainel(agora: Date): { de: string; ate: string } {
  return {
    de: dataIso(new Date(agora.getFullYear(), agora.getMonth() - 1, 1)),
    ate: dataIso(new Date(agora.getFullYear(), agora.getMonth() + 3, 0)),
  };
}

interface Painel {
  usuario: string;
  cargo: string;
  clientes: { id: number; codparc: number | null }[];
  eventos: AgendaPainelFonte[];
}

/** O ultimo conteudo enviado de cada agendamento — base do `active: false` quando ele some. */
const arquivoAgendaEnviada = () => join(app.getPath('userData'), 'integracao-agenda-enviada.json');

/**
 * So inativa quando o snapshot da agenda e confiavel: importado ha pouco e nao vazio.
 * Um snapshot vazio por falha de leitura do ERP inativaria a agenda inteira do receptor.
 */
async function snapshotConfiavel(eventos: number): Promise<boolean> {
  if (!eventos) return false;
  const estado = await getJson<{ importadoEm?: number | null }>('/api/agenda');
  return Boolean(estado?.importadoEm && Date.now() - estado.importadoEm < 8 * 60 * 60 * 1000);
}

async function ciclo(obterEmail: () => string): Promise<void> {
  const cfg = cofre.estado();
  if (!cfg.temChave || !cfg.apiUrl || !cfg.installationId) return;
  const email = obterEmail();
  if (!email) return;

  const agora = new Date();
  const clientes = (await getJson<{ clientes?: ClienteFonte[] }>('/api/clientes'))?.clientes ?? [];
  const { projetos, planejamentos, agenda, demandasErp, codparcs } = await coletarResumo(agora);
  const janela = janelaPainel(agora);
  const painel = cfg.painelV11
    ? await getJson<Painel>(`/api/integracao/painel?de=${janela.de}&ate=${janela.ate}`)
    : null;
  const escopos = await coletarEscopos(clientes);
  const transicoes = (await getJson<{ transicoes?: TransicaoFonte[] }>('/api/escopo/transicoes'))?.transicoes ?? [];

  // Nome do consultor: o mesmo `person_name` que o cadastro usa, pelo primeiro projeto.
  const primeiro = projetos[0]?.projetoId;
  const eu = primeiro ? await getJson<{ nome?: string }>(`/api/experience/person-id?projetoId=${primeiro}`) : null;
  const usuarioId = externalIdUsuario(email);

  // Demanda da OS nas horas: campo novo do contrato, só com o interruptor ligado. As
  // demandas vão como demanda.upsert no mesmo ciclo, e só a OS de uma delas leva o vínculo.
  const demandas = cfg.demandasNasHoras ? eventosDemandasErp(demandasErp, agora, cfg.painelV11) : [];
  const demandasEnviadas = cfg.demandasNasHoras
    ? new Set(demandas.map((e) => String(e.data['externalId']).replace(/^erp-demanda-/, '')))
    : undefined;

  // `montarEventos` já abre com o `usuario.upsert`; a fila reordena pela dependência.
  // Com a v1.1 ligada a agenda sai completa (todo o consultor, janela de 4 meses) pelo
  // `/api/integracao/painel`; desligada, sai como sempre saiu, pelo resumo do mes.
  let agendaEventos: ReturnType<typeof eventosAgenda> = [];
  let automaticos: ReturnType<typeof eventosClientesAutomaticos> = [];
  let inativos: ReturnType<typeof agendaInativada> = [];
  let agendaParaGuardar: Record<string, Record<string, unknown>> | null = null;
  if (painel) {
    for (const c of painel.clientes) if (c.codparc) codparcs.set(c.id, c.codparc);
    agendaEventos = eventosAgendaPainel(usuarioId, painel.eventos, agora, demandasEnviadas);
    automaticos = eventosClientesAutomaticos(painel.eventos, new Set(codparcs.values()), agora);

    let anteriores: Record<string, Record<string, unknown>> = {};
    try {
      anteriores = lerJson(arquivoAgendaEnviada(), {});
    } catch {
      anteriores = {};
    }
    const atuais = new Set(agendaEventos.map((e) => String(e.data['externalId'])));
    if (await snapshotConfiavel(painel.eventos.length)) inativos = agendaInativada(anteriores, atuais, janela, agora);
    agendaParaGuardar = { ...anteriores };
    for (const e of [...agendaEventos, ...inativos]) agendaParaGuardar[String(e.data['externalId'])] = e.data;
  } else {
    agendaEventos = eventosAgenda(usuarioId, agenda, agora, demandasEnviadas);
  }

  // `montarEventos` já abre com o `usuario.upsert`; a fila reordena pela dependência.
  const consultor = { email, nome: eu?.nome ?? '', cargo: painel?.cargo ?? '', equipe: cfg.equipe ?? '' };
  const eventos = [
    ...montarEventos(consultor, projetos, agora, demandasEnviadas, cfg.painelV11),
    ...demandas,
    ...eventosClientes(clientes, agora, codparcs),
    ...automaticos,
    ...eventosEscopo(usuarioId, escopos, transicoes, agora),
    ...eventosPlanejamento(usuarioId, planejamentos, agora),
    ...agendaEventos,
    ...inativos,
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
    // So depois de enfileirar: guardar antes faria o proximo ciclo achar que ja mandou.
    if (agendaParaGuardar) {
      gravarJson(arquivoAgendaEnviada(), agendaParaGuardar);
      if (inativos.length) logEvento('integracao-agenda-inativada', { total: inativos.length });
    }
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
