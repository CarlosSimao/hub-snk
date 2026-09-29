import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  argumentosDoCmdParaScript,
  ArgumentoInseguroParaOCmdError,
} from './linhaDeComandoDoCmd.ts';

describe('argumentosDoCmdParaScript', () => {
  it('cita o script e o argumento com espaço, dentro das aspas externas do /s', () => {
    assert.deepEqual(argumentosDoCmdParaScript('C:\\Programas\\code.cmd', ['C:\\A pasta']), [
      '/d',
      '/s',
      '/c',
      '""C:\\Programas\\code.cmd" "C:\\A pasta""',
    ]);
  });

  it('deixa sem aspas o token simples, que o .bat compara cru', () => {
    const [, , , linha] = argumentosDoCmdParaScript('C:\\wf\\jboss-cli.bat', [
      '--connect',
      '--command=:shutdown',
    ]);
    assert.equal(linha, '""C:\\wf\\jboss-cli.bat" --connect --command=:shutdown"');
  });

  it('recusa % e aspas, que o cmd.exe não trata como texto', () => {
    assert.throws(
      () => argumentosDoCmdParaScript('C:\\x.cmd', ['C:\\%PATH%']),
      ArgumentoInseguroParaOCmdError,
    );
    assert.throws(
      () => argumentosDoCmdParaScript('C:\\x".cmd', []),
      ArgumentoInseguroParaOCmdError,
    );
  });
});

describe(
  'argumentosDoCmdParaScript no cmd.exe de verdade',
  { skip: process.platform !== 'win32' },
  () => {
    let diretorio: string;

    beforeEach(async () => {
      diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-cmd-'));
    });

    afterEach(async () => {
      await rm(diretorio, { recursive: true, force: true });
    });

    it('entrega ao .cmd numa pasta com espaço o caminho com & e espaço, sem rodar o que vem depois do &', async () => {
      // Só ASCII: o cmd.exe lê o .bat na página de código do console, não em UTF-8.
      const pastaDoScript = join(diretorio, 'pasta com espaco');
      const pastaAlvo = join(diretorio, 'P&D echo invadido', 'projeto x');
      await mkdir(pastaDoScript, { recursive: true });
      const saida = join(diretorio, 'recebido.txt');
      const script = join(pastaDoScript, 'ide falsa.cmd');
      // `%1` com as aspas: o próprio .bat de teste também não pode expandir o `&` cru.
      await writeFile(script, `@echo off\r\n>"${saida}" echo(%1\r\n`);

      const resultado = spawnSync('cmd.exe', argumentosDoCmdParaScript(script, [pastaAlvo]), {
        windowsVerbatimArguments: true,
        windowsHide: true,
      });

      assert.equal(resultado.status, 0, String(resultado.stderr));
      assert.equal((await readFile(saida, 'utf8')).trim(), `"${pastaAlvo}"`);
    });
  },
);
