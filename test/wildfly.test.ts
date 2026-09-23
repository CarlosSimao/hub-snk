/**
 * Controle nativo do WildFly (Fase 3 da migracao "sem Docker"): o que substituiu o
 * `scripts/wildfly-helper.ps1`.
 *
 * O que merece teste aqui nao e' o spawn — e' a IDENTIFICACAO da instalacao. Errar nela
 * significa matar o processo errado: a maquina do autor tem `C:\wildfly_producao` e
 * `C:\wildfly_producao2` lado a lado, e o helper original ja teve esse defeito.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { casaInstalacao, comandoInicioWindows, ConfigWildflyInvalidaError, Wildfly } from '../src/wildfly.ts';
import { dirTemporario } from './helpers.ts';

const RAIZ = 'C:\\wildfly_producao';
const CMD_BASE = 'C:\\java\\bin\\java.exe -D[Standalone] -jar C:\\wildfly_producao\\jboss-modules.jar -mp';

describe('Wildfly — identificacao do processo', () => {
  test('reconhece o java desta instalacao', () => {
    assert.equal(casaInstalacao(CMD_BASE, RAIZ), true);
  });

  test('NAO confunde com a instalacao cujo nome e prefixo desta', () => {
    const outra = 'C:\\java\\bin\\java.exe -jar C:\\wildfly_producao2\\jboss-modules.jar -mp';
    assert.equal(casaInstalacao(outra, RAIZ), false);
    // E a recíproca: pedir para parar a "2" não pode pegar a primeira.
    assert.equal(casaInstalacao(CMD_BASE, 'C:\\wildfly_producao2'), false);
  });

  test('ignora outras JVMs da maquina', () => {
    const gradle = 'C:\\java\\bin\\java.exe -jar C:\\wildfly_producao\\gradle-launcher.jar';
    assert.equal(casaInstalacao(gradle, RAIZ), false);
  });

  test('aceita o caminho entre aspas e seguido de espaco', () => {
    const comAspas = 'java.exe -Djboss.home.dir="C:\\wildfly_producao" -jar jboss-modules.jar';
    const comEspaco = 'java.exe -Djboss.home.dir=C:\\wildfly_producao -jar jboss-modules.jar';
    assert.equal(casaInstalacao(comAspas, RAIZ), true);
    assert.equal(casaInstalacao(comEspaco, RAIZ), true);
  });

  test('caminho Linux tambem separa instalacao de prefixo', () => {
    // No Linux o separador e barra, e a linha vem de /proc/<pid>/cmdline com os
    // argumentos colados por espaco. Exigir contrabarra no limite deixaria
    // /opt/wildfly_producao2 passar pelo buraco que esta regra existe para fechar.
    const raiz = '/opt/wildfly_producao';
    const desta = '/usr/lib/jvm/java-17/bin/java -D[Standalone] -jar /opt/wildfly_producao/jboss-modules.jar -mp';
    const doVizinho = '/usr/lib/jvm/java-17/bin/java -jar /opt/wildfly_producao2/jboss-modules.jar -mp';

    assert.equal(casaInstalacao(desta, raiz), true);
    assert.equal(casaInstalacao(doVizinho, raiz), false);
  });

  test('caminho com espaco no nome nao vira regex quebrada', () => {
    const raiz = 'C:\\Arquivos de Programas\\wildfly (producao)';
    const cmd = `java.exe -jar ${raiz}\\jboss-modules.jar`;
    assert.equal(casaInstalacao(cmd, raiz), true);
  });
});

describe('Wildfly — escolha da instalacao', () => {
  /** Monta uma instalacao de mentira (so o que `pasta()` valida: bin/standalone.bat). */
  function comConfig(conteudo: Record<string, string>, criarInstalacao = false) {
    const dir = dirTemporario();
    const instalacao = join(dir.path, 'wildfly_teste');
    if (criarInstalacao) {
      mkdirSync(join(instalacao, 'bin'), { recursive: true });
      writeFileSync(join(instalacao, 'bin', 'standalone.bat'), '@echo off', 'utf8');
    }
    const configFile = join(dir.path, 'wildfly.json');
    writeFileSync(configFile, JSON.stringify({ ...conteudo, ...(criarInstalacao ? { pasta: instalacao } : {}) }), 'utf8');
    return { dir, instalacao, wildfly: new Wildfly(configFile, 'http://127.0.0.1:4100') };
  }

  test('a config do usuario vence quando aponta para instalacao valida', () => {
    const { dir, instalacao, wildfly } = comConfig({}, true);
    try {
      assert.equal(wildfly.pasta(), instalacao);
    } finally {
      dir.remove();
    }
  });

  test('config apontando para pasta inexistente cai no padrao em vez de quebrar', () => {
    const { dir, wildfly } = comConfig({ pasta: 'C:\nao\existe' });
    try {
      // O que importa e devolver algo utilizavel em vez de lancar.
      assert.match(wildfly.pasta(), /wildfly_producao$/);
    } finally {
      dir.remove();
    }
  });

  test('config ilegivel nao tira o WildFly do ar', () => {
    const dir = dirTemporario();
    try {
      const configFile = join(dir.path, 'wildfly.json');
      writeFileSync(configFile, '{ isto nao e json', 'utf8');
      const wildfly = new Wildfly(configFile, 'http://127.0.0.1:4100');
      assert.match(wildfly.pasta(), /wildfly_producao$/);
    } finally {
      dir.remove();
    }
  });

  test('arquivoLog explicito vence o caminho derivado da instalacao', () => {
    const { dir, wildfly } = comConfig({ arquivoLog: 'D:\logs\server.log' });
    try {
      assert.equal(wildfly.arquivoLog(), 'D:\logs\server.log');
    } finally {
      dir.remove();
    }
  });

  test('sem arquivoLog, deriva de standalone/log/server.log da instalacao', () => {
    const { dir, instalacao, wildfly } = comConfig({}, true);
    try {
      assert.equal(wildfly.arquivoLog(), join(instalacao, 'standalone', 'log', 'server.log'));
    } finally {
      dir.remove();
    }
  });
});

describe('Wildfly — tela de caminhos', () => {
  /** Instalacao de mentira: so' o que a validacao olha (`bin/standalone.bat`). */
  function instalacaoFalsa(base: string, nome = 'wildfly_teste'): string {
    const pasta = join(base, nome);
    mkdirSync(join(pasta, 'bin'), { recursive: true });
    writeFileSync(join(pasta, 'bin', 'standalone.bat'), '@echo off', 'utf8');
    return pasta;
  }

  test('grava os caminhos e mede a existencia na hora', async (t) => {
    if (process.platform !== 'win32') return t.skip('config nativa e do Windows');

    const dir = dirTemporario();
    try {
      const instalacao = instalacaoFalsa(dir.path);
      const wildfly = new Wildfly(join(dir.path, 'wildfly.json'), 'http://127.0.0.1:4100');

      const config = await wildfly.gravarConfig(instalacao, '');

      assert.equal(config.pasta, instalacao);
      assert.equal(config.pastaExiste, true);
      // Log em branco vira o caminho padrao da instalacao: poupa digitar duas vezes.
      assert.equal(config.arquivoLog, join(instalacao, 'standalone', 'log', 'server.log'));
      // O arquivo ainda nao existe — e' isso que a tela precisa poder mostrar.
      assert.equal(config.logExiste, false);
    } finally {
      dir.remove();
    }
  });

  test('recusa pasta que nao e instalacao do WildFly', async (t) => {
    if (process.platform !== 'win32') return t.skip('config nativa e do Windows');

    const dir = dirTemporario();
    try {
      const wildfly = new Wildfly(join(dir.path, 'wildfly.json'), 'http://127.0.0.1:4100');

      // Descobrir isso só quando o Iniciar falha manda procurar defeito no lugar errado.
      await assert.rejects(() => wildfly.gravarConfig(dir.path, ''), ConfigWildflyInvalidaError);
    } finally {
      dir.remove();
    }
  });

  test('config recem-criada nasce vazia, sem inventar caminho', async (t) => {
    if (process.platform !== 'win32') return t.skip('config nativa e do Windows');

    const dir = dirTemporario();
    try {
      const config = await new Wildfly(join(dir.path, 'wildfly.json'), 'http://127.0.0.1:4100').config();

      assert.equal(config.pasta, '');
      assert.equal(config.arquivoLog, '');
      assert.equal(config.pastaExiste, false);
    } finally {
      dir.remove();
    }
  });

  test('gravar caminho vazio limpa a config em vez de recusar', async (t) => {
    if (process.platform !== 'win32') return t.skip('config nativa e do Windows');

    const dir = dirTemporario();
    try {
      const wildfly = new Wildfly(join(dir.path, 'wildfly.json'), 'http://127.0.0.1:4100');
      await wildfly.gravarConfig(instalacaoFalsa(dir.path), '');

      const limpa = await wildfly.gravarConfig('', '');

      assert.equal(limpa.pasta, '');
      assert.equal(limpa.arquivoLog, '');
    } finally {
      dir.remove();
    }
  });

  test('detectar nao quebra em raiz sem permissao e nao repete instalacao', async (t) => {
    if (process.platform !== 'win32') return t.skip('deteccao e do Windows');

    // Varre as raízes reais da máquina: o que importa é não estourar e não duplicar.
    const dir = dirTemporario();
    try {
      const achados = await new Wildfly(join(dir.path, 'wildfly.json'), 'http://127.0.0.1:4100').detectar();
      const caminhos = achados.map((a) => a.pasta.toLowerCase());

      assert.equal(new Set(caminhos).size, caminhos.length, 'nenhuma instalação repetida');
      for (const achado of achados) {
        assert.ok(existsSync(join(achado.pasta, 'bin', 'standalone.bat')));
      }
    } finally {
      dir.remove();
    }
  });
});

describe('Wildfly — disparo no Windows', () => {
  // Espaço e apóstrofo de propósito: são os caracteres que quebrariam o comando.
  const BIN = "C:\\Program Files\\wild'fly\\bin";
  const BAT = `${BIN}\\standalone.bat`;

  test('oculto vai pelo PowerShell com os caminhos em variavel de ambiente, nunca no comando', () => {
    const { comando, args, opcoes } = comandoInicioWindows(BIN, BAT, false);
    assert.equal(comando, 'powershell.exe');
    const script = args[args.length - 1]!;
    assert.match(script, /-WindowStyle Hidden/);
    // Apostrofo e espaco na pasta nao podem chegar ao comando: iriam quebrar o PowerShell.
    assert.doesNotMatch(script, /wild'fly/);
    assert.equal(opcoes.env?.['HUB_WF_BAT'], BAT);
    assert.equal(opcoes.env?.['HUB_WF_BIN'], BIN);
    assert.equal(opcoes.env?.['NOPAUSE'], 'true');
    assert.equal(opcoes.windowsHide, true);
    // detached trava o echo|findstr do standalone.bat — medido.
    assert.notEqual(opcoes.detached, true);
  });

  test('com console usa start, com aspas literais e sem detached', () => {
    const { comando, args, opcoes } = comandoInicioWindows(BIN, BAT, true);
    assert.equal(comando, 'cmd.exe');
    assert.match(args[1]!, /^start "WildFly" \/d "/);
    assert.equal(opcoes.windowsVerbatimArguments, true);
    assert.notEqual(opcoes.detached, true);
  });

  test('gravar so a pasta mantem a escolha do console; mandar o booleano troca', async (t) => {
    if (process.platform !== 'win32') return t.skip('config nativa e do Windows');
    const dir = dirTemporario();
    try {
      const pasta = join(dir.path, 'wf');
      mkdirSync(join(pasta, 'bin'), { recursive: true });
      writeFileSync(join(pasta, 'bin', 'standalone.bat'), '@echo off', 'utf8');
      const wildfly = new Wildfly(join(dir.path, 'wildfly.json'), 'http://127.0.0.1:4100');

      assert.equal((await wildfly.gravarConfig(pasta, '')).mostrarConsole, false);
      assert.equal((await wildfly.gravarConfig(pasta, '', true)).mostrarConsole, true);
      assert.equal((await wildfly.gravarConfig(pasta, '')).mostrarConsole, true);
      assert.equal((await wildfly.gravarConfig(pasta, '', false)).mostrarConsole, false);
    } finally {
      dir.remove();
    }
  });
});
