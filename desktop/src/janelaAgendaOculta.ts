/**
 * Janela invisível dedicada à Agenda de Recursos do Sankhya OM.
 *
 * Por que existe: provado em teste que o login por API (`MobileLoginSP.login`) cria uma
 * sessão com ACL restrito — `AgendaRecursosSP.carregarAgendas` responde "Acesso negado ao
 * serviço" para o mesmo usuário que, logado pela WEB, tem acesso normal. Só o login web
 * libera o serviço. Esta janela faz esse login web sozinha, numa PARTIÇÃO de sessão
 * própria (separada da aba ERP que o usuário vê), abre a tela da Agenda nela mesma e chama
 * o serviço pelo `ServiceProxy` da própria página — o mesmo caminho de um clique real.
 *
 * Como é uma janela dedicada e escondida, recarregá-la para relogar não atrapalha nada do
 * usuário — ao contrário do fluxo antigo, que pegava carona na aba visível e a derrubava.
 */
import { type BrowserWindow, type WebContents } from 'electron';
import * as cofre from './cofreCredenciais';
import { ERP_URL } from './config';
import { logEvento } from './log';
import { criarJanelaOculta, preencherESubmeterLogin } from './loginOcultoSankhya';

/** Resultado bruto de uma consulta na Agenda: o JSON do Sankhya em texto, ou um erro. */
export interface ResultadoFetch {
  ok: boolean;
  conteudo?: string;
  erro?: string;
}

/**
 * Contrato do que consulta a Agenda de Recursos, para o `bridgeServer` não depender da
 * implementação concreta.
 */
export interface ConsultorDeAgenda {
  buscar(de: string, ate: string): Promise<ResultadoFetch>;
  buscarNegociacoes(codParceiro: string): Promise<ResultadoFetch>;
}

/** Partição isolada da Agenda — nunca a da aba ERP visível, senão relogar uma afetaria a outra. */
const PARTICAO_AGENDA = 'persist:sankhya-hub-agenda';
const RES = 'br.com.sankhya.os.mov.agenda.recursos';
const MARCADOR_TELA = 'AgendaRecursos.xhtml5';
const ORIGEM_ERP = new URL(ERP_URL).origin;
/**
 * O workspace abre a tela ao receber este hash — o mesmo efeito de um clique de menu, que
 * registra o `resourceID` na sessão. Carregar o `.xhtml5` direto por URL responde 500: a
 * tela não existe sem esse registro server-side (descoberto no diagnóstico ao vivo).
 */
const HASH_TELA_AGENDA = `#app/${Buffer.from(RES, 'utf8').toString('base64')}`;
const URL_WORKSPACE = `${ORIGEM_ERP}/mge/system.jsp`;

const INTERVALO_MS = 1_000;
/** Tempo para o POST de login redirecionar antes de considerar autenticado. */
const AUTENTICAR_TIMEOUT_MS = 60_000;
/** Tempo para o workspace montar a tela da Agenda no iframe e expor o `ServiceProxy`. */
const TELA_PRONTA_TIMEOUT_MS = 90_000;

const CLIENT_EVENT = { clientEvent: [{ $: 'br.com.sankhya.mgeserv.event.envio.email' }] };

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ehTelaDeLogin(url: string): boolean {
  return /login|signin|gotologin/i.test(url);
}

/**
 * Localiza o `ServiceProxy` VIVO da tela, que roda num iframe (`AgendaRecursos.xhtml5`)
 * dentro do workspace — é a mesma função que o clique real usa, e a única que o servidor
 * aceita (a chamada precisa do contador e do `resourceID` que o Angular da tela mantém).
 */
function trechoLocalizarServiceProxy(): string {
  return `
    const iframe = [...document.querySelectorAll('iframe')].find(
      (q) => q.src && q.src.includes(${JSON.stringify(MARCADOR_TELA)}),
    );
    if (!iframe || !iframe.contentWindow) {
      resolve({ ok: false, erro: 'a tela da Agenda ainda não abriu no workspace' });
      return;
    }
    let serviceProxy;
    try {
      const janela = iframe.contentWindow;
      serviceProxy = janela.angular.element(janela.document.body).injector().get('ServiceProxy');
    } catch (e) {
      resolve({ ok: false, erro: 'não achei o ServiceProxy da tela: ' + String(e) });
      return;
    }
  `;
}

function scriptChamarServico(serviceName: string, requestBody: unknown): string {
  const corpo = JSON.stringify(requestBody);
  return `new Promise((resolve) => {
    ${trechoLocalizarServiceProxy()}
    const devolver = (dados) => resolve({ ok: true, conteudo: JSON.stringify(dados) });
    serviceProxy
      .callService(${JSON.stringify(serviceName)}, ${corpo}, { ignorePopUpErrorMsgs: true })
      .then(devolver, devolver);
  })`;
}

/** `true` quando o iframe da tela já está montado e o `ServiceProxy` dele acessível. */
function scriptServiceProxyPronto(): string {
  return `(() => {
    try {
      const iframe = [...document.querySelectorAll('iframe')].find(
        (q) => q.src && q.src.includes(${JSON.stringify(MARCADOR_TELA)}),
      );
      if (!iframe || !iframe.contentWindow) return false;
      const janela = iframe.contentWindow;
      return !!janela.angular.element(janela.document.body).injector().get('ServiceProxy');
    } catch (e) {
      return false;
    }
  })()`;
}

/** Abre a tela da Agenda pelo hash do workspace (equivale ao clique de menu). */
function scriptAbrirTela(): string {
  return `(() => { location.hash = ${JSON.stringify(HASH_TELA_AGENDA)}; return location.href; })()`;
}

export class JanelaAgendaOculta implements ConsultorDeAgenda {
  #janela: BrowserWindow | null = null;
  /** Serializa tudo: uma requisição por vez, e nenhum setup concorrente. */
  #fila: Promise<unknown> = Promise.resolve();

  buscar(de: string, ate: string): Promise<ResultadoFetch> {
    const requestBody = {
      params: {
        filter: {},
        start: de,
        end: ate,
        filtroRapido: {},
        mostraUsuarioLogado: false,
        resourceId: RES,
        resourceIdListaUsuarios: `${RES}.list.Executante`,
      },
      ...CLIENT_EVENT,
    };
    return this.#enfileirar(() =>
      this.#chamarComRelogin('mgeos@AgendaRecursosSP.carregarAgendas', requestBody),
    );
  }

  buscarNegociacoes(codParceiro: string): Promise<ResultadoFetch> {
    const requestBody = { params: { codParceiro: { $: codParceiro } }, ...CLIENT_EVENT };
    return this.#enfileirar(() =>
      this.#chamarComRelogin('mgeos@AgendaRecursosSP.getNegociacoes', requestBody),
    );
  }

  /** Fecha a janela — usado no encerramento do app. */
  destruir(): void {
    if (this.#janela && !this.#janela.isDestroyed()) this.#janela.destroy();
    this.#janela = null;
  }

  #enfileirar(tarefa: () => Promise<ResultadoFetch>): Promise<ResultadoFetch> {
    const execucao = this.#fila.then(tarefa);
    this.#fila = execucao.catch(() => undefined);
    return execucao;
  }

  /**
   * Chama o serviço; se a resposta indicar sessão caída (HTML, "Não autorizado" ou
   * "Acesso negado"), reloga do zero e tenta uma única vez mais.
   */
  async #chamarComRelogin(serviceName: string, requestBody: unknown): Promise<ResultadoFetch> {
    const prontidao = await this.#garantirPronta();
    if (!prontidao.ok) return prontidao;

    const primeira = await this.#chamar(serviceName, requestBody);
    if (primeira.ok && !sessaoCaiu(primeira.conteudo ?? '')) return primeira;

    logEvento('agenda-oculta-relogin', { motivo: primeira.erro ?? 'sessao-caiu' });
    this.destruir();
    const novaProntidao = await this.#garantirPronta();
    if (!novaProntidao.ok) return novaProntidao;
    return this.#chamar(serviceName, requestBody);
  }

  async #chamar(serviceName: string, requestBody: unknown): Promise<ResultadoFetch> {
    const wc = this.#janela?.webContents;
    if (!wc || wc.isDestroyed()) return { ok: false, erro: 'a janela da Agenda não está aberta' };

    const resultado = (await wc.executeJavaScript(
      scriptChamarServico(serviceName, requestBody),
      true,
    )) as ResultadoFetch;
    if (!resultado.ok) return resultado;

    const texto = resultado.conteudo ?? '';
    if (!texto) return { ok: false, erro: 'a Agenda não devolveu nada — sessão pode ter expirado' };
    if (texto.trimStart().startsWith('<')) {
      return { ok: false, erro: 'o Sankhya respondeu HTML, não JSON — a sessão da Agenda caiu' };
    }
    return { ok: true, conteudo: texto };
  }

  /**
   * Garante janela criada, logada e com a tela da Agenda montada. Idempotente: se já está
   * pronta, sai na hora.
   */
  async #garantirPronta(): Promise<ResultadoFetch> {
    if (this.#janela && !this.#janela.isDestroyed()) {
      const wc = this.#janela.webContents;
      const pronto = (await wc
        .executeJavaScript(scriptServiceProxyPronto(), true)
        .catch(() => false)) as boolean;
      if (pronto) return { ok: true };
    }

    const segredo = cofre.revelar('sankhya-erp');
    if (!segredo.usuario || !segredo.senha) {
      return {
        ok: false,
        erro: 'sem usuário/senha do Sankhya OM salvos — configure o login do ERP',
      };
    }

    this.#criarJanela();
    const wc = this.#janela!.webContents;

    try {
      await wc.loadURL(ERP_URL);
    } catch (erro) {
      return { ok: false, erro: `não consegui abrir o Sankhya OM: ${String(erro)}` };
    }

    const logou = await this.#logar(wc, segredo.usuario, segredo.senha);
    if (!logou) {
      return {
        ok: false,
        erro: 'login automático da Agenda falhou — confira usuário e senha salvos',
      };
    }

    return this.#abrirTelaAgenda(wc);
  }

  #criarJanela(): void {
    this.destruir();
    this.#janela = criarJanelaOculta(PARTICAO_AGENDA);
    logEvento('agenda-oculta-janela-criada');
  }

  /** Preenche/submete o login web e espera sair da tela de login. */
  async #logar(wc: WebContents, usuario: string, senha: string): Promise<boolean> {
    const submeteu = await preencherESubmeterLogin(wc, usuario, senha);
    if (!submeteu) {
      logEvento('agenda-oculta-sem-tela-de-login');
      return false;
    }
    return this.#esperarAutenticado(wc);
  }

  /** Espera a navegação sair da tela de login (o POST de login redireciona para o workspace). */
  #esperarAutenticado(wc: WebContents): Promise<boolean> {
    return new Promise((resolve) => {
      const inicio = Date.now();
      const intervalo = setInterval(() => {
        if (wc.isDestroyed()) {
          clearInterval(intervalo);
          resolve(false);
          return;
        }
        if (!ehTelaDeLogin(wc.getURL())) {
          clearInterval(intervalo);
          resolve(true);
          return;
        }
        if (Date.now() - inicio > AUTENTICAR_TIMEOUT_MS) {
          clearInterval(intervalo);
          resolve(false);
        }
      }, INTERVALO_MS);
    });
  }

  /**
   * Abre a tela da Agenda pelo workspace e espera o iframe dela expor o `ServiceProxy`.
   *
   * Depois do login a janela está no workspace (`system.jsp`). Setar o hash faz o
   * workspace montar a tela num iframe — o mesmo caminho de um clique de menu, que é o
   * que o servidor exige (carregar o `.xhtml5` direto responde 500). O hash é re-setado a
   * cada tentativa porque o Angular do workspace pode ainda não estar pronto no primeiro tick.
   */
  async #abrirTelaAgenda(wc: WebContents): Promise<ResultadoFetch> {
    const inicio = Date.now();
    while (Date.now() - inicio < TELA_PRONTA_TIMEOUT_MS) {
      if (wc.isDestroyed())
        return { ok: false, erro: 'a janela da Agenda foi fechada durante o carregamento' };

      // Só mexe no hash quando já está no workspace, senão o hash é perdido no redirect.
      if (wc.getURL().startsWith(URL_WORKSPACE)) {
        await wc.executeJavaScript(scriptAbrirTela(), true).catch(() => '');
      }

      const pronto = (await wc
        .executeJavaScript(scriptServiceProxyPronto(), true)
        .catch(() => false)) as boolean;
      if (pronto) {
        logEvento('agenda-oculta-tela-pronta');
        return { ok: true };
      }
      await pausa(INTERVALO_MS);
    }

    // Diagnóstico: o que a janela está exibindo quando o ServiceProxy não veio.
    const diag = await wc
      .executeJavaScript(
        `(() => ({
          url: location.href,
          titulo: document.title,
          temAngular: typeof window.angular !== 'undefined',
          iframes: [...document.querySelectorAll('iframe')].map((f) => f.src).slice(0, 5),
          corpo: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').slice(0, 300),
        }))()`,
        true,
      )
      .catch((e) => ({ erro: String(e) }));
    logEvento('agenda-oculta-tela-diag', diag as Record<string, unknown>);

    return { ok: false, erro: 'a tela da Agenda não terminou de carregar a tempo' };
  }
}

/** Respostas que denunciam sessão caída, para disparar o relogin. */
function sessaoCaiu(conteudo: string): boolean {
  return /Não autorizado|Acesso negado|sess(ã|a)o expirada/i.test(conteudo);
}
