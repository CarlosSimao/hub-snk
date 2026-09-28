/**
 * Atualização automática da Agenda de Recursos e das Solicitações de Serviços DS.
 *
 * Roda quando o DS abre e, depois, a cada 4 horas dentro do expediente (07:00–19:00):
 * a agenda não muda tanto a ponto de valer chamar o ERP de 15 em 15 minutos. A leitura
 * sai da aba ERP logada; se ela ainda não está logada no boot, a primeira atualização
 * fica tentando a cada tique até conseguir.
 *
 * Só a Agenda Mensal usa o que chega por aqui de novo (solicitações); a agenda dentro do
 * cliente continua lendo o mesmo snapshot de sempre.
 */
import { idsDemandaNoTexto, listarIdsDemanda } from '../demandas.ts';
import { parsearAgenda } from './agendaParser.ts';
import type { AgendaRecursos } from './agenda.ts';
import type { Clientes } from './clientes.ts';
import type { Solicitacoes, SolicitacoesDoErp } from './solicitacoes.ts';
import type { EstadoSincronizacao } from '../types.ts';

export const INTERVALO_MS = 4 * 60 * 60 * 1000;
export const INICIO_EXPEDIENTE = 7;
export const FIM_EXPEDIENTE = 19;
/** De quanto em quanto tempo o relógio confere se chegou a hora. */
const TIQUE_MS = 5 * 60 * 1000;

export interface DepsSincronizacao {
  agenda: AgendaRecursos;
  clientes: Clientes;
  solicitacoes: Solicitacoes;
  /** JSON cru de `AgendaRecursosSP.carregarAgendas`, datas em `DD/MM/YYYY`. */
  buscarAgenda: (de: string, ate: string) => Promise<string>;
  /** Ausente fora do shell desktop: aí só a agenda é atualizada. */
  buscarSolicitacoes?: (codigos: number[]) => Promise<SolicitacoesDoErp>;
  aoFalhar?: (err: unknown) => void;
}

function dataSankhya(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * A janela buscada: do primeiro dia do mês passado ao último do retrasado-à-frente.
 * Cobre o que a Agenda Mensal navega no dia a dia (mês anterior, atual e os dois
 * seguintes) sem pedir ao ERP meses que ninguém abre.
 */
export function janelaDeBusca(agora: Date): { de: string; ate: string } {
  const de = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const ate = new Date(agora.getFullYear(), agora.getMonth() + 3, 0);
  return { de: dataSankhya(de), ate: dataSankhya(ate) };
}

/**
 * Chegou a hora de atualizar?
 *
 * Sem nenhuma atualização bem-sucedida desde que o DS abriu, sempre sim — é a "ao
 * abrir", e ela vale fora do expediente também. Depois, só dentro do expediente e com
 * 4 horas desde a última.
 */
export function deveAtualizar(agora: Date, ultimaEm: number | null): boolean {
  if (ultimaEm === null) return true;
  const hora = agora.getHours();
  if (hora < INICIO_EXPEDIENTE || hora >= FIM_EXPEDIENTE) return false;
  return agora.getTime() - ultimaEm >= INTERVALO_MS;
}

/** Quando a próxima atualização deve acontecer, para a tela mostrar. */
export function proximaAtualizacao(agora: Date, ultimaEm: number | null): Date {
  if (ultimaEm === null) return agora;
  let alvo = new Date(Math.max(ultimaEm + INTERVALO_MS, agora.getTime()));
  if (alvo.getHours() >= FIM_EXPEDIENTE) {
    alvo = new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate() + 1, INICIO_EXPEDIENTE);
  } else if (alvo.getHours() < INICIO_EXPEDIENTE) {
    alvo = new Date(alvo.getFullYear(), alvo.getMonth(), alvo.getDate(), INICIO_EXPEDIENTE);
  }
  return alvo;
}

/**
 * As demandas de que a Agenda Mensal precisa: as cadastradas em cada cliente e as que
 * aparecem nos eventos do parceiro dele — assim uma demanda nova lançada na agenda já
 * entra sem ninguém precisar editar o cadastro.
 */
export function demandasParaBuscar(
  clientes: { agendaDemandaId: string; agendaCodparc: number | null; agendaRecursoUsuario: string }[],
  textosDoParceiro: (codparc: number, usuario: string) => string[],
): number[] {
  const ids = new Set<number>();
  for (const c of clientes) {
    for (const id of listarIdsDemanda(c.agendaDemandaId)) ids.add(Number(id));
    if (c.agendaCodparc === null) continue;
    for (const texto of textosDoParceiro(c.agendaCodparc, c.agendaRecursoUsuario)) {
      for (const id of idsDemandaNoTexto(texto)) ids.add(Number(id));
    }
  }
  return [...ids].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
}

export class SincronizacaoAgenda {
  readonly #deps: DepsSincronizacao;
  #ultimaEm: number | null = null;
  #tentativaEm: number | null = null;
  #erro = '';
  #rodando: Promise<EstadoSincronizacao> | null = null;
  #relogio: NodeJS.Timeout | null = null;

  constructor(deps: DepsSincronizacao) {
    this.#deps = deps;
  }

  iniciar(): void {
    if (this.#relogio) return;
    void this.#tique();
    this.#relogio = setInterval(() => void this.#tique(), TIQUE_MS);
    this.#relogio.unref?.();
  }

  parar(): void {
    if (this.#relogio) clearInterval(this.#relogio);
    this.#relogio = null;
  }

  estado(): EstadoSincronizacao {
    return {
      ultimaEm: this.#ultimaEm,
      tentativaEm: this.#tentativaEm,
      erro: this.#erro,
      rodando: this.#rodando !== null,
      proximaEm: proximaAtualizacao(new Date(), this.#ultimaEm).getTime(),
    };
  }

  async #tique(): Promise<void> {
    if (this.#rodando || !deveAtualizar(new Date(), this.#ultimaEm)) return;
    await this.atualizar();
  }

  /** Atualiza agora. Chamada concorrente espera a que já está em andamento. */
  atualizar(): Promise<EstadoSincronizacao> {
    this.#rodando ??= this.#executar().finally(() => {
      this.#rodando = null;
    });
    return this.#rodando;
  }

  async #executar(): Promise<EstadoSincronizacao> {
    const { agenda, clientes, solicitacoes, buscarAgenda, buscarSolicitacoes, aoFalhar } = this.#deps;
    this.#tentativaEm = Date.now();
    try {
      const { de, ate } = janelaDeBusca(new Date());
      agenda.importar(parsearAgenda(JSON.parse(await buscarAgenda(de, ate))));

      if (buscarSolicitacoes) {
        // Mesmo casamento pelo nome do resumo mensal para cadastro sem parceiro.
        const comParceiro = clientes.listar().map((c) => ({
          ...c,
          agendaCodparc:
            c.agendaCodparc ?? agenda.casarParceiro(c.nome, c.agendaRecursoUsuario)?.codparc ?? null,
        }));
        const codigos = demandasParaBuscar(comParceiro, (codparc, usuario) =>
          agenda.eventos('0000-00-00 00:00:00', '9999-12-31 23:59:59', usuario, codparc).map((e) => e.descrlonga),
        );
        if (codigos.length) solicitacoes.gravar(codigos, await buscarSolicitacoes(codigos));
      }

      this.#ultimaEm = Date.now();
      this.#erro = '';
    } catch (err) {
      const mensagem = (err as Error).message ?? String(err);
      // Aba sem login fica falhando igual a cada tique — o log só registra quando muda.
      if (mensagem !== this.#erro) aoFalhar?.(err);
      this.#erro = mensagem;
    }
    return { ...this.estado(), rodando: false };
  }
}
