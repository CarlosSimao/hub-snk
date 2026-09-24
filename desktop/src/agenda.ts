/**
 * Fetch da Agenda de Recursos dentro da aba ERP autenticada — mesmo serviceName/params
 * que `scripts/hub-helper.ps1` (`Get-AgendaRecursos`) já usa, só que via
 * `WebContents.executeJavaScript` em vez de CDP externo. Porta quase literal de
 * `poc-desktop/src/main.js` (comprovada com dado real nas Rodadas 1-6 da PoC).
 *
 * O resultado bruto volta para o backend, que reusa o parser/persistência existentes
 * (`src/sankhya/agendaParser.ts`, `src/sankhya/agenda.ts`) — nada disso é reimplementado
 * aqui.
 */
import type { WebContentsView } from 'electron';
import { DOMINIOS_ERP } from './config';
import { origemSemQuery } from './log';

function origemPermitida(url: string, lista: string[]): boolean {
  try {
    const host = new URL(url).hostname;
    return lista.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function jsonEscape(valor: unknown): string {
  return JSON.stringify(valor);
}

function scriptAgendaFetch(de: string, ate: string): string {
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

interface ResultadoFetch {
  ok: boolean;
  conteudo?: string;
  erro?: string;
}

async function executar(view: WebContentsView, de: string, ate: string): Promise<ResultadoFetch> {
  const url = view.webContents.getURL();
  if (!origemPermitida(url, DOMINIOS_ERP)) {
    return {
      ok: false,
      erro: `aba ERP não está na origem esperada (está em ${origemSemQuery(url)})`,
    };
  }

  const resultado = (await view.webContents.executeJavaScript(
    scriptAgendaFetch(de, ate),
    true,
  )) as {
    ok: boolean;
    conteudo?: string;
    erro?: string;
  };
  if (!resultado.ok) return { ok: false, erro: resultado.erro };

  const texto = resultado.conteudo ?? '';
  if (!texto)
    return { ok: false, erro: 'a guia não devolveu nada — sessão do ERP pode ter expirado' };
  if (texto.trimStart().startsWith('<')) {
    return { ok: false, erro: 'o Sankhya respondeu HTML, não JSON — faça login na aba ERP' };
  }
  return { ok: true, conteudo: texto };
}

/** Serializa as chamadas: uma requisição por vez, igual ao `hub-helper.ps1` de hoje. */
export class AgendaFetcher {
  #fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly obterAbaErp: () => WebContentsView | undefined) {}

  buscar(de: string, ate: string): Promise<ResultadoFetch> {
    const execucao = this.#fila.then(() => {
      const view = this.obterAbaErp();
      if (!view) return { ok: false, erro: 'aba ERP não existe' };
      return executar(view, de, ate);
    });
    this.#fila = execucao.catch(() => undefined);
    return execucao;
  }
}
