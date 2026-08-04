import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, interpolateTree, unsetVarsIn, UNSET_MARKER, ConfigError } from '../src/config.ts';

const minimo = (checks: string) => `
services:
  - id: s
    name: S
    checks:
${checks}
`;

const checkHttp = `      - id: c
        name: C
        type: http
        url: http://exemplo.test/`;

describe('interpolação de ${VAR}', () => {
  test('substitui pelo valor do ambiente', () => {
    const { value, missing } = interpolateTree({ a: 'x-${FOO}-y' }, { FOO: 'bar' });
    assert.deepEqual(value, { a: 'x-bar-y' });
    assert.deepEqual(missing, []);
  });

  test('usa o default de ${VAR:default} quando não definida', () => {
    const { value, missing } = interpolateTree({ a: '${NAO_EXISTE:padrao}' }, {});
    assert.deepEqual(value, { a: 'padrao' });
    assert.deepEqual(missing, []);
  });

  test('trata string vazia no ambiente como não definida', () => {
    const { value } = interpolateTree({ a: '${VAZIA:padrao}' }, { VAZIA: '' });
    assert.equal((value as { a: string }).a, 'padrao');
  });

  test('sem valor e sem default, grava o marcador e reporta como faltante', () => {
    const { value, missing } = interpolateTree({ a: '${SEM_VALOR}' }, {});
    assert.equal((value as { a: string }).a, `${UNSET_MARKER}SEM_VALOR`);
    assert.deepEqual(missing, ['SEM_VALOR']);
  });

  test('percorre arrays e objetos aninhados', () => {
    const { value } = interpolateTree({ l: [{ b: '${K}' }] }, { K: 'v' });
    assert.deepEqual(value, { l: [{ b: 'v' }] });
  });

  test('não confunde tipos não-string', () => {
    const { value } = interpolateTree({ n: 42, b: true, z: null }, {});
    assert.deepEqual(value, { n: 42, b: true, z: null });
  });

  // Regressão: a interpolação já rodou sobre o YAML cru, e um ${VAR} escrito num
  // comentário (a própria documentação do arquivo faz isso) contava como faltante.
  test('${VAR} dentro de comentário do YAML não conta como variável faltante', () => {
    const cfg = parseConfig(`# use \${VAR} ou \${VAR:default} aqui\n${minimo(checkHttp)}`);
    assert.deepEqual(cfg.missingEnv, []);
  });
});

describe('unsetVarsIn', () => {
  test('acha marcadores em qualquer profundidade', () => {
    assert.deepEqual(unsetVarsIn({ a: { b: [`${UNSET_MARKER}TOKEN`] } }), ['TOKEN']);
  });

  test('não duplica a mesma variável', () => {
    assert.deepEqual(unsetVarsIn([`${UNSET_MARKER}A`, `${UNSET_MARKER}A`]), ['A']);
  });

  test('devolve vazio quando não há marcador', () => {
    assert.deepEqual(unsetVarsIn({ a: 'tudo certo' }), []);
  });
});

describe('validação do services.yaml', () => {
  test('aceita a configuração mínima e aplica os defaults', () => {
    const cfg = parseConfig(minimo(checkHttp));
    assert.equal(cfg.retentionHours, 72);
    assert.equal(cfg.alerts.enabled, true);
    assert.equal(cfg.alerts.onDegraded, false);
    assert.equal(cfg.alerts.onRecovery, true);
    assert.equal(cfg.services[0]!.checks[0]!.intervalMs, 60000);
    assert.equal(cfg.services[0]!.checks[0]!.failureThreshold, 2);
  });

  test('rejeita service id duplicado', () => {
    const yaml = `
services:
  - id: s
    name: A
    checks:
${checkHttp}
  - id: s
    name: B
    checks:
${checkHttp}
`;
    assert.throws(() => parseConfig(yaml), (e: Error) => e instanceof ConfigError && /service id duplicado/.test(e.message));
  });

  test('rejeita check id duplicado dentro do mesmo serviço', () => {
    assert.throws(
      () => parseConfig(minimo(`${checkHttp}\n${checkHttp}`)),
      (e: Error) => e instanceof ConfigError && /check id duplicado/.test(e.message),
    );
  });

  test('rejeita intervalo abaixo do piso, para não virar DoS acidental', () => {
    assert.throws(() => parseConfig(minimo(`${checkHttp}\n        intervalMs: 100`)), ConfigError);
  });

  test('aponta o caminho do campo errado na mensagem', () => {
    const yaml = minimo(`      - id: c
        name: C
        type: http`);
    assert.throws(() => parseConfig(yaml), (e: Error) => /checks\.0\.url/.test(e.message));
  });

  test('config com variável faltante ainda é válida — o hub não pode cair por isso', () => {
    const cfg = parseConfig(minimo(`      - id: db
        name: DB
        type: oracle
        host: "\${HOST_INEXISTENTE}"
        serviceName: XE
        user: u
        password: p`));
    assert.deepEqual(cfg.missingEnv, ['HOST_INEXISTENTE']);
    assert.deepEqual(unsetVarsIn(cfg.services[0]!.checks[0]), ['HOST_INEXISTENTE']);
  });

  test('rejeita YAML sem nenhum serviço', () => {
    assert.throws(() => parseConfig('services: []'), ConfigError);
  });
});
