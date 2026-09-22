import { spawn } from 'node:child_process';

/**
 * Lançamento de programa do sistema com conferência de que ele realmente subiu.
 *
 * Disparar e seguir em frente não serve aqui: o HUB SNK responde a requisição
 * logo depois, e um `spawn` que falha só apareceria no terminal — a tela diria
 * que abriu. Nascer também não é prova de sucesso: `x-terminal-emulator`
 * apontando para o `xterm` aceita o `spawn` e morre no argumento seguinte, e
 * quem tenta candidatos em ordem pararia no primeiro que "funcionou".
 *
 * Por isso a espera curta: o programa que continua vivo depois dela subiu
 * (terminal, IDE, navegador), e o que morreu com código diferente de zero
 * falhou. O despachante que entrega o caminho a outro programa e sai — o
 * `xdg-open`, o `open` — resolve antes da janela terminar, com código zero.
 */

/**
 * Tempo que o processo precisa sobreviver para ser dado como iniciado. Curto o
 * bastante para não travar a resposta HTTP, longo o bastante para um
 * executável recusar o argumento e morrer.
 */
const JANELA_DE_CONFERENCIA_MS = 400;

/**
 * O `explorer.exe` termina com código 1 mesmo quando abre a pasta, e não há
 * como distinguir isso de uma falha real. Para ele, ter nascido é tudo o que dá
 * para conferir.
 */
const COMANDOS_SEM_CODIGO_DE_SAIDA_CONFIAVEL = new Set(['explorer.exe']);

export class LancamentoFalhouError extends Error {
  readonly comando: string;
  /** Motivo cru, para o erro de domínio de quem chamou montar a própria frase. */
  readonly motivo: string;

  constructor(comando: string, motivo: string) {
    super(`Falha ao executar "${comando}": ${motivo}`);
    this.name = 'LancamentoFalhouError';
    this.comando = comando;
    this.motivo = motivo;
  }
}

export interface OpcoesDeLancamento {
  pastaDeTrabalho?: string;
  /** Evita o console preto piscando no Windows em programas de linha de comando. */
  ocultarJanelaNoWindows?: boolean;
}

/**
 * Inicia o programa e resolve quando ele deu sinal de ter subido; rejeita com
 * `LancamentoFalhouError` quando o executável não existe ou quando ele morre
 * com erro logo de saída.
 *
 * Os argumentos vão separados para o `spawn`, nunca interpolados numa linha de
 * comando: sem shell no meio, um caminho com espaço, aspas ou `&&` é tratado
 * como texto.
 *
 * O processo é solto (`detached` + `unref`) porque o programa continua vivo
 * depois da resposta HTTP e não deve prender o servidor.
 */
export function lancarProcesso(
  comando: string,
  argumentos: string[],
  opcoes: OpcoesDeLancamento = {},
): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(comando, argumentos, {
      cwd: opcoes.pastaDeTrabalho,
      detached: true,
      stdio: 'ignore',
      windowsHide: opcoes.ocultarJanelaNoWindows,
    });

    let decidido = false;
    const decidir = (concluir: () => void): void => {
      if (decidido) {
        return;
      }
      decidido = true;
      clearTimeout(temporizador);
      concluir();
    };

    /* Sobreviveu à janela: subiu. O temporizador segura o laço de eventos até lá. */
    const temporizador = setTimeout(() => decidir(resolver), JANELA_DE_CONFERENCIA_MS);

    processo.once('spawn', () => processo.unref());

    processo.once('error', (erro) => {
      decidir(() => rejeitar(new LancamentoFalhouError(comando, erro.message)));
    });

    processo.once('close', (codigo) => {
      const terminouBem = codigo === 0 || COMANDOS_SEM_CODIGO_DE_SAIDA_CONFIAVEL.has(comando);

      decidir(() =>
        terminouBem
          ? resolver()
          : rejeitar(new LancamentoFalhouError(comando, `terminou com código ${codigo}`)),
      );
    });
  });
}

export interface Candidato {
  comando: string;
  argumentos: string[];
  pastaDeTrabalho?: string;
}

/**
 * Tenta os candidatos na ordem e informa se algum chegou a subir.
 *
 * O candidato que existe mas recusa os argumentos não interrompe a fila — é
 * exatamente o caso do `x-terminal-emulator` apontando para um emulador que não
 * conhece `--working-directory`.
 */
export async function lancarPrimeiroQueSubir(
  candidatos: Candidato[],
  opcoes: OpcoesDeLancamento = {},
): Promise<boolean> {
  for (const candidato of candidatos) {
    try {
      await lancarProcesso(candidato.comando, candidato.argumentos, {
        ...opcoes,
        pastaDeTrabalho: candidato.pastaDeTrabalho ?? opcoes.pastaDeTrabalho,
      });
      return true;
    } catch {
      // Executável ausente ou recusado: segue para o próximo candidato.
    }
  }

  return false;
}
