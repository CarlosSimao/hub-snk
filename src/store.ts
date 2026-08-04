/**
 * Persistencia do historico em SQLite (`node:sqlite`, sem dependencia nativa).
 *
 * Duas tabelas:
 *  - `samples`: uma linha por execucao de check. Alimenta uptime %, sparkline de
 *    latencia e a barra de status. Podada pela janela de retencao.
 *  - `snapshots`: o ultimo resultado completo (indicadores + componentes) por check,
 *    para o dashboard nascer preenchido apos um restart do hub em vez de tudo cinza.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Alert, HistoryPoint, Status } from './types.ts';

export interface UptimeRow {
  uptimePct: number | null;
  samples: number;
}

export class Store {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'monitor.db'));
    // WAL: leituras do dashboard nao bloqueiam a escrita do scheduler.
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec('PRAGMA synchronous = NORMAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS samples (
        check_key  TEXT    NOT NULL,
        ts         INTEGER NOT NULL,
        status     TEXT    NOT NULL,
        latency_ms REAL,
        message    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_samples_key_ts ON samples (check_key, ts);

      CREATE TABLE IF NOT EXISTS snapshots (
        check_key TEXT PRIMARY KEY,
        ts        INTEGER NOT NULL,
        payload   TEXT    NOT NULL
      );

      CREATE TABLE IF NOT EXISTS alerts (
        id      TEXT    PRIMARY KEY,
        ts      INTEGER NOT NULL,
        payload TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts (ts);
    `);
  }

  record(key: string, ts: number, status: Status, latencyMs: number | null, message: string): void {
    this.#db
      .prepare('INSERT INTO samples (check_key, ts, status, latency_ms, message) VALUES (?, ?, ?, ?, ?)')
      .run(key, ts, status, latencyMs, message);
  }

  /** Amostras da janela, da mais antiga para a mais nova. `limit` corta as mais antigas. */
  history(key: string, sinceTs: number, limit = 240): HistoryPoint[] {
    const rows = this.#db
      .prepare(
        `SELECT ts, status, latency_ms FROM samples
         WHERE check_key = ? AND ts >= ?
         ORDER BY ts DESC
         LIMIT ?`,
      )
      .all(key, sinceTs, limit) as { ts: number; status: string; latency_ms: number | null }[];

    return rows
      .map((r) => ({ ts: Number(r.ts), status: r.status as Status, latencyMs: r.latency_ms }))
      .reverse();
  }

  /**
   * Disponibilidade na janela. `degraded` conta como disponivel (o servico respondeu,
   * so que devagar ou parcial); `unknown` fica fora do denominador.
   */
  uptime(key: string, sinceTs: number): UptimeRow {
    const row = this.#db
      .prepare(
        `SELECT
           SUM(CASE WHEN status IN ('up', 'degraded') THEN 1 ELSE 0 END) AS ok,
           SUM(CASE WHEN status <> 'unknown' THEN 1 ELSE 0 END)          AS total
         FROM samples
         WHERE check_key = ? AND ts >= ?`,
      )
      .get(key, sinceTs) as { ok: number | null; total: number | null } | undefined;

    const total = Number(row?.total ?? 0);
    if (!total) return { uptimePct: null, samples: 0 };
    return { uptimePct: (Number(row?.ok ?? 0) / total) * 100, samples: total };
  }

  saveSnapshot(key: string, ts: number, payload: unknown): void {
    this.#db
      .prepare(
        `INSERT INTO snapshots (check_key, ts, payload) VALUES (?, ?, ?)
         ON CONFLICT (check_key) DO UPDATE SET ts = excluded.ts, payload = excluded.payload`,
      )
      .run(key, ts, JSON.stringify(payload));
  }

  loadSnapshots(): Map<string, { ts: number; payload: unknown }> {
    const rows = this.#db.prepare('SELECT check_key, ts, payload FROM snapshots').all() as {
      check_key: string;
      ts: number;
      payload: string;
    }[];

    const out = new Map<string, { ts: number; payload: unknown }>();
    for (const row of rows) {
      try {
        out.set(row.check_key, { ts: Number(row.ts), payload: JSON.parse(row.payload) });
      } catch {
        // Snapshot corrompido nao pode impedir o hub de subir — o proximo ciclo reescreve.
      }
    }
    return out;
  }

  recordAlert(alert: Alert): void {
    this.#db
      .prepare('INSERT OR REPLACE INTO alerts (id, ts, payload) VALUES (?, ?, ?)')
      .run(alert.id, alert.ts, JSON.stringify(alert));
  }

  /** Alertas mais recentes primeiro. */
  recentAlerts(limit = 50): Alert[] {
    const rows = this.#db
      .prepare('SELECT payload FROM alerts ORDER BY ts DESC LIMIT ?')
      .all(limit) as { payload: string }[];

    const out: Alert[] = [];
    for (const row of rows) {
      try {
        out.push(JSON.parse(row.payload) as Alert);
      } catch {
        // Linha corrompida nao pode derrubar o feed.
      }
    }
    return out;
  }

  pruneAlerts(olderThanTs: number): number {
    const result = this.#db.prepare('DELETE FROM alerts WHERE ts < ?').run(olderThanTs);
    return Number(result.changes ?? 0);
  }

  /** Remove amostras fora da janela de retencao. Devolve quantas linhas sairam. */
  prune(olderThanTs: number): number {
    const result = this.#db.prepare('DELETE FROM samples WHERE ts < ?').run(olderThanTs);
    return Number(result.changes ?? 0);
  }

  /** Descarta snapshots de checks que sumiram do YAML. */
  pruneSnapshots(activeKeys: Set<string>): void {
    const rows = this.#db.prepare('SELECT check_key FROM snapshots').all() as { check_key: string }[];
    const stale = rows.map((r) => r.check_key).filter((k) => !activeKeys.has(k));
    if (!stale.length) return;
    const stmt = this.#db.prepare('DELETE FROM snapshots WHERE check_key = ?');
    for (const key of stale) stmt.run(key);
  }

  close(): void {
    this.#db.close();
  }
}
