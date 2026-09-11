/**
 * Mede as bases dos clientes: respondem? em que versao?
 *
 * O hub fala com elas direto, sem o helper: sao URLs publicas (`*.sankhyacloud.com.br`)
 * e nada aqui precisa do Windows. Nenhuma credencial e enviada — a medicao e um GET na
 * tela de login, o mesmo que abrir o endereco no navegador sem entrar.
 */
import type { BaseCliente, Status, StatusBase } from '../types.ts';
import type { CartaoClientes } from './cartao.ts';

/**
 * A versao vem de uma atribuicao JavaScript embutida no HTML do login:
 * `SYSVERSION = "4.36b126";`. Nao ha endpoint que devolva isso — e o mesmo numero que o
 * proprio Sankhya mostra no rodape da tela.
 *
 * O `\b` importa: sem ele um futuro `XSYSVERSION` casaria. E o nome e `SYSVERSION`
 * mesmo — procurar por `VERSION` sozinho nao acha nada.
 */
const REGEX_VERSAO = /\bSYSVERSION\s*=\s*"([^"]+)"/;

/**
 * Sem User-Agent de navegador o Sankhya serve a pagina de "browser nao suportado".
 * Ela ate traz a versao, mas nao e o que o usuario veria — e medir outra coisa que nao
 * a tela real e como nao medir.
 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const TIMEOUT_MS = 12_000;

/** Quanto tempo uma medicao vale antes de a tela pedir outra. */
const VALIDADE_MS = 60_000;

export class MonitorBases {
  readonly #cartao: CartaoClientes;
  readonly #cache = new Map<number, StatusBase>();

  constructor(cartao: CartaoClientes) {
    this.#cartao = cartao;
  }

  /** O que ja se sabe, sem medir de novo. A tela pinta isso antes de pedir a medicao. */
  conhecido(baseId: number): StatusBase | undefined {
    const guardado = this.#cache.get(baseId);
    return guardado && Date.now() - guardado.medidoEm < VALIDADE_MS ? guardado : undefined;
  }

  async medir(base: BaseCliente): Promise<StatusBase> {
    const inicio = Date.now();
    let status: Status = 'down';
    let mensagem = '';
    let versao = base.versao;

    try {
      const resposta = await fetch(base.url, {
        redirect: 'follow',
        headers: { 'user-agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (resposta.ok) {
        status = 'up';
        mensagem = 'Operacional';

        const html = await resposta.text();
        const achado = REGEX_VERSAO.exec(html);
        if (achado?.[1]) {
          versao = achado[1];
          // Guardado no banco para a tela mostrar a versao sem medir de novo a cada
          // carregamento — a medicao leva segundos e a versao muda de mes em mes.
          if (versao !== base.versao) this.#cartao.registrarVersao(base.id, versao);
        }
      } else {
        // 5xx e a base doente; 4xx costuma ser URL errada no cadastro. Os dois sao
        // vermelho, mas a mensagem precisa distinguir para nao mandar ninguem
        // investigar servidor por causa de um endereco digitado errado.
        status = resposta.status >= 500 ? 'down' : 'degraded';
        mensagem = `HTTP ${resposta.status}`;
      }
    } catch (err) {
      const causa = (err as Error).name === 'TimeoutError' ? 'sem resposta a tempo' : (err as Error).message;
      mensagem = causa;
    }

    const medida: StatusBase = {
      baseId: base.id,
      status,
      mensagem,
      versao,
      latenciaMs: status === 'up' ? Date.now() - inicio : null,
      medidoEm: Date.now(),
    };

    this.#cache.set(base.id, medida);
    return medida;
  }

  /**
   * Mede todas as bases marcadas, em paralelo.
   *
   * Uma base fora do ar nao pode segurar as outras — por isso `allSettled` e nao
   * `all`, e o erro de uma vira o status dela em vez de derrubar a rodada inteira.
   */
  async medirMarcadas(): Promise<StatusBase[]> {
    const resultados = await Promise.allSettled(
      this.#cartao.basesMonitoradas().filter((b) => b.url).map((b) => this.medir(b)),
    );
    return resultados
      .filter((r): r is PromiseFulfilledResult<StatusBase> => r.status === 'fulfilled')
      .map((r) => r.value);
  }
}
