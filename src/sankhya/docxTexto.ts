/**
 * Texto corrido de um `.docx`, sem dependência nova.
 *
 * `.docx` é um ZIP com o corpo em `word/document.xml`. O Node já traz o descompressor
 * (`zlib.inflateRawSync`); o que falta é ler o índice do ZIP, e isso cabe aqui — o
 * formato de documento de escopo é pequeno, sem ZIP64 nem criptografia.
 *
 * O objetivo é dar à IA o CONTEÚDO do escopo, não reproduzir o layout: parágrafo vira
 * quebra de linha, célula de tabela vira `|`, o resto da formatação some.
 */
import { inflateRawSync } from 'node:zlib';

export class DocxInvalidoError extends Error {}

const ASSINATURA_FIM_DIRETORIO = 0x06054b50;
const ASSINATURA_DIRETORIO = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

interface EntradaZip {
  nome: string;
  metodo: number;
  tamanhoComprimido: number;
  deslocamentoLocal: number;
}

function lerIndice(zip: Buffer): EntradaZip[] {
  // O registro de fim fica nos últimos 22 bytes, mais um comentário de até 64 KB.
  const inicioBusca = Math.max(0, zip.length - 22 - 0xffff);
  let fim = -1;
  for (let i = zip.length - 22; i >= inicioBusca; i -= 1) {
    if (zip.readUInt32LE(i) === ASSINATURA_FIM_DIRETORIO) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new DocxInvalidoError('o arquivo não é um .docx válido (índice do ZIP não encontrado)');

  const total = zip.readUInt16LE(fim + 10);
  let p = zip.readUInt32LE(fim + 16);
  const entradas: EntradaZip[] = [];

  for (let n = 0; n < total; n += 1) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== ASSINATURA_DIRETORIO) {
      throw new DocxInvalidoError('índice do ZIP corrompido');
    }
    const metodo = zip.readUInt16LE(p + 10);
    const tamanhoComprimido = zip.readUInt32LE(p + 20);
    const tamNome = zip.readUInt16LE(p + 28);
    const tamExtra = zip.readUInt16LE(p + 30);
    const tamComentario = zip.readUInt16LE(p + 32);
    const deslocamentoLocal = zip.readUInt32LE(p + 42);
    const nome = zip.toString('utf8', p + 46, p + 46 + tamNome);
    entradas.push({ nome, metodo, tamanhoComprimido, deslocamentoLocal });
    p += 46 + tamNome + tamExtra + tamComentario;
  }
  return entradas;
}

function extrair(zip: Buffer, entrada: EntradaZip): Buffer {
  const p = entrada.deslocamentoLocal;
  if (zip.readUInt32LE(p) !== ASSINATURA_LOCAL) throw new DocxInvalidoError('cabeçalho de arquivo do ZIP corrompido');
  // Tamanhos do cabeçalho LOCAL, não do índice: o campo extra pode diferir entre os dois.
  const inicio = p + 30 + zip.readUInt16LE(p + 26) + zip.readUInt16LE(p + 28);
  const dados = zip.subarray(inicio, inicio + entrada.tamanhoComprimido);
  if (entrada.metodo === 0) return Buffer.from(dados);
  if (entrada.metodo === 8) return inflateRawSync(dados);
  throw new DocxInvalidoError(`compressão ZIP não suportada (método ${entrada.metodo})`);
}

function decodificarEntidades(texto: string): string {
  return texto
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** O XML do corpo do Word vira texto com a estrutura mínima que ajuda a ler o escopo. */
export function textoDoXmlWord(xml: string): string {
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
  const entradas = lerIndice(arquivo);
  const corpo = entradas.find((e) => e.nome === 'word/document.xml');
  if (!corpo) throw new DocxInvalidoError('o arquivo não tem word/document.xml — é mesmo um .docx?');
  return textoDoXmlWord(extrair(arquivo, corpo).toString('utf8'));
}
