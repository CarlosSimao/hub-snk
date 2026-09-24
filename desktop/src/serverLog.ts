/**
 * Leitura do `server.log` de uma base de cliente, de fora dela.
 *
 * Não há acesso ao filesystem do cliente e não dá para copiar nada para lá. O que torna
 * isto possível é o módulo Java `serverlog` (instalado PELA TELA do Sankhya, como
 * qualquer módulo adicional): ele registra a classe `LerLogAction` como Botão de Ação, e
 * botão de ação é chamável por serviço. Medido em 2026-09-22 numa base real.
 *
 * O caminho da chamada é o mesmo da Agenda (`desktop/src/agenda.ts`): o `fetch` roda
 * DENTRO da aba já logada — aqui a aba da base do cliente, com a partição isolada dela —,
 * então quem autentica é a sessão que o usuário abriu, não uma credencial guardada.
 *
 * Contrato do `LerLogAction`, extraído do fonte que acompanha o jar:
 *   entrada  `offset` (long) + `maxLinhas` (int)
 *   saída    `linhas` (array) + `novoOffset` (long)
 *
 * ATENÇÃO ao `maxLinhas`: ele é TETO DE CORTE, não tamanho de leitura. O helper lê um
 * bloco fixo de ~512 KB e o offset avança o bloco INTEIRO, devolvendo no máximo
 * `maxLinhas` linhas dele. Pedir pouco descarta o resto do bloco em silêncio — medido:
 * `maxLinhas=50` devolveu 50 linhas e pulou 3.680. Por isso o padrão aqui é alto.
 */
import type { WebContentsView } from 'electron';
import { logEvento, origemSemQuery } from './log';

/**
 * Teto de linhas por chamada.
 *
 * Um bloco de 512 KB comportou 3.680 linhas (~142 bytes cada) na base medida. 20.000
 * cobre com folga até log de linhas curtas (512 KB / 40 bytes ≈ 13 mil), garantindo que
 * o bloco venha inteiro e nada seja descartado.
 */
export const MAX_LINHAS_PADRAO = 20_000;

/** A classe do jar. É por ela que o botão é reconhecido, não pelo nome que o usuário deu. */
const CLASSE_LER_LOG = 'LerLogAction';

export interface ResultadoLog {
  ok: boolean;
  linhas?: string[];
  novoOffset?: number;
  actionId?: string;
  erro?: string;
}

function origemDaAba(view: WebContentsView): string {
  try {
    return new URL(view.webContents.getURL()).origin;
  } catch {
    return '';
  }
}

/**
 * Descobre o `IDBTNACAO` do botão na base, sem o usuário precisar informar.
 *
 * O `CONFIG` do botão volta em BASE64 e guarda um XML com `className`. Casar pela classe
 * é o único critério estável: a `DESCRICAO` é texto livre (na base medida ficou
 * "Ler Log", mas cada base pode nomear como quiser).
 */
function scriptDescobrirActionId(): string {
  return `(async () => {
    try {
      const r = await fetch('/mge/service.sbr?serviceName=CRUDServiceProvider.loadRecords&outputType=json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ serviceName: 'CRUDServiceProvider.loadRecords', requestBody: { dataSet: {
          rootEntity: 'BotaoAcao', includePresentationFields: 'N', offsetPage: '0',
          criteria: { expression: { $: "this.TIPO = 'RJ'" } },
          entity: { fieldset: { list: 'IDBTNACAO,DESCRICAO,CONFIG' } } } } })
      });
      const j = await r.json();
      if (j.status !== '1') return { ok: false, erro: j.statusMessage || ('status ' + j.status) };
      const e = j.responseBody && j.responseBody.entities;
      if (!e || !e.entity) return { ok: false, erro: 'nenhum botão de ação Java nesta base' };
      const nomes = e.metadata.fields.field.map(function (f) { return f.name; });
      let regs = e.entity; if (!Array.isArray(regs)) regs = [regs];
      for (const reg of regs) {
        const o = {};
        nomes.forEach(function (n, i) { const c = reg['f' + i]; o[n] = (c && typeof c === 'object') ? c.$ : c; });
        let xml = '';
        try { xml = atob(String(o.CONFIG || '').replace(/\\s/g, '')); } catch (e2) { xml = ''; }
        if (xml.indexOf(${JSON.stringify(CLASSE_LER_LOG)}) !== -1) {
          return { ok: true, actionId: String(o.IDBTNACAO) };
        }
      }
      return { ok: false, erro: 'o botão do LerLogAction não está registrado nesta base — instale o módulo serverlog e registre a classe como Botão de Ação' };
    } catch (err) {
      return { ok: false, erro: String(err) };
    }
  })()`;
}

/** A chamada em si — a mesma que o popup do próprio módulo faz. */
function scriptLerLog(actionId: string, offset: number, maxLinhas: number): string {
  const corpo = JSON.stringify({
    serviceName: 'ActionButtonsSP.executeJava',
    requestBody: {
      javaCall: {
        actionID: String(actionId),
        refreshType: 'NONE',
        params: {
          param: [
            { type: 'S', paramName: 'offset', $: String(offset) },
            { type: 'S', paramName: 'maxLinhas', $: String(maxLinhas) },
          ],
        },
      },
    },
  });
  return `(async () => {
    try {
      const r = await fetch('/mge/service.sbr?serviceName=ActionButtonsSP.executeJava&outputType=json', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: ${JSON.stringify(corpo)}
      });
      const j = await r.json();
      // O serviço responde HTTP 200 com status "0" quando a ação falhou no servidor —
      // olhar só o código HTTP daria sucesso falso.
      if (j.status === '0' || j.status === 0) return { ok: false, erro: j.statusMessage || 'a ação falhou no servidor' };
      const rb = j.responseBody || {};
      return { ok: true, linhas: rb.linhas || [], novoOffset: Number(rb.novoOffset || 0) };
    } catch (err) {
      return { ok: false, erro: String(err) };
    }
  })()`;
}

/**
 * Lê um trecho do log da base. Sem `actionId`, descobre-o antes e devolve junto, para a
 * chamada seguinte não pagar a descoberta de novo.
 */
export async function lerLog(
  view: WebContentsView,
  entrada: { offset: number; maxLinhas?: number; actionId?: string },
): Promise<ResultadoLog> {
  const origem = origemDaAba(view);
  if (!origem) return { ok: false, erro: 'a aba da base não tem origem válida' };

  let actionId = entrada.actionId ?? '';
  if (!actionId) {
    const achado = (await view.webContents.executeJavaScript(scriptDescobrirActionId(), true)) as {
      ok: boolean;
      actionId?: string;
      erro?: string;
    };
    if (!achado.ok || !achado.actionId) {
      logEvento('serverlog-action-nao-encontrada', { origem: origemSemQuery(origem), erro: achado.erro });
      return { ok: false, erro: achado.erro ?? 'não encontrei o botão de ação do log nesta base' };
    }
    actionId = achado.actionId;
    logEvento('serverlog-action-descoberta', { origem: origemSemQuery(origem), actionId });
  }

  const maxLinhas = entrada.maxLinhas && entrada.maxLinhas > 0 ? entrada.maxLinhas : MAX_LINHAS_PADRAO;
  const resultado = (await view.webContents.executeJavaScript(
    scriptLerLog(actionId, entrada.offset, maxLinhas),
    true,
  )) as { ok: boolean; linhas?: string[]; novoOffset?: number; erro?: string };

  if (!resultado.ok) return { ok: false, actionId, erro: resultado.erro };

  return {
    ok: true,
    actionId,
    linhas: resultado.linhas ?? [],
    novoOffset: resultado.novoOffset ?? entrada.offset,
  };
}

export interface BotaoServerLog {
  id: string;
  descricao: string;
  codModulo: string;
}

export interface StatusServerLog {
  ok: boolean;
  erro?: string;
  /** O botão que o hub usa. Sem ele não há leitura. */
  botaoLer?: BotaoServerLog | null;
  /** O botão do popup do próprio módulo. Opcional para o hub, mas também sai na remoção. */
  botaoMonitor?: BotaoServerLog | null;
  modulo?: { cod: string; resourceId: string; descricao: string } | null;
  /** Leitura de teste de verdade: botão registrado não garante permissão de execução. */
  leituraOk?: boolean;
  erroLeitura?: string;
}

/**
 * O que está instalado do `serverlog` nesta base.
 *
 * O módulo é achado pelo `CODMODULO` do botão, não pelo nome: o identificador do módulo
 * é o que quem importou digitou na tela. Só quando não há botão nenhum o nome entra como
 * pista (`serverlog` no identificador ou na descrição), para ainda acusar um módulo
 * importado e esquecido sem botão — que também precisa sair da base no fim da demanda.
 */
function scriptStatus(): string {
  return `(async () => {
    const carregar = async (entidade, criterio, campos) => {
      const corpo = { serviceName: 'CRUDServiceProvider.loadRecords', requestBody: { dataSet: {
        rootEntity: entidade, includePresentationFields: 'N', offsetPage: '0',
        entity: { fieldset: { list: campos } } } } };
      if (criterio) corpo.requestBody.dataSet.criteria = { expression: { $: criterio } };
      const r = await fetch('/mge/service.sbr?serviceName=CRUDServiceProvider.loadRecords&outputType=json', {
        method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
        body: JSON.stringify(corpo)
      });
      const j = await r.json();
      if (j.status !== '1') throw new Error(j.statusMessage || ('status ' + j.status));
      const e = j.responseBody && j.responseBody.entities;
      if (!e || !e.entity) return [];
      const nomes = e.metadata.fields.field.map(function (f) { return f.name; });
      let regs = e.entity; if (!Array.isArray(regs)) regs = [regs];
      return regs.map(function (reg) {
        const o = {};
        nomes.forEach(function (n, i) { const c = reg['f' + i]; o[n] = (c && typeof c === 'object') ? c.$ : c; });
        return o;
      });
    };
    try {
      // CODMODULO liga o botão ao módulo, mas não foi medido em todas as versões: se a
      // entidade recusar o campo, repete sem ele e o módulo sai pela pista do nome.
      let botoes;
      try {
        botoes = await carregar('BotaoAcao', "this.TIPO = 'RJ'", 'IDBTNACAO,DESCRICAO,CONFIG,CODMODULO');
      } catch (e1) {
        botoes = await carregar('BotaoAcao', "this.TIPO = 'RJ'", 'IDBTNACAO,DESCRICAO,CONFIG');
      }
      let botaoLer = null, botaoMonitor = null;
      for (const b of botoes) {
        let xml = '';
        try { xml = atob(String(b.CONFIG || '').replace(/\\s/g, '')); } catch (e2) { xml = ''; }
        const item = { id: String(b.IDBTNACAO), descricao: String(b.DESCRICAO || ''), codModulo: String(b.CODMODULO || '') };
        if (xml.indexOf('serverlog.botaoacao.LerLogAction') !== -1) botaoLer = item;
        else if (xml.indexOf('serverlog.botaoacao.MonitorLogAction') !== -1) botaoMonitor = item;
      }
      const modulos = await carregar('ModuloAdicional', '', 'CODMODULO,RESOURCEID,DESCRMODULO');
      const codAlvo = (botaoLer && botaoLer.codModulo) || (botaoMonitor && botaoMonitor.codModulo) || '';
      let mod = null;
      for (const m of modulos) {
        const cod = String(m.CODMODULO);
        const pista = /serverlog/i.test(String(m.RESOURCEID || '') + ' ' + String(m.DESCRMODULO || ''));
        if ((codAlvo && cod === codAlvo) || (!codAlvo && pista)) {
          mod = { cod: cod, resourceId: String(m.RESOURCEID || ''), descricao: String(m.DESCRMODULO || '') };
          break;
        }
      }
      return { ok: true, botaoLer: botaoLer, botaoMonitor: botaoMonitor, modulo: mod };
    } catch (err) {
      return { ok: false, erro: String(err && err.message || err) };
    }
  })()`;
}

/** Verifica a instalação e, havendo botão, faz uma leitura de teste de uma linha. */
export async function statusServerLog(view: WebContentsView): Promise<StatusServerLog> {
  const status = (await view.webContents.executeJavaScript(scriptStatus(), true)) as StatusServerLog;
  if (!status.ok || !status.botaoLer) return status;

  // Uma linha só: aqui o descarte do resto do bloco não importa, é teste e não leitura, e
  // o offset não é guardado em lugar nenhum.
  const teste = (await view.webContents.executeJavaScript(scriptLerLog(status.botaoLer.id, 0, 1), true)) as {
    ok: boolean;
    erro?: string;
  };
  status.leituraOk = teste.ok;
  if (!teste.ok && teste.erro) status.erroLeitura = teste.erro;
  logEvento('serverlog-status', {
    origem: origemSemQuery(origemDaAba(view)),
    botao: status.botaoLer.id,
    modulo: status.modulo?.cod ?? '',
    leituraOk: teste.ok,
  });
  return status;
}

/**
 * Serializa as leituras, como o `AgendaFetcher` faz.
 *
 * Duas leituras concorrentes na mesma base avançariam o offset uma por cima da outra e o
 * dashboard perderia linhas sem nenhum erro aparente.
 */
export class ServerLogFetcher {
  #fila: Promise<unknown> = Promise.resolve();

  constructor(private readonly obterAba: (origin: string) => WebContentsView | undefined) {}

  ler(origin: string, entrada: { offset: number; maxLinhas?: number; actionId?: string }): Promise<ResultadoLog> {
    const execucao = this.#fila.then(() => {
      const view = this.obterAba(origin);
      if (!view) {
        return {
          ok: false,
          erro: 'a aba dessa base não está aberta no hub — abra a base e faça login antes de ler o log',
        } satisfies ResultadoLog;
      }
      return lerLog(view, entrada);
    });
    this.#fila = execucao.catch(() => undefined);
    return execucao;
  }

  /** Na mesma fila das leituras: a leitura de teste também passa pelo mesmo botão. */
  status(origin: string): Promise<StatusServerLog> {
    const execucao = this.#fila.then(() => {
      const view = this.obterAba(origin);
      if (!view) {
        return {
          ok: false,
          erro: 'a aba dessa base não está aberta no hub — abra a base e faça login para verificar',
        } satisfies StatusServerLog;
      }
      return statusServerLog(view);
    });
    this.#fila = execucao.catch(() => undefined);
    return execucao;
  }
}
