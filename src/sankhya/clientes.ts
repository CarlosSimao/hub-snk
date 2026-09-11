/**
 * Cadastro de clientes — a entidade que amarra os tres mundos do painel.
 *
 * Um cliente liga um projeto do Sankhya Experience (de onde vem tarefa e OS), um
 * recurso da Agenda do Sankhya ERP (de onde vem o evento de agenda) e uma pasta de
 * repositorio git local (de onde vem commit e push). Nada disso e descoberto
 * automaticamente: a associacao e manual, feita na tela.
 *
 * Banco proprio (`sankhya.db`) e nao o `monitor.db`: o historico de monitoramento tem
 * poda por janela de retencao e e descartavel, este cadastro nao e.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Cliente, ClienteEntrada } from '../types.ts';

interface Linha {
  id: number;
  nome: string;
  experience_projeto_id: number | null;
  experience_person_id: number | null;
  agenda_recurso_usuario: string;
  repositorio_local: string;
  repositorio_remoto: string;
}

function paraCliente(linha: Linha): Cliente {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    experienceProjetoId: linha.experience_projeto_id === null ? null : Number(linha.experience_projeto_id),
    experiencePersonId: linha.experience_person_id === null ? null : Number(linha.experience_person_id),
    agendaRecursoUsuario: linha.agenda_recurso_usuario,
    repositorioLocal: linha.repositorio_local,
    repositorioRemoto: linha.repositorio_remoto,
  };
}

export class Clientes {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS clientes (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        nome                   TEXT    NOT NULL,
        experience_projeto_id  INTEGER,
        experience_person_id   INTEGER,
        agenda_recurso_usuario TEXT    NOT NULL DEFAULT '',
        repositorio_local      TEXT    NOT NULL DEFAULT '',
        repositorio_remoto     TEXT    NOT NULL DEFAULT ''
      );
    `);
  }

  listar(): Cliente[] {
    const linhas = this.#db
      .prepare('SELECT * FROM clientes ORDER BY nome COLLATE NOCASE')
      .all() as unknown as Linha[];
    return linhas.map(paraCliente);
  }

  obter(id: number): Cliente | undefined {
    const linha = this.#db.prepare('SELECT * FROM clientes WHERE id = ?').get(id) as unknown as
      | Linha
      | undefined;
    return linha ? paraCliente(linha) : undefined;
  }

  criar(entrada: ClienteEntrada): Cliente {
    const resultado = this.#db
      .prepare(
        `INSERT INTO clientes
           (nome, experience_projeto_id, experience_person_id, agenda_recurso_usuario, repositorio_local, repositorio_remoto)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entrada.nome,
        entrada.experienceProjetoId,
        entrada.experiencePersonId,
        entrada.agendaRecursoUsuario,
        entrada.repositorioLocal,
        entrada.repositorioRemoto,
      );

    return { id: Number(resultado.lastInsertRowid), ...entrada };
  }

  atualizar(id: number, entrada: ClienteEntrada): Cliente | undefined {
    const resultado = this.#db
      .prepare(
        `UPDATE clientes SET
           nome = ?, experience_projeto_id = ?, experience_person_id = ?,
           agenda_recurso_usuario = ?, repositorio_local = ?, repositorio_remoto = ?
         WHERE id = ?`,
      )
      .run(
        entrada.nome,
        entrada.experienceProjetoId,
        entrada.experiencePersonId,
        entrada.agendaRecursoUsuario,
        entrada.repositorioLocal,
        entrada.repositorioRemoto,
        id,
      );

    if (!Number(resultado.changes ?? 0)) return undefined;
    return { id, ...entrada };
  }

  remover(id: number): boolean {
    const resultado = this.#db.prepare('DELETE FROM clientes WHERE id = ?').run(id);
    return Number(resultado.changes ?? 0) > 0;
  }

  close(): void {
    this.#db.close();
  }
}
