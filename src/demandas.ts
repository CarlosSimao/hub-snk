/**
 * IDs de demanda — o `CODIGO` da Solicitação de Serviços DS no corporativo.
 *
 * Moram fora de `web/` porque os dois lados precisam da MESMA leitura: o backend para
 * decidir quais solicitações buscar no ERP, a tela para separar os eventos de um
 * cliente por demanda no calendário.
 */

/** "2996, 3100 / 3100" -> ["2996", "3100"]: qualquer coisa que não é dígito separa. */
export function listarIdsDemanda(texto: string): string[] {
  return [...new Set((texto ?? '').match(/\d+/g) ?? [])];
}

/** Forma gravada no cadastro: os IDs, sem repetição, separados por vírgula. */
export function normalizarIdsDemanda(texto: string): string {
  return listarIdsDemanda(texto).join(', ');
}

/**
 * IDs citados no texto de um evento da Agenda de Recursos.
 *
 * O consultor escreve a demanda na observação do evento, no padrão
 * `TECH | ID 2996 - NOME DO CLIENTE`. É o único vínculo que o evento tem com a
 * solicitação: `nufap`/`numetapa` apontam para o projeto, não para ela.
 */
export function idsDemandaNoTexto(texto: string): string[] {
  const achados = [...(texto ?? '').matchAll(/\bID\s*[:#-]?\s*(\d{3,7})\b/gi)].map((m) => m[1]!);
  return [...new Set(achados)];
}
