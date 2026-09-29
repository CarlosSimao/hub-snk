import { mapearComLimite } from '../sistema/mapearComLimite.ts';
import type { ConfiguracaoGlobal, SituacaoGit } from '../tipos.ts';
import { lerSituacaoDoRepositorio, type DadosDoRepositorio } from './situacaoDoRepositorio.ts';

/**
 * O diagnóstico dispara cinco processos `git` por repositório. Sem cache,
 * cada clique na tela repetiria tudo; sem limite de paralelismo, um cadastro
 * grande abriria dezenas de processos de uma vez.
 */
const TEMPO_DE_VIDA_MAXIMO_MS = 30_000;
const LEITURAS_SIMULTANEAS = 6;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;

/**
 * Nunca maior que o intervalo de execução automática: com o cache mais longo
 * que o tique, a atualização periódica devolveria sempre o mesmo diagnóstico
 * guardado e a tela nunca mudaria sozinha.
 */
function tempoDeVidaMs(configuracao: ConfiguracaoGlobal): number {
  return Math.min(
    TEMPO_DE_VIDA_MAXIMO_MS,
    configuracao.intervaloDeExecucaoAutomaticaSegundos * MILISSEGUNDOS_POR_SEGUNDO,
  );
}

export interface RepositorioParaVerificar extends DadosDoRepositorio {
  id: string;
}

interface EntradaDoCache {
  situacao: SituacaoGit;
  expiraEm: number;
}

/*
 * Cresce no máximo até o número de repositórios cadastrados: a chave é o que
 * define o resultado, e nenhum deles é gerado dinamicamente.
 */
const cache = new Map<string, EntradaDoCache>();

/** O par pasta + URL cadastrada é o que define o diagnóstico. */
function montarChave(repositorio: RepositorioParaVerificar): string {
  return [repositorio.caminhoLocal, repositorio.urlCadastrada].join('\n');
}

async function lerComCache(
  repositorio: RepositorioParaVerificar,
  configuracao: ConfiguracaoGlobal,
  forcar: boolean,
): Promise<SituacaoGit> {
  const chave = montarChave(repositorio);
  const guardada = cache.get(chave);

  if (!forcar && guardada && guardada.expiraEm > Date.now()) {
    return guardada.situacao;
  }

  const situacao = await lerSituacaoDoRepositorio(repositorio);
  cache.set(chave, { situacao, expiraEm: Date.now() + tempoDeVidaMs(configuracao) });

  return situacao;
}

/** Verifica os repositórios em paralelo, com no máximo `LEITURAS_SIMULTANEAS` em andamento. */
export async function coletarSituacoes(
  repositorios: RepositorioParaVerificar[],
  configuracao: ConfiguracaoGlobal,
  forcar: boolean,
): Promise<Record<string, SituacaoGit>> {
  const situacoes = await mapearComLimite(repositorios, LEITURAS_SIMULTANEAS, (repositorio) =>
    lerComCache(repositorio, configuracao, forcar),
  );

  return Object.fromEntries(
    repositorios.map((repositorio, indice) => [repositorio.id, situacoes[indice] as SituacaoGit]),
  );
}
