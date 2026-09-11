/**
 * Cliente da API do Sankhya Experience (API Gateway da AWS).
 *
 * Autentica com o JWT que o hub captura do navegador — NAO com cookie. Medido em
 * 2026-09-10: cookie de sessao devolve 403 nessas rotas, mesmo com Origin e Referer
 * corretos; `Authorization: Bearer <localStorage.token>` devolve 200. Nao ha cookie no
 * dominio do API Gateway.
 *
 * Como o token sozinho basta, a coleta roda em HTTP puro de dentro do container — o
 * navegador so e necessario no momento do login.
 */
import type { Credenciais } from './credenciais.ts';
import type {
  AprovadorExperience,
  OrdemCriada,
  OrdemExperience,
  PreparoOrdem,
  TarefaExperience,
} from '../types.ts';

const API = 'https://d83n39pk6d.execute-api.sa-east-1.amazonaws.com/prod';

/** Status confirmados do filtro. A tela tem mais valores, estes sao os que vimos. */
const STATUS_TAREFA = ['Hoje', 'Futura', 'Atrasada'];

/** Teto de paginas por consulta — trava de seguranca contra `full_count` absurdo. */
const MAX_PAGINAS = 20;
const POR_PAGINA = 100;

export class SessaoExpiradaError extends Error {}

/** `DD/MM/YYYY` -> `YYYY-MM-DD`. Devolve `''` no que nao casar, em vez de inventar data. */
function paraIso(data: string): string {
  const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data ?? '');
  return partes ? `${partes[3]}-${partes[2]}-${partes[1]}` : '';
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : valor === null || valor === undefined ? '' : String(valor);
}

/**
 * `2026-09-10` -> `2026-9-10`.
 *
 * A API do `POST /orders` espera a data SEM zero à esquerda no mês e no dia — foi assim
 * que a tela mandou no fechamento real capturado. Não é cosmético: com o zero, o
 * endpoint recusa.
 */
function semZeroAEsquerda(dia: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dia);
  if (!partes) return dia;
  return `${partes[1]}-${Number(partes[2])}-${Number(partes[3])}`;
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
        'sem sessão do Sankhya Experience — abra a janela de login em Sankhya › Credenciais e capture a sessão',
      );
    }
    return token;
  }

  /**
   * Falha cedo quando nao ha sessao guardada.
   *
   * Existe para a visao consolidada: sem isto, dez clientes dariam dez vezes o mesmo
   * erro de sessao, cada um como falha isolada, escondendo que a causa e uma so.
   */
  async verificarSessao(): Promise<void> {
    await this.#token();
  }

  /**
   * Uma consulta paginada. `full_count` vem em CADA item (nao uma vez so na resposta),
   * entao o criterio de parada sai do primeiro item de cada pagina.
   */
  async #paginar<T>(
    caminho: string,
    filtros: Record<string, unknown>,
    converter: (linha: Record<string, unknown>) => T,
  ): Promise<T[]> {
    const token = await this.#token();
    const itens: T[] = [];

    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina += 1) {
      const resposta = await fetch(`${API}${caminho}`, {
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
      });

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
        // O `POST /orders` exige a tarefa inteira como veio; guardar so os campos
        // traduzidos inviabilizaria a geracao de OS na fase seguinte.
        bruto: linha,
      }),
    );
  }

  /** Uma chamada avulsa, fora do padrão paginado. */
  async #chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const token = await this.#token();
    const resposta = await fetch(`${API}${caminho}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...init.headers },
      signal: AbortSignal.timeout(30_000),
    });

    if (resposta.status === 401 || resposta.status === 403) {
      throw new SessaoExpiradaError(
        'o Sankhya Experience recusou a sessão (o token dura 72h) — capture a sessão de novo',
      );
    }

    const corpo = (await resposta.json().catch(() => ({}))) as {
      data?: unknown;
      response?: { error?: boolean; message?: string };
    };

    // A API responde 200 com `response.error: true` — o status HTTP sozinho mente.
    if (!resposta.ok || corpo.response?.error) {
      throw new Error(
        corpo.response?.message ?? `Experience respondeu HTTP ${resposta.status} em ${caminho}`,
      );
    }
    return corpo as T;
  }

  /**
   * Tudo que o modal "Gerar OS" precisa ler antes de deixar você preencher. Só leitura —
   * nenhuma destas chamadas cria coisa alguma.
   */
  async prepararOrdem(
    projetoId: number,
    tarefas: TarefaExperience[],
  ): Promise<PreparoOrdem> {
    const brutas = tarefas.map((t) => t.bruto);

    /*
     * `validate` é pré-checagem, não porteiro: quem decide se a OS pode existir é o
     * `POST /orders`. Em 2026-09-11 este endpoint passou a devolver 500 com erro de
     * sistema do Sankhya ("Código do Erro: ...") para tarefas elegíveis — deixá-lo
     * fatal travaria a tela inteira por causa de um problema que não é nosso nem
     * impede o lançamento.
     */
    let avisoValidacao = '';
    try {
      await this.#chamar('/orders/tasks/validate', {
        method: 'POST',
        body: JSON.stringify(brutas),
      });
    } catch (err) {
      avisoValidacao = (err as Error).message;
    }

    const combinacoes = [
      ...new Map(
        tarefas.map((t) => [
          `${t.bruto['process_id']}:${t.bruto['stage_id']}`,
          { process_id: t.bruto['process_id'], stage_id: t.bruto['stage_id'] },
        ]),
      ).values(),
    ];

    const [observacoes, aprovadores, existentes] = await Promise.all([
      tarefas[0]
        ? this.#chamar<{ data?: unknown }>(`/orders/tasks/${tarefas[0].id}/get-tasks-observations`)
        : Promise.resolve({ data: '' }),
      this.#chamar<{ data?: Record<string, unknown>[] }>(
        `/persons/implantation/${projetoId}/get-approvers`,
      ),
      this.#chamar<{ data?: { results?: Record<string, unknown>[] } }>(
        '/orders/check-processes-orders',
        {
          method: 'POST',
          body: JSON.stringify({ implantation_id: projetoId, process_stage_combinations: combinacoes }),
        },
      ),
    ]);

    return {
      observacoes: typeof observacoes.data === 'string' ? observacoes.data : '',
      aprovadores: (aprovadores.data ?? []).map(
        (a): AprovadorExperience => ({
          personId: Number(a['person_id']),
          nome: texto(a['full_name']),
          email: texto(a['email']),
          prioridade: a['priority'] === null || a['priority'] === undefined ? null : Number(a['priority']),
        }),
      ),
      ordensExistentes: (existentes.data?.results ?? []).flatMap((r) =>
        Array.isArray(r['order_ids']) ? (r['order_ids'] as number[]) : [],
      ),
      avisoValidacao,
    };
  }

  /**
   * Cria a OS e, quando pedido, gera o aceite e dispara o e-mail de aprovação.
   *
   * São três chamadas em sequência, na ordem que o botão "Salvar" da tela faz. Só a
   * primeira é obrigatória: parar depois dela deixa a OS lançada sem aceite, que é o
   * que o "Não" do popup da Experience faz.
   *
   * ATENÇÃO: `enviarParaAprovacao` manda e-mail para o CLIENTE. Não é reversível pelo hub.
   */
  async criarOrdem(entrada: {
    projetoId: number;
    personId: number;
    dia: string;
    horaInicio: string;
    horaFim: string;
    intervalo: string;
    observacoes: string;
    notas: string;
    tarefas: TarefaExperience[];
    enviarParaAprovacao: boolean;
  }): Promise<OrdemCriada> {
    const criada = await this.#chamar<{
      data?: { order_id?: number; numos?: string; tab_user_accept?: string };
    }>('/orders', {
      method: 'POST',
      body: JSON.stringify({
        implantation_id: entrada.projetoId,
        person_id: entrada.personId,
        // Sem zero à esquerda no mês e no dia: a API devolve erro com `2026-09-10`,
        // e espera `2026-9-10`. Foi assim que a tela mandou no teste real.
        date_done: semZeroAEsquerda(entrada.dia),
        hour_to_start: entrada.horaInicio,
        hour_to_finish: entrada.horaFim,
        hour_to_lunch: entrada.intervalo,
        additional_information: entrada.observacoes,
        additional_notes: entrada.notas,
        // A tarefa inteira, como veio da API — é o que o endpoint espera.
        tasks: entrada.tarefas.map((t) => t.bruto),
      }),
    });

    const orderId = Number(criada.data?.order_id ?? 0);
    const resultado: OrdemCriada = {
      orderId,
      numos: texto(criada.data?.numos),
      permiteAceite: String(criada.data?.tab_user_accept ?? '').toLowerCase() === 'true',
      aceiteId: null,
      emailEnviado: false,
    };

    if (!entrada.enviarParaAprovacao || !orderId) return resultado;

    const aceite = await this.#chamar<{ data?: { id?: number } }>('/accepted-os', {
      method: 'POST',
      body: JSON.stringify({
        accepted_os: { person_id: entrada.personId, implantation_id: entrada.projetoId },
        accepted_os_orders: { orders_id: [orderId] },
      }),
    });
    resultado.aceiteId = Number(aceite.data?.id ?? 0) || null;

    if (resultado.aceiteId) {
      await this.#chamar('/accepted-os/send-email', {
        method: 'POST',
        body: JSON.stringify({ accepted_id: resultado.aceiteId }),
      });
      resultado.emailEnviado = true;
    }

    return resultado;
  }

  /** `periodo` em `YYYY-MM-DD`; a API espera o dia com hora. */
  ordens(projetoId: number, personId: number, de: string, ate: string): Promise<OrdemExperience[]> {
    return this.#paginar(
      `/orders/filtering?implantation_ids=${projetoId}`,
      { period: [`${de} 00:00:00`, `${ate} 23:59:59`], users: [personId] },
      (linha) => ({
        id: Number(linha['order_id'] ?? linha['id']),
        dia: paraIso(texto(linha['order_done_date'])),
        descricao: texto(linha['description']),
        tipo: texto(linha['order_type']),
        numeroSankhya: texto(linha['numos_sankhya']),
        statusAceite: texto(linha['accepted_os_status']),
        horasFeitas: texto(linha['total_done']),
        etapa: texto(linha['stage_name']),
        processos: texto(linha['process_all']),
      }),
    );
  }
}
