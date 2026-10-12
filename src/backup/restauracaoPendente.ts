/**
 * Restauração em duas etapas: a tela escolhe o backup e ele fica guardado, à espera; a
 * troca dos arquivos acontece na largada seguinte do HUB SNK.
 *
 * Não dá para trocar com o HUB SNK aberto: o `sankhya.db` está em uso, e o Windows não
 * deixa substituir um arquivo aberto — e os repositórios regravariam por cima do
 * restaurado o que têm em memória.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  conferirPacote,
  extrairPacote,
  montarPacote,
  type ManifestoDoPacote,
} from './pacoteDeDados.ts';

const NOME_DO_PENDENTE = 'restauracao-pendente.zip';
const NOME_DO_RECUSADO = 'restauracao-recusada.zip';
const PREFIXO_DA_COPIA_ANTERIOR = 'antes-da-restauracao-';
/** Restaurar o backup errado tem volta: os dados de antes ficam guardados, até este tanto. */
const COPIAS_ANTERIORES_MANTIDAS = 3;

export interface ResultadoDaRestauracao {
  /** Quando o backup restaurado foi feito. */
  geradoEm: string;
  /** Onde ficaram os dados que estavam na pasta antes da restauração. */
  copiaAnterior: string;
  /** Vazio quando deu certo. */
  erro: string;
}

function caminhoDoPendente(pastaDeEstado: string): string {
  return join(pastaDeEstado, NOME_DO_PENDENTE);
}

/** O pacote já chega conferido: só é guardado o que dá para restaurar. */
export async function agendarRestauracao(pastaDeEstado: string, pacote: Buffer): Promise<void> {
  await mkdir(pastaDeEstado, { recursive: true });
  const destino = caminhoDoPendente(pastaDeEstado);
  await writeFile(`${destino}.tmp`, pacote);
  await rename(`${destino}.tmp`, destino);
}

async function lerPendente(pastaDeEstado: string): Promise<Buffer | null> {
  try {
    return await readFile(caminhoDoPendente(pastaDeEstado));
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw erro;
  }
}

/** O manifesto do backup à espera do reinício, ou `null` sem restauração agendada. */
export async function restauracaoAgendada(
  pastaDeEstado: string,
): Promise<ManifestoDoPacote | null> {
  const pacote = await lerPendente(pastaDeEstado);
  if (!pacote) {
    return null;
  }
  try {
    return conferirPacote(pacote);
  } catch {
    return null;
  }
}

export async function cancelarRestauracao(pastaDeEstado: string): Promise<void> {
  await rm(caminhoDoPendente(pastaDeEstado), { force: true });
}

function carimbo(data: Date): string {
  return data.toISOString().replace(/[:.]/g, '-');
}

async function descartarCopiasAnterioresAntigas(pastaDeEstado: string): Promise<void> {
  const nomes = (await readdir(pastaDeEstado))
    .filter((nome) => nome.startsWith(PREFIXO_DA_COPIA_ANTERIOR) && nome.endsWith('.zip'))
    .sort()
    .reverse();
  for (const nome of nomes.slice(COPIAS_ANTERIORES_MANTIDAS)) {
    await rm(join(pastaDeEstado, nome), { force: true });
  }
}

/**
 * Chamada na largada, antes de qualquer repositório ler a pasta de dados e de o SQLite
 * abrir. Devolve `null` quando não havia restauração à espera.
 *
 * Uma restauração que falha não pode impedir o HUB SNK de abrir, nem se repetir a cada
 * abertura: o pacote sai da espera de qualquer jeito, e o erro volta para ser mostrado.
 */
export async function aplicarRestauracaoPendente(parametros: {
  pastaDeEstado: string;
  diretorioDeDados: string;
  versaoDoAplicativo: string;
  agora: Date;
}): Promise<ResultadoDaRestauracao | null> {
  const { pastaDeEstado, diretorioDeDados, versaoDoAplicativo, agora } = parametros;
  const pacote = await lerPendente(pastaDeEstado);
  if (!pacote) {
    return null;
  }

  const copiaAnterior = join(pastaDeEstado, `${PREFIXO_DA_COPIA_ANTERIOR}${carimbo(agora)}.zip`);
  let geradoEm = '';
  try {
    geradoEm = conferirPacote(pacote).geradoEm;
    await writeFile(
      copiaAnterior,
      await montarPacote({ diretorioDeDados, versaoDoAplicativo, agora }),
    );
    await extrairPacote(pacote, diretorioDeDados);
    await cancelarRestauracao(pastaDeEstado);
    await descartarCopiasAnterioresAntigas(pastaDeEstado);
    return { geradoEm, copiaAnterior, erro: '' };
  } catch (erro) {
    await rename(caminhoDoPendente(pastaDeEstado), join(pastaDeEstado, NOME_DO_RECUSADO)).catch(
      () => undefined,
    );
    return {
      geradoEm,
      copiaAnterior,
      erro: erro instanceof Error ? erro.message : String(erro),
    };
  }
}
