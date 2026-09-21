'use strict';

/**
 * PoC de viabilidade — Sankhya Hub Desktop (Electron).
 *
 * Isolada de propósito: perfil próprio, dependências próprias, sem tocar no app
 * principal. Não é o produto final — é o experimento da Fase 1 da especificação
 * (docs/specs/sankhya-hub-desktop-especificacao.md).
 *
 * Reaproveita contratos reais em vez de inventar endpoint:
 *  - Agenda: mesmo serviceName/params que scripts/hub-helper.ps1 (Get-AgendaRecursos),
 *    executado por fetch same-origin DENTRO da aba ERP (WebContentsView), e o resultado
 *    é entregue à rota REAL e já existente do backend, POST /api/agenda/importar.
 *  - Experience: mesmas rotas e payloads que src/sankhya/experience.ts, autenticadas
 *    com o JWT capturado do localStorage da aba Experience.
 */

const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require('electron');
const path = require('node:path');
const { logEvento, registrarResultado } = require('./report');

const HUB_URL = process.env.POC_HUB_URL || 'http://localhost:4000';
const ERP_URL = 'https://skw.sankhya.com.br/mge/';
const EXPERIENCE_URL = 'https://experience.sankhya.com.br/';
const EXPERIENCE_API = 'https://d83n39pk6d.execute-api.sa-east-1.amazonaws.com/prod';

/** Domínios cujos cookies interessam ao diagnóstico do ERP — igual ao hub-helper.ps1. */
const DOMINIOS_ERP = ['sankhya.com.br'];

/** Partição isolada e persistente, exclusiva desta PoC — nunca o perfil pessoal. */
const PARTICAO = 'persist:sankhya-hub-desktop-poc';

/** Domínios autorizados a abrir pop-up de dentro das abas remotas (SSO). */
const DOMINIOS_POPUP_PERMITIDOS = [
  'sankhya.com.br',
  'login.microsoftonline.com',
  'accounts.google.com',
  'amazonaws.com',
];

function origemPermitida(url, lista) {
  try {
    const host = new URL(url).hostname;
    return lista.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

if (!app.requestSingleInstanceLock()) {
  // app.quit() só agenda o encerramento — sem sair aqui, o resto do módulo (criação de
  // janela, registro de ipcMain.handle) ainda rodaria nesta segunda instância antes do
  // quit surtir efeito, duplicando abas e derrubando o processo por handler repetido.
  logEvento('instancia-secundaria-recusada');
  app.quit();
  process.exit(0);
}

/**
 * Perfil descartável (Rodada 3, pedido explícito): compara o erro do ERP num diretório
 * de dados NOVO, sem cookie/cache/Service Worker herdado, contra o perfil persistente
 * de sempre — sem apagar o perfil existente em nenhum dos dois casos.
 */
const PERFIL_DESCARTAVEL = process.env.POC_PERFIL_DESCARTAVEL === '1';
const PASTA_PERFIL = PERFIL_DESCARTAVEL
  ? path.join(require('node:os').tmpdir(), `sankhya-hub-poc-descartavel-${Date.now()}`)
  : path.join(__dirname, '..', '.perfil');
app.setPath('userData', PASTA_PERFIL);

/**
 * Diagnóstico de download/PDF (Seção 5.2/Teste 10): registra que o mecanismo disparou
 * e onde o arquivo foi salvo, sem interceptar nem alterar o comportamento padrão do
 * Electron (que já salva em Downloads sem exigir handler nosso).
 */
function registrarDownload(sessaoRotulo) {
  return (_evt, item, webContentsOrigem) => {
    logEvento('download-iniciado', {
      sessao: sessaoRotulo,
      nome: item.getFilename(),
      mime: item.getMimeType(),
      urlOrigem: origemSemQuery(item.getURL()),
      bytesTotais: item.getTotalBytes(),
    });
    item.once('done', (_e2, estado) => {
      logEvento('download-concluido', { sessao: sessaoRotulo, nome: item.getFilename(), estado, salvoEm: item.getSavePath() });

      // UX real observada: um pop-up aberto só para servir um download (download.mge)
      // não navega para lugar nenhum depois — fica em branco na tela até o usuário
      // fechar na mão. Se essa janela é uma das nossas filhas de pop-up, fecha sozinha.
      for (const filha of janelasFilhas) {
        if (!filha.isDestroyed() && filha.webContents === webContentsOrigem) {
          filha.close();
          logEvento('popup-janela-filha-fechada-pos-download', { nome: item.getFilename() });
          break;
        }
      }
    });
  };
}

/** @type {Map<string, WebContentsView>} */
const abas = new Map();
/** @type {BrowserWindow | null} */
let janelaPrincipal = null;
/** Referência forte às janelas filhas (pop-up), pra não serem coletadas em pleno uso. */
const janelasFilhas = new Set();

/**
 * Hostnames dos ERPs de clientes cadastrados no cofre real (`GET /api/clientes`,
 * campo `sankhyaUrl`) — carregado uma vez do backend já existente, nunca inventado.
 * Só esses hosts ganham aba interna; qualquer outra URL genérica continua sem
 * privilégio nenhum, como antes.
 */
const origensClientesCadastrados = new Set();

async function carregarOrigensClientesCadastrados() {
  try {
    const resposta = await fetch(`${HUB_URL}/api/clientes`, { signal: AbortSignal.timeout(5000) });
    const corpo = await resposta.json();
    for (const cliente of corpo.clientes ?? []) {
      if (!cliente.sankhyaUrl) continue;
      try {
        origensClientesCadastrados.add(new URL(cliente.sankhyaUrl).hostname);
      } catch {
        /* URL de cadastro inválida — ignora, não é motivo pra travar a PoC */
      }
    }
    logEvento('links-clientes-carregados', { total: origensClientesCadastrados.size });
  } catch (err) {
    logEvento('links-clientes-falhou-carregar', { erro: String(err) });
  }
}

/** Partição EFÊMERA (sem `persist:`) e SEM preload — nunca a sessão/bridge de integração. */
const LINK_PARTITION = 'sankhya-hub-desktop-poc-links-sem-privilegio';
/** @type {WebContentsView | null} */
let abaLinkAtual = null;

function abrirAbaLink(url) {
  if (!janelaPrincipal) return;
  if (abaLinkAtual) {
    janelaPrincipal.contentView.removeChildView(abaLinkAtual);
    abas.delete('link');
    abaLinkAtual = null;
  }
  const view = new WebContentsView({
    webPreferences: {
      partition: LINK_PARTITION,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // Sem preload: link de cadastro não é integração, não ganha bridge nenhuma.
    },
  });
  view.webContents.on('did-finish-load', () => {
    logEvento('aba-link-carregada', { url: origemSemQuery(view.webContents.getURL()) });
  });
  // Link de cadastro não abre OUTRO pop-up com privilégio — nega tudo por padrão.
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.loadURL(url);
  janelaPrincipal.contentView.addChildView(view);
  abas.set('link', view);
  abaLinkAtual = view;
  reposicionarAbas();
  janelaPrincipal.webContents.send('links:aba-aberta', origemSemQuery(url));
  mostrarAba('link');
}

function fecharAbaLink() {
  if (!abaLinkAtual || !janelaPrincipal) return { ok: false };
  janelaPrincipal.contentView.removeChildView(abaLinkAtual);
  abas.delete('link');
  abaLinkAtual = null;
  mostrarAba('hub');
  janelaPrincipal.webContents.send('links:aba-fechada');
  return { ok: true };
}

/** Token da Experience só vive em memória do processo principal — nunca no renderer. */
let experienceTokenCache = { token: '', expIso: '', capturadoEm: 0 };

/** Serializa `agenda.fetch`: uma requisição por vez, igual ao helper PS1 atual. */
let filaAgenda = Promise.resolve();

/** Altura da barra local (abas + painel de testes), informada pela própria UI. */
let topoAltura = 96;
let reposicionarAbas = () => {};

function jsonEscape(valor) {
  return JSON.stringify(valor);
}

/** Origem + caminho, sem querystring — evita logar token/segredo que viaje na URL. */
function origemSemQuery(urlTexto) {
  try {
    const u = new URL(urlTexto);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[url inválida]';
  }
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`. Igual a src/routesAgenda.ts#paraFormatoSankhya. */
function paraFormatoSankhya(data) {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data ?? '');
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '';
}

function criarJanela() {
  janelaPrincipal = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Sankhya Hub Desktop — PoC de viabilidade',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  janelaPrincipal.loadFile(path.join(__dirname, '..', 'index.html'));

  function criarAba(id, url) {
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTICAO,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        // Nenhum preload nas abas remotas: zero bridge para conteúdo de fora.
      },
    });
    view.webContents.on('did-fail-load', (_e, code, desc, url2) => {
      logEvento('aba-falha-carregar', { id, code, desc, url: url2 });
    });
    view.webContents.on('did-finish-load', () => {
      logEvento('aba-carregada', { id, url: origemSemQuery(view.webContents.getURL()) });
    });
    // Diagnóstico: a mensagem/arquivo/linha de console.error da página real ajuda a
    // entender incompatibilidades (ex.: script que só existe fora do Electron).
    view.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      if (level >= 2) {
        logEvento('aba-console', { id, level, message, line, sourceId: origemSemQuery(sourceId || '') });
      }
    });
    // Diagnóstico dirigido (Rodada 3): stack real da exceção via CDP, sem precisar de
    // DevTools aberto manualmente — resolve "capturar stack da exceção" pedido pelo
    // usuário sem exigir alguém sentado no teclado olhando o Console.
    if (id === 'erp') {
      try {
        view.webContents.debugger.attach('1.3');
        view.webContents.debugger.sendCommand('Runtime.enable');
        view.webContents.debugger.on('message', (_evtDbg, method, params) => {
          if (method === 'Runtime.exceptionThrown') {
            const detalhe = params?.exceptionDetails ?? {};
            const frames = (detalhe.stackTrace?.callFrames ?? []).map(
              (f) => `${origemSemQuery(f.url || '[inline]')}:${f.lineNumber}:${f.columnNumber} ${f.functionName || '(anon)'}`,
            );
            logEvento('erp-excecao-stack-cdp', {
              texto: detalhe.exception?.description || detalhe.text,
              urlOrigem: origemSemQuery(detalhe.url || ''),
              linha: detalhe.lineNumber,
              coluna: detalhe.columnNumber,
              stack: frames,
            });
          }
        });
      } catch (err) {
        logEvento('erp-debugger-falhou-anexar', { erro: String(err) });
      }
      // Correlaciona o alert() nativo com o console: intercepta só pra logar o texto
      // antes de deixar o alert nativo seguir — não substitui, não suprime, não muda
      // comportamento visível ao usuário.
      view.webContents.on('dom-ready', () => {
        view.webContents
          .executeJavaScript(
            `(() => {
              if (window.__pocAlertPatched) return;
              window.__pocAlertPatched = true;
              const original = window.alert;
              window.alert = function (msg) {
                console.error('[ALERT-CAPTURADO-POC] ' + String(msg));
                return original.call(window, msg);
              };
            })()`,
          )
          .catch(() => {});
      });
    }
    view.webContents.setWindowOpenHandler(({ url: alvo }) => {
      // Links de clientes cadastrados (ERP de cada cliente, não o ERP interno da
      // Sankhya) clicados na tela do Hub NÃO são SSO — iam parar negados pela lista
      // branca de pop-up até esta rodada. Ganham caminho próprio: aba interna com
      // sessão efêmera e SEM preload, nunca a partição/bridge de integração.
      let hostAlvo = '';
      try {
        hostAlvo = new URL(alvo).hostname;
      } catch {
        /* URL inválida cai no fluxo de negação padrão abaixo */
      }
      if (id === 'hub' && origensClientesCadastrados.has(hostAlvo)) {
        logEvento('link-cliente-solicitado', { alvo: origemSemQuery(alvo) });
        abrirAbaLink(alvo);
        return { action: 'deny' }; // a navegação real acontece na aba própria, não aqui
      }
      const permitido = origemPermitida(alvo, DOMINIOS_POPUP_PERMITIDOS);
      logEvento('popup-solicitado', { id, alvo, permitido });
      if (!permitido) return { action: 'deny' };
      // Janela filha do próprio app, mesma partição — preserva sessão/SSO.
      return {
        action: 'allow',
        createWindow: (options) => {
          const filha = new BrowserWindow({
            ...options,
            webPreferences: {
              ...options.webPreferences,
              partition: PARTICAO,
              contextIsolation: true,
              sandbox: true,
              nodeIntegration: false,
              webSecurity: true,
              preload: undefined,
            },
          });
          // Sem isto, a `BrowserWindow` fica sem nenhuma referência forte e o Electron
          // pode coletá-la (GC) antes da navegação/download terminar — é o próprio
          // aviso da documentação do Electron sobre `createWindow`. Foi o que
          // provavelmente aconteceu com o link real de download testado nesta rodada
          // (`download.mge`): pop-up abriu (`permitido:true`), mas nenhum
          // `will-download` chegou a disparar.
          janelasFilhas.add(filha);
          filha.on('closed', () => janelasFilhas.delete(filha));
          logEvento('popup-aberto-janela-filha', { id, alvo });
          return filha.webContents;
        },
      };
    });
    view.webContents.loadURL(url);
    janelaPrincipal.contentView.addChildView(view);
    abas.set(id, view);
    return view;
  }

  criarAba('hub', HUB_URL);
  criarAba('erp', ERP_URL);
  criarAba('experience', EXPERIENCE_URL);

  /**
   * Exercício SINTÉTICO do mecanismo de pop-up (não é SSO real — nenhum login usado
   * até agora precisou de `window.open`). Só roda com `POC_AUTOTEST_POPUP=1`, fora do
   * caminho normal da UI, para provar que `setWindowOpenHandler` de fato abre janela
   * filha na mesma partição para domínio permitido. Ver relatório: evidência separada
   * da de SSO real.
   */
  if (process.env.POC_AUTOTEST_POPUP === '1') {
    setTimeout(() => {
      const erp = abas.get('erp');
      erp?.webContents.executeJavaScript(
        "window.open('https://login.microsoftonline.com/common/oauth2/authorize?poc=sintetico', '_blank', 'width=400,height=400')",
      );
    }, 2500);
  }

  function reposicionar() {
    const [w, h] = janelaPrincipal.getContentSize();
    for (const view of abas.values()) {
      view.setBounds({ x: 0, y: topoAltura, width: w, height: Math.max(0, h - topoAltura) });
    }
  }
  janelaPrincipal.on('resize', reposicionar);
  reposicionarAbas = reposicionar;
  reposicionar();

  mostrarAba('hub');
}

ipcMain.handle('layout:definirAlturaTopo', (_evt, altura) => {
  topoAltura = Math.max(40, Math.round(Number(altura) || topoAltura));
  reposicionarAbas();
  return { ok: true, topoAltura };
});

function mostrarAba(id) {
  for (const [outroId, view] of abas.entries()) {
    view.setVisible(outroId === id);
  }
  logEvento('aba-ativada', { id });
}

// --- diagnóstico de sessão (nunca devolve valor de cookie/token) -----------------

async function diagnosticoCookiesErp() {
  const ses = session.fromPartition(PARTICAO);
  const todos = [];
  // `{ domain }` filtra pelo campo domain armazenado no cookie e perdeu o cookie de
  // sessão real (host-only, ex. JSESSIONID) numa medição real — só voltavam os cookies
  // de analytics (_ga/_gid, domain=".sankhya.com.br"). `{ url }` reproduz o que o
  // Chromium mandaria numa requisição de verdade para aquela URL (inclui HttpOnly,
  // Secure, host-only e domain-cookie), que é o filtro documentado como confiável.
  for (const dominio of DOMINIOS_ERP) {
    const encontrados = await ses.cookies.get({ domain: dominio });
    todos.push(...encontrados);
  }
  const porUrl = await ses.cookies.get({ url: ERP_URL });
  todos.push(...porUrl);
  const unicos = new Map(todos.map((c) => [`${c.domain}|${c.name}|${c.path}`, c]));
  const lista = [...unicos.values()];
  return {
    total: lista.length,
    httpOnly: lista.filter((c) => c.httpOnly).length,
    seguros: lista.filter((c) => c.secure).length,
    dominios: [...new Set(lista.map((c) => c.domain))],
    nomes: lista.map((c) => c.name), // nomes não são segredo; valores nunca saem daqui
  };
}

// --- agenda.fetch: operação fixa, tipada, dentro da aba ERP ----------------------

function scriptAgendaFetch(de, ate) {
  const corpo = JSON.stringify({
    serviceName: 'AgendaRecursosSP.carregarAgendas',
    requestBody: {
      params: {
        filter: {},
        start: de,
        end: ate,
        filtroRapido: {},
        mostraUsuarioLogado: false,
        resourceId: 'br.com.sankhya.os.mov.agenda.recursos',
        resourceIdListaUsuarios: 'br.com.sankhya.os.mov.agenda.recursos.list.Executante',
      },
      clientEventList: { clientEvent: [{ $: 'br.com.sankhya.mgeserv.event.envio.email' }] },
    },
  });
  const url =
    '/mgeos/service.sbr?serviceName=AgendaRecursosSP.carregarAgendas&counter=1&application=AgendaRecursos&outputType=json&preventTransform=';
  // IIFE assíncrona: mesma forma de chamada que scripts/hub-helper.ps1#Get-AgendaRecursos,
  // só que via fetch nativo do Chromium hospedado, não via CDP externo.
  return `(async () => {
    try {
      const r = await fetch(${jsonEscape(url)}, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: ${jsonEscape(corpo)},
        credentials: 'same-origin',
      });
      const texto = await r.text();
      return { ok: true, status: r.status, conteudo: texto };
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  })()`;
}

async function executarAgendaFetch(de, ate) {
  const view = abas.get('erp');
  if (!view) return { ok: false, erro: 'aba ERP não existe' };

  const url = view.webContents.getURL();
  if (!origemPermitida(url, DOMINIOS_ERP)) {
    return { ok: false, erro: `aba ERP não está na origem esperada (está em ${origemSemQuery(url)})` };
  }

  const resultado = await view.webContents.executeJavaScript(scriptAgendaFetch(de, ate), true);
  if (!resultado.ok) return { ok: false, erro: resultado.erro };

  const texto = resultado.conteudo ?? '';
  if (!texto) return { ok: false, erro: 'a guia não devolveu nada — sessão do ERP pode ter expirado' };
  if (texto.trimStart().startsWith('<')) {
    return { ok: false, erro: 'o Sankhya respondeu HTML, não JSON — faça login na aba ERP' };
  }
  return { ok: true, conteudo: texto };
}

/**
 * Simula backend indisponível (Rodada 3, item 4) mirando uma porta isolada que não
 * escuta, sem nunca parar o container Docker compartilhado (`sankhya-hub`, usado por
 * outras sessões). Alternável em runtime — não precisa reiniciar o app nem perder a
 * sessão logada do ERP para testar a recuperação depois.
 */
let backendForcadoIndisponivel = false;

/** Entrega o JSON capturado à rota REAL e já existente do backend — reuso, não invenção. */
async function importarNoBackend(conteudo) {
  const alvo = backendForcadoIndisponivel ? 'http://127.0.0.1:4099' : HUB_URL;
  const resposta = await fetch(`${alvo}/api/agenda/importar`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conteudo }),
    signal: AbortSignal.timeout(15_000),
  });
  const corpo = await resposta.json().catch(() => ({}));
  return { httpStatus: resposta.status, corpo };
}

ipcMain.handle('diag:definirBackendIndisponivel', (_evt, valor) => {
  backendForcadoIndisponivel = Boolean(valor);
  logEvento('backend-indisponivel-forcado', { ativo: backendForcadoIndisponivel });
  return { ativo: backendForcadoIndisponivel };
});

ipcMain.handle('agenda:fetch', async (_evt, args) => {
  const de = paraFormatoSankhya(String(args?.de ?? ''));
  const ate = paraFormatoSankhya(String(args?.ate ?? ''));
  if (!de || !ate) return { ok: false, erro: 'informe { de, ate } em YYYY-MM-DD' };

  const execucao = (filaAgenda = filaAgenda.then(() => executarAgendaFetch(de, ate)));
  const resultado = await execucao;
  logEvento('agenda-fetch', { de, ate, ok: resultado.ok, erro: resultado.erro, bytes: resultado.conteudo?.length });

  if (!resultado.ok) return resultado;

  try {
    const importado = await importarNoBackend(resultado.conteudo);
    logEvento('agenda-importar-backend', importado);
    return { ok: true, bytes: resultado.conteudo.length, backend: importado };
  } catch (err) {
    logEvento('agenda-importar-backend-falhou', { erro: String(err) });
    return { ok: true, bytes: resultado.conteudo.length, backend: null, backendErro: String(err) };
  }
});

// --- Experience: captura de token e leitura real via API -------------------------

function decodificarExpJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!json.exp) return '';
    return new Date(json.exp * 1000).toISOString();
  } catch {
    return '';
  }
}

ipcMain.handle('experience:capturarToken', async () => {
  const view = abas.get('experience');
  if (!view) return { presente: false, erro: 'aba Experience não existe' };

  const url = view.webContents.getURL();
  if (!origemPermitida(url, ['sankhya.com.br'])) {
    return { presente: false, erro: `aba Experience não está na origem esperada (${origemSemQuery(url)})` };
  }

  const token = await view.webContents.executeJavaScript(
    "(() => { try { return window.localStorage.getItem('token') || ''; } catch (e) { return ''; } })()",
    true,
  );
  if (!token) {
    experienceTokenCache = { token: '', expIso: '', capturadoEm: 0 };
    logEvento('experience-token-capturado', { presente: false });
    return { presente: false };
  }
  const expIso = decodificarExpJwt(token);
  experienceTokenCache = { token, expIso, capturadoEm: Date.now() };
  logEvento('experience-token-capturado', { presente: true, expIso });
  return { presente: true, expIso };
});

async function chamarExperience(caminhoOuUrl, init = {}) {
  if (!experienceTokenCache.token) {
    throw new Error('sem token capturado — capture a sessão da Experience primeiro');
  }
  const url = caminhoOuUrl.startsWith('http') ? caminhoOuUrl : `${EXPERIENCE_API}${caminhoOuUrl}`;
  const resposta = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${experienceTokenCache.token}`,
      ...init.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (resposta.status === 401 || resposta.status === 403) {
    throw new Error('a Experience recusou a sessão — token expirado ou inválido');
  }
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok || corpo?.response?.error) {
    throw new Error(corpo?.response?.message ?? `Experience respondeu HTTP ${resposta.status}`);
  }
  return corpo;
}

/** Mesma consulta que src/sankhya/experience.ts#tarefas — payload e endpoint idênticos. */
ipcMain.handle('experience:tarefas', async (_evt, args) => {
  const projetoId = Number(args?.projetoId);
  const personId = Number(args?.personId);
  if (!Number.isInteger(projetoId) || !Number.isInteger(personId)) {
    return { ok: false, erro: 'informe projetoId e personId numéricos' };
  }
  try {
    const corpo = await chamarExperience(`/tasks/filtering/implantation/${projetoId}/person/${personId}`, {
      method: 'POST',
      body: JSON.stringify({
        columns: [],
        page: 1,
        length: 100,
        order: {},
        filters: { status: ['Hoje', 'Futura', 'Atrasada'], users: [personId] },
      }),
    });
    const linhas = corpo?.data?.result ?? [];
    const resultado = {
      ok: true,
      total: linhas.length,
      amostra: linhas.slice(0, 3).map((l) => ({
        id: l.id,
        procedimento: l.procedure_name,
        taskStatus: l.task_status,
        taskDate: l.task_date,
      })),
    };
    logEvento('experience-tarefas', { projetoId, personId, total: resultado.total });
    return resultado;
  } catch (err) {
    logEvento('experience-tarefas-falhou', { projetoId, personId, erro: String(err) });
    return { ok: false, erro: String(err) };
  }
});

// --- IPC do shell (tabs, diagnóstico, restart) ------------------------------------

ipcMain.handle('tabs:mostrar', (_evt, id) => {
  if (!abas.has(id)) return { ok: false };
  mostrarAba(id);
  return { ok: true };
});

ipcMain.handle('tabs:recarregar', (_evt, id) => {
  const view = abas.get(id);
  if (!view) return { ok: false };
  view.webContents.reload();
  return { ok: true };
});

ipcMain.handle('diag:cookiesErp', async () => diagnosticoCookiesErp());

ipcMain.handle('diag:statusExperienceToken', () => ({
  presente: Boolean(experienceTokenCache.token),
  expIso: experienceTokenCache.expIso,
  capturadoEm: experienceTokenCache.capturadoEm,
}));

ipcMain.handle('diag:limparSessaoExperience', () => {
  experienceTokenCache = { token: '', expIso: '', capturadoEm: 0 };
  logEvento('experience-token-limpo');
  return { ok: true };
});

ipcMain.handle('report:registrar', (_evt, { testeId, status, detalhe }) =>
  registrarResultado(testeId, status, detalhe ?? {}),
);

ipcMain.handle('report:log', (_evt, { evento, dados }) => logEvento(evento, dados ?? {}));

/** Teste 12 da especificação: página remota não pode chamar a bridge privilegiada. */
ipcMain.handle('diag:isolamentoBridge', async () => {
  const resultado = {};
  for (const id of ['erp', 'experience']) {
    const view = abas.get(id);
    if (!view) {
      resultado[id] = 'aba inexistente';
      continue;
    }
    // Checa a ASSINATURA da bridge (window.hub.tabs.mostrar), não só o nome: o site
    // remoto pode ter seu próprio `window.hub` por coincidência de nome, o que daria
    // falso positivo se checássemos só `typeof window.hub`.
    const tipos = await view.webContents.executeJavaScript(
      `JSON.stringify({
        hub: typeof window.hub,
        hubENossaBridge: typeof window.hub?.tabs?.mostrar === 'function' && typeof window.hub?.report?.registrar === 'function',
        ipcRenderer: typeof window.ipcRenderer,
        require: typeof window.require,
      })`,
      true,
    );
    resultado[id] = JSON.parse(tipos);
  }
  const isolado = Object.values(resultado).every(
    (r) => !r.hubENossaBridge && r.ipcRenderer === 'undefined' && r.require === 'undefined',
  );
  logEvento('diag-isolamento-bridge', { resultado, isolado });
  return { isolado, detalhe: resultado };
});

ipcMain.handle('links:abrirExterno', (_evt, url) => {
  if (!/^https?:\/\//.test(url)) return { ok: false, erro: 'url inválida' };
  logEvento('link-externo-aberto', { url });
  shell.openExternal(url);
  return { ok: true };
});

app.whenReady().then(() => {
  logEvento('app-pronto', { perfilDescartavel: PERFIL_DESCARTAVEL, pastaPerfil: PASTA_PERFIL });

  session.fromPartition(PARTICAO).on('will-download', registrarDownload(PARTICAO));
  // Defensivo: um download real (.docx, confirmado pelo usuário — diálogo Salvar
  // apareceu e o arquivo foi salvo) não apareceu no log da partição. Hipótese: a
  // navegação que o `createWindow` do pop-up inicia pode, na janela de tempo entre
  // `setWindowOpenHandler` e a `BrowserWindow` customizada assumir, rodar brevemente na
  // `defaultSession` — por isso também escuto aqui, sem alterar o comportamento (o
  // diálogo nativo do Electron já salva o arquivo sozinho de qualquer forma).
  session.defaultSession.on('will-download', registrarDownload('default'));

  criarJanela();
  carregarOrigensClientesCadastrados();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

ipcMain.handle('links:fecharAbaCliente', () => fecharAbaLink());

// --- OS de homologação: SEMPRE via rotas reais e já existentes do backend --------
// Nenhuma regra de negócio (payload bruto, date_done, response.error, revalidação)
// é reimplementada aqui — só repassa para src/routesExperience.ts, que já faz tudo
// isso. Backend precisa do helper (hub-helper.ps1) com sessão Experience capturada,
// porque é o backend quem detém a credencial usada por essas rotas — não o JWT que
// esta PoC captura para si mesma (são dois provedores propositalmente separados
// nesta fase, ver Seção 7 da especificação).

/** Passo 1: só leitura, nenhuma OS é criada. Espelha POST /api/experience/os/preparar. */
ipcMain.handle('os:preparar', async (_evt, { clienteId, tarefaIds }) => {
  try {
    const resposta = await fetch(`${HUB_URL}/api/experience/os/preparar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clienteId, tarefaIds }),
      signal: AbortSignal.timeout(30_000),
    });
    const corpo = await resposta.json().catch(() => ({}));
    logEvento('os-preparar', { clienteId, tarefaIds, httpStatus: resposta.status });
    return { httpStatus: resposta.status, corpo };
  } catch (err) {
    logEvento('os-preparar-falhou', { clienteId, erro: String(err) });
    return { httpStatus: 0, corpo: { error: String(err) } };
  }
});

/**
 * Passo 2: CRIA a OS de verdade. Só chamada pela UI depois de o usuário digitar a
 * frase de confirmação exata — ver renderer.js. `enviarParaAprovacao` sempre falso
 * nesta rodada (aceite/e-mail exigem confirmação própria, separada, que não foi dada).
 */
ipcMain.handle('os:criar', async (_evt, payload) => {
  const corpoEnviado = { ...payload, enviarParaAprovacao: false };
  try {
    const resposta = await fetch(`${HUB_URL}/api/experience/os`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpoEnviado),
      signal: AbortSignal.timeout(30_000),
    });
    const corpo = await resposta.json().catch(() => ({}));
    // Nunca repetir automaticamente: registra o resultado, qualquer que seja, e para.
    logEvento('os-criar', { clienteId: payload.clienteId, tarefaIds: payload.tarefaIds, dia: payload.dia, httpStatus: resposta.status, corpo });
    return { httpStatus: resposta.status, corpo };
  } catch (err) {
    // Timeout/erro de rede: resultado INDETERMINADO, nunca sucesso. Quem chama não
    // deve tentar de novo sozinho — precisa verificar no Experience real primeiro.
    logEvento('os-criar-indeterminado', { clienteId: payload.clienteId, erro: String(err) });
    return { httpStatus: 0, corpo: { error: String(err), indeterminado: true } };
  }
});

/** Uma chamada por vez — trava servidor-side contra clique duplo/reabertura do modal. */
let aceiteEmAndamentoOrderId = null;

/**
 * Passo 3: aceite/e-mail de uma OS JÁ CRIADA — nunca recria. Chama a rota REAL nova
 * (`POST /api/experience/os/:orderId/aceite`, que já valida identidade servidor-side
 * antes de escrever). `enviarEmail` só é repassado se o usuário marcou explicitamente
 * a caixa própria de e-mail na UI — nunca fica implícito aqui.
 */
ipcMain.handle('os:gerarAceite', async (_evt, { orderId, clienteId, enviarEmail }) => {
  if (aceiteEmAndamentoOrderId === orderId) {
    return { httpStatus: 0, corpo: { error: 'já existe um envio em andamento para esta OS', bloqueadoPorConcorrencia: true } };
  }
  aceiteEmAndamentoOrderId = orderId;
  try {
    const resposta = await fetch(`${HUB_URL}/api/experience/os/${orderId}/aceite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clienteId, enviarEmail: enviarEmail === true }),
      signal: AbortSignal.timeout(30_000),
    });
    const corpo = await resposta.json().catch(() => ({}));
    logEvento('os-aceite', { orderId, clienteId, enviarEmail: enviarEmail === true, httpStatus: resposta.status, corpo });
    return { httpStatus: resposta.status, corpo };
  } catch (err) {
    logEvento('os-aceite-indeterminado', { orderId, clienteId, erro: String(err) });
    return { httpStatus: 0, corpo: { error: String(err), indeterminado: true } };
  } finally {
    aceiteEmAndamentoOrderId = null;
  }
});

app.on('window-all-closed', () => {
  logEvento('todas-janelas-fechadas');
  if (process.platform !== 'darwin') app.quit();
});

app.on('second-instance', () => {
  logEvento('segunda-instancia-focada');
  if (janelaPrincipal) {
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.focus();
  }
});
