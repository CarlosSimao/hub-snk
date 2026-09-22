/**
 * Comparação de versões no formato do versionamento semântico.
 *
 * Serve para decidir se a release publicada no GitHub é mais nova do que a que
 * está rodando. Comparar como texto não funciona: `"1.10.0" < "1.9.0"` é
 * verdadeiro na ordem alfabética e falso na ordem que interessa aqui.
 */

const REGEX_DE_VERSAO = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

interface VersaoSemantica {
  maior: number;
  menor: number;
  correcao: number;
  ehPreLancamento: boolean;
}

/**
 * `null` para qualquer coisa fora de `MAIOR.MENOR.CORREÇÃO` — tag de release
 * escrita à mão pode vir como `release-2024` e não há palpite seguro a dar.
 *
 * O `v` inicial é aceito porque é assim que a tag chega do GitHub (`v1.2.3`),
 * enquanto o `package.json` guarda o número puro.
 */
export function interpretarVersaoSemantica(texto: string): VersaoSemantica | null {
  const partes = REGEX_DE_VERSAO.exec(texto.trim());
  if (!partes) {
    return null;
  }

  return {
    maior: Number(partes[1]),
    menor: Number(partes[2]),
    correcao: Number(partes[3]),
    ehPreLancamento: texto.includes('-'),
  };
}

/**
 * Verdadeiro só quando `candidata` é estritamente mais nova que `atual`.
 *
 * Pré-lançamento (`1.2.0-beta.1`) nunca vira aviso: quem roda a versão estável
 * não deve ser empurrado para uma release de teste. Versão local à frente da
 * publicada — situação normal de quem desenvolve o HUB SNK — também não avisa,
 * porque a comparação é estrita.
 *
 * Versão ilegível de qualquer um dos lados responde falso: sem entender os dois
 * números, afirmar que há atualização seria chute.
 */
export function versaoEhMaisNova(candidata: string, atual: string): boolean {
  const nova = interpretarVersaoSemantica(candidata);
  const corrente = interpretarVersaoSemantica(atual);

  if (!nova || !corrente || nova.ehPreLancamento) {
    return false;
  }

  if (nova.maior !== corrente.maior) {
    return nova.maior > corrente.maior;
  }

  if (nova.menor !== corrente.menor) {
    return nova.menor > corrente.menor;
  }

  return nova.correcao > corrente.correcao;
}
