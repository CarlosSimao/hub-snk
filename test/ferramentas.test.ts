/**
 * Abrir a pasta do repositorio no terminal, no IntelliJ ou no Claude Code.
 *
 * O foco e' o que acontece ANTES de qualquer processo nascer: o caminho vem do cadastro
 * do cliente, que e' campo livre, e um pedido malformado nao pode virar `spawn`. Se a
 * ferramenta esta' instalada e abre e' outra coisa — depende da maquina, e o teste que
 * provaria isso abriria janela na cara de quem roda a suite.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  Ferramentas,
  PedidoFerramentaError,
  ehFerramenta,
} from '../src/ferramentas.ts';
import { dirTemporario } from './helpers.ts';

/**
 * Lancador de mentira. Sem ele o teste ABRE PROGRAMA de verdade: a primeira versao
 * daqui subiu um IntelliJ apontado para a pasta temporaria que o proprio teste apagou
 * em seguida.
 */
function espiao() {
  const lancados: {
    exe: string;
    args: string[];
    cwd: string;
    extraEnv?: Record<string, string> | undefined;
  }[] = [];
  const ferramentas = new Ferramentas((exe, args, cwd, extraEnv) =>
    lancados.push({ exe, args, cwd, extraEnv }),
  );
  return { ferramentas, lancados };
}

describe('Ferramentas — guardas do pedido', () => {
  const { ferramentas, lancados } = espiao();

  test('ferramenta desconhecida nao vira processo', () => {
    const dir = dirTemporario();
    try {
      // `vscode` seria um pedido plausivel — e por isso mesmo tem que ser recusado com
      // nome na mensagem, em vez de cair no `else` e abrir outra coisa.
      assert.throws(() => ferramentas.abrir('vscode', dir.path), PedidoFerramentaError);
      assert.throws(() => ferramentas.abrir('', dir.path), PedidoFerramentaError);
    } finally {
      dir.remove();
    }
  });

  test('caminho vazio ou inexistente e recusado', () => {
    assert.throws(() => ferramentas.abrir('terminal', ''), PedidoFerramentaError);
    assert.throws(() => ferramentas.abrir('terminal', '   '), PedidoFerramentaError);
    assert.throws(
      () => ferramentas.abrir('terminal', join('C:', 'nao', 'existe', 'pasta-nenhuma')),
      PedidoFerramentaError,
    );
  });

  test('arquivo nao serve — o alvo tem que ser pasta', () => {
    const dir = dirTemporario();
    try {
      const arquivo = join(dir.path, 'README.md');
      writeFileSync(arquivo, '# nao sou pasta', 'utf8');
      assert.throws(() => ferramentas.abrir('intellij', arquivo), PedidoFerramentaError);
    } finally {
      dir.remove();
    }
  });

  test('a mensagem da recusa diz qual pasta foi procurada', () => {
    const alvo = join('C:', 'repos', 'que-nao-existe');
    assert.throws(
      () => ferramentas.abrir('claude', alvo),
      (err: unknown) => err instanceof PedidoFerramentaError && err.message.includes(alvo),
    );
  });

  test('nenhum pedido recusado chega a lancar processo', () => {
    assert.deepEqual(lancados, []);
  });

  test('pasta valida lanca o programa NA pasta, com ela em argumento e nao em comando', () => {
    const { ferramentas: comEspiao, lancados: abertos } = espiao();
    const dir = dirTemporario();
    try {
      mkdirSync(join(dir.path, '.git'), { recursive: true });

      // `intellij` e `claude` podem nao estar instalados na maquina que roda a suite —
      // ai' o erro e' de disponibilidade, e nao de pedido. O `terminal` sempre resolve
      // no Windows (`cmd.exe` no pior caso), entao e' ele quem prova o lancamento.
      const resultado = comEspiao.abrir('terminal', dir.path);

      assert.match(resultado.saida, /aberto em/);
      assert.equal(abertos.length, 1);
      assert.equal(abertos[0]?.cwd, dir.path);
      // O caminho nunca e' concatenado num comando: entra como `cwd` e, no maximo, como
      // um argumento inteiro da lista.
      for (const arg of abertos[0]?.args ?? []) {
        assert.ok(arg === dir.path || !arg.includes(dir.path), `argumento montado com o caminho dentro: ${arg}`);
      }
    } finally {
      dir.remove();
    }
  });
});

describe('Ferramentas — o que e lancado no Windows', () => {
  const soNoWindows = { skip: process.platform === 'win32' ? false : 'específico do Windows' };

  test('terminal abre PowerShell, e em janela propria', soNoWindows, () => {
    const { ferramentas, lancados } = espiao();
    const dir = dirTemporario();
    try {
      ferramentas.abrir('terminal', dir.path);

      const [aberto] = lancados;
      assert.ok(aberto, 'nada foi lançado');
      // `-w new`: sem isto o `wt` entrega a pasta para a janela JA' aberta, como aba
      // atras de tudo — parece que o botao nao fez nada.
      if (/wt\.exe$/i.test(aberto.exe)) assert.deepEqual(aberto.args.slice(0, 2), ['-w', 'new']);
      assert.ok(
        aberto.args.some((arg) => /powershell\.exe$|pwsh\.exe$/i.test(arg)),
        `esperava PowerShell entre os argumentos: ${aberto.args.join(' ')}`,
      );
      assert.equal(aberto.cwd, dir.path);
    } finally {
      dir.remove();
    }
  });

  test('claude ja sobe o CLI, e sem operador de shell na linha', soNoWindows, () => {
    const { ferramentas, lancados } = espiao();
    const dir = dirTemporario();
    try {
      try {
        ferramentas.abrir('claude', dir.path);
      } catch {
        // Maquina sem o Claude Code instalado: nada a verificar aqui.
        return;
      }

      const [aberto] = lancados;
      assert.ok(aberto, 'nada foi lançado');
      assert.ok(aberto.args.includes('-NoExit'), 'a janela fecharia ao fim da sessão do Claude');

      // O caminho do executavel vai por ambiente justamente para nao haver `&` na
      // linha: com `& '<caminho>'`, a retaguarda do `cmd` recusava o comando que este
      // proprio arquivo montou.
      assert.equal(aberto.extraEnv?.['SANKHYA_HUB_CLAUDE'] !== undefined, true);
      for (const arg of aberto.args) {
        assert.ok(!/[&|<>^]/.test(arg), `argumento com operador de shell: ${arg}`);
      }
    } finally {
      dir.remove();
    }
  });
});

describe('Ferramentas — vocabulario', () => {
  test('ehFerramenta aceita as tres e recusa o resto', () => {
    assert.equal(ehFerramenta('terminal'), true);
    assert.equal(ehFerramenta('intellij'), true);
    assert.equal(ehFerramenta('claude'), true);
    assert.equal(ehFerramenta('idea'), false);
    assert.equal(ehFerramenta('CLAUDE'), false);
  });
});
