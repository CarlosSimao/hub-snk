/**
 * Quando cada lembrete dispara. Regras puras, sem relógio nem arquivo: o agendador e a
 * tela (próximo disparo, prévia do cron) usam as mesmas.
 */
import { Cron } from 'croner';
import type { Lembrete } from '../tipos.ts';

const CAMPOS_DA_EXPRESSAO_CRON = 5;
const SEPARADOR_DE_CAMPOS = /\s+/;

/** A expressão não é um cron de cinco campos que o `croner` entenda. */
export class ExpressaoCronInvalidaError extends Error {
  constructor(motivo: string) {
    super(`Expressão cron inválida: ${motivo}`);
    this.name = 'ExpressaoCronInvalidaError';
  }
}

/*
 * Cinco campos, como no cron do Linux: o `croner` também aceita segundos e ano, mas a
 * tela explica e sugere só o formato de cinco, e uma expressão de seis leria errado.
 */
function interpretarCron(expressao: string): Cron {
  const campos = expressao.trim().split(SEPARADOR_DE_CAMPOS);
  if (campos.length !== CAMPOS_DA_EXPRESSAO_CRON) {
    throw new ExpressaoCronInvalidaError(
      'use cinco campos separados por espaço — minuto, hora, dia do mês, mês e dia da semana.',
    );
  }

  try {
    return new Cron(expressao.trim());
  } catch (erro) {
    throw new ExpressaoCronInvalidaError(erro instanceof Error ? erro.message : String(erro));
  }
}

/** Lança `ExpressaoCronInvalidaError` quando a expressão não serve. */
export function validarExpressaoCron(expressao: string): void {
  interpretarCron(expressao);
}

/** As próximas ocorrências depois de `aPartirDe`, exclusive. */
export function proximasOcorrencias(
  expressao: string,
  aPartirDe: Date,
  quantidade: number,
): Date[] {
  return interpretarCron(expressao).nextRuns(quantidade, aPartirDe);
}

/*
 * A contagem do recorrente começa no último disparo; sem disparo, na última edição —
 * lembrete criado às 10h com "todo dia às 9h" não dispara o das 9h de hoje.
 */
function referenciaDoRecorrente(lembrete: Lembrete): Date {
  return new Date(lembrete.ultimoDisparoEm || lembrete.atualizadoEm);
}

/**
 * A ocorrência que já devia ter disparado e não disparou, ou `null`.
 *
 * Do recorrente que perdeu várias com o HUB SNK fechado, só a primeira volta: o disparo
 * grava o último disparo como agora, e as outras perdidas ficam para trás.
 */
export function ocorrenciaDevida(lembrete: Lembrete, agora: Date): Date | null {
  if (!lembrete.ativo) {
    return null;
  }

  if (lembrete.tipo === 'unico') {
    if (lembrete.ultimoDisparoEm !== '') {
      return null;
    }
    const quando = new Date(lembrete.dataHora);
    return quando <= agora ? quando : null;
  }

  const proxima = interpretarCron(lembrete.expressaoCron).nextRun(referenciaDoRecorrente(lembrete));
  return proxima && proxima <= agora ? proxima : null;
}

/** Quando o lembrete dispara da próxima vez, para a tela. `null`: desligado ou já concluído. */
export function proximoDisparo(lembrete: Lembrete, agora: Date): Date | null {
  if (!lembrete.ativo) {
    return null;
  }

  if (lembrete.tipo === 'unico') {
    return lembrete.ultimoDisparoEm === '' ? new Date(lembrete.dataHora) : null;
  }

  return (
    ocorrenciaDevida(lembrete, agora) ?? interpretarCron(lembrete.expressaoCron).nextRun(agora)
  );
}
