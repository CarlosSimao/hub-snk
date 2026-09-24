/**
 * Transporte para o shell desktop (Electron, `desktop/`), que expõe em
 * `127.0.0.1:4103` o mesmo contrato do antigo `hub-helper.ps1`: `/credentials/*`,
 * `/browser/*` e as consultas feitas de dentro da guia autenticada do ERP.
 *
 * Existe porque, com o HUB SNK hospedado pelo shell, o navegador logado no
 * Sankhya é o próprio Electron: só ele consegue chamar o `service.sbr` de dentro
 * da página autenticada e guardar as credenciais com `safeStorage`.
 *
 * Toda rota exige o header `X-Hub-Token`. O shell grava o token em
 * `desktop-token.txt`, na mesma pasta de IPC do helper, e ele é lido daqui a
 * cada chamada: o shell recria o token quando o arquivo some, e uma cópia em
 * memória responderia 401 para sempre depois disso.
 */
import { readFileSync } from 'node:fs';

/** O shell não está no ar, ou o token não chegou a ser lido. */
export class PonteDoDesktopIndisponivelError extends Error {}

/** O shell respondeu, mas com erro de negócio (sistema desconhecido, corpo inválido). */
export class PonteDoDesktopError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_PADRAO_MS = 10_000;

export interface OpcoesDaPonte {
  timeoutMs?: number;
}

/**
 * Lê o token gravado pelo shell. Arquivo ausente ou vazio é o shell fora do ar,
 * não defeito: quem roda só o backend (`npm run dev`) cai sempre aqui.
 */
export function lerTokenDoDesktop(caminho: string): string {
  try {
    const token = readFileSync(caminho, 'utf8').trim();
    if (token) {
      return token;
    }
  } catch {
    /* Tratado abaixo, junto com o arquivo vazio. */
  }

  throw new PonteDoDesktopIndisponivelError(
    `token do shell desktop não encontrado em ${caminho} — o HUB SNK desktop está rodando?`,
  );
}

export class PonteDoDesktop {
  readonly #baseUrl: string;
  readonly #arquivoToken: string;

  constructor(baseUrl: string, arquivoToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#arquivoToken = arquivoToken;
  }

  async requisitar<T>(
    caminho: string,
    init: RequestInit = {},
    opcoes: OpcoesDaPonte = {},
  ): Promise<T> {
    const token = lerTokenDoDesktop(this.#arquivoToken);

    let resposta: Response;
    try {
      resposta = await fetch(`${this.#baseUrl}${caminho}`, {
        ...init,
        headers: { ...init.headers, 'x-hub-token': token },
        signal: AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_PADRAO_MS),
      });
    } catch (erro) {
      throw new PonteDoDesktopIndisponivelError(
        `não consegui falar com o shell desktop em ${this.#baseUrl}: ${(erro as Error).message}`,
      );
    }

    const corpo = (await resposta.json().catch(() => ({}))) as { erro?: string } & T;
    if (!resposta.ok) {
      throw new PonteDoDesktopError(
        corpo.erro ?? `shell desktop respondeu HTTP ${resposta.status}`,
        resposta.status,
      );
    }
    return corpo;
  }
}
