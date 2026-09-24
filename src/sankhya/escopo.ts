/**
 * Documentos de escopo de um cliente e o kanban de tarefas que sai deles.
 *
 * O documento original fica em disco (`<dataDir>/escopos/<cliente>/`), porque é o que se
 * reabre para conferir; no banco vai o texto extraído, que é o que a análise consome, e
 * o estado da análise. As tarefas moram no mesmo `sankhya.db` do resto do cadastro.
 *
 * A ordem dentro de cada coluna é um inteiro denso (0..n-1) reescrito a cada movimento.
 * Com dezenas de cartões por coluna não há o que otimizar, e ordem densa não deixa
 * "buracos" que fariam dois cartões disputarem a mesma posição.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ESTADOS_TAREFA,
  PRIORIDADES_TAREFA,
  TIPOS_TAREFA,
  type DocumentoEscopo,
  type EstadoTarefa,
  type PrioridadeTarefa,
  type StatusDocumentoEscopo,
  type TarefaEscopo,
  type TipoTarefa,
} from '../types.ts';

export class EscopoUsoError extends Error {}

export interface TarefaEntrada {
  titulo: string;
  descricao?: string;
  grupo?: string;
  tipo?: string;
  estimativaHoras?: number;
  prioridade?: string;
  criteriosAceite?: string;
  notas?: string;
  /** Demanda da tarefa. `null` = avulsa; `undefined` = não mexe (na edição). */
  documentoId?: number | null;
}

const LIMITE_NOTAS = 4000;

interface LinhaDocumento {
  id: number;
  cliente_id: number;
  nome: string;
  tipo: string;
  bytes: number;
  enviado_em: string;
  status: string;
  analisado_em: string;
  resumo: string;
  erro: string;
  texto: string;
  arquivo: string;
  demanda: string;
  compartilhar_em: string;
  compartilhar_nome: string;
}

interface LinhaTarefa {
  id: number;
  cliente_id: number;
  documento_id: number | null;
  titulo: string;
  descricao: string;
  grupo: string;
  tipo: string;
  estimativa_horas: number;
  prioridade: string;
  criterios_aceite: string;
  notas: string;
  estado: string;
  ordem: number;
  criada_em: string;
  atualizada_em: string;
}

export function ehEstado(valor: string): valor is EstadoTarefa {
  return (ESTADOS_TAREFA as readonly string[]).includes(valor);
}

/** Valor desconhecido vira o padrão em vez de erro: é o que a IA manda que mais varia. */
function tipoValido(valor: string | undefined): TipoTarefa {
  const v = (valor ?? '').toLowerCase().trim();
  return (TIPOS_TAREFA as readonly string[]).includes(v) ? (v as TipoTarefa) : 'outro';
}

function prioridadeValida(valor: string | undefined): PrioridadeTarefa {
  const v = (valor ?? '').toLowerCase().trim().replace('média', 'media');
  return (PRIORIDADES_TAREFA as readonly string[]).includes(v) ? (v as PrioridadeTarefa) : 'media';
}

function horasValidas(valor: unknown): number {
  const n = Number(valor);
  // Meia hora de granularidade: estimativa com casas decimais longas só finge precisão.
  return Number.isFinite(n) && n > 0 ? Math.round(n * 2) / 2 : 0;
}

function documento(l: LinhaDocumento): DocumentoEscopo {
  return {
    id: l.id,
    clienteId: l.cliente_id,
    nome: l.nome,
    tipo: l.tipo,
    bytes: l.bytes,
    enviadoEm: l.enviado_em,
    status: l.status as StatusDocumentoEscopo,
    analisadoEm: l.analisado_em,
    resumo: l.resumo,
    erro: l.erro,
    caracteres: l.texto.length,
    demanda: l.demanda || l.nome.replace(/\.[^.]+$/, ''),
    compartilharEm: l.compartilhar_em,
    compartilharNome: l.compartilhar_nome,
  };
}

function tarefa(l: LinhaTarefa): TarefaEscopo {
  return {
    id: l.id,
    clienteId: l.cliente_id,
    documentoId: l.documento_id,
    titulo: l.titulo,
    descricao: l.descricao,
    grupo: l.grupo,
    tipo: l.tipo as TipoTarefa,
    estimativaHoras: l.estimativa_horas,
    prioridade: l.prioridade as PrioridadeTarefa,
    criteriosAceite: l.criterios_aceite,
    notas: l.notas,
    estado: l.estado as EstadoTarefa,
    ordem: l.ordem,
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
  };
}

/** Nome de arquivo seguro para o disco: o nome original vem do usuário. */
function nomeEmDisco(nome: string): string {
  return nome.replace(/[^\w.\- ]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120) || 'escopo';
}

export class Escopo {
  readonly #db: DatabaseSync;
  readonly #pasta: string;
  readonly #ouvintes = new Set<(clienteId: number) => void>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#pasta = join(dataDir, 'escopos');
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS escopo_documentos (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id   INTEGER NOT NULL,
        nome         TEXT    NOT NULL DEFAULT '',
        tipo         TEXT    NOT NULL DEFAULT '',
        bytes        INTEGER NOT NULL DEFAULT 0,
        enviado_em   TEXT    NOT NULL DEFAULT '',
        status       TEXT    NOT NULL DEFAULT 'enviado',
        analisado_em TEXT    NOT NULL DEFAULT '',
        resumo       TEXT    NOT NULL DEFAULT '',
        erro         TEXT    NOT NULL DEFAULT '',
        texto        TEXT    NOT NULL DEFAULT '',
        arquivo      TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_escopo_doc_cliente ON escopo_documentos (cliente_id);

      CREATE TABLE IF NOT EXISTS escopo_tarefas (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id       INTEGER NOT NULL,
        documento_id     INTEGER,
        titulo           TEXT    NOT NULL DEFAULT '',
        descricao        TEXT    NOT NULL DEFAULT '',
        grupo            TEXT    NOT NULL DEFAULT '',
        tipo             TEXT    NOT NULL DEFAULT 'outro',
        estimativa_horas REAL    NOT NULL DEFAULT 0,
        prioridade       TEXT    NOT NULL DEFAULT 'media',
        criterios_aceite TEXT    NOT NULL DEFAULT '',
        estado           TEXT    NOT NULL DEFAULT 'backlog',
        ordem            INTEGER NOT NULL DEFAULT 0,
        criada_em        TEXT    NOT NULL DEFAULT '',
        atualizada_em    TEXT    NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_escopo_tarefa_coluna ON escopo_tarefas (cliente_id, estado, ordem);
    `);
    this.#garantirColunas('escopo_documentos', [
      ['demanda', "TEXT NOT NULL DEFAULT ''"],
      ['compartilhar_em', "TEXT NOT NULL DEFAULT ''"],
      ['compartilhar_nome', "TEXT NOT NULL DEFAULT ''"],
    ]);
    this.#garantirColunas('escopo_tarefas', [['notas', "TEXT NOT NULL DEFAULT ''"]]);
    // Análise que estava rodando quando o hub caiu nunca vai terminar: sem isto o
    // documento ficaria "analisando" para sempre e o botão de reanalisar, travado.
    this.#db
      .prepare(`UPDATE escopo_documentos SET status = 'falhou', erro = 'a análise foi interrompida (o hub reiniciou)' WHERE status = 'analisando'`)
      .run();
  }

  /** Base criada antes da coluna existir não pode perder o quadro para ganhar campo novo. */
  #garantirColunas(tabela: string, colunas: [string, string][]): void {
    const existentes = new Set(
      (this.#db.prepare(`PRAGMA table_info(${tabela})`).all() as unknown as { name: string }[]).map((c) => c.name),
    );
    for (const [coluna, tipo] of colunas) {
      if (!existentes.has(coluna)) this.#db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
    }
  }

  /** Avisado depois de toda mudança em tarefas do cliente — é o que mantém o arquivo compartilhado em dia. */
  aoMudar(ouvinte: (clienteId: number) => void): () => void {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  #avisar(clienteId: number): void {
    for (const o of this.#ouvintes) o(clienteId);
  }

  /** Onde o compartilhamento cai quando o cliente não tem repositório local configurado. */
  pastaPadraoCompartilhada(clienteId: number): string {
    return join(this.#pasta, String(clienteId), 'compartilhado');
  }

  // --- documentos -------------------------------------------------------------------

  documentos(clienteId: number): DocumentoEscopo[] {
    const linhas = this.#db
      .prepare('SELECT * FROM escopo_documentos WHERE cliente_id = ? ORDER BY id DESC')
      .all(clienteId) as unknown as LinhaDocumento[];
    return linhas.map(documento);
  }

  documento(id: number): DocumentoEscopo | undefined {
    const l = this.#db.prepare('SELECT * FROM escopo_documentos WHERE id = ?').get(id) as LinhaDocumento | undefined;
    return l ? documento(l) : undefined;
  }

  /** O que a análise precisa: o texto extraído e o caminho do original (para o PDF). */
  conteudo(id: number): { texto: string; arquivo: string; tipo: string; nome: string } | undefined {
    const l = this.#db.prepare('SELECT texto, arquivo, tipo, nome FROM escopo_documentos WHERE id = ?').get(id) as
      | { texto: string; arquivo: string; tipo: string; nome: string }
      | undefined;
    return l;
  }

  adicionarDocumento(clienteId: number, entrada: { nome: string; tipo: string; bruto: Buffer; texto: string }): DocumentoEscopo {
    const agora = new Date().toISOString();
    const r = this.#db
      .prepare(
        `INSERT INTO escopo_documentos (cliente_id, nome, tipo, bytes, enviado_em, status, texto)
         VALUES (?, ?, ?, ?, ?, 'enviado', ?)`,
      )
      .run(clienteId, entrada.nome, entrada.tipo, entrada.bruto.length, agora, entrada.texto);
    const id = Number(r.lastInsertRowid);

    const pasta = join(this.#pasta, String(clienteId));
    mkdirSync(pasta, { recursive: true });
    const arquivo = join(pasta, `${id}-${nomeEmDisco(entrada.nome)}`);
    writeFileSync(arquivo, entrada.bruto);
    this.#db.prepare('UPDATE escopo_documentos SET arquivo = ? WHERE id = ?').run(arquivo, id);

    return this.documento(id)!;
  }

  renomearDemanda(id: number, demanda: string): DocumentoEscopo | undefined {
    const nome = demanda.trim().slice(0, 120);
    if (!nome) throw new EscopoUsoError('o nome da demanda não pode ficar vazio');
    const r = this.#db.prepare('UPDATE escopo_documentos SET demanda = ? WHERE id = ?').run(nome, id);
    if (!r.changes) return undefined;
    const doc = this.documento(id)!;
    this.#avisar(doc.clienteId);
    return doc;
  }

  /** `pasta` vazia desliga. Quem valida pasta e nome é a rota: aqui é só o registro. */
  definirCompartilhamento(id: number, pasta: string, nome = ''): DocumentoEscopo | undefined {
    const r = this.#db
      .prepare('UPDATE escopo_documentos SET compartilhar_em = ?, compartilhar_nome = ? WHERE id = ?')
      .run(pasta, pasta ? nome : '', id);
    return r.changes ? this.documento(id) : undefined;
  }

  documentosCompartilhados(): DocumentoEscopo[] {
    const linhas = this.#db
      .prepare(`SELECT * FROM escopo_documentos WHERE compartilhar_em <> '' ORDER BY id`)
      .all() as unknown as LinhaDocumento[];
    return linhas.map(documento);
  }

  marcarAnalisando(id: number): void {
    this.#db.prepare(`UPDATE escopo_documentos SET status = 'analisando', erro = '' WHERE id = ?`).run(id);
  }

  marcarFalha(id: number, erro: string): void {
    this.#db.prepare(`UPDATE escopo_documentos SET status = 'falhou', erro = ? WHERE id = ?`).run(erro.slice(0, 2000), id);
  }

  /**
   * Grava o resultado da análise.
   *
   * Reanálise não pode apagar o trabalho de quem já está tocando o projeto: só saem as
   * tarefas DESTE documento que continuam no Backlog. O que já foi movido de coluna fica,
   * mesmo que a nova análise não o traga — quem decide descartar é a pessoa.
   */
  registrarAnalise(id: number, resumo: string, tarefas: TarefaEntrada[]): { criadas: number; mantidas: number } {
    const doc = this.documento(id);
    if (!doc) throw new EscopoUsoError('documento não encontrado');

    const agora = new Date().toISOString();
    this.#db.exec('BEGIN');
    try {
      this.#db
        .prepare(`DELETE FROM escopo_tarefas WHERE documento_id = ? AND estado = 'backlog'`)
        .run(id);
      const mantidas = (
        this.#db.prepare('SELECT COUNT(*) AS n FROM escopo_tarefas WHERE documento_id = ?').get(id) as { n: number }
      ).n;

      let ordem = this.#proximaOrdem(doc.clienteId, 'backlog');
      const inserir = this.#db.prepare(
        `INSERT INTO escopo_tarefas
           (cliente_id, documento_id, titulo, descricao, grupo, tipo, estimativa_horas, prioridade,
            criterios_aceite, estado, ordem, criada_em, atualizada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'backlog', ?, ?, ?)`,
      );
      let criadas = 0;
      for (const t of tarefas) {
        const titulo = (t.titulo ?? '').trim();
        if (!titulo) continue;
        inserir.run(
          doc.clienteId,
          id,
          titulo.slice(0, 200),
          (t.descricao ?? '').trim(),
          (t.grupo ?? '').trim().slice(0, 100),
          tipoValido(t.tipo),
          horasValidas(t.estimativaHoras),
          prioridadeValida(t.prioridade),
          (t.criteriosAceite ?? '').trim(),
          ordem,
          agora,
          agora,
        );
        ordem += 1;
        criadas += 1;
      }
      this.#renumerar(doc.clienteId, 'backlog');

      this.#db
        .prepare(`UPDATE escopo_documentos SET status = 'analisado', analisado_em = ?, resumo = ?, erro = '' WHERE id = ?`)
        .run(agora, resumo, id);
      this.#db.exec('COMMIT');
      this.#avisar(doc.clienteId);
      return { criadas, mantidas };
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * Remove o documento, mas NÃO as tarefas: elas passam a "sem documento". O quadro é
   * trabalho do time; apagar o escopo errado não pode levar o andamento junto.
   */
  removerDocumento(id: number): boolean {
    const l = this.#db.prepare('SELECT arquivo, cliente_id FROM escopo_documentos WHERE id = ?').get(id) as
      | { arquivo: string; cliente_id: number }
      | undefined;
    if (!l) return false;
    this.#db.prepare('UPDATE escopo_tarefas SET documento_id = NULL WHERE documento_id = ?').run(id);
    this.#db.prepare('DELETE FROM escopo_documentos WHERE id = ?').run(id);
    if (l.arquivo && existsSync(l.arquivo)) rmSync(l.arquivo, { force: true });
    this.#avisar(l.cliente_id);
    return true;
  }

  // --- tarefas ----------------------------------------------------------------------

  tarefas(clienteId: number): TarefaEscopo[] {
    const linhas = this.#db
      .prepare('SELECT * FROM escopo_tarefas WHERE cliente_id = ? ORDER BY estado, ordem, id')
      .all(clienteId) as unknown as LinhaTarefa[];
    return linhas.map(tarefa);
  }

  tarefasDaDemanda(documentoId: number): TarefaEscopo[] {
    const linhas = this.#db
      .prepare('SELECT * FROM escopo_tarefas WHERE documento_id = ? ORDER BY estado, ordem, id')
      .all(documentoId) as unknown as LinhaTarefa[];
    return linhas.map(tarefa);
  }

  tarefa(id: number): TarefaEscopo | undefined {
    const l = this.#db.prepare('SELECT * FROM escopo_tarefas WHERE id = ?').get(id) as LinhaTarefa | undefined;
    return l ? tarefa(l) : undefined;
  }

  /** Tarefa só pode apontar para demanda do MESMO cliente — senão sumiria de um quadro e apareceria em outro. */
  #demandaValida(clienteId: number, documentoId: number | null | undefined): number | null {
    if (documentoId === null || documentoId === undefined) return null;
    const doc = this.documento(documentoId);
    if (!doc || doc.clienteId !== clienteId) throw new EscopoUsoError('demanda não encontrada neste cliente');
    return doc.id;
  }

  criarTarefa(clienteId: number, entrada: TarefaEntrada, estado: EstadoTarefa = 'backlog'): TarefaEscopo {
    const titulo = (entrada.titulo ?? '').trim();
    if (!titulo) throw new EscopoUsoError('informe o título da tarefa');
    const documentoId = this.#demandaValida(clienteId, entrada.documentoId);
    const agora = new Date().toISOString();
    const r = this.#db
      .prepare(
        `INSERT INTO escopo_tarefas
           (cliente_id, documento_id, titulo, descricao, grupo, tipo, estimativa_horas, prioridade,
            criterios_aceite, notas, estado, ordem, criada_em, atualizada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clienteId,
        documentoId,
        titulo.slice(0, 200),
        (entrada.descricao ?? '').trim(),
        (entrada.grupo ?? '').trim().slice(0, 100),
        tipoValido(entrada.tipo),
        horasValidas(entrada.estimativaHoras),
        prioridadeValida(entrada.prioridade),
        (entrada.criteriosAceite ?? '').trim(),
        (entrada.notas ?? '').trim().slice(0, LIMITE_NOTAS),
        estado,
        this.#proximaOrdem(clienteId, estado),
        agora,
        agora,
      );
    this.#avisar(clienteId);
    return this.tarefa(Number(r.lastInsertRowid))!;
  }

  atualizarTarefa(id: number, entrada: Partial<TarefaEntrada>): TarefaEscopo | undefined {
    const atual = this.tarefa(id);
    if (!atual) return undefined;
    const titulo = entrada.titulo !== undefined ? entrada.titulo.trim() : atual.titulo;
    if (!titulo) throw new EscopoUsoError('o título não pode ficar vazio');
    const documentoId =
      entrada.documentoId !== undefined ? this.#demandaValida(atual.clienteId, entrada.documentoId) : atual.documentoId;
    this.#db
      .prepare(
        `UPDATE escopo_tarefas SET titulo = ?, descricao = ?, grupo = ?, tipo = ?, estimativa_horas = ?,
           prioridade = ?, criterios_aceite = ?, notas = ?, documento_id = ?, atualizada_em = ? WHERE id = ?`,
      )
      .run(
        titulo.slice(0, 200),
        entrada.descricao !== undefined ? entrada.descricao.trim() : atual.descricao,
        entrada.grupo !== undefined ? entrada.grupo.trim().slice(0, 100) : atual.grupo,
        entrada.tipo !== undefined ? tipoValido(entrada.tipo) : atual.tipo,
        entrada.estimativaHoras !== undefined ? horasValidas(entrada.estimativaHoras) : atual.estimativaHoras,
        entrada.prioridade !== undefined ? prioridadeValida(entrada.prioridade) : atual.prioridade,
        entrada.criteriosAceite !== undefined ? entrada.criteriosAceite.trim() : atual.criteriosAceite,
        entrada.notas !== undefined ? entrada.notas.trim().slice(0, LIMITE_NOTAS) : atual.notas,
        documentoId,
        new Date().toISOString(),
        id,
      );
    this.#avisar(atual.clienteId);
    return this.tarefa(id);
  }

  /**
   * Leva a tarefa para `estado`, na posição `indice` daquela coluna (0 = topo). Serve
   * tanto para trocar de coluna quanto para reordenar dentro da mesma.
   */
  mover(id: number, estado: EstadoTarefa, indice: number): TarefaEscopo | undefined {
    const atual = this.tarefa(id);
    if (!atual) return undefined;

    this.#db.exec('BEGIN');
    try {
      const destino = (
        this.#db
          .prepare('SELECT id FROM escopo_tarefas WHERE cliente_id = ? AND estado = ? AND id <> ? ORDER BY ordem, id')
          .all(atual.clienteId, estado, id) as { id: number }[]
      ).map((l) => l.id);

      const posicao = Math.max(0, Math.min(Number.isFinite(indice) ? Math.floor(indice) : destino.length, destino.length));
      destino.splice(posicao, 0, id);

      this.#db
        .prepare('UPDATE escopo_tarefas SET estado = ?, atualizada_em = ? WHERE id = ?')
        .run(estado, new Date().toISOString(), id);
      const ordenar = this.#db.prepare('UPDATE escopo_tarefas SET ordem = ? WHERE id = ?');
      destino.forEach((tid, i) => ordenar.run(i, tid));

      // A coluna de origem ficou com um buraco; fecha para a ordem continuar densa.
      if (atual.estado !== estado) this.#renumerar(atual.clienteId, atual.estado);
      this.#db.exec('COMMIT');
    } catch (err) {
      this.#db.exec('ROLLBACK');
      throw err;
    }
    this.#avisar(atual.clienteId);
    return this.tarefa(id);
  }

  removerTarefa(id: number): boolean {
    const atual = this.tarefa(id);
    if (!atual) return false;
    this.#db.prepare('DELETE FROM escopo_tarefas WHERE id = ?').run(id);
    this.#renumerar(atual.clienteId, atual.estado);
    this.#avisar(atual.clienteId);
    return true;
  }

  #proximaOrdem(clienteId: number, estado: string): number {
    const l = this.#db
      .prepare('SELECT COALESCE(MAX(ordem) + 1, 0) AS n FROM escopo_tarefas WHERE cliente_id = ? AND estado = ?')
      .get(clienteId, estado) as { n: number };
    return l.n;
  }

  #renumerar(clienteId: number, estado: string): void {
    const ids = (
      this.#db
        .prepare('SELECT id FROM escopo_tarefas WHERE cliente_id = ? AND estado = ? ORDER BY ordem, id')
        .all(clienteId, estado) as { id: number }[]
    ).map((l) => l.id);
    const ordenar = this.#db.prepare('UPDATE escopo_tarefas SET ordem = ? WHERE id = ?');
    ids.forEach((tid, i) => ordenar.run(i, tid));
  }

  close(): void {
    this.#db.close();
  }
}
