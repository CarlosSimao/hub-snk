import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Cliente } from '../tipos.ts';
import {
  alvoProprio,
  estaExcluidoDaRaiz,
  normalizarCaminho,
  paiNormalizado,
  raizQueCobre,
} from './visaoDoAutosync.ts';
import type {
  RepositorioDeClienteNoAutosync,
  SituacaoNoAutosync,
  SugestaoDeRaiz,
  VisaoDoAutosync,
} from './tiposDoAutosync.ts';

/** Quantos repositórios de clientes no mesmo pai justificam sugerir a pasta como raiz. */
const MINIMO_PARA_SUGERIR_RAIZ = 3;

export type SituacaoDaPasta = 'repositorio' | 'ausente' | 'nao-e-repositorio';

export function inspecionarPasta(caminho: string): SituacaoDaPasta {
  try {
    if (!statSync(caminho).isDirectory()) {
      return 'ausente';
    }
  } catch {
    return 'ausente';
  }
  /* `.git` pode ser arquivo (worktree, submódulo): basta existir. */
  return existsSync(join(caminho, '.git')) ? 'repositorio' : 'nao-e-repositorio';
}

/**
 * Situação de cada repositório de cliente com pasta local diante do autosync.
 *
 * O cadastro do cliente não mexe no autosync sozinho: entrar no `config.json` é
 * ação explícita da pessoa. Esta função só diz onde cada um está e o que dá para
 * fazer — ver `SituacaoNoAutosync`.
 */
export function classificarRepositoriosDosClientes(
  clientes: readonly Cliente[],
  visao: VisaoDoAutosync,
  inspecionar: (caminho: string) => SituacaoDaPasta = inspecionarPasta,
): RepositorioDeClienteNoAutosync[] {
  const repositoriosDaVisao = new Map(
    visao.repositorios.map((repositorio) => [normalizarCaminho(repositorio.caminho), repositorio]),
  );

  return clientes.flatMap((cliente) =>
    cliente.repositorios.flatMap<RepositorioDeClienteNoAutosync>((repositorioGit) => {
      const caminho = repositorioGit.caminhoLocal?.trim();
      if (!caminho) {
        return [];
      }

      const { situacao, raiz } = situacaoNoAutosync(visao, caminho, inspecionar(caminho));
      return [
        {
          clienteId: cliente.id,
          clienteNome: cliente.nome,
          repositorioId: repositorioGit.id,
          url: repositorioGit.url,
          caminho,
          situacao,
          raiz,
          repositorio: repositoriosDaVisao.get(normalizarCaminho(caminho)) ?? null,
        },
      ];
    }),
  );
}

function situacaoNoAutosync(
  visao: VisaoDoAutosync,
  caminho: string,
  pasta: SituacaoDaPasta,
): { situacao: SituacaoNoAutosync; raiz: string | null } {
  if (pasta === 'ausente') {
    return { situacao: 'pasta-ausente', raiz: null };
  }
  if (pasta === 'nao-e-repositorio') {
    return { situacao: 'nao-e-repositorio', raiz: null };
  }

  const proprio = alvoProprio(visao.alvos, caminho);
  if (proprio) {
    return { situacao: proprio.enabled === false ? 'desligado' : 'ativo', raiz: null };
  }

  const raiz = raizQueCobre(visao.alvos, caminho);
  if (raiz) {
    if (estaExcluidoDaRaiz(raiz, caminho)) {
      return { situacao: 'excluido', raiz: raiz.path };
    }
    return { situacao: raiz.enabled === false ? 'desligado' : 'ativo', raiz: raiz.path };
  }

  return { situacao: 'fora', raiz: null };
}

/**
 * Pastas que guardam vários repositórios de clientes ainda fora do autosync.
 *
 * Cadastrar a pasta como `root` cobre todos e os futuros — mas também pega
 * repositório que a pessoa não queria sincronizar (por isso existe `exclude`).
 * Por isso é só sugestão.
 */
export function sugerirRaizes(
  repositorios: readonly RepositorioDeClienteNoAutosync[],
): SugestaoDeRaiz[] {
  const porPai = new Map<string, { pasta: string; quantidade: number }>();
  for (const repositorio of repositorios) {
    if (repositorio.situacao !== 'fora') {
      continue;
    }
    const chave = paiNormalizado(repositorio.caminho);
    const grupo = porPai.get(chave) ?? { pasta: dirname(repositorio.caminho), quantidade: 0 };
    grupo.quantidade += 1;
    porPai.set(chave, grupo);
  }

  return [...porPai.values()]
    .filter((grupo) => grupo.quantidade >= MINIMO_PARA_SUGERIR_RAIZ)
    .sort((a, b) => b.quantidade - a.quantidade);
}

/** Marca na visão os repositórios que também estão no cadastro de um cliente. */
export function vincularClientes(
  visao: VisaoDoAutosync,
  clientes: readonly Cliente[],
): VisaoDoAutosync {
  const donos = new Map<string, Cliente>();
  for (const cliente of clientes) {
    for (const repositorioGit of cliente.repositorios) {
      if (repositorioGit.caminhoLocal) {
        donos.set(normalizarCaminho(repositorioGit.caminhoLocal), cliente);
      }
    }
  }

  return {
    ...visao,
    repositorios: visao.repositorios.map((repositorio) => {
      const dono = donos.get(normalizarCaminho(repositorio.caminho));
      return dono ? { ...repositorio, clienteId: dono.id, clienteNome: dono.nome } : repositorio;
    }),
  };
}
