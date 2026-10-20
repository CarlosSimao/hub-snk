/**
 * Seções do `CHANGELOG.md` em texto puro, para a janela de novidades (`novidades.ts`).
 * Sem Electron aqui: a conferência em `scripts/conferir-notas-da-versao.mjs` roda no Node.
 */

const CABECALHO_DE_VERSAO = /^## \[(\d+\.\d+\.\d+)\]/;
const CABECALHO_DE_SECAO = /^## /;
const REFERENCIA_DE_LINK = /^\[[^\]]+\]: /;
/** Recuo preservado: subitem continua subitem na janela. */
const ITEM_DE_LISTA = /^(\s*)- (.*)$/;

export interface NotasDeUmaVersao {
  versao: string;
  texto: string;
}

/** Negativo, zero ou positivo, como o `sort` espera. Só `X.Y.Z`, o formato das tags. */
export function compararVersoes(a: string, b: string): number {
  const partesDeA = a.split('.').map(Number);
  const partesDeB = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diferenca = (partesDeA[i] ?? 0) - (partesDeB[i] ?? 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/** A janela nativa não renderiza markdown: negrito, código e link viram texto. */
function textoSemMarkdown(linha: string): string {
  return linha
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * O CHANGELOG quebra item e parágrafo em linhas de 90 colunas; a janela tem outra largura,
 * então a continuação volta para a linha de cima. Linha em branco encerra o parágrafo.
 */
function linhasDaSecao(linhas: string[]): string[] {
  const resultado: string[] = [];
  let continuaALinhaDeCima = false;
  for (const linha of linhas) {
    if (!linha.trim() || REFERENCIA_DE_LINK.test(linha)) {
      continuaALinhaDeCima = false;
      continue;
    }
    if (linha.startsWith('### ')) {
      resultado.push('', `${linha.slice(4)}:`);
      continuaALinhaDeCima = false;
      continue;
    }
    const item = ITEM_DE_LISTA.exec(linha);
    if (item) {
      resultado.push(`${item[1]}• ${item[2] ?? ''}`);
    } else if (continuaALinhaDeCima) {
      resultado[resultado.length - 1] += ` ${linha.trim()}`;
    } else {
      resultado.push(linha.trim());
    }
    continuaALinhaDeCima = true;
  }
  // Depois de juntar: negrito e link também quebram de uma linha para a outra.
  return resultado.map(textoSemMarkdown);
}

/** Versões depois de `vista` até `atual`, inclusive, da mais nova para a mais antiga. */
export function notasEntre(changelog: string, vista: string, atual: string): NotasDeUmaVersao[] {
  const notas: NotasDeUmaVersao[] = [];
  let versao: string | null = null;
  let linhas: string[] = [];
  const fecharSecao = () => {
    if (versao && compararVersoes(versao, vista) > 0 && compararVersoes(versao, atual) <= 0) {
      notas.push({ versao, texto: linhasDaSecao(linhas).join('\n').trim() });
    }
  };
  for (const linha of changelog.split(/\r?\n/)) {
    if (!CABECALHO_DE_SECAO.test(linha)) {
      linhas.push(linha);
      continue;
    }
    fecharSecao();
    versao = CABECALHO_DE_VERSAO.exec(linha)?.[1] ?? null;
    linhas = [];
  }
  fecharSecao();
  return notas;
}
