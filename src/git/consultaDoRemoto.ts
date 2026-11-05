import { mapearComLimite } from '../sistema/mapearComLimite.ts';
import { executarGit, GitIndisponivelError } from './executarGit.ts';

const CONSULTAS_SIMULTANEAS = 6;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;
/** Remoto `.` significa "upstream local": não há o que buscar na rede. */
const REMOTO_LOCAL = '.';

export interface ConsultaDoRemoto {
  consultadoEm: number;
  ok: boolean;
}

export interface RepositorioParaConsultar {
  caminhoLocal: string;
  branchPrincipal?: string;
}

/*
 * Cresce no máximo até o número de repositórios cadastrados. Só em memória: depois de
 * reiniciar o HUB SNK o `-M` do status é velho e não pode ser usado até um novo fetch.
 */
const ultimasConsultas = new Map<string, ConsultaDoRemoto>();

export function ultimaConsultaDoRemoto(caminhoLocal: string): ConsultaDoRemoto | undefined {
  return ultimasConsultas.get(caminhoLocal);
}

/** Uso exclusivo de testes: esquece o que foi consultado. */
export function esquecerConsultasDoRemoto(): void {
  ultimasConsultas.clear();
}

/** Remoto que a branch atual acompanha, ou `null` sem branch ou sem upstream. */
async function descobrirRemotoDoUpstream(
  caminhoLocal: string,
  branchPrincipal: string,
): Promise<string | null> {
  const branchAtual = await executarGit(caminhoLocal, ['symbolic-ref', '--short', '-q', 'HEAD']);
  if (!branchAtual.sucesso || branchAtual.saida.trim() !== branchPrincipal) {
    return null;
  }

  const remoto = await executarGit(caminhoLocal, [
    'config',
    '--get',
    `branch.${branchPrincipal}.remote`,
  ]);
  const nome = remoto.saida.trim();

  return remoto.sucesso && nome !== '' && nome !== REMOTO_LOCAL ? nome : null;
}

/**
 * Roda `git fetch --quiet <remoto>` só em repositório que está na branch principal e
 * tem upstream. Nunca lança: a falha vira `ok: false`, que o diagnóstico mostra como
 * "remoto não consultado".
 */
async function consultarUmRemoto(
  { caminhoLocal, branchPrincipal }: RepositorioParaConsultar,
  tempoLimiteMs: number,
): Promise<void> {
  if (!branchPrincipal) {
    return;
  }

  try {
    const remoto = await descobrirRemotoDoUpstream(caminhoLocal, branchPrincipal);
    if (remoto === null) {
      return;
    }

    const resultado = await executarGit(caminhoLocal, ['fetch', '--quiet', remoto], tempoLimiteMs);
    ultimasConsultas.set(caminhoLocal, { consultadoEm: Date.now(), ok: resultado.sucesso });
  } catch (erro) {
    if (!(erro instanceof GitIndisponivelError)) {
      throw erro;
    }
    ultimasConsultas.set(caminhoLocal, { consultadoEm: Date.now(), ok: false });
  }
}

export async function consultarRemotoDosRepositorios(
  repositorios: RepositorioParaConsultar[],
  tempoLimiteSegundos: number,
): Promise<void> {
  const tempoLimiteMs = tempoLimiteSegundos * MILISSEGUNDOS_POR_SEGUNDO;

  await mapearComLimite(repositorios, CONSULTAS_SIMULTANEAS, (repositorio) =>
    consultarUmRemoto(repositorio, tempoLimiteMs),
  );
}
