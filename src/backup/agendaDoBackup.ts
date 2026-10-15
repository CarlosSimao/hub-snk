import type { ConfiguracaoDeBackup } from '../tipos.ts';

export type AgendaDoBackup = Pick<
  ConfiguracaoDeBackup,
  'frequencia' | 'horario' | 'diaDaSemana' | 'diaDoMes'
>;

const DIAS_DA_SEMANA = 7;

/**
 * O último horário agendado até `agora`, na hora local: o de hoje, se já passou, ou o
 * anterior. O backup está em dia quando o último foi feito depois dele; com o HUB SNK
 * fechado no horário, o atrasado sai assim que ele abrir. Não vale para `intervalo`.
 */
export function ultimoHorarioAgendado(agora: Date, agenda: AgendaDoBackup): Date {
  const [horas, minutos] = agenda.horario.split(':').map(Number);
  const candidato = new Date(agora);
  candidato.setHours(horas as number, minutos as number, 0, 0);

  if (agenda.frequencia === 'semanal') {
    const diasDesdeODia =
      (candidato.getDay() - agenda.diaDaSemana + DIAS_DA_SEMANA) % DIAS_DA_SEMANA;
    candidato.setDate(candidato.getDate() - diasDesdeODia);
    if (candidato > agora) candidato.setDate(candidato.getDate() - DIAS_DA_SEMANA);
    return candidato;
  }
  if (agenda.frequencia === 'mensal') {
    candidato.setDate(agenda.diaDoMes);
    if (candidato > agora) candidato.setMonth(candidato.getMonth() - 1);
    return candidato;
  }
  if (candidato > agora) candidato.setDate(candidato.getDate() - 1);
  return candidato;
}
