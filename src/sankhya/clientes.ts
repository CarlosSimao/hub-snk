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
  agenda_codparc: number | null;
  agenda_demanda_id: string | null;
  sankhya_url: string | null;
  repositorio_local: string;
  repositorio_remoto: string;
  anotacoes: string | null;
  anotacoes_notificar: number | null;
  demanda_fim: string | null;
  email_finalizacao_em: string | null;
}

function paraCliente(linha: Linha): Cliente {
  return {
    id: Number(linha.id),
    nome: linha.nome,
    experienceProjetoId: linha.experience_projeto_id === null ? null : Number(linha.experience_projeto_id),
    experiencePersonId: linha.experience_person_id === null ? null : Number(linha.experience_person_id),
    agendaRecursoUsuario: linha.agenda_recurso_usuario,
    agendaCodparc: linha.agenda_codparc === null ? null : Number(linha.agenda_codparc),
    agendaDemandaId: linha.agenda_demanda_id ?? '',
    sankhyaUrl: linha.sankhya_url ?? '',
    repositorioLocal: linha.repositorio_local,
    repositorioRemoto: linha.repositorio_remoto,
    anotacoes: linha.anotacoes ?? '',
    anotacoesNotificar: Number(linha.anotacoes_notificar ?? 0) === 1,
    demandaFim: linha.demanda_fim ?? '',
    emailFinalizacaoEm: linha.email_finalizacao_em ?? '',
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

    // Colunas novas entram por ALTER para nao perder o cadastro de quem ja usava o
    // painel. `ADD COLUMN` do SQLite e barato e nao reescreve a tabela.
    const existentes = new Set(
      (this.#db.prepare('PRAGMA table_info(clientes)').all() as unknown as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    for (const [coluna, tipo] of [
      ['agenda_codparc', 'INTEGER'],
      ['agenda_demanda_id', "TEXT NOT NULL DEFAULT ''"],
      ['sankhya_url', "TEXT NOT NULL DEFAULT ''"],
      ['anotacoes', "TEXT NOT NULL DEFAULT ''"],
      ['anotacoes_notificar', 'INTEGER NOT NULL DEFAULT 0'],
      ['demanda_fim', "TEXT NOT NULL DEFAULT ''"],
      ['email_finalizacao_em', "TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!existentes.has(coluna)) this.#db.exec(`ALTER TABLE clientes ADD COLUMN ${coluna} ${tipo}`);
    }

    // Um cliente tem VARIAS bases, varios repositorios e varios links — os campos
    // unicos do cadastro davam conta de um so de cada.
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS cliente_bases (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        ambiente      TEXT    NOT NULL DEFAULT 'producao',
        url           TEXT    NOT NULL DEFAULT '',
        usuario       TEXT    NOT NULL DEFAULT '',
        senha_cifrada TEXT    NOT NULL DEFAULT '',
        versao        TEXT    NOT NULL DEFAULT '',
        monitorar     INTEGER NOT NULL DEFAULT 0,
        ordem         INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_bases_cliente ON cliente_bases (cliente_id, ordem);

      CREATE TABLE IF NOT EXISTS cliente_repos (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id    INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        nome          TEXT    NOT NULL DEFAULT '',
        remoto        TEXT    NOT NULL DEFAULT '',
        caminho_local TEXT    NOT NULL DEFAULT '',
        ordem         INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_repos_cliente ON cliente_repos (cliente_id, ordem);

      CREATE TABLE IF NOT EXISTS cliente_links (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        titulo     TEXT    NOT NULL DEFAULT '',
        url        TEXT    NOT NULL DEFAULT '',
        ordem      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_links_cliente ON cliente_links (cliente_id, ordem);

      -- GP/consultor/lider de cada cliente, para o e-mail interno (src/sankhya/emailInterno.ts).
      CREATE TABLE IF NOT EXISTS cliente_contatos_email (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        papel      TEXT    NOT NULL DEFAULT 'consultor',
        nome       TEXT    NOT NULL DEFAULT '',
        email      TEXT    NOT NULL DEFAULT '',
        ordem      INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_contatos_email_cliente ON cliente_contatos_email (cliente_id, ordem);

      -- Configuracao global (linha unica, id sempre 1) do e-mail interno: SMTP + os dois
      -- contatos fixos que entram em todo envio, de qualquer cliente.
      CREATE TABLE IF NOT EXISTS email_config (
        id                 INTEGER PRIMARY KEY CHECK (id = 1),
        smtp_host          TEXT    NOT NULL DEFAULT 'smtp.gmail.com',
        smtp_porta         INTEGER NOT NULL DEFAULT 465,
        smtp_usuario       TEXT    NOT NULL DEFAULT '',
        smtp_remetente     TEXT    NOT NULL DEFAULT '',
        smtp_senha_cifrada TEXT    NOT NULL DEFAULT '',
        lider_nome         TEXT    NOT NULL DEFAULT '',
        lider_email        TEXT    NOT NULL DEFAULT '',
        orcamento_nome     TEXT    NOT NULL DEFAULT '',
        orcamento_email    TEXT    NOT NULL DEFAULT ''
      );
    `);

    // `assinatura` chegou depois do `CREATE TABLE` original — quem ja tem `email_config`
    // gravado (linha singleton id=1) nao pode perder a config por causa de um campo novo.
    const colunasEmailConfig = new Set(
      (this.#db.prepare('PRAGMA table_info(email_config)').all() as unknown as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    if (!colunasEmailConfig.has('assinatura')) {
      this.#db.exec(`ALTER TABLE email_config ADD COLUMN assinatura TEXT NOT NULL DEFAULT ''`);
    }
    // Resumo diario das anotacoes marcadas — ver src/resumoAnotacoes.ts. `resumo_enviado_em`
    // guarda a DATA (YYYY-MM-DD) do ultimo envio: e o que impede mandar duas vezes no
    // mesmo dia quando o hub e aberto e fechado varias vezes.
    for (const [coluna, tipo] of [
      ['resumo_ativo', 'INTEGER NOT NULL DEFAULT 0'],
      ['resumo_hora', "TEXT NOT NULL DEFAULT '08:00'"],
      ['resumo_enviado_em', "TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!colunasEmailConfig.has(coluna)) {
        this.#db.exec(`ALTER TABLE email_config ADD COLUMN ${coluna} ${tipo}`);
      }
    }

    // Dados de conexao do banco de cada base. Mesmo motivo do ALTER de `clientes`:
    // quem ja tem base cadastrada nao pode perde-la para ganhar campo novo.
    const colunasDaBase = new Set(
      (this.#db.prepare('PRAGMA table_info(cliente_bases)').all() as unknown as { name: string }[]).map(
        (c) => c.name,
      ),
    );
    for (const [coluna, tipo] of [
      ['banco_sgbd', "TEXT NOT NULL DEFAULT ''"],
      ['banco_host', "TEXT NOT NULL DEFAULT ''"],
      // 0 = nao informado. A coluna e INTEGER NOT NULL para nao ter que distinguir NULL
      // de ausente no SQLite; a conversao para `null` acontece ao ler.
      ['banco_porta', 'INTEGER NOT NULL DEFAULT 0'],
      ['banco_servico', "TEXT NOT NULL DEFAULT ''"],
      ['banco_esquema', "TEXT NOT NULL DEFAULT ''"],
      ['banco_usuario', "TEXT NOT NULL DEFAULT ''"],
      ['banco_senha_cifrada', "TEXT NOT NULL DEFAULT ''"],
    ] as const) {
      if (!colunasDaBase.has(coluna)) {
        this.#db.exec(`ALTER TABLE cliente_bases ADD COLUMN ${coluna} ${tipo}`);
      }
    }

    this.#migrarCamposUnicos();
  }

  /**
   * Leva o repositorio e a URL que moravam em campo unico para as tabelas novas.
   *
   * Roda uma vez por cliente e so quando ele ainda nao tem linha na tabela de destino:
   * sem essa guarda, cada reinicio do hub duplicaria o repositorio de todo mundo. Os
   * campos antigos ficam onde estao — apagar dado do usuario numa migracao automatica
   * e o tipo de coisa que so se descobre quando ja nao da para desfazer.
   */
  #migrarCamposUnicos(): void {
    const pendentes = this.#db
      .prepare(
        `SELECT c.id, c.repositorio_local, c.repositorio_remoto, c.sankhya_url
           FROM clientes c
          WHERE (c.repositorio_local <> '' OR c.sankhya_url <> '')
            AND NOT EXISTS (SELECT 1 FROM cliente_repos r WHERE r.cliente_id = c.id)
            AND NOT EXISTS (SELECT 1 FROM cliente_bases b WHERE b.cliente_id = c.id)`,
      )
      .all() as unknown as Record<string, unknown>[];

    for (const linha of pendentes) {
      const id = Number(linha['id']);

      if (String(linha['repositorio_local'])) {
        this.#db
          .prepare(
            `INSERT INTO cliente_repos (cliente_id, nome, remoto, caminho_local, ordem)
             VALUES (?, '', ?, ?, 0)`,
          )
          .run(id, String(linha['repositorio_remoto']), String(linha['repositorio_local']));
      }

      if (String(linha['sankhya_url'])) {
        this.#db
          .prepare(
            `INSERT INTO cliente_bases (cliente_id, ambiente, url, ordem) VALUES (?, 'producao', ?, 0)`,
          )
          .run(id, String(linha['sankhya_url']));
      }
    }
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
           (nome, experience_projeto_id, experience_person_id, agenda_recurso_usuario,
            agenda_codparc, agenda_demanda_id, sankhya_url, repositorio_local,
            repositorio_remoto, anotacoes, anotacoes_notificar, demanda_fim,
            email_finalizacao_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entrada.nome,
        entrada.experienceProjetoId,
        entrada.experiencePersonId,
        entrada.agendaRecursoUsuario,
        entrada.agendaCodparc,
        entrada.agendaDemandaId,
        entrada.sankhyaUrl,
        entrada.repositorioLocal,
        entrada.repositorioRemoto,
        entrada.anotacoes,
        entrada.anotacoesNotificar ? 1 : 0,
        entrada.demandaFim,
        entrada.emailFinalizacaoEm,
      );

    return { id: Number(resultado.lastInsertRowid), ...entrada };
  }

  atualizar(id: number, entrada: ClienteEntrada): Cliente | undefined {
    const resultado = this.#db
      .prepare(
        `UPDATE clientes SET
           nome = ?, experience_projeto_id = ?, experience_person_id = ?,
           agenda_recurso_usuario = ?, agenda_codparc = ?, agenda_demanda_id = ?,
           sankhya_url = ?, repositorio_local = ?, repositorio_remoto = ?, anotacoes = ?,
           anotacoes_notificar = ?, demanda_fim = ?, email_finalizacao_em = ?
         WHERE id = ?`,
      )
      .run(
        entrada.nome,
        entrada.experienceProjetoId,
        entrada.experiencePersonId,
        entrada.agendaRecursoUsuario,
        entrada.agendaCodparc,
        entrada.agendaDemandaId,
        entrada.sankhyaUrl,
        entrada.repositorioLocal,
        entrada.repositorioRemoto,
        entrada.anotacoes,
        entrada.anotacoesNotificar ? 1 : 0,
        entrada.demandaFim,
        entrada.emailFinalizacaoEm,
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
