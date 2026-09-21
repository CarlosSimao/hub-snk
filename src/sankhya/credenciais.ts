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
import { DesktopBridgeIndisponivelError, type DesktopBridge } from './desktopBridge.ts';
import type { SessaoDesktopStore } from './sessaoDesktop.ts';
import {
  SISTEMAS_SANKHYA,
  type SistemaSankhya,
  type StatusCredencial,
  type StatusNavegador,
  type FavoritoNavegador,
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
  readonly #bridge: DesktopBridge | undefined;
  readonly #sessaoDesktop: SessaoDesktopStore | undefined;

  constructor(helper: HubHelper, sessaoDesktop?: SessaoDesktopStore, bridge?: DesktopBridge) {
    this.#helper = helper;
    this.#bridge = bridge;
    this.#sessaoDesktop = sessaoDesktop;
  }

  /**
   * Shell desktop primeiro, `hub-helper.ps1` como retaguarda.
   *
   * O cofre do shell usa `safeStorage` — DPAPI, igual ao helper — mas vive dentro do
   * processo do Electron e so' e' alcancavel por `127.0.0.1`. Enquanto os dois convivem,
   * quem manda e' quem esta no ar.
   *
   * So' a INDISPONIBILIDADE do shell faz cair para o helper: se o shell respondeu com
   * erro de negocio (sistema desconhecido, corpo invalido), repetir a chamada no helper
   * daria a mesma resposta e mascararia o erro real.
   */
  async #preferindoShell<T>(
    viaShell: (bridge: DesktopBridge) => Promise<T>,
    viaHelper: () => Promise<T>,
  ): Promise<T> {
    if (this.#bridge) {
      try {
        return await viaShell(this.#bridge);
      } catch (err) {
        if (!(err instanceof DesktopBridgeIndisponivelError)) throw err;
      }
    }
    return viaHelper();
  }

  async status(sistema: SistemaSankhya): Promise<StatusCredencial> {
    if (sistema === 'sankhya-experience') {
      const sessao = this.#sessaoDesktop?.obter();
      if (sessao) {
        return {
          sistema,
          usuario: sessao.usuario,
          definido: true,
          sessaoCapturada: true,
          sessaoExpiraEm: sessao.expira,
        };
      }
    }
    const corpo = await this.#preferindoShell<RespostaCredencial>(
      (bridge) => bridge.statusCredencial<RespostaCredencial>(sistema),
      () => this.#helper.requisitar<RespostaCredencial>(`/credentials/${sistema}`),
    );
    return montar(sistema, corpo);
  }

  async gravar(sistema: SistemaSankhya, usuario: string, senha: string): Promise<StatusCredencial> {
    const corpo = await this.#preferindoShell<RespostaCredencial>(
      (bridge) => bridge.gravarCredencial<RespostaCredencial>(sistema, usuario, senha),
      () =>
        this.#helper.requisitar<RespostaCredencial>(`/credentials/${sistema}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ usuario, senha }),
        }),
    );
    return montar(sistema, corpo);
  }

  async remover(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const corpo = await this.#preferindoShell<RespostaCredencial>(
      (bridge) => bridge.removerCredencial<RespostaCredencial>(sistema),
      () =>
        this.#helper.requisitar<RespostaCredencial>(`/credentials/${sistema}`, { method: 'DELETE' }),
    );
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
    if (sistema === 'sankhya-experience') {
      const sessao = this.#sessaoDesktop?.obter();
      if (sessao) {
        return { usuario: sessao.usuario, senha: '', sessao: '', token: sessao.token, expira: sessao.expira };
      }
    }
    return this.#preferindoShell<SegredoSankhya>(
      (bridge) => bridge.revelarCredencial<SegredoSankhya>(sistema),
      () => this.#helper.requisitar<SegredoSankhya>(`/credentials/${sistema}/reveal`),
    );
  }

  async statusNavegador(): Promise<StatusNavegador> {
    const corpo = await this.#preferindoShell<StatusNavegador>(
      (bridge) => bridge.statusNavegador<StatusNavegador>(),
      () => this.#helper.requisitar<StatusNavegador>('/browser/status'),
    );
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
    return this.#preferindoShell<{ mensagem: string }>(
      (bridge) => bridge.fecharNavegador<{ mensagem: string }>(),
      () => this.#helper.requisitar<{ mensagem: string }>('/browser/fechar', { method: 'POST' }),
    );
  }

  /**
   * Le os favoritos de um perfil pessoal, sem alterar nada.
   *
   * Serve para a tela oferecer os parceiros ja salvos no navegador como ponto de
   * partida de um cadastro: o nome do favorito vira o nome do cliente e a URL vira a
   * base. Nao e o mesmo que `importarFavoritos`, que copia o arquivo para o perfil do
   * hub — aqui nada e escrito e o navegador pode estar aberto.
   */
  listarFavoritos(navegador: string, perfil: string): Promise<{ favoritos: FavoritoNavegador[] }> {
    return this.#preferindoShell<{ favoritos: FavoritoNavegador[] }>(
      (bridge) => bridge.favoritosNavegador<{ favoritos: FavoritoNavegador[] }>(navegador, perfil),
      () => {
        const busca = new URLSearchParams({ navegador, perfil });
        return this.#helper.requisitar<{ favoritos: FavoritoNavegador[] }>(`/browser/favoritos?${busca}`);
      },
    );
  }

  /**
   * Traz os favoritos de um perfil pessoal para o perfil do hub.
   *
   * Só o arquivo de favoritos — senha, cookie e histórico ficam onde estão. O perfil
   * real não pode ser usado direto: desde o Chrome 136 o navegador recusa o DevTools
   * quando o perfil é o padrão, e sem DevTools o hub não lê a sessão.
   */
  importarFavoritos(navegador: string, perfil: string): Promise<{ ok: boolean }> {
    return this.#preferindoShell<{ ok: boolean }>(
      (bridge) => bridge.importarFavoritos<{ ok: boolean }>(navegador, perfil),
      () =>
        this.#helper.requisitar<{ ok: boolean }>('/browser/favoritos', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ navegador, perfil }),
        }),
    );
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
    return this.#preferindoShell<{ url: string }>(
      (bridge) => bridge.abrirNavegador<{ url: string }>(sistema, opcoes),
      () =>
        this.#helper.requisitar<{ url: string }>(`/browser/abrir/${sistema}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(opcoes),
        }),
    );
  }

  /** Lê os cookies daquela janela e guarda cifrados. */
  capturarSessao(sistema: SistemaSankhya): Promise<{ ok: boolean; cookies: number; erro?: string }> {
    type Resultado = { ok: boolean; cookies: number; erro?: string };
    return this.#preferindoShell<Resultado>(
      (bridge) => bridge.capturarSessao<Resultado>(sistema),
      () => this.#helper.requisitar<Resultado>(`/browser/capturar/${sistema}`, { method: 'POST' }),
    );
  }
}
