import oracledb from 'oracledb';
import type { CheckConfig } from '../config.ts';
import type { CheckOutcome, Indicator, Status } from '../types.ts';
import { formatDuration } from './formatDuration.ts';

type OracleCheck = Extract<CheckConfig, { type: 'oracle' }>;

/**
 * Liga o **Thick mode** quando o Oracle Instant Client esta na imagem.
 *
 * Por que importa: o Thin mode (JavaScript puro) so fala com Oracle 12.1 ou superior.
 * Contra um 11g ele devolve NJS-138 e nem chega a testar a credencial. Com o Thick, o
 * check faz o "test connection" completo — handshake, autenticacao e consulta.
 *
 * Sem o cliente instalado o check continua funcionando em Thin mode; so perde os bancos
 * antigos. Por isso a falha aqui e silenciosa: e degradacao de capacidade, nao erro.
 *
 * `libDir` e especifico de plataforma:
 *
 *   - Linux: nunca passar. Quem resolve as bibliotecas e o dynamic linker (o Dockerfile
 *     registra o diretorio no ldconfig), e passar `libDir` leva a DPI-1047 mesmo com os
 *     arquivos no lugar.
 *   - Windows: e o caminho bom. O hub nativo (shell desktop) carrega o Instant Client
 *     empacotado junto do app, sem exigir que o usuario mexa no PATH da maquina nem
 *     instale cliente Oracle a parte.
 *
 * Roda uma unica vez, no carregamento do modulo — a chamada e global ao processo e
 * lanca se repetida.
 */
const ORACLE_CLIENT_DIR = process.env['ORACLE_CLIENT_DIR'] ?? '';

/** Util para diagnostico: sem isto, "11g nao conecta" e indistinguivel de credencial errada. */
export let oracleThickAtivo = false;

try {
  if (ORACLE_CLIENT_DIR && process.platform === 'win32') {
    oracledb.initOracleClient({ libDir: ORACLE_CLIENT_DIR });
  } else {
    oracledb.initOracleClient();
  }
  oracleThickAtivo = true;
} catch {
  // Instant Client ausente: segue em Thin mode.
}

/**
 * Uma conexao nova a cada ciclo, de proposito: pool mascara queda de rede e
 * esgotamento de sessoes, que sao justamente as falhas que queremos ver.
 *
 * As views `v$` exigem grant (`SELECT_CATALOG_ROLE` ou equivalente). O usuario de
 * aplicacao do Sankhya normalmente nao tem — por isso existe o fallback em
 * `runOracleCheck`, que cai para `SELECT 1 FROM dual`.
 */
const PROBE_SQL = `
  SELECT
    i.instance_name                                                  AS instance_name,
    i.status                                                         AS status,
    i.database_status                                                AS database_status,
    i.version                                                        AS version,
    ROUND((SYSDATE - i.startup_time) * 86400)                        AS uptime_seconds,
    (SELECT COUNT(*) FROM v$session WHERE type = 'USER')             AS sessions,
    (SELECT TO_NUMBER(value) FROM v$parameter WHERE name = 'sessions') AS max_sessions
  FROM v$instance i
`;

export interface ProbeRow {
  INSTANCE_NAME: string;
  /** OPEN, MOUNTED, STARTED... Só OPEN significa banco atendendo. */
  STATUS: string;
  /** ACTIVE, SUSPENDED, INSTANCE RECOVERY. */
  DATABASE_STATUS: string;
  VERSION: string;
  UPTIME_SECONDS: number;
  SESSIONS: number;
  MAX_SESSIONS: number;
}

/** Estado da instancia que significa "banco aberto e atendendo consultas". */
const INSTANCIA_ABERTA = 'OPEN';
const BANCO_ATIVO = 'ACTIVE';

/**
 * Monta o descritor de conexao a partir dos campos separados.
 *
 * `connectString` explicito vence — e a saida para descritor TNS completo, Data Guard
 * ou RAC com varios endereços, que a sintaxe EZConnect nao expressa.
 */
export function montarConnectString(cfg: OracleCheck): string {
  if (cfg.connectString) return cfg.connectString;
  // EZConnect: `host:porta/servico` para service name, `host:porta:SID` para SID.
  if (cfg.sid) return `${cfg.host}:${cfg.port}:${cfg.sid}`;
  return `${cfg.host}:${cfg.port}/${cfg.serviceName}`;
}

/**
 * Traduz a falha do driver em semaforo + mensagem.
 *
 * Nem toda falha de conexao e "banco caiu": ORA-01033 e o banco **subindo**, e
 * pintar isso de vermelho durante um start programado seria alarme falso. Por isso
 * o retorno traz o status, nao so o texto.
 */
export function descreverErroOracle(err: unknown): { status: Status; message: string } {
  const message = (err as Error)?.message ?? '';
  const codigo = message.match(/(ORA-\d{5}|NJS-\d{3}|DPY-\d{4})/)?.[1] ?? '';

  switch (codigo) {
    case 'ORA-01017':
      return { status: 'down', message: 'autenticação falhou (usuário/senha)' };
    case 'ORA-28000':
      return { status: 'down', message: 'conta bloqueada no Oracle' };
    case 'ORA-28001':
      return { status: 'down', message: 'senha expirada' };
    case 'ORA-12541':
      return { status: 'down', message: 'listener não respondeu — Oracle fora do ar?' };
    case 'ORA-12514':
      return { status: 'down', message: 'listener no ar, mas não conhece esse service name' };
    case 'ORA-12505':
      return { status: 'down', message: 'listener no ar, mas não conhece esse SID' };
    case 'ORA-12170':
    case 'DPY-6005':
      return { status: 'down', message: 'timeout na conexão' };
    case 'NJS-138':
      // Thin mode fala o protocolo a partir do Oracle 12.1. Banco 11g ou anterior so
      // conecta em Thick mode, que exige o Oracle Instant Client (e uma imagem com
      // glibc, nao Alpine). Nao e falha do banco — e incompatibilidade do driver.
      return {
        status: 'unknown',
        message:
          'banco antigo demais para o driver Thin (precisa de Oracle 12.1+) — use um check `tcp` na 1521',
      };
    case 'NJS-503':
      // Thin mode nao chega a falar TNS: o socket nem abriu. Listener parado, porta
      // fechada por firewall, ou host resolvendo para um endereco que nao atende.
      return { status: 'down', message: 'não consegui abrir conexão — host/porta inacessível' };
    case 'ORA-12547':
      return { status: 'down', message: 'conexão perdida com o servidor (TNS lost contact)' };
    case 'ORA-01033':
      // Banco em startup/shutdown. Amarelo: e um estado transitorio esperado, nao queda.
      return { status: 'degraded', message: 'instância subindo ou parando (ORA-01033)' };
    case 'ORA-12518':
    case 'ORA-00020':
      return { status: 'down', message: 'sem processo/sessão livre — limite do banco atingido' };
    default:
      // Sem codigo reconhecido, a primeira linha do erro ja e o mais informativo:
      // o driver empilha o descritor de conexao inteiro nas linhas seguintes.
      return { status: 'down', message: message.split('\n')[0]?.trim() || 'falha desconhecida' };
  }
}

/** Converte a linha da sonda no veredito e nos indicadores da tela. */
export function interpretarSonda(row: ProbeRow, latencyMs: number, cfg: OracleCheck): CheckOutcome {
  const sessions = Number(row.SESSIONS);
  const maxSessions = Number(row.MAX_SESSIONS);
  const usagePct = maxSessions ? (sessions / maxSessions) * 100 : 0;
  const sessoesApertadas = usagePct >= cfg.sessionsWarnPct;

  const aberta = row.STATUS === INSTANCIA_ABERTA && row.DATABASE_STATUS === BANCO_ATIVO;
  const lento = cfg.degradedAboveMs !== undefined && latencyMs > cfg.degradedAboveMs;

  const indicators: Indicator[] = [
    { id: 'latency', label: 'Latência', value: latencyMs, unit: 'ms' },
    {
      id: 'instance-status',
      label: 'Instância',
      value: `${row.INSTANCE_NAME} ${row.STATUS}`,
      status: aberta ? 'up' : 'degraded',
    },
    {
      id: 'sessions',
      label: 'Sessões',
      value: sessions,
      max: maxSessions,
      status: sessoesApertadas ? 'degraded' : 'up',
    },
    { id: 'uptime', label: 'Uptime', value: formatDuration(Number(row.UPTIME_SECONDS)) },
    { id: 'version', label: 'Versão', value: row.VERSION },
  ];

  const status: Status = !aberta || lento || sessoesApertadas ? 'degraded' : 'up';

  let message = `${row.INSTANCE_NAME} aberta e ativa`;
  if (!aberta) {
    // MOUNTED e o caso classico: a instancia esta de pe, o listener responde, mas o
    // banco nao foi aberto — de fora parece saudavel e nenhuma consulta funciona.
    message = `instância ${row.STATUS} / banco ${row.DATABASE_STATUS} — não está atendendo`;
  } else if (sessoesApertadas) {
    message = `sessões em ${usagePct.toFixed(0)}% do limite`;
  } else if (lento) {
    message = `conectado, lento (${latencyMs}ms)`;
  }

  return { status, latencyMs, message, indicators, components: [] };
}

export async function runOracleCheck(cfg: OracleCheck): Promise<CheckOutcome> {
  const started = performance.now();
  let connection: oracledb.Connection | undefined;

  try {
    connection = await oracledb.getConnection({
      user: cfg.user,
      password: cfg.password,
      connectString: montarConnectString(cfg),
      // O driver conta em segundos; abaixo de 1s nao ha como pedir menos.
      connectTimeout: Math.max(1, Math.ceil(cfg.timeoutMs / 1000)),
    });
    // Corta a query travada. Sem isto um banco que aceita conexao mas nao responde
    // (lock, I/O parado) seguraria o ciclo do check indefinidamente.
    connection.callTimeout = cfg.timeoutMs;

    let row: ProbeRow | undefined;
    try {
      const result = await connection.execute<ProbeRow>(PROBE_SQL, [], {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
      });
      row = result.rows?.[0];
    } catch (probeErr) {
      // Usuario de aplicacao sem grant nas views `v$` (o caso comum no Sankhya).
      // Conectar e executar ja e o sinal que importa — as metricas sao bonus, entao
      // caimos para o `dual` em vez de pintar o semaforo de vermelho.
      await connection.execute('SELECT 1 FROM dual');
      const latencyMs = Math.round(performance.now() - started);
      const lento = cfg.degradedAboveMs !== undefined && latencyMs > cfg.degradedAboveMs;
      return {
        status: lento ? 'degraded' : 'up',
        latencyMs,
        message: `conectado — métricas indisponíveis (${(probeErr as Error).message.split('\n')[0]})`,
        indicators: [{ id: 'latency', label: 'Latência', value: latencyMs, unit: 'ms' }],
        components: [],
      };
    }

    const latencyMs = Math.round(performance.now() - started);

    if (!row) {
      return {
        status: 'degraded',
        latencyMs,
        message: 'conectou, mas a query de sonda não retornou linha',
        indicators: [{ id: 'latency', label: 'Latência', value: latencyMs, unit: 'ms' }],
        components: [],
      };
    }

    return interpretarSonda(row, latencyMs, cfg);
  } catch (err) {
    const { status, message } = descreverErroOracle(err);
    return { status, latencyMs: null, message, indicators: [], components: [] };
  } finally {
    await connection?.close().catch(() => {});
  }
}
