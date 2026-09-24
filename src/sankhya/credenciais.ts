/**
 * Credenciais do Sankhya ERP e do Sankhya Experience, guardadas com DPAPI pelo
 * `hub-helper.ps1` — nunca em texto puro pelo HUB SNK.
 *
 * `revelar()` não tem rota HTTP correspondente, de propósito: o valor
 * decriptado só existe dentro do backend, para autenticar chamadas server-to-
 * server (`Experience`). Nenhum caminho leva a senha ou o token até o navegador.
 */
import type { HubHelper } from './helper.ts';
import {
  SISTEMAS_SANKHYA,
  type SistemaSankhya,
  type StatusCredencial,
  type StatusNavegador,
} from '../tipos.ts';

/** O que sai do cofre decriptado. Nunca sai do backend. */
export interface SegredoSankhya {
  usuario: string;
  senha: string;
  /** Cookies serializados como cabeçalho `Cookie`. */
  sessao: string;
  /** JWT do `localStorage` — é o que a API da Experience aceita. */
  token: string;
  /** ISO-8601 do `exp` do JWT, quando há um. */
  expira: string;
}

/** O que o helper devolve nas rotas de credencial, sem o `sistema`. */
type RespostaCredencial = Omit<StatusCredencial, 'sistema'>;

/** Objeto, array ou ausente -> array. O PowerShell colapsa lista de um item só. */
export function normalizarLista<T>(valor: unknown): T[] {
  if (Array.isArray(valor)) return valor as T[];
  return valor === null || valor === undefined ? [] : [valor as T];
}

export function ehSistemaValido(valor: string): valor is SistemaSankhya {
  return (SISTEMAS_SANKHYA as readonly string[]).includes(valor);
}

/**
 * Monta o status campo a campo em vez de espalhar a resposta do helper: ele
 * devolve um `ok` de transporte que não tem nada a ver com o estado da
 * credencial e que acabaria vazando para a API do hub.
 */
function montar(sistema: SistemaSankhya, corpo: RespostaCredencial): StatusCredencial {
  return {
    sistema,
    usuario: corpo.usuario ?? '',
    definido: Boolean(corpo.definido),
    sessaoCapturada: Boolean(corpo.sessaoCapturada),
    sessaoExpiraEm: corpo.sessaoExpiraEm ?? '',
  };
}

export class Credenciais {
  readonly #helper: HubHelper;

  constructor(helper: HubHelper) {
    this.#helper = helper;
  }

  async status(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const corpo = await this.#helper.requisitar<RespostaCredencial>(`/credentials/${sistema}`);
    return montar(sistema, corpo);
  }

  async gravar(sistema: SistemaSankhya, usuario: string, senha: string): Promise<StatusCredencial> {
    const corpo = await this.#helper.requisitar<RespostaCredencial>(`/credentials/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    return montar(sistema, corpo);
  }

  async remover(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const corpo = await this.#helper.requisitar<RespostaCredencial>(`/credentials/${sistema}`, {
      method: 'DELETE',
    });
    return montar(sistema, corpo);
  }

  /**
   * Tudo em claro: senha, cookies e o JWT. Uso interno do backend — nunca
   * exponha por rota HTTP nem devolva ao navegador.
   */
  revelar(sistema: SistemaSankhya): Promise<SegredoSankhya> {
    return this.#helper.requisitar<SegredoSankhya>(`/credentials/${sistema}/reveal`);
  }

  async statusNavegador(): Promise<StatusNavegador> {
    const corpo = await this.#helper.requisitar<StatusNavegador>('/browser/status');
    return {
      navegador: Boolean(corpo.navegador),
      disponiveis: normalizarLista(corpo.disponiveis),
      aberto: Boolean(corpo.aberto),
      abas: normalizarLista(corpo.abas),
    };
  }

  /**
   * Busca a Agenda de Recursos chamando `service.sbr` de DENTRO da guia
   * autenticada (o helper faz isso via CDP) — a ACL do Sankhya nega essa
   * chamada quando ela vem de fora do navegador.
   */
  consultarAgendaDeRecursos(de: string, ate: string): Promise<{ ok: boolean; conteudo: string }> {
    return this.#helper.requisitar<{ ok: boolean; conteudo: string }>('/browser/agenda', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ de, ate }),
    });
  }

  /** Negociações de um parceiro do ERP — de onde saem os números de FAP dele. */
  consultarNegociacoesDoParceiro(codParceiro: number): Promise<{ ok: boolean; conteudo: string }> {
    return this.#helper.requisitar<{ ok: boolean; conteudo: string }>(
      '/browser/agenda-negociacoes',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codParceiro: String(codParceiro) }),
      },
    );
  }

  fecharNavegador(): Promise<{ mensagem: string }> {
    return this.#helper.requisitar<{ mensagem: string }>('/browser/fechar', { method: 'POST' });
  }

  /**
   * Abre a janela do hub na tela de login. Passos separados de propósito: entre
   * abrir e capturar, quem age é o usuário, digitando a senha no navegador — o
   * hub nunca vê a senha, só o cookie que sobra depois.
   */
  abrirNavegador(sistema: SistemaSankhya): Promise<{ url: string }> {
    return this.#helper.requisitar<{ url: string }>(`/browser/abrir/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  /** Lê os cookies daquela janela e guarda cifrados. */
  capturarSessao(
    sistema: SistemaSankhya,
  ): Promise<{ ok: boolean; cookies: number; erro?: string }> {
    return this.#helper.requisitar<{ ok: boolean; cookies: number; erro?: string }>(
      `/browser/capturar/${sistema}`,
      { method: 'POST' },
    );
  }
}
