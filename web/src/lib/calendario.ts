import type { AgendaExperience, OrdemExperience, TarefaExperience } from '../types.ts';

export interface DiaAgenda {
  /** `YYYY-MM-DD`. */
  dia: string;
  numero: number;
  doMes: boolean;
  hoje: boolean;
  tarefas: TarefaExperience[];
  ordens: OrdemExperience[];
  /** Tem tarefa marcada como Atrasada, ou OS vencida sem aceite. */
  atrasado: boolean;
}

export const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/** `YYYY-MM-DD` de hoje no fuso local — `toISOString()` daria o dia em UTC. */
export function hojeIso(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

export function mesAtual(): string {
  return hojeIso().slice(0, 7);
}

/** Soma meses a um `YYYY-MM`, virando o ano quando passa de dezembro. */
export function deslocarMes(mes: string, passo: number): string {
  const [ano, numero] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano!, numero! - 1 + passo, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function nomeDoMes(mes: string): string {
  const [ano, numero] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano!, numero! - 1, 1));
  const nome = data.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  // Só a inicial: `text-transform: capitalize` no CSS pegaria o "de" também.
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/**
 * A OS não teve aceite nenhum gerado — o único estado que depende de você.
 *
 * Valores observados em `accepted_os_status`: `Gerado` (foi para o cliente aprovar) e
 * `Concluído` (aprovado). Os dois são desfecho, não pendência: tratar "diferente de
 * Gerado" como pendente marcava como atrasada justamente a OS já aprovada.
 */
export function semAceite(ordem: OrdemExperience): boolean {
  return ordem.statusAceite.trim() === '';
}

/** Trabalho de dia passado que ainda não foi mandado para aprovação. */
function ordemPendente(ordem: OrdemExperience, hoje: string): boolean {
  return ordem.dia < hoje && semAceite(ordem);
}

export type StatusCliente = 'ok' | 'atencao' | 'atraso';

export interface ResumoMes {
  status: StatusCliente;
  tarefas: number;
  tarefasAtrasadas: number;
  ordens: number;
  /** Dias passados com tarefa e nenhuma OS lançada — trabalho que não virou fatura. */
  diasSemOs: number;
  diasComAtuacao: number;
}

/**
 * O resumo do mês de um cliente, derivado da MESMA grade que o calendário desenha.
 *
 * Calculado aqui e não no backend de propósito: a regra de atraso já mora neste
 * arquivo, e uma segunda implementação do outro lado sairia do ar com a primeira na
 * próxima vez que um valor de `accepted_os_status` nos surpreendesse — que foi
 * exatamente o que aconteceu com `Concluído`.
 */
export function resumirMes(mes: string, agenda: AgendaExperience): ResumoMes {
  const hoje = hojeIso();
  const dias = montarGrade(mes, agenda).filter((d) => d.doMes);

  const diasSemOs = dias.filter(
    (d) => d.dia < hoje && d.tarefas.length > 0 && d.ordens.length === 0,
  ).length;

  const tarefasAtrasadas = dias.reduce(
    (soma, d) => soma + d.tarefas.filter((t) => t.taskStatus === 'Atrasada').length,
    0,
  );
  const ordensSemAceite = dias.reduce(
    (soma, d) => soma + d.ordens.filter((o) => o.dia < hoje && semAceite(o)).length,
    0,
  );

  return {
    // Vermelho é o que já estourou; amarelo é trabalho feito que ainda não virou OS.
    status:
      tarefasAtrasadas > 0 || ordensSemAceite > 0 ? 'atraso' : diasSemOs > 0 ? 'atencao' : 'ok',
    tarefas: dias.reduce((soma, d) => soma + d.tarefas.length, 0),
    tarefasAtrasadas,
    ordens: dias.reduce((soma, d) => soma + d.ordens.length, 0),
    diasSemOs,
    diasComAtuacao: dias.filter((d) => d.tarefas.length > 0 || d.ordens.length > 0).length,
  };
}

/**
 * A grade do mês, sempre em semanas inteiras de domingo a sábado — as sobras do mês
 * anterior e do seguinte entram apagadas para a grade não ficar com buracos.
 */
export function montarGrade(mes: string, agenda: AgendaExperience): DiaAgenda[] {
  const hoje = hojeIso();
  const [ano, numero] = mes.split('-').map(Number);

  const primeiro = new Date(Date.UTC(ano!, numero! - 1, 1));
  const inicio = new Date(primeiro);
  inicio.setUTCDate(inicio.getUTCDate() - primeiro.getUTCDay());

  const porDiaTarefa = new Map<string, TarefaExperience[]>();
  for (const tarefa of agenda.tarefas) {
    if (!tarefa.dia) continue;
    porDiaTarefa.set(tarefa.dia, [...(porDiaTarefa.get(tarefa.dia) ?? []), tarefa]);
  }

  const porDiaOrdem = new Map<string, OrdemExperience[]>();
  for (const ordem of agenda.ordens) {
    if (!ordem.dia) continue;
    porDiaOrdem.set(ordem.dia, [...(porDiaOrdem.get(ordem.dia) ?? []), ordem]);
  }

  const grade: DiaAgenda[] = [];
  for (let i = 0; i < 42; i += 1) {
    const data = new Date(inicio);
    data.setUTCDate(inicio.getUTCDate() + i);

    const dia = data.toISOString().slice(0, 10);
    const tarefas = porDiaTarefa.get(dia) ?? [];
    const ordens = porDiaOrdem.get(dia) ?? [];

    grade.push({
      dia,
      numero: data.getUTCDate(),
      doMes: dia.slice(0, 7) === mes,
      hoje: dia === hoje,
      tarefas,
      ordens,
      atrasado:
        tarefas.some((t) => t.taskStatus === 'Atrasada') ||
        ordens.some((o) => ordemPendente(o, hoje)),
    });

    // Seis semanas cobrem qualquer mês, mas a última costuma sobrar inteira — cortar
    // assim que o mês acabou evita uma linha vazia no fim.
    if (i % 7 === 6 && dia.slice(0, 7) > mes) break;
  }

  return grade;
}
