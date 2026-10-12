/**
 * Escrita e leitura de `.zip`, sem dependência nova: o Node já traz a compressão
 * (`zlib`) e o CRC-32, e o que falta é o formato do arquivo.
 *
 * Cobre o que o backup precisa: nomes em UTF-8, compressão deflate e arquivos abaixo de
 * 4 GB. Sem ZIP64, sem criptografia e sem arquivo em várias partes.
 */
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

const ASSINATURA_LOCAL = 0x04034b50;
const ASSINATURA_DO_DIRETORIO = 0x02014b50;
const ASSINATURA_DO_FIM_DO_DIRETORIO = 0x06054b50;
const TAMANHO_DO_CABECALHO_LOCAL = 30;
const TAMANHO_DA_ENTRADA_DO_DIRETORIO = 46;
const TAMANHO_DO_FIM_DO_DIRETORIO = 22;
const TAMANHO_MAXIMO_DO_COMENTARIO = 0xffff;

const VERSAO_NECESSARIA = 20;
/** Bit 11: o nome está em UTF-8. Sem ele, o Windows Explorer leria os acentos em CP437. */
const NOME_EM_UTF8 = 0x0800;
const METODO_SEM_COMPRESSAO = 0;
const METODO_DEFLATE = 8;

const MAIOR_TAMANHO_SEM_ZIP64 = 0xffffffff;
const MAIOR_QUANTIDADE_SEM_ZIP64 = 0xffff;

export class ZipInvalidoError extends Error {
  constructor(motivo: string) {
    super(`O arquivo não é um .zip válido: ${motivo}.`);
    this.name = 'ZipInvalidoError';
  }
}

export class ZipGrandeDemaisError extends Error {
  constructor() {
    super('Os dados passam do que um .zip comum comporta (4 GB ou 65 mil arquivos).');
    this.name = 'ZipGrandeDemaisError';
  }
}

export interface EntradaParaZip {
  /** Caminho dentro do zip, com `/` entre as pastas. */
  nome: string;
  dados: Buffer;
  modificadoEm: Date;
}

export interface EntradaDoZip {
  nome: string;
  /** Descomprime e confere o CRC: conteúdo corrompido lança `ZipInvalidoError`. */
  extrair(): Buffer;
}

/** Data e hora no formato do MS-DOS, que é o do zip: resolução de dois segundos, a partir de 1980. */
function dataDoDos(data: Date): { hora: number; dia: number } {
  const ano = Math.max(1980, data.getFullYear());
  return {
    hora: (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1),
    dia: ((ano - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate(),
  };
}

export function criarZip(entradas: EntradaParaZip[]): Buffer {
  if (entradas.length > MAIOR_QUANTIDADE_SEM_ZIP64) {
    throw new ZipGrandeDemaisError();
  }

  const partes: Buffer[] = [];
  const diretorio: Buffer[] = [];
  let posicao = 0;

  for (const entrada of entradas) {
    const nome = Buffer.from(entrada.nome, 'utf8');
    const comprimido = deflateRawSync(entrada.dados);
    // O que já é comprimido (PDF, imagem, .docx) cresce com o deflate: vai como está.
    const compensa = comprimido.length < entrada.dados.length;
    const corpo = compensa ? comprimido : entrada.dados;
    const metodo = compensa ? METODO_DEFLATE : METODO_SEM_COMPRESSAO;
    const soma = crc32(entrada.dados);
    const { hora, dia } = dataDoDos(entrada.modificadoEm);

    if (entrada.dados.length > MAIOR_TAMANHO_SEM_ZIP64 || posicao > MAIOR_TAMANHO_SEM_ZIP64) {
      throw new ZipGrandeDemaisError();
    }

    const local = Buffer.alloc(TAMANHO_DO_CABECALHO_LOCAL);
    local.writeUInt32LE(ASSINATURA_LOCAL, 0);
    local.writeUInt16LE(VERSAO_NECESSARIA, 4);
    local.writeUInt16LE(NOME_EM_UTF8, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(entrada.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);

    const noDiretorio = Buffer.alloc(TAMANHO_DA_ENTRADA_DO_DIRETORIO);
    noDiretorio.writeUInt32LE(ASSINATURA_DO_DIRETORIO, 0);
    noDiretorio.writeUInt16LE(VERSAO_NECESSARIA, 4);
    noDiretorio.writeUInt16LE(VERSAO_NECESSARIA, 6);
    noDiretorio.writeUInt16LE(NOME_EM_UTF8, 8);
    noDiretorio.writeUInt16LE(metodo, 10);
    noDiretorio.writeUInt16LE(hora, 12);
    noDiretorio.writeUInt16LE(dia, 14);
    noDiretorio.writeUInt32LE(soma, 16);
    noDiretorio.writeUInt32LE(corpo.length, 20);
    noDiretorio.writeUInt32LE(entrada.dados.length, 24);
    noDiretorio.writeUInt16LE(nome.length, 28);
    noDiretorio.writeUInt32LE(posicao, 42);

    partes.push(local, nome, corpo);
    diretorio.push(noDiretorio, nome);
    posicao += local.length + nome.length + corpo.length;
  }

  const tamanhoDoDiretorio = diretorio.reduce((total, parte) => total + parte.length, 0);
  if (posicao + tamanhoDoDiretorio > MAIOR_TAMANHO_SEM_ZIP64) {
    throw new ZipGrandeDemaisError();
  }

  const fim = Buffer.alloc(TAMANHO_DO_FIM_DO_DIRETORIO);
  fim.writeUInt32LE(ASSINATURA_DO_FIM_DO_DIRETORIO, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(tamanhoDoDiretorio, 12);
  fim.writeUInt32LE(posicao, 16);

  return Buffer.concat([...partes, ...diretorio, fim]);
}

function acharFimDoDiretorio(zip: Buffer): number {
  // O registro de fim fica nos últimos 22 bytes, mais um comentário de até 64 KB.
  const inicioDaBusca = Math.max(
    0,
    zip.length - TAMANHO_DO_FIM_DO_DIRETORIO - TAMANHO_MAXIMO_DO_COMENTARIO,
  );
  for (
    let posicao = zip.length - TAMANHO_DO_FIM_DO_DIRETORIO;
    posicao >= inicioDaBusca;
    posicao -= 1
  ) {
    if (zip.readUInt32LE(posicao) === ASSINATURA_DO_FIM_DO_DIRETORIO) {
      return posicao;
    }
  }
  throw new ZipInvalidoError('índice não encontrado');
}

export function lerZip(zip: Buffer): EntradaDoZip[] {
  const fim = acharFimDoDiretorio(zip);
  const total = zip.readUInt16LE(fim + 10);
  let posicao = zip.readUInt32LE(fim + 16);
  const entradas: EntradaDoZip[] = [];

  for (let lidas = 0; lidas < total; lidas += 1) {
    if (
      posicao + TAMANHO_DA_ENTRADA_DO_DIRETORIO > zip.length ||
      zip.readUInt32LE(posicao) !== ASSINATURA_DO_DIRETORIO
    ) {
      throw new ZipInvalidoError('índice ilegível');
    }

    const metodo = zip.readUInt16LE(posicao + 10);
    const soma = zip.readUInt32LE(posicao + 16);
    const tamanhoComprimido = zip.readUInt32LE(posicao + 20);
    const tamanhoDoNome = zip.readUInt16LE(posicao + 28);
    const tamanhoDoExtra = zip.readUInt16LE(posicao + 30);
    const tamanhoDoComentario = zip.readUInt16LE(posicao + 32);
    const deslocamentoLocal = zip.readUInt32LE(posicao + 42);
    const nome = zip.toString(
      'utf8',
      posicao + TAMANHO_DA_ENTRADA_DO_DIRETORIO,
      posicao + TAMANHO_DA_ENTRADA_DO_DIRETORIO + tamanhoDoNome,
    );

    entradas.push({
      nome,
      extrair: () => extrair(zip, { nome, metodo, soma, tamanhoComprimido, deslocamentoLocal }),
    });
    posicao +=
      TAMANHO_DA_ENTRADA_DO_DIRETORIO + tamanhoDoNome + tamanhoDoExtra + tamanhoDoComentario;
  }

  return entradas;
}

function extrair(
  zip: Buffer,
  entrada: {
    nome: string;
    metodo: number;
    soma: number;
    tamanhoComprimido: number;
    deslocamentoLocal: number;
  },
): Buffer {
  const posicao = entrada.deslocamentoLocal;
  if (
    posicao + TAMANHO_DO_CABECALHO_LOCAL > zip.length ||
    zip.readUInt32LE(posicao) !== ASSINATURA_LOCAL
  ) {
    throw new ZipInvalidoError(`cabeçalho de "${entrada.nome}" ilegível`);
  }

  // Tamanhos do cabeçalho local, não do índice: o campo extra pode diferir entre os dois.
  const inicio =
    posicao +
    TAMANHO_DO_CABECALHO_LOCAL +
    zip.readUInt16LE(posicao + 26) +
    zip.readUInt16LE(posicao + 28);
  const corpo = zip.subarray(inicio, inicio + entrada.tamanhoComprimido);

  let dados: Buffer;
  if (entrada.metodo === METODO_SEM_COMPRESSAO) {
    dados = Buffer.from(corpo);
  } else if (entrada.metodo === METODO_DEFLATE) {
    try {
      dados = inflateRawSync(corpo);
    } catch {
      throw new ZipInvalidoError(`"${entrada.nome}" está corrompido`);
    }
  } else {
    throw new ZipInvalidoError(`compressão de "${entrada.nome}" não suportada`);
  }

  if (crc32(dados) !== entrada.soma) {
    throw new ZipInvalidoError(`"${entrada.nome}" está corrompido`);
  }
  return dados;
}
