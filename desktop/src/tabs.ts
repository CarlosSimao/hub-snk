/**
 * Gerenciador de abas do shell: `WebContentsView` para Hub/ERP/Experience (fixas), uma
 * por base de cliente aberta e uma por guia avulsa do `+` (dinâmicas), política de pop-up
 * (lista branca de SSO + origin de base cadastrada vira aba própria isolada) e download.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, WebContentsView, app, session, shell } from 'electron';
import {
  DOMINIOS_POPUP_PERMITIDOS,
  HUB_URL,
  ICONE,
  PARTICAO_AVULSA,
  URL_INICIAL_AVULSA,
} from './config';
import { urlDoTextoDigitado } from './enderecoDigitado';
import { logEvento, origemSemQuery } from './log';
import { aguardarCampoDeSenha, tentarAutofill } from './autofill';
import { autoLoginSankhya, podeTentar } from './autoLoginSankhya';
import * as cofre from './cofreCredenciais';
import { prepararParticaoParaRuffle } from './ruffle';
import { garantirToken } from './tokenStore';

export type TabId = 'hub' | 'erp' | 'experience';

/** Uma base de cliente cadastrada — o que o shell precisa pra abrir/nomear/autofillar a aba. */
export interface InfoBaseCliente {
  clienteId: string;
  baseId: string;
  clienteNome: string;
  /** `tipo` da base no cadastro: `producao`, `teste` ou `outro`. */
  ambiente: string;
  usuario: string;
  temSenha: boolean;
}

interface LinkDoCadastro {
  nome: string;
  url: string;
}

/** O pedaço de `GET /api/clientes` que o shell usa. A senha é descartada na leitura. */
interface ClienteDoCadastro {
  id: string;
  nome: string;
  bases?: Array<{ id: string; url: string; tipo: string; usuario: string; senha?: string }>;
  links?: LinkDoCadastro[];
  projetos?: Array<{ nome: string; links?: LinkDoCadastro[] }>;
  repositorios?: Array<{ url: string }>;
}

type DestinoDeLink = 'hub' | 'navegador-padrao';

/**
 * O que vale se a configuração não puder ser lida — o mesmo padrão do backend, que é o
 * que o HUB SNK já fazia antes de a escolha existir.
 *
 * Espelha `destinoDosLinks` de `src/tipos.ts`: uma escolha só, para todo link clicável
 * do cadastro — bases, repositório, links gerais e de projeto.
 */
const DESTINO_DOS_LINKS_PADRAO: DestinoDeLink = 'hub';

/** Um link cadastrado, reconhecido pela URL exata quando o painel o abre. */
interface LinkCadastrado {
  tipo: 'linksGerais' | 'linksDeProjeto' | 'repositorio';
  /** Título da guia, quando o link abre no HUB SNK. */
  titulo: string;
}

/** O que o shell usa da configuração global do backend. */
interface ConfiguracaoDoHub {
  destinoDosLinks?: DestinoDeLink;
  terceiro?: boolean;
}

async function lerConfiguracaoDoHub(): Promise<ConfiguracaoDoHub> {
  const resposta = await fetch(`${HUB_URL}/api/configuracao`, {
    headers: { 'x-hub-token': garantirToken() },
    signal: AbortSignal.timeout(5000),
  });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return (await resposta.json()) as ConfiguracaoDoHub;
}

async function lerDestinoDosLinks(): Promise<DestinoDeLink> {
  try {
    const { destinoDosLinks } = await lerConfiguracaoDoHub();
    return destinoDosLinks ?? DESTINO_DOS_LINKS_PADRAO;
  } catch (err) {
    logEvento('destino-dos-links-falhou-ler', { erro: String(err) });
    return DESTINO_DOS_LINKS_PADRAO;
  }
}

/** `null` quando a configuração não pôde ser lida: quem chama mantém o que estava valendo. */
async function lerAcessoDeTerceiro(): Promise<boolean | null> {
  try {
    const { terceiro } = await lerConfiguracaoDoHub();
    return terceiro === true;
  } catch (err) {
    logEvento('acesso-de-terceiro-falhou-ler', { erro: String(err) });
    return null;
  }
}

/** Guias que só funcionam com as credenciais do Sankhya: somem no acesso de terceiro. */
const GUIAS_DO_SANKHYA: ReadonlySet<string> = new Set<TabId>(['erp', 'experience']);

/** A mesma URL escrita de jeitos diferentes (barra final, maiúsculas no host) casa. */
function urlNormalizada(url: string): string {
  try {
    return new URL(url).href;
  } catch {
    return '';
  }
}

/**
 * O botão "Monitor de log" abre a URL do JSP com o marcador `#__hubmonitor` no hash —
 * invisível para o servidor e para o usuário, mas suficiente para o shell saber que é o
 * monitor: a aba da base navega para o JSP e o autofill de login não dispara.
 */
function separarMarcadorDoMonitor(alvo: string): { alvo: string; ehMonitor: boolean } {
  try {
    const url = new URL(alvo);
    if (!url.hash.includes('__hubmonitor')) return { alvo, ehMonitor: false };
    url.hash = '';
    return { alvo: url.href, ehMonitor: true };
  } catch {
    return { alvo, ehMonitor: false };
  }
}

export interface AbaClienteInfo {
  origin: string;
  titulo: string;
  visivel: boolean;
}

/** Guia avulsa do `+`: o que a barra precisa para a guia e para a barra de endereço. */
export interface AbaAvulsaInfo {
  id: string;
  titulo: string;
  url: string;
  podeVoltar: boolean;
  podeAvancar: boolean;
  visivel: boolean;
}

/** Id das guias avulsas: nunca colide com `hub`/`erp`/`experience` nem com um origin. */
const PREFIXO_AVULSA = 'avulsa:';

/** Título da guia avulsa até a página informar o dela. */
const TITULO_AVULSA_PADRAO = 'Nova guia';

export interface GuiaInfo {
  id: string;
  rotulo: string;
  visivel: boolean;
}

function origemPermitida(url: string, lista: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    return lista.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Protocolo + host + porta; vazio para URL inválida. */
function origemDe(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function ehEnderecoWeb(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** `localhost`, `127.x` ou `[::1]` — o que roda nesta máquina, como o Sankhya local. */
function origemLocal(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

function registrarDownload(sessaoRotulo: string, janelasFilhas: Set<BrowserWindow>) {
  return (_evt: unknown, item: Electron.DownloadItem, webContentsOrigem: Electron.WebContents) => {
    logEvento('download-iniciado', {
      sessao: sessaoRotulo,
      nome: item.getFilename(),
      mime: item.getMimeType(),
      urlOrigem: origemSemQuery(item.getURL()),
      bytesTotais: item.getTotalBytes(),
    });
    item.once('done', (_e2, estado) => {
      logEvento('download-concluido', { sessao: sessaoRotulo, nome: item.getFilename(), estado });
      // UX real observada na PoC: um pop-up aberto só para servir um download não
      // navega para lugar nenhum depois — fica em branco até o usuário fechar na mão.
      for (const filha of janelasFilhas) {
        if (!filha.isDestroyed() && filha.webContents === webContentsOrigem) {
          filha.close();
          break;
        }
      }
    });
  };
}

/**
 * Base cadastrada em `https` cujo servidor rebaixa para `http` no redirect (caso real:
 * `https://x.sankhyacloud.com.br/mge` -> 302 -> `http://x.../mge/`). A página ficava em
 * `http`, mas o próprio Sankhya responde `upgrade-insecure-requests`, então as chamadas de
 * login saíam em `https` — outra origem, e o login ficava carregando para sempre. O Chrome
 * não mostra o problema porque sobe para `https` sozinho; o Electron não, por isso a
 * partição da base faz o mesmo aqui. Só pedido sem porta explícita (a 80 padrão) é
 * promovido: `http` numa porta própria é outro serviço, não um rebaixamento.
 */
function manterHttpsDaBase(particao: string, origin: string): void {
  const base = new URL(origin);
  if (base.protocol !== 'https:') return;
  session
    .fromPartition(particao)
    .webRequest.onBeforeRequest({ urls: [`http://${base.hostname}/*`] }, (detalhes, responder) => {
      const pedido = new URL(detalhes.url);
      if (pedido.port) {
        responder({});
        return;
      }
      const destino = `${origin}${pedido.pathname}${pedido.search}${pedido.hash}`;
      logEvento('aba-cliente-https-mantido', { de: origemSemQuery(detalhes.url) });
      responder({ redirectURL: destino });
    });
}

function tituloBase(info: InfoBaseCliente): string {
  if (info.ambiente && info.ambiente !== 'producao' && info.ambiente !== 'outro') {
    const rotulo = info.ambiente === 'homologacao' ? 'homologação' : info.ambiente;
    return `${info.clienteNome} · ${rotulo}`;
  }
  return info.clienteNome;
}

/** O que a barra escreve em cada guia de cima — igual ao HTML de `index.html`. */
const ROTULO_GUIA: Record<TabId, string> = {
  hub: 'Painel',
  erp: 'SankhyaOm',
  experience: 'Experience',
};

/** Onde a escolha de guias escondidas sobrevive ao fechamento do aplicativo. */
function arquivoGuias(): string {
  return join(app.getPath('userData'), 'guias.json');
}

function lerGuiasEscondidas(): string[] {
  try {
    const dados = JSON.parse(readFileSync(arquivoGuias(), 'utf8')) as { escondidas?: unknown };
    return Array.isArray(dados.escondidas)
      ? dados.escondidas.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    // Primeira execucao, ou arquivo corrompido: todas as guias visiveis.
    return [];
  }
}

function gravarGuiasEscondidas(escondidas: string[]): void {
  try {
    writeFileSync(arquivoGuias(), JSON.stringify({ escondidas }, null, 2), 'utf8');
  } catch (err) {
    // Preferencia de tela nao vale travar o aplicativo: a sessao atual respeita a
    // escolha, a proxima abre com tudo visivel.
    logEvento('guias-nao-gravadas', { erro: (err as Error).message });
  }
}

/** Quem abre no painel de comunicação o link de conversa que o Painel pede. */
export interface PainelDeComunicacao {
  /** `false`: o endereço não é de um serviço habilitado, e segue o caminho normal. */
  abrirEndereco(url: string): boolean;
}

export class TabManager {
  readonly #janela: BrowserWindow;
  readonly #abas = new Map<string, WebContentsView>();
  readonly #abasClientes = new Map<string, AbaClienteInfo>();
  /** id -> título atual; URL e histórico são lidos do `webContents` na hora de emitir. */
  readonly #abasAvulsas = new Map<string, string>();
  #proximaAvulsa = 1;
  readonly #janelasFilhas = new Set<BrowserWindow>();
  readonly #particoesComDownload = new Set<string>();
  /** origin (protocolo+host+porta) -> base cadastrada. Precisa ser exato: duas bases do
   * mesmo cliente podem compartilhar host e diferir só na porta (caso real: prod/teste
   * do mesmo cliente em portas distintas), com usuário/senha diferentes. */
  #basesPorOrigin = new Map<string, InfoBaseCliente>();
  /** URL normalizada -> link geral ou de projeto cadastrado. */
  #linksPorUrl = new Map<string, LinkCadastrado>();
  #abaAtiva = 'hub';
  #alturaTopo = 96;
  /** Largura da barra lateral de comunicação, que empurra as guias para a direita. */
  #larguraLateral = 0;
  /**
   * Guias que o usuario escondeu da barra.
   *
   * Esconder NAO fecha: a `WebContentsView` continua carregada, entao trazer a guia de
   * volta e' instantaneo e nao perde o que estava na tela (formulario pela metade, tela
   * do ERP aberta no lugar certo). E' o contrario de fechar uma aba de cliente.
   */
  readonly #escondidas = new Set<string>();
  /**
   * Acesso de terceiro, lido da configuração do backend. Diferente de esconder, a guia
   * bloqueada não volta por atalho, menu nem clique: some da barra até o acesso mudar.
   */
  #terceiro = false;
  #aoMudarGuias: (() => void) | null = null;
  #aoTrocarGuiaAtiva: (() => void) | null = null;
  #painelDeComunicacao: PainelDeComunicacao | null = null;

  constructor(janela: BrowserWindow) {
    this.#janela = janela;
    // Sessão padrão: onde as abas de cliente (partição própria por origin) e a
    // navegação de pop-up defensivamente caem — ver comentário em criarAbaPrincipal.
    session.defaultSession.on('will-download', registrarDownload('default', this.#janelasFilhas));
  }

  /**
   * Um listener por partição. As três guias principais dividem a mesma, e a sessão de uma
   * base reaberta é a mesma de antes: registrar a cada guia repetia cada download no log.
   */
  #registrarDownloadsDaParticao(particao: string): void {
    if (this.#particoesComDownload.has(particao)) return;
    this.#particoesComDownload.add(particao);
    session
      .fromPartition(particao)
      .on('will-download', registrarDownload(particao, this.#janelasFilhas));
  }

  aba(id: TabId): WebContentsView | undefined {
    return this.#abas.get(id);
  }

  /** A guia que está na tela; nenhuma quando todas foram escondidas. */
  viewAtiva(): WebContentsView | undefined {
    return this.#abas.get(this.#abaAtiva);
  }

  /**
   * Guia erp/experience caiu sozinha numa tela de login (sessão expirada, cookie
   * limpo, primeiro boot) e há credencial salva: tenta logar sem pedir nada ao
   * usuário. A URL só denuncia o login da Experience; o SankhyaOm pede a senha na
   * própria `/mge/`, então sem "login" na URL a prova é um campo de senha na tela.
   */
  async #tentarAutoLoginSankhya(id: TabId, view: WebContentsView): Promise<void> {
    if (id !== 'erp' && id !== 'experience') return;
    if (this.#terceiro) return;
    const sistema: cofre.Sistema = id === 'erp' ? 'sankhya-erp' : 'sankhya-experience';
    if (!cofre.status(sistema).definido) return;
    if (!podeTentar(sistema)) return;

    const telaDeLogin =
      /login|signin/i.test(view.webContents.getURL()) ||
      (await aguardarCampoDeSenha(view.webContents));
    // Reconfere: outro `did-finish-load` pode ter disparado o login durante a espera.
    if (!telaDeLogin || !podeTentar(sistema)) return;
    void autoLoginSankhya(this, sistema);
  }

  /**
   * A aba de uma base de cliente, pelo origin.
   *
   * Só devolve se o origin for de uma aba de cliente ABERTA — nunca uma guia principal
   * nem um origin qualquer. É o que impede o backend de pedir uma execução de script em
   * um destino que não seja uma base cadastrada e já logada pelo usuário.
   */
  abaCliente(origin: string): WebContentsView | undefined {
    if (!this.#abasClientes.has(origin)) return undefined;
    return this.#abas.get(origin);
  }

  abasClientesAbertas(): AbaClienteInfo[] {
    return [...this.#abasClientes.values()].map((aba) => ({
      ...aba,
      visivel: !this.#escondidas.has(aba.origin),
    }));
  }

  criarAbaPrincipal(id: TabId, url: string, particao: string): void {
    const view = new WebContentsView({
      webPreferences: {
        partition: particao,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        // O som das notificações toca sem clique nenhum antes; sem isto, o Chromium cala o
        // áudio até o primeiro gesto do usuário na guia. Só no Painel: o ERP e a Experience
        // seguem com a política padrão.
        autoplayPolicy: id === 'hub' ? 'no-user-gesture-required' : undefined,
        // Nenhum preload nas abas remotas: zero bridge para conteúdo de fora. A exceção é
        // o do Ruffle, registrado na sessão só quando ligado, que não expõe nada à página;
        // sem esta opção ele não chegaria aos iframes, onde ficam as telas do Sankhya.
        nodeIntegrationInSubFrames: true,
      },
    });
    this.#registrarDownloadsDaParticao(particao);
    prepararParticaoParaRuffle(particao);
    // Diagnóstico das abas remotas: sem isto, um erro de JS dentro da página do Sankhya
    // só aparece como caixa de alerta na tela do usuário, sem rastro nenhum de onde veio.
    // Só `error` (level 3) — `warning` do Sankhya é ruidoso demais para valer log.
    view.webContents.on('console-message', (_e, nivel, mensagem, linha, origem) => {
      if (nivel < 3) return;
      logEvento('aba-erro-console', { id, mensagem, linha, origem: origemSemQuery(origem) });
    });

    view.webContents.on('did-fail-load', (_e, code, desc, url2) => {
      logEvento('aba-falha-carregar', { id, code, desc, url: url2 });
    });
    view.webContents.on('did-finish-load', () => {
      logEvento('aba-carregada', { id, url: origemSemQuery(view.webContents.getURL()) });
      // O painel recarrega ao salvar os acessos: é quando o Terceiro pode ter mudado.
      if (id === 'hub') void this.atualizarAcessoDeTerceiro();
      void this.#tentarAutoLoginSankhya(id, view);
    });
    view.webContents.setWindowOpenHandler(({ url: alvo }) => {
      let origin = '';
      try {
        origin = new URL(alvo).origin;
      } catch {
        /* URL inválida cai no fluxo de negação padrão abaixo */
      }
      // Endereço da própria máquina (o Sankhya local em localhost:8080/mge, o console do
      // WildFly na 9990) vira aba do app, isolada como uma base de cliente. Antes caía
      // na lista de pop-ups, que não tem `localhost`, e o clique morria em silêncio. O
      // próprio hub fica de fora: abrir o painel dentro dele mesmo não faz sentido.
      if (id === 'hub' && origin && origemLocal(origin) && origin !== new URL(HUB_URL).origin) {
        logEvento('link-local-solicitado', { alvo: origemSemQuery(alvo) });
        this.abrirAbaCliente(
          origin,
          alvo,
          {
            clienteId: '',
            baseId: '',
            clienteNome: `Local · ${new URL(origin).host}`,
            ambiente: 'outro',
            usuario: '',
            temSenha: false,
          },
          { autofill: false },
        );
        return { action: 'deny' };
      }
      if (id === 'hub' && origin === new URL(HUB_URL).origin) {
        // Janela do próprio painel, como o log ao vivo de uma base local (`log.html`):
        // mesma origem, então mesma partição e nenhum preload.
        return this.#permitirJanelaFilha(id, alvo, particao);
      }
      if (id === 'hub' && this.#painelDeComunicacao?.abrirEndereco(alvo)) {
        // Conversa do WhatsApp ou e-mail novo no Gmail, pedidos pelo contato.
        return { action: 'deny' };
      }
      if (id === 'hub') {
        // Base, link geral, link de projeto ou link qualquer (repositório no GitHub,
        // página de release): quem decide é o cadastro e a configuração de abertura de
        // links, que são lidos na hora — por isso fora deste handler, que é síncrono.
        void this.#abrirLinkDoPainel(alvo);
        return { action: 'deny' };
      }
      const permitido = origemPermitida(alvo, DOMINIOS_POPUP_PERMITIDOS);
      logEvento('popup-solicitado', { id, alvo: origemSemQuery(alvo), permitido });
      if (!permitido) return { action: 'deny' };
      return this.#permitirJanelaFilha(id, alvo, particao);
    });
    if (id === 'hub') {
      // Link sem `target` navegaria a própria guia do painel para fora dele, sem caminho
      // de volta: o destino abre no navegador do sistema e o painel fica onde está.
      view.webContents.on('will-navigate', (evento, destino) => {
        const origemDoDestino = origemDe(destino);
        if (origemDoDestino === new URL(HUB_URL).origin) return;
        evento.preventDefault();
        void this.#abrirLinkDoPainel(destino);
      });
    }
    view.webContents.loadURL(url);
    this.#janela.contentView.addChildView(view);
    this.#abas.set(id, view);
  }

  /**
   * Pop-up autorizado vira janela filha na mesma partição da guia que o abriu, sem
   * preload. A referência forte evita que o Electron colete a janela (GC) antes de a
   * navegação ou o download terminar — aviso da documentação do Electron, reproduzido
   * na PoC com um download real.
   */
  #permitirJanelaFilha(
    id: string,
    alvo: string,
    particao: string,
  ): Electron.WindowOpenHandlerResponse {
    return {
      action: 'allow',
      createWindow: (options) => {
        const filha = new BrowserWindow({
          ...options,
          icon: ICONE,
          webPreferences: {
            ...options.webPreferences,
            partition: particao,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            preload: undefined,
            // Tela do Sankhya aberta em janela própria também recebe o Ruffle.
            nodeIntegrationInSubFrames: true,
          },
        });
        this.#janelasFilhas.add(filha);
        filha.on('closed', () => this.#janelasFilhas.delete(filha));
        // A janela filha herda a política de quem a abriu: sem isto, o `window.open`
        // dela cairia no padrão do Electron e abriria qualquer endereço numa janela
        // nova, sem restrição nenhuma.
        filha.webContents.setWindowOpenHandler(({ url: destino }) =>
          this.#popupDeJanelaFilha(id, destino, particao),
        );
        logEvento('popup-aberto-janela-filha', { id, alvo: origemSemQuery(alvo) });
        return filha.webContents;
      },
    };
  }

  #popupDeJanelaFilha(
    id: string,
    destino: string,
    particao: string,
  ): Electron.WindowOpenHandlerResponse {
    if (id === 'hub') {
      void this.#abrirLinkDoPainel(destino);
      return { action: 'deny' };
    }
    const permitido = origemPermitida(destino, DOMINIOS_POPUP_PERMITIDOS);
    logEvento('popup-de-janela-filha', { id, alvo: origemSemQuery(destino), permitido });
    return permitido ? this.#permitirJanelaFilha(id, destino, particao) : { action: 'deny' };
  }

  /**
   * Link aberto a partir do painel. Relê o cadastro (a base ou o link pode ter sido
   * cadastrado depois do boot) e a escolha única de destino dos links, e decide:
   *
   *  - link geral, de projeto ou de repositório, pela URL exata: guia do HUB SNK ou
   *    navegador padrão. A URL exata vale mais que a origem de uma base, para um link
   *    que aponta para uma tela da base seguir a mesma escolha;
   *  - base, pela origem: guia com o login preenchido ou navegador padrão;
   *  - qualquer outro endereço: navegador padrão.
   */
  async #abrirLinkDoPainel(alvo: string): Promise<void> {
    const [destinoDosLinks] = await Promise.all([lerDestinoDosLinks(), this.carregarCadastro()]);
    const origin = origemDe(alvo);

    const link = this.#linksPorUrl.get(urlNormalizada(alvo));
    if (link) {
      logEvento('link-cadastrado-solicitado', {
        tipo: link.tipo,
        destino: destinoDosLinks,
        alvo: origemSemQuery(alvo),
      });
      if (destinoDosLinks === 'hub') {
        this.#abrirLinkNoHub(origin, alvo, link.titulo);
        return;
      }
      await this.#abrirNoNavegadorPadrao(alvo);
      return;
    }

    const infoBase = this.#basesPorOrigin.get(origin);
    if (infoBase) {
      const monitor = separarMarcadorDoMonitor(alvo);
      logEvento('link-cliente-solicitado', {
        destino: destinoDosLinks,
        alvo: origemSemQuery(monitor.alvo),
        monitor: monitor.ehMonitor,
      });
      // O monitor de log é da base, mas não é login: abre sempre na guia dela.
      if (destinoDosLinks === 'hub' || monitor.ehMonitor) {
        this.abrirAbaCliente(
          origin,
          monitor.alvo,
          infoBase,
          monitor.ehMonitor ? { autofill: false, forcarUrl: true } : {},
        );
        return;
      }
      await this.#abrirNoNavegadorPadrao(alvo);
      return;
    }

    await this.#abrirNoNavegadorPadrao(alvo);
  }

  /**
   * Link geral ou de projeto numa guia do HUB SNK, isolada por origem e sem autofill.
   * Mesma origem de uma guia já aberta (a da base, por exemplo) navega aquela guia
   * até o endereço do link, em vez de só trazê-la para a frente.
   */
  #abrirLinkNoHub(origin: string, alvo: string, titulo: string): void {
    if (!origin) return;
    this.abrirAbaCliente(
      origin,
      alvo,
      {
        clienteId: '',
        baseId: '',
        clienteNome: titulo,
        ambiente: 'outro',
        usuario: '',
        temSenha: false,
      },
      { autofill: false, forcarUrl: true },
    );
  }

  /**
   * Só http/https: `file:` ou esquema de aplicativo vindo de um link cadastrado não
   * pode virar execução na máquina.
   */
  async #abrirNoNavegadorPadrao(alvo: string): Promise<void> {
    if (!ehEnderecoWeb(alvo)) {
      logEvento('link-externo-recusado', { alvo: origemSemQuery(alvo) });
      return;
    }
    logEvento('link-externo-aberto', { alvo: origemSemQuery(alvo) });
    await shell.openExternal(alvo);
  }

  mostrar(id: string): boolean {
    if (!this.#abas.has(id) || this.guiaBloqueada(id)) return false;
    // Abrir de novo uma guia escondida (por atalho ou pelo cartao do cliente) tambem a
    // devolve para a barra. Assim nunca existe conteudo ativo sem guia correspondente.
    if (this.#escondidas.delete(id)) {
      this.#gravarGuiasEscondidas();
      this.#emitirGuias();
    }
    const trocou = this.#abaAtiva !== id;
    this.#abaAtiva = id;
    for (const [outroId, view] of this.#abas.entries()) {
      view.setVisible(outroId === id);
    }
    this.#janela.webContents.send('tabs:ativa', id);
    if (trocou) this.#aoTrocarGuiaAtiva?.();
    logEvento('aba-ativada', { id });
    return true;
  }

  /** As guias de cima, com o rotulo que a barra mostra e se estao visiveis. */
  guiasAbertas(): GuiaInfo[] {
    const principais = (['hub', 'erp', 'experience'] as TabId[])
      .filter((id) => this.#abas.has(id))
      .map((id) => ({
        id,
        rotulo: ROTULO_GUIA[id],
        visivel: !this.#escondidas.has(id) && !this.guiaBloqueada(id),
      }));
    const clientes = [...this.#abasClientes.values()].map((aba) => ({
      id: aba.origin,
      rotulo: aba.titulo,
      visivel: !this.#escondidas.has(aba.origin),
    }));
    const avulsas = [...this.#abasAvulsas.entries()].map(([id, titulo]) => ({
      id,
      rotulo: titulo,
      visivel: !this.#escondidas.has(id),
    }));
    return [...principais, ...clientes, ...avulsas];
  }

  aoMudarGuias(callback: () => void): void {
    this.#aoMudarGuias = callback;
  }

  /** Outra guia foi para a tela, ou nenhuma ficou: o que estava por cima da anterior sai. */
  aoTrocarGuiaAtiva(callback: () => void): void {
    this.#aoTrocarGuiaAtiva = callback;
  }

  definirPainelDeComunicacao(painel: PainelDeComunicacao): void {
    this.#painelDeComunicacao = painel;
  }

  get terceiro(): boolean {
    return this.#terceiro;
  }

  /** SankhyaOm e Experience, com o acesso de terceiro: fora da barra, do menu e dos atalhos. */
  guiaBloqueada(id: string): boolean {
    return this.#terceiro && GUIAS_DO_SANKHYA.has(id);
  }

  /**
   * Relê o Terceiro da configuração e redesenha a barra e o menu quando ele muda. A guia
   * bloqueada continua carregada, como uma escondida: desmarcar Terceiro a traz de volta.
   */
  async atualizarAcessoDeTerceiro(): Promise<void> {
    const terceiro = await lerAcessoDeTerceiro();
    if (terceiro === null || terceiro === this.#terceiro) return;

    this.#terceiro = terceiro;
    logEvento('acesso-de-terceiro', { terceiro });
    if (this.guiaBloqueada(this.#abaAtiva)) this.mostrar('hub');
    this.#emitirGuias();
  }

  /**
   * Esconde ou traz de volta uma guia da barra.
   *
   * Esconder a guia ATIVA troca para a primeira visivel. Se nenhuma outra estiver
   * marcada, todas as views ficam invisiveis, mas continuam carregadas em background.
   */
  definirGuiaVisivel(id: string, visivel: boolean): boolean {
    if (!this.#abas.has(id) || this.guiaBloqueada(id)) return false;

    if (visivel) {
      this.#escondidas.delete(id);
    } else {
      this.#escondidas.add(id);
    }

    this.#gravarGuiasEscondidas();

    if (!visivel && this.#abaAtiva === id) {
      const proxima = this.guiasAbertas().find((guia) => guia.visivel);
      if (proxima) {
        this.mostrar(proxima.id);
      } else {
        this.#abaAtiva = '';
        for (const view of this.#abas.values()) view.setVisible(false);
        this.#janela.webContents.send('tabs:ativa', '');
        this.#aoTrocarGuiaAtiva?.();
      }
    } else if (visivel && !this.#abaAtiva) {
      this.mostrar(id);
    }

    logEvento('guia-visibilidade', { id, visivel });
    this.#emitirGuias();
    return true;
  }

  /** Manda a barra redesenhar — o HTML das guias de cima e fixo, o estado vem daqui. */
  #emitirGuias(): void {
    this.#janela.webContents.send('guias:estado', this.guiasAbertas());
    this.#emitirListaClientes();
    this.#emitirListaAvulsas();
    this.#aoMudarGuias?.();
  }

  #gravarGuiasEscondidas(): void {
    gravarGuiasEscondidas(
      [...this.#escondidas].filter(
        (id): id is TabId => id === 'hub' || id === 'erp' || id === 'experience',
      ),
    );
  }

  /** Chamado depois de criar as guias: aplica o que estava escondido da sessao anterior. */
  restaurarGuiasEscondidas(): void {
    for (const id of lerGuiasEscondidas()) {
      if (this.#abas.has(id)) this.#escondidas.add(id);
    }
    if (this.#escondidas.has(this.#abaAtiva)) {
      const proxima = this.guiasAbertas().find((guia) => guia.visivel);
      if (proxima) {
        this.mostrar(proxima.id);
      } else {
        this.#abaAtiva = '';
        for (const view of this.#abas.values()) view.setVisible(false);
        this.#janela.webContents.send('tabs:ativa', '');
        this.#aoTrocarGuiaAtiva?.();
      }
    }
    this.#emitirGuias();
  }

  /** Sem `id`, a guia que está na tela — é o que o Ctrl+R do menu quer. */
  recarregar(id: string = this.#abaAtiva): boolean {
    const view = this.#abas.get(id);
    if (!view) return false;
    view.webContents.reload();
    return true;
  }

  /**
   * O Ctrl+F5 do Chrome: recarrega buscando tudo de novo no servidor. O cache em disco
   * não é apagado porque ele é da partição, não da guia — Painel, SankhyaOm e Experience
   * dividem a mesma, e apagá-lo valeria para as três.
   */
  recarregarSemCache(id: string = this.#abaAtiva): boolean {
    const view = this.#abas.get(id);
    if (!view) return false;
    view.webContents.reloadIgnoringCache();
    logEvento('aba-recarregada-sem-cache', { id });
    return true;
  }

  /** Só guia avulsa: no SankhyaOm e na Experience, voltar derrubaria a tela aberta. */
  voltar(id: string = this.#abaAtiva): boolean {
    const historico = this.#viewAvulsa(id)?.webContents.navigationHistory;
    if (!historico?.canGoBack()) return false;
    historico.goBack();
    return true;
  }

  avancar(id: string = this.#abaAtiva): boolean {
    const historico = this.#viewAvulsa(id)?.webContents.navigationHistory;
    if (!historico?.canGoForward()) return false;
    historico.goForward();
    return true;
  }

  /**
   * DevTools da guia ativa (base de cliente, ERP, Experience ou Painel) — não da barra
   * superior. Destacado em janela própria: acoplado, ele divide a área da
   * `WebContentsView` com a página do Sankhya, que já é apertada.
   */
  alternarFerramentasDesenvolvedor(): boolean {
    const view = this.#abas.get(this.#abaAtiva);
    if (!view) return false;
    if (view.webContents.isDevToolsOpened()) {
      view.webContents.closeDevTools();
      return true;
    }
    view.webContents.openDevTools({ mode: 'detach' });
    return true;
  }

  definirAlturaTopo(altura: number): void {
    this.#alturaTopo = Math.max(40, Math.round(altura || this.#alturaTopo));
    this.reposicionar();
  }

  definirLarguraLateral(largura: number): void {
    this.#larguraLateral = Math.max(0, Math.round(largura || 0));
    this.reposicionar();
  }

  reposicionar(): void {
    const [w, h] = this.#janela.getContentSize();
    for (const view of this.#abas.values()) {
      view.setBounds({
        x: this.#larguraLateral,
        y: this.#alturaTopo,
        width: Math.max(0, w - this.#larguraLateral),
        height: Math.max(0, h - this.#alturaTopo),
      });
    }
  }

  #emitirListaClientes(): void {
    this.#janela.webContents.send('links:lista', this.abasClientesAbertas());
  }

  #emitirListaAvulsas(): void {
    this.#janela.webContents.send('avulsas:lista', this.abasAvulsasAbertas());
  }

  #viewAvulsa(id: string): WebContentsView | undefined {
    return this.#abasAvulsas.has(id) ? this.#abas.get(id) : undefined;
  }

  abasAvulsasAbertas(): AbaAvulsaInfo[] {
    return [...this.#abasAvulsas.entries()].flatMap(([id, titulo]) => {
      const conteudo = this.#abas.get(id)?.webContents;
      if (!conteudo) return [];
      return [
        {
          id,
          titulo,
          url: conteudo.getURL(),
          podeVoltar: conteudo.navigationHistory.canGoBack(),
          podeAvancar: conteudo.navigationHistory.canGoForward(),
          visivel: !this.#escondidas.has(id),
        },
      ];
    });
  }

  /**
   * Guia de navegação livre, aberta pelo `+` da barra. Todas dividem a partição
   * `PARTICAO_AVULSA` (o login no Google vale em todas e sobrevive ao reinício) e nenhuma
   * recebe preload nem Ruffle: o conteúdo é de um site qualquer.
   */
  abrirAbaAvulsa(url: string = URL_INICIAL_AVULSA): string {
    const id = `${PREFIXO_AVULSA}${this.#proximaAvulsa++}`;
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTICAO_AVULSA,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    this.#registrarDownloadsDaParticao(PARTICAO_AVULSA);
    this.#acompanharAbaAvulsa(id, view);
    this.#carregarNaAvulsa(id, view, url);
    this.#janela.contentView.addChildView(view);
    this.#abas.set(id, view);
    this.#abasAvulsas.set(id, TITULO_AVULSA_PADRAO);
    this.reposicionar();
    this.#emitirGuias();
    this.mostrar(id);
    logEvento('aba-avulsa-aberta', { id });
    return id;
  }

  /** `false` quando o texto não vira endereço que se possa abrir (`file:`, vazio). */
  navegarAbaAvulsa(id: string, textoDigitado: string): boolean {
    const view = this.#viewAvulsa(id);
    const url = urlDoTextoDigitado(textoDigitado);
    if (!view || !url) {
      logEvento('aba-avulsa-endereco-recusado', { id });
      return false;
    }
    this.#carregarNaAvulsa(id, view, url);
    return true;
  }

  fecharAbaAvulsa(id: string): boolean {
    if (!this.#viewAvulsa(id)) return false;
    this.#descartarView(id);
    this.#abasAvulsas.delete(id);
    this.#emitirGuias();
    if (this.#abaAtiva === id) this.mostrar('hub');
    logEvento('aba-avulsa-fechada', { id });
    return true;
  }

  /**
   * `loadURL` rejeita quando a navegação é interrompida (outro Enter, página fora do ar):
   * sem o `catch`, cada uma virava rejeição sem tratamento no processo principal.
   */
  #carregarNaAvulsa(id: string, view: WebContentsView, url: string): void {
    view.webContents.loadURL(url).catch((erro: unknown) => {
      logEvento('aba-avulsa-falha-carregar', { id, url: origemSemQuery(url), erro: String(erro) });
    });
  }

  /** Título, endereço e histórico da página vão para a barra a cada mudança. */
  #acompanharAbaAvulsa(id: string, view: WebContentsView): void {
    const conteudo = view.webContents;
    conteudo.on('page-title-updated', (_evento, titulo) => {
      if (!this.#abasAvulsas.has(id)) return;
      this.#abasAvulsas.set(id, titulo || TITULO_AVULSA_PADRAO);
      this.#emitirGuias();
    });
    conteudo.on('did-navigate', () => this.#emitirListaAvulsas());
    conteudo.on('did-navigate-in-page', (_evento, _url, ehFramePrincipal) => {
      if (ehFramePrincipal) this.#emitirListaAvulsas();
    });
    // Pop-up vira outra guia avulsa, como no Chrome. A página perde o `window.opener`:
    // um login que conversa com a janela de origem por ele pode não concluir.
    conteudo.setWindowOpenHandler(({ url: alvo }) => {
      if (ehEnderecoWeb(alvo)) {
        this.abrirAbaAvulsa(alvo);
      } else {
        logEvento('popup-avulsa-recusado', { id, alvo: origemSemQuery(alvo) });
      }
      return { action: 'deny' };
    });
  }

  /**
   * Tirar da janela não encerra a página: sem o `close`, ela seguia viva (e logada), com
   * timers rodando, e cada abrir e fechar deixava um renderer para trás.
   */
  #descartarView(id: string): void {
    const view = this.#abas.get(id);
    if (!view) return;
    this.#janela.contentView.removeChildView(view);
    view.webContents.close();
    this.#abas.delete(id);
    this.#escondidas.delete(id);
  }

  /**
   * Uma aba por base de cliente, cada uma com PARTIÇÃO PRÓPRIA (efêmera, sem
   * `persist:`, sem preload) — reabrir a mesma base foca a aba existente em vez de
   * duplicar; abrir uma base diferente nunca compartilha cookie com outra (antes só
   * existia uma aba de link por vez, então uma partição única não misturava nada; com
   * várias ao mesmo tempo, compartilhar viraria problema real).
   */
  abrirAbaCliente(
    origin: string,
    url: string,
    info: InfoBaseCliente,
    opcoes: { autofill?: boolean; forcarUrl?: boolean } = {},
  ): void {
    const existente = this.#abas.get(origin);
    if (existente) {
      // O monitor de log compartilha o origin da base, então cai na mesma aba. Quando é
      // ele que está sendo aberto (`forcarUrl`), navega a aba para o JSP em vez de só
      // focá-la — senão o clique não sairia da tela do Sankhya que já estava aberta.
      if (opcoes.forcarUrl) void existente.webContents.loadURL(url);
      this.mostrar(origin);
      return;
    }
    const particao = `link:${origin}`;
    const view = new WebContentsView({
      webPreferences: {
        partition: particao,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        // Para o preload do Ruffle chegar aos iframes — ver `criarAbaPrincipal`.
        nodeIntegrationInSubFrames: true,
      },
    });
    // Sem isto, um download servido pela partição isolada do cliente não dispara nada: o
    // listener de `will-download` só existia na sessão padrão e nas partições das abas
    // principais, então baixar de dentro de uma aba de cliente falhava em silêncio.
    this.#registrarDownloadsDaParticao(particao);
    prepararParticaoParaRuffle(particao);
    manterHttpsDaBase(particao, origin);
    view.webContents.on('did-finish-load', () => {
      logEvento('aba-cliente-carregada', {
        clienteId: info.clienteId,
        url: origemSemQuery(view.webContents.getURL()),
      });
    });
    view.webContents.setWindowOpenHandler(({ url: alvo }) =>
      this.#popupDaAbaCliente(info, origin, particao, alvo),
    );
    view.webContents.loadURL(url);
    this.#janela.contentView.addChildView(view);
    this.#abas.set(origin, view);
    this.#abasClientes.set(origin, { origin, titulo: tituloBase(info), visivel: true });
    this.#escondidas.delete(origin);
    this.reposicionar();
    this.#emitirGuias();
    this.mostrar(origin);
    // Um único observador para a vida da aba, não um por navegação: o login é em duas
    // etapas (usuário -> "Prosseguir" -> senha) sem recarregar a página entre elas, e
    // `did-finish-load` só dispararia de novo se houvesse navegação de verdade.
    //
    // O monitor de log NÃO recebe autofill: a página dele tem um campo de senha PRÓPRIO
    // (a senha do JSP, não a do Sankhya), e o preenchedor colocaria a credencial da base
    // no lugar errado.
    if (opcoes.autofill !== false) void tentarAutofill(view, info, origin);
  }

  /**
   * Pop-up de uma base de cliente. O download do Sankhya costuma abrir uma guia nova para
   * servir o arquivo: pop-up do próprio host (ou em branco, que a página navega em
   * seguida) e de SSO vira janela filha na MESMA partição isolada do cliente, registrada
   * para não ser coletada pelo GC no meio do download, e o `registrarDownload` a fecha
   * quando o arquivo termina. O resto abre no navegador do sistema: a janela filha não tem
   * barra de endereço, e uma página de outro site ali pareceria parte da base.
   *
   * A janela filha recebe a mesma política, senão o `window.open` dela cairia no padrão
   * do Electron, sem restrição nenhuma.
   */
  #popupDaAbaCliente(
    info: InfoBaseCliente,
    origin: string,
    particao: string,
    alvo: string,
  ): Electron.WindowOpenHandlerResponse {
    const hostDaBase = new URL(origin).hostname;
    const permitido =
      alvo === '' ||
      alvo === 'about:blank' ||
      origemPermitida(alvo, [hostDaBase, ...DOMINIOS_POPUP_PERMITIDOS]);
    logEvento('popup-cliente-solicitado', {
      clienteId: info.clienteId,
      alvo: origemSemQuery(alvo),
      permitido,
    });

    if (!permitido) {
      if (ehEnderecoWeb(alvo)) {
        void shell.openExternal(alvo).catch((erro: unknown) => {
          logEvento('popup-cliente-externo-falhou', { erro: String(erro) });
        });
      }
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      createWindow: (options) => {
        const filha = new BrowserWindow({
          ...options,
          webPreferences: {
            ...options.webPreferences,
            partition: particao,
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            preload: undefined,
            // Tela do Sankhya aberta em janela própria também recebe o Ruffle.
            nodeIntegrationInSubFrames: true,
          },
        });
        this.#janelasFilhas.add(filha);
        filha.on('closed', () => this.#janelasFilhas.delete(filha));
        filha.webContents.setWindowOpenHandler(({ url: destino }) =>
          this.#popupDaAbaCliente(info, origin, particao, destino),
        );
        return filha.webContents;
      },
    };
  }

  fecharAbaCliente(origin: string): boolean {
    if (!this.abaCliente(origin)) return false;
    this.#descartarView(origin);
    this.#abasClientes.delete(origin);
    this.#emitirGuias();
    if (this.#abaAtiva === origin) this.mostrar('hub');
    return true;
  }

  /**
   * Bases, links gerais e links de projeto vindos do cadastro real (`GET /api/clientes`)
   * — nenhum inventado. Monta mapas novos a cada leitura, para o que foi removido do
   * cadastro deixar de valer.
   */
  async carregarCadastro(): Promise<void> {
    try {
      const resposta = await fetch(`${HUB_URL}/api/clientes`, {
        headers: { 'x-hub-token': garantirToken() },
        signal: AbortSignal.timeout(5000),
      });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const clientes = (await resposta.json()) as ClienteDoCadastro[];

      const basesPorOrigin = new Map<string, InfoBaseCliente>();
      const linksPorUrl = new Map<string, LinkCadastrado>();
      for (const cliente of clientes) {
        for (const base of cliente.bases ?? []) {
          const origin = origemDe(base.url);
          if (!origin) continue;
          const info: InfoBaseCliente = {
            clienteId: cliente.id,
            baseId: base.id,
            clienteNome: cliente.nome,
            ambiente: base.tipo,
            usuario: base.usuario,
            temSenha: Boolean(base.senha),
          };
          const existente = basesPorOrigin.get(origin);
          // Cadastros duplicados acontecem na prática (ex.: import de favoritos criando
          // uma segunda entrada pro mesmo cliente) — quando duas bases caem no mesmo
          // origin, a que tem usuário/senha vence sobre a vazia.
          if (
            existente &&
            (existente.usuario || existente.temSenha) &&
            !(info.usuario || info.temSenha)
          ) {
            continue;
          }
          basesPorOrigin.set(origin, info);
        }

        for (const link of cliente.links ?? []) {
          const url = urlNormalizada(link.url);
          if (url)
            linksPorUrl.set(url, { tipo: 'linksGerais', titulo: `${cliente.nome} · ${link.nome}` });
        }
        for (const projeto of cliente.projetos ?? []) {
          for (const link of projeto.links ?? []) {
            const url = urlNormalizada(link.url);
            if (url) {
              linksPorUrl.set(url, {
                tipo: 'linksDeProjeto',
                titulo: `${cliente.nome} · ${projeto.nome} · ${link.nome}`,
              });
            }
          }
        }
        for (const repositorio of cliente.repositorios ?? []) {
          const url = urlNormalizada(repositorio.url);
          if (url) {
            linksPorUrl.set(url, { tipo: 'repositorio', titulo: `${cliente.nome} · repositório` });
          }
        }
      }

      this.#linksPorUrl = linksPorUrl;
      this.#basesPorOrigin = basesPorOrigin;
      logEvento('cadastro-carregado', { bases: basesPorOrigin.size, links: linksPorUrl.size });
    } catch (err) {
      logEvento('cadastro-falhou-carregar', { erro: String(err) });
    }
  }
}
