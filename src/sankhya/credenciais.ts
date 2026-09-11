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
   * Senha e cookie de sessão em claro. Uso interno do backend, para autenticar contra o
   * Sankhya — nunca exponha por rota HTTP nem devolva ao navegador.
   */
  async revelar(
    sistema: SistemaSankhya,
  ): Promise<{ usuario: string; senha: string; sessao: string }> {
    return this.#helper.requisitar<{ usuario: string; senha: string; sessao: string }>(
      `/credentials/${sistema}/reveal`,
    );
  }

  statusNavegador(): Promise<StatusNavegador> {
    return this.#helper.requisitar<StatusNavegador>('/browser/status');
  }

  /**
   * Abre a janela do hub na tela de login do sistema. Quem digita a senha é o usuário,
   * no navegador — ela não passa pelo hub em nenhum momento.
   */
  abrirNavegador(sistema: SistemaSankhya): Promise<{ url: string }> {
    return this.#helper.requisitar<{ url: string }>(`/browser/abrir/${sistema}`, {
      method: 'POST',
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
