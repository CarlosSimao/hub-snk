/**
 * Consultas ao Sankhya que a aba Agenda e o alerta da agenda do dia fazem do mesmo
 * jeito: importar um período da Agenda de Recursos e descobrir se o parceiro já tem OS
 * lançada num dia.
 */
import type { EstadoAgendaRecursos } from '../tipos.ts';
import type { AgendaRecursos } from './agenda.ts';
import { parsearAgenda } from './agendaParser.ts';
import type { Credenciais } from './credenciais.ts';
import type { Experience, SituacaoDoDia } from './experience.ts';
import { fapsDoParceiro, parsearNegociacoes } from './negociacoes.ts';

/** O Sankhya respondeu algo que não é JSON. */
export class RespostaDoSankhyaInvalidaError extends Error {
  constructor() {
    super('O Sankhya respondeu algo que não é JSON válido.');
    this.name = 'RespostaDoSankhyaInvalidaError';
  }
}

/** Período em `YYYY-MM-DD`, dos dois lados inclusive. */
export interface PeriodoDaAgenda {
  de: string;
  ate: string;
}

export interface SituacaoDoDiaDoParceiro {
  situacao: SituacaoDoDia;
  faps: number[];
}

/**
 * `CODUSU` da configuração global, ou `null` quando não configurado. Sem ele não há
 * como recortar "só a minha agenda", então a consulta é recusada com mensagem clara.
 */
export function lerCodusuConfigurado(configuracao: { sankhyaOmCodUsu: string }): number | null {
  const bruto = configuracao.sankhyaOmCodUsu.trim();
  if (!bruto) return null;
  const codusu = Number(bruto);
  return Number.isInteger(codusu) && codusu > 0 ? codusu : null;
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, formato que o Sankhya ERP espera. */
function paraFormatoBrasileiro(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function lerJson(conteudo: string): unknown {
  try {
    return JSON.parse(conteudo);
  } catch {
    throw new RespostaDoSankhyaInvalidaError();
  }
}

/**
 * Busca o período na janela oculta do shell, já autenticada no Sankhya, e o grava no
 * snapshot, recortado pelo `CODUSU` do usuário — só a agenda dele entra.
 */
export async function importarAgendaDoPeriodo(parametros: {
  agenda: AgendaRecursos;
  credenciais: Credenciais;
  periodo: PeriodoDaAgenda;
  codusuAlvo: number;
}): Promise<EstadoAgendaRecursos> {
  const { agenda, credenciais, periodo, codusuAlvo } = parametros;

  const resultado = await credenciais.consultarAgendaDeRecursos(
    paraFormatoBrasileiro(periodo.de),
    paraFormatoBrasileiro(periodo.ate),
  );

  return agenda.importar(parsearAgenda(lerJson(resultado.conteudo)), {
    periodo: { de: `${periodo.de} 00:00:00`, ate: `${periodo.ate} 23:59:59` },
    codusuAlvo,
  });
}

/**
 * Estado do dia no Sankhya Experience para o parceiro: sem tarefa, tarefa aberta ou OS
 * lançada. Descobre os FAPs dele (negociações do ERP) e testa o dia em cada um — sempre
 * para o usuário logado.
 */
export async function situacaoDoDiaDoParceiro(parametros: {
  credenciais: Credenciais;
  experience: Experience;
  codparc: number;
  dia: string;
}): Promise<SituacaoDoDiaDoParceiro> {
  const { credenciais, experience, codparc, dia } = parametros;

  const negociacoes = await credenciais.consultarNegociacoesDoParceiro(codparc);
  const faps = fapsDoParceiro(parsearNegociacoes(lerJson(negociacoes.conteudo)));
  if (!faps.length) {
    return { situacao: { tipo: 'sem-tarefa' }, faps: [] };
  }

  return { situacao: await experience.situacaoDoDia(faps, dia), faps };
}
