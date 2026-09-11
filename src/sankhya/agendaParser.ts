/**
 * Parser do payload de `AgendaRecursosSP.carregarAgendas`.
 *
 * O formato tem armadilhas, todas silenciosas — nenhuma dá erro, só produz dado errado
 * ou lista vazia:
 *
 *  1. Os campos do recurso e do evento ficam sob `properties`, NÃO direto no nó. Lidos
 *     do nó, todos vêm vazios e a importação grava um snapshot de fantasmas.
 *  2. Todo valor sob `properties` vem embrulhado em `{ "$": "valor" }` — mas `allDay`,
 *     `start` e `end` são atributos diretos do `task`, em texto cru.
 *  3. `lane.task` é um OBJETO quando o recurso tem um único evento e um ARRAY quando
 *     tem vários. Sem normalizar, todo recurso com exatamente um evento some.
 *  4. Data vem `DD/MM/YYYY HH:mm`, cor vem `0xRRGGBB` e `allDay` vem `"true"`/`"false"`,
 *     enquanto os outros booleanos do Sankhya vêm `"S"`/`"N"`.
 *
 * As armadilhas 1 e 4 só apareceram ao chamar o serviço de verdade: o documento de
 * descoberta (`Sankhya-agenda.md` seção 2.1) descrevia os campos como se estivessem no
 * nó e o `allDay` como `S`/`N`.
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

/** Objeto quando há um só, array quando há vários, ausente quando não há. */
function comoLista(valor: unknown): Record<string, unknown>[] {
  if (Array.isArray(valor)) return valor as Record<string, unknown>[];
  if (valor && typeof valor === 'object') return [valor as Record<string, unknown>];
  return [];
}

/**
 * Onde os campos realmente moram: dentro de `properties`.
 *
 * O fallback para o próprio nó existe porque o documento de descoberta descreve o
 * formato sem essa camada — se algum ambiente responder daquele jeito, continua lendo.
 */
function campos(no: Record<string, unknown>): Record<string, unknown> {
  const props = no['properties'];
  return props && typeof props === 'object' && !Array.isArray(props)
    ? (props as Record<string, unknown>)
    : no;
}

/** `allDay` vem `"true"`/`"false"`; o resto do Sankhya usa `S`/`N`. Padroniza em `S`/`N`. */
function comoSN(valor: string): string {
  const bruto = valor.trim().toLowerCase();
  if (!bruto) return '';
  return bruto === 'true' || bruto === 's' ? 'S' : 'N';
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
    const doRecurso = campos(lane);

    const eventos = comoLista(lane['task']).map((task) => {
      const p = campos(task);
      const evento: EventoAgenda = {
        nuevento: numero(p, 'NUEVENTO'),
        codusu: numero(p, 'CODUSU'),
        nomeusu: texto(p, 'NOMEUSU'),
        nomeparc: texto(p, 'NOMEPARC'),
        codparc: numero(p, 'CODPARC'),
        // `allDay`, `start` e `end` são atributos diretos do task, em texto cru — não
        // entram no `properties` nem no embrulho `{ $ }`.
        allday: comoSN(texto(task, 'allDay')),
        inicio: converterData(texto(task, 'start')),
        fim: converterData(texto(task, 'end')),
        descrabrev: texto(p, 'DESCRABREV'),
        descrlonga: texto(p, 'DESCRLONGA'),
        tipo: texto(p, 'TIPO'),
        confirmado: texto(p, 'CONFIRMADO'),
        sincronizar: texto(p, 'SINCRONIZAR'),
        usulancador: texto(p, 'USULANCADOR'),
        dhlcto: converterData(texto(p, 'DHLCTO')),
        numetapa: numero(p, 'NUMETAPA'),
        nufap: numero(p, 'NUFAP'),
        // Os três abaixo não vieram no payload real observado; ficam porque o documento
        // de descoberta os lista e custam nada quando ausentes.
        nueventopai: numero(p, 'NUEVENTOPAI'),
        financiallate: texto(p, 'FINANCIALLATE'),
        diastraso: numero(p, 'DIASTRASO'),
      };
      totalEventos += 1;
      return evento;
    });

    return {
      recurso: {
        codusu: numero(doRecurso, 'CODUSU'),
        nomeusu: texto(doRecurso, 'NOMEUSU'),
        codcargo: numero(doRecurso, 'CODCARGO'),
        descrcargo: texto(doRecurso, 'DESCRCARGO'),
        corHex: converterCor(texto(doRecurso, 'COLOR')),
        corConflitoHex: converterCor(texto(doRecurso, 'CONFLICTCOLOR')),
        problemaConexao: texto(doRecurso, 'CONNECTIONPROBLEM'),
      },
      eventos,
    };
  });

  return { recursos, totalEventos };
}
