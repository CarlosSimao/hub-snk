/**
 * Motor do hub: agenda os checks, aplica o limiar de falhas, guarda historico e
 * monta os snapshots que a API entrega.
 *
 * Cada check roda no seu proprio ciclo (`setTimeout` encadeado, nao `setInterval`),
 * entao um check lento nunca empilha execucoes nem atrasa os vizinhos. Os primeiros
 * disparos sao escalonados para o hub nao abrir todas as conexoes no mesmo instante.
 */
import { EventEmitter } from 'node:events';
import { unsetVarsIn, type AppConfig, type CheckConfig, type ServiceConfig } from './config.ts';
import type { DockerClient } from './docker.ts';
import { runCheck } from './checks/index.ts';
import { explicarCheck } from './checks/explicacao.ts';
import type { Store } from './store.ts';
import {
  worstStatus,
  type Alert,
  type CheckOutcome,
  type EnvVarStatus,
  type CheckSnapshot,
  type HubSnapshot,
  type ServiceSnapshot,
  type Status,
} from './types.ts';

/** Quantos pontos de historico acompanham cada check nas respostas da API. */
const HISTORY_POINTS = 120;

/** De quanto em quanto tempo as amostras fora da janela de retencao sao apagadas. */
const PRUNE_INTERVAL_MS = 30 * 60 * 1000;

interface CheckState {
  serviceId: string;
  config: CheckConfig;
  outcome: CheckOutcome;
  /** Status ja com o limiar de falhas aplicado — e o que vai para a tela e para o banco. */
  status: Status;
  ts: number;
  since: number;
  nextRunAt: number;
  consecutiveFailures: number;
  /**
   * Variaveis citadas pelo check que o ambiente nao definiu.
   *
   * Calculado na montagem do estado, nao a cada snapshot: `unsetVarsIn` serializa a
   * config inteira, e o snapshot roda a cada delta do SSE. A config so muda no reload,
   * que reconstroi os estados de qualquer forma.
   */
  unsetVars: string[];
  timer: NodeJS.Timeout | null;
  /** Evita execucoes concorrentes quando um "rodar agora" cai em cima do ciclo. */
  running: boolean;
  /** Monitoramento desabilitado pelo painel: sem timer, sem execucao, outcome congelado. */
  disabled: boolean;
  /**
   * A primeira medicao depois que o hub sobe nunca alerta.
   *
   * Sem isto, reiniciar o hub com um servico ja fora do ar dispararia a notificacao
   * de novo — e o pior: o estado restaurado do snapshot faria transicoes falsas
   * (`up` gravado ontem -> `down` medido agora) parecerem novidade.
   */
  primed: boolean;
}

const PENDING: CheckOutcome = {
  status: 'unknown',
  latencyMs: null,
  message: 'aguardando primeira medição',
  indicators: [],
  components: [],
};

/** Outcome congelado de um check com monitoramento desabilitado pelo painel. */
const DISABLED_OUTCOME: CheckOutcome = {
  status: 'unknown',
  latencyMs: null,
  message: 'monitoramento desabilitado manualmente',
  indicators: [],
  components: [],
};

/**
 * O que o engine precisa saber do registro de desabilitados: so leitura, nunca escrita
 * — quem grava e a rota, direto no `Desativados`. Tipo estrutural pelo mesmo motivo do
 * `FonteDeNomes`: o engine nao precisa importar a classe, e o teste passa um objeto
 * literal.
 */
export interface FonteDeDesativados {
  servicoDesabilitado(serviceId: string): boolean;
  checkDesabilitado(serviceId: string, checkId: string): boolean;
}

/**
 * O que o engine precisa saber dos overrides de intervalo/timeout: so leitura, mesmo
 * motivo do `FonteDeDesativados` — quem grava e a rota, direto no `ConfiguracoesCheck`.
 */
export interface FonteDeConfiguracoesCheck {
  overridesDe(serviceId: string, checkId: string): { intervalMs: number; timeoutMs: number } | undefined;
}

/**
 * O que o engine precisa saber do cofre: apenas QUAIS nomes tem valor, nunca os valores.
 *
 * Tipo estrutural em vez de importar a classe — o engine nao le nem escreve segredo, e
 * o teste monta um objeto literal.
 */
export interface FonteDeNomes {
  nomesDefinidosDe(serviceId: string): string[];
}

export class Engine extends EventEmitter {
  #config: AppConfig;
  readonly #store: Store;
  readonly #docker: DockerClient;
  readonly #cofre: FonteDeNomes | null;
  readonly #desativados: FonteDeDesativados | null;
  readonly #configuracoes: FonteDeConfiguracoesCheck | null;
  readonly #states = new Map<string, CheckState>();
  #pruneTimer: NodeJS.Timeout | null = null;
  #stopped = false;

  constructor(
    config: AppConfig,
    store: Store,
    docker: DockerClient,
    cofre?: FonteDeNomes,
    desativados?: FonteDeDesativados,
    configuracoes?: FonteDeConfiguracoesCheck,
  ) {
    super();
    this.#config = config;
    this.#store = store;
    this.#docker = docker;
    this.#cofre = cofre ?? null;
    this.#desativados = desativados ?? null;
    this.#configuracoes = configuracoes ?? null;
  }

  /** Aplica o override de intervalo/timeout deste check, se houver. */
  #comEfetivo(serviceId: string, check: CheckConfig): CheckConfig {
    const overrides = this.#configuracoes?.overridesDe(serviceId, check.id);
    if (!overrides) return check;
    return { ...check, intervalMs: overrides.intervalMs, timeoutMs: overrides.timeoutMs };
  }

  get config(): AppConfig {
    return this.#config;
  }

  static key(serviceId: string, checkId: string): string {
    return `${serviceId}:${checkId}`;
  }

  start(): void {
    this.#stopped = false;
    this.#rebuildStates();
    this.#pruneTimer = setInterval(() => this.#prune(), PRUNE_INTERVAL_MS);
    this.#pruneTimer.unref();
    this.#prune();
  }

  stop(): void {
    this.#stopped = true;
    for (const state of this.#states.values()) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
    }
    if (this.#pruneTimer) clearInterval(this.#pruneTimer);
    this.#pruneTimer = null;
  }

  /** Troca a config em quente: checks removidos param, novos entram, os iguais seguem o ciclo. */
  reload(config: AppConfig): void {
    this.#config = config;
    this.#rebuildStates();
    this.emit('reload');
  }

  #rebuildStates(): void {
    const wanted = new Set<string>();
    const persisted = this.#store.loadSnapshots();
    let index = 0;

    for (const service of this.#config.services) {
      for (const check of service.checks) {
        const key = Engine.key(service.id, check.id);
        wanted.add(key);

        const desabilitado = this.#desabilitadoPara(service.id, check.id);

        const existing = this.#states.get(key);
        if (existing) {
          // Mantem historico vivo; so a config e trocada. Se o intervalo mudou, o
          // proximo agendamento ja usa o novo valor.
          existing.config = this.#comEfetivo(service.id, check);
          existing.serviceId = service.id;
          existing.unsetVars = unsetVarsIn(check);
          this.#setDisabled(key, existing, desabilitado);
          continue;
        }

        const restored = persisted.get(key);
        const restoredOutcome =
          restored && isOutcome(restored.payload) ? (restored.payload as CheckOutcome) : null;

        const state: CheckState = {
          serviceId: service.id,
          config: this.#comEfetivo(service.id, check),
          outcome: desabilitado ? DISABLED_OUTCOME : (restoredOutcome ?? PENDING),
          status: desabilitado ? 'unknown' : (restoredOutcome?.status ?? 'unknown'),
          ts: restored?.ts ?? 0,
          since: restored?.ts ?? Date.now(),
          nextRunAt: 0,
          consecutiveFailures: 0,
          unsetVars: unsetVarsIn(check),
          timer: null,
          running: false,
          primed: false,
          disabled: desabilitado,
        };
        this.#states.set(key, state);

        // Escalonamento: 250ms entre os primeiros disparos. Desabilitado nao agenda.
        if (!desabilitado) this.#schedule(key, this.#config.startupDelayMs + index * 250);
        index += 1;
      }
    }

    for (const [key, state] of this.#states) {
      if (wanted.has(key)) continue;
      if (state.timer) clearTimeout(state.timer);
      this.#states.delete(key);
    }

    this.#store.pruneSnapshots(wanted);
  }

  #schedule(key: string, delayMs: number): void {
    const state = this.#states.get(key);
    if (!state || this.#stopped) return;

    if (state.timer) clearTimeout(state.timer);
    state.nextRunAt = Date.now() + delayMs;
    state.timer = setTimeout(() => {
      void this.#execute(key);
    }, delayMs);
    state.timer.unref();
  }

  async #execute(key: string): Promise<void> {
    const state = this.#states.get(key);
    if (!state || this.#stopped || state.disabled) return;

    if (state.running) {
      this.#schedule(key, state.config.intervalMs);
      return;
    }

    // Check que depende de uma variavel nao definida nao tem o que medir. Cinza com
    // a instrucao certa e honesto; vermelho seria mentira (nada esta fora do ar).
    if (state.unsetVars.length) {
      this.#apply(key, state, {
        status: 'unknown',
        latencyMs: null,
        message: `defina ${state.unsetVars.join(', ')} no botão "Configurar" do card deste projeto`,
        indicators: [],
        components: [],
      });
      this.#schedule(key, state.config.intervalMs);
      return;
    }

    state.running = true;
    let outcome: CheckOutcome;
    try {
      outcome = await runCheck(state.config, { docker: this.#docker });
    } catch (err) {
      // Bug no modulo de check nao pode derrubar o hub nem congelar o ciclo.
      outcome = {
        status: 'down',
        latencyMs: null,
        message: `erro interno no check: ${(err as Error).message}`,
        indicators: [],
        components: [],
      };
    } finally {
      state.running = false;
    }

    this.#apply(key, state, outcome);

    // `disabled` pode ter mudado enquanto o check estava em voo (running=true) — sem
    // este guard, o resultado que acabou de chegar reagendaria um timer que deveria
    // estar parado.
    if (!this.#stopped && !state.disabled) this.#schedule(key, state.config.intervalMs);
  }

  #apply(key: string, state: CheckState, outcome: CheckOutcome): void {
    // Mesma corrida: desabilitado no meio do voo descarta o resultado — o outcome
    // congelado de `#freeze` e quem deve prevalecer.
    if (state.disabled) return;

    const now = Date.now();

    // Limiar de falhas: um vermelho isolado (deploy, GC, rede piscando) aparece como
    // amarelo. So vira vermelho depois de `failureThreshold` falhas seguidas.
    if (outcome.status === 'down') {
      state.consecutiveFailures += 1;
    } else {
      state.consecutiveFailures = 0;
    }

    const effective: Status =
      outcome.status === 'down' && state.consecutiveFailures < state.config.failureThreshold
        ? 'degraded'
        : outcome.status;

    const previous = state.status;
    if (effective !== previous) state.since = now;

    state.outcome = outcome;
    state.status = effective;
    state.ts = now;

    this.#store.record(key, now, effective, outcome.latencyMs, outcome.message);
    this.#store.saveSnapshot(key, now, outcome);

    if (state.primed && effective !== previous) {
      this.#maybeAlert(state, previous, effective, now);
    }
    state.primed = true;

    this.emit('check', this.#snapshotFor(key, state));
  }

  /**
   * Decide se uma transicao merece interromper alguem.
   *
   * Regras, todas com o mesmo objetivo — que um alerta signifique algo:
   *  - `unknown` nunca alerta, em nenhuma direcao. Variavel faltando ou cota da API
   *    estourada e problema de configuracao do hub, nao incidente do servico.
   *  - Check `muted` nao alerta. Silenciar na tela e continuar apitando no celular
   *    seria o pior dos dois mundos.
   *  - `degraded` so alerta se voce pedir (`onDegraded`), porque amarelo e comum:
   *    um pico de latencia ou a primeira falha do limiar ja pinta amarelo.
   */
  #maybeAlert(state: CheckState, from: Status, to: Status, ts: number): void {
    const settings = this.#config.alerts;
    if (!settings.enabled || state.config.muted) return;
    if (from === 'unknown' || to === 'unknown') return;

    const recovered = to === 'up';
    if (recovered && !settings.onRecovery) return;
    if (to === 'degraded' && !settings.onDegraded) return;

    const service = this.#config.services.find((s) => s.id === state.serviceId);

    const alert: Alert = {
      id: `${state.serviceId}:${state.config.id}:${ts}`,
      ts,
      serviceId: state.serviceId,
      serviceName: service?.name ?? state.serviceId,
      checkId: state.config.id,
      checkName: state.config.name,
      from,
      to,
      detail: state.outcome.message,
      severity: recovered ? 'recovery' : to === 'down' ? 'critical' : 'warning',
    };

    this.#store.recordAlert(alert);
    this.emit('alert', alert);
  }

  recentAlerts(limit = 50): Alert[] {
    return this.#store.recentAlerts(limit);
  }

  /** Alerta sintetico para testar a permissao do navegador sem derrubar nada. */
  emitTestAlert(): Alert {
    const alert: Alert = {
      id: `test:${Date.now()}`,
      ts: Date.now(),
      serviceId: '_test',
      serviceName: 'monitor-hub',
      checkId: 'test',
      checkName: 'Alerta de teste',
      from: 'up',
      to: 'down',
      detail: 'Disparado manualmente — nenhum serviço foi afetado.',
      severity: 'critical',
    };
    this.#store.recordAlert(alert);
    this.emit('alert', alert);
    return alert;
  }

  /** Projeto OU check marcado como desabilitado no registro — qualquer um dos dois basta. */
  #desabilitadoPara(serviceId: string, checkId: string): boolean {
    if (!this.#desativados) return false;
    return (
      this.#desativados.servicoDesabilitado(serviceId) ||
      this.#desativados.checkDesabilitado(serviceId, checkId)
    );
  }

  /** Congela o outcome no estado "desabilitado" — o que aparece enquanto parado. */
  #freeze(state: CheckState): void {
    const now = Date.now();
    if (state.status !== 'unknown') state.since = now;
    state.outcome = DISABLED_OUTCOME;
    state.status = 'unknown';
    state.ts = now;
    state.consecutiveFailures = 0;
  }

  /** Aplica uma transicao de `disabled`: para timer e congela, ou executa e reagenda. */
  #setDisabled(key: string, state: CheckState, desabilitado: boolean): void {
    if (state.disabled === desabilitado) return;
    state.disabled = desabilitado;

    if (desabilitado) {
      if (state.timer) clearTimeout(state.timer);
      state.timer = null;
      this.#freeze(state);
      return;
    }

    // Reabilitado: mede na hora em vez de esperar o proximo ciclo — mesma logica do
    // `runService` apos configurar um projeto.
    void this.#execute(key).catch(() => {});
  }

  /**
   * Rele o registro de desabilitados e aplica a cada check — chamado pelas rotas depois
   * de gravar um toggle de projeto ou de check no `Desativados`.
   */
  refreshDisabled(): void {
    for (const [key, state] of this.#states) {
      const desabilitado = this.#desabilitadoPara(state.serviceId, state.config.id);
      this.#setDisabled(key, state, desabilitado);
    }
    this.emit('reload');
  }

  /**
   * Rele o override de intervalo/timeout de UM check e reagenda com o valor novo —
   * chamado pela rota depois de gravar no `ConfiguracoesCheck`.
   *
   * So o check tocado reagenda: resetar o timer dos outros jogaria fora o tempo que
   * ja tinham decorrido no ciclo, sem motivo nenhum ligado a esta mudanca.
   */
  refreshCheckConfig(serviceId: string, checkId: string): void {
    const key = Engine.key(serviceId, checkId);
    const state = this.#states.get(key);
    const check = this.#config.services.find((s) => s.id === serviceId)?.checks.find((c) => c.id === checkId);
    if (!state || !check) return;

    state.config = this.#comEfetivo(serviceId, check);
    if (!state.disabled) this.#schedule(key, state.config.intervalMs);
    this.emit('reload');
  }

  /**
   * Dispara agora todos os checks de um servico, sem esperar o resultado.
   *
   * Existe para o momento em que a configuracao do projeto acabou de ser preenchida: o
   * `reload` troca a config, mas os checks que ja existiam mantem o timer em curso e
   * continuariam exibindo "defina a variavel X" por ate um intervalo inteiro — no
   * Oracle, um minuto de mensagem errada logo depois de salvar.
   *
   * Nao devolve Promise de proposito: um check tem timeout de segundos e a resposta do
   * formulario nao pode esperar por ele. Cada resultado chega a tela pelo SSE.
   */
  runService(serviceId: string): void {
    for (const [key, state] of this.#states) {
      if (state.serviceId !== serviceId) continue;
      void this.#execute(key).catch(() => {});
    }
  }

  /** Dispara um check fora do ciclo e devolve o snapshot resultante. */
  async runNow(serviceId: string, checkId: string): Promise<CheckSnapshot | null> {
    const key = Engine.key(serviceId, checkId);
    const state = this.#states.get(key);
    if (!state) return null;

    await this.#execute(key);
    return this.#snapshotFor(key, state);
  }

  #snapshotFor(key: string, state: CheckState): CheckSnapshot {
    const sinceTs = Date.now() - this.#config.retentionHours * 3600_000;
    const { uptimePct } = this.#store.uptime(key, sinceTs);

    return {
      ...state.outcome,
      status: state.status,
      serviceId: state.serviceId,
      checkId: state.config.id,
      name: state.config.name,
      type: state.config.type,
      description: state.config.description,
      muted: state.config.muted,
      disabled: state.disabled,
      needsConfig: state.unsetVars.length > 0,
      explicacao: explicarCheck(state.config),
      ts: state.ts,
      consecutiveFailures: state.consecutiveFailures,
      since: state.since,
      nextRunAt: state.nextRunAt,
      intervalMs: state.config.intervalMs,
      timeoutMs: state.config.timeoutMs,
      uptimePct,
      history: this.#store.history(key, sinceTs, HISTORY_POINTS),
    };
  }

  snapshot(): HubSnapshot {
    const warnings: string[] = [];
    const services: ServiceSnapshot[] = [];

    let needsDocker = false;

    for (const service of this.#config.services) {
      const checks: CheckSnapshot[] = [];

      for (const check of service.checks) {
        if (check.type === 'docker') needsDocker = true;
        const key = Engine.key(service.id, check.id);
        const state = this.#states.get(key);
        if (state) checks.push(this.#snapshotFor(key, state));
      }

      if (service.actions.some((a) => a.type === 'docker')) needsDocker = true;

      // Checks silenciados ou desabilitados continuam visiveis, mas nao pintam o card.
      const considered = checks.filter((c) => !c.muted && !c.disabled).map((c) => c.status);

      services.push({
        id: service.id,
        name: service.name,
        description: service.description,
        icon: service.icon,
        image: service.image,
        accent: service.accent,
        tags: service.tags,
        links: service.links,
        status: worstStatus(considered),
        checks,
        actions: describeActions(service),
        envVars: this.#envVarsDo(service.id),
        disabled: this.#desativados?.servicoDesabilitado(service.id) ?? false,
      });
    }

    // Variavel faltando NAO vira aviso global. O banner no topo listava as variaveis
    // de todos os projetos juntos, sem dizer a quem pertenciam — ruido permanente numa
    // tela cujo trabalho e destacar o que mudou. A informacao vive onde ela e acionavel:
    // `needsConfig` marca o card, e a mensagem com os nomes fica na linha do check.

    if (needsDocker && !this.#docker.available) {
      warnings.push(
        'Socket do Docker não está acessível: checks e ações de container ficam indisponíveis. ' +
          'Monte /var/run/docker.sock no container do hub.',
      );
    }

    return {
      generatedAt: Date.now(),
      // Projeto desabilitado nao pinta o semaforo global, mesmo com um status congelado.
      status: worstStatus(services.filter((s) => !s.disabled).map((s) => s.status)),
      services,
      warnings,
      alerts: this.#store.recentAlerts(50),
    };
  }

  /**
   * Estado das variaveis de um projeto — nomes e se tem valor, jamais os valores.
   *
   * "Definida" e o complemento de `missingEnvByService`: se a interpolacao daquele
   * projeto nao reclamou do nome, alguem o resolveu — o cofre, um default escrito no
   * proprio YAML, ou uma variavel injetada no ambiente do container.
   */
  #envVarsDo(serviceId: string): EnvVarStatus[] {
    const nomes = this.#config.envVarsByService[serviceId] ?? [];
    if (!nomes.length) return [];

    // Faltantes DESTE projeto: com espaço de nomes por projeto, o mesmo nome pode
    // estar resolvido num e faltando em outro.
    const faltando = new Set(this.#config.missingEnvByService[serviceId] ?? []);
    const noCofre = new Set(this.#cofre?.nomesDefinidosDe(serviceId) ?? []);

    return nomes.map((name) => ({
      name,
      defined: !faltando.has(name),
      fromVault: noCofre.has(name),
    }));
  }

  #prune(): number {
    const now = Date.now();
    this.#store.pruneAlerts(now - this.#config.alerts.retentionHours * 3600_000);
    return this.#store.prune(now - this.#config.retentionHours * 3600_000);
  }
}

function describeActions(service: ServiceConfig): ServiceSnapshot['actions'] {
  return service.actions.map((action) => ({
    id: action.id,
    label: action.label,
    kind: action.type,
    description: action.description,
    confirm: action.type === 'link' ? false : action.confirm,
    // URL so vaza para o cliente em `link`; em `http` a chamada acontece no servidor.
    url: action.type === 'link' ? action.url : undefined,
    popup: action.type === 'link' ? action.popup : undefined,
    danger: action.type === 'link' ? false : action.danger,
    checkId: action.checkId,
  }));
}

function isOutcome(value: unknown): value is CheckOutcome {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CheckOutcome>;
  return typeof candidate.status === 'string' && Array.isArray(candidate.indicators);
}
