/**
 * O protocolo TNS e binario e proprietario — nao da para simular um Oracle com um
 * servidor de mentira em 127.0.0.1, como o teste de http faz. Entao a logica
 * que decide o semaforo vive em funcoes puras (`interpretarSonda`, `descreverErroOracle`,
 * `montarConnectString`), e e isso que os testes exercitam.
 *
 * O unico teste que abre socket usa uma porta fechada: nao valida o protocolo, valida
 * que a falha de conexao vira vermelho com mensagem, em vez de excecao vazando.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  descreverErroOracle,
  interpretarSonda,
  montarConnectString,
  runOracleCheck,
  type ProbeRow,
} from '../../src/checks/oracle.ts';
import { check, portaFechada } from '../helpers.ts';

const CREDENCIAIS = { user: 'sankhya', password: 'segredo' };

function sonda(extra: Partial<ProbeRow> = {}): ProbeRow {
  return {
    INSTANCE_NAME: 'ORCL',
    STATUS: 'OPEN',
    DATABASE_STATUS: 'ACTIVE',
    VERSION: '19.0.0.0.0',
    UPTIME_SECONDS: 93_600,
    SESSIONS: 40,
    MAX_SESSIONS: 400,
    ...extra,
  };
}

describe('montarConnectString', () => {
  test('host + serviceName vira EZConnect com barra', () => {
    const cfg = check('oracle', { host: 'db', port: 1521, serviceName: 'ORCLPDB', ...CREDENCIAIS });
    assert.equal(montarConnectString(cfg), 'db:1521/ORCLPDB');
  });

  test('sid usa dois-pontos em vez de barra', () => {
    const cfg = check('oracle', { host: 'db', port: 1521, sid: 'ORCL', ...CREDENCIAIS });
    assert.equal(montarConnectString(cfg), 'db:1521:ORCL');
  });

  test('porta cai no default 1521 quando omitida', () => {
    const cfg = check('oracle', { host: 'db', serviceName: 'ORCLPDB', ...CREDENCIAIS });
    assert.equal(montarConnectString(cfg), 'db:1521/ORCLPDB');
  });

  test('connectString explicito vence os campos separados', () => {
    const descritor = '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=a)(PORT=1521)))';
    const cfg = check('oracle', {
      connectString: descritor,
      host: 'ignorado',
      serviceName: 'ignorado',
      ...CREDENCIAIS,
    });
    assert.equal(montarConnectString(cfg), descritor);
  });
});

describe('interpretarSonda', () => {
  const cfg = check('oracle', { host: 'db', serviceName: 'ORCLPDB', ...CREDENCIAIS });

  test('instância OPEN e ACTIVE acende verde', () => {
    const out = interpretarSonda(sonda(), 30, cfg);
    assert.equal(out.status, 'up');
    assert.match(out.message, /ORCL aberta e ativa/);
  });

  test('coleta os cinco indicadores', () => {
    const out = interpretarSonda(sonda(), 30, cfg);
    assert.deepEqual(
      out.indicators.map((i) => i.id),
      ['latency', 'instance-status', 'sessions', 'uptime', 'version'],
    );
  });

  test('uptime vira duração legível', () => {
    const out = interpretarSonda(sonda({ UPTIME_SECONDS: 93_600 }), 30, cfg);
    assert.equal(out.indicators.find((i) => i.id === 'uptime')?.value, '1d 2h');
  });

  test('sessões trazem o máximo, para o dashboard desenhar barra', () => {
    const out = interpretarSonda(sonda(), 30, cfg);
    const sessoes = out.indicators.find((i) => i.id === 'sessions');
    assert.equal(sessoes?.value, 40);
    assert.equal(sessoes?.max, 400);
    assert.equal(sessoes?.status, 'up');
  });

  // O modo de falha que um check TCP na 1521 nao pega: listener responde, instancia
  // de pe, e nenhuma consulta funciona porque o banco nunca foi aberto.
  test('instância MOUNTED fica amarela, não verde', () => {
    const out = interpretarSonda(sonda({ STATUS: 'MOUNTED' }), 30, cfg);
    assert.equal(out.status, 'degraded');
    assert.match(out.message, /MOUNTED/);
    assert.match(out.message, /não está atendendo/);
  });

  test('database_status suspenso também derruba para amarelo', () => {
    const out = interpretarSonda(sonda({ DATABASE_STATUS: 'SUSPENDED' }), 30, cfg);
    assert.equal(out.status, 'degraded');
    assert.equal(out.indicators.find((i) => i.id === 'instance-status')?.status, 'degraded');
  });

  test('sessões acima do limiar acendem amarelo', () => {
    const out = interpretarSonda(sonda({ SESSIONS: 360, MAX_SESSIONS: 400 }), 30, cfg);
    assert.equal(out.status, 'degraded');
    assert.match(out.message, /sessões em 90%/);
    assert.equal(out.indicators.find((i) => i.id === 'sessions')?.status, 'degraded');
  });

  test('sessionsWarnPct customizado muda o ponto de virada', () => {
    const folgado = check('oracle', {
      host: 'db',
      serviceName: 'ORCLPDB',
      sessionsWarnPct: 95,
      ...CREDENCIAIS,
    });
    const out = interpretarSonda(sonda({ SESSIONS: 360, MAX_SESSIONS: 400 }), 30, folgado);
    assert.equal(out.status, 'up');
  });

  test('degradedAboveMs pinta amarelo por lentidão', () => {
    const exigente = check('oracle', {
      host: 'db',
      serviceName: 'ORCLPDB',
      degradedAboveMs: 100,
      ...CREDENCIAIS,
    });
    const out = interpretarSonda(sonda(), 350, exigente);
    assert.equal(out.status, 'degraded');
    assert.match(out.message, /lento \(350ms\)/);
  });

  test('max_sessions zerado não divide por zero', () => {
    const out = interpretarSonda(sonda({ SESSIONS: 0, MAX_SESSIONS: 0 }), 30, cfg);
    assert.equal(out.status, 'up');
  });
});

describe('descreverErroOracle', () => {
  test('ORA-01017 vira mensagem de credencial', () => {
    const { status, message } = descreverErroOracle(new Error('ORA-01017: invalid credential'));
    assert.equal(status, 'down');
    assert.match(message, /usuário\/senha/);
  });

  test('ORA-12541 aponta o listener', () => {
    const { status, message } = descreverErroOracle(new Error('ORA-12541: TNS:no listener'));
    assert.equal(status, 'down');
    assert.match(message, /listener não respondeu/);
  });

  test('ORA-12514 separa "listener no ar" de "service errado"', () => {
    const { message } = descreverErroOracle(
      new Error('ORA-12514: Cannot connect to database. Service XPTO is not registered'),
    );
    assert.match(message, /não conhece esse service name/);
  });

  // Banco subindo e estado transitorio esperado; vermelho aqui seria alarme falso.
  test('ORA-01033 é amarelo, não vermelho', () => {
    const { status, message } = descreverErroOracle(
      new Error('ORA-01033: ORACLE initialization or shutdown in progress'),
    );
    assert.equal(status, 'degraded');
    assert.match(message, /subindo ou parando/);
  });

  // Driver incompatível com a versão do banco não é queda: nada está fora do ar, e
  // vermelho aqui mandaria investigar o banco em vez do check.
  test('NJS-138 (banco anterior ao 12.1) fica cinza, não vermelho', () => {
    const { status, message } = descreverErroOracle(
      new Error('NJS-138: connections to this database server version are not supported'),
    );
    assert.equal(status, 'unknown');
    assert.match(message, /Oracle 12\.1\+/);
    assert.match(message, /tcp/);
  });

  test('erro sem código conhecido devolve só a primeira linha', () => {
    const { status, message } = descreverErroOracle(
      new Error('falha estranha\n(DESCRIPTION=(ADDRESS=(HOST=db)))\nmais ruído'),
    );
    assert.equal(status, 'down');
    assert.equal(message, 'falha estranha');
  });

  test('erro sem mensagem não quebra', () => {
    assert.equal(descreverErroOracle(undefined).message, 'falha desconhecida');
  });
});

describe('runOracleCheck', () => {
  test('porta fechada vira vermelho com mensagem, sem exceção vazando', async () => {
    const porta = await portaFechada();
    const cfg = check('oracle', {
      host: '127.0.0.1',
      port: porta,
      serviceName: 'XE',
      timeoutMs: 2000,
      ...CREDENCIAIS,
    });

    const out = await runOracleCheck(cfg);
    assert.equal(out.status, 'down');
    assert.equal(out.latencyMs, null);
    assert.ok(out.message.length > 0);
    assert.deepEqual(out.indicators, []);
  });
});
