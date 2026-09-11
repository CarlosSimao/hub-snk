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
  /** `link` abre URL no navegador; `http`, `docker` e `sequence` executam no servidor. */
  kind: 'link' | 'http' | 'docker' | 'sequence';
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
  /** URL do Sankhya do cliente, para abrir direto do painel. */
  sankhyaUrl: string;
  repositorioLocal: string;
  repositorioRemoto: string;
}

export type ClienteEntrada = Omit<Cliente, 'id'>;

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
  horasFeitas: string;
  etapa: string;
  processos: string;
}

export interface AgendaExperience {
  tarefas: TarefaExperience[];
  ordens: OrdemExperience[];
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
