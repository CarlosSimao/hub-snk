/**
 * Interpretação da resposta do `service.sbr`, comum às chamadas feitas de dentro das abas.
 *
 * Regras trazidas do cliente de exemplo `exemplo-login-sankhya/sankhya.js`:
 *  - o `statusMessage` às vezes vem em base64 (latin1) e chegava cru na tela;
 *  - `status` 3, ou uma mensagem de sessão/não autorizado/expirado, é sessão caída — e
 *    isso pede outro login, não é erro do serviço.
 */

/** Decodifica o `statusMessage` quando ele vem em base64; texto puro passa como está. */
export function mensagemSankhya(m: unknown): string {
  const texto = typeof m === 'string' ? m.trim() : '';
  if (!texto) return '';
  if (/^[A-Za-z0-9+/=\s]+$/.test(texto) && texto.replace(/\s/g, '').length % 4 === 0) {
    const decodificado = Buffer.from(texto, 'base64').toString('latin1');
    // Palavra solta como "Erro" também casa com o alfabeto do base64: só aceita a
    // decodificação se ela virar texto legível.
    if (decodificado && !/[\x00-\x08\x0e-\x1f]/.test(decodificado)) return decodificado;
  }
  return texto;
}

/** `status` 3 é o "não autorizado" do `service.sbr`; o texto cobre as variações de versão. */
export function sessaoExpirada(status: unknown, mensagem: string): boolean {
  return String(status) === '3' || /sess[aã]o|n[aã]o autorizado|expir/i.test(mensagem);
}

export const ERRO_SESSAO_EXPIRADA = 'a sessão do Sankhya expirou — faça login de novo na aba';

/** Erro pronto para a tela: sessão expirada vira instrução de login; o resto, a mensagem legível. */
export function erroSankhya(status: unknown, statusMessage: unknown, padrao: string): string {
  const mensagem = mensagemSankhya(statusMessage);
  if (sessaoExpirada(status, mensagem)) return ERRO_SESSAO_EXPIRADA;
  return mensagem || padrao;
}
