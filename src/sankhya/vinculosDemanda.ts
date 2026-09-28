/**
 * De qual demanda (ID da Solicitação de Serviços DS) é cada OS da Experience.
 *
 * A OS da Experience não traz o ID da demanda (medido em 2026-09-28: nem a listagem nem o
 * detalhe). Quem traz é a TAREFA: o consultor escreve "TECH | ID 2996 - ..." nas
 * observações, e a tarefa carrega o número do pedido de origem (`application_code`) — o
 * mesmo que a OS gerada a partir dela. O vínculo, então, é por PEDIDO:
 *
 *  1. OS vinculada à mão (exceção de uma OS só);
 *  2. pedido vinculado à mão (todas as OS dele de uma vez);
 *  3. pedido aprendido das tarefas — guardado aqui, porque a Experience só lista tarefa
 *     em aberto: sem guardar, a OS de agosto perderia o vínculo quando a tarefa fechasse;
 *  4. ID escrito na própria OS;
 *  5. cliente com uma demanda só.
 *
 * Um pedido cujas tarefas citam demandas diferentes não é aprendido: chutar uma delas
 * mandaria horas para a demanda errada sem ninguém perceber.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { idsDemandaNoTexto } from '../demandas.ts';
import type { OrigemDemandaOs } from '../types.ts';

export interface VinculoResolvido {
  demanda: string;
  origem: OrigemDemandaOs;
}

const ID_DEMANDA = /^\d{1,9}$/;

export class VinculosDemanda {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS dem_pedido (
        projeto_id    INTEGER NOT NULL,
        pedido        TEXT NOT NULL,
        demanda       TEXT NOT NULL,
        origem        TEXT NOT NULL CHECK (origem IN ('manual', 'tarefa')),
        atualizado_em INTEGER NOT NULL,
        PRIMARY KEY (projeto_id, pedido)
      );
      CREATE TABLE IF NOT EXISTS dem_os (
        order_id      INTEGER PRIMARY KEY,
        demanda       TEXT NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
      -- Agendamento da Agenda de Recursos (NUEVENTO) e tarefa da Experience sem o ID no
      -- texto, ou com o ID errado: o vínculo feito na tela vale por cima do texto.
      CREATE TABLE IF NOT EXISTS dem_evento (
        nuevento      INTEGER PRIMARY KEY,
        demanda       TEXT NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS dem_tarefa (
        tarefa_id     INTEGER PRIMARY KEY,
        demanda       TEXT NOT NULL,
        atualizado_em INTEGER NOT NULL
      );
    `);
  }

  /** Guarda pedido -> demanda a partir das tarefas. Nunca sobrescreve o que foi feito à mão. */
  aprender(projetoId: number, tarefas: { id?: number; pedido: string; observacoes: string }[]): void {
    // Tarefa vinculada à mão ensina com o ID escolhido, não com o do texto.
    const manuais = this.manuaisTarefas(tarefas.map((t) => Number(t.id)));
    const porPedido = new Map<string, Set<string>>();
    for (const t of tarefas) {
      const pedido = (t.pedido ?? '').trim();
      if (!pedido) continue;
      const manual = manuais.get(Number(t.id));
      const ids = manual ? [manual] : idsDemandaNoTexto(t.observacoes);
      if (!ids.length) continue;
      const atual = porPedido.get(pedido) ?? new Set<string>();
      for (const id of ids) atual.add(id);
      porPedido.set(pedido, atual);
    }

    const gravar = this.#db.prepare(
      `INSERT INTO dem_pedido (projeto_id, pedido, demanda, origem, atualizado_em)
       VALUES (?, ?, ?, 'tarefa', ?)
       ON CONFLICT (projeto_id, pedido) DO UPDATE SET
         demanda = excluded.demanda, atualizado_em = excluded.atualizado_em
       WHERE dem_pedido.origem = 'tarefa'`,
    );
    for (const [pedido, ids] of porPedido) {
      if (ids.size !== 1) continue;
      gravar.run(projetoId, pedido, [...ids][0]!, Date.now());
    }
  }

  /** Vínculo manual do pedido; `null` apaga e deixa o aprendizado pelas tarefas valer de novo. */
  definirPedido(projetoId: number, pedido: string, demanda: string | null): void {
    const p = pedido.trim();
    if (!p) throw new Error('pedido vazio');
    if (demanda === null) {
      this.#db.prepare('DELETE FROM dem_pedido WHERE projeto_id = ? AND pedido = ?').run(projetoId, p);
      return;
    }
    if (!ID_DEMANDA.test(demanda)) throw new Error('ID de demanda inválido');
    this.#db
      .prepare(
        `INSERT INTO dem_pedido (projeto_id, pedido, demanda, origem, atualizado_em)
         VALUES (?, ?, ?, 'manual', ?)
         ON CONFLICT (projeto_id, pedido) DO UPDATE SET
           demanda = excluded.demanda, origem = 'manual', atualizado_em = excluded.atualizado_em`,
      )
      .run(projetoId, p, demanda, Date.now());
  }

  /** Exceção de uma OS só; `null` volta a seguir o pedido. */
  definirOs(orderId: number, demanda: string | null): void {
    if (!Number.isInteger(orderId) || orderId <= 0) throw new Error('OS inválida');
    if (demanda === null) {
      this.#db.prepare('DELETE FROM dem_os WHERE order_id = ?').run(orderId);
      return;
    }
    if (!ID_DEMANDA.test(demanda)) throw new Error('ID de demanda inválido');
    this.#db
      .prepare(
        `INSERT INTO dem_os (order_id, demanda, atualizado_em) VALUES (?, ?, ?)
         ON CONFLICT (order_id) DO UPDATE SET demanda = excluded.demanda, atualizado_em = excluded.atualizado_em`,
      )
      .run(orderId, demanda, Date.now());
  }

  /** Vínculo manual de um agendamento (NUEVENTO) ou de uma tarefa; `null` volta ao texto. */
  definirEvento(nuevento: number, demanda: string | null): void {
    this.#definirSimples('dem_evento', 'nuevento', nuevento, demanda);
  }

  definirTarefa(tarefaId: number, demanda: string | null): void {
    this.#definirSimples('dem_tarefa', 'tarefa_id', tarefaId, demanda);
  }

  /** Vínculos manuais de agendamentos/tarefas destes IDs. */
  manuaisEventos(nueventos: number[]): Map<number, string> {
    return this.#lerSimples('dem_evento', 'nuevento', nueventos);
  }

  manuaisTarefas(ids: number[]): Map<number, string> {
    return this.#lerSimples('dem_tarefa', 'tarefa_id', ids);
  }

  #definirSimples(tabela: string, coluna: string, id: number, demanda: string | null): void {
    if (!Number.isInteger(id) || id <= 0) throw new Error('registro inválido');
    if (demanda === null) {
      this.#db.prepare(`DELETE FROM ${tabela} WHERE ${coluna} = ?`).run(id);
      return;
    }
    if (!ID_DEMANDA.test(demanda)) throw new Error('ID de demanda inválido');
    this.#db
      .prepare(
        `INSERT INTO ${tabela} (${coluna}, demanda, atualizado_em) VALUES (?, ?, ?)
         ON CONFLICT (${coluna}) DO UPDATE SET demanda = excluded.demanda, atualizado_em = excluded.atualizado_em`,
      )
      .run(id, demanda, Date.now());
  }

  #lerSimples(tabela: string, coluna: string, ids: number[]): Map<number, string> {
    const validos = ids.filter((n) => Number.isInteger(n) && n > 0);
    const mapa = new Map<number, string>();
    if (!validos.length) return mapa;
    const marcas = validos.map(() => '?').join(', ');
    for (const l of this.#db
      .prepare(`SELECT ${coluna} AS id, demanda FROM ${tabela} WHERE ${coluna} IN (${marcas})`)
      .all(...validos) as { id: number; demanda: string }[]) {
      mapa.set(Number(l.id), l.demanda);
    }
    return mapa;
  }

  /** A demanda de cada OS, pela ordem de prioridade do topo do arquivo. */
  resolver(
    projetoId: number,
    ordens: { id: number; pedido: string; descricao: string }[],
    demandasDoCliente: string[],
  ): Map<number, VinculoResolvido> {
    const pedidos = new Map<string, { demanda: string; origem: string }>();
    for (const l of this.#db
      .prepare('SELECT pedido, demanda, origem FROM dem_pedido WHERE projeto_id = ?')
      .all(projetoId) as { pedido: string; demanda: string; origem: string }[]) {
      pedidos.set(l.pedido, l);
    }

    const ids = ordens.map((o) => o.id).filter((n) => Number.isInteger(n) && n > 0);
    const porOs = new Map<number, string>();
    if (ids.length) {
      const marcas = ids.map(() => '?').join(', ');
      for (const l of this.#db
        .prepare(`SELECT order_id, demanda FROM dem_os WHERE order_id IN (${marcas})`)
        .all(...ids) as { order_id: number; demanda: string }[]) {
        porOs.set(Number(l.order_id), l.demanda);
      }
    }

    const unica = demandasDoCliente.length === 1 ? demandasDoCliente[0]! : '';
    const resultado = new Map<number, VinculoResolvido>();
    for (const o of ordens) {
      const manualOs = porOs.get(o.id);
      const doPedido = pedidos.get((o.pedido ?? '').trim());
      const noTexto = idsDemandaNoTexto(o.descricao)[0];
      const vinculo: VinculoResolvido = manualOs
        ? { demanda: manualOs, origem: 'os' }
        : doPedido
          ? { demanda: doPedido.demanda, origem: doPedido.origem === 'manual' ? 'pedido' : 'tarefa' }
          : noTexto
            ? { demanda: noTexto, origem: 'texto' }
            : unica
              ? { demanda: unica, origem: 'unica' }
              : { demanda: '', origem: '' };
      resultado.set(o.id, vinculo);
    }
    return resultado;
  }

  close(): void {
    this.#db.close();
  }
}
