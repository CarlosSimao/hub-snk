/**
 * Formatos do Git AutoSync: o que ele grava em `~/.git-autosync` e o que o HUB SNK
 * monta em cima disso para a tela.
 *
 * Os campos dos arquivos ficam em inglês porque são do autosync (`config.json` e
 * `status.json`); os da visão, em português, porque são do HUB SNK.
 */

export const AGENTES_DE_IA = ['auto', 'claude', 'codex', 'opencode'] as const;

export type AgenteDeIa = (typeof AGENTES_DE_IA)[number];

/** Horário da rodada agendada, validado pelo mesmo critério do `save_config` do autosync. */
export const FORMATO_DE_HORARIO = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * Um alvo do `config.json`. `repo` é um repositório; `root` é uma pasta cujas
 * subpastas diretas com `.git` entram sozinhas, menos as de `exclude`.
 */
export interface AlvoDoAutosync {
  path: string;
  type: 'repo' | 'root';
  enabled?: boolean;
  exclude?: string[];
}

/** `config.repoPolicies[caminho]`. Cada campo ausente vale o padrão do autosync. */
export interface PoliticaDoRepositorio {
  include?: string[];
  exclude?: string[];
  allowedBranches?: string[];
  maxFileBytes?: number;
  aiEnabled?: boolean;
}

/**
 * O `config.json` do autosync. Só leitura para o HUB SNK: toda escrita passa por um
 * subcomando do CLI, que toma o `state.lock` e grava de forma atômica.
 */
export interface ConfiguracaoDoAutosync {
  schedules?: string[];
  targets?: AlvoDoAutosync[];
  taskName?: string;
  trayEnabled?: boolean;
  aiAgent?: string;
  scheduleAgent?: string | null;
  mrTargetBranch?: string;
  aiEnabled?: boolean;
  repoPolicies?: Record<string, PoliticaDoRepositorio>;
}

/**
 * Último resultado de um repositório no `status.json`.
 *
 * `message` é o texto do autosync sem reescrever: é ali que aparece o motivo de um
 * commit recusado (arquivo sensível, branch fora da política, conflito pendente).
 */
export interface EstadoDoRepositorio {
  lastRun?: string;
  lastPush?: string;
  success?: boolean;
  hadChanges?: boolean;
  pushed?: boolean;
  message?: string;
  state?: 'synced' | 'pending_push' | 'failed' | string;
}

export interface StatusDoAutosync {
  lastSyncRun?: string;
  repos?: Record<string, EstadoDoRepositorio>;
}

/** Uma tarefa do Agendador do Windows, ou uma linha do crontab no Linux e no macOS. */
export interface TarefaDoAgendador {
  nome: string;
  estado: string;
  proximaExecucao: string;
  ultimaExecucao: string;
  ultimoResultado: number | null;
}

/** Um commit do `history --json`. */
export interface CommitDoAutosync {
  hash: string;
  date: string;
  message: string;
}

export interface RepositorioDoAutosync {
  caminho: string;
  /** O próprio caminho se for alvo próprio; a raiz que o cobre; `''` se só consta no status. */
  alvo: string;
  alvoProprio: boolean;
  /** Não está no `exclude` da raiz e o alvo não tem `enabled: false`. */
  ativo: boolean;
  politica: PoliticaDoRepositorio | null;
  estado: EstadoDoRepositorio | null;
  /** Preenchido quando o repositório também está no cadastro de um cliente. */
  clienteId?: string;
  clienteNome?: string;
}

/** Tudo o que a tela do Git AutoSync precisa, numa chamada só. */
export interface VisaoDoAutosync {
  instalado: boolean;
  /** Conteúdo de `bin/VERSION`, lido como arquivo, sem executar nada. */
  versao: string | null;
  horarios: string[];
  /**
   * O que o Agendador realmente tem. Vazio com `horarios` preenchido é agendamento
   * que parece configurado e nunca roda — a tela deixa isso visível.
   */
  tarefas: TarefaDoAgendador[];
  ultimaExecucao: string | null;
  bandeja: boolean;
  ia: { ligada: boolean; agente: string };
  /** Agente fixado só para a rodada agendada. Somente leitura: não há subcomando. */
  agenteDaTarefa: string | null;
  ramoDoMr: string;
  /** Alvos do `config.json` como estão, para a tela listar as pastas-raiz. */
  alvos: AlvoDoAutosync[];
  repositorios: RepositorioDoAutosync[];
}

/**
 * Estado de um repositório de cliente diante do autosync — tabela em
 * docs/funcionalidades.md, seção Git AutoSync.
 *
 * - `fora`: tem pasta local e é repositório, mas o autosync não o cobre.
 * - `ativo`: alvo próprio ou coberto por raiz, e roda na rodada agendada.
 * - `excluido`: dentro de uma raiz cadastrada, mas no `exclude` dela.
 * - `desligado`: alvo próprio com `enabled: false`.
 * - `pasta-ausente` e `nao-e-repositorio`: nada a oferecer além de tirar do autosync.
 */
export const SITUACOES_NO_AUTOSYNC = [
  'fora',
  'ativo',
  'excluido',
  'desligado',
  'pasta-ausente',
  'nao-e-repositorio',
] as const;

export type SituacaoNoAutosync = (typeof SITUACOES_NO_AUTOSYNC)[number];

export interface RepositorioDeClienteNoAutosync {
  clienteId: string;
  clienteNome: string;
  repositorioId: string;
  url: string;
  caminho: string;
  situacao: SituacaoNoAutosync;
  /** Raiz que cobre o repositório, quando a situação vem dela. */
  raiz: string | null;
  /** Presente quando o autosync já conhece o repositório. */
  repositorio: RepositorioDoAutosync | null;
}

/**
 * Pasta que guarda 3 ou mais repositórios de clientes: cadastrá-la como `root`
 * cobre todos eles e os futuros. Só sugestão.
 */
export interface SugestaoDeRaiz {
  pasta: string;
  quantidade: number;
}

export interface ResultadoDoLote {
  adicionados: string[];
  jaEstavam: string[];
  ignorados: { caminho: string; motivo: string }[];
  falhas: { caminho: string; erro: string }[];
}

/** Flags do `install-standalone.ps1` que a tela pode escolher. */
export interface OpcoesDeInstalacao {
  horario?: string;
  bandeja?: boolean;
  atalhos?: boolean;
  skills?: boolean;
  path?: boolean;
}
