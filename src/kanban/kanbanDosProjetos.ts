/**
 * Kanban de tarefas dos projetos do cliente, em SQLite.
 *
 * Mora no mesmo `sankhya.db` da Agenda de Recursos, cada um com as próprias tabelas.
 * O projeto continua no `clientes.json`: a demanda guarda só o id dele, sem chave
 * estrangeira, e quem exclui o projeto decide se as demandas vão junto ou ficam órfãs.
 *
 * O documento original fica em disco (`<dados>/kanbans/<cliente>/`), porque é o que se
 * reabre para conferir; no banco vai o texto extraído, que é o que a análise consome.
 *
 * A ordem dentro de cada coluna é um inteiro denso (0..n-1) por demanda, reescrito a
 * cada movimento. Com dezenas de cartões por coluna não há o que otimizar, e ordem
 * densa não deixa buracos que fariam dois cartões disputarem a mesma posição.
 */
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ESTADOS_DE_TAREFA,
  PRIORIDADES_DE_TAREFA,
  TIPOS_DE_TAREFA,
  type DemandaDoKanban,
  type EstadoDeTarefa,
  type ItemDaLista,
  type KanbansDoCliente,
  type OrigemDeTransicao,
  type PrioridadeDeTarefa,
  type SituacaoDaDemanda,
  type TarefaDoKanban,
  type TipoDeDocumento,
  type TipoDeTarefa,
  type TransicaoDeTarefa,
} from './tiposDoKanban.ts';

const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DO_TITULO = 200;
const TAMANHO_MAXIMO_DO_GRUPO = 100;
const TAMANHO_MAXIMO_DAS_NOTAS = 4000;
const TAMANHO_MAXIMO_DO_ERRO = 2000;
export const ITENS_MAXIMOS_DA_LISTA = 50;
export const TAMANHO_MAXIMO_DO_ITEM = 300;

export class DemandaNaoEncontradaError extends Error {
  constructor(id: number) {
    super(`Kanban ${id} não encontrado.`);
    this.name = 'DemandaNaoEncontradaError';
  }
}

export class TarefaNaoEncontradaError extends Error {
  constructor(id: number) {
    super(`Tarefa ${id} não encontrada.`);
    this.name = 'TarefaNaoEncontradaError';
  }
}

/** Dado que a tela mandou e não dá para gravar: a mensagem vai direto para o usuário. */
export class DadosDoKanbanInvalidosError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'DadosDoKanbanInvalidosError';
  }
}

export interface DocumentoRecebido {
  nome: string;
  tipo: TipoDeDocumento;
  bruto: Buffer;
  /** Vazio no PDF: quem lê é a IA. */
  texto: string;
}

export interface DadosDeDemanda {
  projetoId: string;
  nome: string;
  pasta?: string;
  documento?: DocumentoRecebido;
}

export interface AlteracaoDeDemanda {
  nome?: string;
  /** Vincula a outro projeto do mesmo cliente; é também como a órfã volta a ter projeto. */
  projetoId?: string;
  pasta?: string;
}

/** O que mudou: `removida` quando o kanban inteiro foi apagado. */
export interface MudancaNoKanban {
  demandaId: number;
  /** O cliente do kanban: é por ele que a tela decide se precisa reler. */
  clienteId: string;
  removida: boolean;
}

export interface DadosDeTarefa {
  titulo: string;
  descricao?: string;
  grupo?: string;
  tipo?: string;
  estimativaHoras?: number;
  prioridade?: string;
  criteriosDeAceite?: string;
  notas?: string;
  checklist?: ItemDaLista[];
}

export interface ResultadoParaRegistrar {
  resumo: string;
  tarefas: DadosDeTarefa[];
  assistente: string;
  modelo: string;
}

/** O que a análise precisa: o texto extraído e o caminho do original, para o PDF. */
export interface ConteudoDoDocumento {
  nome: string;
  tipo: TipoDeDocumento;
  arquivo: string;
  texto: string;
}

interface LinhaDeDemanda {
  id: number;
  cliente_id: string;
  projeto_id: string;
  nome: string;
  pasta: string;
  documento_nome: string;
  documento_tipo: string;
  documento_bytes: number;
  documento_arquivo: string;
  documento_enviado_em: string;
  texto: string;
  situacao: string;
  resumo: string;
  erro: string;
  analisada_em: string;
  assistente: string;
  modelo: string;
  mcp: number;
  arquivo_nome: string;
  criada_em: string;
  atualizada_em: string;
}

interface LinhaDeTarefa {
  id: number;
  demanda_id: number;
  titulo: string;
  descricao: string;
  grupo: string;
  tipo: string;
  estimativa_horas: number;
  prioridade: string;
  criterios_de_aceite: string;
  notas: string;
  checklist: string;
  estado: string;
  ordem: number;
  criada_em: string;
  atualizada_em: string;
}

interface LinhaDeTransicao {
  id: number;
  tarefa_id: number;
  demanda_id: number;
  cliente_id: string;
  de: string;
  para: string;
  em: string;
  origem: string;
}

export function ehEstadoDeTarefa(valor: unknown): valor is EstadoDeTarefa {
  return (ESTADOS_DE_TAREFA as readonly unknown[]).includes(valor);
}

/** Valor desconhecido vira o padrão em vez de erro: é o que a IA manda que mais varia. */
function tipoValido(valor: string | undefined): TipoDeTarefa {
  const normalizado = (valor ?? '').toLowerCase().trim();
  return (TIPOS_DE_TAREFA as readonly string[]).includes(normalizado)
    ? (normalizado as TipoDeTarefa)
    : 'outro';
}

function prioridadeValida(valor: string | undefined): PrioridadeDeTarefa {
  const normalizado = (valor ?? '').toLowerCase().trim().replace('média', 'media');
  return (PRIORIDADES_DE_TAREFA as readonly string[]).includes(normalizado)
    ? (normalizado as PrioridadeDeTarefa)
    : 'media';
}

/** Meia hora de granularidade: estimativa com casas decimais longas só finge precisão. */
function horasValidas(valor: unknown): number {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? Math.round(numero * 2) / 2 : 0;
}

/** Itens sem texto saem; texto longo é cortado; a lista para em 50 itens. */
export function listaValida(itens: readonly ItemDaLista[] | undefined): ItemDaLista[] {
  return (itens ?? [])
    .map((item) => ({
      texto: String(item?.texto ?? '')
        .trim()
        .slice(0, TAMANHO_MAXIMO_DO_ITEM),
      feito: item?.feito === true,
    }))
    .filter((item) => item.texto)
    .slice(0, ITENS_MAXIMOS_DA_LISTA);
}

function lerLista(texto: string): ItemDaLista[] {
  try {
    const dados = JSON.parse(texto) as unknown;
    return Array.isArray(dados) ? listaValida(dados as ItemDaLista[]) : [];
  } catch {
    return [];
  }
}

function nomeValido(nome: string): string {
  const limpo = nome.trim().slice(0, TAMANHO_MAXIMO_DO_NOME);
  if (!limpo) {
    throw new DadosDoKanbanInvalidosError('Informe o nome do kanban.');
  }
  return limpo;
}

/** Nome seguro para o disco: o nome original vem do usuário. */
function nomeEmDisco(nome: string): string {
  return (
    nome
      .replace(/[^\w.\- ]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, TAMANHO_MAXIMO_DO_NOME) || 'escopo'
  );
}

function paraDemanda(linha: LinhaDeDemanda): DemandaDoKanban {
  return {
    id: linha.id,
    clienteId: linha.cliente_id,
    projetoId: linha.projeto_id,
    nome: linha.nome,
    pasta: linha.pasta,
    documento: linha.documento_nome
      ? {
          nome: linha.documento_nome,
          tipo: linha.documento_tipo as TipoDeDocumento,
          bytes: linha.documento_bytes,
          enviadoEm: linha.documento_enviado_em,
          caracteres: linha.texto.length,
        }
      : null,
    situacao: linha.situacao as SituacaoDaDemanda,
    resumo: linha.resumo,
    erro: linha.erro,
    analisadaEm: linha.analisada_em,
    assistente: linha.assistente,
    modelo: linha.modelo,
    mcp: linha.mcp === 1,
    arquivoNome: linha.arquivo_nome,
    criadaEm: linha.criada_em,
    atualizadaEm: linha.atualizada_em,
  };
}

function paraTarefa(linha: LinhaDeTarefa): TarefaDoKanban {
  return {
    id: linha.id,
    demandaId: linha.demanda_id,
    titulo: linha.titulo,
    descricao: linha.descricao,
    grupo: linha.grupo,
    tipo: linha.tipo as TipoDeTarefa,
    estimativaHoras: linha.estimativa_horas,
    prioridade: linha.prioridade as PrioridadeDeTarefa,
    criteriosDeAceite: linha.criterios_de_aceite,
    notas: linha.notas,
    checklist: lerLista(linha.checklist),
    estado: linha.estado as EstadoDeTarefa,
    ordem: linha.ordem,
    criadaEm: linha.criada_em,
    atualizadaEm: linha.atualizada_em,
  };
}

export class KanbanDosProjetos {
  readonly #db: DatabaseSync;
  readonly #pastaDosDocumentos: string;
  readonly #ouvintes = new Set<(mudanca: MudancaNoKanban) => void>();

  constructor(diretorioDeDados: string) {
    mkdirSync(diretorioDeDados, { recursive: true });
    this.#pastaDosDocumentos = join(diretorioDeDados, 'kanbans');
    this.#db = new DatabaseSync(join(diretorioDeDados, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS kb_demandas (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id           TEXT    NOT NULL,
        projeto_id           TEXT    NOT NULL DEFAULT '',
        nome                 TEXT    NOT NULL,
        pasta                TEXT    NOT NULL DEFAULT '',
        documento_nome       TEXT    NOT NULL DEFAULT '',
        documento_tipo       TEXT    NOT NULL DEFAULT '',
        documento_bytes      INTEGER NOT NULL DEFAULT 0,
        documento_arquivo    TEXT    NOT NULL DEFAULT '',
        documento_enviado_em TEXT    NOT NULL DEFAULT '',
        texto                TEXT    NOT NULL DEFAULT '',
        situacao             TEXT    NOT NULL DEFAULT 'sem-documento',
        resumo               TEXT    NOT NULL DEFAULT '',
        erro                 TEXT    NOT NULL DEFAULT '',
        analisada_em         TEXT    NOT NULL DEFAULT '',
        assistente           TEXT    NOT NULL DEFAULT '',
        modelo               TEXT    NOT NULL DEFAULT '',
        mcp                  INTEGER NOT NULL DEFAULT 0,
        arquivo_nome         TEXT    NOT NULL DEFAULT '',
        criada_em            TEXT    NOT NULL,
        atualizada_em        TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_demandas_projeto ON kb_demandas (cliente_id, projeto_id);

      CREATE TABLE IF NOT EXISTS kb_tarefas (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        demanda_id          INTEGER NOT NULL REFERENCES kb_demandas(id) ON DELETE CASCADE,
        titulo              TEXT    NOT NULL,
        descricao           TEXT    NOT NULL DEFAULT '',
        grupo               TEXT    NOT NULL DEFAULT '',
        tipo                TEXT    NOT NULL DEFAULT 'outro',
        estimativa_horas    REAL    NOT NULL DEFAULT 0,
        prioridade          TEXT    NOT NULL DEFAULT 'media',
        criterios_de_aceite TEXT    NOT NULL DEFAULT '',
        notas               TEXT    NOT NULL DEFAULT '',
        checklist           TEXT    NOT NULL DEFAULT '[]',
        estado              TEXT    NOT NULL DEFAULT 'backlog',
        ordem               INTEGER NOT NULL DEFAULT 0,
        criada_em           TEXT    NOT NULL,
        atualizada_em       TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_tarefas_coluna ON kb_tarefas (demanda_id, estado, ordem);

      CREATE TABLE IF NOT EXISTS kb_transicoes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        tarefa_id   INTEGER NOT NULL,
        demanda_id  INTEGER NOT NULL,
        cliente_id  TEXT    NOT NULL,
        de          TEXT    NOT NULL DEFAULT '',
        para        TEXT    NOT NULL,
        em          TEXT    NOT NULL,
        origem      TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_transicoes_cliente ON kb_transicoes (cliente_id, em);
    `);
    // Banco criado antes do MCP e do arquivo de tarefas não pode perder o quadro para ganhar campo.
    this.#garantirColunas('kb_demandas', [
      ['mcp', 'INTEGER NOT NULL DEFAULT 0'],
      ['arquivo_nome', "TEXT NOT NULL DEFAULT ''"],
    ]);
    this.#garantirColunas('kb_tarefas', [['checklist', "TEXT NOT NULL DEFAULT '[]'"]]);
    /*
     * Análise que estava rodando quando o HUB SNK caiu nunca vai terminar: sem isto a
     * demanda ficaria "analisando" para sempre e o botão de analisar, travado.
     */
    this.#db
      .prepare(
        `UPDATE kb_demandas SET situacao = 'falhou',
           erro = 'A análise foi interrompida: o HUB SNK foi reiniciado.'
         WHERE situacao = 'analisando'`,
      )
      .run();
  }

  /**
   * Avisado depois de toda mudança num kanban: é o que mantém o arquivo de tarefas em dia.
   * Devolve a função que desliga o aviso.
   */
  aoMudar(ouvinte: (mudanca: MudancaNoKanban) => void): () => void {
    this.#ouvintes.add(ouvinte);
    return () => this.#ouvintes.delete(ouvinte);
  }

  /** `clienteId` só vem de quem já apagou a linha: os demais são lidos do banco. */
  #avisar(demandaId: number, removida = false, clienteId?: string): void {
    const cliente =
      clienteId ??
      (
        this.#db.prepare('SELECT cliente_id FROM kb_demandas WHERE id = ?').get(demandaId) as
          { cliente_id: string } | undefined
      )?.cliente_id ??
      '';
    for (const ouvinte of this.#ouvintes) {
      ouvinte({ demandaId, clienteId: cliente, removida });
    }
  }

  #garantirColunas(tabela: string, colunas: [string, string][]): void {
    const existentes = new Set(
      (this.#db.prepare(`PRAGMA table_info(${tabela})`).all() as unknown as { name: string }[]).map(
        (coluna) => coluna.name,
      ),
    );
    for (const [coluna, tipo] of colunas) {
      if (!existentes.has(coluna)) {
        this.#db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${tipo}`);
      }
    }
  }

  // --- demandas -----------------------------------------------------------------------

  doCliente(clienteId: string): KanbansDoCliente {
    const demandas = (
      this.#db
        .prepare('SELECT * FROM kb_demandas WHERE cliente_id = ? ORDER BY id')
        .all(clienteId) as unknown as LinhaDeDemanda[]
    ).map(paraDemanda);
    const tarefas = (
      this.#db
        .prepare(
          `SELECT t.* FROM kb_tarefas t JOIN kb_demandas d ON d.id = t.demanda_id
            WHERE d.cliente_id = ? ORDER BY t.demanda_id, t.estado, t.ordem, t.id`,
        )
        .all(clienteId) as unknown as LinhaDeTarefa[]
    ).map(paraTarefa);
    return { demandas, tarefas };
  }

  demanda(id: number): DemandaDoKanban {
    return paraDemanda(this.#linhaDaDemanda(id));
  }

  tarefasDaDemanda(id: number): TarefaDoKanban[] {
    return (
      this.#db
        .prepare('SELECT * FROM kb_tarefas WHERE demanda_id = ? ORDER BY estado, ordem, id')
        .all(id) as unknown as LinhaDeTarefa[]
    ).map(paraTarefa);
  }

  conteudoDoDocumento(id: number): ConteudoDoDocumento | null {
    const linha = this.#linhaDaDemanda(id);
    if (!linha.documento_nome) {
      return null;
    }
    return {
      nome: linha.documento_nome,
      tipo: linha.documento_tipo as TipoDeDocumento,
      arquivo: linha.documento_arquivo,
      texto: linha.texto,
    };
  }

  criarDemanda(clienteId: string, dados: DadosDeDemanda): DemandaDoKanban {
    const agora = new Date().toISOString();
    const resultado = this.#db
      .prepare(
        `INSERT INTO kb_demandas (cliente_id, projeto_id, nome, pasta, criada_em, atualizada_em)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        clienteId,
        dados.projetoId,
        nomeValido(dados.nome),
        (dados.pasta ?? '').trim(),
        agora,
        agora,
      );
    const id = Number(resultado.lastInsertRowid);

    if (dados.documento) {
      this.#gravarDocumento(id, clienteId, dados.documento, agora);
    }
    this.#avisar(id);
    return this.demanda(id);
  }

  alterarDemanda(id: number, alteracao: AlteracaoDeDemanda): DemandaDoKanban {
    const atual = this.#linhaDaDemanda(id);
    this.#db
      .prepare(
        'UPDATE kb_demandas SET nome = ?, projeto_id = ?, pasta = ?, atualizada_em = ? WHERE id = ?',
      )
      .run(
        alteracao.nome !== undefined ? nomeValido(alteracao.nome) : atual.nome,
        alteracao.projetoId ?? atual.projeto_id,
        alteracao.pasta !== undefined ? alteracao.pasta.trim() : atual.pasta,
        new Date().toISOString(),
        id,
      );
    this.#avisar(id);
    return this.demanda(id);
  }

  /**
   * Troca o documento de escopo. As tarefas ficam: só a próxima análise mexe nelas, e
   * mesmo assim só no que ainda está no Backlog.
   */
  anexarDocumento(id: number, documento: DocumentoRecebido): DemandaDoKanban {
    const atual = this.#linhaDaDemanda(id);
    this.#apagarArquivo(atual.documento_arquivo);
    this.#gravarDocumento(id, atual.cliente_id, documento, new Date().toISOString());
    this.#avisar(id);
    return this.demanda(id);
  }

  /** Tira o documento, mas não as tarefas: o quadro continua, como um kanban sem documento. */
  removerDocumento(id: number): DemandaDoKanban {
    const atual = this.#linhaDaDemanda(id);
    this.#apagarArquivo(atual.documento_arquivo);
    this.#db
      .prepare(
        `UPDATE kb_demandas SET documento_nome = '', documento_tipo = '', documento_bytes = 0,
           documento_arquivo = '', documento_enviado_em = '', texto = '',
           situacao = 'sem-documento', erro = '', atualizada_em = ?
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), id);
    this.#avisar(id);
    return this.demanda(id);
  }

  /** Apaga a demanda com as tarefas, o histórico e o documento. */
  removerDemanda(id: number): void {
    const atual = this.#linhaDaDemanda(id);
    this.#emTransacao(() => {
      this.#db.prepare('DELETE FROM kb_transicoes WHERE demanda_id = ?').run(id);
      this.#db.prepare('DELETE FROM kb_tarefas WHERE demanda_id = ?').run(id);
      this.#db.prepare('DELETE FROM kb_demandas WHERE id = ?').run(id);
    });
    this.#apagarArquivo(atual.documento_arquivo);
    this.#avisar(id, true, atual.cliente_id);
  }

  demandasDoProjeto(clienteId: string, projetoId: string): DemandaDoKanban[] {
    return (
      this.#db
        .prepare('SELECT * FROM kb_demandas WHERE cliente_id = ? AND projeto_id = ? ORDER BY id')
        .all(clienteId, projetoId) as unknown as LinhaDeDemanda[]
    ).map(paraDemanda);
  }

  /** O projeto mudou de nome: o kanban dele acompanha. */
  renomearDoProjeto(clienteId: string, projetoId: string, nome: string): void {
    for (const demanda of this.demandasDoProjeto(clienteId, projetoId)) {
      if (demanda.nome !== nome) {
        this.alterarDemanda(demanda.id, { nome });
      }
    }
  }

  /** O projeto foi excluído e o usuário quis manter os kanbans: ficam órfãos no cliente. */
  desvincularDoProjeto(clienteId: string, projetoId: string): void {
    this.#db
      .prepare(
        `UPDATE kb_demandas SET projeto_id = '', atualizada_em = ?
          WHERE cliente_id = ? AND projeto_id = ?`,
      )
      .run(new Date().toISOString(), clienteId, projetoId);
    for (const { id } of this.demandasDoProjeto(clienteId, '')) {
      this.#avisar(id);
    }
  }

  removerDoProjeto(clienteId: string, projetoId: string): void {
    for (const demanda of this.demandasDoProjeto(clienteId, projetoId)) {
      this.removerDemanda(demanda.id);
    }
  }

  /** Cliente excluído não deixa kanban: sem ele, não há onde mostrar a órfã. */
  removerDoCliente(clienteId: string): void {
    for (const demanda of this.doCliente(clienteId).demandas) {
      this.removerDemanda(demanda.id);
    }
    rmSync(join(this.#pastaDosDocumentos, nomeEmDisco(clienteId)), {
      recursive: true,
      force: true,
    });
  }

  /** Libera (ou tira) o kanban do servidor MCP. Independe do arquivo de tarefas. */
  definirMcp(id: number, ligado: boolean): DemandaDoKanban {
    this.#linhaDaDemanda(id);
    this.#db.prepare('UPDATE kb_demandas SET mcp = ? WHERE id = ?').run(ligado ? 1 : 0, id);
    this.#avisar(id);
    return this.demanda(id);
  }

  demandasNoMcp(): DemandaDoKanban[] {
    return (
      this.#db
        .prepare('SELECT * FROM kb_demandas WHERE mcp = 1 ORDER BY cliente_id, id')
        .all() as unknown as LinhaDeDemanda[]
    ).map(paraDemanda);
  }

  /** O nome que o arquivo de tarefas ganhou; quem escolhe é o compartilhamento. */
  definirNomeDoArquivo(id: number, nome: string): void {
    this.#db.prepare('UPDATE kb_demandas SET arquivo_nome = ? WHERE id = ?').run(nome, id);
  }

  demandasComPasta(): DemandaDoKanban[] {
    return (
      this.#db
        .prepare(`SELECT * FROM kb_demandas WHERE pasta <> '' ORDER BY id`)
        .all() as unknown as LinhaDeDemanda[]
    ).map(paraDemanda);
  }

  marcarAnalisando(id: number): void {
    this.#linhaDaDemanda(id);
    this.#db
      .prepare(`UPDATE kb_demandas SET situacao = 'analisando', erro = '' WHERE id = ?`)
      .run(id);
    this.#avisar(id);
  }

  marcarFalha(id: number, erro: string): void {
    this.#db
      .prepare(`UPDATE kb_demandas SET situacao = 'falhou', erro = ? WHERE id = ?`)
      .run(erro.slice(0, TAMANHO_MAXIMO_DO_ERRO), id);
    this.#avisar(id);
  }

  /**
   * Grava o resultado da análise.
   *
   * Reanálise não pode apagar o trabalho de quem já está tocando o projeto: só saem as
   * tarefas desta demanda que continuam no Backlog. O que já foi movido de coluna fica,
   * mesmo que a nova análise não o traga: quem decide descartar é a pessoa.
   */
  registrarAnalise(
    id: number,
    resultado: ResultadoParaRegistrar,
  ): { criadas: number; mantidas: number } {
    const demanda = this.#linhaDaDemanda(id);
    const agora = new Date().toISOString();

    const resultadoDaGravacao = this.#emTransacao(() => {
      const doBacklog = this.#db
        .prepare(`SELECT id FROM kb_tarefas WHERE demanda_id = ? AND estado = 'backlog'`)
        .all(id) as { id: number }[];
      for (const velha of doBacklog) {
        this.#transicao(velha.id, demanda, 'backlog', 'removida', agora, 'removida');
      }
      this.#db
        .prepare(`DELETE FROM kb_tarefas WHERE demanda_id = ? AND estado = 'backlog'`)
        .run(id);
      const mantidas = (
        this.#db.prepare('SELECT COUNT(*) AS n FROM kb_tarefas WHERE demanda_id = ?').get(id) as {
          n: number;
        }
      ).n;

      let criadas = 0;
      for (const dados of resultado.tarefas) {
        if (!(dados.titulo ?? '').trim()) {
          continue;
        }
        this.#inserirTarefa(demanda, dados, 'backlog', criadas, agora);
        criadas += 1;
      }

      this.#db
        .prepare(
          `UPDATE kb_demandas SET situacao = 'analisado', analisada_em = ?, resumo = ?, erro = '',
             assistente = ?, modelo = ?, atualizada_em = ?
           WHERE id = ?`,
        )
        .run(agora, resultado.resumo, resultado.assistente, resultado.modelo, agora, id);
      return { criadas, mantidas };
    });
    this.#avisar(id);
    return resultadoDaGravacao;
  }

  // --- tarefas ------------------------------------------------------------------------

  tarefa(id: number): TarefaDoKanban {
    return paraTarefa(this.#linhaDaTarefa(id));
  }

  criarTarefa(
    demandaId: number,
    dados: DadosDeTarefa,
    estado: EstadoDeTarefa = 'backlog',
  ): TarefaDoKanban {
    const demanda = this.#linhaDaDemanda(demandaId);
    if (!(dados.titulo ?? '').trim()) {
      throw new DadosDoKanbanInvalidosError('Informe o título da tarefa.');
    }
    const id = this.#emTransacao(() =>
      this.#inserirTarefa(
        demanda,
        dados,
        estado,
        this.#proximaOrdem(demandaId, estado),
        new Date().toISOString(),
      ),
    );
    this.#avisar(demandaId);
    return this.tarefa(id);
  }

  atualizarTarefa(id: number, dados: Partial<DadosDeTarefa>): TarefaDoKanban {
    const atual = this.tarefa(id);
    const titulo = dados.titulo !== undefined ? dados.titulo.trim() : atual.titulo;
    if (!titulo) {
      throw new DadosDoKanbanInvalidosError('O título da tarefa não pode ficar vazio.');
    }
    this.#db
      .prepare(
        `UPDATE kb_tarefas SET titulo = ?, descricao = ?, grupo = ?, tipo = ?, estimativa_horas = ?,
           prioridade = ?, criterios_de_aceite = ?, notas = ?, checklist = ?, atualizada_em = ?
         WHERE id = ?`,
      )
      .run(
        titulo.slice(0, TAMANHO_MAXIMO_DO_TITULO),
        dados.descricao !== undefined ? dados.descricao.trim() : atual.descricao,
        dados.grupo !== undefined
          ? dados.grupo.trim().slice(0, TAMANHO_MAXIMO_DO_GRUPO)
          : atual.grupo,
        dados.tipo !== undefined ? tipoValido(dados.tipo) : atual.tipo,
        dados.estimativaHoras !== undefined
          ? horasValidas(dados.estimativaHoras)
          : atual.estimativaHoras,
        dados.prioridade !== undefined ? prioridadeValida(dados.prioridade) : atual.prioridade,
        dados.criteriosDeAceite !== undefined
          ? dados.criteriosDeAceite.trim()
          : atual.criteriosDeAceite,
        dados.notas !== undefined
          ? dados.notas.trim().slice(0, TAMANHO_MAXIMO_DAS_NOTAS)
          : atual.notas,
        JSON.stringify(
          dados.checklist !== undefined ? listaValida(dados.checklist) : atual.checklist,
        ),
        new Date().toISOString(),
        id,
      );
    this.#avisar(atual.demandaId);
    return this.tarefa(id);
  }

  /**
   * Leva a tarefa para `estado`, na posição `indice` daquela coluna da demanda (0 é o
   * topo). Serve tanto para trocar de coluna quanto para reordenar dentro da mesma.
   */
  moverTarefa(id: number, estado: EstadoDeTarefa, indice: number): TarefaDoKanban {
    const atual = this.tarefa(id);
    const demanda = this.#linhaDaDemanda(atual.demandaId);

    this.#emTransacao(() => {
      const destino = (
        this.#db
          .prepare(
            `SELECT id FROM kb_tarefas WHERE demanda_id = ? AND estado = ? AND id <> ?
              ORDER BY ordem, id`,
          )
          .all(atual.demandaId, estado, id) as { id: number }[]
      ).map((linha) => linha.id);

      const posicao = Number.isFinite(indice)
        ? Math.max(0, Math.min(Math.floor(indice), destino.length))
        : destino.length;
      destino.splice(posicao, 0, id);

      const agora = new Date().toISOString();
      this.#db
        .prepare('UPDATE kb_tarefas SET estado = ?, atualizada_em = ? WHERE id = ?')
        .run(estado, agora, id);
      if (atual.estado !== estado) {
        this.#transicao(id, demanda, atual.estado, estado, agora, 'movida');
      }
      const ordenar = this.#db.prepare('UPDATE kb_tarefas SET ordem = ? WHERE id = ?');
      destino.forEach((idDaTarefa, posicaoNova) => ordenar.run(posicaoNova, idDaTarefa));

      // A coluna de origem ficou com um buraco; fecha para a ordem continuar densa.
      if (atual.estado !== estado) {
        this.#renumerar(atual.demandaId, atual.estado);
      }
    });
    this.#avisar(atual.demandaId);
    return this.tarefa(id);
  }

  removerTarefa(id: number): void {
    const atual = this.tarefa(id);
    const demanda = this.#linhaDaDemanda(atual.demandaId);
    this.#emTransacao(() => {
      this.#db.prepare('DELETE FROM kb_tarefas WHERE id = ?').run(id);
      this.#transicao(id, demanda, atual.estado, 'removida', new Date().toISOString(), 'removida');
      this.#renumerar(atual.demandaId, atual.estado);
    });
    this.#avisar(atual.demandaId);
  }

  /**
   * O histórico de colunas das tarefas, em ordem cronológica: o que gráficos de fluxo
   * (vazão, lead time, burndown) precisam e o quadro sozinho não guarda.
   */
  transicoes(filtro: { clienteId?: string; desde?: string } = {}): TransicaoDeTarefa[] {
    const linhas = this.#db
      .prepare(
        `SELECT * FROM kb_transicoes
          WHERE (? IS NULL OR cliente_id = ?) AND em >= ?
          ORDER BY em, id`,
      )
      .all(
        filtro.clienteId ?? null,
        filtro.clienteId ?? null,
        filtro.desde ?? '',
      ) as unknown as LinhaDeTransicao[];
    return linhas.map((linha) => ({
      id: linha.id,
      tarefaId: linha.tarefa_id,
      demandaId: linha.demanda_id,
      clienteId: linha.cliente_id,
      de: linha.de,
      para: linha.para,
      em: linha.em,
      origem: linha.origem as OrigemDeTransicao,
    }));
  }

  close(): void {
    this.#db.close();
  }

  // --- internos -----------------------------------------------------------------------

  #linhaDaDemanda(id: number): LinhaDeDemanda {
    const linha = this.#db.prepare('SELECT * FROM kb_demandas WHERE id = ?').get(id) as
      LinhaDeDemanda | undefined;
    if (!linha) {
      throw new DemandaNaoEncontradaError(id);
    }
    return linha;
  }

  #linhaDaTarefa(id: number): LinhaDeTarefa {
    const linha = this.#db.prepare('SELECT * FROM kb_tarefas WHERE id = ?').get(id) as
      LinhaDeTarefa | undefined;
    if (!linha) {
      throw new TarefaNaoEncontradaError(id);
    }
    return linha;
  }

  #gravarDocumento(
    id: number,
    clienteId: string,
    documento: DocumentoRecebido,
    agora: string,
  ): void {
    const pasta = join(this.#pastaDosDocumentos, nomeEmDisco(clienteId));
    mkdirSync(pasta, { recursive: true });
    const arquivo = join(pasta, `${id}-${nomeEmDisco(documento.nome)}`);
    writeFileSync(arquivo, documento.bruto);

    this.#db
      .prepare(
        `UPDATE kb_demandas SET documento_nome = ?, documento_tipo = ?, documento_bytes = ?,
           documento_arquivo = ?, documento_enviado_em = ?, texto = ?,
           situacao = 'enviado', erro = '', atualizada_em = ?
         WHERE id = ?`,
      )
      .run(
        documento.nome,
        documento.tipo,
        documento.bruto.length,
        arquivo,
        agora,
        documento.texto,
        agora,
        id,
      );
  }

  #apagarArquivo(arquivo: string): void {
    if (arquivo && existsSync(arquivo)) {
      rmSync(arquivo, { force: true });
    }
  }

  #inserirTarefa(
    demanda: LinhaDeDemanda,
    dados: DadosDeTarefa,
    estado: EstadoDeTarefa,
    ordem: number,
    agora: string,
  ): number {
    const resultado = this.#db
      .prepare(
        `INSERT INTO kb_tarefas
           (demanda_id, titulo, descricao, grupo, tipo, estimativa_horas, prioridade,
            criterios_de_aceite, notas, checklist, estado, ordem, criada_em, atualizada_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        demanda.id,
        dados.titulo.trim().slice(0, TAMANHO_MAXIMO_DO_TITULO),
        (dados.descricao ?? '').trim(),
        (dados.grupo ?? '').trim().slice(0, TAMANHO_MAXIMO_DO_GRUPO),
        tipoValido(dados.tipo),
        horasValidas(dados.estimativaHoras),
        prioridadeValida(dados.prioridade),
        (dados.criteriosDeAceite ?? '').trim(),
        (dados.notas ?? '').trim().slice(0, TAMANHO_MAXIMO_DAS_NOTAS),
        JSON.stringify(listaValida(dados.checklist)),
        estado,
        ordem,
        agora,
        agora,
      );
    const id = Number(resultado.lastInsertRowid);
    this.#transicao(id, demanda, '', estado, agora, 'criada');
    return id;
  }

  #transicao(
    tarefaId: number,
    demanda: LinhaDeDemanda,
    de: string,
    para: string,
    em: string,
    origem: OrigemDeTransicao,
  ): void {
    this.#db
      .prepare(
        `INSERT INTO kb_transicoes (tarefa_id, demanda_id, cliente_id, de, para, em, origem)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(tarefaId, demanda.id, demanda.cliente_id, de, para, em, origem);
  }

  #proximaOrdem(demandaId: number, estado: string): number {
    const linha = this.#db
      .prepare(
        'SELECT COALESCE(MAX(ordem) + 1, 0) AS n FROM kb_tarefas WHERE demanda_id = ? AND estado = ?',
      )
      .get(demandaId, estado) as { n: number };
    return linha.n;
  }

  #renumerar(demandaId: number, estado: string): void {
    const ids = (
      this.#db
        .prepare('SELECT id FROM kb_tarefas WHERE demanda_id = ? AND estado = ? ORDER BY ordem, id')
        .all(demandaId, estado) as { id: number }[]
    ).map((linha) => linha.id);
    const ordenar = this.#db.prepare('UPDATE kb_tarefas SET ordem = ? WHERE id = ?');
    ids.forEach((idDaTarefa, posicao) => ordenar.run(posicao, idDaTarefa));
  }

  #emTransacao<T>(trabalho: () => T): T {
    this.#db.exec('BEGIN');
    try {
      const resultado = trabalho();
      this.#db.exec('COMMIT');
      return resultado;
    } catch (erro) {
      this.#db.exec('ROLLBACK');
      throw erro;
    }
  }
}
