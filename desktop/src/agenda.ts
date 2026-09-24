/**
 * Consultas ao Sankhya ERP feitas de dentro da aba ERP autenticada — a Agenda de Recursos
 * e as negociações de um parceiro. Mesmos serviceName/params que o `hub-helper.ps1`
 * (`Get-AgendaRecursos`, `Get-NegociacoesDoParceiro`) usava, só que via
 * `WebContents.executeJavaScript` em vez de CDP externo: a ACL do Sankhya nega essas
 * chamadas quando elas não vêm de dentro da página logada.
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

/**
 * Negociações de um parceiro (`AgendaRecursosSP.getNegociacoes`), de onde saem os números
 * de FAP dele.
 *
 * Não dá para montar a URL na mão como na Agenda: a tela mantém um contador interno
 * (`ServiceProxy._counter`) que vai no `counter=` de cada chamada, e um valor fixo chega
 * fora de ordem e é recusado com "Não autorizado". Por isso a chamada usa o próprio
 * `ServiceProxy` da tela da Agenda de Recursos, que roda num iframe, e é a mesma função
 * que o clique real usa. O prefixo `mgeos@` é obrigatório: sem ele o serviço é procurado
 * no módulo `/mge`, que não o tem.
 */
function scriptNegociacoes(codParceiro: string): string {
  const corpo = JSON.stringify({
    params: { codParceiro: { $: codParceiro } },
    clientEventList: { clientEvent: [{ $: 'br.com.sankhya.mgeserv.event.envio.email' }] },
  });
  return `new Promise((resolve) => {
    const iframe = [...document.querySelectorAll('iframe')].find(
      (quadro) => quadro.src && quadro.src.includes('AgendaRecursos.xhtml5'),
    );
    if (!iframe) {
      resolve({ ok: false, erro: 'a tela da Agenda de Recursos não está aberta na aba ERP' });
      return;
    }
    let serviceProxy;
    try {
      const janela = iframe.contentWindow;
      serviceProxy = janela.angular.element(janela.document.body).injector().get('ServiceProxy');
    } catch (e) {
      resolve({ ok: false, erro: 'não achei o ServiceProxy da tela: ' + String(e) });
      return;
    }
    const devolver = (dados) => resolve({ ok: true, conteudo: JSON.stringify(dados) });
    serviceProxy
      .callService('mgeos@AgendaRecursosSP.getNegociacoes', ${jsonEscape(corpo)}, {
        ignorePopUpErrorMsgs: true,
      })
      .then(devolver, devolver);
  })`;
}

export interface ResultadoFetch {
  ok: boolean;
  conteudo?: string;
  erro?: string;
}

async function executar(view: WebContentsView, script: string): Promise<ResultadoFetch> {
  const url = view.webContents.getURL();
  if (!origemPermitida(url, DOMINIOS_ERP)) {
    return {
      ok: false,
      erro: `aba ERP não está na origem esperada (está em ${origemSemQuery(url)})`,
    };
  }

  const resultado = (await view.webContents.executeJavaScript(script, true)) as ResultadoFetch;
  if (!resultado.ok) return { ok: false, erro: resultado.erro };

  const texto = resultado.conteudo ?? '';
  if (!texto)
    return { ok: false, erro: 'a guia não devolveu nada — sessão do ERP pode ter expirado' };
  if (texto.trimStart().startsWith('<')) {
    return { ok: false, erro: 'o Sankhya respondeu HTML, não JSON — faça login na aba ERP' };
  }
  return { ok: true, conteudo: texto };
}

/** Serializa as chamadas: uma requisição por vez, como o `hub-helper.ps1` fazia. */
export class AgendaFetcher {
  #fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly obterAbaErp: () => WebContentsView | undefined) {}

  buscar(de: string, ate: string): Promise<ResultadoFetch> {
    return this.#enfileirar(scriptAgendaFetch(de, ate));
  }

  buscarNegociacoes(codParceiro: string): Promise<ResultadoFetch> {
    return this.#enfileirar(scriptNegociacoes(codParceiro));
  }

  #enfileirar(script: string): Promise<ResultadoFetch> {
    const execucao = this.#fila.then(() => {
      const view = this.obterAbaErp();
      if (!view) return { ok: false, erro: 'aba ERP não existe' };
      return executar(view, script);
    });
    this.#fila = execucao.catch(() => undefined);
    return execucao;
  }
}
