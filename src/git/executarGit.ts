import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const executarArquivo = promisify(execFile);

const TEMPO_LIMITE_MS = 10_000;
const TAMANHO_MAXIMO_DA_SAIDA = 5 * 1024 * 1024;

/**
 * Ambiente que impede o Git de parar esperando uma resposta do usuário.
 *
 * Sem `GIT_TERMINAL_PROMPT=0` e os `ASKPASS`, um repositório com remoto HTTPS
 * sem credencial em cache trava o processo do HUB SNK num prompt que ninguém vê.
 * `GIT_OPTIONAL_LOCKS=0` evita que a leitura de status escreva no índice e
 * atrapalhe uma IDE aberta na mesma pasta.
 */
const AMBIENTE_SEM_PROMPT: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: 'echo',
  SSH_ASKPASS: 'echo',
  GIT_OPTIONAL_LOCKS: '0',
};

export class GitIndisponivelError extends Error {
  constructor() {
    super('O comando "git" não foi encontrado neste sistema.');
    this.name = 'GitIndisponivelError';
  }
}

export interface ResultadoDoGit {
  sucesso: boolean;
  saida: string;
}

/**
 * Executa um comando Git numa pasta e devolve a saída.
 *
 * O tempo limite é generoso para leituras locais e precisa ser ampliado por
 * quem fala com a rede.
 *
 * Comando que termina com erro não vira exceção: "não é um repositório" e
 * "nenhum commit ainda" são respostas legítimas do diagnóstico, e quem chama
 * decide o que fazer com elas. A única exceção é o Git não estar instalado —
 * aí nenhuma verificação é possível e o chamador precisa saber disso.
 *
 * Os argumentos são passados como lista, sem shell: nada do que vem do cadastro
 * é interpretado como comando.
 */
export async function executarGit(
  pasta: string,
  argumentos: string[],
  tempoLimiteMs = TEMPO_LIMITE_MS,
): Promise<ResultadoDoGit> {
  try {
    const { stdout } = await executarArquivo('git', argumentos, {
      cwd: pasta,
      env: AMBIENTE_SEM_PROMPT,
      timeout: tempoLimiteMs,
      maxBuffer: TAMANHO_MAXIMO_DA_SAIDA,
      windowsHide: true,
    });

    return { sucesso: true, saida: stdout };
  } catch (erro) {
    const falha = erro as NodeJS.ErrnoException & { stdout?: string; stderr?: string };

    if (falha.code === 'ENOENT') {
      throw new GitIndisponivelError();
    }

    return { sucesso: false, saida: (falha.stderr ?? falha.stdout ?? falha.message).trim() };
  }
}
