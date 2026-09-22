import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/*
 * Todo arquivo da pasta de dados é gravado dentro de um envelope que declara em
 * qual formato ele está:
 *
 *     { "versaoDoEsquema": 1, "clientes": [ ... ] }
 *
 * Sem esse número, uma versão antiga do HUB SNK abriria um arquivo gravado por
 * uma versão nova, leria os campos que reconhece, ignoraria o resto e apagaria o
 * que não entendeu na primeira gravação — perda silenciosa. Com ele, a leitura
 * para na hora e diz o que fazer.
 *
 * Arquivos anteriores a este envelope não têm o campo. São tratados como versão
 * zero: migram na primeira leitura, depois de uma cópia de segurança.
 */

export const VERSAO_ATUAL_DO_ESQUEMA = 1;
export const VERSAO_DE_ARQUIVO_SEM_ENVELOPE = 0;

const CAMPO_DA_VERSAO = 'versaoDoEsquema';
const IDENTACAO_JSON = 2;
const SUFIXO_DA_COPIA = '.esquema';
const SUFIXO_TEMPORARIO = '.tmp';

export class EsquemaMaisNovoError extends Error {
  constructor(caminhoDoArquivo: string, versaoDoArquivo: number) {
    super(
      `O arquivo ${caminhoDoArquivo} está no esquema ${versaoDoArquivo}, e esta versão do HUB SNK ` +
        `entende até o ${VERSAO_ATUAL_DO_ESQUEMA}. Atualize o HUB SNK: abrir o cadastro assim ` +
        'descartaria o que a versão mais nova gravou.',
    );
    this.name = 'EsquemaMaisNovoError';
  }
}

export class ArquivoDeDadosInvalidoError extends Error {
  constructor(caminhoDoArquivo: string, motivo: string) {
    super(`Arquivo de dados inválido em ${caminhoDoArquivo}: ${motivo}.`);
    this.name = 'ArquivoDeDadosInvalidoError';
  }
}

export interface ConteudoDoArquivo {
  /** O que estava sob a chave do envelope, ou o JSON inteiro quando não havia envelope. */
  corpo: unknown;
  /** Zero para arquivo anterior ao envelope. */
  versaoDeOrigem: number;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function lerVersaoDoEnvelope(dados: Record<string, unknown>, caminhoDoArquivo: string): number {
  const versao = dados[CAMPO_DA_VERSAO];
  if (typeof versao !== 'number' || !Number.isInteger(versao) || versao < 1) {
    throw new ArquivoDeDadosInvalidoError(
      caminhoDoArquivo,
      `"${CAMPO_DA_VERSAO}" deveria ser um inteiro a partir de 1, e veio ${JSON.stringify(versao)}`,
    );
  }

  return versao;
}

/**
 * Devolve `null` quando o arquivo ainda não existe — instalação nova, que começa
 * do conteúdo inicial de cada repositório em vez de erro.
 */
export async function lerArquivoDeDados(
  caminhoDoArquivo: string,
  chaveDoCorpo: string,
): Promise<ConteudoDoArquivo | null> {
  let conteudo: string;
  try {
    conteudo = await readFile(caminhoDoArquivo, 'utf8');
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw erro;
  }

  let dados: unknown;
  try {
    dados = JSON.parse(conteudo);
  } catch (erro) {
    throw new ArquivoDeDadosInvalidoError(
      caminhoDoArquivo,
      `não é um JSON válido (${erro instanceof Error ? erro.message : String(erro)})`,
    );
  }

  if (!ehObjeto(dados) || !(CAMPO_DA_VERSAO in dados)) {
    return { corpo: dados, versaoDeOrigem: VERSAO_DE_ARQUIVO_SEM_ENVELOPE };
  }

  const versaoDeOrigem = lerVersaoDoEnvelope(dados, caminhoDoArquivo);
  if (versaoDeOrigem > VERSAO_ATUAL_DO_ESQUEMA) {
    throw new EsquemaMaisNovoError(caminhoDoArquivo, versaoDeOrigem);
  }

  if (!(chaveDoCorpo in dados)) {
    throw new ArquivoDeDadosInvalidoError(caminhoDoArquivo, `falta a chave "${chaveDoCorpo}"`);
  }

  return { corpo: dados[chaveDoCorpo], versaoDeOrigem };
}

export function precisaMigrar(conteudo: ConteudoDoArquivo): boolean {
  return conteudo.versaoDeOrigem < VERSAO_ATUAL_DO_ESQUEMA;
}

/**
 * Escrita atômica: grava num arquivo ao lado e renomeia por cima. Uma queda no
 * meio da gravação deixa o arquivo antigo intacto em vez de um pela metade.
 */
export async function gravarArquivoDeDados(
  caminhoDoArquivo: string,
  chaveDoCorpo: string,
  corpo: unknown,
): Promise<void> {
  await mkdir(dirname(caminhoDoArquivo), { recursive: true });

  const envelope = { [CAMPO_DA_VERSAO]: VERSAO_ATUAL_DO_ESQUEMA, [chaveDoCorpo]: corpo };
  const caminhoTemporario = `${caminhoDoArquivo}${SUFIXO_TEMPORARIO}`;

  await writeFile(caminhoTemporario, JSON.stringify(envelope, null, IDENTACAO_JSON), 'utf8');
  await rename(caminhoTemporario, caminhoDoArquivo);
}

/**
 * Guarda o arquivo como está antes de reescrevê-lo no formato novo e devolve o
 * caminho da cópia.
 *
 * Uma cópia por versão de origem, e a primeira vence: repetir a migração — por
 * restaurar um backup antigo, por exemplo — não pode sobrescrever a cópia que
 * guardava o estado original.
 */
export async function guardarCopiaAntesDeMigrar(
  caminhoDoArquivo: string,
  versaoDeOrigem: number,
): Promise<string> {
  const caminhoDaCopia = `${caminhoDoArquivo}${SUFIXO_DA_COPIA}${versaoDeOrigem}`;

  try {
    await copyFile(caminhoDoArquivo, caminhoDaCopia, constants.COPYFILE_EXCL);
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw erro;
    }
  }

  return caminhoDaCopia;
}

/**
 * Migração completa de um arquivo lido em formato antigo: cópia de segurança e
 * regravação no esquema atual, já com o corpo normalizado por quem chamou.
 */
export async function migrarArquivoDeDados(parametros: {
  caminhoDoArquivo: string;
  chaveDoCorpo: string;
  corpo: unknown;
  versaoDeOrigem: number;
}): Promise<void> {
  const { caminhoDoArquivo, chaveDoCorpo, corpo, versaoDeOrigem } = parametros;

  await guardarCopiaAntesDeMigrar(caminhoDoArquivo, versaoDeOrigem);
  await gravarArquivoDeDados(caminhoDoArquivo, chaveDoCorpo, corpo);
}
