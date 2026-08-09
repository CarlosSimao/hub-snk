/**
 * Ajustes que valem para o HUB SNK inteiro, não para um cliente específico.
 *
 * `scriptPadrao` é uma linha de comando executada pelo shell ao abrir o
 * terminal de um repositório. É interpretada pelo shell por definição — é esse
 * o propósito do campo.
 *
 * `intervaloDeExecucaoAutomaticaSegundos` é a frequência de tudo que a tela
 * refaz sozinha enquanto está aberta: o diagnóstico Git dos repositórios, a
 * situação de cada banco local (container + login no banco), de cada base
 * local (serviço + HTTP em localhost) e das bases do cliente selecionado.
 *
 * `tempoLimiteSegundos` é quanto tempo cada uma dessas checagens espera por
 * resposta antes de desistir e considerar o alvo fora do ar: HTTP da base do
 * cliente, TCP/HTTP do WildFly local e os comandos `docker` da situação do
 * banco. Não vale para os comandos `git`, que mantêm limites próprios.
 *
 * `caminhoDoSchemaMcp` é a pasta de instalação do `sankhya-schema-mcp`. As
 * credenciais do banco não ficam aqui: são gravadas no `.env` dessa pasta, que
 * é de onde o próprio MCP as lê. Vazio desliga a gravação.
 *
 * `atalhos` são programas da máquina disparados pelo botão de atalhos da barra
 * do topo.
 */
export interface ConfiguracaoGlobal {
  scriptPadrao: string;
  intervaloDeExecucaoAutomaticaSegundos: number;
  tempoLimiteSegundos: number;
  caminhoDoSchemaMcp: string;
  atalhos: Atalho[];
}

/**
 * Atalho para um programa da máquina.
 *
 * O caminho é entregue ao despachante do sistema, e não executado direto, para
 * que `.exe`, `.lnk`, `.bat` e qualquer extensão associada abram do mesmo jeito.
 */
export interface Atalho {
  id: string;
  nome: string;
  caminhoDoExecutavel: string;
}

export const TIPOS_DE_BASE = ['producao', 'teste', 'outro'] as const;

export type TipoDeBase = (typeof TIPOS_DE_BASE)[number];

/**
 * Base de um cliente.
 *
 * A senha é gravada em texto puro: o HUB SNK roda apenas na máquina do usuário,
 * sem autenticação, e qualquer chave de criptografia ficaria no mesmo disco que
 * o arquivo cifrado. Por isso `dados-hub-snk/` está no `.gitignore`; sincronizar
 * a pasta com a nuvem é escolha do usuário, ciente de que a senha sobe legível.
 */
/** Banco de dados vinculado a uma base. No máximo um por base. */
export interface BancoDeDados {
  host: string;
  porta: number;
  nomeDoServico: string;
  usuario: string;
  senha: string;
}

export interface Base {
  id: string;
  url: string;
  tipo: TipoDeBase;
  usuario: string;
  senha: string;
  bancoDeDados?: BancoDeDados;
}

/**
 * Repositório Git remoto de um cliente.
 *
 * O nome carrega o sufixo `Git` para não se confundir com `RepositorioClientes`,
 * que é a camada de persistência e não uma entidade.
 */
export interface RepositorioGit {
  id: string;
  nome: string;
  url: string;
  /** Pasta do clone na máquina. Ausente quando o repositório não foi clonado. */
  caminhoLocal?: string;
}

/**
 * Link relevante do cliente: portal, painel, documentação, chamado.
 *
 * Não tem caminho local nem situação acompanhada — é só um endereço nomeado que
 * o usuário abre no navegador, sem nada da máquina por trás.
 */
export interface LinkDoCliente {
  id: string;
  nome: string;
  url: string;
}

/**
 * Gravidade de uma pendência do repositório.
 *
 * `erro` é o que pede ação agora — risco de perder trabalho, de vazar segredo
 * ou de o repositório nem existir. `atencao` é pendência normal de fluxo.
 * `desconhecido` é quando não deu para verificar, e nunca deve ser lido como
 * "está tudo certo". `ok` é observação sem cobrança: nada está errado, mas há
 * algo a informar — uma branch já mergeada que pode ser excluída, por exemplo.
 */
export const SEVERIDADES = ['erro', 'atencao', 'desconhecido', 'ok'] as const;

export type Severidade = (typeof SEVERIDADES)[number];

export const PROVEDORES_GIT = ['github', 'gitlab', 'desconhecido'] as const;

export type ProvedorGit = (typeof PROVEDORES_GIT)[number];

/** Um problema encontrado no repositório local, com o comando que o resolve. */
export interface PendenciaGit {
  codigo: string;
  severidade: Severidade;
  mensagem: string;
  comandoSugerido?: string;
}

/**
 * Retrato do repositório local num instante.
 *
 * É estado do disco, não do cadastro — por isso não fica em `RepositorioGit` e
 * é servido por rota própria.
 */
export interface SituacaoGit {
  severidade: Severidade;
  branchAtual: string | null;
  provedor: ProvedorGit | null;
  pendencias: PendenciaGit[];
  verificadoEm: string;
}

/**
 * Cliente cadastrado no HUB SNK.
 *
 * As datas são strings ISO 8601 porque o estado é serializado em JSON e
 * consumido direto pelo frontend, sem camada de conversão.
 */
export interface Cliente {
  id: string;
  nome: string;
  /** Texto livre sobre o cliente: contatos, particularidades, lembretes. */
  anotacoes: string;
  bases: Base[];
  repositorios: RepositorioGit[];
  links: LinkDoCliente[];
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Base local do WildFly, independente de cliente — a instância que roda na
 * máquina do usuário, não a base de um cliente cadastrado.
 */
export interface BaseLocal {
  id: string;
  nome: string;
  caminhoWildfly: string;
  porta: number;
  criadoEm: string;
  atualizadoEm: string;
}

/**
 * Banco de dados local, independente de cliente e de `BaseLocal` — cadastro à
 * parte, sem vínculo obrigatório com uma base específica.
 */
export interface BancoLocal {
  id: string;
  container: string;
  host: string;
  porta: number;
  nomeDoServico: string;
  usuario: string;
  senha: string;
  criadoEm: string;
  atualizadoEm: string;
}
