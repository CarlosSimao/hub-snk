/**
 * Snapshot local da Solicitação de Serviços DS (e dos anexos dela), em SQLite.
 *
 * O ERP só responde de dentro da aba logada (ver `desktop/src/solicitacoes.ts`); guardar
 * aqui deixa a Agenda Mensal mostrar descrição, horas e anexos mesmo com a aba fechada,
 * com a data da última leitura para ninguém tomar dado velho por atual.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AnexoSolicitacao, SolicitacaoServico } from '../types.ts';

/** Rótulos do `MOVORC` (Status Orçamento), lidos do dicionário da tela em 2026-09-28. */
const STATUS_ORCAMENTO: Record<string, string> = {
  '0': 'Orçamento Reprovado',
  '1': 'Não Iniciado',
  '2': 'Pendente Atendimento',
  '3': 'Em Orçamento',
  '4': 'Aguardando Aprovação',
  '5': 'Orçamento Aprovado',
  '7': 'Orçamento Cancelado',
  '8': 'Pendente Correção',
  B: 'Em Negociação / Cliente',
  C: 'Prazo Retorno Excedido',
};

/** Rótulos do `TIPOSOLICITACAO`, mesma origem. */
const TIPO_SOLICITACAO: Record<string, string> = {
  '1': 'Integrações',
  '2': 'Personalização e Customização',
  '3': 'Relatórios e Dashboard',
  '5': 'EDI Comercial',
  '7': 'Análise Performance',
  '8': 'Agenda Avulsa',
};

/** O que o shell devolve de `/solicitacoes/buscar` — ver `desktop/src/solicitacoes.ts`. */
export interface SolicitacoesDoErp {
  solicitacoes: {
    codigo: number;
    codparc: number | null;
    descricao: string;
    horasEstimadas: number | null;
    statusOrcamento: string;
    tipo: string;
    dtAbertura: string;
    dtAprovacao: string;
    anexoNome: string;
    anexoTamanho: number | null;
    anexoTipo: string;
  }[];
  anexos: { nuAttach: number; codigo: number; nome: string; descricao: string; link: string; dhCad: string }[];
}

export class Solicitacoes {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sol_solicitacoes (
        codigo           INTEGER PRIMARY KEY,
        codparc          INTEGER,
        descricao        TEXT NOT NULL DEFAULT '',
        horas_estimadas  REAL,
        status_orcamento TEXT NOT NULL DEFAULT '',
        tipo             TEXT NOT NULL DEFAULT '',
        dt_abertura      TEXT NOT NULL DEFAULT '',
        dt_aprovacao     TEXT NOT NULL DEFAULT '',
        anexo_nome       TEXT NOT NULL DEFAULT '',
        anexo_tamanho    INTEGER,
        anexo_tipo       TEXT NOT NULL DEFAULT '',
        lido_em          INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sol_anexos (
        nuattach  INTEGER PRIMARY KEY,
        codigo    INTEGER NOT NULL,
        nome      TEXT NOT NULL DEFAULT '',
        descricao TEXT NOT NULL DEFAULT '',
        link      TEXT NOT NULL DEFAULT '',
        dhcad     TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_sol_anexos_codigo ON sol_anexos (codigo);
    `);
  }

  /**
   * Grava o que veio do ERP para os `codigos` pedidos, numa transação.
   *
   * Os anexos dos códigos pedidos são trocados inteiros: um anexo apagado no ERP tem que
   * sumir daqui também. Código pedido que não voltou (solicitação apagada ou sem acesso)
   * fica com o que já estava — melhor dado de ontem do que um buraco sem explicação.
   */
  gravar(codigos: number[], dados: SolicitacoesDoErp): void {
    const agora = Date.now();
    this.#db.exec('BEGIN');
    try {
      const upsert = this.#db.prepare(
        `INSERT INTO sol_solicitacoes
           (codigo, codparc, descricao, horas_estimadas, status_orcamento, tipo, dt_abertura,
            dt_aprovacao, anexo_nome, anexo_tamanho, anexo_tipo, lido_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (codigo) DO UPDATE SET
           codparc = excluded.codparc, descricao = excluded.descricao,
           horas_estimadas = excluded.horas_estimadas, status_orcamento = excluded.status_orcamento,
           tipo = excluded.tipo, dt_abertura = excluded.dt_abertura, dt_aprovacao = excluded.dt_aprovacao,
           anexo_nome = excluded.anexo_nome, anexo_tamanho = excluded.anexo_tamanho,
           anexo_tipo = excluded.anexo_tipo, lido_em = excluded.lido_em`,
      );
      for (const s of dados.solicitacoes) {
        if (!Number.isInteger(s.codigo) || s.codigo <= 0) continue;
        upsert.run(
          s.codigo,
          s.codparc,
          s.descricao,
          s.horasEstimadas,
          s.statusOrcamento,
          s.tipo,
          s.dtAbertura,
          s.dtAprovacao,
          s.anexoNome,
          s.anexoTamanho,
          s.anexoTipo,
          agora,
        );
      }

      const voltaram = new Set(dados.solicitacoes.map((s) => s.codigo));
      const apagar = this.#db.prepare('DELETE FROM sol_anexos WHERE codigo = ?');
      for (const c of codigos) if (voltaram.has(c)) apagar.run(c);

      const inserir = this.#db.prepare(
        `INSERT OR REPLACE INTO sol_anexos (nuattach, codigo, nome, descricao, link, dhcad)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const a of dados.anexos) {
        if (!voltaram.has(a.codigo) || !Number.isInteger(a.nuAttach)) continue;
        inserir.run(a.nuAttach, a.codigo, a.nome, a.descricao, a.link, a.dhCad);
      }
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /** As solicitações guardadas destes códigos, cada uma com seus anexos. */
  obter(codigos: number[]): SolicitacaoServico[] {
    const validos = codigos.filter((c) => Number.isInteger(c) && c > 0);
    if (!validos.length) return [];
    const marcas = validos.map(() => '?').join(', ');

    const anexos = this.#db
      .prepare(`SELECT * FROM sol_anexos WHERE codigo IN (${marcas}) ORDER BY nuattach`)
      .all(...validos) as unknown as Record<string, unknown>[];
    const porCodigo = new Map<number, AnexoSolicitacao[]>();
    for (const a of anexos) {
      const codigo = Number(a['codigo']);
      porCodigo.set(codigo, [
        ...(porCodigo.get(codigo) ?? []),
        {
          nuAttach: Number(a['nuattach']),
          nome: String(a['nome']),
          descricao: String(a['descricao']),
          link: String(a['link']),
          dhCad: String(a['dhcad']),
        },
      ]);
    }

    const linhas = this.#db
      .prepare(`SELECT * FROM sol_solicitacoes WHERE codigo IN (${marcas})`)
      .all(...validos) as unknown as Record<string, unknown>[];
    return linhas.map((l) => {
      const status = String(l['status_orcamento']);
      const tipo = String(l['tipo']);
      return {
        codigo: Number(l['codigo']),
        codparc: l['codparc'] === null ? null : Number(l['codparc']),
        descricao: String(l['descricao']),
        horasEstimadas: l['horas_estimadas'] === null ? null : Number(l['horas_estimadas']),
        statusOrcamento: STATUS_ORCAMENTO[status] ?? status,
        tipo: TIPO_SOLICITACAO[tipo] ?? tipo,
        dtAbertura: String(l['dt_abertura']),
        dtAprovacao: String(l['dt_aprovacao']),
        anexo: l['anexo_nome']
          ? {
              nome: String(l['anexo_nome']),
              tamanho: l['anexo_tamanho'] === null ? null : Number(l['anexo_tamanho']),
              tipo: String(l['anexo_tipo']),
            }
          : null,
        anexos: porCodigo.get(Number(l['codigo'])) ?? [],
        lidoEm: Number(l['lido_em']),
      };
    });
  }

  close(): void {
    this.#db.close();
  }
}
