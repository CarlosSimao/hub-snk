/**
 * Credenciais do Sankhya ERP e do Sankhya Experience, guardadas pelo cofre do
 * shell desktop (`safeStorage` do Electron) — nunca em texto puro pelo HUB SNK.
 *
 * `revelar()` não tem rota HTTP correspondente, de propósito: o valor
 * decriptado só existe dentro do backend, para autenticar chamadas server-to-
 * server (`Experience`). Nenhum caminho leva a senha ou o token até o navegador.
 */
import type { OpcoesDaPonte, PonteDoDesktop } from './ponteDoDesktop.ts';
import type { SessaoDoDesktop, SessaoEmpurrada } from './sessaoDoDesktop.ts';
import { SISTEMAS_SANKHYA, type SistemaSankhya, type StatusCredencial } from '../tipos.ts';

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

/** A consulta atravessa o shell, a guia do ERP e o Sankhya — bem além do padrão. */
const TIMEOUT_DAS_CONSULTAS_NA_GUIA_MS = 120_000;

/** O que o shell devolve nas rotas de credencial, sem o `sistema`. */
type RespostaCredencial = Omit<StatusCredencial, 'sistema'>;

/** O que a aba ERP devolve das consultas: o JSON do Sankhya, ainda em texto. */
interface ConsultaNaGuia {
  conteudo: string;
}

export function ehSistemaValido(valor: string): valor is SistemaSankhya {
  return (SISTEMAS_SANKHYA as readonly string[]).includes(valor);
}

/**
 * Monta o status campo a campo em vez de espalhar a resposta do shell: ele
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
  readonly #ponte: PonteDoDesktop;
  readonly #sessaoDoDesktop: SessaoDoDesktop;

  constructor(ponte: PonteDoDesktop, sessaoDoDesktop: SessaoDoDesktop) {
    this.#ponte = ponte;
    this.#sessaoDoDesktop = sessaoDoDesktop;
  }

  #requisitar<T>(caminho: string, init: RequestInit = {}, opcoes: OpcoesDaPonte = {}): Promise<T> {
    return this.#ponte.requisitar<T>(caminho, init, opcoes);
  }

  /** Shell no ar. Best-effort: alimenta o aviso na tela, nunca lança. */
  async disponivel(): Promise<boolean> {
    try {
      await this.#requisitar('/health');
      return true;
    } catch {
      return false;
    }
  }

  async status(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const sessaoEmpurrada = this.#sessaoDaExperience(sistema);
    if (sessaoEmpurrada) {
      return {
        sistema,
        usuario: sessaoEmpurrada.usuario,
        definido: true,
        sessaoCapturada: true,
        sessaoExpiraEm: sessaoEmpurrada.expira,
      };
    }

    const corpo = await this.#requisitar<RespostaCredencial>(`/credentials/${sistema}`);
    return montar(sistema, corpo);
  }

  /**
   * O JWT que o shell lê da guia Experience vale mais que o do cofre: é o da
   * sessão que o usuário está usando agora, renovado a cada ciclo.
   */
  #sessaoDaExperience(sistema: SistemaSankhya): SessaoEmpurrada | undefined {
    return sistema === 'sankhya-experience' ? this.#sessaoDoDesktop.obter() : undefined;
  }

  async gravar(sistema: SistemaSankhya, usuario: string, senha: string): Promise<StatusCredencial> {
    const corpo = await this.#requisitar<RespostaCredencial>(`/credentials/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    return montar(sistema, corpo);
  }

  async remover(sistema: SistemaSankhya): Promise<StatusCredencial> {
    const corpo = await this.#requisitar<RespostaCredencial>(`/credentials/${sistema}`, {
      method: 'DELETE',
    });
    return montar(sistema, corpo);
  }

  /**
   * Tudo em claro: senha, cookies e o JWT. Uso interno do backend — nunca
   * exponha por rota HTTP nem devolva ao navegador.
   */
  async revelar(sistema: SistemaSankhya): Promise<SegredoSankhya> {
    const sessaoEmpurrada = this.#sessaoDaExperience(sistema);
    if (sessaoEmpurrada) {
      return {
        usuario: sessaoEmpurrada.usuario,
        senha: '',
        sessao: '',
        token: sessaoEmpurrada.token,
        expira: sessaoEmpurrada.expira,
      };
    }

    return this.#requisitar<SegredoSankhya>(`/credentials/${sistema}/reveal`);
  }

  /**
   * Busca a Agenda de Recursos chamando `service.sbr` de DENTRO da aba ERP
   * autenticada do shell — a ACL do Sankhya nega essa chamada quando ela vem de
   * fora do navegador.
   */
  consultarAgendaDeRecursos(de: string, ate: string): Promise<ConsultaNaGuia> {
    return this.#requisitar<ConsultaNaGuia>(
      '/agenda/fetch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ de, ate }),
      },
      { timeoutMs: TIMEOUT_DAS_CONSULTAS_NA_GUIA_MS },
    );
  }

  /** Negociações de um parceiro do ERP — de onde saem os números de FAP dele. */
  consultarNegociacoesDoParceiro(codParceiro: number): Promise<ConsultaNaGuia> {
    return this.#requisitar<ConsultaNaGuia>(
      '/agenda/negociacoes',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codParceiro: String(codParceiro) }),
      },
      { timeoutMs: TIMEOUT_DAS_CONSULTAS_NA_GUIA_MS },
    );
  }

  /**
   * Mostra a aba do sistema no shell, na tela de login. Passos separados de
   * propósito: entre abrir e capturar, quem age é o usuário, digitando a senha
   * na aba — o hub nunca vê a senha, só o cookie que sobra depois.
   */
  abrirNavegador(sistema: SistemaSankhya): Promise<{ url: string }> {
    return this.#requisitar<{ url: string }>(`/browser/abrir/${sistema}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  /** Lê os cookies daquela aba e guarda cifrados. */
  capturarSessao(
    sistema: SistemaSankhya,
  ): Promise<{ ok: boolean; cookies: number; erro?: string }> {
    return this.#requisitar<{ ok: boolean; cookies: number; erro?: string }>(
      `/browser/capturar/${sistema}`,
      { method: 'POST' },
    );
  }
}
