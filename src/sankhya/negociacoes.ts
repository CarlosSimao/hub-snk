/**
 * Parser do payload de `AgendaRecursosSP.getNegociacoes`.
 *
 * Diferente da Agenda de Recursos, aqui os campos ficam direto no nó — sem a
 * camada `properties` nem o embrulho `{ "$": "valor" }`.
 *
 * O "FAP" que o Sankhya Experience entende como `implantation_id` é o
 * `numNegociacao` das negociações com `tipo: "2"` ("HORAS DE IMPLANTACAO" /
 * "HORAS DE IMPLANTAÇÃO SOP") — as outras (`tipo: "0"` e `"1"`) são
 * mensalidade e setup, sem tarefa nenhuma no Experience.
 */
export interface Negociacao {
  numNegociacao: number;
  tipo: string;
  dscNatureza: string;
}

export class PayloadDeNegociacoesInvalidoError extends Error {}

/** Objeto quando há um só, array quando há vários, ausente quando não há. */
function comoLista(valor: unknown): Record<string, unknown>[] {
  if (Array.isArray(valor)) return valor as Record<string, unknown>[];
  if (valor && typeof valor === 'object') return [valor as Record<string, unknown>];
  return [];
}

function texto(fonte: Record<string, unknown>, chave: string): string {
  const valor = fonte[chave];
  return valor === null || valor === undefined ? '' : String(valor);
}

export function parsearNegociacoes(bruto: unknown): Negociacao[] {
  if (!bruto || typeof bruto !== 'object') {
    throw new PayloadDeNegociacoesInvalidoError('o conteúdo colado não é um JSON de objeto');
  }
  const raiz = bruto as Record<string, unknown>;

  const status = String(raiz['status'] ?? '');
  if (status && status !== '1') {
    throw new PayloadDeNegociacoesInvalidoError(
      `a captura veio com status "${status}" — o Sankhya recusou a chamada`,
    );
  }

  const corpo = raiz['responseBody'] as Record<string, unknown> | undefined;
  const negociacoes = corpo?.['negociacoes'] as Record<string, unknown> | undefined;
  const lista = comoLista(negociacoes?.['negociacao']);

  return lista.map((n) => ({
    numNegociacao: Number(texto(n, 'numNegociacao')),
    tipo: texto(n, 'tipo'),
    dscNatureza: texto(n, 'dscNatureza'),
  }));
}

/** Números de FAP de um parceiro, sem repetição — o que o Experience entende como projeto. */
export function fapsDoParceiro(negociacoes: Negociacao[]): number[] {
  return [...new Set(negociacoes.filter((n) => n.tipo === '2').map((n) => n.numNegociacao))];
}
