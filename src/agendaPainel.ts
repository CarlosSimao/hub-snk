/**
 * O que o painel de lideranças precisa de cada agendamento, além do que a agenda já
 * traz (contrato de dashboards v1.1): categoria, minutos previstos e as OS do dia.
 *
 * Puro: recebe o snapshot da agenda e as OS já lidas e só calcula.
 */
import type { EventoComRecurso, OrdemExperience } from './types.ts';

export type CategoriaAgenda = 'CLIENTE' | 'AUSENCIA' | 'INTERNO';

/** Jornada de um dia útil: a OS de dia inteiro é de 8 h, e a janela da agenda é 08–18 com 1 h de intervalo. */
export const MINUTOS_JORNADA = 480;

const AUSENCIA = /f[ée]rias|atestado|particular|folga|licen[çc]a|feriado|aus[êe]ncia|m[ée]dic|abono|luto|recesso/i;

/**
 * Agendamento com parceiro é atendimento. Sem parceiro, é ausência quando o título diz
 * (férias, atestado, particular...) e compromisso interno no resto (treinamento, reunião).
 */
export function categoriaDoEvento(e: Pick<EventoComRecurso, 'nomeparc' | 'codparc' | 'descrabrev' | 'descrlonga'>): CategoriaAgenda {
  if (e.codparc && e.nomeparc.trim()) return 'CLIENTE';
  return AUSENCIA.test(`${e.descrabrev} ${e.descrlonga}`) ? 'AUSENCIA' : 'INTERNO';
}

function minutosDoDia(hhmm: string): number {
  const m = /(\d{2}):(\d{2})/.exec(hhmm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** Dias (`YYYY-MM-DD`) que o evento cobre, de `inicio` a `fim`. */
export function diasDoEvento(inicio: string, fim: string): string[] {
  const dias: string[] = [];
  const d = new Date(`${inicio.slice(0, 10)}T12:00:00Z`);
  const ultimo = fim.slice(0, 10);
  for (let i = 0; i < 400; i += 1) {
    const dia = d.toISOString().slice(0, 10);
    if (dia > ultimo) break;
    dias.push(dia);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dias;
}

const diaUtil = (dia: string) => {
  const s = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return s !== 0 && s !== 6;
};

/**
 * Minutos de trabalho previstos: ausência não prevê trabalho; dia inteiro (ou janela de
 * 9 h ou mais) vale a jornada; período menor vale a própria duração, até a jornada.
 * Evento de vários dias conta cada dia útil que cobre (feriado o DS não conhece — o
 * painel desconta pelo calendário dele).
 */
export function minutosPrevistos(
  e: Pick<EventoComRecurso, 'inicio' | 'fim' | 'allday'>,
  categoria: CategoriaAgenda,
): number {
  if (categoria === 'AUSENCIA') return 0;
  const dias = diasDoEvento(e.inicio, e.fim);
  const inteiro = e.allday === 'S' || e.allday === 'true';
  const janela = minutosDoDia(e.fim.slice(11)) - minutosDoDia(e.inicio.slice(11));
  const porDia = inteiro || janela >= 9 * 60 ? MINUTOS_JORNADA : Math.max(0, Math.min(janela, MINUTOS_JORNADA));
  if (dias.length === 1) return porDia;
  return dias.filter(diaUtil).length * porDia;
}

/** As OS do mesmo cliente nos dias que o agendamento cobre. */
export function osDoEvento(
  e: Pick<EventoComRecurso, 'inicio' | 'fim'>,
  ordens: Pick<OrdemExperience, 'dia' | 'horasFeitas'>[],
): { qtd: number; minutos: number } {
  const dias = new Set(diasDoEvento(e.inicio, e.fim));
  const doEvento = ordens.filter((o) => dias.has(o.dia));
  // Duração da OS em `HH:MM`, podendo passar de 99 horas — não é hora do dia.
  const duracao = (t: string) => {
    const m = /^(\d+):([0-5]\d)$/.exec((t ?? '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
  };
  return { qtd: doEvento.length, minutos: doEvento.reduce((soma, o) => soma + duracao(o.horasFeitas), 0) };
}
