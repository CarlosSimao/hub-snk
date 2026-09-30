import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sugerirCorrecoes } from './sugestoesDeCorrecao.ts';

/* Saída real de um `sync` com o push rejeitado, como o CLI a imprime sem terminal. */
const PUSH_REJEITADO = [
  '2026-09-30 04:38:26 [C:/Demandas/larifo] AVISO: push falhou -> To https://gitlab.exemplo/larifo.git',
  ' ! [rejected]        HEAD -> desenv (non-fast-forward)',
  "error: failed to push some refs to 'https://gitlab.exemplo/larifo.git'",
  'hint: Updates were rejected because the tip of your current branch is behind',
  '[aviso] C:/Demandas/larifo: push falhou (o remoto tem commits que voce nao tem localmente). sugestao: git pull --rebase origin desenv  &&  git push origin HEAD:refs/heads/desenv',
].join('\n');

describe('sugerirCorrecoes', () => {
  it('usa o comando que o próprio autosync sugeriu, um por linha', () => {
    assert.deepEqual(sugerirCorrecoes(PUSH_REJEITADO), [
      {
        explicacao: 'O remoto tem commits que você não tem: traga-os antes de enviar.',
        comandos: ['git pull --rebase origin desenv', 'git push origin HEAD:refs/heads/desenv'],
      },
    ]);
  });

  it('tira o parêntese de "correcao recusada (sugestao: ...)"', () => {
    const [sugestao] = sugerirCorrecoes(
      'push falhou (branch local nunca foi enviada, falta configurar o upstream) | correcao recusada (sugestao: git push -u origin HEAD:refs/heads/nova)',
    );

    assert.deepEqual(sugestao?.comandos, ['git push -u origin HEAD:refs/heads/nova']);
  });

  it('sem sugestão do autosync, cai no comando genérico do push rejeitado', () => {
    const [sugestao] = sugerirCorrecoes(' ! [rejected]  main -> main (fetch first)');

    assert.deepEqual(sugestao?.comandos, ['git pull --rebase', 'git push']);
  });

  it('manda para as configurações quando falta o token do GitLab', () => {
    const [sugestao] = sugerirCorrecoes(
      "[ERRO] C:/repo: falta token do GitLab (variavel de ambiente GIT_AUTOSYNC_GITLAB_TOKEN, ou rode 'git-autosync set-gitlab-token')",
    );

    assert.equal(sugestao?.acao, 'configurar-gitlab');
    assert.deepEqual(sugestao?.comandos, []);
  });

  it('nomeia o arquivo recusado, mesmo começando com ponto', () => {
    const [sugestao] = sugerirCorrecoes('[ERRO] Arquivo sensivel/excluido no commit: .env');

    assert.match(sugestao?.explicacao ?? '', /por causa de \.env\./);
    assert.equal(sugestao?.acao, 'politica');
  });

  it('reconhece a operação em andamento e a credencial recusada', () => {
    const explicacoes = sugerirCorrecoes(
      'Operacao Git em andamento (rebase); resolva manualmente.\nfatal: Authentication failed for x',
    ).map((sugestao) => sugestao.explicacao);

    assert.equal(explicacoes.length, 2);
    assert.ok(explicacoes.some((explicacao) => /rebase em andamento/.test(explicacao)));
    assert.ok(explicacoes.some((explicacao) => /credencial/.test(explicacao)));
  });

  it('não inventa sugestão para erro desconhecido', () => {
    assert.deepEqual(sugerirCorrecoes('erro inesperado: algo quebrou'), []);
  });
});
