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

/** Pasta, URL e branch principal cadastradas definem o diagnóstico. */
function montarChave(repositorio: RepositorioParaVerificar): string {
  return [
    repositorio.caminhoLocal,
    repositorio.urlCadastrada,
    repositorio.branchPrincipal ?? '',
  ].join('\n');
}

async function lerComCache(
  repositorio: RepositorioParaVerificar,
  configuracao: ConfiguracaoGlobal,
  ignorarCache: boolean,
): Promise<SituacaoGit> {
  const chave = montarChave(repositorio);
  const guardada = cache.get(chave);

  if (!ignorarCache && guardada && guardada.expiraEm > Date.now()) {
    return guardada.situacao;
  }

  const situacao = await lerSituacaoDoRepositorio(repositorio);
  cache.set(chave, { situacao, expiraEm: Date.now() + tempoDeVidaMs(configuracao) });

  return situacao;
}

/**
 * Verifica os repositórios em paralelo, com no máximo `LEITURAS_SIMULTANEAS` em andamento.
 * `idsSemCache` ignora o cache só nesses repositórios, p. ex. os que acabaram de passar por `fetch`.
 */
export async function coletarSituacoes(
  repositorios: RepositorioParaVerificar[],
  configuracao: ConfiguracaoGlobal,
  forcar: boolean,
  idsSemCache: ReadonlySet<string> = new Set(),
): Promise<Record<string, SituacaoGit>> {
  const situacoes = await mapearComLimite(repositorios, LEITURAS_SIMULTANEAS, (repositorio) =>
    lerComCache(repositorio, configuracao, forcar || idsSemCache.has(repositorio.id)),
  );

  return Object.fromEntries(
    repositorios.map((repositorio, indice) => [repositorio.id, situacoes[indice] as SituacaoGit]),
  );
}
