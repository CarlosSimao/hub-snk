/**
 * Recifragem dos segredos gravados pelo `hub-helper.ps1` (Fase 3 da migracao "sem
 * Docker").
 *
 * O risco coberto aqui e' de SQL: nome de tabela ou coluna errado nao levanta erro
 * nenhum — a migracao simplesmente nao acha nada e o helper continua sendo necessario
 * para sempre, em silencio. Os nomes usados aqui sao os mesmos conferidos no
 * `sankhya.db` real: `cliente_bases.senha_cifrada`, `cliente_bases.banco_senha_cifrada`
 * e `email_config.smtp_senha_cifrada`.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { Cifra, PREFIXO_SHELL } from '../src/sankhya/cifra.ts';
import { migrarSegredosParaShell } from '../src/sankhya/migracaoSegredos.ts';
import { DesktopBridgeIndisponivelError, type DesktopBridge } from '../src/sankhya/desktopBridge.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';
import { dirTemporario } from './helpers.ts';

function cifraFalsa(opcoes: { helperQuebrado?: boolean; semShell?: boolean } = {}) {
  const helper = {
    async requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
      if (opcoes.helperQuebrado) throw new Error('não consegui decriptar');
      const { valor } = JSON.parse(String(init.body ?? '{}')) as { valor: string };
      return { valor: caminho.endsWith('/encrypt') ? `ps:${valor}` : valor.replace(/^ps:/, '') } as T;
    },
  } as unknown as HubHelper;

  const bridge = {
    cifrarSegredo: <T,>(valor: string) => Promise.resolve({ valor: `${PREFIXO_SHELL}${valor}` } as T),
    decifrarSegredo: <T,>(valor: string) =>
      Promise.resolve({ valor: valor.replace(new RegExp(`^${PREFIXO_SHELL}`), '') } as T),
  } as unknown as DesktopBridge;

  return new Cifra(helper, opcoes.semShell ? undefined : bridge);
}

/** Banco com as MESMAS tabelas e colunas do `sankhya.db` de producao. */
function bancoCom(linhas: { bases?: [string, string][]; email?: string }) {
  const dir = dirTemporario();
  const db = new DatabaseSync(join(dir.path, 'sankhya.db'));
  db.exec(`
    CREATE TABLE cliente_bases (
      id INTEGER PRIMARY KEY,
      senha_cifrada TEXT,
      banco_senha_cifrada TEXT
    );
    CREATE TABLE email_config (id INTEGER PRIMARY KEY, smtp_senha_cifrada TEXT);
  `);

  for (const [senha, bancoSenha] of linhas.bases ?? []) {
    db.prepare('INSERT INTO cliente_bases (senha_cifrada, banco_senha_cifrada) VALUES (?, ?)').run(
      senha,
      bancoSenha,
    );
  }
  if (linhas.email !== undefined) {
    db.prepare('INSERT INTO email_config (id, smtp_senha_cifrada) VALUES (1, ?)').run(linhas.email);
  }
  db.close();
  return dir;
}

function lerColuna(dataDir: string, tabela: string, coluna: string): string[] {
  const db = new DatabaseSync(join(dataDir, 'sankhya.db'), { readOnly: true });
  const linhas = db.prepare(`SELECT ${coluna} AS v FROM ${tabela}`).all() as { v: string | null }[];
  db.close();
  return linhas.map((l) => l.v ?? '');
}

describe('migracao de segredos para o shell', () => {
  test('recifra as tres colunas e conta o que migrou', async () => {
    const dir = bancoCom({ bases: [['ps:senha-base', 'ps:senha-banco']], email: 'ps:senha-gmail' });
    try {
      const resultado = await migrarSegredosParaShell(dir.path, cifraFalsa());

      assert.deepEqual(resultado, { migrados: 3, pendentes: 0 });
      assert.deepEqual(lerColuna(dir.path, 'cliente_bases', 'senha_cifrada'), [`${PREFIXO_SHELL}senha-base`]);
      assert.deepEqual(lerColuna(dir.path, 'cliente_bases', 'banco_senha_cifrada'), [
        `${PREFIXO_SHELL}senha-banco`,
      ]);
      assert.deepEqual(lerColuna(dir.path, 'email_config', 'smtp_senha_cifrada'), [
        `${PREFIXO_SHELL}senha-gmail`,
      ]);
    } finally {
      dir.remove();
    }
  });

  test('e idempotente — a segunda passada nao mexe em nada', async () => {
    const dir = bancoCom({ bases: [['ps:senha-base', '']], email: 'ps:senha-gmail' });
    try {
      await migrarSegredosParaShell(dir.path, cifraFalsa());
      const segunda = await migrarSegredosParaShell(dir.path, cifraFalsa());

      assert.deepEqual(segunda, { migrados: 0, pendentes: 0 });
    } finally {
      dir.remove();
    }
  });

  test('blob que o helper nao abre fica como esta e conta como pendente', async () => {
    const dir = bancoCom({ bases: [['ps:ilegivel', '']] });
    try {
      const resultado = await migrarSegredosParaShell(dir.path, cifraFalsa({ helperQuebrado: true }));

      assert.equal(resultado.migrados, 0);
      assert.equal(resultado.pendentes, 1);
      // O que importa: a senha continua lá, intacta.
      assert.deepEqual(lerColuna(dir.path, 'cliente_bases', 'senha_cifrada'), ['ps:ilegivel']);
    } finally {
      dir.remove();
    }
  });

  test('sem shell no ar nao migra e nao estraga nada', async () => {
    const dir = bancoCom({ bases: [['ps:senha-base', '']] });
    try {
      const resultado = await migrarSegredosParaShell(dir.path, cifraFalsa({ semShell: true }));

      assert.equal(resultado.migrados, 0);
      assert.deepEqual(lerColuna(dir.path, 'cliente_bases', 'senha_cifrada'), ['ps:senha-base']);
    } finally {
      dir.remove();
    }
  });

  test('banco novo, sem as tabelas ainda, nao quebra o boot', async () => {
    const dir = dirTemporario();
    try {
      const resultado = await migrarSegredosParaShell(dir.path, cifraFalsa());
      assert.deepEqual(resultado, { migrados: 0, pendentes: 0 });
    } finally {
      dir.remove();
    }
  });
});
