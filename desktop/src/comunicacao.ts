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
import {
  BrowserWindow,
  Menu,
  Notification,
  WebContentsView,
  type ServiceWorkerMain,
  app,
  session,
  shell,
  webContents,
} from 'electron';
import {
  FRACAO_LARGURA_PAINEL_COMUNICACAO,
  ICONE,
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

/** Precisa ser o mesmo canal que `preloadServiceWorker.ts` envia. */
const CANAL_DA_NOTIFICACAO_CLICADA = 'comunicacao:notificacaoClicada';

/** Serviço dono de um endereço — o escopo de um service worker, por exemplo — pela origem. */
function servicoDoEndereco(endereco: string): ServicoComunicacao | undefined {
  try {
    const origem = new URL(endereco).origin;
    return SERVICOS.find((servico) => new URL(SERVICOS_COMUNICACAO[servico].url).origin === origem);
  } catch {
    return undefined;
  }
}

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

/** Texto sem o padrão (nada não lido, ou página ainda carregando) conta como zero. */
function quantidadeNoTexto(padrao: RegExp, texto: string): number {
  const encontrado = padrao.exec(texto);
  return encontrado ? Number(encontrado[1]) : 0;
}

/** Um e-mail não lido como o feed Atom do Gmail o descreve. */
interface MensagemDoFeed {
  id: string;
  autor: string;
  assunto: string;
}

/**
 * Chegando vários e-mails de uma vez (volta de um período offline), mostra alguns e
 * resume o resto numa notificação só, em vez de encher o canto da tela.
 */
const LIMITE_DE_NOTIFICACOES_POR_CONSULTA = 3;

/** Maior código Unicode válido: acima disso `String.fromCodePoint` lança erro. */
const MAIOR_CODIGO_UNICODE = 0x10ffff;

const ENTIDADES_XML: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodificarEntidade(inteira: string, codigo: string): string {
  if (!codigo.startsWith('#')) return ENTIDADES_XML[codigo] ?? inteira;
  const hexadecimal = codigo[1]?.toLowerCase() === 'x';
  const numero = parseInt(codigo.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
  if (Number.isNaN(numero) || numero > MAIOR_CODIGO_UNICODE) return inteira;
  return String.fromCodePoint(numero);
}

function decodificarXml(texto: string): string {
  return texto.replace(/&(#x?[\da-f]+|\w+);/gi, decodificarEntidade);
}

function conteudoDaTag(xml: string, tag: string): string {
  const encontrado = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return encontrado ? decodificarXml(encontrado[1].trim()) : '';
}

/** O `<name>` que existe na entrada é o do remetente (`<author><name>`). */
function mensagensDoFeed(xml: string): MensagemDoFeed[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, entrada]) => ({
      id: conteudoDaTag(entrada, 'id'),
      autor: conteudoDaTag(entrada, 'name'),
      assunto: conteudoDaTag(entrada, 'title'),
    }))
    .filter((mensagem) => mensagem.id);
}

/** O favicon só diz se há não lidas: o contador do botão vira um ponto, sem número. */
function temContagemExata(servico: ServicoComunicacao): boolean {
  return SERVICOS_COMUNICACAO[servico].sinal.origem !== 'favicon';
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
  /** Service workers já com o ouvinte do clique na notificação: um por versão iniciada. */
  readonly #trabalhadoresOuvidos = new WeakSet<ServiceWorkerMain>();
  /** Feed que já falhou: loga a primeira falha, não uma por minuto. */
  readonly #feedsComFalha = new Set<ServicoComunicacao>();
  /** E-mails já conhecidos por serviço: o que não estiver aqui na próxima consulta é novo. */
  readonly #mensagensConhecidas = new Map<ServicoComunicacao, Set<string>>();
  /**
   * Referência forte às notificações na tela: sem ela o coletor de lixo pode levar o
   * objeto e, com ele, o clique que abre o painel.
   */
  readonly #notificacoes = new Set<Notification>();
  readonly #desabilitados = new Set<ServicoComunicacao>(lerServicosDesabilitados());
  #ativo: ServicoComunicacao | null = null;
  #larguraLateral = 0;
  #alturaTopo = 0;

  constructor(janela: BrowserWindow) {
    this.#janela = janela;
    janela.on('focus', () => {
      // O Windows pisca o ícone na barra de tarefas até alguém mandar parar.
      janela.flashFrame(false);
      this.#retomarFocoDoPainel();
    });
    this.#iniciarConsultaDosFeeds();
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
      this.#consultarFeed(servico);
    } else {
      this.#desabilitados.add(servico);
      this.#descarregar(servico);
      logEvento('comunicacao-servico-desabilitado', { servico });
    }
    gravarServicosDesabilitados([...this.#desabilitados]);
    this.#janela.webContents.send('comunicacao:servicos', this.estadoDosServicos());
  }

  /**
   * Fecha a página do serviço: sem ela, nada dele roda nem ocupa memória. O feed também
   * para — a consulta periódica pula serviço desabilitado.
   */
  #descarregar(servico: ServicoComunicacao): void {
    if (this.#ativo === servico) this.ocultar();
    this.#esquecerNaoLidas(servico);
    const painel = this.#paineis.get(servico);
    if (!painel) return;
    this.#paineis.delete(servico);
    this.#janela.contentView.removeChildView(painel);
    painel.webContents.close();
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
    const { url, particao } = SERVICOS_COMUNICACAO[servico];
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
    this.#observarSinalDaPagina(servico, painel);
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

  #observarSinalDaPagina(servico: ServicoComunicacao, painel: WebContentsView): void {
    const { sinal } = SERVICOS_COMUNICACAO[servico];
    if (sinal.origem === 'titulo') {
      painel.webContents.on('page-title-updated', (_e, titulo) =>
        this.#definirNaoLidas(servico, quantidadeNoTexto(sinal.padrao, titulo)),
      );
      return;
    }
    if (sinal.origem === 'favicon') {
      painel.webContents.on('page-favicon-updated', (_e, icones) =>
        this.#definirNaoLidas(servico, icones.some((icone) => sinal.padrao.test(icone)) ? 1 : 0),
      );
      return;
    }
    // Ler um e-mail muda o título: com a página aberta, a consulta não espera o minuto.
    painel.webContents.on('page-title-updated', () => this.#consultarFeed(servico));
  }

  #iniciarConsultaDosFeeds(): void {
    for (const servico of SERVICOS) {
      const { sinal } = SERVICOS_COMUNICACAO[servico];
      if (sinal.origem !== 'feed') continue;
      this.#consultarFeed(servico);
      setInterval(() => this.#consultarFeed(servico), sinal.intervaloMs);
    }
  }

  /** Sem login na sessão o Google devolve a página de entrada, sem `fullcount`: só loga. */
  #consultarFeed(servico: ServicoComunicacao): void {
    const { sinal, particao } = SERVICOS_COMUNICACAO[servico];
    if (sinal.origem !== 'feed' || this.#desabilitados.has(servico)) return;
    this.#prepararParticao(particao);
    void session
      .fromPartition(particao)
      .fetch(sinal.url)
      .then(async (resposta) => {
        const corpo = await resposta.text();
        if (!resposta.ok || !sinal.padrao.test(corpo)) {
          this.#registrarFalhaDoFeed(servico, `status ${resposta.status}`);
          return;
        }
        this.#feedsComFalha.delete(servico);
        this.#notificarMensagensNovas(servico, mensagensDoFeed(corpo));
        this.#definirNaoLidas(servico, quantidadeNoTexto(sinal.padrao, corpo));
      })
      .catch((err: Error) => this.#registrarFalhaDoFeed(servico, err.message));
  }

  /**
   * A primeira consulta só aprende o que já estava na caixa. Com o serviço na tela não há
   * o que avisar: você já está vendo.
   */
  #notificarMensagensNovas(servico: ServicoComunicacao, mensagens: MensagemDoFeed[]): void {
    const conhecidas = this.#mensagensConhecidas.get(servico);
    this.#mensagensConhecidas.set(servico, new Set(mensagens.map((mensagem) => mensagem.id)));
    if (!conhecidas || this.#estaSendoVisto(servico)) return;
    const novas = mensagens.filter((mensagem) => !conhecidas.has(mensagem.id));
    const { rotulo } = SERVICOS_COMUNICACAO[servico];
    for (const { autor, assunto } of novas.slice(0, LIMITE_DE_NOTIFICACOES_POR_CONSULTA)) {
      // O topo da notificação é o nome do app (HUB SNK): o serviço vai no título.
      const titulo = autor ? `${rotulo} · ${autor}` : rotulo;
      this.#mostrarNotificacao(servico, titulo, assunto || '(sem assunto)');
    }
    const restantes = novas.length - LIMITE_DE_NOTIFICACOES_POR_CONSULTA;
    if (restantes > 0) {
      this.#mostrarNotificacao(servico, rotulo, `E mais ${restantes} e-mail(s) novo(s)`);
    }
  }

  /** Sem som: quem toca é a barra, no mesmo aviso que faz o ícone piscar. */
  #mostrarNotificacao(servico: ServicoComunicacao, titulo: string, corpo: string): void {
    if (!Notification.isSupported()) return;
    const notificacao = new Notification({ title: titulo, body: corpo, icon: ICONE, silent: true });
    this.#notificacoes.add(notificacao);
    notificacao.on('click', () => {
      this.#notificacoes.delete(notificacao);
      this.#abrirPelaNotificacao(servico);
    });
    notificacao.on('close', () => this.#notificacoes.delete(notificacao));
    notificacao.show();
    logEvento('comunicacao-notificacao-mostrada', { servico });
  }

  #abrirPelaNotificacao(servico: ServicoComunicacao): void {
    if (this.#janela.isMinimized()) this.#janela.restore();
    this.#janela.show();
    this.#janela.focus();
    if (this.#desabilitados.has(servico) || this.#ativo === servico) return;
    this.#mostrar(servico);
  }

  #registrarFalhaDoFeed(servico: ServicoComunicacao, motivo: string): void {
    if (this.#feedsComFalha.has(servico)) return;
    this.#feedsComFalha.add(servico);
    logEvento('comunicacao-feed-indisponivel', { servico, motivo });
  }

  /**
   * A primeira leitura só mostra o que já estava pendente: tocar ao abrir o app, com
   * e-mails de ontem na caixa, seria alarme falso. No WhatsApp a contagem é de conversas:
   * mensagem nova numa conversa que já estava não lida não aumenta o número.
   */
  #definirNaoLidas(servico: ServicoComunicacao, quantidade: number): void {
    const anterior = this.#naoLidas.get(servico);
    if (quantidade === anterior) return;
    this.#naoLidas.set(servico, quantidade);
    this.#enviarNaoLidas(servico, quantidade);
    const aumentou = anterior !== undefined && quantidade > anterior;
    if (aumentou && !this.#estaSendoVisto(servico)) this.#avisarMensagemNova(servico);
  }

  /** Reabilitar volta à primeira leitura, sem tocar pelo que acumulou no meio tempo. */
  #esquecerNaoLidas(servico: ServicoComunicacao): void {
    this.#mensagensConhecidas.delete(servico);
    if (!this.#naoLidas.delete(servico)) return;
    this.#enviarNaoLidas(servico, 0);
  }

  #enviarNaoLidas(servico: ServicoComunicacao, quantidade: number): void {
    this.#janela.webContents.send('comunicacao:naoLidas', {
      servico,
      quantidade,
      exata: temContagemExata(servico),
    });
  }

  #estaSendoVisto(servico: ServicoComunicacao): boolean {
    return this.#ativo === servico && this.#janela.isFocused();
  }

  #avisarMensagemNova(servico: ServicoComunicacao): void {
    if (SERVICOS_COMUNICACAO[servico].tocarSom) {
      this.#janela.webContents.send('comunicacao:mensagemNova', servico);
    }
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
    this.#ouvirCliquesNasNotificacoesDosServiceWorkers(sessao);
  }

  /**
   * O WhatsApp Web mostra a notificação de mensagem pelo service worker, e só ele fica
   * sabendo do clique. O preload (`preloadServiceWorker.ts`) repassa o clique para cá.
   *
   * O ouvinte entra já na partida do service worker: o clique numa notificação é
   * justamente o que acorda um service worker parado, e o aviso chega logo em seguida.
   */
  #ouvirCliquesNasNotificacoesDosServiceWorkers(sessao: Electron.Session): void {
    sessao.registerPreloadScript({
      type: 'service-worker',
      filePath: join(__dirname, 'preloadServiceWorker.js'),
    });
    sessao.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus !== 'starting' && runningStatus !== 'running') return;
      const trabalhador = sessao.serviceWorkers.getWorkerFromVersionID(versionId);
      if (trabalhador) this.#ouvirCliqueNaNotificacao(trabalhador);
    });
  }

  #ouvirCliqueNaNotificacao(trabalhador: ServiceWorkerMain): void {
    if (this.#trabalhadoresOuvidos.has(trabalhador)) return;
    const servico = servicoDoEndereco(trabalhador.scope);
    if (!servico) return;
    this.#trabalhadoresOuvidos.add(trabalhador);
    trabalhador.ipc.on(CANAL_DA_NOTIFICACAO_CLICADA, () => {
      logEvento('comunicacao-notificacao-do-servico-clicada', { servico });
      this.#abrirPelaNotificacao(servico);
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
      if (this.#focoEstaNumaGuia(painel)) this.ocultar();
    });
  }

  /** Foco dentro da janela, mas fora do painel e da barra: está numa guia. */
  #focoEstaNumaGuia(painel: WebContentsView): boolean {
    if (!this.#janela.isFocused()) return false;
    const focado = webContents.getFocusedWebContents();
    return Boolean(focado) && focado !== painel.webContents && focado !== this.#janela.webContents;
  }

  /**
   * Volta ao HUB SNK vindo de outro programa. O Windows devolve o foco à barra de guias, e
   * não ao painel: sem o foco nele, o clique seguinte numa guia não dispararia o `blur` que
   * o recolhe. Se o clique que reativou a janela já caiu numa guia, recolhe aqui mesmo.
   */
  #retomarFocoDoPainel(): void {
    // A janela avisa que ganhou o foco antes de ele chegar a uma das páginas dela.
    setImmediate(() => {
      const painel = this.#ativo ? this.#paineis.get(this.#ativo) : undefined;
      if (!painel) return;
      if (this.#focoEstaNumaGuia(painel)) {
        this.ocultar();
        return;
      }
      painel.webContents.focus();
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
