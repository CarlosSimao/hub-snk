/**
 * Transporte para o `hub-helper.ps1` (Windows, porta 4102).
 *
 * Existe porque o DPAPI (criptografia das credenciais do Sankhya) não roda dentro
 * do processo Node — só no Windows nativo. O helper roda como script PowerShell
 * separado e o HUB SNK o alcança por HTTP local.
 *
 * Toda rota do helper exige o header `X-Hub-Token`. O token é gerado pelo helper em
 * `%APPDATA%\sankhya-hub\ipc\token.txt` e lido daqui a cada chamada — sem isso,
 * qualquer aparelho da rede local que alcançasse a porta poderia ler credenciais.
 */
import { readFileSync } from 'node:fs';

/** O helper não está no ar, ou o token não chegou a ser lido. */
export class HelperIndisponivelError extends Error {}

/** O helper respondeu, mas com erro de negócio (sistema desconhecido, corpo inválido). */
export class HelperError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_PADRAO_MS = 10_000;

export interface OpcoesHelper {
  timeoutMs?: number;
}

/**
 * Lê o arquivo de token do helper e falha com a mensagem informada quando o
 * arquivo não existe ou está vazio.
 *
 * Lido a cada chamada em vez de uma vez no boot: o helper gera um token novo
 * quando o arquivo some (reinício), e uma cópia em memória sobreviveria a isso
 * respondendo 401 para sempre.
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
      `token do helper não encontrado em ${this.#arquivoToken} — o hub-helper.ps1 está rodando?`,
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
      throw new HelperError(
        corpo.erro ?? `helper respondeu HTTP ${resposta.status}`,
        resposta.status,
      );
    }
    return corpo;
  }

  /** Best-effort: alimenta o aviso de "helper fora do ar" na tela, nunca lança. */
  async disponivel(): Promise<boolean> {
    try {
      await this.requisitar('/health');
      return true;
    } catch {
      return false;
    }
  }
}
