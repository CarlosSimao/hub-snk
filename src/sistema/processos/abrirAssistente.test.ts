import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { argumentosDaSessao } from '../../kanban/ia/assistentesDeIa.ts';
import { argumentosDasOpcoes, linhaDoAssistente } from './abrirAssistente.ts';

describe('argumentosDasOpcoes', () => {
  it('vazio não acrescenta nada', () => {
    assert.deepEqual(argumentosDasOpcoes('   '), []);
  });

  it('separa por espaço e junta o valor entre aspas duplas', () => {
    assert.deepEqual(
      argumentosDasOpcoes('--dangerously-skip-permissions  --append-system-prompt "seja breve"'),
      ['--dangerously-skip-permissions', '--append-system-prompt', 'seja breve'],
    );
  });

  it('; e & viram texto do argumento, citado na linha do shell', () => {
    const partes = ['claude.exe', ...argumentosDasOpcoes('--x; rm -rf ~ &')];
    assert.deepEqual(partes, ['claude.exe', '--x;', 'rm', '-rf', '~', '&']);
    assert.equal(linhaDoAssistente(partes, 'win32'), "& 'claude.exe' '--x;' 'rm' '-rf' '~' '&'");
  });
});

describe('argumentosDaSessao', () => {
  it('sem modelo nem raciocínio não passa nada: vale o padrão do assistente', () => {
    assert.deepEqual(argumentosDaSessao('claude', { modelo: '', raciocinio: '' }), []);
  });

  it('passa modelo e raciocínio com a opção de cada assistente', () => {
    assert.deepEqual(argumentosDaSessao('claude', { modelo: 'opus', raciocinio: 'high' }), [
      '--model',
      'opus',
      '--effort',
      'high',
    ]);
    assert.deepEqual(argumentosDaSessao('codex', { modelo: 'gpt-5', raciocinio: 'low' }), [
      '-m',
      'gpt-5',
      '-c',
      'model_reasoning_effort=low',
    ]);
    assert.deepEqual(argumentosDaSessao('cursor', { modelo: 'sonnet', raciocinio: '' }), [
      '--model',
      'sonnet',
    ]);
  });

  it('o OpenCode e o Gemini CLI levam só o modelo', () => {
    assert.deepEqual(argumentosDaSessao('opencode', { modelo: 'a/b', raciocinio: 'high' }), [
      '-m',
      'a/b',
    ]);
    assert.deepEqual(argumentosDaSessao('gemini', { modelo: 'pro', raciocinio: 'high' }), [
      '-m',
      'pro',
    ]);
  });
});

describe('linhaDoAssistente', () => {
  it('no Windows chama pelo & do PowerShell, com o script do shim npm depois do node', () => {
    assert.equal(
      linhaDoAssistente(
        ['C:\\Program Files\\nodejs\\node.exe', 'C:\\npm\\node_modules\\claude\\cli.js'],
        'win32',
      ),
      "& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\npm\\node_modules\\claude\\cli.js'",
    );
  });

  it('no Windows dobra a aspa simples e deixa ; e & como texto', () => {
    assert.equal(
      linhaDoAssistente(["C:\\D'Ávila; & Cia\\codex.cmd"], 'win32'),
      "& 'C:\\D''Ávila; & Cia\\codex.cmd'",
    );
  });

  it('no sh fecha e reabre a citação em volta da aspa simples', () => {
    assert.equal(
      linhaDoAssistente(["/home/ana/d'avila; & cia/claude", '--x'], 'linux'),
      "'/home/ana/d'\\''avila; & cia/claude' '--x'",
    );
  });
});
