/**
 * Chamada a um serviço do Sankhya (`service.sbr`) de DENTRO de uma aba já logada.
 *
 * É o único caminho que a ACL aceita: medido em 2026-09-24, uma sessão criada fora da aba
 * (`MobileLoginSP.login`) loga, mas toma "Acesso negado ao serviço" em tudo — a mesma
 * chamada feita pela aba passa. Por isso o `fetch` roda na página, com os cookies dela.
 *
 * Centraliza o que antes cada módulo (agenda, server.log) repetia do seu jeito:
 *  - fila POR ABA: duas requisições simultâneas na mesma sessão voltam `status 4`
 *    ("cancelado por situação de concorrência"), fácil de confundir com ACL;
 *  - uma nova tentativa no `status 4`, que também acontece quando a própria tela do
 *    Sankhya está chamando algo na mesma sessão — isso a fila do hub não enxerga;
 *  - decodificação pelo charset do cabeçalho: o Sankhya costuma responder em ISO-8859-1
 *    e `Response.text()` decodifica sempre como UTF-8, estragando os acentos;
 *  - leitura de `status`/`statusMessage` e da sessão expirada (`respostaSankhya.ts`).
 */
import type { WebContents } from 'electron';
import { logEvento } from './log';
import { ERRO_SESSAO_EXPIRADA, erroSankhya, mensagemSankhya, sessaoExpirada } from './respostaSankhya';

/** `/mge` é o contexto geral; a Agenda de Recursos só responde em `/mgeos`. */
export type ContextoSankhya = 'mge' | 'mgeos';

export interface OpcoesChamada {
  ctx?: ContextoSankhya;
  /** Parâmetros extras da URL, além de `serviceName` e `outputType`. */
  query?: Record<string, string>;
}

export interface RespostaBruta {
  ok: boolean;
  /** Corpo já decodificado pelo charset da resposta. */
  texto?: string;
  http?: number;
  erro?: string;
  /** Se a página tinha um `mgeSession` para mandar — diagnóstico, nunca o valor. */
  comSessao?: boolean;
}

export interface RespostaServico<T> {
  ok: boolean;
  corpo?: T;
  erro?: string;
  /** Sessão caída: pede login, não é erro do serviço. */
  expirou?: boolean;
}

/** `0` erro, `3` não autorizado, `4` concorrência. Os demais trazem `responseBody`. */
const STATUS_FALHA = new Set(['0', '3', '4']);
const ESPERA_CONCORRENCIA_MS = 700;

const filas = new WeakMap<WebContents, Promise<unknown>>();
const atividade = new WeakMap<WebContents, number>();

/** Quando o hub chamou esta aba pela última vez (ms epoch; 0 = nunca). O keepalive usa. */
export function ultimaAtividade(wc: WebContents): number {
  return atividade.get(wc) ?? 0;
}

function naFila<T>(wc: WebContents, tarefa: () => Promise<T>): Promise<T> {
  const execucao = (filas.get(wc) ?? Promise.resolve()).then(tarefa);
  filas.set(
    wc,
    execucao.catch(() => undefined),
  );
  return execucao;
}

function montarUrl(servico: string, opcoes: OpcoesChamada): string {
  const busca = new URLSearchParams({ serviceName: servico, outputType: 'json', ...opcoes.query });
  return `/${opcoes.ctx ?? 'mge'}/service.sbr?${busca}`;
}

function scriptFetch(url: string, corpo: string): string {
  // `mgeSession` na URL: sem ele, `/mgeos` (outro contexto web) responde status 3 logo
  // após o login, até alguma tela de OS ser aberta. Mesma busca do `monitor_log.jsp`.
  return `(async () => {
    try {
      let url = ${JSON.stringify(url)};
      if (url.indexOf('mgeSession=') === -1) {
        const achar = (s) => { const m = /[?&]mgeSession=([^&#]+)/.exec(s || ''); return m && m[1]; };
        let sessao = achar(location.search) || achar(location.hash);
        try { sessao = sessao || achar(top.location.search); } catch (e0) {}
        if (!sessao) { const c = /(?:^|;\\s*)JSESSIONID=([^;.]+)/.exec(document.cookie || ''); sessao = c && c[1]; }
        if (sessao) url += '&mgeSession=' + encodeURIComponent(sessao);
      }
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: ${JSON.stringify(corpo)}
      });
      const cs = ((r.headers.get('content-type') || '').match(/charset=([^;]+)/i) || [])[1] || 'utf-8';
      let texto;
      try { texto = new TextDecoder(cs.trim().toLowerCase()).decode(await r.arrayBuffer()); }
      catch (e1) { texto = ''; }
      return { ok: true, http: r.status, texto: texto, comSessao: url.indexOf('mgeSession=') !== -1 };
    } catch (e) {
      return { ok: false, erro: String(e) };
    }
  })()`;
}

async function executarUmaVez(wc: WebContents, servico: string, requestBody: unknown, opcoes: OpcoesChamada) {
  const corpo = JSON.stringify({ serviceName: servico, requestBody });
  return (await wc.executeJavaScript(scriptFetch(montarUrl(servico, opcoes), corpo), true)) as RespostaBruta;
}

function statusDoTexto(texto: string): string {
  try {
    return String((JSON.parse(texto) as { status?: unknown }).status);
  } catch {
    return '';
  }
}

/** Só o diagnóstico da falha vai ao log: nunca o corpo de uma resposta que deu certo. */
function registrarFalha(servico: string, r: RespostaBruta): void {
  const texto = r.texto ?? '';
  const status = statusDoTexto(texto);
  if (r.ok && texto && !texto.trimStart().startsWith('<') && !STATUS_FALHA.has(status)) return;
  let mensagem = '';
  try {
    mensagem = mensagemSankhya((JSON.parse(texto) as { statusMessage?: unknown }).statusMessage).slice(0, 200);
  } catch {
    /* não é JSON */
  }
  logEvento('servico-falhou', {
    servico,
    http: r.http ?? 0,
    tamanho: texto.length,
    status,
    mensagem,
    inicio: status ? '' : texto.slice(0, 120).replace(/\s+/g, ' '),
    erro: r.erro ?? '',
    comSessao: Boolean(r.comSessao),
  });
}

/**
 * Corpo cru, para quem já tem parser próprio (a Agenda manda o JSON inteiro ao backend).
 * Já passa pela fila e pela nova tentativa de concorrência.
 */
export function chamarBruto(
  wc: WebContents,
  servico: string,
  requestBody: unknown,
  opcoes: OpcoesChamada = {},
): Promise<RespostaBruta> {
  return naFila(wc, async () => {
    let r = await executarUmaVez(wc, servico, requestBody, opcoes);
    if (r.ok && statusDoTexto(r.texto ?? '') === '4') {
      await new Promise((ok) => setTimeout(ok, ESPERA_CONCORRENCIA_MS));
      r = await executarUmaVez(wc, servico, requestBody, opcoes);
    }
    atividade.set(wc, Date.now());
    registrarFalha(servico, r);
    return r;
  });
}

/** Interpreta o corpo cru: HTML é tela de login, `status` de falha vira erro legível. */
export function interpretar<T>(bruta: RespostaBruta): RespostaServico<T> {
  if (!bruta.ok) return { ok: false, erro: bruta.erro ?? 'a chamada falhou dentro da aba' };
  const texto = bruta.texto ?? '';
  if (!texto) return { ok: false, expirou: true, erro: ERRO_SESSAO_EXPIRADA };
  if (texto.trimStart().startsWith('<')) return { ok: false, expirou: true, erro: ERRO_SESSAO_EXPIRADA };
  let j: { status?: unknown; statusMessage?: unknown; responseBody?: T };
  try {
    j = JSON.parse(texto) as typeof j;
  } catch {
    return { ok: false, erro: `resposta não JSON (HTTP ${bruta.http ?? '?'})` };
  }
  const status = String(j.status);
  if (STATUS_FALHA.has(status)) {
    const expirou = sessaoExpirada(status, mensagemSankhya(j.statusMessage));
    return { ok: false, expirou, erro: erroSankhya(status, j.statusMessage, `o serviço falhou (status ${status})`) };
  }
  return { ok: true, corpo: (j.responseBody ?? {}) as T };
}

/** Chama e interpreta. O caminho padrão para qualquer serviço novo. */
export async function chamarNaAba<T = Record<string, unknown>>(
  wc: WebContents,
  servico: string,
  requestBody: unknown,
  opcoes: OpcoesChamada = {},
): Promise<RespostaServico<T>> {
  return interpretar<T>(await chamarBruto(wc, servico, requestBody, opcoes));
}

type Campo = { $?: string } | string | undefined;

/**
 * `CRUDServiceProvider.loadRecords` já convertido em objetos `{CAMPO: valor}`.
 * O Sankhya devolve `f0, f1…` na ordem de `metadata.fields`, e objeto em vez de array
 * quando há um registro só.
 */
export async function carregarRegistros(
  wc: WebContents,
  entidade: string,
  campos: string,
  criterio = '',
): Promise<RespostaServico<Record<string, string>[]>> {
  const dataSet: Record<string, unknown> = {
    rootEntity: entidade,
    includePresentationFields: 'N',
    offsetPage: '0',
    entity: { fieldset: { list: campos } },
  };
  if (criterio) dataSet['criteria'] = { expression: { $: criterio } };
  type Corpo = {
    entities?: { metadata?: { fields?: { field?: { name: string } | { name: string }[] } }; entity?: unknown };
  };
  const r = await chamarNaAba<Corpo>(wc, 'CRUDServiceProvider.loadRecords', { dataSet });
  if (!r.ok) return { ok: false, erro: r.erro, expirou: r.expirou };
  const ent = r.corpo?.entities;
  if (!ent?.entity) return { ok: true, corpo: [] };
  const campoMeta = ent.metadata?.fields?.field;
  const nomes = (Array.isArray(campoMeta) ? campoMeta : campoMeta ? [campoMeta] : []).map((f) => f.name);
  const regs = (Array.isArray(ent.entity) ? ent.entity : [ent.entity]) as Record<string, Campo>[];
  return {
    ok: true,
    corpo: regs.map((reg) => {
      const o: Record<string, string> = {};
      nomes.forEach((n, i) => {
        const c = reg[`f${i}`];
        o[n] = c && typeof c === 'object' ? String(c.$ ?? '') : String(c ?? '');
      });
      return o;
    }),
  };
}
