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
