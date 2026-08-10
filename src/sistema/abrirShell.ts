import { spawn } from 'node:child_process';
import { garantirQueEhPasta } from './pasta.ts';

/**
 * Abertura do terminal do sistema já posicionado numa pasta, opcionalmente
 * executando um script.
 *
 * Diferente de `abrirPastaNoSistema`, aqui o script **é** interpretado pelo
 * shell — é essa a função do recurso. O texto vem da configuração que o próprio
 * usuário digitou e roda com os privilégios dele, na máquina dele.
 */

export class TerminalIndisponivelError extends Error {
  constructor() {
    super('Nenhum terminal compatível foi encontrado neste sistema.');
    this.name = 'TerminalIndisponivelError';
  }
}

interface Lancamento {
  comando: string;
  argumentos: string[];
  pastaDeTrabalho?: string;
}

/** Mantém o terminal aberto depois que o script termina, para ler a saída. */
function manterShellAberto(script: string): string {
  return `${script}; exec "$SHELL"`;
}

function escaparParaAppleScript(valor: string): string {
  return valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * `where.exe` responde se um executável está no PATH sem executá-lo — evita
 * abrir uma janela só para descobrir que o programa existe.
 */
function existeNoWindows(executavel: string): Promise<boolean> {
  return new Promise((resolver) => {
    const processo = spawn('where.exe', [executavel], { stdio: 'ignore', windowsHide: true });
    processo.once('error', () => resolver(false));
    processo.once('close', (codigo) => resolver(codigo === 0));
  });
}

async function montarLancamentoDoWindows(pasta: string, script: string): Promise<Lancamento> {
  const shells: Lancamento[] = [
    { comando: 'pwsh.exe', argumentos: script ? ['-NoExit', '-Command', script] : ['-NoExit'] },
    {
      comando: 'powershell.exe',
      argumentos: script ? ['-NoExit', '-Command', script] : ['-NoExit'],
    },
    { comando: 'cmd.exe', argumentos: script ? ['/K', script] : [] },
  ];

  // O `cmd.exe` é o último da lista e existe em qualquer Windows.
  let shellEscolhido = shells[shells.length - 1] as Lancamento;
  for (const shell of shells) {
    if (await existeNoWindows(shell.comando)) {
      shellEscolhido = shell;
      break;
    }
  }

  // O Windows Terminal dá a janela com abas; sem ele, o shell abre no console clássico.
  if (await existeNoWindows('wt.exe')) {
    return {
      comando: 'wt.exe',
      argumentos: ['-d', pasta, shellEscolhido.comando, ...shellEscolhido.argumentos],
    };
  }

  return { ...shellEscolhido, pastaDeTrabalho: pasta };
}

function montarLancamentosDoMac(pasta: string, script: string): Lancamento[] {
  const abrirTerminalNaPasta: Lancamento = {
    comando: 'open',
    argumentos: ['-a', 'Terminal', pasta],
  };

  if (!script) {
    return [abrirTerminalNaPasta];
  }

  const comandoDoShell = `cd "${pasta}" && ${script}`;
  const programa = `tell application "Terminal" to do script "${escaparParaAppleScript(comandoDoShell)}"`;

  return [{ comando: 'osascript', argumentos: ['-e', programa] }, abrirTerminalNaPasta];
}

/**
 * O Linux não tem terminal padrão: a lista vai do despachante do Debian aos
 * emuladores mais comuns, e o primeiro que existir é usado.
 */
function montarLancamentosDoLinux(pasta: string, script: string): Lancamento[] {
  const comandoDoShell = script ? manterShellAberto(script) : '';
  const executarNoBash = script ? ['bash', '-c', comandoDoShell] : [];

  return [
    {
      comando: 'x-terminal-emulator',
      argumentos: [`--working-directory=${pasta}`, ...(script ? ['-e', ...executarNoBash] : [])],
    },
    {
      comando: 'gnome-terminal',
      argumentos: [`--working-directory=${pasta}`, ...(script ? ['--', ...executarNoBash] : [])],
    },
    {
      comando: 'konsole',
      argumentos: ['--workdir', pasta, ...(script ? ['-e', ...executarNoBash] : [])],
    },
    {
      comando: 'xfce4-terminal',
      argumentos: [`--working-directory=${pasta}`, ...(script ? ['-x', ...executarNoBash] : [])],
    },
    {
      comando: 'xterm',
      argumentos: script ? ['-e', ...executarNoBash] : [],
      pastaDeTrabalho: pasta,
    },
  ];
}

/**
 * Resolve quando o processo realmente nasceu e rejeita quando o executável não
 * existe — é o evento `spawn` do Node que separa um caso do outro sem timer.
 */
function lancar({ comando, argumentos, pastaDeTrabalho }: Lancamento): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(comando, argumentos, {
      cwd: pastaDeTrabalho,
      detached: true,
      stdio: 'ignore',
    });

    processo.once('spawn', () => {
      processo.unref();
      resolver();
    });

    processo.once('error', rejeitar);
  });
}

export async function abrirShellNaPasta(pasta: string, script: string): Promise<void> {
  await garantirQueEhPasta(pasta);

  const lancamentos =
    process.platform === 'win32'
      ? [await montarLancamentoDoWindows(pasta, script)]
      : process.platform === 'darwin'
        ? montarLancamentosDoMac(pasta, script)
        : montarLancamentosDoLinux(pasta, script);

  for (const lancamento of lancamentos) {
    try {
      await lancar(lancamento);
      return;
    } catch {
      // Executável ausente: segue para o próximo candidato.
    }
  }

  throw new TerminalIndisponivelError();
}
