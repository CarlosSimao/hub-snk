/**
 * Bootstrap do shell desktop — Fase 2 da migração
 * (docs/specs/sankhya-hub-desktop-especificacao.md). Sucessor de produção da PoC
 * (`poc-desktop/`, mantida intocada como evidência histórica).
 */
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { HUB_URL, ERP_URL, EXPERIENCE_URL, ICONE, PARTICAO, userAgentLimpo } from './config';
import { logEvento } from './log';
import { TabManager } from './tabs';
import { AgendaFetcher } from './agenda';
import { ServerLogFetcher } from './serverLog';
import { criarBridgeServer } from './bridgeServer';
import { pushSessaoExperience, limparSessaoExperience } from './backendClient';
import { capturarTokenExperience, diagnosticoCookiesErp } from './sessions';
import { backendDisponivel } from './services';
import { backendGerenciado, iniciarBackend, pararBackend } from './backendProcess';
import { migrarCofreDoHelper } from './migracaoCofre';
import { prepararArquivosDoUsuario } from './primeiroBoot';
import { migrarPastaDeDados } from './migracaoNome';
import { montarMenu } from './menu';
import { avisarAnotacoes, avisarServerLog } from './lembretes';
import { registrarEsquemaRuffle, registrarIpcRuffle } from './ruffle';

if (!app.requestSingleInstanceLock()) {
  // app.quit() só agenda o encerramento — sem process.exit aqui, o resto do módulo
  // ainda rodaria nesta segunda instância antes do quit surtir efeito (bug real
  // encontrado e corrigido na PoC, Rodada 1/6).
  app.quit();
  process.exit(0);
}

// Antes do `ready`, por exigência do Electron: esquema privilegiado só se registra aqui.
registrarEsquemaRuffle();
registrarIpcRuffle();

let janelaPrincipal: BrowserWindow | null = null;
let tabs: TabManager | null = null;
let experienceCapturada = false;
/** `expIso` do que já foi confirmado empurrado — dispara push de novo se mudar (relogin
 * sem passar por "ausente" no meio, ex.: trocar de conta sem sair primeiro). */
let ultimoExpEmpurrado = '';

function criarJanela(): void {
  janelaPrincipal = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Development Switch',
    icon: ICONE,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  janelaPrincipal.loadFile(join(__dirname, '..', 'index.html'));
  janelaPrincipal.on('resize', () => tabs?.reposicionar());

  tabs = new TabManager(janelaPrincipal);
  // `?desktop=1` só na aba Hub: é o sinal que o React lê (useModoDesktop) pra esconder
  // a tela de credenciais do fluxo antigo (navegador externo) — ela abriria um terceiro
  // navegador, sem relação com as abas deste shell.
  const hubUrlComFlag = `${HUB_URL}${HUB_URL.includes('?') ? '&' : '?'}desktop=1`;
  tabs.criarAbaPrincipal('hub', hubUrlComFlag, PARTICAO);
  tabs.criarAbaPrincipal('erp', ERP_URL, PARTICAO);
  tabs.criarAbaPrincipal('experience', EXPERIENCE_URL, PARTICAO);
  tabs.reposicionar();
  tabs.mostrar('hub');
  // Depois de criar as tres: aplica o que estava escondido na sessao anterior.
  tabs.restaurarGuiasEscondidas();
  void tabs.carregarBasesCadastradas();

  // Captura/recaptura periódica: a Experience é SPA e o token pode surgir depois do
  // carregamento inicial (login) ou sumir (logout real) sem que o shell seja avisado
  // de outra forma — ver Seção 6.3 da especificação.
  //
  // Empurra em TODO tick em que a sessão está presente, não só quando muda: o backend
  // guarda em memória (SessaoDesktopStore), então um restart dele (deploy, crash) perde
  // o valor sem avisar o shell — reempurrar sempre é a única forma de o backend nunca
  // ficar mais de um tick (15s) desatualizado. `SessaoDesktopStore.definir` é
  // idempotente, então repetir o mesmo valor não tem custo além da chamada HTTP local.
  setInterval(() => {
    void (async () => {
      const sessao = await capturarTokenExperience(tabs?.aba('experience'));
      if (sessao.presente) {
        const ok = await pushSessaoExperience({ usuario: sessao.usuario, token: sessao.token, expira: sessao.expIso });
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
    })();
  }, 15_000);
}

ipcMain.handle('layout:definirAlturaTopo', (_evt, altura: number) => {
  tabs?.definirAlturaTopo(altura);
  return { ok: true };
});

ipcMain.handle('tabs:mostrar', (_evt, id: string) => ({ ok: tabs?.mostrar(id) ?? false }));
ipcMain.handle('guias:estado', () => tabs?.guiasAbertas() ?? []);
ipcMain.handle('tabs:recarregar', (_evt, id: string) => ({ ok: tabs?.recarregar(id) ?? false }));
ipcMain.handle('links:fechar', (_evt, origin: string) => ({ ok: tabs?.fecharAbaCliente(origin) ?? false }));
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
  logEvento('user-agent-definido', { ua: app.userAgentFallback, icone: ICONE, iconeExiste: existsSync(ICONE) });

  // Primeiro de tudo: o aplicativo mudou de nome, e com ele a pasta de dados. Sem esta
  // migração o histórico, o cofre e o services.yaml do usuário ficariam na pasta antiga
  // e o app abriria vazio, parecendo perda de dados.
  migrarPastaDeDados();

  // Antes de tudo que lê configuração: numa instalação nova o `services.yaml` ainda só
  // existe dentro do pacote, e é aqui que ele vira arquivo do usuário.
  prepararArquivosDoUsuario();

  // Antes do backend: ele consulta credenciais logo no primeiro ciclo de checks, e o
  // cofre precisa já estar preenchido para o shell responder em vez de devolver vazio.
  await migrarCofreDoHelper();

  // Também antes do backend, e por um motivo que só apareceu rodando: o bridge vivia
  // dentro de `criarJanela`, que roda DEPOIS de `iniciarBackend`. O backend subia, fazia
  // a migração de segredos e as primeiras consultas de credencial sem ter com quem
  // falar — a migração cifrava pelo helper, o resultado saía sem a marca do shell e era
  // (corretamente) recusada, reportando tudo como pendente para sempre.
  //
  // O `AgendaFetcher` recebe uma função, não a aba: a janela ainda não existe aqui, e
  // quando existir ele passa a enxergá-la.
  const agenda = new AgendaFetcher(() => tabs?.aba('erp'));
  // O log de base de cliente sai da aba DAQUELA base (isolada por origin), não da aba ERP.
  const serverLog = new ServerLogFetcher((origin) => tabs?.abaCliente(origin));
  criarBridgeServer(agenda, () => tabs, serverLog);

  // Antes da janela: o painel é a primeira aba a carregar e apontaria para uma porta
  // fechada. Esperar aqui custa o tempo de boot do Fastify uma vez, e evita que a
  // primeira coisa que o usuário veja seja uma tela de erro de conexão.
  const backend = await iniciarBackend();
  if (backend.modo === 'falhou') {
    logEvento('backend-falhou-no-boot');
    dialog.showErrorBox('Development Switch — o backend não subiu', backend.erro);
  }

  criarJanela();
  montarMenu(() => janelaPrincipal, () => tabs);

  // Depois da janela e sem `await`: o aviso é útil, mas não é motivo para segurar a
  // abertura do aplicativo se o backend demorar a responder.
  void avisarAnotacoes();
  void avisarServerLog();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

let encerrando = false;
app.on('before-quit', (evento) => {
  // `pararBackend` é assíncrono e o Electron não espera handler nenhum: sem segurar o
  // quit aqui, o processo do backend sobraria órfão segurando a porta 4000, e a próxima
  // abertura do shell acharia que há "backend externo" no ar.
  if (encerrando) return;
  evento.preventDefault();
  encerrando = true;
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
