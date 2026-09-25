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
import type { WebContents, WebContentsView } from 'electron';
import { carregarRegistros, chamarNaAba } from './chamarNaAba';
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
const CLASSE_LER_LOG = 'serverlog.botaoacao.LerLogAction';
const CLASSE_MONITOR_LOG = 'serverlog.botaoacao.MonitorLogAction';

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

/** O `CONFIG` do botão volta em BASE64 e guarda um XML com `className`. */
function configDoBotao(config: string): string {
  try {
    return Buffer.from(config.replace(/\s/g, ''), 'base64').toString('latin1');
  } catch {
    return '';
  }
}

/**
 * Descobre o `IDBTNACAO` do botão na base, sem o usuário precisar informar.
 *
 * Casar pela classe é o único critério estável: a `DESCRICAO` é texto livre (na base
 * medida ficou "Ler Log", mas cada base pode nomear como quiser).
 */
async function descobrirActionId(wc: WebContents): Promise<{ ok: boolean; actionId?: string; erro?: string }> {
  const r = await carregarRegistros(wc, 'BotaoAcao', 'IDBTNACAO,DESCRICAO,CONFIG', "this.TIPO = 'RJ'");
  if (!r.ok) return { ok: false, erro: r.erro };
  if (!r.corpo?.length) return { ok: false, erro: 'nenhum botão de ação Java nesta base' };
  const botao = r.corpo.find((b) => configDoBotao(b['CONFIG'] ?? '').includes(CLASSE_LER_LOG));
  if (!botao) {
    return {
      ok: false,
      erro: 'o botão do LerLogAction não está registrado nesta base — instale o módulo serverlog e registre a classe como Botão de Ação',
    };
  }
  return { ok: true, actionId: String(botao['IDBTNACAO']) };
}

/** A chamada em si — a mesma que o popup do próprio módulo faz. */
async function executarLerLog(wc: WebContents, actionId: string, offset: number, maxLinhas: number) {
  const r = await chamarNaAba<{ linhas?: string[]; novoOffset?: unknown }>(wc, 'ActionButtonsSP.executeJava', {
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
  });
  // O serviço responde HTTP 200 com status "0" quando a ação falhou no servidor — o
  // `chamarNaAba` já olha o `status`, não o código HTTP.
  if (!r.ok) return { ok: false as const, erro: r.erro ?? 'a ação falhou no servidor' };
  return { ok: true as const, linhas: r.corpo?.linhas ?? [], novoOffset: Number(r.corpo?.novoOffset ?? 0) };
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
    const achado = await descobrirActionId(view.webContents);
    if (!achado.ok || !achado.actionId) {
      const erro = achado.erro ?? 'não encontrei o botão de ação do log nesta base';
      logEvento('serverlog-action-nao-encontrada', { origem: origemSemQuery(origem), erro });
      return { ok: false, erro };
    }
    actionId = achado.actionId;
    logEvento('serverlog-action-descoberta', { origem: origemSemQuery(origem), actionId });
  }

  const maxLinhas = entrada.maxLinhas && entrada.maxLinhas > 0 ? entrada.maxLinhas : MAX_LINHAS_PADRAO;
  const resultado = await executarLerLog(view.webContents, actionId, entrada.offset, maxLinhas);
  if (!resultado.ok) return { ok: false, actionId, erro: resultado.erro };

  return {
    ok: true,
    actionId,
    linhas: resultado.linhas,
    novoOffset: resultado.novoOffset,
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
async function lerInstalacao(wc: WebContents): Promise<StatusServerLog> {
  // CODMODULO liga o botão ao módulo, mas não foi medido em todas as versões: se a
  // entidade recusar o campo, repete sem ele e o módulo sai pela pista do nome.
  let botoes = await carregarRegistros(wc, 'BotaoAcao', 'IDBTNACAO,DESCRICAO,CONFIG,CODMODULO', "this.TIPO = 'RJ'");
  if (!botoes.ok && !botoes.expirou) {
    botoes = await carregarRegistros(wc, 'BotaoAcao', 'IDBTNACAO,DESCRICAO,CONFIG', "this.TIPO = 'RJ'");
  }
  if (!botoes.ok) return { ok: false, erro: botoes.erro };

  let botaoLer: BotaoServerLog | null = null;
  let botaoMonitor: BotaoServerLog | null = null;
  for (const b of botoes.corpo ?? []) {
    const xml = configDoBotao(b['CONFIG'] ?? '');
    const item = { id: String(b['IDBTNACAO']), descricao: b['DESCRICAO'] ?? '', codModulo: b['CODMODULO'] ?? '' };
    if (xml.includes(CLASSE_LER_LOG)) botaoLer = item;
    else if (xml.includes(CLASSE_MONITOR_LOG)) botaoMonitor = item;
  }

  const modulos = await carregarRegistros(wc, 'ModuloAdicional', 'CODMODULO,RESOURCEID,DESCRMODULO');
  if (!modulos.ok) return { ok: false, erro: modulos.erro };
  const codAlvo = botaoLer?.codModulo || botaoMonitor?.codModulo || '';
  let modulo: StatusServerLog['modulo'] = null;
  for (const m of modulos.corpo ?? []) {
    const cod = m['CODMODULO'] ?? '';
    const pista = /serverlog/i.test(`${m['RESOURCEID'] ?? ''} ${m['DESCRMODULO'] ?? ''}`);
    if ((codAlvo && cod === codAlvo) || (!codAlvo && pista)) {
      modulo = { cod, resourceId: m['RESOURCEID'] ?? '', descricao: m['DESCRMODULO'] ?? '' };
      break;
    }
  }
  return { ok: true, botaoLer, botaoMonitor, modulo };
}

/** Verifica a instalação e, havendo botão, faz uma leitura de teste de uma linha. */
export async function statusServerLog(view: WebContentsView): Promise<StatusServerLog> {
  const status = await lerInstalacao(view.webContents);
  if (!status.ok || !status.botaoLer) return status;

  // Uma linha só: aqui o descarte do resto do bloco não importa, é teste e não leitura, e
  // o offset não é guardado em lugar nenhum.
  const teste = await executarLerLog(view.webContents, status.botaoLer.id, 0, 1);
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
