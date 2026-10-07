/**
 * Sankhya ID (usuário e senha, os mesmos para o SankhyaOm e para a Experience) e a sessão
 * de cada um dos dois, guardados pelo cofre do shell desktop (`safeStorage` do Electron)
 * — nunca em texto puro pelo HUB SNK.
 *
 * `revelar()` não tem rota HTTP correspondente, de propósito: cookies e token
 * só existem dentro do backend, para autenticar chamadas server-to-server
 * (`Experience`). A senha, e só ela, vai ao navegador por `revelarSenha()`:
 * a janela de credenciais a mostra, decisão consciente de quem usa o hub.
 */
import type { NovaOcorrencia } from './ocorrencias.ts';
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

/** O Sankhya ID sozinho: o que o shell devolve ao gravar e ao remover. */
export type StatusDoSankhyaId = Pick<StatusCredencial, 'usuario' | 'definido' | 'aviso'>;

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
    aviso: corpo.aviso ?? '',
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
        aviso: '',
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

  async gravar(usuario: string, senha: string): Promise<StatusDoSankhyaId> {
    const corpo = await this.#requisitar<StatusDoSankhyaId>('/credentials/id', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario, senha }),
    });
    return this.#statusDoId(corpo);
  }

  /** Tira o Sankhya ID e as sessões dos dois sistemas. */
  async remover(): Promise<StatusDoSankhyaId> {
    const corpo = await this.#requisitar<StatusDoSankhyaId>('/credentials/id', {
      method: 'DELETE',
    });
    return this.#statusDoId(corpo);
  }

  #statusDoId(corpo: StatusDoSankhyaId): StatusDoSankhyaId {
    return {
      usuario: corpo.usuario ?? '',
      definido: Boolean(corpo.definido),
      aviso: corpo.aviso ?? '',
    };
  }

  /**
   * A senha guardada no cofre, e nada mais — nem a sessão empurrada da
   * Experience, que não tem senha, serve aqui.
   */
  async revelarSenha(): Promise<string> {
    const segredo = await this.#requisitar<SegredoSankhya>('/credentials/id/reveal');
    return segredo.senha ?? '';
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

  /** Quem está logado no ERP pela janela oculta — o único em nome de quem se lança ocorrência. */
  usuarioDaOcorrencia(): Promise<{ codusu: number; nomeusu: string }> {
    return this.#requisitar<{ codusu: number; nomeusu: string }>(
      '/ocorrencias/usuario',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
      { timeoutMs: TIMEOUT_DAS_CONSULTAS_NA_GUIA_MS },
    );
  }

  /**
   * GRAVA no ERP pelo botão "Criar ocorrência". `codusuEsperado` é o CODUSU configurado no
   * hub: o shell recusa se a sessão for de outro usuário.
   */
  criarOcorrencia(
    nova: NovaOcorrencia,
    codusuEsperado: number | null,
  ): Promise<{ mensagem: string }> {
    return this.#requisitar<{ mensagem: string }>(
      '/ocorrencias/criar',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...nova, codusuEsperado }),
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

  /**
   * Loga sozinho na guia do sistema com a credencial salva no cofre e já captura a
   * sessão depois — sem passo manual de "abrir aba" nem "capturar sessão".
   */
  autoLoginSankhya(
    sistema: SistemaSankhya,
  ): Promise<{ ok: boolean; cookies: number; erro?: string }> {
    return this.#requisitar<{ ok: boolean; cookies: number; erro?: string }>(
      `/browser/autologin/${sistema}`,
      { method: 'POST' },
      { timeoutMs: TIMEOUT_DAS_CONSULTAS_NA_GUIA_MS },
    );
  }
}
