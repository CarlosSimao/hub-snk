/**
 * Snapshot da Agenda de Recursos do Sankhya ERP, em SQLite.
 *
 * Recurso e evento são entidades distintas: nome, cargo e cor do consultor
 * não se repetem em cada evento.
 *
 * Datas ficam em TEXT no formato `YYYY-MM-DD HH:mm:ss`, e não em algum tipo
 * de data: nesse formato a comparação de texto já é a comparação
 * cronológica, então a consulta por período não precisa converter nada nem
 * carregar fuso horário para o meio.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaImportada } from './agendaParser.ts';
import type {
  EstadoAgendaRecursos,
  EventoComRecurso,
  ParceiroAgenda,
  RecursoComTotal,
} from '../tipos.ts';

/**
 * Reduz um nome a letras e dígitos maiúsculos, sem acento nem sufixo
 * societário.
 *
 * O cadastro do hub é digitado à mão ("Flaps Produtos Automotivos") e o
 * parceiro vem do ERP em caixa alta com sufixo ("FLAPS PRODUTOS
 * AUTOMOTIVOS"). Comparar cru nunca casa.
 */
export function chaveNome(nome: string): string {
  return nome
    .normalize('NFD')
    .toUpperCase()
    .replace(/\b(LTDA|S\.?A|ME|EPP|EIRELI|COMERCIAL|IMPORTADORA|E OUTRO\(S\))\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

export class AgendaRecursos {
  readonly #db: DatabaseSync;

  constructor(diretorioDeDados: string) {
    mkdirSync(diretorioDeDados, { recursive: true });
    this.#db = new DatabaseSync(join(diretorioDeDados, 'sankhya.db'));
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
   * O ID real do recurso sai do `lastInsertRowid` de cada inserção, não de
   * uma contagem: `AUTOINCREMENT` não reinicia depois de `DELETE`, e assumir
   * que os recursos recém-inseridos serão 1..N faria todo evento apontar
   * para recurso inexistente.
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
    } catch (erro) {
      // Sem isto, uma falha no meio deixaria o snapshot antigo apagado e o
      // novo pela metade — pior que não ter importado.
      this.#db.exec('ROLLBACK');
      throw erro;
    }

    return this.estado();
  }

  estado(): EstadoAgendaRecursos {
    const recursos = this.#db.prepare('SELECT COUNT(*) AS n FROM ag_recursos').get() as {
      n: number;
    };
    const eventos = this.#db.prepare('SELECT COUNT(*) AS n FROM ag_eventos').get() as { n: number };
    const importacao = this.#db
      .prepare('SELECT importado_em FROM ag_importacao WHERE id = 1')
      .get() as { importado_em: number } | undefined;

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
   * Eventos que CRUZAM o período, não só os que começam nele — férias e
   * eventos de vários dias precisam aparecer na semana inteira que ocupam.
   *
   * Sem filtro de usuário/consultor de propósito: o snapshot é sempre da
   * sessão de UM consultor só (quem está logado na guia do hub), então já
   * traz um recurso só. `codparcs` recorta pros parceiros de um cliente — um
   * cliente do hub pode ter mais de um `codparc` no ERP, por isso é lista, e
   * `null`/lista vazia significa "sem recorte, traz tudo".
   */
  eventos(de: string, ate: string, codparcs: number[] | null = null): EventoComRecurso[] {
    const semFiltroDeParceiro = !codparcs || codparcs.length === 0;
    const marcadores = semFiltroDeParceiro ? '' : codparcs.map(() => '?').join(',');

    const linhas = this.#db
      .prepare(
        `SELECT e.*, r.descrcargo, r.cor_hex
           FROM ag_eventos e
           JOIN ag_recursos r ON r.id = e.recurso_id
          WHERE e.fim >= ? AND e.inicio <= ?
            ${semFiltroDeParceiro ? '' : `AND e.codparc IN (${marcadores})`}
          ORDER BY e.inicio`,
      )
      .all(de, ate, ...(semFiltroDeParceiro ? [] : codparcs)) as unknown as Record<
      string,
      unknown
    >[];

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

  /**
   * Parceiros que aparecem na agenda de um recurso.
   *
   * É esta lista, e não a de recursos, que o cadastro precisa: a lane da
   * agenda é do CONSULTOR, então todos os clientes dele caem na mesma lane e
   * só o parceiro do evento separa um do outro.
   */
  parceiros(): ParceiroAgenda[] {
    const linhas = this.#db
      .prepare(
        `SELECT e.codparc, e.nomeparc,
                COUNT(*)       AS eventos,
                MIN(e.inicio)  AS primeiro,
                MAX(e.inicio)  AS ultimo
           FROM ag_eventos e
          WHERE e.nomeparc <> ''
          GROUP BY e.codparc, e.nomeparc
          ORDER BY eventos DESC`,
      )
      .all() as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      codparc: l['codparc'] === null ? null : Number(l['codparc']),
      nomeparc: String(l['nomeparc']),
      eventos: Number(l['eventos']),
      primeiroDia: String(l['primeiro']).slice(0, 10),
      ultimoDia: String(l['ultimo']).slice(0, 10),
    }));
  }

  /**
   * Acha o parceiro cujo nome corresponde ao do cliente, para o cadastro não
   * exigir que o usuário vá procurar o CODPARC. Devolve `null` quando não há
   * candidato único.
   */
  casarParceiro(nomeCliente: string): ParceiroAgenda | null {
    const alvo = chaveNome(nomeCliente);
    if (!alvo) return null;

    const candidatos = this.parceiros().filter((p) => {
      const chave = chaveNome(p.nomeparc);
      return chave === alvo || chave.startsWith(alvo) || alvo.startsWith(chave);
    });

    return candidatos.length === 1 ? (candidatos[0] ?? null) : null;
  }

  close(): void {
    this.#db.close();
  }
}
