/**
 * O pacote de backup: a pasta de dados inteira num `.zip`, e o caminho de volta.
 *
 * O mesmo pacote serve ao backup periódico numa pasta do computador e à cópia mantida no
 * Google Drive. Quem restaura é sempre `extrairPacote`, de um arquivo ou do Drive.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { VERSAO_ATUAL_DO_ESQUEMA } from '../repositorio/arquivo/arquivoDeDados.ts';
import { criarZip, lerZip, ZipInvalidoError, type EntradaParaZip } from './zip.ts';

export const NOME_DO_MANIFESTO = 'hub-snk-backup.json';
const GERADOR_DO_MANIFESTO = 'hub-snk';

/**
 * Subpastas que não são dado do cadastro. Só existem dentro da pasta de dados quando o
 * backend roda sem o aplicativo desktop, que as põe em `%APPDATA%`.
 */
const PASTAS_FORA_DO_PACOTE = new Set(['log', 'suporte', 'backup']);
/** Gravação pela metade e os arquivos auxiliares do SQLite, que o retrato do banco dispensa. */
const SUFIXOS_FORA_DO_PACOTE = ['.tmp', '-wal', '-shm', '-journal'];
const SUFIXOS_AUXILIARES_DO_SQLITE = ['-wal', '-shm', '-journal'];
const EXTENSAO_DE_BANCO = '.db';

export class PacoteInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Este arquivo não é um backup do HUB SNK que dê para restaurar: ${motivo}.`);
    this.name = 'PacoteInvalidoError';
  }
}

export interface ManifestoDoPacote {
  geradoPor: string;
  geradoEm: string;
  versaoDoAplicativo: string;
  versaoDoEsquema: number;
  arquivos: number;
}

interface ArquivoDosDados {
  /** Caminho relativo à pasta de dados, com `/` entre as pastas. */
  relativo: string;
  caminho: string;
  tamanho: number;
  modificadoEmMs: number;
}

function ehBanco(relativo: string): boolean {
  return relativo.endsWith(EXTENSAO_DE_BANCO);
}

async function listarArquivosDosDados(diretorioDeDados: string): Promise<ArquivoDosDados[]> {
  const arquivos: ArquivoDosDados[] = [];

  async function percorrer(pasta: string, prefixo: string): Promise<void> {
    let entradas;
    try {
      entradas = await readdir(pasta, { withFileTypes: true });
    } catch (erro) {
      // Instalação nova: a pasta de dados só nasce na primeira gravação.
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw erro;
    }

    for (const entrada of entradas) {
      const relativo = prefixo ? `${prefixo}/${entrada.name}` : entrada.name;
      const caminho = join(pasta, entrada.name);

      if (entrada.isDirectory()) {
        if (prefixo === '' && PASTAS_FORA_DO_PACOTE.has(entrada.name)) {
          continue;
        }
        await percorrer(caminho, relativo);
      } else if (
        entrada.isFile() &&
        !SUFIXOS_FORA_DO_PACOTE.some((sufixo) => entrada.name.endsWith(sufixo))
      ) {
        const situacao = await stat(caminho);
        arquivos.push({
          relativo,
          caminho,
          tamanho: situacao.size,
          modificadoEmMs: situacao.mtimeMs,
        });
      }
    }
  }

  await percorrer(diretorioDeDados, '');
  return arquivos.sort((a, b) => a.relativo.localeCompare(b.relativo, 'en'));
}

/**
 * Resumo do estado dos dados, para saber se algo mudou desde o último backup sem ler
 * arquivo nenhum: nome, tamanho e data de cada um.
 *
 * No SQLite a gravação vai primeiro para o `-wal`, e o `.db` só muda no checkpoint: o
 * `-wal` entra na conta, ou uma alteração recente passaria despercebida.
 */
export async function impressaoDosDados(diretorioDeDados: string): Promise<string> {
  const resumo = createHash('sha1');

  for (const arquivo of await listarArquivosDosDados(diretorioDeDados)) {
    resumo.update(`${arquivo.relativo}|${arquivo.tamanho}|${arquivo.modificadoEmMs}\n`);
    if (ehBanco(arquivo.relativo)) {
      const wal = await stat(`${arquivo.caminho}-wal`).catch(() => null);
      resumo.update(`wal|${wal?.size ?? 0}|${wal?.mtimeMs ?? 0}\n`);
    }
  }

  return resumo.digest('hex');
}

/**
 * Conteúdo do banco num instante só. Copiar o `.db` com o HUB SNK aberto levaria um
 * arquivo sem o que ainda está no `-wal`, ou pego no meio de uma gravação; a API de
 * backup do SQLite entrega um retrato íntegro sem parar ninguém.
 */
async function retratoDoBanco(caminho: string): Promise<Buffer> {
  const pastaTemporaria = await mkdtemp(join(tmpdir(), 'hub-snk-backup-'));
  const copia = join(pastaTemporaria, 'retrato.db');
  try {
    const banco = new DatabaseSync(caminho);
    try {
      await backup(banco, copia);
    } finally {
      banco.close();
    }
    return await readFile(copia);
  } catch {
    // Um `.db` que não é SQLite válido entra como está: melhor que ficar fora do backup.
    return await readFile(caminho);
  } finally {
    await rm(pastaTemporaria, { recursive: true, force: true });
  }
}

export async function montarPacote(parametros: {
  diretorioDeDados: string;
  versaoDoAplicativo: string;
  agora: Date;
}): Promise<Buffer> {
  const { diretorioDeDados, versaoDoAplicativo, agora } = parametros;
  const arquivos = await listarArquivosDosDados(diretorioDeDados);

  const entradas: EntradaParaZip[] = [];
  for (const arquivo of arquivos) {
    entradas.push({
      nome: arquivo.relativo,
      dados: ehBanco(arquivo.relativo)
        ? await retratoDoBanco(arquivo.caminho)
        : await readFile(arquivo.caminho),
      modificadoEm: new Date(arquivo.modificadoEmMs),
    });
  }

  const manifesto: ManifestoDoPacote = {
    geradoPor: GERADOR_DO_MANIFESTO,
    geradoEm: agora.toISOString(),
    versaoDoAplicativo,
    versaoDoEsquema: VERSAO_ATUAL_DO_ESQUEMA,
    arquivos: entradas.length,
  };
  entradas.push({
    nome: NOME_DO_MANIFESTO,
    dados: Buffer.from(JSON.stringify(manifesto, null, 2), 'utf8'),
    modificadoEm: agora,
  });

  return criarZip(entradas);
}

function lerEntradas(pacote: Buffer) {
  try {
    return lerZip(pacote);
  } catch (erro) {
    if (erro instanceof ZipInvalidoError) {
      throw new PacoteInvalidoError('o .zip está corrompido');
    }
    throw erro;
  }
}

/**
 * Lê o manifesto e recusa o que não deve ser restaurado: zip que não é backup do HUB SNK
 * e backup de uma versão mais nova, cujos arquivos esta versão se recusaria a abrir.
 */
export function conferirPacote(pacote: Buffer): ManifestoDoPacote {
  const entrada = lerEntradas(pacote).find((item) => item.nome === NOME_DO_MANIFESTO);
  if (!entrada) {
    throw new PacoteInvalidoError(`falta o ${NOME_DO_MANIFESTO}`);
  }

  let manifesto: Partial<ManifestoDoPacote>;
  try {
    manifesto = JSON.parse(entrada.extrair().toString('utf8')) as Partial<ManifestoDoPacote>;
  } catch {
    throw new PacoteInvalidoError(`o ${NOME_DO_MANIFESTO} está ilegível`);
  }

  if (
    manifesto.geradoPor !== GERADOR_DO_MANIFESTO ||
    typeof manifesto.versaoDoEsquema !== 'number'
  ) {
    throw new PacoteInvalidoError(`o ${NOME_DO_MANIFESTO} não é do HUB SNK`);
  }
  if (manifesto.versaoDoEsquema > VERSAO_ATUAL_DO_ESQUEMA) {
    throw new PacoteInvalidoError(
      `ele foi feito pela versão ${manifesto.versaoDoAplicativo ?? 'mais nova'} do HUB SNK. ` +
        'Atualize o HUB SNK antes de restaurar',
    );
  }

  return {
    geradoPor: manifesto.geradoPor,
    geradoEm: String(manifesto.geradoEm ?? ''),
    versaoDoAplicativo: String(manifesto.versaoDoAplicativo ?? ''),
    versaoDoEsquema: manifesto.versaoDoEsquema,
    arquivos: Number(manifesto.arquivos ?? 0),
  };
}

/**
 * Caminho absoluto da entrada dentro da pasta de dados. O nome vem de dentro do zip, que
 * pode ter sido montado por qualquer um: `..`, caminho absoluto ou letra de unidade
 * gravariam fora da pasta.
 */
function destinoDaEntrada(diretorioDeDados: string, nome: string): string {
  const partes = nome.split('/');
  const suspeito =
    nome === '' ||
    nome.includes('\\') ||
    nome.includes(':') ||
    isAbsolute(nome) ||
    partes.some((parte) => parte === '' || parte === '.' || parte === '..');
  const destino = resolve(diretorioDeDados, partes.join(sep));
  const caminhoRelativo = relative(diretorioDeDados, destino);

  if (suspeito || caminhoRelativo.startsWith('..') || isAbsolute(caminhoRelativo)) {
    throw new PacoteInvalidoError(`ele traz um caminho que sai da pasta de dados ("${nome}")`);
  }
  return destino;
}

/**
 * Troca o conteúdo da pasta de dados pelo do pacote.
 *
 * Tudo o que o backup cobre sai antes, e não só o que o pacote traz: restaurar é voltar
 * ao estado do backup, e um arquivo criado depois dele não fazia parte desse estado. Os
 * auxiliares do SQLite saem junto — um `-wal` antigo ao lado do banco restaurado seria
 * aplicado sobre ele.
 *
 * Só pode rodar com os bancos fechados: é chamado na largada do HUB SNK.
 */
export async function extrairPacote(pacote: Buffer, diretorioDeDados: string): Promise<void> {
  conferirPacote(pacote);
  const raiz = resolve(diretorioDeDados);

  // Tudo é descomprimido e conferido antes de apagar qualquer coisa: um pacote
  // corrompido no meio não pode deixar a pasta de dados pela metade.
  const arquivos = lerEntradas(pacote)
    .filter((entrada) => entrada.nome !== NOME_DO_MANIFESTO && !entrada.nome.endsWith('/'))
    .map((entrada) => {
      try {
        return { destino: destinoDaEntrada(raiz, entrada.nome), dados: entrada.extrair() };
      } catch (erro) {
        if (erro instanceof ZipInvalidoError) {
          throw new PacoteInvalidoError(`"${entrada.nome}" está corrompido`);
        }
        throw erro;
      }
    });

  for (const atual of await listarArquivosDosDados(raiz)) {
    await rm(atual.caminho, { force: true });
    if (ehBanco(atual.relativo)) {
      for (const sufixo of SUFIXOS_AUXILIARES_DO_SQLITE) {
        await rm(`${atual.caminho}${sufixo}`, { force: true });
      }
    }
  }

  for (const arquivo of arquivos) {
    await mkdir(dirname(arquivo.destino), { recursive: true });
    await writeFile(arquivo.destino, arquivo.dados);
  }
}
