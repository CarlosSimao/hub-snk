/**
 * Texto corrido de um `.docx`, sem dependência nova.
 *
 * `.docx` é um ZIP com o corpo em `word/document.xml`. O Node já traz o descompressor
 * (`zlib.inflateRawSync`); o que falta é ler o índice do ZIP, e isso cabe aqui: o
 * documento de escopo é pequeno, sem ZIP64 nem criptografia.
 *
 * O objetivo é dar à IA o conteúdo do escopo, não reproduzir o layout: parágrafo vira
 * quebra de linha, célula de tabela vira `|`, o resto da formatação some.
 */
import { inflateRawSync } from 'node:zlib';

export class DocxInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'DocxInvalidoError';
  }
}

const ASSINATURA_DO_FIM_DO_DIRETORIO = 0x06054b50;
const ASSINATURA_DO_DIRETORIO = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;
const TAMANHO_DO_FIM_DO_DIRETORIO = 22;
const TAMANHO_MAXIMO_DO_COMENTARIO = 0xffff;

interface EntradaDoZip {
  nome: string;
  metodo: number;
  tamanhoComprimido: number;
  deslocamentoLocal: number;
}

function lerIndice(zip: Buffer): EntradaDoZip[] {
  // O registro de fim fica nos últimos 22 bytes, mais um comentário de até 64 KB.
  const inicioDaBusca = Math.max(
    0,
    zip.length - TAMANHO_DO_FIM_DO_DIRETORIO - TAMANHO_MAXIMO_DO_COMENTARIO,
  );
  let fim = -1;
  for (
    let posicao = zip.length - TAMANHO_DO_FIM_DO_DIRETORIO;
    posicao >= inicioDaBusca;
    posicao -= 1
  ) {
    if (zip.readUInt32LE(posicao) === ASSINATURA_DO_FIM_DO_DIRETORIO) {
      fim = posicao;
      break;
    }
  }
  if (fim < 0) {
    throw new DocxInvalidoError('O arquivo não é um .docx válido: índice do ZIP não encontrado.');
  }

  const total = zip.readUInt16LE(fim + 10);
  let posicao = zip.readUInt32LE(fim + 16);
  const entradas: EntradaDoZip[] = [];

  for (let lidas = 0; lidas < total; lidas += 1) {
    if (posicao + 46 > zip.length || zip.readUInt32LE(posicao) !== ASSINATURA_DO_DIRETORIO) {
      throw new DocxInvalidoError('O .docx está corrompido: índice do ZIP ilegível.');
    }
    const tamanhoDoNome = zip.readUInt16LE(posicao + 28);
    const tamanhoDoExtra = zip.readUInt16LE(posicao + 30);
    const tamanhoDoComentario = zip.readUInt16LE(posicao + 32);
    entradas.push({
      nome: zip.toString('utf8', posicao + 46, posicao + 46 + tamanhoDoNome),
      metodo: zip.readUInt16LE(posicao + 10),
      tamanhoComprimido: zip.readUInt32LE(posicao + 20),
      deslocamentoLocal: zip.readUInt32LE(posicao + 42),
    });
    posicao += 46 + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario;
  }
  return entradas;
}

function extrair(zip: Buffer, entrada: EntradaDoZip): Buffer {
  const posicao = entrada.deslocamentoLocal;
  if (zip.readUInt32LE(posicao) !== ASSINATURA_LOCAL) {
    throw new DocxInvalidoError('O .docx está corrompido: cabeçalho de arquivo do ZIP ilegível.');
  }
  // Tamanhos do cabeçalho local, não do índice: o campo extra pode diferir entre os dois.
  const inicio = posicao + 30 + zip.readUInt16LE(posicao + 26) + zip.readUInt16LE(posicao + 28);
  const dados = zip.subarray(inicio, inicio + entrada.tamanhoComprimido);
  if (entrada.metodo === 0) {
    return Buffer.from(dados);
  }
  if (entrada.metodo === 8) {
    return inflateRawSync(dados);
  }
  throw new DocxInvalidoError(`Compressão do .docx não suportada (método ${entrada.metodo}).`);
}

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, hexadecimal: string) =>
      String.fromCodePoint(parseInt(hexadecimal, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** O XML do corpo do Word vira texto com a estrutura mínima que ajuda a ler o escopo. */
export function textoDoXmlDoWord(xml: string): string {
  const semTags = xml
    .replace(/<w:tab\/>/g, '\t')
    .replace(/<w:br[^>]*\/>/g, '\n')
    .replace(/<\/w:tc>/g, ' | ')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodificarEntidades(semTags)
    .split('\n')
    .map((linha) => linha.replace(/[ \t]+$/g, '').replace(/\s*\|\s*$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textoDoDocx(arquivo: Buffer): string {
  const corpo = lerIndice(arquivo).find((entrada) => entrada.nome === 'word/document.xml');
  if (!corpo) {
    throw new DocxInvalidoError('O arquivo não tem word/document.xml: é mesmo um .docx?');
  }
  return textoDoXmlDoWord(extrair(arquivo, corpo).toString('utf8'));
}
