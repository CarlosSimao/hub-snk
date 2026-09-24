/**
 * Gerenciador de abas do shell: `WebContentsView` para Hub/ERP/Experience (fixas) e uma
 * por base de cliente aberta (dinâmicas), política de pop-up (lista branca de SSO +
 * origin de base cadastrada vira aba própria isolada) e download. Porta de
 * `poc-desktop/src/main.js` (comprovado com dado real nas Rodadas 1-6 da PoC), sem os
 * ganchos de diagnóstico exclusivos da investigação do erro "require is not defined"
 * (stack via CDP, interceptação de `alert`): aquele erro foi caracterizado como interno
 * do Electron, sem impacto funcional (ver
 * docs/specs/sankhya-hub-desktop-poc-relatorio.md, Rodada 3) — não é papel do shell de
 * produção reproduzir o arnês de investigação.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, WebContentsView, app, session } from 'electron';
import { DOMINIOS_POPUP_PERMITIDOS, HUB_URL } from './config';
import { logEvento, origemSemQuery } from './log';
import { tentarAutofill } from './autofill';
import { PRELOAD_RUFFLE, prepararRuffle } from './ruffle';

export type TabId = 'hub' | 'erp' | 'experience';

/** Uma base de cliente cadastrada no cartão — o que o shell precisa pra abrir/nomear/autofillar a aba. */
export interface InfoBaseCliente {
  clienteId: number;
  baseId: number;
  clienteNome: string;
  ambiente: string;
  usuario: string;
  temSenha: boolean;
}

export interface AbaClienteInfo {
  origin: string;
  titulo: string;
  visivel: boolean;
}

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
  erp: 'Sankhya Om',
  experience: 'Experience',
};

/** Onde a escolha de guias escondidas sobrevive ao fechamento do aplicativo. */
function arquivoGuias(): string {
  return join(app.getPath('userData'), 'guias.json');
}

function lerGuiasEscondidas(): string[] {
  try {
    const dados = JSON.parse(readFileSync(arquivoGuias(), 'utf8')) as { escondidas?: unknown };
    return Array.isArray(dados.escondidas) ? dados.escondidas.filter((id): id is string => typeof id === 'string') : [];
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

export class TabManager {
  readonly #janela: BrowserWindow;
  readonly #abas = new Map<string, WebContentsView>();
  readonly #abasClientes = new Map<string, AbaClienteInfo>();
  readonly #janelasFilhas = new Set<BrowserWindow>();
  /** origin (protocolo+host+porta) -> base cadastrada. Precisa ser exato: duas bases do
   * mesmo cliente podem compartilhar host e diferir só na porta (caso real: prod/teste
   * do mesmo cliente em portas distintas), com usuário/senha diferentes. */
  readonly #basesPorOrigin = new Map<string, InfoBaseCliente>();
  #abaAtiva = 'hub';
  #alturaTopo = 96;
  /**
   * Guias que o usuario escondeu da barra.
   *
   * Esconder NAO fecha: a `WebContentsView` continua carregada, entao trazer a guia de
   * volta e' instantaneo e nao perde o que estava na tela (formulario pela metade, tela
   * do ERP aberta no lugar certo). E' o contrario de fechar uma aba de cliente.
   */
  readonly #escondidas = new Set<string>();
  #aoMudarGuias: (() => void) | null = null;

  constructor(janela: BrowserWindow) {
    this.#janela = janela;
    // Sessão padrão: onde as abas de cliente (partição própria por origin) e a
    // navegação de pop-up defensivamente caem — ver comentário em criarAbaPrincipal.
    session.defaultSession.on('will-download', registrarDownload('default', this.#janelasFilhas));
  }

  aba(id: TabId): WebContentsView | undefined {
    return this.#abas.get(id);
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
        // Nenhuma PONTE nas abas remotas: nada do app é exposto à página. A guia do ERP
        // ganha só o preload do Ruffle, que executa código na página sem expor API —
        // e precisa rodar em iframe também, onde as telas Flex vivem.
        ...(id === 'erp' ? { preload: PRELOAD_RUFFLE, nodeIntegrationInSubFrames: true } : {}),
        // O visor de PDF do Chromium é um plugin: sem isto o documento de escopo em PDF
        // abre em branco no painel. Só o hub, que é conteúdo local.
        ...(id === 'hub' ? { plugins: true } : {}),
      },
    });
    session.fromPartition(particao).on('will-download', registrarDownload(particao, this.#janelasFilhas));
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
    });
    view.webContents.setWindowOpenHandler(({ url: alvo }) => {
      let origin = '';
      try {
        origin = new URL(alvo).origin;
      } catch {
        /* URL inválida cai no fluxo de negação padrão abaixo */
      }
      // Links de base de cliente (ERP de cada cliente, não o interno da Sankhya) não
      // são SSO — ganham aba própria isolada em vez da lista branca de pop-up.
      const infoBase = id === 'hub' ? this.#basesPorOrigin.get(origin) : undefined;
      if (infoBase) {
        // O botão "Monitor de log" abre a URL do JSP com o marcador `#__hubmonitor` no
        // hash — invisível para o servidor (o próprio JSP descarta o hash) e para o
        // usuário, mas suficiente para o shell saber que é o monitor: navega a aba da
        // base para o JSP e não dispara o autofill de login.
        let ehMonitor = false;
        let alvoLimpo = alvo;
        try {
          const u = new URL(alvo);
          if (u.hash.includes('__hubmonitor')) {
            ehMonitor = true;
            u.hash = '';
            alvoLimpo = u.href;
          }
        } catch {
          /* URL inválida — trata como link normal de base */
        }
        logEvento('link-cliente-solicitado', { alvo: origemSemQuery(alvoLimpo), monitor: ehMonitor });
        this.abrirAbaCliente(
          origin,
          alvoLimpo,
          infoBase,
          ehMonitor ? { autofill: false, forcarUrl: true } : {},
        );
        return { action: 'deny' };
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
            clienteId: 0,
            baseId: 0,
            clienteNome: `Local · ${new URL(origin).host}`,
            ambiente: 'outro',
            usuario: '',
            temSenha: false,
          },
          { autofill: false },
        );
        return { action: 'deny' };
      }
      const permitido = origemPermitida(alvo, DOMINIOS_POPUP_PERMITIDOS);
      logEvento('popup-solicitado', { id, alvo: origemSemQuery(alvo), permitido });
      if (!permitido) return { action: 'deny' };
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
              ...(id === 'erp'
                ? { preload: PRELOAD_RUFFLE, nodeIntegrationInSubFrames: true }
                : { preload: undefined }),
            },
          });
          // Sem isto a BrowserWindow fica sem referência forte e o Electron pode
          // coletá-la (GC) antes da navegação/download terminar — aviso oficial da
          // documentação do Electron, reproduzido de verdade na PoC (download real).
          this.#janelasFilhas.add(filha);
          filha.on('closed', () => this.#janelasFilhas.delete(filha));
          // Tela Flex do ERP pode abrir em pop-up: o Ruffle vai junto.
          if (id === 'erp') prepararRuffle(filha.webContents);
          logEvento('popup-aberto-janela-filha', { id, alvo: origemSemQuery(alvo) });
          return filha.webContents;
        },
      };
    });
    // Ruffle (Flash) só na guia do ERP: Painel e Experience não têm tela Flex.
    if (id === 'erp') prepararRuffle(view.webContents);
    view.webContents.loadURL(url);
    this.#janela.contentView.addChildView(view);
    this.#abas.set(id, view);
  }

  mostrar(id: string): boolean {
    if (!this.#abas.has(id)) return false;
    // Abrir de novo uma guia escondida (por atalho ou pelo cartao do cliente) tambem a
    // devolve para a barra. Assim nunca existe conteudo ativo sem guia correspondente.
    if (this.#escondidas.delete(id)) {
      this.#gravarGuiasEscondidas();
      this.#emitirGuias();
    }
    this.#abaAtiva = id;
    for (const [outroId, view] of this.#abas.entries()) {
      view.setVisible(outroId === id);
    }
    this.#janela.webContents.send('tabs:ativa', id);
    logEvento('aba-ativada', { id });
    return true;
  }

  /** As guias de cima, com o rotulo que a barra mostra e se estao visiveis. */
  guiasAbertas(): GuiaInfo[] {
    const principais = (['hub', 'erp', 'experience'] as TabId[])
      .filter((id) => this.#abas.has(id))
      .map((id) => ({ id, rotulo: ROTULO_GUIA[id], visivel: !this.#escondidas.has(id) }));
    const clientes = [...this.#abasClientes.values()].map((aba) => ({
      id: aba.origin,
      rotulo: aba.titulo,
      visivel: !this.#escondidas.has(aba.origin),
    }));
    return [...principais, ...clientes];
  }

  aoMudarGuias(callback: () => void): void {
    this.#aoMudarGuias = callback;
  }

  /**
   * Esconde ou traz de volta uma guia da barra.
   *
   * Esconder a guia ATIVA troca para a primeira visivel. Se nenhuma outra estiver
   * marcada, todas as views ficam invisiveis, mas continuam carregadas em background.
   */
  definirGuiaVisivel(id: string, visivel: boolean): boolean {
    if (!this.#abas.has(id)) return false;

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
    this.#aoMudarGuias?.();
  }

  #gravarGuiasEscondidas(): void {
    gravarGuiasEscondidas(
      [...this.#escondidas].filter((id): id is TabId => id === 'hub' || id === 'erp' || id === 'experience'),
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
      }
    }
    this.#emitirGuias();
  }

  recarregar(id: string): boolean {
    const view = this.#abas.get(id);
    if (!view) return false;
    view.webContents.reload();
    return true;
  }

  definirAlturaTopo(altura: number): void {
    this.#alturaTopo = Math.max(40, Math.round(altura || this.#alturaTopo));
    this.reposicionar();
  }

  reposicionar(): void {
    const [w, h] = this.#janela.getContentSize();
    for (const view of this.#abas.values()) {
      view.setBounds({ x: 0, y: this.#alturaTopo, width: w, height: Math.max(0, h - this.#alturaTopo) });
    }
  }

  #emitirListaClientes(): void {
    this.#janela.webContents.send('links:lista', this.abasClientesAbertas());
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
        // Base de cliente é Sankhya: o Ruffle entra no início de cada frame (ver ruffle.ts).
        preload: PRELOAD_RUFFLE,
        nodeIntegrationInSubFrames: true,
      },
    });
    // Sem isto, um download servido pela partição isolada do cliente não dispara nada: o
    // listener de `will-download` só existia na sessão padrão e nas partições das abas
    // principais, então baixar de dentro de uma aba de cliente falhava em silêncio.
    session.fromPartition(particao).on('will-download', registrarDownload(particao, this.#janelasFilhas));
    view.webContents.on('did-finish-load', () => {
      logEvento('aba-cliente-carregada', { clienteId: info.clienteId, url: origemSemQuery(view.webContents.getURL()) });
    });
    // Antes isto negava TODO `window.open`, e como o download do Sankhya costuma abrir
    // uma guia nova para servir o arquivo, o download morria aqui. Agora a janela é
    // permitida como filha na MESMA partição isolada do cliente (nada vaza para outra
    // base), fica registrada para não ser coletada pelo GC no meio do download, e o
    // `registrarDownload` a fecha sozinha quando o arquivo termina — igual às abas
    // principais.
    view.webContents.setWindowOpenHandler(({ url: alvo }) => {
      logEvento('popup-cliente-solicitado', { clienteId: info.clienteId, alvo: origemSemQuery(alvo) });
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
              preload: PRELOAD_RUFFLE,
              nodeIntegrationInSubFrames: true,
            },
          });
          this.#janelasFilhas.add(filha);
          filha.on('closed', () => this.#janelasFilhas.delete(filha));
          prepararRuffle(filha.webContents);
          return filha.webContents;
        },
      };
    });
    // Base de cliente é Sankhya: tela Flex abre aqui também, e cada base tem a sua
    // partição — o `prepararRuffle` registra o protocolo nela.
    prepararRuffle(view.webContents);
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
    if (opcoes.autofill !== false) void tentarAutofill(view, info);
  }

  fecharAbaCliente(origin: string): boolean {
    const view = this.#abas.get(origin);
    if (!view || !this.#abasClientes.has(origin)) return false;
    this.#janela.contentView.removeChildView(view);
    this.#abas.delete(origin);
    this.#abasClientes.delete(origin);
    this.#escondidas.delete(origin);
    this.#emitirGuias();
    if (this.#abaAtiva === origin) this.mostrar('hub');
    return true;
  }

  /** Bases vindas do cadastro real (`GET /api/clientes` + `/cartao`) — nenhuma inventada. */
  async carregarBasesCadastradas(): Promise<void> {
    try {
      const resposta = await fetch(`${HUB_URL}/api/clientes`, { signal: AbortSignal.timeout(5000) });
      const corpo = (await resposta.json()) as { clientes?: Array<{ id: number; nome: string }> };
      const clientes = corpo.clientes ?? [];

      await Promise.all(
        clientes.map(async (cliente) => {
          try {
            const respostaCartao = await fetch(`${HUB_URL}/api/clientes/${cliente.id}/cartao`, {
              signal: AbortSignal.timeout(5000),
            });
            const cartao = (await respostaCartao.json()) as {
              bases?: Array<{ id: number; url: string; ambiente: string; usuario: string; temSenha: boolean }>;
            };
            for (const base of cartao.bases ?? []) {
              if (!base.url) continue;
              try {
                const origin = new URL(base.url).origin;
                const existente = this.#basesPorOrigin.get(origin);
                // Cadastros duplicados acontecem na prática (ex.: import de favoritos
                // criando uma segunda entrada pro mesmo cliente) — quando duas bases
                // caem no mesmo origin, a que tem usuário/senha vence sobre a vazia,
                // em vez de whatever veio por último em `GET /api/clientes`.
                if (existente && (existente.usuario || existente.temSenha) && !(base.usuario || base.temSenha)) {
                  continue;
                }
                this.#basesPorOrigin.set(origin, {
                  clienteId: cliente.id,
                  baseId: base.id,
                  clienteNome: cliente.nome,
                  ambiente: base.ambiente,
                  usuario: base.usuario,
                  temSenha: base.temSenha,
                });
              } catch {
                /* URL de base inválida — ignora, não é motivo pra travar o shell */
              }
            }
          } catch {
            /* cartão de um cliente falhou — não impede os demais */
          }
        }),
      );
      logEvento('bases-clientes-carregadas', { total: this.#basesPorOrigin.size });
    } catch (err) {
      logEvento('bases-clientes-falhou-carregar', { erro: String(err) });
    }
  }
}
