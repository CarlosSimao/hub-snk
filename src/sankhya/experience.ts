/**
 * Cliente de LEITURA da API do Sankhya Experience (API Gateway da AWS).
 *
 * Autentica com o JWT que o helper captura do navegador — não com cookie.
 * Medido no projeto original: cookie de sessão devolve 403 nessas rotas,
 * mesmo com Origin e Referer corretos; `Authorization: Bearer <token>`
 * devolve 200.
 *
 * Escopo reduzido de propósito (Fase 4, só leitura): sem geração de OS nem
 * envio de e-mail.
 */
import type { Credenciais } from './credenciais.ts';
import type { OrdemExperience, TarefaExperience } from '../tipos.ts';

const API = 'https://d83n39pk6d.execute-api.sa-east-1.amazonaws.com/prod';

/** Status confirmados do filtro. A tela tem mais valores, estes são os que vimos. */
const STATUS_TAREFA = ['Hoje', 'Futura', 'Atrasada'];

const MAX_PAGINAS = 20;
const POR_PAGINA = 100;

/**
 * Fila de vagas: até `vagas` tarefas rodam ao mesmo tempo, o resto espera a vez.
 *
 * `minhasOrdens` faz uma chamada de detalhe por OS, e a aba OS geral e a do cliente
 * podem carregar perto uma da outra (ou um clique duplo em "Atualizar"). Sem um
 * limite ÚNICO por cima de todas as chamadas — não só dentro de uma consulta —,
 * essas rajadas empilham dezenas de conexões HTTPS pro mesmo host da AWS ao mesmo
 * tempo, e as mais novas caem em timeout de conexão (visto em produção: requisição
 * boa levando mais de 40s, as de trás `ConnectTimeoutError`).
 */
class FilaDeVagas {
  #vagasLivres: number;
  #esperando: (() => void)[] = [];

  constructor(vagas: number) {
    this.#vagasLivres = vagas;
  }

  async #adquirir(): Promise<void> {
    if (this.#vagasLivres > 0) {
      this.#vagasLivres -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.#esperando.push(resolve));
  }

  /** Passa a vaga direto para quem está esperando, em vez de liberar e deixar correr solto. */
  #liberar(): void {
    const proximo = this.#esperando.shift();
    if (proximo) {
      proximo();
    } else {
      this.#vagasLivres += 1;
    }
  }

  async executar<T>(tarefa: () => Promise<T>): Promise<T> {
    await this.#adquirir();
    try {
      return await tarefa();
    } finally {
      this.#liberar();
    }
  }
}

const MAX_CHAMADAS_SIMULTANEAS_NA_EXPERIENCE = 4;
const filaDeChamadasNaExperience = new FilaDeVagas(MAX_CHAMADAS_SIMULTANEAS_NA_EXPERIENCE);

/** Separa etapa/processos (já em campos próprios) do texto livre em "Tarefas Realizadas". */
const MARCADOR_DE_OBSERVACOES = '--- Informações Adicionais ---';

/** Só o texto digitado à mão, depois do marcador. Sem marcador, não há texto livre. */
function extrairObservacoes(informacaoAdicional: string): string {
  const indice = informacaoAdicional.indexOf(MARCADOR_DE_OBSERVACOES);
  if (indice === -1) return '';
  return informacaoAdicional.slice(indice + MARCADOR_DE_OBSERVACOES.length).trim();
}

export class SessaoExpiradaError extends Error {}

export type SituacaoDoDia =
  | { tipo: 'sem-tarefa' }
  | { tipo: 'tarefa-aberta' }
  | {
      tipo: 'os-lancada';
      numeroOs: string;
      pedido: string;
      tarefasRealizadas: string;
      horaInicio: string;
      horaFim: string;
      intervalo: string;
      tempoRealizado: string;
    };

/** `DD/MM/YYYY` -> `YYYY-MM-DD`. Devolve `''` no que não casar. */
function paraIso(data: string): string {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data ?? '');
  return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : '';
}

function texto(valor: unknown): string {
  return typeof valor === 'string'
    ? valor
    : valor === null || valor === undefined
      ? ''
      : String(valor);
}

export class Experience {
  readonly #credenciais: Credenciais;

  constructor(credenciais: Credenciais) {
    this.#credenciais = credenciais;
  }

  async #token(): Promise<string> {
    const { token } = await this.#credenciais.revelar('sankhya-experience');
    if (!token) {
      throw new SessaoExpiradaError(
        'sem sessão do Sankhya Experience — capture a sessão em Credenciais Sankhya',
      );
    }
    return token;
  }

  /**
   * Falha cedo quando não há sessão guardada — sem isto, cada cliente daria o
   * mesmo erro de sessão isolado, escondendo que a causa é uma só.
   */
  async verificarSessao(): Promise<void> {
    await this.#token();
  }

  /**
   * O `person_id` do usuário logado — é uma conta GLOBAL da Experience, não
   * por projeto (`/persons/implantation/{id}` não existe; testado e devolve
   * 403 tanto com o FAP quanto com o `implantation_id` real). O jeito certo é
   * `/persons/information-by-email`, sem projeto nenhum envolvido.
   *
   * `projetoId` é só para achar o NOME: essa rota não devolve nome, então
   * busca opcionalmente na lista de pessoas do projeto (mesma lista do filtro
   * de tarefas) pra casar pelo `person_id`. Sem `projetoId`, ou sem achar o
   * nome lá, devolve `nome: ''`.
   */
  async descobrirPersonId(projetoId?: number): Promise<{ personId: number; nome: string } | null> {
    const token = await this.#token();

    const payload = token.split('.')[1];
    if (!payload) return null;

    let email = '';
    try {
      const dados = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { email?: string };
      email = (dados.email ?? '').toLowerCase();
    } catch {
      return null;
    }
    if (!email) return null;

    const corpo = await this.#chamar<{ data?: { user_id?: number } }>(
      '/persons/information-by-email',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
    );
    const personId = Number(corpo.data?.user_id);
    if (!Number.isFinite(personId)) return null;

    if (projetoId === undefined) {
      return { personId, nome: '' };
    }

    const pessoas = await this.#chamar<{ data?: Record<string, unknown>[] }>(
      `/tasks/implantation/${projetoId}/filter/persons`,
    );
    const eu = (pessoas.data ?? []).find((p) => Number(p['person_id']) === personId);
    return { personId, nome: texto(eu?.['person_name']) };
  }

  /**
   * Uma consulta paginada. `full_count` vem em CADA item, então o critério de
   * parada sai do primeiro item de cada página.
   */
  async #paginar<T>(
    caminho: string,
    filtros: Record<string, unknown>,
    converter: (linha: Record<string, unknown>) => T,
  ): Promise<T[]> {
    const token = await this.#token();
    const itens: T[] = [];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const resposta = await filaDeChamadasNaExperience.executar(() =>
        fetch(`${API}${caminho}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify({
            columns: [],
            page: pagina,
            length: POR_PAGINA,
            order: {},
            filters: filtros,
          }),
          signal: AbortSignal.timeout(30_000),
        }),
      );

      if (resposta.status === 401 || resposta.status === 403) {
        throw new SessaoExpiradaError(
          'o Sankhya Experience recusou a sessão (o token dura 72h) — capture a sessão de novo',
        );
      }
      if (!resposta.ok) {
        throw new Error(`Experience respondeu HTTP ${resposta.status} em ${caminho}`);
      }

      const corpo = (await resposta.json()) as { data?: { result?: Record<string, unknown>[] } };
      const linhas = corpo.data?.result ?? [];
      if (!linhas.length) break;

      itens.push(...linhas.map(converter));

      const total = Number(linhas[0]?.['full_count'] ?? 0);
      if (!total || pagina * POR_PAGINA >= total) break;
    }

    return itens;
  }

  tarefas(projetoId: number, personId: number): Promise<TarefaExperience[]> {
    return this.#paginar(
      `/tasks/filtering/implantation/${projetoId}/person/${personId}`,
      { status: STATUS_TAREFA, users: [personId] },
      (linha) => ({
        id: Number(linha['id']),
        taskDate: texto(linha['task_date']),
        dia: paraIso(texto(linha['task_date'])),
        procedimento: texto(linha['procedure_name']),
        etapa: texto(linha['stage_name']),
        processo: texto(linha['process_name']),
        taskStatus: texto(linha['task_status']),
        horaInicio: texto(linha['task_hour_to_start']),
        horaFim: texto(linha['task_hour_to_finish']),
        pedido: texto(linha['application_code']),
        observacoes: texto(linha['additional_information']),
        bruto: linha,
      }),
    );
  }

  /** Uma chamada avulsa, fora do padrão paginado. */
  async #chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const token = await this.#token();
    const resposta = await filaDeChamadasNaExperience.executar(() =>
      fetch(`${API}${caminho}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          ...init.headers,
        },
        signal: AbortSignal.timeout(30_000),
      }),
    );

    if (resposta.status === 401 || resposta.status === 403) {
      throw new SessaoExpiradaError(
        'o Sankhya Experience recusou a sessão (o token dura 72h) — capture a sessão de novo',
      );
    }

    const corpo = (await resposta.json().catch(() => ({}))) as {
      data?: unknown;
      response?: { error?: boolean; message?: string };
    };

    if (!resposta.ok || corpo.response?.error) {
      throw new Error(
        corpo.response?.message ?? `Experience respondeu HTTP ${resposta.status} em ${caminho}`,
      );
    }
    return corpo as T;
  }

  /**
   * Todas as implantações (o que a Experience entende como "projeto") com o `id`
   * interno e o número de FAP do ERP (`impl.fap_number`) — são coisas diferentes:
   * FAP é o `numNegociacao` da negociação, `implantation_id` é o `id` da
   * implantação que tem aquele FAP. Base para achar o `implantation_id` de um FAP
   * (um cliente pode ter mais de um).
   */
  async #implantacoesComFap(): Promise<{ id: number; fap: number }[]> {
    const implantacoes: { id: number; fap: number }[] = [];
    const colunas = [
      { name: 'impl.id', alias: 'id' },
      { name: 'impl.fap_number', alias: 'fap' },
    ];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const corpo = await this.#chamar<{ data?: { result?: Record<string, unknown>[] } }>(
        '/implantations/filters',
        {
          method: 'POST',
          body: JSON.stringify({
            columns: colunas,
            page: pagina,
            length: POR_PAGINA,
            order: {},
            filters: {},
          }),
        },
      );
      const linhas = corpo.data?.result ?? [];
      if (!linhas.length) break;

      implantacoes.push(...linhas.map((l) => ({ id: Number(l['id']), fap: Number(l['fap']) })));

      const total = Number(linhas[0]?.['full_count'] ?? 0);
      if (!total || pagina * POR_PAGINA >= total) break;
    }

    return implantacoes;
  }

  async #implantationIdPorFap(fapNumero: number): Promise<number | null> {
    const implantacoes = await this.#implantacoesComFap();
    return implantacoes.find((i) => i.fap === fapNumero)?.id ?? null;
  }

  /** Os `implantation_id` de todos os FAPs de um cliente — um cliente pode ter mais de um. */
  async #implantationIdsPorFaps(fapNumeros: number[]): Promise<number[]> {
    const implantacoes = await this.#implantacoesComFap();
    const fapsProcurados = new Set(fapNumeros);
    return [...new Set(implantacoes.filter((i) => fapsProcurados.has(i.fap)).map((i) => i.id))];
  }

  /**
   * Detalhe de uma OS já lançada: o texto de "Tarefas Realizadas" (etapa,
   * processos e observações — junta mais de uma linha quando a OS consolida
   * vários dias de tarefa) e os horários da PRIMEIRA tarefa (início, fim,
   * intervalo, tempo realizado) — o caso comum é uma tarefa por dia, e
   * `situacaoDoDia` já filtrou a OS pra um dia só.
   */
  async #detalheDaOrdem(orderId: number): Promise<{
    tarefasRealizadas: string;
    observacoes: string;
    horaInicio: string;
    horaFim: string;
    intervalo: string;
    tempoRealizado: string;
  }> {
    const corpo = await this.#chamar<{ data?: { result?: Record<string, unknown>[] } }>(
      `/orders/${orderId}/tasks?columns=[]&page=1&length=${POR_PAGINA}&order=%7B%7D`,
    );
    const linhas = corpo.data?.result ?? [];
    const primeira = linhas[0] ?? {};

    return {
      tarefasRealizadas: linhas
        .map((l) => texto(l['additional_information']))
        .filter(Boolean)
        .join('\n\n'),
      observacoes: linhas
        .map((l) => extrairObservacoes(texto(l['additional_information'])))
        .filter(Boolean)
        .join('\n\n'),
      horaInicio: texto(primeira['hour_to_start']),
      horaFim: texto(primeira['hour_to_finish']),
      intervalo: texto(primeira['hour_to_lunch']),
      tempoRealizado: texto(primeira['worked_hours']),
    };
  }

  /**
   * O estado de um dia específico pro usuário logado, em algum dos FAPs
   * informados. Três estados, nessa ordem de prioridade:
   *
   *  1. `os-lancada`: já existe Ordem de Serviço lançada naquele dia — a
   *     tarefa virou OS, tem número do Sankhya pra mostrar.
   *  2. `tarefa-aberta`: não tem OS ainda, mas tem tarefa aberta
   *     ("Hoje"/"Futura"/"Atrasada") marcada pra aquele dia.
   *  3. `sem-tarefa`: nenhum dos dois — nem OS, nem tarefa aberta.
   *
   * Testa um FAP por vez e para no primeiro que achar OS ou tarefa — não
   * precisa somar os FAPs, só saber o estado.
   */
  async situacaoDoDia(fapIds: number[], dia: string): Promise<SituacaoDoDia> {
    for (const fapId of fapIds) {
      const implantationId = await this.#implantationIdPorFap(fapId);
      if (implantationId === null) continue;

      const pessoa = await this.descobrirPersonId(implantationId);
      if (!pessoa) continue;

      const ordens = await this.ordens(implantationId, pessoa.personId, dia, dia);
      const ordemDoDia = ordens.find((o) => o.dia === dia);
      if (ordemDoDia) {
        const detalhe = await this.#detalheDaOrdem(ordemDoDia.id);
        return {
          tipo: 'os-lancada',
          numeroOs: ordemDoDia.numeroSankhya || String(ordemDoDia.id),
          pedido: ordemDoDia.pedido,
          ...detalhe,
        };
      }

      const tarefas = await this.tarefas(implantationId, pessoa.personId);
      if (tarefas.some((t) => t.dia === dia)) {
        return { tipo: 'tarefa-aberta' };
      }
    }
    return { tipo: 'sem-tarefa' };
  }

  /** Converte uma linha crua de `/orders/filtering` — mesmo formato em `ordens()` e `minhasOrdens()`. */
  #converterOrdem(linha: Record<string, unknown>): OrdemExperience {
    return {
      id: Number(linha['order_id'] ?? linha['id']),
      dia: paraIso(texto(linha['order_done_date'])),
      descricao: texto(linha['description']),
      tipo: texto(linha['order_type']),
      numeroSankhya: texto(linha['numos_sankhya']),
      statusAceite: texto(linha['accepted_os_status']),
      horasFeitas: texto(linha['diff_time']),
      etapa: texto(linha['stage_name']),
      processos: texto(linha['process_all']),
      pessoa: texto(linha['person_name']),
      empresa: texto(linha['company_name']),
      statusNumeroSankhya: texto(linha['numos_sankhya_status']),
      horasExcedidas: linha['volume_hours_exceeded'] === true,
      erro: texto(linha['error_description']),
      pedido: texto(linha['application_code']),
      coordenador: texto(linha['fap_coordinator']),
      totalProjetoPrevisto: texto(linha['total_expected']),
      totalProjetoFeito: texto(linha['total_done']),
      // `/orders/filtering` não traz isso — só `#detalheDaOrdem`, uma chamada por OS.
      horaInicio: '',
      horaFim: '',
      intervalo: '',
      observacoes: '',
    };
  }

  /**
   * As OS de um projeto no período.
   *
   * `personId` nulo traz as de TODO MUNDO no projeto.
   */
  ordens(
    projetoId: number,
    personId: number | null,
    de: string,
    ate: string,
  ): Promise<OrdemExperience[]> {
    return this.#paginar(
      `/orders/filtering?implantation_ids=${projetoId}`,
      {
        period: [`${de} 00:00:00`, `${ate} 23:59:59`],
        // A chave precisa sumir do corpo, não ir como lista vazia: `users: []`
        // é um filtro que não casa com ninguém.
        ...(personId === null ? {} : { users: [personId] }),
      },
      (linha) => this.#converterOrdem(linha),
    );
  }

  /**
   * Todos os `implantation_id` existentes na Experience — `/orders/filtering` exige a
   * lista de projetos no filtro (sem ela devolve HTTP 500, testado). Não filtra por
   * usuário: quem restringe pra "minhas ordens" é o `users: [personId]` de quem chama.
   */
  async #todosOsImplantationIds(): Promise<number[]> {
    const ids: number[] = [];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const corpo = await this.#chamar<{ data?: { result?: Record<string, unknown>[] } }>(
        '/implantations/filters',
        {
          method: 'POST',
          body: JSON.stringify({
            columns: [{ name: 'impl.id', alias: 'id' }],
            page: pagina,
            length: POR_PAGINA,
            order: {},
            filters: {},
          }),
        },
      );
      const linhas = corpo.data?.result ?? [];
      if (!linhas.length) break;

      ids.push(...linhas.map((linha) => Number(linha['id'])));

      const total = Number(linhas[0]?.['full_count'] ?? 0);
      if (!total || pagina * POR_PAGINA >= total) break;
    }

    return ids;
  }

  /**
   * As OS do usuário logado no período, em TODOS os projetos que ele tem acesso — sem
   * o usuário precisar achar o ID de cada projeto. É o que alimenta a aba OS geral.
   */
  async minhasOrdens(personId: number, de: string, ate: string): Promise<OrdemExperience[]> {
    const implantationIds = await this.#todosOsImplantationIds();
    return this.#buscarEEnriquecer(implantationIds, personId, de, ate);
  }

  /**
   * As OS do usuário logado, só nos projetos dos FAPs informados — o que alimenta a aba
   * OS do cadastro do cliente. Ao contrário de `minhasOrdens`, filtra pelo `implantation_id`
   * de verdade (via FAP do parceiro do ERP), não por comparação de nome da empresa.
   */
  async ordensDoCliente(
    personId: number,
    fapNumeros: number[],
    de: string,
    ate: string,
  ): Promise<OrdemExperience[]> {
    const implantationIds = await this.#implantationIdsPorFaps(fapNumeros);
    return this.#buscarEEnriquecer(implantationIds, personId, de, ate);
  }

  async #buscarEEnriquecer(
    implantationIds: number[],
    personId: number,
    de: string,
    ate: string,
  ): Promise<OrdemExperience[]> {
    if (implantationIds.length === 0) {
      return [];
    }

    const ordens = await this.#paginar(
      `/orders/filtering?implantation_ids=${implantationIds.join(',')}`,
      { period: [`${de} 00:00:00`, `${ate} 23:59:59`], users: [personId] },
      (linha) => this.#converterOrdem(linha),
    );

    return this.#comHorariosEObservacoes(ordens);
  }

  /**
   * Preenche `horaInicio`/`horaFim`/`intervalo`/`observacoes`, uma chamada por OS.
   *
   * Dispara todas de uma vez: quem limita quantas rodam ao mesmo tempo de verdade é
   * `filaDeChamadasNaExperience`, compartilhada com toda chamada à Experience — não
   * precisa duplicar esse controle aqui em lotes.
   */
  async #comHorariosEObservacoes(ordens: OrdemExperience[]): Promise<OrdemExperience[]> {
    return Promise.all(
      ordens.map(async (ordem) => {
        const detalhe = await this.#detalheDaOrdem(ordem.id).catch((erro: unknown) => {
          // Sessão expirada vale para a lista inteira: propaga em vez de esconder atrás de campos vazios.
          if (erro instanceof SessaoExpiradaError) throw erro;
          return { observacoes: '', horaInicio: '', horaFim: '', intervalo: '' };
        });
        return {
          ...ordem,
          horaInicio: detalhe.horaInicio,
          horaFim: detalhe.horaFim,
          intervalo: detalhe.intervalo,
          observacoes: detalhe.observacoes,
        };
      }),
    );
  }
}
