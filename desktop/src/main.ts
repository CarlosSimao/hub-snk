/**
 * Bootstrap do shell desktop do HUB SNK — ver docs/distribuicao.md.
 */
import './nomeDoApp';
import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  globalShortcut,
  ipcMain,
  session,
  type Tray,
} from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  HUB_URL,
  ERP_URL,
  EXPERIENCE_URL,
  ICONE,
  ID_DO_APP_WINDOWS,
  PARTICAO,
  userAgentLimpo,
} from './config';
import { logEvento } from './log';
import { garantirToken } from './backend/tokenStore';
import { TabManager, definirAcompanhamentoDeDownload } from './interface/tabs';
import { GerenciadorComunicacao } from './interface/comunicacao';
import { MenuFlutuante } from './interface/menuFlutuante';
import { CamadaDoHub } from './interface/camadaDoHub';
import { BarraDeBusca } from './interface/barraDeBusca';
import { JanelaAgendaOculta } from './sankhya/janelaAgendaOculta';
import { JanelaExperienceOculta } from './sankhya/janelaExperienceOculta';
import { criarBridgeServer } from './backend/bridgeServer';
import { pushSessaoExperience, limparSessaoExperience } from './backend/backendClient';
import { iniciarBackend, pararBackend } from './backend/backendProcess';
import { autoLoginSankhya } from './sankhya/autoLoginSankhya';
import * as cofre from './sankhya/cofreCredenciais';
import { menuDaGuia, montarMenu } from './interface/menu';
import { AvisosDoHub } from './interface/avisosDoHub';
import { avisarQueContinuaNaBandeja, criarBandeja } from './interface/bandeja';
import { AtalhoGlobalDaBusca } from './interface/atalhoGlobal';
import { abrirBuscaRapida } from './interface/buscaRapida';
import { registrarEsquemaDoRuffle } from './interface/ruffle';
import { iniciarAtualizacaoAutomatica } from './atualizacao';
import {
  definirInicioAutomatico,
  foiIniciadoPeloWindows,
  inicioAutomaticoLigado,
} from './inicioAutomatico';

if (!app.requestSingleInstanceLock()) {
  // app.quit() só agenda o encerramento — sem process.exit aqui, o resto do módulo
  // ainda rodaria nesta segunda instância antes do quit surtir efeito (bug real
  // encontrado e corrigido na PoC, Rodada 1/6).
  app.quit();
  process.exit(0);
}

// O atalho abre o HUB SNK com a pasta de trabalho na instalação. O navegador e o que
// mais o shell abrir herdariam essa pasta e travariam a próxima atualização, que precisa
// mover a pasta inteira.
process.chdir(homedir());

registrarEsquemaDoRuffle();

let janelaPrincipal: BrowserWindow | null = null;
let tabs: TabManager | null = null;
let comunicacao: GerenciadorComunicacao | null = null;
let menuFlutuante: MenuFlutuante | null = null;
let camadaDoHub: CamadaDoHub | null = null;
let barraDeBusca: BarraDeBusca | null = null;
let agendaOculta: JanelaAgendaOculta | null = null;
let experienceOculta: JanelaExperienceOculta | null = null;
let experienceCapturada = false;
/** `expIso` do que já foi confirmado empurrado — dispara push de novo se mudar (relogin
 * sem passar por "ausente" no meio, ex.: trocar de conta sem sair primeiro). */
let ultimoExpEmpurrado = '';
/** Referência mantida só para o coletor de lixo não levar o ícone da bandeja embora. */
let bandeja: Tray | null = null;
/** Encerramento pedido (Sair): a partir daqui o X fecha a janela em vez de escondê-la. */
let encerrando = false;
/** Windows desligando ou saindo da conta: segurar o fechamento travaria o desligamento. */
let sessaoDoWindowsEncerrando = false;
const atalhoGlobal = new AtalhoGlobalDaBusca(() => abrirBuscaRapidaNaJanela());
/** Mesmo nome que o backend lê — ver `src/rotas/seguranca/autenticacaoDoPainel.ts`. */
const NOME_DO_COOKIE_DO_TOKEN = 'hub_token';

/**
 * O backend exige o token em toda a API. O painel não o conhece: vai como cookie da
 * sessão da guia, e `fetch`, `EventSource` e a janela de log passam a levá-lo sozinhos.
 * `HttpOnly` esconde o valor do JavaScript da página; `SameSite=Strict` impede que o
 * ERP e a Experience, que dividem a partição, façam chamadas autenticadas ao backend.
 */
async function gravarTokenParaOPainel(): Promise<void> {
  try {
    await session.fromPartition(PARTICAO).cookies.set({
      url: HUB_URL,
      name: NOME_DO_COOKIE_DO_TOKEN,
      value: garantirToken(),
      httpOnly: true,
      sameSite: 'strict',
    });
  } catch (err) {
    logEvento('painel-token-falhou', { erro: String(err) });
    dialog.showErrorBox(
      'HUB SNK — o painel não vai carregar os dados',
      `Não foi possível entregar o token do shell ao painel: ${String(err)}`,
    );
  }
}

function criarJanela(): void {
  janelaPrincipal = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'HUB SNK',
    icon: ICONE,
    // Aberto pelo Windows no login, o app sobe escondido na bandeja, sem janela na frente.
    show: !foiIniciadoPeloWindows(),
    webPreferences: {
      preload: join(__dirname, 'preloads', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // O aviso de mensagem nova do WhatsApp toca som sem clique nenhum antes; sem isto, o
      // Chromium pode calar o áudio da barra até o primeiro gesto do usuário.
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  // A barra nativa ocupava uma linha inteira só para o menu: ele passa a abrir pelo botão
  // da barra de guias. O menu continua registrado, então os atalhos seguem valendo.
  janelaPrincipal.setMenuBarVisibility(false);
  // A barra de guias é a única página com o preload: arrastar um link ou arquivo para ela
  // a navegaria para fora, e a página de destino ganharia o `window.hub`.
  janelaPrincipal.webContents.on('will-navigate', (evento) => evento.preventDefault());
  janelaPrincipal.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaPrincipal.loadFile(join(__dirname, '..', 'telas', 'index.html'));
  janelaPrincipal.on('resize', () => {
    tabs?.reposicionar();
    comunicacao?.reposicionar();
    menuFlutuante?.fechar();
    camadaDoHub?.reposicionar();
    barraDeBusca?.reposicionar();
  });
  // Fechar a janela principal encerra o aplicativo mesmo com uma janela filha aberta
  // (log de uma base, pop-up de SSO): sem isto o `window-all-closed` não dispara, e o
  // app e o backend continuam de pé sem a janela que os controla.
  janelaPrincipal.on('closed', () => app.quit());
  // Com a bandeja, o X só esconde: o atalho global e os avisos de mensagem nova seguem
  // valendo. Sair de verdade é por Hub › Sair ou pela bandeja.
  janelaPrincipal.on('close', (evento) => {
    if (encerrando || sessaoDoWindowsEncerrando) return;
    evento.preventDefault();
    janelaPrincipal?.hide();
    avisarQueContinuaNaBandeja();
  });
  janelaPrincipal.on('query-session-end', () => {
    sessaoDoWindowsEncerrando = true;
  });

  tabs = new TabManager(janelaPrincipal);
  comunicacao = new GerenciadorComunicacao(janelaPrincipal);
  tabs.definirPainelDeComunicacao(comunicacao);
  menuFlutuante = new MenuFlutuante(janelaPrincipal);
  const camada = new CamadaDoHub(janelaPrincipal);
  camadaDoHub = camada;
  // Todo download, de qualquer guia, vai para a pasta Downloads e para a lista da barra.
  definirAcompanhamentoDeDownload((item) => camada.acompanhar(item));
  camada.aoMudarDownloads((lista) => {
    if (!janelaPrincipal?.isDestroyed())
      janelaPrincipal?.webContents.send('downloads:estado', lista);
  });
  const gerenciadorDasGuias = tabs;
  const barra = new BarraDeBusca(janelaPrincipal, () => gerenciadorDasGuias.viewAtiva());
  // A busca é da guia em que foi aberta: na troca, a barra não pode ficar por cima de outra.
  tabs.aoTrocarGuiaAtiva(() => barra.fechar());
  barraDeBusca = barra;
  // `?desktop=1` só na aba Hub: sinal para o painel de que ele roda dentro do shell,
  // e não num navegador comum.
  const hubUrlComFlag = `${HUB_URL}${HUB_URL.includes('?') ? '&' : '?'}desktop=1`;
  tabs.criarAbaPrincipal('hub', hubUrlComFlag, PARTICAO);
  tabs.criarAbaPrincipal('erp', ERP_URL, PARTICAO);
  tabs.criarAbaPrincipal('experience', EXPERIENCE_URL, PARTICAO);
  tabs.reposicionar();
  tabs.mostrar('hub');
  // Depois de criar as tres: aplica o que estava escondido na sessao anterior.
  tabs.restaurarGuiasEscondidas();
  void tabs.carregarCadastro();
  new AvisosDoHub(janelaPrincipal, tabs).iniciar();

  // Boot com credencial salva mas sem sessão capturada: loga sozinho, sem esperar a
  // guia cair em tela de login por conta própria (ela pode nem navegar de novo se o
  // cookie/token só expirar depois). Terceiro não usa o Sankhya: não há o que logar.
  const gerenciadorDeGuias = tabs;
  void gerenciadorDeGuias.atualizarAcessoDeTerceiro().then(() => {
    if (gerenciadorDeGuias.terceiro) return;
    for (const sistema of cofre.SISTEMAS) {
      const status = cofre.status(sistema);
      if (status.definido && !status.sessaoCapturada) {
        void autoLoginSankhya(gerenciadorDeGuias, sistema);
      }
    }
  });

  // Captura/recaptura periódica do token da Experience, agora pela JANELA OCULTA — que
  // loga sozinha e renova, sem depender da aba visível estar logada (era o que quebrava a
  // aba OS).
  //
  // Empurra em TODO tick em que a sessão está presente, não só quando muda: o backend
  // guarda em memória (`SessaoDoDesktop`), então um restart dele (deploy, crash) perde
  // o valor sem avisar o shell — reempurrar sempre é a única forma de o backend nunca
  // ficar mais de um tick (15s) desatualizado. `SessaoDoDesktop.definir` é
  // idempotente, então repetir o mesmo valor não tem custo além da chamada HTTP local.
  //
  // `sincronizandoExperience` evita que um tick comece o login enquanto o anterior ainda
  // está logando (o primeiro tick pode levar dezenas de segundos).
  let sincronizandoExperience = false;
  setInterval(() => {
    // Terceiro não tem a Experience: a janela oculta nem chega a logar.
    if (sincronizandoExperience || tabs?.terceiro) return;
    sincronizandoExperience = true;
    void (async () => {
      try {
        const sessao = (await experienceOculta?.obterSessao()) ?? {
          presente: false,
          usuario: '',
          token: '',
          expIso: '',
        };
        if (sessao.presente) {
          const ok = await pushSessaoExperience({
            usuario: sessao.usuario,
            token: sessao.token,
            expira: sessao.expIso,
          });
          if (ok && sessao.expIso !== ultimoExpEmpurrado) {
            logEvento('experience-sessao-empurrada');
          }
          if (ok) {
            experienceCapturada = true;
            ultimoExpEmpurrado = sessao.expIso;
          }
        } else if (experienceCapturada) {
          experienceCapturada = false;
          ultimoExpEmpurrado = '';
          await limparSessaoExperience();
          logEvento('experience-sessao-limpa');
        }
      } finally {
        sincronizandoExperience = false;
      }
    })();
  }, 15_000);
}

function mostrarJanela(): void {
  if (!janelaPrincipal) return;
  if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
  janelaPrincipal.show();
  janelaPrincipal.focus();
}

/** Traz a janela e deixa a guia Painel à vista: é o que o atalho, o menu e a bandeja pedem. */
function mostrarPainel(): void {
  mostrarJanela();
  // O painel de comunicação fica por cima das guias e cobriria a busca.
  comunicacao?.ocultar();
}

function abrirBuscaRapidaNaJanela(): void {
  if (!tabs) return;
  mostrarPainel();
  void abrirBuscaRapida(tabs);
}

function criarBandejaDoApp(): void {
  bandeja = criarBandeja({
    mostrarJanela,
    abrirBusca: abrirBuscaRapidaNaJanela,
    situacaoDoAtalhoGlobal: () => atalhoGlobal.situacao,
    definirAtalhoGlobalLigado: (ligado) => atalhoGlobal.definirLigado(ligado),
    inicioAutomaticoLigado,
    definirInicioAutomatico,
    sair: () => app.quit(),
  });
}

/**
 * Canal que só uma página local atende. O preload só existe nela, mas conferir o
 * remetente custa uma linha e não depende de nenhuma outra página nunca ganhar o preload.
 */
function tratarSoDe<A extends unknown[], R>(
  pagina: string,
  ehRemetente: (evento: Electron.IpcMainInvokeEvent) => boolean,
  canal: string,
  tratar: (...argumentos: A) => R,
): void {
  ipcMain.handle(canal, (evento, ...argumentos) => {
    if (!ehRemetente(evento) || evento.senderFrame !== evento.sender.mainFrame) {
      logEvento('ipc-recusado', { canal });
      throw new Error(`o canal ${canal} só atende ${pagina}`);
    }
    return tratar(...(argumentos as A));
  });
}

function tratarDaBarraDeGuias<A extends unknown[], R>(
  canal: string,
  tratar: (...argumentos: A) => R,
): void {
  tratarSoDe('a barra de guias', (e) => e.sender === janelaPrincipal?.webContents, canal, tratar);
}

function tratarDoMenuFlutuante<A extends unknown[], R>(
  canal: string,
  tratar: (...argumentos: A) => R,
): void {
  tratarSoDe('o menu', (e) => menuFlutuante?.ehRemetente(e.sender) ?? false, canal, tratar);
}

tratarDaBarraDeGuias('layout:definirAlturaTopo', (altura: number) => {
  tabs?.definirAlturaTopo(altura);
  comunicacao?.definirAlturaTopo(altura);
  barraDeBusca?.reposicionar();
  return { ok: true };
});

tratarDaBarraDeGuias('layout:definirLarguraLateral', (largura: number) => {
  tabs?.definirLarguraLateral(largura);
  comunicacao?.definirLarguraLateral(largura);
  barraDeBusca?.reposicionar();
  return { ok: true };
});

tratarDaBarraDeGuias('comunicacao:alternar', (servico: string) => ({
  ok: comunicacao?.alternar(servico) ?? false,
}));
tratarDaBarraDeGuias('comunicacao:ocultar', () => {
  comunicacao?.ocultar();
  return { ok: true };
});
tratarDaBarraDeGuias('comunicacao:estado', () => comunicacao?.estadoDosServicos() ?? []);
tratarDaBarraDeGuias('comunicacao:abrirMenu', (x: number, y: number) => {
  menuFlutuante?.abrir(() => comunicacao?.menuDeServicos() ?? null, x, y);
  return { ok: true };
});

// O menu do aplicativo continua registrado pelos atalhos; o botão só o desenha em HTML,
// para marcar várias guias sem que ele feche a cada clique.
tratarDaBarraDeGuias('menu:abrir', (x: number, y: number) => {
  menuFlutuante?.abrir(() => Menu.getApplicationMenu(), x, y);
  return { ok: true };
});

tratarDaBarraDeGuias('downloads:estado', () => camadaDoHub?.listaDeDownloads() ?? []);
tratarDaBarraDeGuias('downloads:abrir', (x: number, y: number) => {
  camadaDoHub?.abrirPainelDeDownloads(x, y);
  return { ok: true };
});

function tratarDaCamada<A extends unknown[], R>(
  canal: string,
  tratar: (...argumentos: A) => R,
): void {
  tratarSoDe('a camada', (e) => camadaDoHub?.ehRemetente(e.sender) ?? false, canal, tratar);
}

tratarDaCamada('camada:abrirDownload', (id: unknown) => ({
  ok: camadaDoHub?.abrirDownload(Number(id)) ?? false,
}));
tratarDaCamada('camada:mostrarNaPasta', (id: unknown) => ({
  ok: camadaDoHub?.mostrarNaPasta(Number(id)) ?? false,
}));
tratarDaCamada('camada:limparDownloads', () => {
  camadaDoHub?.limparConcluidos();
  return { ok: true };
});
tratarDaCamada('camada:fechar', () => {
  camadaDoHub?.fechar();
  return { ok: true };
});

tratarDoMenuFlutuante('menuFlutuante:escolher', (id: string) => ({
  ok: menuFlutuante?.escolher(id) ?? false,
}));
tratarDoMenuFlutuante('menuFlutuante:fechar', () => {
  menuFlutuante?.fechar();
  return { ok: true };
});

function tratarDaBarraDeBusca<A extends unknown[], R>(
  canal: string,
  tratar: (...argumentos: A) => R,
): void {
  tratarSoDe(
    'a barra de busca',
    (e) => barraDeBusca?.ehRemetente(e.sender) ?? false,
    canal,
    tratar,
  );
}

tratarDaBarraDeBusca('barraDeBusca:buscar', (texto: unknown, paraTras: unknown) => ({
  ok: barraDeBusca?.buscar(texto, paraTras) ?? false,
}));
tratarDaBarraDeBusca('barraDeBusca:fechar', () => {
  barraDeBusca?.fechar();
  return { ok: true };
});

tratarDaBarraDeGuias('tabs:mostrar', (id: string) => ({ ok: tabs?.mostrar(id) ?? false }));
tratarDaBarraDeGuias('guias:estado', () => tabs?.guiasAbertas() ?? []);
tratarDaBarraDeGuias('tabs:recarregar', (id: string) => ({ ok: tabs?.recarregar(id) ?? false }));
tratarDaBarraDeGuias('links:fechar', (origin: string) => ({
  ok: tabs?.fecharAbaCliente(origin) ?? false,
}));
tratarDaBarraDeGuias('links:lista', () => tabs?.abasClientesAbertas() ?? []);
tratarDaBarraDeGuias('tabs:recarregarSemCache', (id: string) => ({
  ok: tabs?.recarregarSemCache(id) ?? false,
}));
tratarDaBarraDeGuias('tabs:abrirMenuDaGuia', (id: string, x: number, y: number) => {
  menuFlutuante?.abrir(() => menuDaGuia(() => tabs, id), x, y);
  return { ok: true };
});

tratarDaBarraDeGuias('avulsas:abrir', () => ({ ok: Boolean(tabs?.abrirAbaAvulsa()) }));
tratarDaBarraDeGuias('avulsas:lista', () => tabs?.abasAvulsasAbertas() ?? []);
tratarDaBarraDeGuias('avulsas:navegar', (id: string, texto: string) => ({
  ok: tabs?.navegarAbaAvulsa(id, String(texto)) ?? false,
}));
tratarDaBarraDeGuias('avulsas:voltar', (id: string) => ({ ok: tabs?.voltar(id) ?? false }));
tratarDaBarraDeGuias('avulsas:avancar', (id: string) => ({ ok: tabs?.avancar(id) ?? false }));
tratarDaBarraDeGuias('avulsas:fechar', (id: string) => ({
  ok: tabs?.fecharAbaAvulsa(id) ?? false,
}));

/**
 * Sem isto o Windows escreve "Electron" no topo de toda notificação (WhatsApp, Chat,
 * Gmail). A identidade vale para o processo inteiro: não há como cada serviço aparecer
 * com o próprio nome ali.
 *
 * Empacotado, o atalho do instalador já liga o id ao nome e ao ícone. Em desenvolvimento
 * não há atalho: o nome vai para o registro do usuário (`HKCU`, sem administrador), que o
 * Windows aceita no lugar do atalho para apps Win32.
 */
function definirIdentidadeNasNotificacoes(): void {
  if (process.platform !== 'win32') return;
  app.setAppUserModelId(ID_DO_APP_WINDOWS);
  if (app.isPackaged) return;
  const chave = `HKCU\\Software\\Classes\\AppUserModelId\\${ID_DO_APP_WINDOWS}`;
  const valores: Array<[string, string]> = [
    ['DisplayName', app.getName()],
    ['IconUri', ICONE],
  ];
  for (const [nome, valor] of valores) {
    execFile('reg', ['add', chave, '/v', nome, '/t', 'REG_SZ', '/d', valor, '/f'], (erro) => {
      if (erro) logEvento('identidade-notificacao-nao-registrada', { nome, erro: erro.message });
    });
  }
}

app.whenReady().then(async () => {
  logEvento('app-pronto');
  definirIdentidadeNasNotificacoes();

  // Antes de qualquer janela: o user agent vale para todas as requisições, e páginas do
  // Sankhya que detectam Electron tentam `require(...)` e quebram com um alert.
  app.userAgentFallback = userAgentLimpo(app.userAgentFallback);
  logEvento('user-agent-definido', {
    ua: app.userAgentFallback,
    icone: ICONE,
    iconeExiste: existsSync(ICONE),
  });

  // Antes do backend: as primeiras consultas de credencial dele já precisam ter com
  // quem falar.
  //
  // A Agenda de Recursos é consultada por uma janela invisível dedicada, que loga sozinha
  // pela web (único jeito de ter o ACL do serviço) e não depende da aba ERP visível do
  // usuário. Ela é criada preguiçosamente na primeira consulta — ver `janelaAgendaOculta.ts`.
  agendaOculta = new JanelaAgendaOculta();
  criarBridgeServer(agendaOculta, () => tabs);

  // A sessão da Experience (JWT que alimenta a aba OS) também vem de uma janela oculta que
  // loga sozinha, em vez da aba visível — o laço de 15s abaixo lê o token daqui.
  experienceOculta = new JanelaExperienceOculta();

  // Antes da janela: o painel é a primeira aba a carregar e apontaria para uma porta
  // fechada. Esperar aqui custa o tempo de boot do Fastify uma vez, e evita que a
  // primeira coisa que o usuário veja seja uma tela de erro de conexão.
  const backend = await iniciarBackend();
  if (backend.modo === 'falhou') {
    logEvento('backend-falhou-no-boot');
    dialog.showErrorBox('HUB SNK — o backend não subiu', backend.erro);
  }

  await gravarTokenParaOPainel();
  criarJanela();
  const reconstruirMenu = () =>
    montarMenu(
      () => janelaPrincipal,
      () => tabs,
      {
        abrirBuscaRapida: abrirBuscaRapidaNaJanela,
        buscarNaPagina: () => barraDeBusca?.abrir(),
        situacaoDoAtalhoGlobal: () => atalhoGlobal.situacao,
      },
    );
  reconstruirMenu();
  // Versão baixada ou atualização desligada: o item "Reiniciar para atualizar" muda.
  iniciarAtualizacaoAutomatica(reconstruirMenu);
  criarBandejaDoApp();
  atalhoGlobal.aplicarEscolhaGravada();
  comunicacao?.carregarAoAbrirSeEscolhido();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('before-quit', (evento) => {
  // `pararBackend` é assíncrono e o Electron não espera handler nenhum: sem segurar o
  // quit aqui, o processo do backend sobraria órfão segurando a porta 4100, e a próxima
  // abertura do shell acharia que há "backend externo" no ar.
  if (encerrando) return;
  evento.preventDefault();
  encerrando = true;
  agendaOculta?.destruir();
  experienceOculta?.destruir();
  void pararBackend().finally(() => app.quit());
});

app.on('window-all-closed', () => {
  logEvento('todas-janelas-fechadas');
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => globalShortcut.unregisterAll());

// O atalho da área de trabalho com o app escondido na bandeja cai aqui: a janela volta.
app.on('second-instance', () => {
  mostrarJanela();
  camadaDoHub?.mostrarAviso(
    'O HUB SNK já está aberto',
    'Só uma janela por vez: trouxemos a que já estava rodando para a frente.',
  );
});
