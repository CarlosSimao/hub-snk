import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CliDoAutosync } from './cliDoAutosync.ts';
import type {
  AlvoDoAutosync,
  ConfiguracaoDoAutosync,
  RepositorioDoAutosync,
  StatusDoAutosync,
  TarefaDoAgendador,
  VisaoDoAutosync,
} from './tiposDoAutosync.ts';

/**
 * Chave de comparação de caminho: barras unificadas, sem barra final, minúsculas.
 *
 * O `config.json` mistura `C:/...` (gravado pela interface do autosync) e `C:\\...`
 * (gravado pelo CLI, que resolve o caminho), e o Windows não diferencia maiúsculas.
 * Serve só para comparar: o caminho enviado ao CLI é sempre o original.
 */
export function normalizarCaminho(caminho: string): string {
  return caminho.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Pasta-mãe imediata, já na forma normalizada. */
export function paiNormalizado(caminho: string): string {
  const normalizado = normalizarCaminho(caminho);
  const barra = normalizado.lastIndexOf('/');
  return barra <= 0 ? normalizado : normalizado.slice(0, barra);
}

/**
 * A raiz que cobre o repositório: o autosync só olha as subpastas diretas de um alvo
 * `root`, então é o pai imediato que precisa casar, não qualquer ancestral.
 */
export function raizQueCobre(
  alvos: readonly AlvoDoAutosync[],
  caminho: string,
): AlvoDoAutosync | undefined {
  const pai = paiNormalizado(caminho);
  return alvos.find((alvo) => alvo.type === 'root' && normalizarCaminho(alvo.path) === pai);
}

export function alvoProprio(
  alvos: readonly AlvoDoAutosync[],
  caminho: string,
): AlvoDoAutosync | undefined {
  const chave = normalizarCaminho(caminho);
  return alvos.find((alvo) => alvo.type === 'repo' && normalizarCaminho(alvo.path) === chave);
}

export function estaExcluidoDaRaiz(raiz: AlvoDoAutosync, caminho: string): boolean {
  const chave = normalizarCaminho(caminho);
  return (raiz.exclude ?? []).some((excluido) => normalizarCaminho(excluido) === chave);
}

/**
 * Subpastas diretas com `.git`, como o `resolve_targets_detailed` do autosync.
 * Raiz que sumiu do disco não tem repositório nenhum, e isso não é erro.
 */
export async function listarRepositoriosDaRaiz(raiz: string): Promise<string[]> {
  try {
    const entradas = await readdir(raiz, { withFileTypes: true });
    return entradas
      .filter((entrada) => entrada.isDirectory() && existsSync(join(raiz, entrada.name, '.git')))
      .map((entrada) => join(raiz, entrada.name));
  } catch {
    return [];
  }
}

export interface EntradasDaVisao {
  instalado: boolean;
  versao: string | null;
  configuracao: ConfiguracaoDoAutosync | null;
  status: StatusDoAutosync | null;
  tarefas: TarefaDoAgendador[];
  /** Repositórios encontrados em cada alvo `root`, pelo caminho do alvo como está no config. */
  repositoriosPorRaiz: ReadonlyMap<string, readonly string[]>;
}

/**
 * Cruza config e status numa linha por repositório.
 *
 * Nenhum dos dois arquivos sozinho serve: o config lista alvos (uma raiz cobre N
 * repositórios sem nomear nenhum) e o status lista o que já rodou, sem dizer se ainda
 * está no agendamento. A união dos dois, mais a varredura das raízes, é a lista honesta:
 * repositório recém-cadastrado aparece antes da primeira rodada, e o que saiu do
 * autosync continua visível com o último resultado.
 */
export function montarVisao(entradas: EntradasDaVisao): VisaoDoAutosync {
  const { configuracao, status } = entradas;
  const alvos = configuracao?.targets ?? [];
  const estados = status?.repos ?? {};
  const politicas = configuracao?.repoPolicies ?? {};

  const porChave = new Map<string, { caminho: string }>();
  const registrar = (caminho: string): void => {
    const chave = normalizarCaminho(caminho);
    if (!porChave.has(chave)) {
      porChave.set(chave, { caminho });
    }
  };

  for (const alvo of alvos) {
    if (alvo.type === 'repo') {
      registrar(alvo.path);
    } else {
      for (const caminho of entradas.repositoriosPorRaiz.get(alvo.path) ?? []) {
        registrar(caminho);
      }
    }
  }
  for (const caminho of Object.keys(estados)) {
    registrar(caminho);
  }

  const buscarPorChave = <T>(registro: Record<string, T>, chave: string): T | null => {
    const encontrada = Object.keys(registro).find((c) => normalizarCaminho(c) === chave);
    return encontrada === undefined ? null : (registro[encontrada] ?? null);
  };

  const repositorios: RepositorioDoAutosync[] = [...porChave.entries()]
    .map(([chave, { caminho }]) => {
      const proprio = alvoProprio(alvos, caminho);
      const raiz = proprio ? undefined : raizQueCobre(alvos, caminho);

      let ativo = false;
      if (proprio) {
        ativo = proprio.enabled !== false;
      } else if (raiz) {
        ativo = raiz.enabled !== false && !estaExcluidoDaRaiz(raiz, caminho);
      }

      return {
        caminho,
        alvo: proprio?.path ?? raiz?.path ?? '',
        alvoProprio: proprio !== undefined,
        ativo,
        politica: buscarPorChave(politicas, chave),
        estado: buscarPorChave(estados, chave),
      };
    })
    .sort((a, b) => a.caminho.localeCompare(b.caminho, 'pt-BR'));

  return {
    instalado: entradas.instalado,
    versao: entradas.versao,
    horarios: configuracao?.schedules ?? [],
    tarefas: entradas.tarefas,
    ultimaExecucao: status?.lastSyncRun ?? null,
    bandeja: configuracao?.trayEnabled === true,
    ia: {
      ligada: configuracao?.aiEnabled === true,
      /* `auto`: o CLI escolhe o primeiro agente instalado, na ordem claude, codex, opencode. */
      agente: configuracao?.aiAgent ?? 'auto',
    },
    agenteDaTarefa: configuracao?.scheduleAgent ?? null,
    ramoDoMr: configuracao?.mrTargetBranch ?? 'main',
    alvos,
    repositorios,
  };
}

/** Lê tudo o que a visão precisa. O Agendador é melhor esforço: falhar não derruba a tela. */
export async function lerVisao(
  cli: CliDoAutosync,
  listarDaRaiz: (raiz: string) => Promise<string[]> = listarRepositoriosDaRaiz,
): Promise<VisaoDoAutosync> {
  const [configuracao, status, tarefas, versao] = await Promise.all([
    cli.lerConfiguracao(),
    cli.lerStatus(),
    cli.listarTarefas().catch(() => []),
    cli.versao(),
  ]);

  const raizes = (configuracao?.targets ?? []).filter((alvo) => alvo.type === 'root');
  const repositoriosPorRaiz = new Map(
    await Promise.all(
      raizes.map(async (raiz) => [raiz.path, await listarDaRaiz(raiz.path)] as const),
    ),
  );

  return montarVisao({
    instalado: cli.instalado(),
    versao,
    configuracao,
    status,
    tarefas,
    repositoriosPorRaiz,
  });
}
