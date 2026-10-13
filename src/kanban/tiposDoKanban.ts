/**
 * Formatos do kanban de tarefas dos clientes.
 *
 * Cada kanban é uma demanda: nasce de um documento de escopo, que a IA decompõe em
 * tarefas, ou vazio, para as tarefas serem lançadas à mão. Um projeto tem no máximo um
 * kanban, e o cliente tem no máximo um sem projeto (`projetoId` vazio), o da aba Kanban
 * dele. O quadro Interno é o sem projeto de `clienteId` vazio: o das tarefas que não são
 * de cliente nenhum.
 */

/** O `clienteId` do quadro Interno. */
export const CLIENTE_INTERNO = '';

export const NOME_DO_QUADRO_INTERNO = 'Interno';

/**
 * Uma coluna ou um tipo do cadastro das Configurações. A `chave` é o que a tarefa grava
 * e o que os agentes usam: nasce do nome e nunca muda, e renomear troca só o `nome`.
 */
export interface ItemDoCadastro {
  chave: string;
  nome: string;
}

/**
 * As colunas e os tipos que valem para todos os quadros. A primeira coluna recebe as
 * tarefas novas e as da IA; a última é a das concluídas.
 */
export interface CadastrosDoKanban {
  colunas: ItemDoCadastro[];
  tipos: ItemDoCadastro[];
}

/** O que o banco ganha na primeira vez: as colunas e os tipos de antes do cadastro. */
export const COLUNAS_INICIAIS: ItemDoCadastro[] = [
  { chave: 'backlog', nome: 'Backlog' },
  { chave: 'a_fazer', nome: 'A fazer' },
  { chave: 'em_andamento', nome: 'Em andamento' },
  { chave: 'em_revisao', nome: 'Em revisão' },
  { chave: 'concluido', nome: 'Concluído' },
];

/** O tipo de artefato Sankhya que a tarefa produz: diz a quem distribuir o trabalho. */
export const TIPOS_INICIAIS: ItemDoCadastro[] = [
  { chave: 'backend', nome: 'Backend' },
  { chave: 'frontend', nome: 'Frontend' },
  { chave: 'dados', nome: 'Dados' },
  { chave: 'relatorio', nome: 'Relatório' },
  { chave: 'bi', nome: 'BI' },
  { chave: 'integracao', nome: 'Integração' },
  { chave: 'configuracao', nome: 'Configuração' },
  { chave: 'teste', nome: 'Teste' },
  { chave: 'documentacao', nome: 'Documentação' },
  { chave: 'outro', nome: 'Outro' },
];

export const PRIORIDADES_DE_TAREFA = ['alta', 'media', 'baixa'] as const;

export type PrioridadeDeTarefa = (typeof PRIORIDADES_DE_TAREFA)[number];

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
  /** Chave de um tipo do cadastro; vazio é sem tipo. */
  tipo: string;
  estimativaHoras: number;
  prioridade: PrioridadeDeTarefa;
  criteriosDeAceite: string;
  notas: string;
  /** Itens para marcar conforme a tarefa avança, na ordem em que aparecem. */
  checklist: ItemDaLista[];
  /** Chave da coluna do cadastro em que a tarefa está. */
  estado: string;
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

/** O que a tela recebe: as demandas do cliente, ou de todos no Kanban geral. */
export interface KanbansDoCliente {
  demandas: DemandaDoKanban[];
  tarefas: TarefaDoKanban[];
}
