import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { RepositorioConfiguracaoArquivo } from '../../repositorio/arquivo/repositorioConfiguracaoArquivo.ts';
import { modelosDoOpencode, modelosUsadosNoClaude } from './assistentesDeIa.ts';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-assistentes-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

describe('modelosDoOpencode', () => {
  it('lê os nomes e as variantes de raciocínio do --verbose', () => {
    const saida = [
      'opencode/big-pickle',
      '{',
      '"id": "big-pickle",',
      '"variants": {}',
      '}',
      'google/gemini-2.5-pro',
      '{',
      '"variants": { "high": {}, "max": {} }',
      '}',
    ];

    const resultado = modelosDoOpencode(saida);

    assert.deepEqual(resultado.modelos, ['opencode/big-pickle', 'google/gemini-2.5-pro']);
    assert.deepEqual(resultado.raciocinio, {
      'google/gemini-2.5-pro': { niveis: ['high', 'max'], padrao: '' },
    });
  });

  it('sem o JSON (versão antiga do OpenCode), fica só com os nomes', () => {
    const resultado = modelosDoOpencode(['anthropic/claude-sonnet-5-5', 'openai/gpt-6']);
    assert.deepEqual(resultado.modelos, ['anthropic/claude-sonnet-5-5', 'openai/gpt-6']);
    assert.deepEqual(resultado.raciocinio, {});
  });
});

describe('modelosUsadosNoClaude', () => {
  it('acha os modelos registrados no uso por projeto, mais novos primeiro', () => {
    const conteudo = JSON.stringify({
      projects: {
        'C:/a': { lastModelUsage: { 'claude-opus-4-8': {}, 'claude-sonnet-5': {} } },
        'C:/b': { lastModelUsage: { 'claude-opus-5-5': {} } },
      },
      outroCampo: 'não é modelo',
    });

    assert.deepEqual(modelosUsadosNoClaude(conteudo), [
      'claude-sonnet-5',
      'claude-opus-5-5',
      'claude-opus-4-8',
    ]);
    assert.deepEqual(modelosUsadosNoClaude('arquivo quebrado'), []);
  });
});

describe('configuração do assistente', () => {
  it('grava o nível de raciocínio e preserva quando a tela não manda o assistente', async () => {
    const repositorio = new RepositorioConfiguracaoArquivo(mkdtempSync(join(pasta, 'dados-')));
    const inicial = await repositorio.ler();
    assert.deepEqual(inicial.assistenteDeIa, { assistente: 'auto', modelo: '', raciocinio: '' });

    const { assistenteDeIa: _, ...semAssistente } = inicial;
    await repositorio.salvar({
      ...semAssistente,
      assistenteDeIa: { assistente: 'codex', modelo: 'gpt-5.5', raciocinio: 'high' },
    });
    const salva = await repositorio.salvar(semAssistente);

    assert.deepEqual(salva.assistenteDeIa, {
      assistente: 'codex',
      modelo: 'gpt-5.5',
      raciocinio: 'high',
    });
  });
});
