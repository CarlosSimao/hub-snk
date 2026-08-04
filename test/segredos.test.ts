import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cofre } from '../src/segredos.ts';
import { parseConfig, envVarsCitadas, envVarDefaultsCitados } from '../src/config.ts';
import { dirTemporario } from './helpers.ts';

const ALPHA = 'alpha';
const BETA = 'beta';

describe('Cofre', () => {
  test('grava, relê e sobrevive a reabrir', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { SENHA_DB: 'segredo', HOST_DB: 'db.local' });

      assert.deepEqual(cofre.valoresDe(ALPHA), { SENHA_DB: 'segredo', HOST_DB: 'db.local' });

      // Um processo novo precisa enxergar o que o anterior gravou — é o que faz o
      // formulário sobreviver ao restart do container.
      const outro = new Cofre(dir.path);
      assert.equal(outro.valoresDe(ALPHA)['SENHA_DB'], 'segredo');
    } finally {
      dir.remove();
    }
  });

  // O motivo de existir o espaço de nomes por projeto: dois projetos podem usar
  // `ORACLE_HOST` apontando para bancos diferentes, sem um sobrescrever o outro.
  test('o mesmo nome em projetos diferentes guarda valores diferentes', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { ORACLE_HOST: 'alpha.local' });
      cofre.gravar(BETA, { ORACLE_HOST: 'beta.local' });

      assert.equal(cofre.valoresDe(ALPHA)['ORACLE_HOST'], 'alpha.local');
      assert.equal(cofre.valoresDe(BETA)['ORACLE_HOST'], 'beta.local');
    } finally {
      dir.remove();
    }
  });

  test('apagar variável de um projeto não toca no outro', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { X: '1' });
      cofre.gravar(BETA, { X: '2' });
      cofre.gravar(ALPHA, { X: '' });

      assert.deepEqual(cofre.valoresDe(ALPHA), {});
      assert.equal(cofre.valoresDe(BETA)['X'], '2');
    } finally {
      dir.remove();
    }
  });

  test('projeto desconhecido devolve conjunto vazio, não erro', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      assert.deepEqual(cofre.valoresDe('nao-existe'), {});
      assert.deepEqual(cofre.nomesDefinidosDe('nao-existe'), []);
    } finally {
      dir.remove();
    }
  });

  test('gravar mescla em vez de substituir o conjunto do projeto', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { A: '1' });
      cofre.gravar(ALPHA, { B: '2' });
      assert.deepEqual(cofre.valoresDe(ALPHA), { A: '1', B: '2' });
    } finally {
      dir.remove();
    }
  });

  test('string vazia remove a variável', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { A: '1', B: '2' });
      cofre.gravar(ALPHA, { A: '' });
      assert.deepEqual(cofre.valoresDe(ALPHA), { B: '2' });
      assert.deepEqual(cofre.nomesDefinidosDe(ALPHA), ['B']);
    } finally {
      dir.remove();
    }
  });

  test('projeto que ficou sem variáveis some do arquivo', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { A: '1' });
      cofre.gravar(ALPHA, { A: '' });

      const bruto = JSON.parse(readFileSync(join(dir.path, 'segredos.json'), 'utf8'));
      assert.deepEqual(bruto, {});
    } finally {
      dir.remove();
    }
  });

  test('valoresDe() devolve cópia — mutá-la não afeta o cofre', () => {
    const dir = dirTemporario();
    try {
      const cofre = new Cofre(dir.path);
      cofre.gravar(ALPHA, { A: '1' });
      const copia = cofre.valoresDe(ALPHA);
      copia['A'] = 'adulterado';
      assert.equal(cofre.valoresDe(ALPHA)['A'], '1');
    } finally {
      dir.remove();
    }
  });

  // Arquivo corrompido não pode impedir o hub de subir: sem isso, um JSON truncado
  // deixaria o painel inteiro fora do ar em vez de só pedir a configuração de novo.
  test('arquivo ilegível vira cofre vazio em vez de exceção', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(join(dir.path, 'segredos.json'), '{ isto não é json');
      const cofre = new Cofre(dir.path);
      assert.deepEqual(cofre.valoresDe(ALPHA), {});
    } finally {
      dir.remove();
    }
  });

  test('entrada não-string dentro do projeto é descartada', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(
        join(dir.path, 'segredos.json'),
        JSON.stringify({ [ALPHA]: { OK: 'v', RUIM: { a: 1 } } }),
      );
      const cofre = new Cofre(dir.path);
      assert.deepEqual(cofre.valoresDe(ALPHA), { OK: 'v' });
    } finally {
      dir.remove();
    }
  });

  // Formato antigo, de espaço de nomes único. Atribuir esses valores a um projeto
  // qualquer colocaria a senha de um banco em outro — descartar é o certo.
  test('formato antigo (chave solta no topo) é descartado', () => {
    const dir = dirTemporario();
    try {
      writeFileSync(
        join(dir.path, 'segredos.json'),
        JSON.stringify({ SENHA_ANTIGA: 'valor', [ALPHA]: { NOVA: 'v' } }),
      );
      const cofre = new Cofre(dir.path);
      assert.deepEqual(cofre.valoresDe(ALPHA), { NOVA: 'v' });
      assert.deepEqual(cofre.nomesDefinidosDe('SENHA_ANTIGA'), []);
    } finally {
      dir.remove();
    }
  });

  test('o arquivo gravado é JSON aninhado por projeto', () => {
    const dir = dirTemporario();
    try {
      new Cofre(dir.path).gravar(ALPHA, { A: '1' });
      const bruto = JSON.parse(readFileSync(join(dir.path, 'segredos.json'), 'utf8'));
      assert.deepEqual(bruto, { alpha: { A: '1' } });
    } finally {
      dir.remove();
    }
  });
});

describe('envVarsCitadas', () => {
  test('acha as variáveis independente de estarem preenchidas', () => {
    const nomes = envVarsCitadas({ a: '${UM}', b: ['${DOIS:padrao}', 42], c: { d: 'sem var' } });
    assert.deepEqual(nomes.sort(), ['DOIS', 'UM']);
  });

  test('não repete a mesma variável citada duas vezes', () => {
    assert.deepEqual(envVarsCitadas({ a: '${X}', b: '${X}' }), ['X']);
  });
});

describe('envVarDefaultsCitados', () => {
  test('captura o default de ${VAR:default}', () => {
    const defaults = envVarDefaultsCitados({ a: '${DOIS:padrao}', b: '${UM}' });
    assert.deepEqual(defaults, { DOIS: 'padrao' });
  });

  test('primeira ocorrência vence quando o mesmo nome repete com defaults diferentes', () => {
    const defaults = envVarDefaultsCitados({ a: '${X:um}', b: '${X:dois}' });
    assert.deepEqual(defaults, { X: 'um' });
  });
});

describe('parseConfig — variáveis por projeto', () => {
  // Os dois projetos usam DB_HOST de propósito: é o caso que o espaço de nomes resolve.
  const yaml = `
services:
  - id: alpha
    name: Alpha
    checks:
      - id: c1
        name: C1
        type: tcp
        host: \${DB_HOST}
        port: 1
      - id: c2
        name: C2
        type: http
        url: \${ALPHA_URL}
  - id: beta
    name: Beta
    checks:
      - id: c1
        name: C1
        type: tcp
        host: \${DB_HOST}
        port: 1
`;

  test('indexa as variáveis pelo id do projeto', () => {
    const config = parseConfig(yaml, {});
    assert.deepEqual(config.envVarsByService['alpha']?.sort(), ['ALPHA_URL', 'DB_HOST']);
    assert.deepEqual(config.envVarsByService['beta'], ['DB_HOST']);
  });

  test('indexa os defaults pelo id do projeto', () => {
    const comDefault = `
services:
  - id: gama
    name: Gama
    checks:
      - id: c1
        name: C1
        type: tcp
        host: \${DB_HOST:localhost}
        port: 1
`;
    const config = parseConfig(comDefault, {});
    assert.deepEqual(config.envVarDefaultsByService['gama'], { DB_HOST: 'localhost' });
  });

  test('cada projeto recebe o próprio valor para o mesmo nome', () => {
    const cofre = {
      valoresDe: (id: string) =>
        id === 'alpha' ? { DB_HOST: 'alpha.local' } : { DB_HOST: 'beta.local' },
    };
    const config = parseConfig(yaml, {}, cofre);

    const hostDe = (id: string) => {
      const check = config.services.find((s) => s.id === id)?.checks[0];
      return check && check.type === 'tcp' ? check.host : null;
    };

    assert.equal(hostDe('alpha'), 'alpha.local');
    assert.equal(hostDe('beta'), 'beta.local');
  });

  test('o mesmo nome pode faltar num projeto e estar resolvido no outro', () => {
    const cofre = {
      valoresDe: (id: string): Record<string, string> =>
        id === 'alpha' ? { DB_HOST: 'só-alpha' } : {},
    };
    const config = parseConfig(yaml, {}, cofre);

    assert.ok(!config.missingEnvByService['alpha']?.includes('DB_HOST'));
    assert.ok(config.missingEnvByService['beta']?.includes('DB_HOST'));
  });

  test('o cofre do projeto vence o ambiente global', () => {
    const cofre = { valoresDe: () => ({ DB_HOST: 'do-cofre' }) };
    const config = parseConfig(yaml, { DB_HOST: 'do-ambiente' }, cofre);

    const check = config.services[0]?.checks[0];
    assert.equal(check?.type === 'tcp' ? check.host : null, 'do-cofre');
  });

  test('sem cofre, o ambiente global ainda vale para todos', () => {
    const config = parseConfig(yaml, { DB_HOST: 'compartilhado', ALPHA_URL: 'http://a/' });
    assert.deepEqual(config.missingEnv, []);
  });

  test('missingEnv continua sendo a união de tudo que faltou', () => {
    const config = parseConfig(yaml, {});
    assert.deepEqual(config.missingEnv.sort(), ['ALPHA_URL', 'DB_HOST']);
  });

  // A lista serve para MONTAR o formulário, então precisa trazer também as que já têm
  // valor — senão não haveria como corrigir uma senha errada pela tela.
  test('inclui variável já preenchida', () => {
    const config = parseConfig(yaml, { DB_HOST: 'h', ALPHA_URL: 'http://a/' });
    assert.ok(config.envVarsByService['alpha']?.includes('DB_HOST'));
  });

  test('o env passado substitui process.env em vez de complementar', () => {
    process.env['ALPHA_URL'] = 'http://do-processo/';
    try {
      const config = parseConfig(yaml, {});
      assert.ok(config.missingEnv.includes('ALPHA_URL'), 'process.env não deveria vazar');
    } finally {
      delete process.env['ALPHA_URL'];
    }
  });

  test('config sem services não quebra a interpolação por partes', () => {
    const config = parseConfig('retentionHours: 48\nservices:\n  - id: a\n    name: A\n    checks:\n      - id: c\n        name: C\n        type: tcp\n        host: h\n        port: 1\n', {});
    assert.equal(config.retentionHours, 48);
  });
});
