import type {
  AgendaExperience,
  EventoComRecurso,
  OrdemExperience,
  TarefaExperience,
} from './types.ts';

/**
 * O que os dois sistemas dizem, juntos, sobre um dia.
 *
 * A Agenda de Recursos diz onde voce FOI alocado; a Experience diz o que voce
 * REGISTROU. Divergencia entre os dois e justamente o que ninguem ve olhando um
 * sistema de cada vez — e o motivo de existir esta tela.
 *
 *  - `alocado-sem-os`: dia passado com evento no ERP e nenhuma OS. Trabalho feito
 *    que nao virou fatura. E o achado que paga a tela.
 *  - `os-sem-alocacao`: OS num dia sem evento na agenda. Nao e erro por si so —
 *    pode ser trabalho remoto nao agendado — mas vale aparecer.
 *  - `casado`: os dois lados concordam.
 *  - `so-experience` / `so-erp`: um lado tem algo e o outro nada a dizer (dia
 *    futuro, tarefa em aberto), sem contradicao ainda.
 *  - `vazio`: nenhum dos dois tem nada.
 */
export type Cruzamento =
  | 'vazio'
  | 'casado'
  | 'alocado-sem-os'
  | 'os-sem-alocacao'
  | 'so-experience'
  | 'so-erp';

export interface DiaAgenda {
  /** `YYYY-MM-DD`. */
  dia: string;
  numero: number;
  doMes: boolean;
  hoje: boolean;
  tarefas: TarefaExperience[];
  ordens: OrdemExperience[];
  /** Eventos da Agenda de Recursos do ERP que cobrem este dia. */
  eventos: EventoComRecurso[];
  /** Tem tarefa marcada como Atrasada, ou OS vencida sem aceite. */
  atrasado: boolean;
  /** O veredito do dia olhando os dois sistemas. */
  cruzamento: Cruzamento;
}

/**
 * Cruza os dois lados de um dia.
 *
 * So o passado vira cobranca: um dia futuro com evento e agenda normal, nao OS que
 * faltou. Por isso `hoje` entra — sem ele, todo dia alocado do resto do mes apareceria
 * como pendencia no instante em que a agenda fosse importada.
 */
export function cruzarDia(
  dia: { dia: string; eventos: unknown[]; ordens: unknown[]; tarefas: unknown[] },
  hoje: string,
): Cruzamento {
  const temEvento = dia.eventos.length > 0;
  const temOrdem = dia.ordens.length > 0;
  const temTarefa = dia.tarefas.length > 0;
  const passado = dia.dia < hoje;

  if (temEvento && temOrdem) return 'casado';
  if (temEvento && passado) return 'alocado-sem-os';
  if (temOrdem && !temEvento) return 'os-sem-alocacao';
  if (temEvento) return 'so-erp';
  if (temTarefa) return 'so-experience';
  return 'vazio';
}

/** Rotulo curto de cada cruzamento, para legenda e para o `title` do dia. */
export const ROTULO_CRUZAMENTO: Record<Cruzamento, string> = {
  vazio: 'sem nada',
  casado: 'alocado e com OS',
  'alocado-sem-os': 'alocado sem OS',
  'os-sem-alocacao': 'OS sem alocação',
  'so-experience': 'só na Experience',
  'so-erp': 'só na agenda do ERP',
};

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
 * Valores observados em `accepted_os_status`: `Gerado` (foi para o cliente aprovar),
 * `Concluído` (aprovado) e **`Aceite não gerado`**. Os dois primeiros são desfecho, não
 * pendência: tratar "diferente de Gerado" como pendente marcava como atrasada
 * justamente a OS já aprovada.
 *
 * O terceiro foi medido depois (projeto 10269, OS de 16/09/2026) e é o caso que importa:
 * a regra só olhava string VAZIA, então uma OS que a Experience rotula explicitamente
 * como sem aceite passava batida — nem no calendário, nem no aviso por e-mail.
 */
export function semAceite(ordem: OrdemExperience): boolean {
  const status = ordem.statusAceite.trim().toLowerCase();
  if (!status) return true;
  // Com e sem acento: o rótulo vem da API e não é contrato nosso.
  return status.includes('não gerado') || status.includes('nao gerado');
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
  /** Dias passados alocados na Agenda do ERP e sem OS na Experience. */
  diasAlocadosSemOs: number;
  /** Dias com OS lançada fora de qualquer alocação da Agenda do ERP. */
  diasOsSemAlocacao: number;
  /** Dias em que os dois sistemas concordam. */
  diasCasados: number;
}

/**
 * O resumo do mês de um cliente, derivado da MESMA grade que o calendário desenha.
 *
 * Calculado aqui e não no backend de propósito: a regra de atraso já mora neste
 * arquivo, e uma segunda implementação do outro lado sairia do ar com a primeira na
 * próxima vez que um valor de `accepted_os_status` nos surpreendesse — que foi
 * exatamente o que aconteceu com `Concluído`.
 */
export function resumirMes(
  mes: string,
  agenda: AgendaExperience,
  eventos: EventoComRecurso[] = [],
  /** Injetável só para teste — ver `montarGrade`. */
  hoje: string = hojeIso(),
): ResumoMes {
  const dias = montarGrade(mes, agenda, eventos, hoje).filter((d) => d.doMes);
  const contar = (c: Cruzamento) => dias.filter((d) => d.cruzamento === c).length;
  const diasAlocadosSemOs = contar('alocado-sem-os');

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
    // Vermelho é o que já estourou; amarelo é trabalho feito que ainda não virou OS —
    // e um dia alocado no ERP sem OS conta como o mesmo tipo de pendência, porque é
    // exatamente isso: dia trabalhado que ninguém faturou.
    status:
      tarefasAtrasadas > 0 || ordensSemAceite > 0
        ? 'atraso'
        : diasSemOs > 0 || diasAlocadosSemOs > 0
          ? 'atencao'
          : 'ok',
    tarefas: dias.reduce((soma, d) => soma + d.tarefas.length, 0),
    tarefasAtrasadas,
    ordens: dias.reduce((soma, d) => soma + d.ordens.length, 0),
    diasSemOs,
    diasComAtuacao: dias.filter(
      (d) => d.tarefas.length > 0 || d.ordens.length > 0 || d.eventos.length > 0,
    ).length,
    diasAlocadosSemOs,
    diasOsSemAlocacao: contar('os-sem-alocacao'),
    diasCasados: contar('casado'),
  };
}

/* ------------------------ a agenda de todos os clientes ------------------- */

/** Um cliente com o que os dois sistemas sabem dele no mês. */
export interface AgendaDeCliente {
  cliente: { id: number; nome: string };
  agenda?: AgendaExperience;
  eventos?: EventoComRecurso[];
  erro?: string;
}

/**
 * O que um cliente tem num dia da visão consolidada.
 *
 * `vazio` está fora do tipo de propósito: uma fatia só existe quando há algo, e um dia
 * sem nada simplesmente não lista o cliente.
 */
export interface FatiaDoDia {
  clienteId: number;
  nome: string;
  tarefas: number;
  ordens: number;
  eventos: number;
  cruzamento: Exclude<Cruzamento, 'vazio'>;
}

export interface DiaConsolidado {
  dia: string;
  numero: number;
  doMes: boolean;
  hoje: boolean;
  /** Só os clientes que têm algo neste dia, em ordem alfabética. */
  clientes: FatiaDoDia[];
}

/**
 * A grade do mês com TODOS os clientes de uma vez.
 *
 * Diferente de `montarGrade`, que é de um cliente só: aqui o dia é a unidade e os
 * clientes são o conteúdo dele. É a visão que responde "o que eu fiz este mês", que
 * olhando um cliente de cada vez exige somar de cabeça.
 */
export function montarGradeConsolidada(
  mes: string,
  linhas: AgendaDeCliente[],
  hoje: string = hojeIso(),
): DiaConsolidado[] {
  // Cada cliente vira a grade dele, e depois as grades são costuradas por dia. Reusar
  // `montarGrade` mantém UMA definição de "o que é um dia" e de cruzamento — duas
  // implementações sairiam do ar uma com a outra no primeiro ajuste de regra.
  const porCliente = linhas.map((linha) => ({
    linha,
    grade: montarGrade(mes, linha.agenda ?? { tarefas: [], ordens: [] }, linha.eventos ?? [], hoje),
  }));

  // O molde sai de uma grade VAZIA, não da do primeiro cliente: assim a sequência de
  // dias não depende de quem apareceu primeiro na lista, nem de a lista estar vazia.
  const molde = montarGrade(mes, { tarefas: [], ordens: [] }, [], hoje);

  return molde.map((dia, i) => ({
    dia: dia.dia,
    numero: dia.numero,
    doMes: dia.doMes,
    hoje: dia.hoje,
    clientes: porCliente
      .map(({ linha, grade }): FatiaDoDia | null => {
        const doCliente = grade[i];
        if (!doCliente || doCliente.cruzamento === 'vazio') return null;
        return {
          clienteId: linha.cliente.id,
          nome: linha.cliente.nome,
          tarefas: doCliente.tarefas.length,
          ordens: doCliente.ordens.length,
          eventos: doCliente.eventos.length,
          cruzamento: doCliente.cruzamento,
        };
      })
      .filter((c): c is FatiaDoDia => c !== null)
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
  }));
}

/**
 * A grade do mês, sempre em semanas inteiras de domingo a sábado — as sobras do mês
 * anterior e do seguinte entram apagadas para a grade não ficar com buracos.
 */
export function montarGrade(
  mes: string,
  agenda: AgendaExperience,
  eventos: EventoComRecurso[] = [],
  /** Injetável só para teste: a regra de "passado" não pode depender do relógio real. */
  hoje: string = hojeIso(),
): DiaAgenda[] {
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
    // Evento do ERP pode durar vários dias (férias): entra em TODO dia que ele cobre,
    // e não só no que começa — por isso a comparação é de intervalo, não de igualdade.
    const doDia = eventos.filter((e) => e.inicio <= `${dia} 23:59:59` && e.fim >= `${dia} 00:00:00`);

    grade.push({
      dia,
      numero: data.getUTCDate(),
      doMes: dia.slice(0, 7) === mes,
      hoje: dia === hoje,
      tarefas,
      ordens,
      eventos: doDia,
      atrasado:
        tarefas.some((t) => t.taskStatus === 'Atrasada') ||
        ordens.some((o) => ordemPendente(o, hoje)),
      cruzamento: cruzarDia({ dia, tarefas, ordens, eventos: doDia }, hoje),
    });

    // Seis semanas cobrem qualquer mês, mas a última costuma sobrar inteira — cortar
    // assim que o mês acabou evita uma linha vazia no fim.
    if (i % 7 === 6 && dia.slice(0, 7) > mes) break;
  }

  return grade;
}

/**
 * Primeiro e ultimo dia de um mes `YYYY-MM`.
 *
 * Mora aqui junto das outras contas de mes porque quem levanta pendencias precisa dela
 * tanto quanto a rota da agenda — e `2026-09-31`, que parecia inofensivo, faz a
 * Experience responder HTTP 500.
 */
export function limitesDoMes(mes: string): { de: string; ate: string } | null {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!partes) return null;

  const ano = Number(partes[1]);
  const numeroMes = Number(partes[2]);
  if (numeroMes < 1 || numeroMes > 12) return null;

  // Dia 0 do mes seguinte e o ultimo dia deste — evita tabela de dias e ano bissexto.
  const ultimo = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` };
}
