/**
 * Checagem HTTP da base de um cliente. O tempo limite não é uma constante
 * fixa: vem da configuração global (`tempoLimiteSegundos`), como o de todas as
 * demais checagens de situação.
 *
 * Aproveita a mesma requisição para extrair a versão da plataforma.
 */

import { extrairVersaoDaPlataforma } from './versaoDaPlataforma.ts';

export interface SituacaoDaBaseDoCliente {
  ok: boolean;
  /** `null` quando a base não respondeu ou quando a página não trouxe o link de versão. */
  versaoDaPlataforma: string | null;
}

export async function consultarBaseDoCliente(
  url: string,
  tempoLimiteMs: number,
): Promise<SituacaoDaBaseDoCliente> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), tempoLimiteMs);

  try {
    const resposta = await fetch(url, { signal: controlador.signal });
    if (!resposta.ok) {
      return { ok: false, versaoDaPlataforma: null };
    }

    const html = await resposta.text();
    return { ok: true, versaoDaPlataforma: extrairVersaoDaPlataforma(html) };
  } catch {
    return { ok: false, versaoDaPlataforma: null };
  } finally {
    clearTimeout(temporizador);
  }
}
