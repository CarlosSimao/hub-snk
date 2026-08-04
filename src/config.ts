/**
 * Carga e validacao do `services.yaml`.
 *
 * O arquivo e a unica fonte de verdade: adicionar um projeto novo ao hub e adicionar
 * um item em `services`, sem tocar em codigo. Placeholders `${VAR}` / `${VAR:default}`
 * sao resolvidos contra o ambiente logo apos o parse, para senha de banco nao precisar
 * viver no YAML.
 */
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Marcador gravado no lugar de um `${VAR}` sem valor e sem default.
 *
 * Substituir por string vazia faria `url: ${VAR}` virar `url:` (null no YAML), a
 * validacao falharia e o hub inteiro nao subiria por causa de uma variavel de um
 * unico check. Com o marcador a config continua valida, e o engine transforma o
 * check afetado num semaforo cinza com a mensagem certa — o resto do painel vive.
 */
export const UNSET_MARKER = 'sankhya-hub-unset://';

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?\}/g;

/** Substitui `${VAR}` e `${VAR:fallback}` num unico valor de texto. */
function substitute(text: string, env: NodeJS.ProcessEnv, missing: Set<string>): string {
  return text.replace(PLACEHOLDER, (_all, name: string, fallback?: string) => {
    const value = env[name];
    if (value !== undefined && value !== '') return value;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return `${UNSET_MARKER}${name}`;
  });
}

export interface Interpolation<T> {
  value: T;
  /** Variaveis referenciadas sem valor e sem default. */
  missing: string[];
}

/**
 * Interpola os `${VAR}` das folhas de texto do documento **ja parseado**.
 *
 * Rodar sobre o YAML cru seria mais simples, mas ai um `${VAR}` escrito dentro de
 * um comentario (a propria documentacao do arquivo faz isso) contaria como
 * variavel faltando. Depois do parse os comentarios ja nao existem.
 */
export function interpolateTree<T>(root: T, env: NodeJS.ProcessEnv = process.env): Interpolation<T> {
  const missing = new Set<string>();

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') return substitute(node, env, missing);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === 'object') {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
    }
    return node;
  };

  return { value: walk(root) as T, missing: [...missing] };
}

/**
 * Nomes das `${VAR}` citadas num trecho do YAML **ainda nao interpolado**.
 *
 * Diferente de `unsetVarsIn`, que so enxerga o que FALTOU: aqui saem todas as variaveis
 * que o trecho usa, preenchidas ou nao. E o que o formulario de configuracao precisa
 * para montar os campos — inclusive os que ja tem valor, para voce poder corrigi-los.
 */
export function envVarsCitadas(node: unknown): string[] {
  const nomes = new Set<string>();

  const walk = (atual: unknown): void => {
    if (typeof atual === 'string') {
      for (const match of atual.matchAll(PLACEHOLDER)) {
        if (match[1]) nomes.add(match[1]);
      }
      return;
    }
    if (Array.isArray(atual)) {
      atual.forEach(walk);
      return;
    }
    if (atual && typeof atual === 'object') Object.values(atual).forEach(walk);
  };

  walk(node);
  return [...nomes];
}

/**
 * Default embutido em `${VAR:default}` num trecho do YAML **ainda nao interpolado**,
 * indexado pelo nome da variavel.
 *
 * Alimenta o "valor atual" mostrado no formulario quando a variavel nao veio do cofre
 * nem do ambiente do processo — e o mesmo valor que a interpolacao real usaria.
 * Primeira ocorrencia vence; variavel sem `:default` na sintaxe simplesmente nao entra.
 */
export function envVarDefaultsCitados(node: unknown): Record<string, string> {
  const defaults: Record<string, string> = {};

  const walk = (atual: unknown): void => {
    if (typeof atual === 'string') {
      for (const match of atual.matchAll(PLACEHOLDER)) {
        const [, nome, fallback] = match;
        if (nome && fallback !== undefined && !(nome in defaults)) defaults[nome] = fallback;
      }
      return;
    }
    if (Array.isArray(atual)) {
      atual.forEach(walk);
      return;
    }
    if (atual && typeof atual === 'object') Object.values(atual).forEach(walk);
  };

  walk(node);
  return defaults;
}

/** Nomes de variaveis nao resolvidas dentro de um trecho de config já interpolado. */
export function unsetVarsIn(value: unknown): string[] {
  const found = new Set<string>();
  const pattern = new RegExp(`${UNSET_MARKER.replace(/[/:]/g, '\\$&')}([A-Za-z_][A-Za-z0-9_]*)`, 'g');
  for (const match of JSON.stringify(value ?? null).matchAll(pattern)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

const identifier = z
  .string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'use apenas letras, numeros, ponto, hifen ou underline');

const baseCheck = {
  id: identifier,
  name: z.string().min(1),
  description: z.string().optional(),
  /** Periodo entre execucoes. Minimo 2s para nao virar DoS acidental no proprio serviço. */
  intervalMs: z.number().int().min(2000).default(15000),
  timeoutMs: z.number().int().min(250).max(120000).default(5000),
  /** Check silenciado nao contamina o semaforo do servico (mas continua sendo medido). */
  muted: z.boolean().default(false),
  /** Quantas falhas seguidas antes de virar vermelho. 1 = reage na primeira. */
  failureThreshold: z.number().int().min(1).max(10).default(2),
};

const httpCheck = z.object({
  ...baseCheck,
  type: z.literal('http'),
  url: z.string().url(),
  method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
  headers: z.record(z.string()).default({}),
  body: z.string().optional(),
  /** Status aceitos. Vazio => qualquer 2xx/3xx. */
  expectStatus: z.array(z.number().int()).default([]),
  /** Se presente, o corpo precisa conter esse texto para o check passar. */
  expectBodyContains: z.string().optional(),
  /** Acima disso fica amarelo em vez de verde. */
  degradedAboveMs: z.number().int().positive().optional(),
});

const tcpCheck = z.object({
  ...baseCheck,
  type: z.literal('tcp'),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  degradedAboveMs: z.number().int().positive().optional(),
});

const oracleCheck = z.object({
  ...baseCheck,
  type: z.literal('oracle'),
  /**
   * Duas formas de apontar o banco — use UMA:
   *  a) `connectString`: EZConnect (`host:1521/SERVICO`) ou descritor TNS completo
   *  b) `host` + `serviceName` (ou `sid`) em campos separados
   *
   * Prefira (b) no caso normal. O `connectString` existe para o que a sintaxe
   * EZConnect nao expressa: descritor TNS com varios enderecos, RAC, Data Guard.
   * A regra "connectString OU host + serviceName/sid" e checada em parseConfig.
   */
  connectString: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  // `coerce`: e o unico `port` do schema pensado para vir de `${VAR}` — a interpolacao
  // devolve string, os outros checks recebem o numero direto do YAML.
  port: z.coerce.number().int().min(1).max(65535).default(1521),
  serviceName: z.string().min(1).optional(),
  /** Alternativa ao `serviceName` em bancos antigos, sem servico registrado no listener. */
  sid: z.string().min(1).optional(),
  user: z.string().min(1),
  password: z.string(),
  degradedAboveMs: z.number().int().positive().optional(),
  /** Amarelo quando as sessoes abertas passarem desse % do parametro `sessions`. */
  sessionsWarnPct: z.number().min(1).max(100).default(80),
});

const dockerCheck = z.object({
  ...baseCheck,
  type: z.literal('docker'),
  /** Nome exato do container (`docker ps --format '{{.Names}}'`). */
  container: z.string().min(1),
});

/** Exportado para os testes montarem um check isolado já com os defaults aplicados. */
export const checkSchema = z.discriminatedUnion('type', [
  httpCheck,
  tcpCheck,
  oracleCheck,
  dockerCheck,
]);

const linkAction = z.object({
  id: identifier,
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.literal('link'),
  url: z.string().url(),
  /** Amarra a ação a um check especifico (ex.: "wildfly"). Ausente = ação do projeto. */
  checkId: z.string().optional(),
  /** Abre numa janela popup em vez de aba nova — para visualizadores tipo o log ao vivo. */
  popup: z.boolean().default(false),
});

const httpAction = z.object({
  id: identifier,
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.literal('http'),
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('POST'),
  headers: z.record(z.string()).default({}),
  body: z.string().optional(),
  timeoutMs: z.number().int().min(250).max(120000).default(10000),
  confirm: z.boolean().default(true),
  danger: z.boolean().default(false),
  checkId: z.string().optional(),
});

const dockerAction = z.object({
  id: identifier,
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.literal('docker'),
  container: z.string().min(1),
  /** Whitelist fechada: o hub nunca executa shell arbitrario. */
  operation: z.enum(['start', 'stop', 'restart']),
  confirm: z.boolean().default(true),
  danger: z.boolean().default(true),
  checkId: z.string().optional(),
});

const sequenceStepSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('docker'),
    container: z.string().min(1),
    operation: z.enum(['start', 'stop', 'restart']),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string().url(),
    method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).default('POST'),
    headers: z.record(z.string()).default({}),
    body: z.string().optional(),
    timeoutMs: z.number().int().min(250).max(120000).default(10000),
  }),
  z.object({
    type: z.literal('waitForCheck'),
    /** Id do check dentro do MESMO serviço da ação — não atravessa projetos. */
    checkId: z.string().min(1),
    /** Passo falha se o check não sair de `down`/`unknown` dentro deste prazo. */
    timeoutMs: z.number().int().min(1000).max(300000).default(60000),
    pollMs: z.number().int().min(500).max(30000).default(2000),
  }),
]);

const sequenceAction = z.object({
  id: identifier,
  label: z.string().min(1),
  description: z.string().optional(),
  type: z.literal('sequence'),
  steps: z.array(sequenceStepSchema).min(1),
  confirm: z.boolean().default(true),
  danger: z.boolean().default(false),
  checkId: z.string().optional(),
});

const actionSchema = z.discriminatedUnion('type', [linkAction, httpAction, dockerAction, sequenceAction]);

const serviceSchema = z.object({
  id: identifier,
  name: z.string().min(1),
  description: z.string().optional(),
  /** Emoji ou 1-2 letras — o dashboard usa como avatar do card. */
  icon: z.string().max(4).optional(),
  /**
   * Caminho de uma imagem servida pelo proprio hub (ex.: `/img/sankhya.svg`),
   * usada no lugar do `icon`. Os arquivos vivem em `public/img/`.
   *
   * Deliberadamente um caminho local, nunca uma URL externa: o painel roda numa
   * maquina que pode estar sem internet, e uma logo que depende da rede vira
   * quadrado quebrado justamente quando algo esta fora do ar.
   */
  image: z.string().optional(),
  /** Cor de destaque do card (qualquer valor CSS valido). */
  accent: z.string().optional(),
  tags: z.array(z.string()).default([]),
  links: z.array(z.object({ label: z.string(), url: z.string().url() })).default([]),
  checks: z.array(checkSchema).min(1),
  actions: z.array(actionSchema).default([]),
});

const alertsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Avisar quando um check fica amarelo, nao so vermelho. */
  onDegraded: z.boolean().default(false),
  /** Avisar quando volta ao normal — sem isto voce sabe que caiu, mas nao que voltou. */
  onRecovery: z.boolean().default(true),
  /**
   * Checks `muted` continuam fora dos alertas — silenciar so na tela e continuar
   * apitando no celular seria o pior dos dois mundos.
   */
  retentionHours: z.number().int().min(1).max(24 * 90).default(168),
});

export const configSchema = z.object({
  alerts: alertsSchema.default({}),
  /** Quanto tempo de historico manter no SQLite. Alimenta uptime % e sparklines. */
  retentionHours: z.number().int().min(1).max(24 * 90).default(72),
  /** Pausa entre o start do processo e o primeiro check, para o hub subir responsivo. */
  startupDelayMs: z.number().int().min(0).max(60000).default(500),
  services: z.array(serviceSchema).min(1),
});

export type AppConfig = z.infer<typeof configSchema> & {
  /** Uniao das variaveis nao resolvidas em qualquer parte do YAML. */
  missingEnv: string[];
  /**
   * Variaveis nao resolvidas de cada servico, indexadas pelo id.
   *
   * Precisa ser por servico, e nao uma lista so: com espaco de nomes por projeto, o
   * mesmo `ORACLE_HOST` pode estar preenchido num projeto e faltando em outro.
   */
  missingEnvByService: Record<string, string[]>;
  /**
   * Todas as `${VAR}` citadas por cada servico, preenchidas ou nao, indexadas pelo id.
   *
   * Colhidas do YAML CRU, antes da interpolacao — depois dela os placeholders ja viraram
   * valor e o nome da variavel se perdeu. E o que alimenta o formulario do painel.
   */
  envVarsByService: Record<string, string[]>;
  /**
   * Default embutido em `${VAR:default}` de cada servico, indexado por variavel.
   *
   * So entra aqui quem tem `:default` na sintaxe. Alimenta o "valor atual" do
   * formulario quando a variavel nao foi preenchida nem pelo cofre nem pelo ambiente.
   */
  envVarDefaultsByService: Record<string, Record<string, string>>;
};
export type ServiceConfig = z.infer<typeof serviceSchema>;
export type CheckConfig = z.infer<typeof checkSchema>;

export class ConfigError extends Error {}

/**
 * De onde saem os valores preenchidos pelo painel, por projeto.
 *
 * Tipo estrutural em vez de importar o `Cofre`: o parse da config nao precisa saber
 * que existe arquivo, e o teste passa um objeto literal.
 */
export interface FonteDeSegredos {
  valoresDe(serviceId: string): Record<string, string>;
}

export function parseConfig(
  raw: string,
  env: NodeJS.ProcessEnv = process.env,
  segredos?: FonteDeSegredos,
): AppConfig {
  const cru = parseYaml(raw);

  // Colhido ANTES de interpolar: depois disso `${VAR}` ja virou valor e o nome sumiu.
  const { nomes: envVarsByService, defaults: envVarDefaultsByService } = coletarVarsPorServico(cru);

  /*
   * Cada servico e interpolado com o PROPRIO ambiente: o global mais os segredos
   * daquele projeto. E o que da a cada projeto um espaco de nomes proprio — dois
   * projetos podem usar `ORACLE_HOST` apontando para bancos diferentes.
   *
   * O resto do documento (retentionHours, alerts) usa so o ambiente global: nao
   * pertence a projeto nenhum.
   */
  const missingEnvByService: Record<string, string[]> = {};
  const missingGlobal = new Set<string>();

  const interpolarServico = (servico: unknown): unknown => {
    const id = idDoServico(servico);
    const ambiente = id ? { ...env, ...segredos?.valoresDe(id) } : env;
    const { value, missing } = interpolateTree<unknown>(servico, ambiente);

    if (id) missingEnvByService[id] = missing;
    for (const nome of missing) missingGlobal.add(nome);
    return value;
  };

  const doc = interpolarPorPartes(cru, env, interpolarServico, missingGlobal);

  const result = configSchema.safeParse(doc);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.') || '(raiz)'}: ${i.message}`);
    throw new ConfigError(`services.yaml invalido:\n${lines.join('\n')}`);
  }

  const config: AppConfig = {
    ...result.data,
    missingEnv: [...missingGlobal],
    missingEnvByService,
    envVarsByService,
    envVarDefaultsByService,
  };

  const serviceIds = new Set<string>();
  for (const service of config.services) {
    if (serviceIds.has(service.id)) throw new ConfigError(`service id duplicado: "${service.id}"`);
    serviceIds.add(service.id);

    const checkIds = new Set<string>();
    for (const check of service.checks) {
      if (checkIds.has(check.id)) {
        throw new ConfigError(`check id duplicado em "${service.id}": "${check.id}"`);
      }
      checkIds.add(check.id);

      // O discriminatedUnion do Zod nao aceita `.refine()`, entao a regra
      // "connectString OU host + serviceName/sid" do oracle e verificada aqui.
      if (
        check.type === 'oracle' &&
        !check.connectString &&
        !(check.host && (check.serviceName || check.sid))
      ) {
        throw new ConfigError(
          `check "${service.id}/${check.id}": informe \`connectString\` ou \`host\` + \`serviceName\` (ou \`sid\`)`,
        );
      }
    }

    const actionIds = new Set<string>();
    for (const action of service.actions) {
      if (actionIds.has(action.id)) {
        throw new ConfigError(`action id duplicado em "${service.id}": "${action.id}"`);
      }
      actionIds.add(action.id);

      if (action.checkId && !checkIds.has(action.checkId)) {
        throw new ConfigError(
          `action "${service.id}/${action.id}": checkId "${action.checkId}" não existe neste projeto`,
        );
      }

      if (action.type === 'sequence') {
        for (const step of action.steps) {
          if (step.type === 'waitForCheck' && !checkIds.has(step.checkId)) {
            throw new ConfigError(
              `action "${service.id}/${action.id}": waitForCheck "${step.checkId}" não existe neste projeto`,
            );
          }
        }
      }
    }
  }

  return config;
}

/** O `id` cru de um servico, quando utilizavel como chave. */
function idDoServico(servico: unknown): string | null {
  if (!servico || typeof servico !== 'object') return null;
  const id = (servico as { id?: unknown }).id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Interpola o documento em duas partes: cada servico com o ambiente dele, o resto com
 * o ambiente global.
 *
 * Existe porque `interpolateTree` resolve uma arvore inteira contra UM ambiente, e aqui
 * o ambiente varia conforme o ramo — e o que da a cada projeto um espaco de nomes.
 */
function interpolarPorPartes(
  cru: unknown,
  env: NodeJS.ProcessEnv,
  interpolarServico: (servico: unknown) => unknown,
  missingGlobal: Set<string>,
): unknown {
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) {
    const { value, missing } = interpolateTree<unknown>(cru, env);
    for (const nome of missing) missingGlobal.add(nome);
    return value;
  }

  const { services, ...resto } = cru as Record<string, unknown>;

  const { value: restoInterpolado, missing } = interpolateTree<Record<string, unknown>>(resto, env);
  for (const nome of missing) missingGlobal.add(nome);

  if (!Array.isArray(services)) return { ...restoInterpolado, ...(services === undefined ? {} : { services }) };

  return { ...restoInterpolado, services: services.map(interpolarServico) };
}

/**
 * Percorre `services` no documento CRU e indexa as `${VAR}` de cada um pelo `id`.
 *
 * O `id` e lido cru de proposito: ele identifica o servico e nao faz sentido conter
 * placeholder. Servico sem id utilizavel e simplesmente ignorado aqui — a validacao do
 * Zod, logo em seguida, e quem reporta o erro com a mensagem certa.
 */
function coletarVarsPorServico(cru: unknown): {
  nomes: Record<string, string[]>;
  defaults: Record<string, Record<string, string>>;
} {
  const nomes: Record<string, string[]> = {};
  const defaults: Record<string, Record<string, string>> = {};
  if (!cru || typeof cru !== 'object') return { nomes, defaults };

  const services = (cru as { services?: unknown }).services;
  if (!Array.isArray(services)) return { nomes, defaults };

  for (const service of services) {
    const id = idDoServico(service);
    if (!id) continue;
    nomes[id] = envVarsCitadas(service);
    defaults[id] = envVarDefaultsCitados(service);
  }

  return { nomes, defaults };
}

/**
 * `env` sobrescreve `process.env` inteiro, nao complementa: quem chama monta a mistura
 * (hoje `{...process.env, ...cofre}`), e assim a precedencia fica visivel no chamador
 * em vez de escondida aqui.
 */
export async function loadConfig(
  path: string,
  env?: NodeJS.ProcessEnv,
  segredos?: FonteDeSegredos,
): Promise<AppConfig> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new ConfigError(`nao consegui ler ${path}: ${(err as Error).message}`);
  }
  return parseConfig(raw, env, segredos);
}
