/**
 * Ciclo dos adaptadores: lê do backend o que a Experience já tem e enfileira os eventos.
 *
 * Fonte: `/api/experience/resumo`, a mesma da visão mensal. Ela já traz, por cliente
 * cadastrado com ID de projeto e `person_id`, só as OS do PRÓPRIO consultor e os totais
 * do projeto — o recorte que uma instalação deve enviar. O mês anterior entra na
 * primeira semana, para uma OS lançada com atraso no fim do mês não ficar de fora.
 *
 * Só roda com a integração configurada (URL, instalação e chave). Sem isso não há
 * identidade para a fila, e enfileirar agora misturaria eventos de instalações.
 */
import { HUB_URL } from './config';
import * as cofre from './integracaoCofre';
import { enfileirarEventos } from './integracaoCanal';
import { montarEventos, type OrdemFonte, type ProjetoFonte } from './integracaoEventos';
import { logEvento } from './log';

const INTERVALO_MS = 15 * 60_000;
const PRIMEIRO_CICLO_MS = 60_000;

interface ClienteResumo {
  cliente: { nome: string; experienceProjetoId: number | null };
  agenda?: { ordens: OrdemFonte[] };
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

async function coletarProjetos(agora: Date): Promise<ProjetoFonte[]> {
  const porProjeto = new Map<number, ProjetoFonte>();
  for (const mes of meses(agora)) {
    const resumo = await getJson<{ clientes?: ClienteResumo[] }>(`/api/experience/resumo?mes=${mes}`);
    for (const c of resumo?.clientes ?? []) {
      const projetoId = c.cliente.experienceProjetoId;
      if (projetoId === null || !c.agenda) continue;
      const atual = porProjeto.get(projetoId) ?? { projetoId, nome: c.cliente.nome, ordens: [] };
      atual.ordens.push(...c.agenda.ordens);
      porProjeto.set(projetoId, atual);
    }
  }
  return [...porProjeto.values()];
}

async function ciclo(obterEmail: () => string): Promise<void> {
  const cfg = cofre.estado();
  if (!cfg.temChave || !cfg.apiUrl || !cfg.installationId) return;
  const email = obterEmail();
  if (!email) return;

  const agora = new Date();
  const projetos = await coletarProjetos(agora);
  if (!projetos.length) return;

  // Nome do consultor: o mesmo `person_name` que o cadastro usa, pelo primeiro projeto.
  const eu = await getJson<{ nome?: string }>(`/api/experience/person-id?projetoId=${projetos[0]!.projetoId}`);
  const eventos = montarEventos({ email, nome: eu?.nome ?? '' }, projetos, agora);
  try {
    const novos = enfileirarEventos(eventos);
    if (novos) logEvento('integracao-eventos-enfileirados', { novos, projetos: projetos.length });
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
