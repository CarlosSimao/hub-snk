/**
 * Descoberta e guardas das skills do Claude Code.
 *
 * O que importa aqui e' o que acontece ANTES de qualquer `claude` nascer: pedido
 * malformado nao pode virar processo, e a lista precisa refletir o que a CLI realmente
 * carrega. Rodar a skill de verdade custa dinheiro e minutos — isso foi medido no spike,
 * nao em teste automatico.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PedidoSkillError, Skills, ehModelo, lerFrontmatter, listarSkills } from '../src/skills.ts';
import { dirTemporario } from './helpers.ts';

function escrever(pasta: string, linhas: string[]): string {
  const arquivo = join(pasta, 'SKILL.md');
  writeFileSync(arquivo, linhas.join('\n'), 'utf8');
  return arquivo;
}

describe('Skills — guardas antes de abrir processo', () => {
  const skills = new Skills();

  test('skill que nao existe nesta maquina e recusada', () => {
    const dir = dirTemporario();
    try {
      assert.throws(
        () => skills.iniciar({ skill: 'nao:existe', pasta: dir.path, modelo: '', esforco: '', mensagem: 'oi' }),
        PedidoSkillError,
      );
    } finally {
      dir.remove();
    }
  });

  test('pasta inexistente e recusada antes da skill rodar', () => {
    const disponivel = listarSkills()[0];
    if (!disponivel) return; // Máquina sem skill nenhuma: nada a provar.

    assert.throws(
      () => skills.iniciar({ skill: disponivel.id, pasta: join('C:', 'nao', 'existe'), modelo: '', esforco: '', mensagem: 'oi' }),
      PedidoSkillError,
    );
  });

  test('modelo fora da lista e recusado', () => {
    const disponivel = listarSkills()[0];
    const dir = dirTemporario();
    try {
      if (!disponivel) return;
      assert.throws(
        () => skills.iniciar({ skill: disponivel.id, pasta: dir.path, modelo: 'gpt-5', esforco: '', mensagem: 'oi' }),
        PedidoSkillError,
      );
    } finally {
      dir.remove();
    }
  });

  test('nivel de raciocinio fora da lista e recusado', () => {
    const disponivel = listarSkills()[0];
    const dir = dirTemporario();
    try {
      if (!disponivel) return;
      assert.throws(
        () => skills.iniciar({ skill: disponivel.id, pasta: dir.path, modelo: '', esforco: 'turbo', mensagem: 'oi' }),
        PedidoSkillError,
      );
    } finally {
      dir.remove();
    }
  });

  test('sessao desconhecida nao responde por outra', () => {
    assert.throws(() => skills.estado('nao-existe'), PedidoSkillError);
    assert.throws(() => skills.enviar('nao-existe', 'oi'), PedidoSkillError);
  });

  test('a allowlist de modelos e fechada', () => {
    assert.equal(ehModelo(''), true, 'vazio = padrão da CLI');
    assert.equal(ehModelo('opus'), true);
    assert.equal(ehModelo('sonnet'), true);
    assert.equal(ehModelo('haiku'), true);
    // O modelo vai para a linha de comando do `claude`: aceitar texto livre aqui deixaria
    // qualquer flag entrar como se fosse nome de modelo.
    assert.equal(ehModelo('--dangerously-skip-permissions'), false);
  });
});

describe('Skills — leitura do frontmatter', () => {
  test('descricao em bloco YAML nao vira a marca do bloco', () => {
    // Regressão: com `description: >` e lookahead no regex, o motor cedia o espaço,
    // casava mesmo assim, e toda skill do plugin Sankhya ficava com a descrição ">".
    const dir = dirTemporario();
    try {
      const arquivo = escrever(dir.path, [
        '---',
        'name: exemplo',
        'description: >',
        '  Primeira linha da descricao',
        '  e a continuacao dela.',
        '---',
        '',
        '# Exemplo',
      ]);

      const lido = lerFrontmatter(arquivo);
      assert.equal(lido?.name, 'exemplo');
      assert.equal(lido?.description, 'Primeira linha da descricao e a continuacao dela.');
    } finally {
      dir.remove();
    }
  });

  test('descricao numa linha so continua funcionando', () => {
    const dir = dirTemporario();
    try {
      const arquivo = escrever(dir.path, ['---', 'name: curta', 'description: Faz uma coisa so.', '---']);
      assert.equal(lerFrontmatter(arquivo)?.description, 'Faz uma coisa so.');
    } finally {
      dir.remove();
    }
  });

  test('arquivo sem frontmatter, ou ausente, nao vira skill', () => {
    const dir = dirTemporario();
    try {
      const arquivo = escrever(dir.path, ['# Sem frontmatter', '']);
      assert.equal(lerFrontmatter(arquivo), null);
      assert.equal(lerFrontmatter(join(dir.path, 'nao-existe.md')), null);
    } finally {
      dir.remove();
    }
  });

  test('lista as skills desta maquina com id de invocacao', () => {
    for (const skill of listarSkills()) {
      assert.ok(skill.id, 'toda skill precisa de id');
      assert.ok(skill.descricao !== '>', `descrição não pode ser a marca do bloco: ${skill.id}`);
      if (skill.origem === 'plugin') {
        assert.match(skill.id, /^[^:]+:.+$/, `skill de plugin é invocada como plugin:skill (${skill.id})`);
      }
    }
  });
});
