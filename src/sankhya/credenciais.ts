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
import { SISTEMAS_SANKHYA, type SistemaSankhya, type StatusCredencial } from '../types.ts';

export function ehSistemaValido(valor: string): valor is SistemaSankhya {
  return (SISTEMAS_SANKHYA as readonly string[]).includes(valor);
}

export class Credenciais {
  readonly #helper: HubHelper;

  constructor(helper: HubHelper) {
    this.#helper = helper;
  }

  async status(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const corpo = await this.#helper.requisitar<{ usuario: string; definido: boolean }>(
      `/credentials/${sistema}`,
    );
    return { sistema, usuario: corpo.usuario, definido: corpo.definido };
  }

  async gravar(sistema: SistemaSankhya, usuario: string, senha: string): Promise<StatusCredencial> {
    const corpo = await this.#helper.requisitar<{ usuario: string; definido: boolean }>(
      `/credentials/${sistema}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
      },
    );
    return { sistema, usuario: corpo.usuario, definido: corpo.definido };
  }

  async remover(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const corpo = await this.#helper.requisitar<{ usuario: string; definido: boolean }>(
      `/credentials/${sistema}`,
      { method: 'DELETE' },
    );
    return { sistema, usuario: corpo.usuario, definido: corpo.definido };
  }

  /** Uso interno do backend (login automatizado). Nunca exponha por rota HTTP. */
  async revelar(sistema: SistemaSankhya): Promise<{ usuario: string; senha: string }> {
    return this.#helper.requisitar<{ usuario: string; senha: string }>(
      `/credentials/${sistema}/reveal`,
    );
  }
}
