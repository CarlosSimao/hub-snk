/**
 * Cliente minimo da Docker Engine API por unix socket (Linux) ou named pipe (Windows).
 *
 * Cobre exatamente o que o hub precisa: inspecionar um container (check `docker`) e
 * start/stop/restart (acoes). Nao ha exec nem run — o hub nunca executa comando
 * arbitrario, entao montar o socket aqui expoe apenas essa superficie.
 *
 * O caminho Windows existe porque o hub deixou de rodar dentro de um container: com o
 * backend nativo (shell desktop), o Docker passa a ser apenas mais um alvo monitorado,
 * e o daemon do Docker Desktop atende em `\\.\pipe\docker_engine`.
 */
import { request as httpRequest } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';

export interface ContainerState {
  name: string;
  /** created | running | paused | restarting | removing | exited | dead */
  state: string;
  /** healthy | unhealthy | starting | none — do HEALTHCHECK da imagem, quando existe. */
  health: string;
  startedAt: string | null;
  restartCount: number;
  exitCode: number | null;
}

export class DockerUnavailableError extends Error {}

/** `\\.\pipe\algo` ou a forma com barras normais, que o Docker Desktop tambem aceita. */
function ehNamedPipe(caminho: string): boolean {
  return /^(\\\\|\/\/)[.?](\\|\/)pipe(\\|\/)/.test(caminho);
}

/**
 * `existsSync` nao enxerga named pipe: o namespace `\\.\pipe\` nao e um diretorio do
 * filesystem e o `stat` falha. Listar o namespace e a forma que funciona — e a unica
 * que distingue "Docker Desktop parado" de "Docker Desktop nao instalado", que e
 * exatamente o que o check precisa reportar.
 */
function namedPipeExiste(caminho: string): boolean {
  const nome = caminho.replace(/^(\\\\|\/\/)[.?](\\|\/)pipe(\\|\/)/, '').toLowerCase();
  if (!nome) return false;
  try {
    return readdirSync('\\\\.\\pipe\\').some((entrada) => entrada.toLowerCase() === nome);
  } catch {
    return false;
  }
}

export class DockerClient {
  readonly #socketPath: string;
  readonly #viaPipe: boolean;

  constructor(socketPath: string) {
    this.#viaPipe = ehNamedPipe(socketPath);
    // O `net.connect` do Windows so aceita a forma com contrabarra; a variavel de
    // ambiente costuma chegar com barras normais por ser mais facil de escrever em YAML.
    this.#socketPath = this.#viaPipe ? socketPath.replace(/\//g, '\\') : socketPath;
  }

  /** Socket (ou pipe) configurado e presente nesta maquina. */
  get available(): boolean {
    if (!this.#socketPath) return false;
    return this.#viaPipe ? namedPipeExiste(this.#socketPath) : existsSync(this.#socketPath);
  }

  async #call(
    method: string,
    path: string,
    timeoutMs: number,
  ): Promise<{ statusCode: number; body: string }> {
    if (!this.available) {
      throw new DockerUnavailableError(
        `socket do Docker indisponivel em "${this.#socketPath || '(nao configurado)'}"`,
      );
    }

    return new Promise((resolve, reject) => {
      const req = httpRequest(
        { socketPath: this.#socketPath, path, method, headers: { Host: 'docker' } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () =>
            resolve({ statusCode: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );

      req.setTimeout(timeoutMs, () => req.destroy(new Error(`timeout apos ${timeoutMs}ms`)));
      req.on('error', (err: NodeJS.ErrnoException) => {
        // O socket e root:root 0660; sem o gid 0 no container o erro chega como EACCES cru.
        if (err.code === 'EACCES') {
          reject(
            new DockerUnavailableError(
              this.#viaPipe
                ? 'sem permissao no pipe do Docker — o usuario precisa estar no grupo "docker-users" do Windows'
                : 'sem permissao no socket do Docker — adicione `group_add: ["0"]` ao serviço no docker-compose.yml',
            ),
          );
          return;
        }
        reject(err);
      });
      req.end();
    });
  }

  async inspect(container: string, timeoutMs = 5000): Promise<ContainerState | null> {
    const res = await this.#call('GET', `/containers/${encodeURIComponent(container)}/json`, timeoutMs);
    if (res.statusCode === 404) return null;
    if (res.statusCode >= 400) {
      throw new Error(`docker inspect ${container}: HTTP ${res.statusCode} ${res.body.slice(0, 200)}`);
    }

    const data = JSON.parse(res.body) as {
      Name?: string;
      State?: {
        Status?: string;
        StartedAt?: string;
        ExitCode?: number;
        Health?: { Status?: string };
      };
      RestartCount?: number;
    };

    return {
      name: (data.Name ?? container).replace(/^\//, ''),
      state: data.State?.Status ?? 'unknown',
      health: data.State?.Health?.Status ?? 'none',
      startedAt: data.State?.StartedAt ?? null,
      restartCount: data.RestartCount ?? 0,
      exitCode: data.State?.ExitCode ?? null,
    };
  }

  /** Whitelist fechada de operacoes — nada alem destas tres chega ao daemon. */
  async run(container: string, operation: 'start' | 'stop' | 'restart', timeoutMs = 30000): Promise<string> {
    const res = await this.#call(
      'POST',
      `/containers/${encodeURIComponent(container)}/${operation}`,
      timeoutMs,
    );

    // 204 = feito. 304 = ja estava no estado pedido (start num container rodando).
    if (res.statusCode === 204) return `${operation} enviado para "${container}"`;
    if (res.statusCode === 304) return `"${container}" ja estava no estado desejado`;
    if (res.statusCode === 404) throw new Error(`container "${container}" nao encontrado`);
    throw new Error(`docker ${operation} ${container}: HTTP ${res.statusCode} ${res.body.slice(0, 200)}`);
  }
}
