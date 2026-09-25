/**
 * Fetch da Agenda de Recursos dentro da aba ERP autenticada — mesmo serviceName/params
 * que `scripts/hub-helper.ps1` (`Get-AgendaRecursos`) já usa, só que via
 * `WebContents.executeJavaScript` em vez de CDP externo. Porta quase literal de
 * `poc-desktop/src/main.js` (comprovada com dado real nas Rodadas 1-6 da PoC).
 *
 * O resultado bruto volta para o backend, que reusa o parser/persistência existentes
 * (`src/sankhya/agendaParser.ts`, `src/sankhya/agenda.ts`) — nada disso é reimplementado
 * aqui. A chamada em si (fila, charset, concorrência) é a de `chamarNaAba.ts`.
 */
import type { WebContentsView } from 'electron';
import { chamarBruto, interpretar } from './chamarNaAba';
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

function corpoAgenda(de: string, ate: string) {
  return {
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
  };
}

interface ResultadoFetch {
  ok: boolean;
  conteudo?: string;
  erro?: string;
}

async function executar(view: WebContentsView, de: string, ate: string): Promise<ResultadoFetch> {
  const url = view.webContents.getURL();
  if (!origemPermitida(url, DOMINIOS_ERP)) {
    return { ok: false, erro: `aba ERP não está na origem esperada (está em ${origemSemQuery(url)})` };
  }

  const bruta = await chamarBruto(view.webContents, 'AgendaRecursosSP.carregarAgendas', corpoAgenda(de, ate), {
    ctx: 'mgeos',
    query: { counter: '1', application: 'AgendaRecursos', preventTransform: '' },
  });
  // Só a sessão caída (HTML, vazio ou status 3) é barrada aqui: o parser do backend leria
  // uma agenda vazia em vez de pedir login. Os demais erros seguem crus, o backend os trata.
  const interpretada = interpretar(bruta);
  if (!bruta.ok || interpretada.expirou) return { ok: false, erro: interpretada.erro };
  return { ok: true, conteudo: bruta.texto ?? '' };
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
