import { spawn } from 'node:child_process';

/**
 * Lançamento de IDEs da JetBrains instaladas na máquina.
 *
 * O que muda de uma IDE para outra é a lista de launchers e os argumentos; o
 * modo de descobrir e executar é o mesmo, e mora aqui. Os argumentos vão sempre
 * separados para o `spawn`, nunca interpolados numa linha de comando: sem shell
 * no meio, um caminho com espaço, aspas ou `&&` é tratado como texto.
 */

export interface Lancamento {
  comando: string;
  argumentos: string[];
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

/**
 * Scripts `.cmd`/`.bat` não são executáveis para o `spawn`: quem os interpreta
 * é o `cmd.exe`. Ele é chamado com os argumentos separados — e não com
 * `shell: true` — para que continuem sendo argumentos e não linha de comando.
 */
function montarLancamentoDoWindows(launcher: string, argumentos: string[]): Lancamento {
  return /\.(cmd|bat)$/i.test(launcher)
    ? { comando: 'cmd.exe', argumentos: ['/c', launcher, ...argumentos] }
    : { comando: launcher, argumentos };
}

/** Mantém apenas os launchers que existem no PATH, na ordem de preferência recebida. */
export async function montarLancamentosDoWindows(
  launchers: string[],
  argumentos: string[],
): Promise<Lancamento[]> {
  const disponiveis: Lancamento[] = [];

  for (const launcher of launchers) {
    if (await existeNoWindows(launcher)) {
      disponiveis.push(montarLancamentoDoWindows(launcher, argumentos));
    }
  }

  return disponiveis;
}

/**
 * Resolve quando o processo realmente nasceu e rejeita quando o executável não
 * existe — é o evento `spawn` do Node que separa um caso do outro sem timer.
 *
 * O processo é solto (`detached` + `unref`) porque a IDE continua viva depois
 * da resposta HTTP e não deve prender o servidor.
 */
function lancar({ comando, argumentos }: Lancamento): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(comando, argumentos, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    processo.once('spawn', () => {
      processo.unref();
      resolver();
    });

    processo.once('error', rejeitar);
  });
}

/** Tenta os candidatos na ordem e informa se algum chegou a iniciar. */
export async function lancarPrimeiroDisponivel(lancamentos: Lancamento[]): Promise<boolean> {
  for (const lancamento of lancamentos) {
    try {
      await lancar(lancamento);
      return true;
    } catch {
      // Executável ausente: segue para o próximo candidato.
    }
  }

  return false;
}
