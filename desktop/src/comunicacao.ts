/**
 * Painel de comunicação: WhatsApp Web, Gmail e Google Chat abertos por cima das guias,
 * logo abaixo da barra de guias, pelos botões da barra lateral.
 *
 * Cada serviço é uma `WebContentsView` criada no primeiro clique e depois só escondida:
 * o login fica salvo na partição persistente, e a página continua viva em segundo plano
 * para os avisos de mensagem chegarem. Desabilitar o serviço no menu da barra destrói a
 * view — é o que devolve a memória (o WhatsApp Web logado passa de 600 MB).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, Menu, WebContentsView, app, session, shell, webContents } from 'electron';
import {
  FRACAO_LARGURA_PAINEL_COMUNICACAO,
  HOSTS_INTERNOS_COMUNICACAO,
  LARGURA_MINIMA_PAINEL_COMUNICACAO,
  PERMISSOES_COMUNICACAO,
  SERVICOS_COMUNICACAO,
  type ServicoComunicacao,
} from './config';
import { logEvento, origemSemQuery } from './log';
import { ehEnderecoWeb } from './tabs';

export interface EstadoServicoComunicacao {
  servico: ServicoComunicacao;
  habilitado: boolean;
}

const SERVICOS = Object.keys(SERVICOS_COMUNICACAO) as ServicoComunicacao[];

function ehServicoComunicacao(valor: string): valor is ServicoComunicacao {
  return Object.hasOwn(SERVICOS_COMUNICACAO, valor);
}

function ehHostInterno(url: string): boolean {
  try {
    return HOSTS_INTERNOS_COMUNICACAO.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * O WhatsApp Web lê o user agent e recusa ("funciona no Google Chrome 100 ou posterior")
 * quando há um produto entre o `(KHTML, like Gecko)` e o `Chrome/` — é onde o Chromium
 * põe o nome do app, sem os espaços.
 */
function userAgentDeNavegador(padrao: string): string {
  return padrao.replace(/\(KHTML, like Gecko\).*?Chrome\//, '(KHTML, like Gecko) Chrome/');
}

/** Título sem o padrão (nada não lido, ou página ainda carregando) conta como zero. */
function quantidadeNaoLidas(padrao: RegExp, titulo: string): number {
  const encontrado = padrao.exec(titulo);
  return encontrado ? Number(encontrado[1]) : 0;
}

/** Onde a escolha de botões da barra lateral sobrevive ao fechamento do aplicativo. */
function arquivoServicos(): string {
  return join(app.getPath('userData'), 'comunicacao.json');
}

function lerServicosDesabilitados(): ServicoComunicacao[] {
  try {
    const dados = JSON.parse(readFileSync(arquivoServicos(), 'utf8')) as {
      desabilitados?: unknown;
    };
    return Array.isArray(dados.desabilitados)
      ? dados.desabilitados.filter(
          (servico): servico is ServicoComunicacao =>
            typeof servico === 'string' && ehServicoComunicacao(servico),
        )
      : [];
  } catch {
    // Primeira execução, ou arquivo corrompido: todos os serviços habilitados.
    return [];
  }
}

function gravarServicosDesabilitados(desabilitados: ServicoComunicacao[]): void {
  try {
    writeFileSync(arquivoServicos(), JSON.stringify({ desabilitados }, null, 2), 'utf8');
  } catch (err) {
    // Preferência de tela não vale travar o aplicativo: a sessão atual respeita a escolha,
    // a próxima abre com todos os serviços.
    logEvento('comunicacao-servicos-nao-gravados', { erro: (err as Error).message });
  }
}

export class GerenciadorComunicacao {
  readonly #janela: BrowserWindow;
  readonly #paineis = new Map<ServicoComunicacao, WebContentsView>();
  readonly #naoLidas = new Map<ServicoComunicacao, number>();
  readonly #particoesConfiguradas = new Set<string>();
  readonly #desabilitados = new Set<ServicoComunicacao>(lerServicosDesabilitados());
  #ativo: ServicoComunicacao | null = null;
  #larguraLateral = 0;
  #alturaTopo = 0;

  constructor(janela: BrowserWindow) {
    this.#janela = janela;
    // O Windows pisca o ícone na barra de tarefas até alguém mandar parar.
    janela.on('focus', () => janela.flashFrame(false));
  }

  /** Clicar no serviço aberto o esconde; clicar em outro troca um pelo outro. */
  alternar(servico: string): boolean {
    if (!ehServicoComunicacao(servico) || this.#desabilitados.has(servico)) return false;
    if (this.#ativo === servico) {
      this.ocultar();
      return true;
    }
    this.#mostrar(servico);
    return true;
  }

  ocultar(): void {
    if (!this.#ativo) return;
    this.#paineis.get(this.#ativo)?.setVisible(false);
    this.#definirAtivo(null);
  }

  estadoDosServicos(): EstadoServicoComunicacao[] {
    return SERVICOS.map((servico) => ({ servico, habilitado: !this.#desabilitados.has(servico) }));
  }

  /** Menu da engrenagem, montado com o estado atual — quem o desenha é o `MenuFlutuante`. */
  menuDeServicos(): Menu {
    return Menu.buildFromTemplate([
      {
        label: 'Botões da barra',
        submenu: SERVICOS.map((servico) => ({
          label: SERVICOS_COMUNICACAO[servico].rotulo,
          type: 'checkbox' as const,
          checked: !this.#desabilitados.has(servico),
          click: () => this.#alternarHabilitado(servico),
        })),
      },
    ]);
  }

  definirLarguraLateral(largura: number): void {
    this.#larguraLateral = Math.max(0, Math.round(largura || 0));
    this.reposicionar();
  }

  definirAlturaTopo(altura: number): void {
    this.#alturaTopo = Math.max(0, Math.round(altura || 0));
    this.reposicionar();
  }

  reposicionar(): void {
    const limites = this.#limitesDoPainel();
    for (const painel of this.#paineis.values()) painel.setBounds(limites);
  }

  #alternarHabilitado(servico: ServicoComunicacao): void {
    if (this.#desabilitados.delete(servico)) {
      logEvento('comunicacao-servico-habilitado', { servico });
    } else {
      this.#desabilitados.add(servico);
      this.#descarregar(servico);
      logEvento('comunicacao-servico-desabilitado', { servico });
    }
    gravarServicosDesabilitados([...this.#desabilitados]);
    this.#janela.webContents.send('comunicacao:servicos', this.estadoDosServicos());
  }

  /** Fecha a página do serviço: sem ela, nada dele roda nem ocupa memória. */
  #descarregar(servico: ServicoComunicacao): void {
    if (this.#ativo === servico) this.ocultar();
    const painel = this.#paineis.get(servico);
    if (!painel) return;
    this.#paineis.delete(servico);
    this.#janela.contentView.removeChildView(painel);
    painel.webContents.close();
    this.#definirNaoLidas(servico, 0);
  }

  #mostrar(servico: ServicoComunicacao): void {
    if (this.#ativo) this.#paineis.get(this.#ativo)?.setVisible(false);
    const painel = this.#paineis.get(servico) ?? this.#criarPainel(servico);
    // Readicionar leva a view para o topo: uma guia de cliente aberta depois do painel
    // ficaria por cima dele.
    this.#janela.contentView.addChildView(painel);
    painel.setBounds(this.#limitesDoPainel());
    painel.setVisible(true);
    // Com o foco no painel, o clique numa guia dispara o `blur` que o esconde.
    painel.webContents.focus();
    this.#definirAtivo(servico);
  }

  #criarPainel(servico: ServicoComunicacao): WebContentsView {
    const { url, particao, padraoNaoLidas } = SERVICOS_COMUNICACAO[servico];
    this.#prepararParticao(particao);
    const painel = new WebContentsView({
      webPreferences: {
        partition: particao,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        // Nenhum preload: zero bridge para conteúdo de fora, como nas guias remotas.
      },
    });
    painel.webContents.setWindowOpenHandler(({ url: alvo }) =>
      this.#tratarJanelaNova(servico, painel, alvo),
    );
    painel.webContents.on('blur', () => this.#ocultarSeOFocoFoiParaUmaGuia(painel));
    if (padraoNaoLidas) {
      painel.webContents.on('page-title-updated', (_e, titulo) =>
        this.#definirNaoLidas(servico, quantidadeNaoLidas(padraoNaoLidas, titulo)),
      );
    }
    painel.webContents.on('did-fail-load', (_e, codigo, descricao, alvo) => {
      logEvento('comunicacao-falha-carregar', {
        servico,
        codigo,
        descricao,
        url: origemSemQuery(alvo),
      });
    });
    painel.webContents.loadURL(url);
    this.#paineis.set(servico, painel);
    logEvento('comunicacao-painel-criado', { servico });
    return painel;
  }

  /**
   * A contagem é de conversas: mensagem nova numa conversa que já estava não lida não
   * aumenta o número, e por isso não toca de novo.
   */
  #definirNaoLidas(servico: ServicoComunicacao, quantidade: number): void {
    const anterior = this.#naoLidas.get(servico) ?? 0;
    if (quantidade === anterior) return;
    this.#naoLidas.set(servico, quantidade);
    this.#janela.webContents.send('comunicacao:naoLidas', { servico, quantidade });
    if (quantidade > anterior && !this.#estaSendoVisto(servico)) this.#avisarMensagemNova(servico);
  }

  #estaSendoVisto(servico: ServicoComunicacao): boolean {
    return this.#ativo === servico && this.#janela.isFocused();
  }

  #avisarMensagemNova(servico: ServicoComunicacao): void {
    this.#janela.webContents.send('comunicacao:mensagemNova', servico);
    if (!this.#janela.isFocused()) this.#janela.flashFrame(true);
    logEvento('comunicacao-mensagem-nova', { servico });
  }

  /** Gmail e Chat dividem a partição: a sessão é configurada uma vez só. */
  #prepararParticao(particao: string): void {
    if (this.#particoesConfiguradas.has(particao)) return;
    this.#particoesConfiguradas.add(particao);
    const sessao = session.fromPartition(particao);
    sessao.setUserAgent(userAgentDeNavegador(sessao.getUserAgent()));
    sessao.setPermissionRequestHandler((_wc, permissao, responder) => {
      const concedida = PERMISSOES_COMUNICACAO.has(permissao);
      if (!concedida) logEvento('comunicacao-permissao-negada', { particao, permissao });
      responder(concedida);
    });
  }

  /**
   * Login do Google e páginas do próprio serviço continuam no painel. Link de mensagem ou
   * de e-mail abre no navegador do sistema: uma janela filha aqui ficaria perdida atrás da
   * janela principal.
   */
  #tratarJanelaNova(
    servico: ServicoComunicacao,
    painel: WebContentsView,
    alvo: string,
  ): Electron.WindowOpenHandlerResponse {
    if (ehHostInterno(alvo)) {
      logEvento('comunicacao-janela-no-painel', { servico, alvo: origemSemQuery(alvo) });
      void painel.webContents.loadURL(alvo);
      return { action: 'deny' };
    }
    if (!ehEnderecoWeb(alvo)) {
      logEvento('comunicacao-link-recusado', { servico, alvo: origemSemQuery(alvo) });
      return { action: 'deny' };
    }
    logEvento('comunicacao-link-externo', { servico, alvo: origemSemQuery(alvo) });
    void shell.openExternal(alvo);
    return { action: 'deny' };
  }

  /**
   * Clique fora do painel. Numa guia (outra `WebContentsView`) o processo principal não
   * enxerga o mouse, só a troca de foco. Foco que foi para a própria janela (barra lateral
   * ou de guias) fica com o `renderer.js`, que sabe se o clique foi num botão da barra; e
   * janela sem foco (Alt+Tab) não é clique fora.
   */
  #ocultarSeOFocoFoiParaUmaGuia(painel: WebContentsView): void {
    // O `blur` chega antes de o destino receber o foco: só no próximo tick dá para saber
    // quem ficou com ele.
    setImmediate(() => {
      if (!this.#ativo || this.#paineis.get(this.#ativo) !== painel) return;
      if (!this.#janela.isFocused()) return;
      const focado = webContents.getFocusedWebContents();
      if (!focado || focado === painel.webContents || focado === this.#janela.webContents) return;
      this.ocultar();
    });
  }

  /** Abaixo da barra de guias, que continua visível com o painel aberto. */
  #limitesDoPainel(): Electron.Rectangle {
    const [largura, altura] = this.#janela.getContentSize();
    const disponivel = Math.max(0, largura - this.#larguraLateral);
    const fracaoDaTela = Math.round(largura * FRACAO_LARGURA_PAINEL_COMUNICACAO);
    return {
      x: this.#larguraLateral,
      y: this.#alturaTopo,
      width: Math.min(disponivel, Math.max(LARGURA_MINIMA_PAINEL_COMUNICACAO, fracaoDaTela)),
      height: Math.max(0, altura - this.#alturaTopo),
    };
  }

  #definirAtivo(servico: ServicoComunicacao | null): void {
    this.#ativo = servico;
    this.#janela.webContents.send('comunicacao:ativo', servico);
    logEvento('comunicacao-ativo', { servico });
  }
}
