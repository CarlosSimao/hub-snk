/**
 * Ruffle (emulador de Flash) embutido nas abas do Sankhya.
 *
 * Algumas telas do Sankhya ainda sao Flex/SWF. Fora do DS o usuario abre essas telas no
 * Edge com a EXTENSAO do Ruffle — e funciona, o motor aguenta as telas. Aqui o motor e' o
 * mesmo (`@ruffle-rs/ruffle` 0.6.0, a versao da extensao em uso), mas embutido em vez de
 * carregado como extensao: a extensao depende de `declarativeNetRequest`, que o Electron
 * nao implementa, e de service worker de fundo, que ele implementa pela metade.
 *
 * O que a extensao faz e aqui se replica:
 *
 *  - injeta o Ruffle em TODOS os frames (`all_frames`). As telas do Sankhya rodam dentro
 *    de iframe; injetar so' na pagina de fora nao alcancaria o `<object>` do SWF;
 *  - o polyfill do Ruffle troca `<object>`/`<embed>` de Flash pelo player e anuncia um
 *    plugin Flash, para a tela nao cair no aviso de "instale o Flash".
 *
 * O momento importa: a tela Flex verifica se ha' Flash logo ao abrir. Por isso a
 * preparacao principal e' um PRELOAD (`preloadRuffle.ts`), no inicio de cada frame; a
 * injecao quando o frame termina de carregar ficou como reserva e como diagnostico.
 *
 * Os arquivos saem por um protocolo proprio (`ruffle://`), nao pelo backend HTTP: as abas
 * remotas nao tem ponte com o app (o preload nao expoe nada a pagina), e servir de
 * `http://localhost` quebraria nas bases com `upgrade-insecure-requests`, que viraria
 * `https://localhost`. O protocolo e' registrado por SESSAO — cada base de cliente tem a
 * sua particao, entao cada uma precisa do handler.
 */
import { app, ipcMain, protocol, webFrameMain, type Session, type WebContents } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize, sep } from 'node:path';
import { logEvento, origemSemQuery } from './log';

const ESQUEMA = 'ruffle';
const BASE = `${ESQUEMA}://player/`;

/** Precisa rodar ANTES do `app.ready` — e' regra do Electron para esquema privilegiado. */
export function registrarEsquemaRuffle(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ESQUEMA,
      // `secure`: a pagina do Sankhya e' https, e script de origem "insegura" seria
      // bloqueado. `supportFetchAPI` + `corsEnabled`: o Ruffle busca o `.wasm` por fetch.
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ]);
}

let pastaPacote: string | null | undefined;

/** Onde o `@ruffle-rs/ruffle` foi instalado — dentro do `app.asar` no pacote. */
function pastaRuffle(): string | null {
  if (pastaPacote !== undefined) return pastaPacote;
  try {
    pastaPacote = dirname(require.resolve('@ruffle-rs/ruffle/package.json'));
  } catch {
    pastaPacote = null;
    logEvento('ruffle-pacote-ausente');
  }
  return pastaPacote;
}

const TIPOS: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

const sessoesComProtocolo = new WeakSet<Session>();

/** Serve os arquivos do pacote em `ruffle://player/<arquivo>` nesta sessao. */
export function garantirProtocolo(sessao: Session): void {
  if (sessoesComProtocolo.has(sessao)) return;
  sessoesComProtocolo.add(sessao);

  sessao.protocol.handle(ESQUEMA, async (request) => {
    const raiz = pastaRuffle();
    if (!raiz) return new Response('ruffle não instalado', { status: 404 });

    const nome = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
    const alvo = normalize(join(raiz, nome));
    // Sem isto `ruffle://player/../../...` leria qualquer arquivo do pacote do app.
    if (!alvo.startsWith(raiz + sep) || nome.includes('..')) {
      return new Response('proibido', { status: 403 });
    }
    try {
      const corpo = await readFile(alvo);
      const extensao = alvo.slice(alvo.lastIndexOf('.'));
      return new Response(corpo, {
        headers: {
          'content-type': TIPOS[extensao] ?? 'application/octet-stream',
          // O script roda na ORIGEM da pagina do Sankhya; sem isto o fetch do `.wasm`
          // feito por ele seria barrado como requisicao de outra origem.
          'access-control-allow-origin': '*',
          'cache-control': 'max-age=86400',
        },
      });
    } catch {
      return new Response('não encontrado', { status: 404 });
    }
  });
}

// --- liga/desliga -------------------------------------------------------------------

function arquivoPreferencia(): string {
  return join(app.getPath('userData'), 'ruffle.json');
}

/** Ligado por padrao: quem abre tela Flex no Sankhya precisa dele, e quem nao abre nao percebe. */
export function ruffleAtivo(): boolean {
  try {
    const dados = JSON.parse(readFileSync(arquivoPreferencia(), 'utf8')) as { ativo?: unknown };
    return dados.ativo !== false;
  } catch {
    return true;
  }
}

export function definirRuffleAtivo(ativo: boolean): void {
  try {
    writeFileSync(arquivoPreferencia(), JSON.stringify({ ativo }, null, 2), 'utf8');
  } catch (err) {
    logEvento('ruffle-preferencia-nao-gravada', { erro: (err as Error).message });
  }
  logEvento('ruffle-alternado', { ativo });
}

// --- injecao --------------------------------------------------------------------------

/**
 * O que roda em cada frame. Idempotente: um frame pode terminar de carregar mais de uma
 * vez (navegacao interna), e o Ruffle carregado duas vezes duplica o player.
 *
 * `autoplay`/`unmuteOverlay`: tela de sistema nao e' video — o player tem de aparecer
 * pronto, sem o botao de "clique para tocar" que o Ruffle mostra por padrao.
 */
const SCRIPT_INJECAO = `(() => {
  try {
    // Ja' preparado pelo preload (o caminho normal): so' relata se o Ruffle chegou a
    // carregar — e' a prova, no log, de que a preparacao no inicio do frame funcionou.
    if (window.__hubRuffle) {
      const pronto = window.RufflePlayer && typeof window.RufflePlayer.newest === 'function';
      const flash = !!(navigator.plugins && navigator.plugins.namedItem && navigator.plugins.namedItem('Shockwave Flash'));
      return (window.__hubRuffleCedo ? 'preload' : 'reserva') + (pronto ? '-carregado' : '-carregando') + (flash ? '-flash-anunciado' : '-sem-flash');
    }
    window.__hubRuffle = true;
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = Object.assign({
      publicPath: ${JSON.stringify(BASE)},
      polyfills: true,
      favorFlash: false,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      splashScreen: false,
      warnOnUnsupportedContent: false,
      letterbox: 'on',
      allowScriptAccess: true
    }, window.RufflePlayer.config || {});
    // Espera o script de verdade: 'carregado' prova que o protocolo ruffle:// serviu o
    // arquivo DENTRO da pagina do Sankhya, que e' o que pode falhar (CSP, CORS).
    return new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = ${JSON.stringify(`${BASE}ruffle.js`)};
      s.async = false;
      s.onload = () => resolve(window.RufflePlayer && typeof window.RufflePlayer.newest === 'function' ? 'carregado' : 'carregado-sem-api');
      s.onerror = () => { window.__hubRuffle = false; resolve('falhou-ao-carregar'); };
      setTimeout(() => resolve('sem-resposta'), 10000);
      (document.head || document.documentElement).appendChild(s);
    });
  } catch (e) {
    return 'erro: ' + e;
  }
})()`;

function injetarNoFrame(processId: number, routingId: number): void {
  const frame = webFrameMain.fromId(processId, routingId);
  if (!frame) return;
  // Frame vazio (`about:blank`) e pagina interna do app nao tem Flash para trocar.
  if (!/^https?:/i.test(frame.url)) return;
  frame
    .executeJavaScript(SCRIPT_INJECAO, true)
    .then((resultado) => {
      logEvento('ruffle-injetado', { url: origemSemQuery(frame.url), resultado });
    })
    .catch((err: unknown) => {
      // Frame que navegou ou fechou entre o evento e a execucao: nada a fazer.
      logEvento('ruffle-injecao-falhou', { url: origemSemQuery(frame.url), erro: String(err) });
    });
}

/**
 * Liga o Ruffle numa aba (ou pop-up) do Sankhya: protocolo na sessao dela e injecao a
 * cada frame que termina de carregar, inclusive iframes que surgem depois.
 */
export function prepararRuffle(conteudo: WebContents): void {
  if (!pastaRuffle()) return;
  garantirProtocolo(conteudo.session);
  conteudo.on('did-frame-finish-load', (_evento, _principal, processId, routingId) => {
    if (!ruffleAtivo()) return;
    injetarNoFrame(processId, routingId);
  });
}

/**
 * O preload que prepara o Ruffle no INICIO de cada frame (ver `preloadRuffle.ts`). Vai
 * em `webPreferences.preload` das abas do Sankhya, junto de `nodeIntegrationInSubFrames`
 * — sem esta ultima o preload so' roda no frame principal, e as telas Flex vivem em iframe.
 */
export const PRELOAD_RUFFLE = join(__dirname, 'preloadRuffle.js');

/**
 * O preload pergunta, de forma sincrona, se o Ruffle esta' ligado. Resposta so' booleana:
 * com `nodeIntegrationInSubFrames` qualquer iframe da pagina manda esta mensagem, e nao
 * ha' nada nela alem do que o menu ja' mostra.
 */
export function registrarIpcRuffle(): void {
  ipcMain.on('ruffle:ativo', (evento) => {
    evento.returnValue = Boolean(pastaRuffle()) && ruffleAtivo();
  });
}

/** Para o diagnostico: o pacote esta' la' e com o arquivo que a pagina vai pedir? */
export function ruffleDisponivel(): boolean {
  const raiz = pastaRuffle();
  return Boolean(raiz && existsSync(join(raiz, 'ruffle.js')));
}
