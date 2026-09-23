/// <reference lib="dom" />
/**
 * Preload das abas do Sankhya: prepara o Ruffle ANTES de qualquer script da página.
 *
 * Por que preload, e não injeção quando o frame termina de carregar: as telas Flex do
 * Sankhya verificam se existe Flash logo ao abrir. Sem Flash anunciado nessa hora, a tela
 * desiste e mostra "Oops :( Parece que seu Flash Player está desabilitado" em vez de
 * montar o `<object>` do SWF — e o Ruffle, chegando depois, não tem o que substituir.
 * É por isso que a extensão do Ruffle roda em `document_start`; isto é o equivalente.
 *
 * O que NÃO muda: a página continua sem ponte nenhuma com o app. Nada é exposto no
 * `window` dela (sem `exposeInMainWorld`); o preload só EXECUTA código no contexto da
 * página, e o único IPC (saber se o Ruffle está ligado) acontece aqui, no mundo isolado,
 * fora do alcance dos scripts do Sankhya.
 *
 * Autocontido de propósito: preload em sandbox só pode importar `electron`, nenhum
 * arquivo local — por isso a URL base está repetida aqui (ver `ruffle.ts`).
 */
import { contextBridge, ipcRenderer } from 'electron';

const BASE = 'ruffle://player/';

let ativo = false;
try {
  ativo = ipcRenderer.sendSync('ruffle:ativo') === true;
} catch {
  // Sem resposta do processo principal: melhor sem Ruffle do que travar a página.
}

/**
 * Roda NO CONTEXTO DA PÁGINA, serializada: nada de fora dela existe lá dentro — tudo que
 * ela usa precisa estar no próprio corpo ou vir por `args`.
 */
function prepararNaPagina(base: string): string {
  const w = window as unknown as Record<string, unknown> & { RufflePlayer?: { config?: Record<string, unknown> } };
  if (w['__hubRuffleCedo']) return 'ja';
  w['__hubRuffleCedo'] = true;

  // 1. Config antes do `ruffle.js`. `favorFlash: false`: o Ruffle desiste de atuar se
  //    achar que há um Flash "de verdade" — e o plugin anunciado abaixo pareceria um.
  w.RufflePlayer = w.RufflePlayer || {};
  w.RufflePlayer.config = Object.assign(
    {
      publicPath: base,
      polyfills: true,
      favorFlash: false,
      autoplay: 'on',
      unmuteOverlay: 'hidden',
      splashScreen: false,
      warnOnUnsupportedContent: false,
      letterbox: 'on',
      allowScriptAccess: true,
    },
    w.RufflePlayer.config || {},
  );

  // 2. Plugin Flash anunciado JÁ — é o que a verificação da tela procura. Mesmos nomes,
  //    tipos e descrição que o Ruffle usa; `filename: 'ruffle.js'` é o que o próprio
  //    Ruffle reconhece como ele mesmo (e não como Flash real que o faria desistir).
  try {
    const plugin: Record<string | number, unknown> = {
      name: 'Shockwave Flash',
      description: 'Shockwave Flash 32.0 r0',
      filename: 'ruffle.js',
    };
    const mimes = [
      ['application/futuresplash', 'spl'],
      ['application/x-shockwave-flash', 'swf'],
      ['application/x-shockwave-flash2-preview', 'swf'],
      ['application/vnd.adobe.flash.movie', 'swf'],
    ].map(([type, suffixes]) => ({ type, suffixes, description: 'Shockwave Flash', enabledPlugin: plugin }));
    mimes.forEach((m, i) => {
      plugin[i] = m;
    });
    plugin['length'] = mimes.length;
    plugin['item'] = (i: number) => mimes[i] || null;
    plugin['namedItem'] = (n: string) => mimes.find((m) => m.type === n) || null;

    // Lista no formato de PluginArray/MimeTypeArray: índice, nome, `item`, `namedItem`.
    // Mantém o que o navegador já tinha (o leitor de PDF, por exemplo).
    const lista = (original: ArrayLike<unknown> | undefined, extras: object[], chave: string) => {
      const itens: Record<string, unknown>[] = [];
      for (let i = 0; i < (original ? original.length : 0); i += 1) {
        itens.push((original as ArrayLike<Record<string, unknown>>)[i]!);
      }
      for (const e of extras as Record<string, unknown>[]) {
        if (!itens.some((x) => x && x[chave] === e[chave])) itens.push(e);
      }
      const arr: Record<string | number | symbol, unknown> = {
        length: itens.length,
        item: (i: number) => itens[i] || null,
        namedItem: (n: string) => itens.find((x) => x && x[chave] === n) || null,
        refresh: () => undefined,
      };
      itens.forEach((x, i) => {
        arr[i] = x;
        const nome = x && x[chave];
        if (typeof nome === 'string') arr[nome] = x;
      });
      arr[Symbol.iterator] = function* () {
        yield* itens;
      };
      return arr;
    };

    const plugins = lista(navigator.plugins, [plugin], 'name');
    const mimeTypes = lista(navigator.mimeTypes, mimes, 'type');
    Object.defineProperty(Navigator.prototype, 'plugins', { get: () => plugins, configurable: true });
    Object.defineProperty(Navigator.prototype, 'mimeTypes', { get: () => mimeTypes, configurable: true });
  } catch {
    // Sem o anúncio a tela ainda pode cair no "Oops", mas o resto segue.
  }

  // 3. O `ruffle.js` assim que houver onde pendurá-lo — neste instante nem o `<html>`
  //    existe ainda. Quem trocar o `<object>` depois é o observador do próprio Ruffle.
  const carregar = (): boolean => {
    if (w['__hubRuffle']) return true;
    const alvo = document.head || document.documentElement;
    if (!alvo) return false;
    w['__hubRuffle'] = true;
    const s = document.createElement('script');
    s.src = `${base}ruffle.js`;
    s.async = false;
    alvo.appendChild(s);
    return true;
  };
  if (!carregar()) {
    const obs = new MutationObserver(() => {
      if (carregar()) obs.disconnect();
    });
    obs.observe(document, { childList: true, subtree: true });
  }
  return 'preparado';
}

if (ativo) {
  try {
    contextBridge.executeInMainWorld({ func: prepararNaPagina, args: [BASE] });
  } catch {
    // Frame que já foi descartado, ou página que recusa a execução: a injeção de
    // reserva no processo principal (did-frame-finish-load) ainda tenta.
  }
}
