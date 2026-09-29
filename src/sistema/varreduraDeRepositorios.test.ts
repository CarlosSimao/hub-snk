import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { converterRemotoParaUrlHttp } from './varreduraDeRepositorios.ts';

describe('converterRemotoParaUrlHttp', () => {
  it('mantém a URL https como veio, sem o .git', () => {
    assert.equal(
      converterRemotoParaUrlHttp('https://github.com/org/projeto.git'),
      'https://github.com/org/projeto',
    );
  });

  it('tira usuário e token embutidos, que iriam para o cadastro e para a exportação', () => {
    assert.equal(
      converterRemotoParaUrlHttp('https://usuario:ghp_segredo@github.com/org/projeto.git'),
      'https://github.com/org/projeto',
    );
  });

  it('converte o remoto SSH curto para https', () => {
    assert.equal(
      converterRemotoParaUrlHttp('git@github.com:org/projeto.git'),
      'https://github.com/org/projeto',
    );
  });
});
