/**
 * Mascaramento do log antes de ele sair da máquina.
 *
 * O `desktop.log` já é gravado mascarado; o `backend.log` não — é a saída crua do
 * servidor. Como o relato de problema envia os dois, tudo passa por aqui na coleta,
 * de modo que o que sai da máquina é sempre o texto já mascarado, venha de onde vier.
 *
 * A regra é mascarar por CONTEÚDO, não só por nome de campo: um token costuma aparecer
 * onde ninguém esperava (numa URL de redirecionamento, numa mensagem de erro).
 */

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const TOKEN_EM_QUERYSTRING = /([?&](?:token|access_token|key|senha|password|secret)=)[^&\s"']+/gi;
const CABECALHO_DE_AUTORIZACAO =
  /((?:authorization|cookie|set-cookie|x-hub-token)["']?\s*[:=]\s*["']?)[^"'\r\n]+/gi;
const CAMPO_SECRETO =
  /(["']?(?:senha|password|passwd|secret|token|apikey|api_key|chave)["']?\s*[:=]\s*)(["'])[^"'\r\n]*\2/gi;
/** O mesmo campo sem aspas, como sai numa linha de log comum: `token=abc`, `senha: abc`. */
const CAMPO_SECRETO_SEM_ASPAS =
  /(\b(?:senha|password|passwd|secret|token|apikey|api_key)\s*[:=]\s*)(?!["'[])[^\s,;&"']+/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** `C:\Users\fulano\...` e `/home/fulano/...`: o nome da conta do sistema é dado pessoal. */
const PASTA_DO_USUARIO_WINDOWS = /([A-Za-z]:\\+Users\\+)[^\\\s"']+/g;
const PASTA_DO_USUARIO_UNIX = /(\/(?:home|Users)\/)[^/\s"']+/g;

export function mascararTexto(texto: string): string {
  return texto
    .replace(JWT, '[jwt-redigido]')
    .replace(TOKEN_EM_QUERYSTRING, '$1[redigido]')
    .replace(CABECALHO_DE_AUTORIZACAO, '$1[redigido]')
    .replace(CAMPO_SECRETO, '$1$2[redigido]$2')
    .replace(CAMPO_SECRETO_SEM_ASPAS, '$1[redigido]')
    .replace(EMAIL, '[email-redigido]')
    .replace(PASTA_DO_USUARIO_WINDOWS, '$1[usuario]')
    .replace(PASTA_DO_USUARIO_UNIX, '$1[usuario]');
}
