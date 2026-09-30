import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { GitAutosyncNaoInstaladoError, PacoteDoAutosyncAusenteError } from './cliDoAutosync.ts';
import { CliDoAutosyncProcesso, resolverCli } from './cliDoAutosyncProcesso.ts';

const pastas: string[] = [];
after(() => {
  for (const pasta of pastas) rmSync(pasta, { recursive: true, force: true });
});

function criarPasta(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-autosync-'));
  pastas.push(pasta);
  return pasta;
}

describe('resolverCli', () => {
  const bin = join('C:', 'x', 'bin');

  it('prefere o executável standalone', () => {
    const existentes = new Set([join(bin, 'git-autosync.exe'), join(bin, 'git-autosync.bat')]);
    const cli = resolverCli(
      bin,
      'win32',
      (c) => existentes.has(c),
      () => '',
    );

    assert.deepEqual(cli, {
      comando: join(bin, 'git-autosync.exe'),
      prefixo: [],
      modo: 'standalone',
    });
  });

  it('usa o python do venv quando só há o launcher, com aspas e espaços', () => {
    const python = 'C:\\Program Files\\venv\\Scripts\\python.exe';
    const app = 'C:\\Meus Projetos\\git-autosync\\python\\app.py';
    const existentes = new Set([join(bin, 'git-autosync.bat'), python, app]);
    const cli = resolverCli(
      bin,
      'win32',
      (c) => existentes.has(c),
      () => `@echo off\r\n  "${python}" "${app}" %*\r\n`,
    );

    assert.deepEqual(cli, { comando: python, prefixo: [app], modo: 'venv' });
  });

  it('devolve null sem nenhum dos dois', () => {
    assert.equal(
      resolverCli(
        bin,
        'win32',
        () => false,
        () => null,
      ),
      null,
    );
  });

  it('devolve null quando o launcher aponta para um python que não existe', () => {
    const existentes = new Set([join(bin, 'git-autosync.bat')]);
    const cli = resolverCli(
      bin,
      'win32',
      (c) => existentes.has(c),
      () => '"C:\\sumiu\\python.exe" "C:\\sumiu\\app.py" %*',
    );

    assert.equal(cli, null);
  });

  it('procura o binário sem extensão fora do Windows', () => {
    const existentes = new Set([join(bin, 'git-autosync')]);
    const cli = resolverCli(
      bin,
      'linux',
      (c) => existentes.has(c),
      () => null,
    );

    assert.equal(cli?.modo, 'standalone');
  });
});

/*
 * Um "python" de mentira: o próprio Node rodando um script com extensão `.py`, que
 * devolve os argumentos recebidos. Prova que o caminho chega ao processo como um
 * argumento só, literal, sem passar por shell nenhum.
 */
function instalarCliDeMentira(pasta: string): void {
  const bin = join(pasta, 'bin');
  mkdirSync(bin, { recursive: true });
  const script = join(pasta, 'app.py');
  writeFileSync(
    script,
    'console.log(JSON.stringify({ argumentos: process.argv.slice(2), home: process.env.GIT_AUTOSYNC_HOME }));',
  );
  writeFileSync(
    join(bin, 'git-autosync.bat'),
    `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`,
  );
}

describe('CliDoAutosyncProcesso', () => {
  // O CLI de mentira é um `.cmd`, e o que se prova é o escape do cmd.exe: só no Windows.
  it(
    'passa caminho com & | ^ % e espaços como um argumento literal',
    { skip: process.platform !== 'win32' },
    async () => {
      const pasta = criarPasta();
      instalarCliDeMentira(pasta);
      const cli = new CliDoAutosyncProcesso({ pasta, pacote: null, plataforma: process.platform });
      const perigoso = 'C:\\Clientes\\a & b | c ^ d %PATH% "e"';

      const { codigo, saida } = await cli.executar(['add', perigoso, '--type', 'repo']);

      assert.equal(codigo, 0);
      const dados = JSON.parse(saida) as { argumentos: string[]; home: string };
      assert.deepEqual(dados.argumentos, ['add', perigoso, '--type', 'repo']);
      assert.equal(dados.home, pasta);
    },
  );

  it('não usa shell em nenhum spawn', () => {
    const fonte = readFileSync(new URL('./cliDoAutosyncProcesso.ts', import.meta.url), 'utf8');

    assert.doesNotMatch(fonte, /shell:\s*true/);
  });

  it('avisa que não está instalado quando não há CLI', async () => {
    const cli = new CliDoAutosyncProcesso({ pasta: criarPasta(), pacote: null });

    assert.equal(cli.instalado(), false);
    await assert.rejects(cli.executar(['status']), GitAutosyncNaoInstaladoError);
  });

  it('lê config, status, versão e log, e devolve vazio quando ainda não existem', async () => {
    const vazia = new CliDoAutosyncProcesso({ pasta: criarPasta(), pacote: null });
    assert.equal(await vazia.lerConfiguracao(), null);
    assert.equal(await vazia.lerStatus(), null);
    assert.equal(await vazia.versao(), null);
    assert.deepEqual(await vazia.lerLog(10), []);

    const pasta = criarPasta();
    mkdirSync(join(pasta, 'bin'));
    writeFileSync(join(pasta, 'bin', 'VERSION'), '4.0.0\n');
    writeFileSync(join(pasta, 'config.json'), '\uFEFF{"schedules":["17:30"]}');
    writeFileSync(join(pasta, 'autosync.log'), 'um\ndois\ntrês\n');
    const cli = new CliDoAutosyncProcesso({ pasta, pacote: null });

    assert.equal(await cli.versao(), '4.0.0');
    assert.deepEqual(await cli.lerConfiguracao(), { schedules: ['17:30'] });
    assert.deepEqual(await cli.lerLog(2), ['dois', 'três']);
  });

  it('recusa instalar quando o build não tem o pacote', async () => {
    const cli = new CliDoAutosyncProcesso({
      pasta: criarPasta(),
      pacote: null,
      plataforma: 'win32',
    });

    await assert.rejects(cli.instalarPacote({}), PacoteDoAutosyncAusenteError);
  });
});
