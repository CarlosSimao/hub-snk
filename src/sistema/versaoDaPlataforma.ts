/**
 * Leitura da versão da plataforma a partir da página inicial do Sankhya.
 *
 * A fonte primária é a variável `SYSVERSION` que a página raiz do `/mge`
 * declara inline (`SYSVERSION = "4.36b112";`) — está lá independentemente do
 * user-agent, inclusive na página de navegador não suportado, e é o mesmo
 * valor exibido na tela de login.
 *
 * O link `<a ... title="Versão atual da plataforma" ...>Versão 4.36b112</a>`
 * fica como alternativa: em algumas versões a página servida já vem com ele
 * montado no HTML, sem a variável.
 *
 * A leitura vale igual para a base local (`wildfly.ts`) e para a base de um
 * cliente (`baseDoCliente.ts`) — as duas já baixam a página inicial para saber
 * se a base responde, então a versão sai da mesma requisição.
 */

const REGEX_DA_VARIAVEL_DE_VERSAO = /SYSVERSION\s*=\s*"([^"]+)"/;

const REGEX_DO_LINK_DE_VERSAO =
  /title="Versão atual da plataforma"[^>]*>\s*Versão\s+([^<]+?)\s*<\/a>/;

/** `null` quando a página respondeu mas não trouxe a versão em nenhum dos dois formatos. */
export function extrairVersaoDaPlataforma(html: string): string | null {
  const daVariavel = html.match(REGEX_DA_VARIAVEL_DE_VERSAO)?.[1]?.trim();
  if (daVariavel) {
    return daVariavel;
  }

  return html.match(REGEX_DO_LINK_DE_VERSAO)?.[1] ?? null;
}
