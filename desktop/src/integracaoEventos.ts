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
export function montarEventos(consultor: ConsultorFonte, projetos: ProjetoFonte[], agora: Date): EventoApi[] {
  if (!consultor.email) return [];
  const occurredAt = agora.toISOString();
  const usuarioId = externalIdUsuario(consultor.email);
  const nome = corte(consultor.nome || consultor.email, 180);
  const email = consultor.email.trim().toLowerCase();

  const eventos: EventoApi[] = [
    {
      id: `usuario:${usuarioId}:${hash8(nome, email, true)}`.slice(0, 120),
      type: 'usuario.upsert',
      occurredAt,
      data: { externalId: usuarioId, name: nome, ...(email.length <= 254 ? { email } : {}), active: true },
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
      eventos.push({
        id: `horas:${ordem.id}:${hash8(min, descricao, dia)}`,
        type: 'horas.apontar',
        occurredAt,
        data: {
          externalId: `exp-os-${ordem.id}`,
          osExternalId: osId,
          userExternalId: usuarioId,
          minutes: min,
          ...(descricao ? { description: descricao } : {}),
          ...(dia ? { startedAt: `${dia}T00:00:00.000Z` } : {}),
        },
      });
    }
  }
  return eventos;
}
