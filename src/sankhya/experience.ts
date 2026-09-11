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
import type { OrdemExperience, TarefaExperience } from '../types.ts';

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
