/**
 * Execucao nativa do git-autosync (Fase 3 da migracao "sem Docker").
 *
 * O foco aqui e' o ROTEAMENTO e as GUARDAS — o que acontece antes de qualquer processo
 * ser criado. Duas delas evitam estrago de verdade:
 *
 *  - acao de escrita sem `caminho` e' recusada: sem `--repo`, o CLI opera sobre o
 *    diretorio atual e commita o repositorio errado;
 *  - `set-schedule` com lista vazia e' recusado na porta: o CLI sai com erro de
 *    argumento obrigatorio, e a mensagem dele nao diz o que fazer.
 *
 * A resolucao do launcher tambem esta' coberta: e' ela que garante que o `python.exe`
 * seja chamado direto, sem `cmd.exe` no caminho (BatBadBut, CVE-2024-24576).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitAutosyncCli, GitAutosyncUsoError, resolverCli } from '../src/gitAutosyncCli.ts';
import { dirTemporario } from './helpers.ts';

/** Launcher de mentira, com o mesmo formato de duas linhas do real. */
function launcherFalso(dir: string, opcoes: { alvosExistem?: boolean } = {}): string {
  const python = join(dir, 'venv', 'Scripts', 'python.exe');
  const app = join(dir, 'python', 'app.py');

  if (opcoes.alvosExistem !== false) {
    mkdirSync(join(dir, 'venv', 'Scripts'), { recursive: true });
    mkdirSync(join(dir, 'python'), { recursive: true });
    writeFileSync(python, 'binario de mentira', 'utf8');
    writeFileSync(app, '# app', 'utf8');
  }

  const launcher = join(dir, 'git-autosync.bat');
  writeFileSync(launcher, `@echo off\r\n\r\n"${python}" "${app}" %*\r\n`, 'utf8');
  return launcher;
}

/** Instalacao standalone (PyInstaller): so' o binario, sem `.bat` e sem Python. */
function standaloneFalso(dir: string): string {
  const nome = process.platform === 'win32' ? 'git-autosync.exe' : 'git-autosync';
  writeFileSync(join(dir, nome), 'binario de mentira', 'utf8');
  return join(dir, 'git-autosync.bat');
}

describe('git-autosync — resolucao do launcher', () => {
  test('extrai o python e o app.py das duas linhas do .bat', () => {
    const dir = dirTemporario();
    try {
      const launcher = launcherFalso(dir.path);
      const resolvido = resolverCli(launcher);

      assert.ok(resolvido, 'deveria ter resolvido');
      assert.equal(resolvido.modo, 'venv');
      assert.match(resolvido.comando, /python\.exe$/);
      assert.deepEqual(
        resolvido.prefixo.map((arg) => arg.replace(/.*[\\/]/, '')),
        ['app.py'],
      );
    } finally {
      dir.remove();
    }
  });

  test('instalacao standalone resolve para o binario, sem argumento de prefixo', () => {
    const dir = dirTemporario();
    try {
      // E' o cenario que o instalador da Fase 4 cria: `git-autosync.exe` na pasta `bin`
      // e nenhum `.bat`. Antes desta correcao o hub se declarava nao instalado aqui.
      const resolvido = resolverCli(standaloneFalso(dir.path));

      assert.ok(resolvido, 'deveria ter resolvido');
      assert.equal(resolvido.modo, 'standalone');
      assert.match(resolvido.comando, /git-autosync(\.exe)?$/);
      assert.deepEqual(resolvido.prefixo, []);
    } finally {
      dir.remove();
    }
  });

  test('com os dois formatos na mesma pasta, o standalone vence', () => {
    const dir = dirTemporario();
    try {
      // Maquina que instalou com Python antes e recebeu o instalador depois: quem o
      // instalador atualiza e' o binario, entao e' ele que responde pela versao.
      launcherFalso(dir.path);
      const resolvido = resolverCli(standaloneFalso(dir.path));

      assert.ok(resolvido, 'deveria ter resolvido');
      assert.equal(resolvido.modo, 'standalone');
    } finally {
      dir.remove();
    }
  });

  test('launcher apontando para arquivo que nao existe nao resolve', () => {
    const dir = dirTemporario();
    try {
      const launcher = launcherFalso(dir.path, { alvosExistem: false });
      assert.equal(resolverCli(launcher), null);
    } finally {
      dir.remove();
    }
  });

  test('sem launcher, o CLI se declara nao instalado', () => {
    const dir = dirTemporario();
    try {
      const cli = new GitAutosyncCli(join(dir.path, 'nao-existe.bat'));
      assert.equal(cli.instalado, false);
    } finally {
      dir.remove();
    }
  });
});

describe('git-autosync — guardas antes de executar', () => {
  const cli = new GitAutosyncCli('C:\\nao\\existe\\git-autosync.bat');

  for (const acao of ['commit', 'push', 'sync', 'mr', 'include', 'exclude', 'terminal', 'repos']) {
    test(`${acao} sem caminho e recusado antes de chamar o CLI`, async () => {
      // Sem `--repo` o CLI comitaria o diretório atual — o repositório errado.
      await assert.rejects(
        () => cli.requisitar(`/git-autosync/${acao}`, { method: 'POST', body: '{}' }),
        GitAutosyncUsoError,
      );
    });
  }

  test('agendamento sem horario explica o que fazer', async () => {
    await assert.rejects(
      () =>
        cli.requisitar('/git-autosync/agendamento', {
          method: 'POST',
          body: JSON.stringify({ horarios: [] }),
        }),
      (err: Error) => {
        assert.ok(err instanceof GitAutosyncUsoError);
        assert.match(err.message, /remova a tarefa do Agendador/);
        return true;
      },
    );
  });

  test('horario fora do formato HH:MM e recusado', async () => {
    for (const horario of ['25:00', '7:30', '17:60', 'manha']) {
      await assert.rejects(
        () =>
          cli.requisitar('/git-autosync/agendamento', {
            method: 'POST',
            body: JSON.stringify({ horarios: [horario] }),
          }),
        GitAutosyncUsoError,
        `deveria recusar ${horario}`,
      );
    }
  });

  test('horario valido passa da validacao (e falha depois, sem CLI instalado)', async () => {
    await assert.rejects(
      () =>
        cli.requisitar('/git-autosync/agendamento', {
          method: 'POST',
          body: JSON.stringify({ horarios: ['07:30', '23:59'] }),
        }),
      (err: Error) => {
        // Passou da validação: o erro já é de execução, não de uso.
        assert.equal(err instanceof GitAutosyncUsoError, false);
        return true;
      },
    );
  });

  test('agente de IA invalido e recusado', async () => {
    await assert.rejects(
      () =>
        cli.requisitar('/git-autosync/ia', {
          method: 'POST',
          body: JSON.stringify({ ligada: true, agente: 'gpt-qualquer' }),
        }),
      GitAutosyncUsoError,
    );
  });

  test('rota desconhecida nao vira chamada de processo', async () => {
    await assert.rejects(
      () => cli.requisitar('/git-autosync/inventada', { method: 'POST', body: '{}' }),
      GitAutosyncUsoError,
    );
  });

  test('pasta inexistente no cadastro e recusada antes do CLI', async () => {
    await assert.rejects(
      () =>
        cli.requisitar('/git-autosync/repos', {
          method: 'POST',
          body: JSON.stringify({ caminho: 'C:\\pasta\\que\\nao\\existe' }),
        }),
      GitAutosyncUsoError,
    );
  });
});

describe('git-autosync — leitura de arquivos de estado', () => {
  test('sem config.json, devolve dados nulos em vez de estourar', async () => {
    const cli = new GitAutosyncCli('C:\\nao\\existe\\git-autosync.bat');
    const corpo = await cli.requisitar<{ dados: unknown }>('/git-autosync/config');

    // A aba Git nasce vazia, que é o certo para quem nunca configurou nada.
    assert.ok(corpo.dados === null || typeof corpo.dados === 'object');
  });
});
