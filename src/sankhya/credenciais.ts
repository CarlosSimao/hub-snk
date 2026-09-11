/**
 * Credenciais do Sankhya ERP e do Sankhya Experience, guardadas com DPAPI pelo
 * `hub-helper.ps1` — fora do container e fora do volume Docker.
 *
 * Separado do `Cofre` (src/segredos.ts), que guarda as variaveis dos alvos monitorados
 * em JSON no volume: aqui sao as credenciais que o proprio hub usa para se autenticar
 * no Sankhya, e elas passam por login automatizado, entao precisam ser reversiveis e
 * merecem criptografia de verdade.
 *
 * `revelar()` nao tem rota HTTP correspondente no hub, de proposito: o valor decriptado
 * so existe dentro do backend, no momento do login automatizado. Nenhum caminho leva
 * a senha ate o navegador.
 */
import type { HubHelper } from './helper.ts';
import {
  SISTEMAS_SANKHYA,
  type SistemaSankhya,
  type StatusCredencial,
  type StatusNavegador,
} from '../types.ts';

/** O que o helper devolve nas rotas de credencial, sem o `sistema`. */
type RespostaCredencial = Omit<StatusCredencial, 'sistema'>;

/** Objeto, array ou ausente -> array. O PowerShell colapsa lista de um item só. */
export function normalizarLista<T>(valor: unknown): T[] {
  if (Array.isArray(valor)) return valor as T[];
  return valor === null || valor === undefined ? [] : [valor as T];
}

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

/**
 * Monta o status campo a campo em vez de espalhar a resposta do helper: ele devolve
 * um `ok` de transporte que não tem nada a ver com o estado da credencial e que
 * acabaria vazando para a API do hub.
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

export function ehSistemaValido(valor: string): valor is SistemaSankhya {
  return (SISTEMAS_SANKHYA as readonly string[]).includes(valor);
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
   * Tudo em claro: senha, cookies e o JWT. Uso interno do backend, para autenticar
   * contra o Sankhya — nunca exponha por rota HTTP nem devolva ao navegador.
   *
   * `token` é o que autentica a API da Experience; `sessao` (os cookies) serve ao ERP
   * legado, cujo `service.sbr` vai por cookie.
   */
  async revelar(sistema: SistemaSankhya): Promise<SegredoSankhya> {
    return this.#helper.requisitar<SegredoSankhya>(`/credentials/${sistema}/reveal`);
  }

  async statusNavegador(): Promise<StatusNavegador> {
    const corpo = await this.#helper.requisitar<StatusNavegador>('/browser/status');
    return {
      navegador: Boolean(corpo.navegador),
      disponiveis: normalizarLista(corpo.disponiveis),
      aberto: Boolean(corpo.aberto),
      // O PowerShell serializa uma lista de UM item como objeto, não como array — a
      // mesma armadilha do payload da Agenda de Recursos, e a mesma correção.
      abas: normalizarLista(corpo.abas),
      telas: normalizarLista(corpo.telas),
      perfis: normalizarLista(corpo.perfis),
    };
  }

  /** Fecha só a janela do hub; o navegador pessoal do usuário não é tocado. */
  fecharNavegador(): Promise<{ mensagem: string }> {
    return this.#helper.requisitar<{ mensagem: string }>('/browser/fechar', { method: 'POST' });
  }

  /**
   * Traz os favoritos de um perfil pessoal para o perfil do hub.
   *
   * Só o arquivo de favoritos — senha, cookie e histórico ficam onde estão. O perfil
   * real não pode ser usado direto: desde o Chrome 136 o navegador recusa o DevTools
   * quando o perfil é o padrão, e sem DevTools o hub não lê a sessão.
   */
  importarFavoritos(navegador: string, perfil: string): Promise<{ ok: boolean }> {
    return this.#helper.requisitar<{ ok: boolean }>('/browser/favoritos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ navegador, perfil }),
    });
  }

  /**
   * Abre uma guia na janela do hub.
   *
   * Sem `tela`, cai no login do sistema — e quem digita a senha é o usuário, ali, não o
   * hub. Com `tela`, vai direto para a tela pedida. Em qualquer caso é uma GUIA na
   * janela que já existe: o usuário segue usando o navegador normalmente.
   */
  abrirNavegador(
    sistema: SistemaSankhya,
    opcoes: { tela?: string; navegador?: string } = {},
  ): Promise<{ url: string }> {
    return this.#helper.requisitar<{ url: string }>(`/browser/abrir/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opcoes),
    });
  }

  /** Lê os cookies daquela janela e guarda cifrados. */
  capturarSessao(sistema: SistemaSankhya): Promise<{ ok: boolean; cookies: number; erro?: string }> {
    return this.#helper.requisitar<{ ok: boolean; cookies: number; erro?: string }>(
      `/browser/capturar/${sistema}`,
      { method: 'POST' },
    );
  }
}
