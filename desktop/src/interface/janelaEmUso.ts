import type { BrowserWindow } from 'electron';

/**
 * A janela está na frente de quem usa o computador: decide se um aviso de mensagem ou
 * de notificação seria repetido (a pessoa já está vendo) ou precisa piscar o ícone.
 *
 * `isFocused()` sozinho não serve: medido no Windows, a janela minimizada enquanto se usa
 * outro programa continua respondendo `true`, e o ícone nunca piscava.
 */
export function janelaEmUso(janela: BrowserWindow): boolean {
  return janela.isVisible() && !janela.isMinimized() && janela.isFocused();
}
