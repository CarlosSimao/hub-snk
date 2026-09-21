/**
 * Transporte do container para o `scripts/hub-helper.ps1` (Windows, porta 4102).
 *
 * Existe porque duas coisas de que o hub precisa nao rodam dentro do container Linux:
 * DPAPI (criptografia das credenciais do Sankhya) e o `git-autosync.exe`. O helper
 * roda nativamente no Windows e o container o alcanca por `host.docker.internal`.
 *
 * Toda rota do helper exige o header `X-Hub-Token`. O token e gerado pelo helper em
 * `%APPDATA%\sankhya-hub\ipc\token.txt` e chega aqui por bind mount read-only — sem
 * isso, `GET /credentials/:sistema/reveal` entregaria a senha do Sankhya para qualquer
 * aparelho da rede local que alcancasse a porta.
 */
import { readFileSync } from 'node:fs';

/** O helper nao esta no ar, ou o token nao chegou ao container. */
export class HelperIndisponivelError extends Error {}

/** O helper respondeu, mas com erro de negocio (sistema desconhecido, corpo invalido). */
export class HelperError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Serve para tudo que é consulta rápida de estado ou gravação de credencial. */
const TIMEOUT_PADRAO_MS = 10_000;

/** Opções do hub, separadas das do `fetch`, para o timeout não virar header. */
export interface OpcoesHelper {
  /** Chamadas que atravessam o Sankhya (buscar agenda) levam muito mais que o padrão. */
  timeoutMs?: number;
}

/**
 * Le um arquivo de token de IPC local (helper ou bridge do desktop) e falha com a
 * mensagem informada quando o arquivo nao existe ou esta vazio.
 *
 * Lido a cada chamada em vez de uma vez no boot: o processo do outro lado gera um
 * token novo quando o arquivo some, e uma copia em memoria sobreviveria a isso
 * respondendo 401 para sempre. Sao poucos bytes de disco numa rota disparada por
 * clique, nao em polling.
 */
export function lerTokenArquivo(caminho: string, mensagemIndisponivel: string): string {
  try {
    const token = readFileSync(caminho, 'utf8').trim();
    if (!token) throw new Error('vazio');
    return token;
  } catch {
    throw new HelperIndisponivelError(mensagemIndisponivel);
  }
}

export class HubHelper {
  readonly #baseUrl: string;
  readonly #arquivoToken: string;

  constructor(baseUrl: string, arquivoToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#arquivoToken = arquivoToken;
  }

  #token(): string {
    return lerTokenArquivo(
      this.#arquivoToken,
      `token do helper não encontrado em ${this.#arquivoToken} — o hub-helper.ps1 está rodando e a pasta ipc está montada no container?`,
    );
  }

  async requisitar<T>(
    caminho: string,
    init: RequestInit = {},
    opcoes: OpcoesHelper = {},
  ): Promise<T> {
    const token = this.#token();

    let resposta: Response;
    try {
      resposta = await fetch(`${this.#baseUrl}${caminho}`, {
        ...init,
        headers: { ...init.headers, 'x-hub-token': token },
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS),
      });
    } catch (err) {
      throw new HelperIndisponivelError(
        `não consegui falar com o hub-helper em ${this.#baseUrl}: ${(err as Error).message}`,
      );
    }

    const corpo = (await resposta.json().catch(() => ({}))) as { erro?: string } & T;
    if (!resposta.ok) {
      throw new HelperError(corpo.erro ?? `helper respondeu HTTP ${resposta.status}`, resposta.status);
    }
    return corpo;
  }

  /** Best-effort: alimenta o aviso de "helper fora do ar" na tela, nunca lanca. */
  async disponivel(): Promise<boolean> {
    try {
      await this.requisitar('/health');
      return true;
    } catch {
      return false;
    }
  }
}
