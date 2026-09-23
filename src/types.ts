/**
 * Vocabulario compartilhado entre engine, checks, API e dashboard.
 *
 * Tres conceitos, na ordem em que aparecem na tela:
 *  - Semaforo (`CheckOutcome.status`): o veredito de um check. Verde/amarelo/vermelho/cinza.
 *  - Indicador (`Indicator`): um numero ou texto medido junto com o check (latencia,
 *    conexoes abertas, tamanho do banco). Nao decide cor sozinho — a menos que traga
 *    seu proprio `status`.
 *  - Componente (`Component`): sub-semaforo dentro de um check. Um `/actuator/health`
 *    vira um semaforo geral + um componente por dependencia (db, ping, diskSpace).
 */

/** Verde / amarelo / vermelho / apagado. `unknown` = ainda nao medido ou config invalida. */
export type Status = 'up' | 'degraded' | 'down' | 'unknown';

export interface Indicator {
  id: string;
  label: string;
  /** `null` quando o check falhou antes de conseguir medir. */
  value: number | string | null;
  unit?: string;
  /** Presente => o dashboard desenha barra de progresso em vez de numero solto. */
  max?: number;
  /** Colore o indicador de forma independente do semaforo do check. */
  status?: Status;
  /** Casas decimais na formatacao. Default 0. */
  precision?: number;
}

export interface Component {
  id: string;
  label: string;
  status: Status;
  detail?: string;
}

/** O que todo modulo de check devolve. */
export interface CheckOutcome {
  status: Status;
  latencyMs: number | null;
  /** Uma linha legivel: "HTTP 200", "connection refused", "UP (db, diskSpace)". */
  message: string;
  indicators: Indicator[];
  components: Component[];
}

/** Outcome + metadados de quando/quem — o que a API expoe. */
export interface CheckSnapshot extends CheckOutcome {
  serviceId: string;
  checkId: string;
  name: string;
  type: string;
  description?: string;
  /** Silenciado: continua sendo medido e exibido, mas nao entra no status do servico. */
  muted: boolean;
  /**
   * Monitoramento desabilitado pelo painel: nao roda mais (sem timer, sem I/O) e nao
   * entra no status do servico. Diferente de `muted` — o outcome fica congelado.
   */
  disabled: boolean;
  /**
   * O check cita uma `${VAR}` que o ambiente nao definiu, entao nao ha o que medir.
   *
   * Separado de `status: 'unknown'` porque cinza tem outras causas — primeira medicao
   * ainda nao concluida, cota de API estourada — e so esta e resolvida preenchendo um
   * arquivo. E o que o card usa para decidir se mostra o sinal de configuracao pendente.
   */
  needsConfig: boolean;
  /**
   * Como o hub verifica este check, em linguagem natural — o conteudo do botao de
   * informacao no painel. Gerado da propria config, nunca contem credencial.
   */
  explicacao: string[];
  /** Epoch ms da ultima execucao. */
  ts: number;
  /** Quantas falhas consecutivas ate agora (0 quando verde). */
  consecutiveFailures: number;
  /** Epoch ms em que o status atual comecou — alimenta o "ha 3h estavel". */
  since: number;
  /** Proxima execucao agendada, epoch ms. */
  nextRunAt: number;
  intervalMs: number;
  /** Timeout do check em ms — o formulario de configurações usa isto pra pré-preencher. */
  timeoutMs: number;
  /** Uptime em % na janela de retencao. `null` sem amostras suficientes. */
  uptimePct: number | null;
  /** Amostras recentes (mais antiga -> mais nova) para sparkline e barra de uptime. */
  history: HistoryPoint[];
}

export interface HistoryPoint {
  ts: number;
  status: Status;
  latencyMs: number | null;
}

/**
 * Uma variavel de ambiente que o projeto usa, para o formulario de configuracao.
 *
 * Nao existe campo de valor, e isso e proposital: a API nunca devolve segredo. O
 * formulario mostra se ha valor e permite substituir — nunca ler o que esta guardado.
 */
export interface EnvVarStatus {
  name: string;
  /** Tem valor, seja do ambiente do processo ou do cofre. */
  defined: boolean;
  /** Veio do formulario (cofre) e nao do `.env` — logo, o painel pode sobrescrever. */
  fromVault: boolean;
}

export interface ServiceSnapshot {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  /** Caminho local de uma imagem (`/img/...`) que substitui o `icon` no avatar. */
  image?: string;
  accent?: string;
  tags: string[];
  links: { label: string; url: string }[];
  /** Pior semaforo entre os checks nao-silenciados e nao-desabilitados do servico. */
  status: Status;
  checks: CheckSnapshot[];
  actions: ActionDescriptor[];
  /** Variaveis que este projeto usa e seu estado — sem valores. */
  envVars: EnvVarStatus[];
  /** Monitoramento do projeto inteiro desabilitado pelo painel — nao entra no status global. */
  disabled: boolean;
}

export interface ActionDescriptor {
  id: string;
  label: string;
  /** `link` abre URL no navegador; os demais executam no servidor. */
  kind: 'link' | 'http' | 'docker' | 'wildfly' | 'sequence';
  description?: string;
  /** Pede confirmacao antes de executar. Sempre true para acoes destrutivas. */
  confirm: boolean;
  /** Preenchido so quando `kind === 'link'`. */
  url?: string;
  /** So quando `kind === 'link'`: abre em popup em vez de aba nova. */
  popup?: boolean;
  danger: boolean;
  /** Amarra a acao a um check especifico. Ausente = acao do projeto como um todo. */
  checkId?: string;
}

/**
 * Um alerta e uma MUDANCA de estado, nao um estado.
 *
 * Semaforo vermelho ha duas horas nao gera alerta a cada ciclo — gerou um quando
 * ficou vermelho, e vai gerar outro quando voltar. E o que separa "aviso" de "ruido".
 */
export interface Alert {
  id: string;
  ts: number;
  serviceId: string;
  serviceName: string;
  checkId: string;
  checkName: string;
  from: Status;
  to: Status;
  /** Mensagem do check no momento da transicao. */
  detail: string;
  /** `critical` = caiu; `warning` = degradou; `recovery` = voltou ao normal. */
  severity: 'critical' | 'warning' | 'recovery';
}

export interface HubSnapshot {
  generatedAt: number;
  status: Status;
  services: ServiceSnapshot[];
  /** Problemas de configuracao/ambiente que valem aviso na tela (ex.: socket do Docker ausente). */
  warnings: string[];
  /** Alertas recentes, do mais novo para o mais antigo. */
  alerts: Alert[];
}

/* ------------------------------ suite Sankhya ----------------------------- */

/** Os dois sistemas em que o hub se autentica. */
export const SISTEMAS_SANKHYA = ['sankhya-erp', 'sankhya-experience'] as const;
export type SistemaSankhya = (typeof SISTEMAS_SANKHYA)[number];

/**
 * Estado de uma credencial do Sankhya — mesma ideia do `EnvVarStatus`: diz se ha valor
 * guardado e para qual usuario, nunca a senha. A senha e cifrada com DPAPI fora do
 * container e so o backend a decripta, no momento do login automatizado.
 */
export interface StatusCredencial {
  sistema: SistemaSankhya;
  usuario: string;
  definido: boolean;
  /**
   * O hub tem o que precisa para se autenticar neste sistema.
   *
   * Independente de `definido`: da para ter sessao sem nunca ter guardado senha — e o
   * caminho preferido, porque a senha nao chega a passar pelo hub.
   *
   * O artefato muda por sistema. A API da Experience so aceita o JWT do
   * `localStorage` (`Authorization: Bearer`); com cookie ela responde 403. Ja o ERP
   * legado vai por cookie de sessao, e nao tem token nenhum.
   */
  sessaoCapturada: boolean;
  /** ISO-8601 do `exp` do JWT, quando ha um. Vazio para sessao so de cookie. */
  sessaoExpiraEm: string;
}

/** Uma guia aberta na janela do hub. O usuario pode ter quantas quiser. */
export interface AbaNavegador {
  id: string;
  url: string;
  titulo: string;
  /** Vazio quando a guia nao e de nenhum sistema do Sankhya. */
  sistema: SistemaSankhya | '';
  /**
   * A guia nao esta numa tela de login.
   *
   * E o unico sinal honesto de sessao viva no ERP: o cookie dele nao carrega validade,
   * entao so o redirecionamento para o login denuncia que a sessao morreu.
   */
  logado: boolean;
}

export interface PastaDoDisco {
  nome: string;
  caminho: string;
  /** Tem `.git` dentro — marcar poupa entrar na pasta para descobrir. */
  git: boolean;
}

/**
 * Caminhos do WildFly local.
 *
 * Eram valor fixo dentro dos scripts, entao trocar de instalacao pedia editar arquivo.
 * Quem escreve e a tela de Infra; quem le sao os helpers do WildFly, a cada chamada —
 * mudar o caminho vale na hora, sem reiniciar nada.
 */
export interface ConfigWildfly {
  /** Raiz da instalacao: a pasta que contem `bin\standalone.bat`. */
  pasta: string;
  arquivoLog: string;
  /** Iniciar com o console do WildFly a vista (padrão: oculto — fechar a janela derruba o servidor). */
  mostrarConsole: boolean;
  /** Medido na hora — a tela avisa ANTES de o Iniciar falhar por caminho errado. */
  pastaExiste: boolean;
  logExiste: boolean;
}

/** Uma instalacao do WildFly achada no disco pela varredura. */
export interface InstalacaoWildfly {
  pasta: string;
  arquivoLog: string;
}

/**
 * Um nivel da navegacao de pastas do Windows.
 *
 * Vem do helper: o hub roda num container Linux e nao enxerga o disco do usuario.
 */
export interface ListagemPastas {
  /** Vazio na raiz, onde a listagem sao as unidades. */
  atual: string;
  pai: string;
  git: boolean;
  pastas: PastaDoDisco[];
}

/** Um perfil do navegador PESSOAL do usuario, de onde da para trazer os favoritos. */
export interface PerfilNavegador {
  navegador: string;
  /** Pasta no disco: `Default` ou `Profile N`. */
  pasta: string;
  /** Nome que o usuario ve no navegador. */
  nome: string;
}

/**
 * Um favorito lido do navegador pessoal, candidato a virar cliente.
 *
 * E so leitura: o arquivo de favoritos do usuario nao e alterado em momento nenhum.
 */
export interface FavoritoNavegador {
  titulo: string;
  url: string;
  /** Caminho da pasta na arvore de favoritos, ex.: `Clientes/Ativos`. Vazio na raiz. */
  pasta: string;
}

/** O navegador que o hub controla, separado do Chrome do dia a dia do usuario. */
export interface StatusNavegador {
  /** Existe um Chrome ou Edge instalado nesta maquina. */
  navegador: boolean;
  /** Marcas instaladas, para a tela oferecer so o que da para abrir. */
  disponiveis: string[];
  /** A janela do hub esta aberta e falando DevTools Protocol. */
  aberto: boolean;
  abas: AbaNavegador[];
  /** Apelidos de tela que o hub sabe abrir direto, ex.: `agenda-recursos`. */
  telas: string[];
  perfis: PerfilNavegador[];
}

/**
 * Um cliente amarra os tres mundos do painel: o projeto no Sankhya Experience (tarefa
 * e OS), o recurso na Agenda do Sankhya ERP (evento de agenda) e a pasta local do
 * repositorio git (commit e push). A associacao e manual, feita na tela.
 */
export interface Cliente {
  id: number;
  nome: string;
  /**
   * Lembrar destas anotacoes ao abrir o hub.
   *
   * Ligado, o cliente ganha destaque no cartao e o shell avisa por notificacao do
   * Windows na abertura. Nao e' derivado de `anotacoes` ter texto: anotacao que e' so'
   * registro historico nao deve virar aviso todo dia — quem decide e' quem escreveu.
   */
  anotacoesNotificar: boolean;
  /**
   * Ultimo dia da demanda, `YYYY-MM-DD`. Vazio = demanda em andamento.
   *
   * E' o que liga a cobranca do e-mail de finalizacao: a partir deste dia, enquanto
   * `emailFinalizacaoEm` estiver vazio, o cliente aparece como pendente.
   */
  demandaFim: string;
  /**
   * Quando o e-mail de finalizacao ao parceiro foi marcado como enviado,
   * `YYYY-MM-DD`. Vazio = ainda nao saiu.
   *
   * Marcado a mao, e nao detectado: o e-mail de finalizacao sai por fora do hub, e
   * inventar que ele saiu com base em algum sinal indireto seria pior que perguntar.
   */
  emailFinalizacaoEm: string;
  /** ID do projeto na Experience (ex.: 10269) — o mesmo que aparece na URL da tela. */
  experienceProjetoId: number | null;
  /** `person_id` do usuario logado nesse projeto (ex.: 21986). */
  experiencePersonId: number | null;
  /** Username do recurso na Agenda de Recursos (ex.: FLAVIANO.SANTOS). */
  agendaRecursoUsuario: string;
  /**
   * `CODPARC` do cliente na Agenda de Recursos.
   *
   * E ele, nao o recurso, que separa um cliente do outro: a lane da agenda e do
   * CONSULTOR, entao todos os clientes de um consultor caem na mesma lane e so o
   * parceiro do evento diz de quem e o dia.
   */
  agendaCodparc: number | null;
  /**
   * Codigo da demanda deste cliente na Agenda de Recursos.
   *
   * Texto livre e preenchido a mao: o snapshot da agenda traz `nuevento`, `numetapa` e
   * `nufap`, e nenhum deles e o numero que se usa no dia a dia para falar da demanda.
   * Serve de referencia na tela, nao de chave para buscar nada.
   */
  agendaDemandaId: string;
  /** URL do Sankhya do cliente, para abrir direto do painel. */
  sankhyaUrl: string;
  repositorioLocal: string;
  repositorioRemoto: string;
  /** Texto livre: contatos, particularidades, combinados. */
  anotacoes: string;
}

export type ClienteEntrada = Omit<Cliente, 'id'>;

/* ------------------------- o cartao do cliente --------------------------- */

/**
 * Um cliente tem mais de uma base (producao e teste, as vezes homologacao), mais de um
 * repositorio e uma penca de links. Nada disso cabia nos campos unicos do cadastro.
 */
export const AMBIENTES_BASE = ['producao', 'teste', 'homologacao', 'outro'] as const;
export type AmbienteBase = (typeof AMBIENTES_BASE)[number];

export const SGBDS = ['oracle', 'sqlserver', 'postgres', 'outro'] as const;
export type Sgbd = (typeof SGBDS)[number];

/**
 * Como se conecta ao banco de dados de uma base.
 *
 * Mora na base, e nao no cliente: producao e homologacao do mesmo cliente sao dois
 * bancos diferentes, e guardar um so por cliente obrigaria a escolher qual.
 *
 * Nada aqui e usado para conectar — o painel nao abre conexao com banco de cliente.
 * E um lugar para anotar o que hoje vive em planilha e conversa de chat, junto do
 * resto do cadastro.
 */
export interface BancoDaBase {
  /** Vazio = nao informado. */
  sgbd: Sgbd | '';
  host: string;
  /** `null` = nao informado; evita confundir com a porta 0. */
  porta: number | null;
  /** Service name ou SID no Oracle, nome do database no SQL Server. */
  servico: string;
  /** Owner/esquema dos objetos do Sankhya, ex.: `SANKHYA`. */
  esquema: string;
  usuario: string;
  /** Ha senha guardada. O valor so sai pela rota de revelar — ver `temSenha`. */
  temSenha: boolean;
}

export type BancoDaBaseEntrada = Omit<BancoDaBase, 'temSenha'>;

export interface BaseCliente {
  id: number;
  clienteId: number;
  ambiente: AmbienteBase;
  /** URL do `/mge/`, ex.: `https://amatools.sankhyacloud.com.br/mge/`. */
  url: string;
  usuario: string;
  /**
   * Ha senha guardada para esta base.
   *
   * O valor NUNCA vem junto da listagem — so pela rota de revelar, e so a pedido
   * explicito de quem esta na tela.
   */
  temSenha: boolean;
  /** Versao lida da propria base na ultima medicao, ex.: `4.36b126`. */
  versao: string;
  /** Entra na medicao periodica de status. Base de teste costuma nao valer o ruido. */
  monitorar: boolean;
  /** Dados de conexao do banco desta base. Sempre presente; campos vazios se nao informados. */
  banco: BancoDaBase;
  ordem: number;
}

/**
 * `banco` e opcional: uma base sem dados de banco anotados e o caso normal, e omitir o
 * objeto inteiro grava tudo vazio em vez de obrigar quem chama a montar campo por campo.
 */
export type BaseClienteEntrada = Omit<
  BaseCliente,
  'id' | 'clienteId' | 'temSenha' | 'versao' | 'banco'
> & { banco?: BancoDaBaseEntrada };

/** O que a medicao de uma base devolve. */
export interface StatusBase {
  baseId: number;
  status: Status;
  /** Uma linha legivel: "Operacional", "HTTP 502", "sem resposta". */
  mensagem: string;
  versao: string;
  latenciaMs: number | null;
  medidoEm: number;
}

export interface RepoCliente {
  id: number;
  clienteId: number;
  /** Apelido na tela, ex.: "Comissionamento". Vazio cai para o nome da pasta. */
  nome: string;
  remoto: string;
  caminhoLocal: string;
  ordem: number;
}

export type RepoClienteEntrada = Omit<RepoCliente, 'id' | 'clienteId'>;

/**
 * Repositorio cadastrado em algum cliente, com o nome do cliente junto.
 *
 * Existe para a aba Git: la' nao ha cliente em contexto, e "Comissionamento" sem dizer
 * de quem nao identifica repositorio nenhum — o mesmo apelido se repete entre clientes.
 */
export interface RepoCadastrado extends RepoCliente {
  clienteNome: string;
}

export interface LinkCliente {
  id: number;
  clienteId: number;
  titulo: string;
  url: string;
  ordem: number;
}

export type LinkClienteEntrada = Omit<LinkCliente, 'id' | 'clienteId'>;

/** O cartao inteiro de um cliente, numa ida so ao servidor. */
export interface CartaoCliente {
  cliente: Cliente;
  bases: BaseCliente[];
  repos: RepoCliente[];
  links: LinkCliente[];
}

/* ------------------------ e-mail interno (GP/consultor/lider) ------------------------ */

export const PAPEIS_CONTATO_EMAIL = ['gp', 'consultor', 'lider'] as const;
export type PapelContatoEmail = (typeof PAPEIS_CONTATO_EMAIL)[number];

/**
 * Um contato de e-mail de um cliente — GP, consultor ou lider.
 *
 * O nome pode vir de sugestao (Experience), mas o e-mail e sempre digitado/confirmado
 * na tela: nenhuma fonte hoje devolve nome+e-mail casados para esses papeis.
 */
export interface ContatoEmailCliente {
  id: number;
  clienteId: number;
  papel: PapelContatoEmail;
  nome: string;
  email: string;
  ordem: number;
}

export interface ContatoEmailClienteEntrada {
  papel: PapelContatoEmail;
  nome: string;
  email: string;
}

/** Um dos dois contatos fixos, que entram em TODO envio, de qualquer cliente. */
export interface ContatoFixo {
  nome: string;
  email: string;
}

/**
 * Configuracao global de envio — uma so para o hub inteiro, nao por cliente.
 *
 * A senha do app do Gmail nunca aparece aqui: so `temSenha`, mesma regra de
 * `BaseCliente.temSenha`. O valor em claro so existe internamente, na hora de mandar.
 */
/**
 * Resumo diario das anotacoes marcadas com "avisar".
 *
 * Vai para o proprio e-mail configurado no SMTP, nao para os contatos do cliente: e'
 * lembrete de quem usa o hub, nao comunicacao com o cliente.
 */
export interface ResumoAnotacoes {
  ativo: boolean;
  /** `HH:MM`, hora local. */
  hora: string;
}

export interface ConfigEmail {
  smtpHost: string;
  smtpPorta: number;
  smtpUsuario: string;
  smtpRemetente: string;
  temSenha: boolean;
  /** Texto simples, anexado ao final de todo e-mail enviado — nao e segredo, nao e cifrada. */
  assinatura: string;
  liderImediato: ContatoFixo;
  responsavelOrcamento: ContatoFixo;
  resumoAnotacoes: ResumoAnotacoes;
}

/** O que a tela manda para gravar a configuracao — a senha e opcional (ver ConfigEmail). */
export interface ConfigEmailEntrada {
  smtpHost: string;
  smtpPorta: number;
  smtpUsuario: string;
  smtpRemetente: string;
  assinatura: string;
  liderImediato: ContatoFixo;
  responsavelOrcamento: ContatoFixo;
  resumoAnotacoes: ResumoAnotacoes;
}

/** Sugestao de nome vinda da OS mais recente do cliente na Experience — nunca com e-mail. */
export interface SugestaoContatoEmail {
  nome: string;
}

/** Um anexo do e-mail — vem da tela como upload manual, um por envio. */
export interface AnexoEmail {
  nomeArquivo: string;
  tipoMime: string;
  /** Conteudo em base64 — evita subir `@fastify/multipart` so para um arquivo por envio. */
  conteudoBase64: string;
}

/** `'auto'` deixa o helper escolher o primeiro CLI de IA instalado, mesma ordem do git-autosync. */
export type AgenteIA = 'auto' | 'claude' | 'codex' | 'opencode';

/** Um parceiro que aparece nos eventos da agenda — e o que identifica o cliente la. */
export interface ParceiroAgenda {
  codparc: number | null;
  nomeparc: string;
  eventos: number;
  /** `YYYY-MM-DD` do primeiro e do ultimo evento; ajuda a reconhecer o parceiro certo. */
  primeiroDia: string;
  ultimoDia: string;
}

/** Um dia em que houve (ou havera) atendimento a um cliente, vindo da Agenda de Recursos. */
export interface DiaAtuacao {
  /** `YYYY-MM-DD`. */
  dia: string;
  eventos: number;
  /** Titulos dos eventos do dia, para a tela nao precisar buscar de novo. */
  titulos: string[];
}

export interface AtuacaoCliente {
  codparc: number | null;
  nomeparc: string;
  dias: DiaAtuacao[];
}

/* --------------------------- Sankhya Experience --------------------------- */

/**
 * Uma tarefa da tela de Tarefas. A resposta da API traz bem mais campos que estes —
 * aqui ficam os que o painel usa, e o objeto CRU e preservado em `bruto` porque o
 * `POST /orders` (gerar OS) exige a tarefa inteira, do jeito que veio.
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
  /** `Hoje`, `Futura`, `Atrasada` — a tela tem mais valores, estes sao os confirmados. */
  taskStatus: string;
  horaInicio: string;
  horaFim: string;
  pedido: string;
  observacoes: string;
  bruto: Record<string, unknown>;
}

/** Uma ordem de servico ja lancada. */
export interface OrdemExperience {
  id: number;
  /** `YYYY-MM-DD` da conclusao. */
  dia: string;
  descricao: string;
  tipo: string;
  numeroSankhya: string;
  /** `Gerado`, vazio quando ainda nao ha aceite. */
  statusAceite: string;
  /**
   * Duracao DESTA OS (`diff_time`), ex.: `08:00`.
   *
   * Vem de `diff_time` e nao de `total_done`: medido no projeto 10269, `total_done`
   * volta o MESMO valor em toda linha (`60:00`) porque e o acumulado do projeto, nao
   * da ordem — usa-lo aqui fazia a tela anunciar 60 horas para cada OS de 4.
   */
  horasFeitas: string;
  etapa: string;
  processos: string;

  /* --- os campos abaixo so importam no acompanhamento do PROJETO INTEIRO --- */

  /** Quem lancou a OS. Vazio quando a consulta e so das proprias. */
  pessoa: string;
  /** Razao social do cliente, como a Experience registra. */
  empresa: string;
  /** Situacao do numero no ERP — diz se a OS chegou do outro lado. */
  statusNumeroSankhya: string;
  /** A OS passou do volume de horas previsto. */
  horasExcedidas: boolean;
  /** Erro da integracao com o ERP, quando houve. */
  erro: string;
  /** Codigo do pedido/chamado que originou a OS. */
  pedido: string;
  /** Coordenador do FAP — quem cobra o projeto do lado da Sankhya. */
  coordenador: string;
  /**
   * Acumulado do PROJETO, repetido em toda linha da resposta.
   *
   * Fica aqui porque e o unico lugar de onde sai, mas nao e dado da OS: a tela mostra
   * uma vez no cabecalho, nunca por linha.
   */
  totalProjetoPrevisto: string;
  totalProjetoFeito: string;
}

export interface AgendaExperience {
  tarefas: TarefaExperience[];
  ordens: OrdemExperience[];
}

/**
 * O que so o detalhe de uma OS tem — nao vem na listagem.
 *
 * Medido em 2026-09-15: `/orders/filtering` devolve as 27 colunas da grade e nenhuma
 * delas e `additional_information`. O texto de "Tarefas Realizadas", que e o que diz o
 * que foi feito no dia, so sai de `GET /orders/{id}`.
 */
export interface DetalheOrdem {
  id: number;
  /** O texto do campo "Tarefas Realizadas" do lancamento. */
  tarefasRealizadas: string;
  /** O campo "Observacoes" do lancamento, quase sempre vazio. */
  notas: string;
}

/** Quem aprova o aceite da OS, do lado do cliente. */
export interface AprovadorExperience {
  personId: number;
  nome: string;
  email: string;
  prioridade: number | null;
}

/** O que o modal "Gerar OS" precisa saber antes de deixar você preencher. */
export interface PreparoOrdem {
  /** Texto pronto que a Experience sugere para "Tarefas Realizadas". */
  observacoes: string;
  aprovadores: AprovadorExperience[];
  /** OS que já existem para a combinação processo/etapa destas tarefas. */
  ordensExistentes: number[];
  /**
   * A pré-validação da Experience não passou. Vazio quando passou.
   *
   * Não impede lançar: quem cria de fato é o `POST /orders`, que valida por conta
   * própria. Serve para você decidir se confere antes.
   */
  avisoValidacao: string;
}

export interface OrdemCriada {
  orderId: number;
  numos: string;
  /** A Experience sinaliza que cabe gerar aceite para esta OS. */
  permiteAceite: boolean;
  /** Preenchido quando o aceite foi gerado; `null` quando ficou só a OS. */
  aceiteId: number | null;
  emailEnviado: boolean;
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
 * `inicio` e `fim` vêm como `YYYY-MM-DD HH:mm:ss`, e não como data: nesse formato a
 * comparação de texto já é a cronológica, então o filtro por período dispensa conversão.
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

export interface RecursoComTotal extends RecursoAgenda {
  id: number;
  totalEventos: number;
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

/* ------------------------------ git-autosync ------------------------------ */

/**
 * Um alvo configurado no git-autosync.
 *
 * `root` e uma PASTA que contem varios repositorios e os varre sozinha; `repo` e um
 * repositorio unico. E por isso que tirar um repositorio do agendamento nem sempre e
 * "descadastrar": dentro de um alvo `root`, e `exclude`.
 */
export interface AlvoAutosync {
  path: string;
  type: 'root' | 'repo';
  enabled: boolean;
  exclude: string[];
}

/** Como o ultimo ciclo do agendador terminou, por repositorio. */
export interface EstadoRepoAutosync {
  path: string;
  lastRun?: string;
  success?: boolean;
  hadChanges?: boolean;
  message?: string;
  pushed?: boolean;
  state?: string;
  lastPush?: string;
}

export interface CommitAutosync {
  hash: string;
  date: string;
  message: string;
}

/**
 * A visao que o painel usa: um repositorio por linha, ja cruzando o que o agendador
 * reportou (`status.json`) com o que a config diz estar excluido.
 */
export interface RepoAutosync {
  path: string;
  /** Alvo raiz de onde ele foi varrido, quando nao e um alvo proprio. */
  alvo: string;
  /** Entra no agendamento automatico. Falso quando esta na lista de `exclude` do alvo. */
  ativo: boolean;
  /** O repositorio e um alvo por si so — desmarcar remove, em vez de excluir. */
  alvoProprio: boolean;
  estado: EstadoRepoAutosync | null;
}

/**
 * Uma tarefa do Agendador do Windows criada pelo `git-autosync install`.
 *
 * E o que separa "horario configurado" de "horario que vai acontecer": os horarios
 * vivem no `config.json` e so viram tarefa depois de um install. Ver os dois lados na
 * tela e o que evita o agendamento que parece certo e nunca roda.
 */
export interface TarefaAutosync {
  nome: string;
  /** Como o Agendador reporta: `Ready`, `Running`, `Disabled`. */
  estado: string;
  /** `YYYY-MM-DD HH:MM:SS`, ou vazio quando o Agendador nao sabe. */
  proximaExecucao: string;
  ultimaExecucao: string;
  /**
   * Codigo da ultima execucao; 0 e sucesso. `null` = o Agendador nao informou.
   *
   * E um HRESULT de 32 bits sem sinal, entao chega como numero grande (2147946720) e a
   * tela mostra em hexadecimal — que e a forma com que a Microsoft documenta.
   */
  ultimoResultado: number | null;
}

/** Ordem de severidade — usada para agregar o pior status de um conjunto. */
const SEVERITY: Record<Status, number> = { up: 0, unknown: 1, degraded: 2, down: 3 };

export function worstStatus(statuses: Status[]): Status {
  let worst: Status = 'unknown';
  let seen = false;
  for (const s of statuses) {
    if (!seen || SEVERITY[s] > SEVERITY[worst]) {
      worst = s;
      seen = true;
    }
  }
  return seen ? worst : 'unknown';
}

/* ----------------------------- skills do Claude Code ----------------------------- */

/** Modelos que a tela oferece. Vazio = o padrao do `claude` instalado na maquina. */
export const MODELOS_SKILL = ['', 'opus', 'sonnet', 'haiku'] as const;
export type ModeloSkill = (typeof MODELOS_SKILL)[number];

/**
 * Niveis de esforco de raciocinio que a tela oferece. Vazio = o padrao do `claude`.
 *
 * Os valores sao os aceitos pelo flag `--effort` da CLI (medido: `low, medium, high,
 * xhigh, max`); a CLI ignora um valor fora da lista, mas validar aqui devolve erro
 * legivel em vez de um esforco silenciosamente descartado.
 */
export const ESFORCOS_SKILL = ['', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EsforcoSkill = (typeof ESFORCOS_SKILL)[number];

export interface SkillDisponivel {
  /** Como a skill e' invocada: `plugin:skill`, ou so' `skill` quando e' do usuario. */
  id: string;
  nome: string;
  descricao: string;
  origem: 'plugin' | 'usuario';
  /** Plugin e versao instalada — o que a tela mostra para dizer de onde a skill veio. */
  plugin: string;
  versao: string;
}

export interface EstadoSessaoSkill {
  id: string;
  skill: string;
  pasta: string;
  modelo: ModeloSkill;
  esforco: EsforcoSkill;
  /** `session_id` do proprio Claude Code, para um futuro `--resume`. */
  sessaoClaude: string;
  viva: boolean;
  /** Custo acumulado reportado pela CLI — a tela mostra o da execucao. */
  custoUsd: number;
  iniciadaEm: string;
}

/** Documento de entrega ja' gerado num repositorio do cliente — ver src/documentosEntrega.ts. */
export interface DocumentoEntregaCliente {
  /** Caminho absoluto; e' a chave no envio do e-mail. */
  caminho: string;
  nome: string;
  repositorio: string;
  bytes: number;
  modificadoEm: string;
}

/* ------------------------- monitor de log das bases (serverlog) ------------------------- */

/** Um botão de ação do módulo `serverlog`, como está registrado na base. */
export interface BotaoServerLog {
  id: string;
  descricao: string;
  codModulo: string;
}

/** O que a verificação encontrou numa base — ver `desktop/src/serverLog.ts`. */
export interface StatusServerLog {
  botaoLer: BotaoServerLog | null;
  botaoMonitor: BotaoServerLog | null;
  modulo: { cod: string; resourceId: string; descricao: string } | null;
  leituraOk?: boolean;
  erroLeitura?: string;
}

/**
 * Registro de que o módulo está (ou esteve) numa base de cliente.
 *
 * Existe para o módulo não ficar esquecido lá depois da demanda: `removerAte` é o prazo,
 * `vencida` liga o aviso, e `removidoEm` só é preenchido depois de uma verificação
 * confirmar que módulo e botões sumiram da base.
 */
export interface InstalacaoServerLog {
  origin: string;
  clienteNome: string;
  detectadoEm: string;
  /** `YYYY-MM-DD`, data local. */
  removerAte: string;
  demanda: string;
  removidoEm: string;
  modulo: string;
  botaoId: string;
  botaoMonitorId: string;
  ultimaVerificacao: string;
  ultimoStatus: string;
  ativa: boolean;
  vencida: boolean;
}

/* ------------------------- escopo e kanban de tarefas do cliente ------------------------- */

/** As colunas do kanban, na ordem em que aparecem. */
export const ESTADOS_TAREFA = ['backlog', 'a_fazer', 'em_andamento', 'em_revisao', 'concluido'] as const;
export type EstadoTarefa = (typeof ESTADOS_TAREFA)[number];

export const PRIORIDADES_TAREFA = ['alta', 'media', 'baixa'] as const;
export type PrioridadeTarefa = (typeof PRIORIDADES_TAREFA)[number];

/**
 * O tipo de artefato Sankhya que a tarefa produz — é o que diz a quem distribuir e ajuda
 * a separar o que é código do que é configuração ou teste.
 */
export const TIPOS_TAREFA = [
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
export type TipoTarefa = (typeof TIPOS_TAREFA)[number];

export type StatusDocumentoEscopo = 'enviado' | 'analisando' | 'analisado' | 'falhou';

export interface DocumentoEscopo {
  id: number;
  clienteId: number;
  nome: string;
  /** `docx`, `pdf`, `md` ou `txt`. */
  tipo: string;
  bytes: number;
  enviadoEm: string;
  status: StatusDocumentoEscopo;
  analisadoEm: string;
  /** Resumo que a IA escreveu do escopo. */
  resumo: string;
  erro: string;
  /** Quantos caracteres de texto foram extraídos — 0 em PDF, que a IA lê direto. */
  caracteres: number;
}

export interface TarefaEscopo {
  id: number;
  clienteId: number;
  /** Documento que gerou a tarefa; `null` quando foi criada à mão. */
  documentoId: number | null;
  titulo: string;
  descricao: string;
  /** Feature ou épico a que a tarefa pertence — agrupa os cartões visualmente. */
  grupo: string;
  tipo: TipoTarefa;
  estimativaHoras: number;
  prioridade: PrioridadeTarefa;
  criteriosAceite: string;
  estado: EstadoTarefa;
  ordem: number;
  criadaEm: string;
  atualizadaEm: string;
}

export interface EscopoDoCliente {
  documentos: DocumentoEscopo[];
  tarefas: TarefaEscopo[];
}
