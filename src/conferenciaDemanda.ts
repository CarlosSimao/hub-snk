/**
 * Confronto da demanda de cada dia reservado na Agenda de Recursos com a Experience.
 *
 * O consultor escreve a demanda no DESCRLONGA do agendamento ("TECH | ID 2996 - ...") e
 * a Experience repete o mesmo texto no `additional_information` da tarefa daquele dia.
 * Cruzar os dois (e a demanda das OS do dia, ver `sankhya/vinculosDemanda.ts`) mostra o
 * que o painel de acompanhamento quer: dia reservado sem demanda, demanda sem OS, OS sem
 * demanda, divergência e o que confere.
 *
 * Puro e fora de `web/`: o resumo mensal (backend) calcula, a tela e a integração com a
 * API só leem — uma regra só.
 *
 * Limite conhecido: a Experience lista só tarefa em aberto. Dia passado cuja tarefa já
 * fechou confronta agenda x OS, sem a tarefa.
 */
import { idsDemandaNoTexto } from './demandas.ts';
import type { ConferenciaDia, OrigemDemandaAgenda, StatusDemandaDia } from './types.ts';

export interface DemandaLida {
  demanda: string;
  origem: OrigemDemandaAgenda;
}

/** Demanda de um texto, com o vínculo manual por cima quando existe. */
export function demandaDoTexto(texto: string, manual: string | undefined): DemandaLida {
  if (manual) return { demanda: manual, origem: 'manual' };
  const achado = idsDemandaNoTexto(texto)[0];
  return achado ? { demanda: achado, origem: 'texto' } : { demanda: '', origem: '' };
}

/**
 * O status de um agendamento no dia dele.
 *
 * `experienceOk = false` (Experience fora ou cadastro incompleto) não afirma nada sobre OS:
 * "demanda sem OS" seria mentira quando simplesmente não deu para perguntar.
 */
export function conferirDia(
  demandaAgenda: string,
  tarefas: ConferenciaDia['tarefas'],
  ordens: ConferenciaDia['ordens'],
  experienceOk: boolean,
): ConferenciaDia {
  const status = ((): StatusDemandaDia => {
    if (!demandaAgenda) return 'sem-demanda';
    if (!experienceOk) return 'sem-experience';
    const outraTarefa = tarefas.some((t) => t.demanda && t.demanda !== demandaAgenda);
    const outraOs = ordens.some((o) => o.demanda && o.demanda !== demandaAgenda);
    if (outraTarefa || outraOs) return 'divergente';
    if (!ordens.length) return 'demanda-sem-os';
    if (ordens.some((o) => !o.demanda)) return 'os-sem-demanda';
    return 'confere';
  })();
  return { status, tarefas, ordens };
}

/** Rótulos da tela e do e-mail — um lugar só. */
export const ROTULO_STATUS_DEMANDA: Record<StatusDemandaDia, string> = {
  'sem-demanda': 'Reservado sem demanda',
  'demanda-sem-os': 'Demanda sem OS',
  'os-sem-demanda': 'OS sem demanda',
  divergente: 'Demandas divergentes',
  confere: 'Demanda e OS conferem',
  'sem-experience': 'Sem dados da Experience',
};
