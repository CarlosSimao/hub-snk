/**
 * Regras do lançamento de OS na Experience que não dependem da rede: validação dos
 * horários e o corpo do `POST /orders`, no mesmo formato que a tela da Experience manda
 * (capturado do navegador em 2026-10-15).
 */

export const TIPOS_DE_OS = ['CONFORMIDADE', 'NAO_CONFORMIDADE', 'COMPLEMENTAR'] as const;
export type TipoDeOs = (typeof TIPOS_DE_OS)[number];

/** O mesmo marcador que `extrairObservacoes` procura ao ler a OS de volta. */
export const MARCADOR_DE_OBSERVACOES = '--- Informações Adicionais ---';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTOS_POR_HORA = 60;

export interface HorariosDaOs {
  horaInicio: string;
  horaFim: string;
  intervalo: string;
}

function emMinutos(hora: string): number {
  return Number(hora.slice(0, 2)) * MINUTOS_POR_HORA + Number(hora.slice(3, 5));
}

/** As mesmas recusas da tela da Experience. `null` quando está tudo certo. */
export function validarHorariosDaOs({
  horaInicio,
  horaFim,
  intervalo,
}: HorariosDaOs): string | null {
  if (![horaInicio, horaFim, intervalo].every((hora) => HORA.test(hora))) {
    return 'Informe início, fim e intervalo no formato HH:MM.';
  }
  const duracao = emMinutos(horaFim) - emMinutos(horaInicio);
  if (duracao <= 0) {
    return 'A hora inicial tem que ser antes da hora final.';
  }
  if (emMinutos(intervalo) >= duracao) {
    return 'O intervalo tem que ser menor que o tempo entre o início e o fim.';
  }
  return null;
}

/** Etapa e processos (vindos da Experience) em cima, o texto digitado depois do marcador. */
export function montarInformacoesAdicionais(
  observacoesDaTarefa: string,
  tarefasRealizadas: string,
): string {
  return `${observacoesDaTarefa}\n${MARCADOR_DE_OBSERVACOES}\n${tarefasRealizadas.trim()}`;
}

export function montarCorpoDaOs(parametros: {
  implantationId: number;
  personId: number;
  dia: string;
  horarios: HorariosDaOs;
  informacoesAdicionais: string;
  tipo: TipoDeOs;
  /** As linhas de `/tasks/filtering` como vieram, com as horas de `/tasks/work_hours`. */
  tarefas: Record<string, unknown>[];
}): Record<string, unknown> {
  const { implantationId, personId, dia, horarios, informacoesAdicionais, tipo, tarefas } =
    parametros;
  return {
    implantation_id: implantationId,
    person_id: personId,
    date_done: dia,
    hour_to_start: horarios.horaInicio,
    hour_to_finish: horarios.horaFim,
    hour_to_lunch: horarios.intervalo,
    additional_information: informacoesAdicionais,
    additional_notes: '',
    tasks: tarefas,
    order_type: tipo,
    order_email_observation: false,
    assessment_data: null,
  };
}
