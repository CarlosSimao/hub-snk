import type { ConfiguracaoDoAssistenteDeIa } from './kanban/tiposDoKanban.ts';

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
 *
 * `caminhoDoExecutavelDaIde` é o executável da IDE usada no botão "Abrir IDE"
 * de cada repositório. Vazio desliga o botão: sem IDE escolhida, não há o que
 * abrir.
 *
 * `destinoDosLinks` vale para todo link clicável do cadastro — bases,
 * repositório, links gerais e de projeto —, uma escolha só em vez de uma por
 * tipo de link.
 *
 * `experiencePersonId` é o `person_id` do usuário logado no Sankhya Experience —
 * uma conta global dele, a mesma em qualquer projeto. Alimenta a aba OS (geral e do
 * cadastro do cliente, esta última recortando pelo nome da empresa). Vazio desliga
 * a aba OS por inteiro: sem ele não há como identificar de quem são as OS. Campo
 * interno, sem tela própria: é preenchido sozinho ao capturar a sessão do Sankhya
 * Experience (`descobrirPersonId`), nunca digitado pelo usuário.
 *
 * `sankhyaOmCodUsu` é o `CODUSU` do usuário logado no SankhyaOm (ERP) — diferente
 * do `person_id` da Experience, e sem forma automática de descobrir a partir da
 * sessão capturada (só cookies e nenhum deles carrega o valor). Por isso, ao
 * contrário de `experiencePersonId`, é digitado à mão no topo de Credenciais Sankhya.
 *
 * `perfil` e `funcionalidadesOcultas` são os acessos de Configurações › Acessos. A
 * lista guarda o que está oculto, e não o que está visível, para que uma
 * funcionalidade criada numa versão futura já nasça visível para todo mundo. Ocultar
 * só tira a funcionalidade da tela: não é controle de permissão, e a API segue
 * respondendo.
 *
 * `smtp` é o servidor que envia os e-mails das notificações, e `alertaDaAgenda` liga o
 * aviso de agenda do dia sem OS lançada. A senha do SMTP fica em texto puro neste
 * arquivo, como as senhas das bases no `clientes.json`.
 */
export interface ConfiguracaoGlobal {
  scriptPadrao: string;
  intervaloDeExecucaoAutomaticaSegundos: number;
  tempoLimiteSegundos: number;
  caminhoDoSchemaMcp: string;
  atalhos: Atalho[];
  destinoDosLinks: DestinoDeLink;
  caminhoDoExecutavelDaIde: string;
  experiencePersonId: string;
  sankhyaOmCodUsu: string;
  perfil: PerfilProfissional;
  funcionalidadesOcultas: Funcionalidade[];
  /** Terceiro não tem acesso ao SankhyaOm nem à Experience: o que depende deles some. */
  terceiro: boolean;
  smtp: ConfiguracaoSmtp;
  alertaDaAgenda: AlertaDaAgenda;
  /** Quem gera as tarefas do kanban a partir do documento de escopo. */
  assistenteDeIa: ConfiguracaoDoAssistenteDeIa;
}

/**
 * `ssl`: TLS desde a conexão (porta 465, em geral). `starttls`: conexão aberta que
 * exige subir para TLS (porta 587). `nenhuma`: sem TLS, só para servidor da rede local.
 */
export const SEGURANCAS_SMTP = ['ssl', 'starttls', 'nenhuma'] as const;

export type SegurancaSmtp = (typeof SEGURANCAS_SMTP)[number];

/** Servidor de envio dos e-mails das notificações. Host vazio desliga o e-mail. */
export interface ConfiguracaoSmtp {
  host: string;
  porta: number;
  seguranca: SegurancaSmtp;
  /** Vazio envia sem autenticação. */
  usuario: string;
  senha: string;
  remetente: string;
  destinatario: string;
}

/**
 * Aviso de evento da agenda de hoje sem OS lançada na Experience. Dispara quando o
 * evento terminou há `toleranciaMinutos` e ainda não há OS no dia para o parceiro.
 */
export interface AlertaDaAgenda {
  ativo: boolean;
  toleranciaMinutos: number;
  enviarEmail: boolean;
}

/**
 * `hub`: guia do aplicativo desktop. `navegador-padrao`: o navegador do sistema.
 * Quem aplica é o shell (`desktop/src/tabs.ts`); com o painel aberto num
 * navegador comum, os links abrem nele de qualquer jeito.
 */
export const DESTINOS_DE_LINK = ['hub', 'navegador-padrao'] as const;

export type DestinoDeLink = (typeof DESTINOS_DE_LINK)[number];

/** Perfil do profissional que usa o HUB SNK: define o preset de funcionalidades visíveis. */
export const PERFIS_PROFISSIONAIS = [
  'desenvolvedor',
  'consultor',
  'analista',
  'gerente-de-projeto',
] as const;

export type PerfilProfissional = (typeof PERFIS_PROFISSIONAIS)[number];

/**
 * Funcionalidades que o usuário pode ocultar: as abas do menu principal e as do
 * cadastro do cliente. Clientes (menu) e Geral (cliente) ficam de fora de propósito:
 * sem elas a tela abriria vazia.
 */
export const FUNCIONALIDADES = [
  'local',
  'agenda',
  'os',
  'lembretes',
  'contatos',
  'cliente.bases',
  'cliente.repositorios',
  'cliente.projetos',
  'cliente.agenda',
  'cliente.os',
  'cliente.contatos',
  'autosync',
  'cliente.autosync',
] as const;

export type Funcionalidade = (typeof FUNCIONALIDADES)[number];

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
export const SGBDS = ['oracle', 'sqlserver'] as const;

export type Sgbd = (typeof SGBDS)[number];

export const IDENTIFICADORES_ORACLE = ['service-name', 'sid'] as const;

export type IdentificadorOracle = (typeof IDENTIFICADORES_ORACLE)[number];

/**
 * Banco de dados vinculado a uma base. No máximo um por base.
 *
 * `nomeDoServico` guarda o service name ou o SID no Oracle (conforme
 * `identificadorOracle`) e o nome do database no SQL Server — o campo nasceu
 * quando só havia Oracle e manteve o nome para não migrar os dados gravados.
 * `identificadorOracle` não tem efeito no SQL Server.
 */
export interface BancoDeDados {
  sgbd: Sgbd;
  identificadorOracle: IdentificadorOracle;
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
 * Um projeto do cliente: agrupa anotações e links próprios, separados dos
 * gerais do cliente — por exemplo, um addon específico em desenvolvimento.
 */
export interface Projeto {
  id: string;
  nome: string;
  /** Texto livre sobre o projeto. */
  anotacoes: string;
  links: LinkDoCliente[];
  criadoEm: string;
  atualizadoEm: string;
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
  projetos: Projeto[];
  /**
   * Razões sociais deste cliente no SankhyaOm/Experience — o nome do cadastro
   * do hub raramente bate com o nome de lá (abreviado, com sufixo societário,
   * de matriz/filial diferente). É o ÚNICO vínculo com o Sankhya: casa a empresa
   * da OS (`aba OS do cliente`) e o parceiro da Agenda (`aba Agenda do cliente`),
   * os dois pelo nome. Vazio cai no `nome` do cadastro.
   */
  nomesCompletos: string[];
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

export const SISTEMAS_SANKHYA = ['sankhya-erp', 'sankhya-experience'] as const;
export type SistemaSankhya = (typeof SISTEMAS_SANKHYA)[number];

/**
 * Estado de uma credencial do Sankhya guardada pelo cofre do shell desktop — diz
 * se há valor guardado e para qual usuário, nunca a senha. A senha é cifrada com
 * `safeStorage` fora do processo do backend; só o shell a decripta.
 */
export interface StatusCredencial {
  sistema: SistemaSankhya;
  usuario: string;
  definido: boolean;
  /** ISO-8601 do `exp` do JWT capturado, quando há um. Vazio sem sessão. */
  sessaoExpiraEm: string;
  sessaoCapturada: boolean;
}

/* ------------------- Agenda de Recursos (Sankhya ERP) -------------------- */

/** Um consultor na Agenda de Recursos. */
export interface RecursoAgenda {
  codusu: number | null;
  nomeusu: string;
  codcargo: number | null;
  descrcargo: string;
  /** `#RRGGBB` — o Sankhya manda `0xRRGGBB`. */
  corHex: string;
  corConflitoHex: string;
  problemaConexao: string;
}

/**
 * Um evento da agenda.
 *
 * `inicio` e `fim` vêm como `YYYY-MM-DD HH:mm:ss`, e não como data: nesse
 * formato a comparação de texto já é a cronológica, então o filtro por
 * período dispensa conversão.
 */
export interface EventoAgenda {
  nuevento: number | null;
  codusu: number | null;
  nomeusu: string;
  nomeparc: string;
  codparc: number | null;
  allday: string;
  inicio: string;
  fim: string;
  descrabrev: string;
  descrlonga: string;
  tipo: string;
  confirmado: string;
  sincronizar: string;
  usulancador: string;
  dhlcto: string;
  numetapa: number | null;
  nufap: number | null;
  nueventopai: number | null;
  financiallate: string;
  diastraso: number | null;
}

/** Evento já com o cargo e a cor do recurso dele, para a tela não cruzar de novo. */
export interface EventoComRecurso extends EventoAgenda {
  id: number;
  descrcargo: string;
  corHex: string;
}

export interface EstadoAgendaRecursos {
  recursos: number;
  eventos: number;
  /** Epoch ms da última importação; `null` quando nunca houve uma. */
  importadoEm: number | null;
}

/** Um parceiro que aparece nos eventos da agenda — é o que identifica o cliente lá. */
export interface ParceiroAgenda {
  codparc: number | null;
  nomeparc: string;
  eventos: number;
  /** `YYYY-MM-DD` do primeiro e do último evento; ajuda a reconhecer o parceiro certo. */
  primeiroDia: string;
  ultimoDia: string;
}

/* --------------------------- Sankhya Experience --------------------------- */

/**
 * Uma tarefa da tela de Tarefas. A resposta da API traz bem mais campos que
 * estes — aqui ficam os que a agenda usa, e o objeto cru é preservado em
 * `bruto` porque a geração de OS (fora de escopo aqui) exige a tarefa
 * inteira, do jeito que veio.
 */
export interface TarefaExperience {
  id: number;
  /** `DD/MM/YYYY` como a API devolve. */
  taskDate: string;
  /** `YYYY-MM-DD` — o mesmo dia, na forma que ordena e agrupa. */
  dia: string;
  procedimento: string;
  etapa: string;
  processo: string;
  /** `Hoje`, `Futura`, `Atrasada` — a tela tem mais valores, estes são os confirmados. */
  taskStatus: string;
  horaInicio: string;
  horaFim: string;
  pedido: string;
  observacoes: string;
  bruto: Record<string, unknown>;
}

/** Uma ordem de serviço já lançada. */
export interface OrdemExperience {
  id: number;
  /** `YYYY-MM-DD` da conclusão. */
  dia: string;
  descricao: string;
  tipo: string;
  numeroSankhya: string;
  /** `Gerado`, vazio quando ainda não há aceite. */
  statusAceite: string;
  horasFeitas: string;
  etapa: string;
  processos: string;
  pessoa: string;
  empresa: string;
  statusNumeroSankhya: string;
  horasExcedidas: boolean;
  erro: string;
  pedido: string;
  coordenador: string;
  totalProjetoPrevisto: string;
  totalProjetoFeito: string;
  /** Horário da PRIMEIRA tarefa da OS — o caso comum é uma tarefa por dia. */
  horaInicio: string;
  horaFim: string;
  intervalo: string;
  /**
   * Texto livre digitado em "Tarefas Realizadas" — só a parte depois do marcador
   * "--- Informações Adicionais ---", sem repetir etapa/processos (que já vêm em
   * campos próprios). Junta mais de uma linha quando a OS consolida vários dias.
   */
  observacoes: string;
}

/* ------------------------------ Notificações ------------------------------ */

/** De onde veio a notificação: a agenda do dia, um lembrete cadastrado ou o próprio HUB SNK. */
export const ORIGENS_DE_NOTIFICACAO = ['agenda', 'lembrete', 'sistema'] as const;

export type OrigemDeNotificacao = (typeof ORIGENS_DE_NOTIFICACAO)[number];

/**
 * Uma notificação do painel lateral.
 *
 * `chave` identifica o fato que a gerou (o evento da agenda num dia, a ocorrência de um
 * lembrete): emitir de novo a mesma chave não cria outra notificação nem outro e-mail.
 */
export interface Notificacao {
  id: string;
  origem: OrigemDeNotificacao;
  chave: string;
  titulo: string;
  mensagem: string;
  criadaEm: string;
  lida: boolean;
  /** Motivo da falha do e-mail; vazio quando foi enviado ou nem era para enviar. */
  erroDoEmail: string;
}

/* -------------------------------- Lembretes ------------------------------- */

/** `unico`: uma data e hora. `recorrente`: uma expressão cron de cinco campos. */
export const TIPOS_DE_LEMBRETE = ['unico', 'recorrente'] as const;

export type TipoDeLembrete = (typeof TIPOS_DE_LEMBRETE)[number];

/**
 * Lembrete cadastrado pelo usuário, opcionalmente ligado a um cliente e a um projeto
 * dele.
 *
 * `dataHora` (ISO 8601) só vale para o `unico`, e `expressaoCron` só para o
 * `recorrente`; o campo do outro tipo fica vazio. `ultimoDisparoEm` vazio é lembrete
 * que nunca disparou. Mudar a data, a expressão ou o tipo o zera: o novo quando começa
 * a contar do zero.
 */
export interface Lembrete {
  id: string;
  /** Linha curta em destaque na notificação e no assunto do e-mail. */
  resumo: string;
  texto: string;
  tipo: TipoDeLembrete;
  dataHora: string;
  expressaoCron: string;
  clienteId: string | null;
  projetoId: string | null;
  enviarEmail: boolean;
  /** Contatos que recebem o e-mail em cópia; vazio quando o lembrete não envia e-mail. */
  contatoIds: string[];
  ativo: boolean;
  ultimoDisparoEm: string;
  criadoEm: string;
  atualizadoEm: string;
}

/* -------------------------------- Contatos -------------------------------- */

/**
 * Pessoa de contato, opcionalmente ligada a um cliente. Só o nome é obrigatório: os
 * outros campos ficam vazios quando não informados. `clienteId` de um cliente que já
 * foi excluído vale como sem cliente.
 */
export interface Contato {
  id: string;
  nome: string;
  telefone: string;
  email: string;
  cargo: string;
  clienteId: string | null;
  criadoEm: string;
  atualizadoEm: string;
}
