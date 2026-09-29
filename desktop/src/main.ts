/**
 * Bootstrap do shell desktop do HUB SNK. Veio da branch `flaviano-sankhya-hub` e foi
 * adaptado ao backend da `dev` — ver docs/plano-migracao-electron.md.
 */
import './nomeDoApp';
import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { HUB_URL, ERP_URL, EXPERIENCE_URL, ICONE, PARTICAO, userAgentLimpo } from './config';
import { logEvento } from './log';
import { TabManager } from './tabs';
import { JanelaAgendaOculta } from './janelaAgendaOculta';
import { JanelaExperienceOculta } from './janelaExperienceOculta';
import { criarBridgeServer } from './bridgeServer';
import { pushSessaoExperience, limparSessaoExperience } from './backendClient';
import { diagnosticoCookiesErp } from './sessions';
import { backendDisponivel } from './services';
import { backendGerenciado, iniciarBackend, pararBackend } from './backendProcess';
import { migrarCofreDoHelper } from './migracaoCofre';
import { autoLoginSankhya } from './autoLoginSankhya';
import * as cofre from './cofreCredenciais';
import { montarMenu } from './menu';

if (!app.requestSingleInstanceLock()) {
  // app.quit() só agenda o encerramento — sem process.exit aqui, o resto do módulo
  // ainda rodaria nesta segunda instância antes do quit surtir efeito (bug real
  // encontrado e corrigido na PoC, Rodada 1/6).
  app.quit();
  process.exit(0);
}

let janelaPrincipal: BrowserWindow | null = null;
let tabs: TabManager | null = null;
let agendaOculta: JanelaAgendaOculta | null = null;
let experienceOculta: JanelaExperienceOculta | null = null;
let experienceCapturada = false;
/** `expIso` do que já foi confirmado empurrado — dispara push de novo se mudar (relogin
 * sem passar por "ausente" no meio, ex.: trocar de conta sem sair primeiro). */
let ultimoExpEmpurrado = '';

function criarJanela(): void {
  janelaPrincipal = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'HUB SNK',
    icon: ICONE,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  // A barra nativa ocupava uma linha inteira só para o menu: ele passa a abrir pelo botão
  // da barra de guias. O menu continua registrado, então os atalhos seguem valendo.
  janelaPrincipal.setMenuBarVisibility(false);
  janelaPrincipal.loadFile(join(__dirname, '..', 'index.html'));
  janelaPrincipal.on('resize', () => tabs?.reposicionar());
  // Fechar a janela principal encerra o aplicativo mesmo com uma janela filha aberta
  // (log de uma base, pop-up de SSO): sem isto o `window-all-closed` não dispara, e o
  // app e o backend continuam de pé sem a janela que os controla.
  janelaPrincipal.on('closed', () => app.quit());

  tabs = new TabManager(janelaPrincipal);
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

  // Boot com credencial salva mas sem sessão capturada: loga sozinho, sem esperar a
  // guia cair em tela de login por conta própria (ela pode nem navegar de novo se o
  // cookie/token só expirar depois).
  for (const sistema of cofre.SISTEMAS) {
    const status = cofre.status(sistema);
    if (status.definido && !status.sessaoCapturada) void autoLoginSankhya(tabs, sistema);
  }

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
    if (sincronizandoExperience) return;
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

ipcMain.handle('layout:definirAlturaTopo', (_evt, altura: number) => {
  tabs?.definirAlturaTopo(altura);
  return { ok: true };
});

ipcMain.handle('menu:abrir', (_evt, x: number, y: number) => {
  const menu = Menu.getApplicationMenu();
  if (!menu || !janelaPrincipal) return { ok: false };
  menu.popup({ window: janelaPrincipal, x: Math.round(x), y: Math.round(y) });
  return { ok: true };
});

ipcMain.handle('tabs:mostrar', (_evt, id: string) => ({ ok: tabs?.mostrar(id) ?? false }));
ipcMain.handle('guias:estado', () => tabs?.guiasAbertas() ?? []);
ipcMain.handle('tabs:recarregar', (_evt, id: string) => ({ ok: tabs?.recarregar(id) ?? false }));
ipcMain.handle('links:fechar', (_evt, origin: string) => ({
  ok: tabs?.fecharAbaCliente(origin) ?? false,
}));
ipcMain.handle('links:lista', () => tabs?.abasClientesAbertas() ?? []);

ipcMain.handle('diag:status', async () => ({
  backend: await backendDisponivel(),
  backendGerenciado: backendGerenciado(),
  erp: await diagnosticoCookiesErp(),
  experienceCapturada,
}));

app.whenReady().then(async () => {
  logEvento('app-pronto');

  // Antes de qualquer janela: o user agent vale para todas as requisições, e páginas do
  // Sankhya que detectam Electron tentam `require(...)` e quebram com um alert.
  app.userAgentFallback = userAgentLimpo(app.userAgentFallback);
  logEvento('user-agent-definido', {
    ua: app.userAgentFallback,
    icone: ICONE,
    iconeExiste: existsSync(ICONE),
  });

  // Antes do backend: a primeira tela que consulta credenciais precisa encontrar o
  // cofre já preenchido com o que estava no `hub-helper.ps1`.
  await migrarCofreDoHelper();

  // Também antes do backend: as primeiras consultas de credencial dele já precisam ter
  // com quem falar, senão caem para o helper sem necessidade.
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

  criarJanela();
  montarMenu(
    () => janelaPrincipal,
    () => tabs,
  );

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

let encerrando = false;
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

app.on('second-instance', () => {
  if (janelaPrincipal) {
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.focus();
  }
});
