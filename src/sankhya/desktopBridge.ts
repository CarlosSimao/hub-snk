/**
 * Transporte do backend (container) para o shell desktop (`desktop/`, Electron rodando
 * nativamente no Windows) — mesmo modelo do `HubHelper` (src/sankhya/helper.ts), só que
 * na direção inversa da razão de existir: aqui e' para pedir uma operacao que so' a aba
 * ERP autenticada dentro do Electron consegue fazer (o `service.sbr` nega a chamada
 * quando ela nao vem de dentro da pagina logada — ver src/routesAgenda.ts).
 *
 * Reusa o mesmo arquivo de token do `hub-helper.ps1` (pasta `helper-ipc`, ja montada
 * read-only no container): o shell desktop grava `desktop-token.txt` na mesma pasta,
 * sem exigir mudanca de volume no docker-compose.
 */
import { lerTokenArquivo } from './helper.ts';

export class DesktopBridgeIndisponivelError extends Error {}

export class DesktopBridgeError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const TIMEOUT_PADRAO_MS = 10_000;
/** A busca de Agenda atravessa o shell, a aba ERP e o Sankhya — bem alem do padrao. */
const TIMEOUT_AGENDA_MS = 120_000;

export class DesktopBridge {
  readonly #baseUrl: string;
  readonly #arquivoToken: string;

  constructor(baseUrl: string, arquivoToken: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, '');
    this.#arquivoToken = arquivoToken;
  }

  #token(): string {
    try {
      return lerTokenArquivo(this.#arquivoToken, '');
    } catch {
      throw new DesktopBridgeIndisponivelError(
        `token do shell desktop não encontrado em ${this.#arquivoToken} — o Sankhya Hub Desktop está rodando?`,
      );
    }
  }

  async #requisitar<T>(caminho: string, init: RequestInit = {}, timeoutMs = TIMEOUT_PADRAO_MS): Promise<T> {
    const token = this.#token();

    let resposta: Response;
    try {
      resposta = await fetch(`${this.#baseUrl}${caminho}`, {
        ...init,
        headers: { ...init.headers, 'x-hub-token': token },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new DesktopBridgeIndisponivelError(
        `não consegui falar com o shell desktop em ${this.#baseUrl}: ${(err as Error).message}`,
      );
    }

    const corpo = (await resposta.json().catch(() => ({}))) as { erro?: string } & T;
    if (!resposta.ok) {
      throw new DesktopBridgeError(corpo.erro ?? `shell desktop respondeu HTTP ${resposta.status}`, resposta.status);
    }
    return corpo;
  }

  /** Mesmo formato de retorno que `helper.requisitar('/browser/agenda', ...)` já usa. */
  buscarAgenda(de: string, ate: string): Promise<{ conteudo: string }> {
    return this.#requisitar<{ conteudo: string }>(
      '/agenda/fetch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ de, ate }),
      },
      TIMEOUT_AGENDA_MS,
    );
  }

  // --- credenciais (Fase 3: substituem as rotas /credentials do hub-helper.ps1) -----
  //
  // Mesmo contrato do helper, de proposito: o backend nao precisa saber quem esta do
  // outro lado enquanto os dois convivem. A diferenca que importa e' de exposicao — o
  // helper escuta em todas as interfaces da maquina, o bridge so' em 127.0.0.1.

  statusCredencial<T>(sistema: string): Promise<T> {
    return this.#requisitar<T>(`/credentials/${sistema}`);
  }

  gravarCredencial<T>(sistema: string, usuario: string, senha: string): Promise<T> {
    return this.#requisitar<T>(`/credentials/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
  }

  removerCredencial<T>(sistema: string): Promise<T> {
    return this.#requisitar<T>(`/credentials/${sistema}`, { method: 'DELETE' });
  }

  revelarCredencial<T>(sistema: string): Promise<T> {
    return this.#requisitar<T>(`/credentials/${sistema}/reveal`);
  }

  // --- segredo avulso (Fase 3: substitui /secret/* do hub-helper.ps1) ---------------

  cifrarSegredo<T>(valor: string): Promise<T> {
    return this.#requisitar<T>('/secret/encrypt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor }),
    });
  }

  decifrarSegredo<T>(valor: string): Promise<T> {
    return this.#requisitar<T>('/secret/decrypt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor }),
    });
  }

  // --- navegador (Fase 3: substitui /browser/* do hub-helper.ps1) -------------------
  //
  // O shell E' o navegador: nao ha Chrome separado, nem DevTools na 9222. O contrato
  // segue o mesmo para o backend nao precisar saber disso.

  statusNavegador<T>(): Promise<T> {
    return this.#requisitar<T>('/browser/status');
  }

  fecharNavegador<T>(): Promise<T> {
    return this.#requisitar<T>('/browser/fechar', { method: 'POST' });
  }

  favoritosNavegador<T>(navegador: string, perfil: string): Promise<T> {
    const busca = new URLSearchParams({ navegador, perfil });
    return this.#requisitar<T>(`/browser/favoritos?${busca}`);
  }

  importarFavoritos<T>(navegador: string, perfil: string): Promise<T> {
    return this.#requisitar<T>('/browser/favoritos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ navegador, perfil }),
    });
  }

  abrirNavegador<T>(sistema: string, opcoes: { tela?: string; navegador?: string }): Promise<T> {
    return this.#requisitar<T>(`/browser/abrir/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opcoes),
    });
  }

  capturarSessao<T>(sistema: string): Promise<T> {
    return this.#requisitar<T>(`/browser/capturar/${sistema}`, { method: 'POST' });
  }

  async disponivel(): Promise<boolean> {
    try {
      await this.#requisitar('/health');
      return true;
    } catch {
      return false;
    }
  }
}
