/**
 * O que a barra de endereço da guia avulsa faz com o texto digitado, como a do Chrome:
 * endereço completo abre como está, domínio sem protocolo ganha `https://` e o resto vira
 * busca no Google.
 */

const URL_DE_BUSCA = 'https://www.google.com/search?q=';

/** Só http/https: `file:` ou esquema de aplicativo digitado não pode virar execução na máquina. */
const PROTOCOLOS_ACEITOS: ReadonlySet<string> = new Set(['http:', 'https:']);

const TEM_PROTOCOLO = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `exemplo.com.br/caminho`, `192.168.0.1:8080`, `localhost:8080/mge`: sem espaço, com ponto ou `localhost`. */
const PARECE_DOMINIO = /^(localhost|[^\s/:?#]+\.[^\s/:?#]+)(:\d+)?([/?#]\S*)?$/i;

function urlWebOuNula(texto: string): string | null {
  try {
    const url = new URL(texto);
    return PROTOCOLOS_ACEITOS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** `null` quando não há o que abrir: texto vazio ou protocolo recusado. */
export function urlDoTextoDigitado(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  if (TEM_PROTOCOLO.test(limpo)) return urlWebOuNula(limpo);
  if (PARECE_DOMINIO.test(limpo)) return urlWebOuNula(`https://${limpo}`);
  return `${URL_DE_BUSCA}${encodeURIComponent(limpo)}`;
}
