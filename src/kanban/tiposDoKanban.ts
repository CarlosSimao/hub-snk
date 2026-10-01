/**
 * Formatos do kanban de tarefas dos projetos do cliente.
 *
 * Cada kanban é uma demanda de um projeto: nasce de um documento de escopo, que a IA
 * decompõe em tarefas, ou vazio, para as tarefas serem lançadas à mão. Um projeto tem
 * quantas demandas precisar; a demanda cujo projeto foi excluído fica órfã
 * (`projetoId` vazio) até ser vinculada a outro.
 */

/** As colunas do quadro, na ordem em que aparecem. */
export const ESTADOS_DE_TAREFA = [
  'backlog',
  'a_fazer',
  'em_andamento',
  'em_revisao',
  'concluido',
] as const;

export type EstadoDeTarefa = (typeof ESTADOS_DE_TAREFA)[number];

export const PRIORIDADES_DE_TAREFA = ['alta', 'media', 'baixa'] as const;

export type PrioridadeDeTarefa = (typeof PRIORIDADES_DE_TAREFA)[number];

/**
 * O tipo de artefato Sankhya que a tarefa produz: diz a quem distribuir e separa o
 * que é código do que é configuração ou teste.
 */
export const TIPOS_DE_TAREFA = [
  'backend',
  'frontend',
  'dados',
  'relatorio',
  'bi',
  'integracao',
  'configuracao',
  'teste',
  'documentacao',
  'outro',
] as const;

export type TipoDeTarefa = (typeof TIPOS_DE_TAREFA)[number];

/** Assistentes de IA de linha de comando que sabem gerar as tarefas de um escopo. */
export const ASSISTENTES_DE_IA = ['claude', 'codex', 'opencode', 'gemini', 'cursor'] as const;

export type AssistenteDeIa = (typeof ASSISTENTES_DE_IA)[number];

/** `auto` usa o primeiro instalado, na ordem de `ASSISTENTES_DE_IA`. */
export const ESCOLHAS_DE_ASSISTENTE = ['auto', ...ASSISTENTES_DE_IA] as const;

export type EscolhaDeAssistente = (typeof ESCOLHAS_DE_ASSISTENTE)[number];

/** O que fica gravado nas configurações. `modelo` vazio usa o padrão do assistente. */
export interface ConfiguracaoDoAssistenteDeIa {
  assistente: EscolhaDeAssistente;
  modelo: string;
  /** Nível de raciocínio do modelo (`high`, `max`...); vazio usa o padrão dele. */
  raciocinio: string;
}

/** Formatos aceitos para o documento de escopo. O `.doc` do Word antigo fica de fora. */
export const TIPOS_DE_DOCUMENTO = ['docx', 'pdf', 'md', 'txt'] as const;

export type TipoDeDocumento = (typeof TIPOS_DE_DOCUMENTO)[number];

/**
 * `sem-documento`: kanban criado vazio, ou cujo documento foi removido.
 * `enviado`: documento guardado, ainda sem análise. `analisando`, `analisado` e
 * `falhou` acompanham a IA.
 */
export const SITUACOES_DA_DEMANDA = [
  'sem-documento',
  'enviado',
  'analisando',
  'analisado',
  'falhou',
] as const;

export type SituacaoDaDemanda = (typeof SITUACOES_DA_DEMANDA)[number];

/** O documento de escopo da demanda. O texto extraído não vem junto: tem rota própria. */
export interface DocumentoDaDemanda {
  nome: string;
  tipo: TipoDeDocumento;
  bytes: number;
  enviadoEm: string;
  /** Zero no PDF: quem lê o PDF é a própria IA. */
  caracteres: number;
}

export interface DemandaDoKanban {
  id: number;
  clienteId: string;
  /** Vazio quando o projeto foi excluído e a demanda ficou órfã. */
  projetoId: string;
  nome: string;
  /** Onde o arquivo JSON das tarefas será criado. Vazio enquanto não for escolhida. */
  pasta: string;
  documento: DocumentoDaDemanda | null;
  situacao: SituacaoDaDemanda;
  /** Resumo da IA, com os pontos a esclarecer com o cliente no fim. */
  resumo: string;
  erro: string;
  analisadaEm: string;
  /** Assistente e modelo da última análise, para saber de onde vieram as tarefas. */
  assistente: string;
  modelo: string;
  /** Liberado para agentes de IA pelo servidor MCP do HUB SNK. */
  mcp: boolean;
  /** Nome do arquivo JSON de tarefas dentro de `<pasta>/Tarefas`; vazio sem pasta. */
  arquivoNome: string;
  /** Situação do arquivo de tarefas, quando a pasta está escolhida. Só nas respostas da API. */
  arquivo?: SituacaoDoArquivoDeTarefas;
  criadaEm: string;
  atualizadaEm: string;
}

/** Como está o arquivo JSON de tarefas compartilhado com agentes que editam arquivo. */
export interface SituacaoDoArquivoDeTarefas {
  caminho: string;
  sincronizadoEm: string;
  importadoEm: string;
  mudancasImportadas: number;
  /** O `.gitignore` que passou a ignorar a pasta Tarefas, quando a pasta está num repositório. */
  gitignore: string;
  erro: string;
}

export interface ItemDaLista {
  texto: string;
  feito: boolean;
}

export interface TarefaDoKanban {
  id: number;
  demandaId: number;
  titulo: string;
  descricao: string;
  grupo: string;
  tipo: TipoDeTarefa;
  estimativaHoras: number;
  prioridade: PrioridadeDeTarefa;
  criteriosDeAceite: string;
  notas: string;
  /** Itens para marcar conforme a tarefa avança, na ordem em que aparecem. */
  checklist: ItemDaLista[];
  estado: EstadoDeTarefa;
  /** Posição na coluna, dentro da demanda: 0 é o topo. */
  ordem: number;
  criadaEm: string;
  atualizadaEm: string;
}

/**
 * `criada` e `removida` marcam o começo e o fim da tarefa; `movida`, a troca de
 * coluna. Reordenar dentro da mesma coluna não é transição.
 */
export const ORIGENS_DE_TRANSICAO = ['criada', 'movida', 'removida'] as const;

export type OrigemDeTransicao = (typeof ORIGENS_DE_TRANSICAO)[number];

export interface TransicaoDeTarefa {
  id: number;
  tarefaId: number;
  demandaId: number;
  clienteId: string;
  de: string;
  para: string;
  em: string;
  origem: OrigemDeTransicao;
}

/** O que a tela do cliente recebe: as demandas de todos os projetos e as órfãs. */
export interface KanbansDoCliente {
  demandas: DemandaDoKanban[];
  tarefas: TarefaDoKanban[];
}
