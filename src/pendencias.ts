/**
 * Pendencias de um cliente: o que ficou para tras e precisa de acao sua.
 *
 * Tres coisas, e as tres vem de lugares diferentes:
 *
 *  1. **Tarefa atrasada** — a Experience marca `taskStatus: 'Atrasada'`. E' o caso da
 *     tarefa agendada para um dia que passou e nao foi executada.
 *  2. **Dia com tarefa e nenhuma OS lancada** — trabalho que nao virou fatura. Nao e' a
 *     mesma coisa que (1): a tarefa pode estar em dia e mesmo assim faltar a OS.
 *  3. **E-mail de finalizacao pendente** — a demanda terminou e o e-mail ao parceiro
 *     nao saiu. Diferente das outras duas, esta nao vem da Experience: e' controle do
 *     proprio hub (`demandaFim` + `emailFinalizacaoEm` no cadastro do cliente).
 *
 * A regra de (1) e (2) NAO e' reimplementada aqui: vem de `src/calendario.ts`, o mesmo
 * modulo que o painel usa para pintar o calendario. Duas implementacoes da mesma regra
 * sairiam do ar uma da outra no dia em que um valor novo de `accepted_os_status`
 * aparecesse — que ja' aconteceu uma vez, com `Concluído`.
 */
import { limitesDoMes, mesAtual, montarGrade, semAceite } from './calendario.ts';
import type { Clientes } from './sankhya/clientes.ts';
import type { Experience } from './sankhya/experience.ts';
import type { Cliente } from './types.ts';

export interface PendenciasCliente {
  clienteId: number;
  nome: string;
  /** Tarefas que a Experience marcou como atrasadas. */
  tarefasAtrasadas: { dia: string; titulo: string }[];
  /** Dias passados com tarefa e nenhuma OS — o trabalho não virou fatura. */
  diasSemOs: string[];
  /** OS de dia passado que nunca foram mandadas para aprovação. */
  ordensSemAceite: { dia: string; numero: string }[];
  /** A demanda acabou e o e-mail de finalização ao parceiro não foi marcado como enviado. */
  emailFinalizacaoPendente: boolean;
  /** Preenchido quando não deu para consultar a Experience (sessão expirada, rede). */
  erro: string;
}

export function temPendencia(p: PendenciasCliente): boolean {
  return (
    p.tarefasAtrasadas.length > 0 ||
    p.diasSemOs.length > 0 ||
    p.ordensSemAceite.length > 0 ||
    p.emailFinalizacaoPendente
  );
}

/**
 * A demanda terminou e o e-mail nao foi enviado?
 *
 * Comeca a cobrar A PARTIR do dia de fim (inclusive), nao no dia seguinte: o combinado
 * e' que o e-mail saia ao finalizar, entao no proprio ultimo dia ja' e' pendencia.
 */
export function emailFinalizacaoPendente(cliente: Cliente, hoje: string): boolean {
  if (!cliente.demandaFim) return false;
  if (cliente.emailFinalizacaoEm) return false;
  return cliente.demandaFim <= hoje;
}

export class Pendencias {
  readonly #clientes: Clientes;
  readonly #experience: Experience;

  constructor(clientes: Clientes, experience: Experience) {
    this.#clientes = clientes;
    this.#experience = experience;
  }

  /**
   * Levanta as pendencias de um cliente no mes informado.
   *
   * Falha de consulta nao derruba o levantamento: volta em `erro` e as pendencias que
   * NAO dependem da Experience (o e-mail de finalizacao) continuam valendo. Sem isso,
   * uma sessao expirada esconderia tambem o aviso que o hub sabe dar sozinho.
   */
  async doCliente(cliente: Cliente, mes = mesAtual(), hoje = new Date().toISOString().slice(0, 10)): Promise<PendenciasCliente> {
    const base: PendenciasCliente = {
      clienteId: cliente.id,
      nome: cliente.nome,
      tarefasAtrasadas: [],
      diasSemOs: [],
      ordensSemAceite: [],
      emailFinalizacaoPendente: emailFinalizacaoPendente(cliente, hoje),
      erro: '',
    };

    if (cliente.experienceProjetoId === null || cliente.experiencePersonId === null) return base;

    try {
      // `${mes}-31` parecia inofensivo e faz a Experience responder HTTP 500 em
      // setembro: o último dia do mês vem calculado, não chutado.
      const limites = limitesDoMes(mes);
      if (!limites) return base;
      const { de, ate } = limites;
      const [tarefas, ordens] = await Promise.all([
        this.#experience.tarefas(cliente.experienceProjetoId, cliente.experiencePersonId),
        this.#experience.ordens(cliente.experienceProjetoId, cliente.experiencePersonId, de, ate),
      ]);

      const grade = montarGrade(mes, { tarefas, ordens }, [], hoje).filter((d) => d.doMes);

      for (const dia of grade) {
        for (const tarefa of dia.tarefas) {
          if (tarefa.taskStatus === 'Atrasada') {
            base.tarefasAtrasadas.push({ dia: dia.dia, titulo: tarefa.procedimento });
          }
        }
        if (dia.dia < hoje && dia.tarefas.length > 0 && dia.ordens.length === 0) {
          base.diasSemOs.push(dia.dia);
        }
        for (const ordem of dia.ordens) {
          if (ordem.dia < hoje && semAceite(ordem)) {
            base.ordensSemAceite.push({ dia: ordem.dia, numero: ordem.numeroSankhya });
          }
        }
      }
    } catch (err) {
      base.erro = (err as Error).message;
    }

    return base;
  }

  /** Todos os clientes, em sequência: a Experience não gosta de rajada de chamadas. */
  async deTodos(mes = mesAtual(), hoje = new Date().toISOString().slice(0, 10)): Promise<PendenciasCliente[]> {
    const saida: PendenciasCliente[] = [];
    for (const cliente of this.#clientes.listar()) {
      saida.push(await this.doCliente(cliente, mes, hoje));
    }
    return saida;
  }
}

/** Bloco de texto do resumo diário; vazio quando não há nada a dizer. */
export function textoPendencias(lista: PendenciasCliente[]): string {
  const comAlgo = lista.filter(temPendencia);
  if (comAlgo.length === 0) return '';

  const blocos = comAlgo.map((p) => {
    const linhas: string[] = [`• ${p.nome}`];

    for (const t of p.tarefasAtrasadas) linhas.push(`   tarefa atrasada em ${t.dia}: ${t.titulo}`);
    if (p.diasSemOs.length) {
      linhas.push(`   dia(s) com tarefa e nenhuma OS lançada: ${p.diasSemOs.join(', ')}`);
    }
    for (const o of p.ordensSemAceite) {
      linhas.push(`   OS ${o.numero || '(sem número)'} de ${o.dia} sem aceite gerado`);
    }
    if (p.emailFinalizacaoPendente) {
      linhas.push('   e-mail de finalização ao parceiro AINDA NÃO ENVIADO');
    }
    if (p.erro) linhas.push(`   (não consegui consultar a Experience: ${p.erro})`);

    return linhas.join('\n');
  });

  return ['Pendências:', '', blocos.join('\n\n')].join('\n');
}
