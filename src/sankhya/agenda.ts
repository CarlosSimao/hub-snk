/**
 * Snapshot da Agenda de Recursos do Sankhya ERP, em SQLite.
 *
 * Recurso e evento são entidades distintas: nome, cargo e cor do consultor não se
 * repetem em cada evento.
 *
 * Datas ficam em TEXT no formato `YYYY-MM-DD HH:mm:ss`, e não em algum tipo de data:
 * nesse formato a comparação de texto já é a comparação cronológica, então a consulta
 * por período não precisa converter nada nem carregar fuso horário para o meio.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaImportada } from './agendaParser.ts';
import type {
  EstadoAgendaRecursos,
  EventoComRecurso,
  RecursoComTotal,
} from '../types.ts';

export class AgendaRecursos {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS ag_recursos (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        codusu            INTEGER,
        nomeusu           TEXT NOT NULL DEFAULT '',
        codcargo          INTEGER,
        descrcargo        TEXT NOT NULL DEFAULT '',
        cor_hex           TEXT NOT NULL DEFAULT '',
        cor_conflito_hex  TEXT NOT NULL DEFAULT '',
        problema_conexao  TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS ag_eventos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        recurso_id    INTEGER NOT NULL REFERENCES ag_recursos(id) ON DELETE CASCADE,
        nuevento      INTEGER,
        codusu        INTEGER,
        nomeusu       TEXT NOT NULL DEFAULT '',
        nomeparc      TEXT NOT NULL DEFAULT '',
        codparc       INTEGER,
        allday        TEXT NOT NULL DEFAULT '',
        inicio        TEXT NOT NULL DEFAULT '',
        fim           TEXT NOT NULL DEFAULT '',
        descrabrev    TEXT NOT NULL DEFAULT '',
        descrlonga    TEXT NOT NULL DEFAULT '',
        tipo          TEXT NOT NULL DEFAULT '',
        confirmado    TEXT NOT NULL DEFAULT '',
        sincronizar   TEXT NOT NULL DEFAULT '',
        usulancador   TEXT NOT NULL DEFAULT '',
        dhlcto        TEXT NOT NULL DEFAULT '',
        numetapa      INTEGER,
        nufap         INTEGER,
        nueventopai   INTEGER,
        financiallate TEXT NOT NULL DEFAULT '',
        diastraso     INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ag_eventos_periodo ON ag_eventos (inicio, fim);
      CREATE INDEX IF NOT EXISTS idx_ag_eventos_usuario ON ag_eventos (nomeusu);

      CREATE TABLE IF NOT EXISTS ag_importacao (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        importado_em INTEGER NOT NULL
      );
    `);
  }

  /**
   * Troca o snapshot inteiro pelo novo, numa transação.
   *
   * O ID real do recurso sai do `lastInsertRowid` de cada inserção, não de uma
   * contagem: `AUTOINCREMENT` não reinicia depois de `DELETE`, e assumir que os
   * recursos recém-inseridos serão 1..N faria todo evento apontar para recurso
   * inexistente — o JOIN devolveria zero linhas e a tela ficaria em branco, sem erro.
   */
  importar(dados: AgendaImportada): EstadoAgendaRecursos {
    this.#db.exec('BEGIN');
    try {
      this.#db.exec('DELETE FROM ag_eventos');
      this.#db.exec('DELETE FROM ag_recursos');

      const inserirRecurso = this.#db.prepare(
        `INSERT INTO ag_recursos
           (codusu, nomeusu, codcargo, descrcargo, cor_hex, cor_conflito_hex, problema_conexao)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      const inserirEvento = this.#db.prepare(
        `INSERT INTO ag_eventos
           (recurso_id, nuevento, codusu, nomeusu, nomeparc, codparc, allday, inicio, fim,
            descrabrev, descrlonga, tipo, confirmado, sincronizar, usulancador, dhlcto,
            numetapa, nufap, nueventopai, financiallate, diastraso)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      for (const { recurso, eventos } of dados.recursos) {
        const resultado = inserirRecurso.run(
          recurso.codusu,
          recurso.nomeusu,
          recurso.codcargo,
          recurso.descrcargo,
          recurso.corHex,
          recurso.corConflitoHex,
          recurso.problemaConexao,
        );
        const recursoId = Number(resultado.lastInsertRowid);

        for (const e of eventos) {
          inserirEvento.run(
            recursoId,
            e.nuevento,
            e.codusu,
            e.nomeusu,
            e.nomeparc,
            e.codparc,
            e.allday,
            e.inicio,
            e.fim,
            e.descrabrev,
            e.descrlonga,
            e.tipo,
            e.confirmado,
            e.sincronizar,
            e.usulancador,
            e.dhlcto,
            e.numetapa,
            e.nufap,
            e.nueventopai,
            e.financiallate,
            e.diastraso,
          );
        }
      }

      this.#db
        .prepare(
          `INSERT INTO ag_importacao (id, importado_em) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET importado_em = excluded.importado_em`,
        )
        .run(Date.now());

      this.#db.exec('COMMIT');
    } catch (err) {
      // Sem isto, uma falha no meio deixaria o snapshot antigo apagado e o novo pela
      // metade — pior que não ter importado.
      this.#db.exec('ROLLBACK');
      throw err;
    }

    return this.estado();
  }

  estado(): EstadoAgendaRecursos {
    const recursos = this.#db.prepare('SELECT COUNT(*) AS n FROM ag_recursos').get() as { n: number };
    const eventos = this.#db.prepare('SELECT COUNT(*) AS n FROM ag_eventos').get() as { n: number };
    const importacao = this.#db.prepare('SELECT importado_em FROM ag_importacao WHERE id = 1').get() as
      | { importado_em: number }
      | undefined;

    return {
      recursos: Number(recursos.n),
      eventos: Number(eventos.n),
      importadoEm: importacao ? Number(importacao.importado_em) : null,
    };
  }

  recursos(): RecursoComTotal[] {
    const linhas = this.#db
      .prepare(
        `SELECT r.*, COUNT(e.id) AS total_eventos
           FROM ag_recursos r
           LEFT JOIN ag_eventos e ON e.recurso_id = r.id
          GROUP BY r.id
          ORDER BY r.nomeusu COLLATE NOCASE`,
      )
      .all() as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      id: Number(l['id']),
      codusu: l['codusu'] === null ? null : Number(l['codusu']),
      nomeusu: String(l['nomeusu']),
      codcargo: l['codcargo'] === null ? null : Number(l['codcargo']),
      descrcargo: String(l['descrcargo']),
      corHex: String(l['cor_hex']),
      corConflitoHex: String(l['cor_conflito_hex']),
      problemaConexao: String(l['problema_conexao']),
      totalEventos: Number(l['total_eventos']),
    }));
  }

  /**
   * Eventos que CRUZAM o período, não só os que começam nele — férias e eventos de
   * vários dias precisam aparecer na semana inteira que ocupam.
   *
   * O filtro por usuário é pelo RECURSO (a lane), não pelo `NOMEUSU` do evento: a lane
   * é quem define de quem é a agenda, e o campo repetido dentro do evento é dado
   * denormalizado que pode divergir dela.
   */
  eventos(de: string, ate: string, usuario = ''): EventoComRecurso[] {
    const linhas = this.#db
      .prepare(
        `SELECT e.*, r.descrcargo, r.cor_hex
           FROM ag_eventos e
           JOIN ag_recursos r ON r.id = e.recurso_id
          WHERE e.fim >= ? AND e.inicio <= ?
            AND (? = '' OR r.nomeusu = ?)
          ORDER BY e.inicio`,
      )
      .all(de, ate, usuario, usuario) as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      id: Number(l['id']),
      nuevento: l['nuevento'] === null ? null : Number(l['nuevento']),
      codusu: l['codusu'] === null ? null : Number(l['codusu']),
      nomeusu: String(l['nomeusu']),
      nomeparc: String(l['nomeparc']),
      codparc: l['codparc'] === null ? null : Number(l['codparc']),
      allday: String(l['allday']),
      inicio: String(l['inicio']),
      fim: String(l['fim']),
      descrabrev: String(l['descrabrev']),
      descrlonga: String(l['descrlonga']),
      tipo: String(l['tipo']),
      confirmado: String(l['confirmado']),
      sincronizar: String(l['sincronizar']),
      usulancador: String(l['usulancador']),
      dhlcto: String(l['dhlcto']),
      numetapa: l['numetapa'] === null ? null : Number(l['numetapa']),
      nufap: l['nufap'] === null ? null : Number(l['nufap']),
      nueventopai: l['nueventopai'] === null ? null : Number(l['nueventopai']),
      financiallate: String(l['financiallate']),
      diastraso: l['diastraso'] === null ? null : Number(l['diastraso']),
      descrcargo: String(l['descrcargo']),
      corHex: String(l['cor_hex']),
    }));
  }

  close(): void {
    this.#db.close();
  }
}
