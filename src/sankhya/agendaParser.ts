/**
 * Parser do payload de `AgendaRecursosSP.carregarAgendas`.
 *
 * O formato vem do Sankhya legado e tem três armadilhas, todas documentadas em
 * `Sankhya-agenda.md` seção 2.1 e todas silenciosas — nenhuma dá erro, só produz dado
 * errado ou lista vazia:
 *
 *  1. Todo valor de folha vem embrulhado em `{ "$": "valor" }`.
 *  2. `lane.task` é um OBJETO quando o recurso tem um único evento e um ARRAY quando
 *     tem vários. Sem normalizar, todo recurso com exatamente um evento some.
 *  3. Data vem `DD/MM/YYYY HH:mm` e cor vem `0xRRGGBB`.
 */
import type { EventoAgenda, RecursoAgenda } from '../types.ts';

export interface AgendaImportada {
  recursos: { recurso: RecursoAgenda; eventos: EventoAgenda[] }[];
  totalEventos: number;
}

export class PayloadInvalidoError extends Error {}

/** `{ "$": "x" }` -> `"x"`. Qualquer outra coisa passa direto. */
function desembrulhar(valor: unknown): unknown {
  if (valor && typeof valor === 'object' && !Array.isArray(valor) && '$' in valor) {
    return (valor as { $: unknown })['$'];
  }
  return valor;
}

function texto(fonte: Record<string, unknown> | undefined, chave: string): string {
  const valor = desembrulhar(fonte?.[chave]);
  return valor === null || valor === undefined ? '' : String(valor);
}

function numero(fonte: Record<string, unknown> | undefined, chave: string): number | null {
  const bruto = texto(fonte, chave).trim();
  if (!bruto) return null;
  const valor = Number(bruto);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * `DD/MM/YYYY HH:mm` -> `YYYY-MM-DD HH:mm:ss`.
 *
 * Texto, não `Date`: nesse formato a ordem lexicográfica é a ordem cronológica, então
 * `WHERE fim >= '2026-08-17 00:00:00'` funciona sem conversão e sem fuso no meio.
 */
export function converterData(valor: string): string {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(
    (valor ?? '').trim(),
  );
  if (!partes) return '';

  const [, dia, mes, ano, hora = '00', minuto = '00', segundo = '00'] = partes;
  return `${ano}-${mes}-${dia} ${hora}:${minuto}:${segundo}`;
}

/** `0x0000FF` -> `#0000FF`. Completa com zero à esquerda quando o Sankhya corta. */
export function converterCor(valor: string): string {
  const bruto = (valor ?? '').trim();
  if (!bruto) return '';

  const semPrefixo = bruto.replace(/^0x/i, '').replace(/^#/, '');
  if (!/^[0-9a-f]{1,6}$/i.test(semPrefixo)) return '';
  return `#${semPrefixo.padStart(6, '0').toUpperCase()}`;
}

/** Armadilha 2: objeto quando há um só, array quando há vários, ausente quando não há. */
function comoLista(valor: unknown): Record<string, unknown>[] {
  if (Array.isArray(valor)) return valor as Record<string, unknown>[];
  if (valor && typeof valor === 'object') return [valor as Record<string, unknown>];
  return [];
}

export function parsearAgenda(bruto: unknown): AgendaImportada {
  if (!bruto || typeof bruto !== 'object') {
    throw new PayloadInvalidoError('o conteúdo colado não é um JSON de objeto');
  }
  const raiz = bruto as Record<string, unknown>;

  // `status: "0"` significa que a própria chamada falhou; importar isso gravaria vazio
  // por cima do snapshot bom que já estava lá.
  const status = String(desembrulhar(raiz['status']) ?? '');
  if (status && status !== '1') {
    throw new PayloadInvalidoError(
      `a captura veio com status "${status}" — o Sankhya recusou a chamada, recapture`,
    );
  }

  const corpo = raiz['responseBody'] as Record<string, unknown> | undefined;
  const timeline = corpo?.['timeLine'] as Record<string, unknown> | undefined;
  const lanes = comoLista(timeline?.['lane']);

  if (!lanes.length) {
    throw new PayloadInvalidoError(
      'não achei `responseBody.timeLine.lane` — confira se copiou a resposta de AgendaRecursosSP.carregarAgendas',
    );
  }

  let totalEventos = 0;
  const recursos = lanes.map((lane) => {
    const eventos = comoLista(lane['task']).map((task) => {
      const evento: EventoAgenda = {
        nuevento: numero(task, 'NUEVENTO'),
        codusu: numero(task, 'CODUSU'),
        nomeusu: texto(task, 'NOMEUSU'),
        nomeparc: texto(task, 'NOMEPARC'),
        codparc: numero(task, 'CODPARC'),
        // `allDay`, `start` e `end` são atributos diretos, não propriedades embrulhadas.
        allday: texto(task, 'allDay'),
        inicio: converterData(texto(task, 'start')),
        fim: converterData(texto(task, 'end')),
        descrabrev: texto(task, 'DESCRABREV'),
        descrlonga: texto(task, 'DESCRLONGA'),
        tipo: texto(task, 'TIPO'),
        confirmado: texto(task, 'CONFIRMADO'),
        sincronizar: texto(task, 'SINCRONIZAR'),
        usulancador: texto(task, 'USULANCADOR'),
        dhlcto: converterData(texto(task, 'DHLCTO')),
        numetapa: numero(task, 'NUMETAPA'),
        nufap: numero(task, 'NUFAP'),
        nueventopai: numero(task, 'NUEVENTOPAI'),
        financiallate: texto(task, 'FINANCIALLATE'),
        diastraso: numero(task, 'DIASTRASO'),
      };
      totalEventos += 1;
      return evento;
    });

    return {
      recurso: {
        codusu: numero(lane, 'CODUSU'),
        nomeusu: texto(lane, 'NOMEUSU'),
        codcargo: numero(lane, 'CODCARGO'),
        descrcargo: texto(lane, 'DESCRCARGO'),
        corHex: converterCor(texto(lane, 'COLOR')),
        corConflitoHex: converterCor(texto(lane, 'CONFLICTCOLOR')),
        problemaConexao: texto(lane, 'CONNECTIONPROBLEM'),
      },
      eventos,
    };
  });

  return { recursos, totalEventos };
}
