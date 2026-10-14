/**
 * Kanban de tarefas dos projetos do cliente, em SQLite.
 *
 * Mora no mesmo `sankhya.db` da Agenda de Recursos, cada um com as próprias tabelas.
 * O projeto continua no `clientes.json`: a demanda guarda só o id dele, sem chave
 * estrangeira, e quem exclui o projeto decide se o kanban vai junto ou fica no cliente.
 * O cliente tem um quadro sem projeto só: o que perde o projeto, com o cliente já tendo
 * um, entrega as tarefas a ele e deixa de existir.
 *
 * As colunas e os tipos são um cadastro só para todos os quadros (`kb_colunas` e
 * `kb_tipos`). A tarefa guarda a chave, por isso não se exclui coluna ou tipo em uso.
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
  COLUNAS_INICIAIS,
  PRIORIDADES_DE_TAREFA,
  TIPOS_INICIAIS,
  type CadastrosDoKanban,
  type DemandaDoKanban,
  type ItemDaLista,
  type ItemDoCadastro,
  type KanbansDoCliente,
  type OrigemDeTransicao,
  type PrioridadeDeTarefa,
  type SituacaoDaDemanda,
  type TarefaDoKanban,
  type TipoDeDocumento,
  type TransicaoDeTarefa,
} from './tiposDoKanban.ts';

const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DO_TITULO = 200;
export const TAMANHO_MAXIMO_DO_GRUPO = 100;
const TAMANHO_MAXIMO_DAS_NOTAS = 4000;
const TAMANHO_MAXIMO_DO_ERRO = 2000;
export const ITENS_MAXIMOS_DA_LISTA = 50;
export const TAMANHO_MAXIMO_DO_ITEM = 300;
export const TAMANHO_MAXIMO_DO_NOME_DO_CADASTRO = 60;
const TAMANHO_MAXIMO_DA_CHAVE = 40;

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

/** Um card que impede excluir a coluna ou o tipo: a tela lista para a pessoa resolver. */
export interface TarefaQueImpede {
  id: number;
  titulo: string;
  clienteId: string;
  quadro: string;
}

export class CadastroEmUsoError extends Error {
  readonly tarefas: TarefaQueImpede[];

  constructor(mensagem: string, tarefas: TarefaQueImpede[]) {
    super(mensagem);
    this.name = 'CadastroEmUsoError';
    this.tarefas = tarefas;
  }
}

type TabelaDoCadastro = 'kb_colunas' | 'kb_tipos';

/** O campo da tarefa que guarda a chave de cada cadastro e o que o banco ganha vazio. */
const CADASTROS: Record<TabelaDoCadastro, { campo: string; iniciais: ItemDoCadastro[] }> = {
  kb_colunas: { campo: 'estado', iniciais: COLUNAS_INICIAIS },
  kb_tipos: { campo: 'tipo', iniciais: TIPOS_INICIAIS },
};

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

/** "Em revisão" vira `em_revisao`: é a chave de item novo e o que compara texto com chave. */
export function chaveDoNome(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, TAMANHO_MAXIMO_DA_CHAVE);
}

function nomeDoCadastroValido(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) {
    throw new DadosDoKanbanInvalidosError('Informe o nome.');
  }
  if (limpo.length > TAMANHO_MAXIMO_DO_NOME_DO_CADASTRO) {
    throw new DadosDoKanbanInvalidosError(
      `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME_DO_CADASTRO} caracteres.`,
    );
  }
  return limpo;
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
    tipo: linha.tipo,
    estimativaHoras: linha.estimativa_horas,
    prioridade: linha.prioridade as PrioridadeDeTarefa,
    criteriosDeAceite: linha.criterios_de_aceite,
    notas: linha.notas,
    checklist: lerLista(linha.checklist),
    estado: linha.estado,
    ordem: linha.ordem,
    criadaEm: linha.criada_em,
    atualizadaEm: linha.atualizada_em,
  };
}

export class KanbanDosProjetos {
  readonly #db: DatabaseSync;
  readonly #pastaDosDocumentos: string;
  readonly #ouvintes = new Set<(mudanca: MudancaNoKanban) => void>();
  readonly #ouvintesDosCadastros = new Set<() => void>();

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

      CREATE TABLE IF NOT EXISTS kb_colunas (
        chave TEXT    PRIMARY KEY,
        nome  TEXT    NOT NULL,
        ordem INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kb_tipos (
        chave TEXT    PRIMARY KEY,
        nome  TEXT    NOT NULL,
        ordem INTEGER NOT NULL
      );
    `);
    this.#semearCadastro('kb_colunas');
    this.#semearCadastro('kb_tipos');
    // Banco criado antes do MCP e do arquivo de tarefas não pode perder o quadro para ganhar campo.
    this.#garantirColunas('kb_demandas', [
      ['mcp', 'INTEGER NOT NULL DEFAULT 0'],
      ['arquivo_nome', "TEXT NOT NULL DEFAULT ''"],
    ]);
    this.#garantirColunas('kb_tarefas', [['checklist', "TEXT NOT NULL DEFAULT '[]'"]]);
    this.#juntarQuadrosSemProjeto();
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

  /** Avisado quando colunas ou tipos mudam: todo quadro aberto precisa se redesenhar. */
  aoMudarCadastros(ouvinte: () => void): () => void {
    this.#ouvintesDosCadastros.add(ouvinte);
    return () => this.#ouvintesDosCadastros.delete(ouvinte);
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

  // --- colunas e tipos ---------------------------------------------------------------

  cadastros(): CadastrosDoKanban {
    return { colunas: this.colunas(), tipos: this.tipos() };
  }

  colunas(): ItemDoCadastro[] {
    return this.#itens('kb_colunas');
  }

  tipos(): ItemDoCadastro[] {
    return this.#itens('kb_tipos');
  }

  /** Onde nascem as tarefas novas e as da IA. Sempre existe: a última coluna não se exclui. */
  colunaInicial(): string {
    return this.colunas()[0]!.chave;
  }

  criarColuna(nome: string): ItemDoCadastro {
    return this.#criarItem('kb_colunas', nome);
  }

  renomearColuna(chave: string, nome: string): ItemDoCadastro {
    return this.#renomearItem('kb_colunas', chave, nome, 'Coluna não encontrada.');
  }

  excluirColuna(chave: string): void {
    const coluna = this.#item('kb_colunas', chave, 'Coluna não encontrada.');
    if (this.colunas().length === 1) {
      throw new DadosDoKanbanInvalidosError('O quadro precisa de pelo menos uma coluna.');
    }
    this.#excluirItem(
      'kb_colunas',
      chave,
      `A coluna "${coluna.nome}" tem cards: mova-os para outra coluna antes de excluir.`,
    );
  }

  /** Recebe todas as chaves na ordem nova: lista incompleta ou com sobra é recusada. */
  ordenarColunas(chaves: string[]): ItemDoCadastro[] {
    const atuais = this.colunas().map((coluna) => coluna.chave);
    const mesmas =
      chaves.length === atuais.length && atuais.every((chave) => chaves.includes(chave));
    if (!mesmas) {
      throw new DadosDoKanbanInvalidosError(
        'As colunas mudaram enquanto você ordenava. Reabra a lista e tente de novo.',
      );
    }
    this.#emTransacao(() => {
      const ordenar = this.#db.prepare('UPDATE kb_colunas SET ordem = ? WHERE chave = ?');
      chaves.forEach((chave, posicao) => ordenar.run(posicao, chave));
    });
    this.#avisarCadastros();
    return this.colunas();
  }

  criarTipo(nome: string): ItemDoCadastro {
    return this.#criarItem('kb_tipos', nome);
  }

  renomearTipo(chave: string, nome: string): ItemDoCadastro {
    return this.#renomearItem('kb_tipos', chave, nome, 'Tipo não encontrado.');
  }

  excluirTipo(chave: string): void {
    const tipo = this.#item('kb_tipos', chave, 'Tipo não encontrado.');
    this.#excluirItem(
      'kb_tipos',
      chave,
      `O tipo "${tipo.nome}" está em cards: troque o tipo deles antes de excluir.`,
    );
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

  /** Todos os kanbans, de todos os clientes e o Interno: é o que o Kanban geral mostra. */
  geral(): KanbansDoCliente {
    const demandas = (
      this.#db
        .prepare('SELECT * FROM kb_demandas ORDER BY cliente_id, id')
        .all() as unknown as LinhaDeDemanda[]
    ).map(paraDemanda);
    const tarefas = (
      this.#db
        .prepare('SELECT * FROM kb_tarefas ORDER BY demanda_id, estado, ordem, id')
        .all() as unknown as LinhaDeTarefa[]
    ).map(paraTarefa);
    return { demandas, tarefas };
  }

  demanda(id: number): DemandaDoKanban {
    return paraDemanda(this.#linhaDaDemanda(id));
  }

  /** O kanban sem projeto do cliente, ou o Interno com `clienteId` vazio. */
  quadroDoCliente(clienteId: string): DemandaDoKanban | undefined {
    return this.demandasDoProjeto(clienteId, '')[0];
  }

  /**
   * O kanban do projeto, ou o sem projeto do cliente com `projetoId` vazio, criado vazio
   * na primeira tarefa que recebe.
   */
  garantirQuadro(clienteId: string, projetoId: string, nome: string): DemandaDoKanban {
    return (
      this.demandasDoProjeto(clienteId, projetoId)[0] ??
      this.criarDemanda(clienteId, { projetoId, nome })
    );
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

  /**
   * Devolve o kanban como ficou. Desvincular do projeto quando o cliente já tem kanban
   * sem projeto junta as tarefas nele: o devolvido é esse outro.
   */
  alterarDemanda(id: number, alteracao: AlteracaoDeDemanda): DemandaDoKanban {
    const atual = this.#linhaDaDemanda(id);
    if (alteracao.projetoId === '' && atual.projeto_id) {
      const doCliente = this.quadroDoCliente(atual.cliente_id);
      if (doCliente) {
        this.#juntar(id, doCliente.id);
        return this.demanda(doCliente.id);
      }
    }
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

  /** O projeto foi excluído e o usuário quis manter o kanban: fica no cliente, sem projeto. */
  desvincularDoProjeto(clienteId: string, projetoId: string): void {
    for (const demanda of this.demandasDoProjeto(clienteId, projetoId)) {
      this.alterarDemanda(demanda.id, { projetoId: '' });
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
   * tarefas desta demanda que continuam na primeira coluna. O que já foi movido fica,
   * mesmo que a nova análise não o traga: quem decide descartar é a pessoa.
   */
  registrarAnalise(
    id: number,
    resultado: ResultadoParaRegistrar,
  ): { criadas: number; mantidas: number } {
    const demanda = this.#linhaDaDemanda(id);
    const agora = new Date().toISOString();
    const inicial = this.colunaInicial();

    const resultadoDaGravacao = this.#emTransacao(() => {
      const daInicial = this.#db
        .prepare('SELECT id FROM kb_tarefas WHERE demanda_id = ? AND estado = ?')
        .all(id, inicial) as { id: number }[];
      for (const velha of daInicial) {
        this.#transicao(velha.id, demanda, inicial, 'removida', agora, 'removida');
      }
      this.#db
        .prepare('DELETE FROM kb_tarefas WHERE demanda_id = ? AND estado = ?')
        .run(id, inicial);
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
        this.#inserirTarefa(demanda, dados, inicial, criadas, agora);
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

  /** Sem `estado`, a tarefa nasce na primeira coluna. */
  criarTarefa(demandaId: number, dados: DadosDeTarefa, estado?: string): TarefaDoKanban {
    const demanda = this.#linhaDaDemanda(demandaId);
    if (!(dados.titulo ?? '').trim()) {
      throw new DadosDoKanbanInvalidosError('Informe o título da tarefa.');
    }
    const coluna = this.#colunaValida(estado ?? this.colunaInicial());
    const id = this.#emTransacao(() =>
      this.#inserirTarefa(
        demanda,
        dados,
        coluna,
        this.#proximaOrdem(demandaId, coluna),
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
        dados.tipo !== undefined ? this.#tipoValido(dados.tipo) : atual.tipo,
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
  moverTarefa(id: number, estado: string, indice: number): TarefaDoKanban {
    this.#colunaValida(estado);
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

  /**
   * Leva a tarefa para o fim da mesma coluna de outro kanban, que pode ser de outro
   * cliente: o histórico dela vai junto, para os gráficos a contarem onde ela está.
   */
  levarTarefaPara(id: number, demandaId: number): TarefaDoKanban {
    const atual = this.tarefa(id);
    if (atual.demandaId === demandaId) {
      return atual;
    }
    const destino = this.#linhaDaDemanda(demandaId);
    this.#emTransacao(() => {
      this.#db
        .prepare('UPDATE kb_tarefas SET demanda_id = ?, ordem = ?, atualizada_em = ? WHERE id = ?')
        .run(
          destino.id,
          this.#proximaOrdem(destino.id, atual.estado),
          new Date().toISOString(),
          id,
        );
      this.#db
        .prepare('UPDATE kb_transicoes SET demanda_id = ?, cliente_id = ? WHERE tarefa_id = ?')
        .run(destino.id, destino.cliente_id, id);
      this.#renumerar(atual.demandaId, atual.estado);
    });
    this.#avisar(atual.demandaId);
    this.#avisar(destino.id);
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

  /**
   * Passa as tarefas e o histórico de `origemId` para o fim de cada coluna de `destinoId`
   * e apaga a origem, com o documento: o resumo e a análise eram do escopo dela.
   */
  #juntar(origemId: number, destinoId: number): void {
    const origem = this.#linhaDaDemanda(origemId);
    this.#emTransacao(() => {
      const estados = this.#db
        .prepare('SELECT DISTINCT estado FROM kb_tarefas WHERE demanda_id = ?')
        .all(origemId) as { estado: string }[];
      for (const { estado } of estados) {
        this.#db
          .prepare(
            'UPDATE kb_tarefas SET demanda_id = ?, ordem = ordem + ? WHERE demanda_id = ? AND estado = ?',
          )
          .run(destinoId, this.#proximaOrdem(destinoId, estado), origemId, estado);
        this.#renumerar(destinoId, estado);
      }
      this.#db
        .prepare('UPDATE kb_transicoes SET demanda_id = ? WHERE demanda_id = ?')
        .run(destinoId, origemId);
      this.#db.prepare('DELETE FROM kb_demandas WHERE id = ?').run(origemId);
    });
    this.#apagarArquivo(origem.documento_arquivo);
    this.#avisar(origemId, true, origem.cliente_id);
    this.#avisar(destinoId);
  }

  /** Antes da regra de um kanban sem projeto por cliente podiam existir vários: ficam no mais antigo. */
  #juntarQuadrosSemProjeto(): void {
    const semProjeto = this.#db
      .prepare(`SELECT id, cliente_id FROM kb_demandas WHERE projeto_id = '' ORDER BY id`)
      .all() as { id: number; cliente_id: string }[];
    const maisAntigo = new Map<string, number>();
    for (const { id, cliente_id } of semProjeto) {
      const destino = maisAntigo.get(cliente_id);
      if (destino === undefined) {
        maisAntigo.set(cliente_id, id);
      } else {
        this.#juntar(id, destino);
      }
    }
  }

  #inserirTarefa(
    demanda: LinhaDeDemanda,
    dados: DadosDeTarefa,
    estado: string,
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
        this.#tipoValido(dados.tipo),
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

  #colunaValida(estado: string): string {
    if (!this.colunas().some((coluna) => coluna.chave === estado)) {
      throw new DadosDoKanbanInvalidosError('Coluna do kanban desconhecida.');
    }
    return estado;
  }

  /**
   * Aceita a chave ou o nome do tipo. O desconhecido vira sem tipo em vez de erro: é o
   * que a IA e os agentes mandam que mais varia.
   */
  #tipoValido(valor: string | undefined): string {
    const procurado = chaveDoNome(valor ?? '');
    if (!procurado) {
      return '';
    }
    const tipo = this.tipos().find(
      (item) => item.chave === procurado || chaveDoNome(item.nome) === procurado,
    );
    return tipo?.chave ?? '';
  }

  #itens(tabela: TabelaDoCadastro): ItemDoCadastro[] {
    const linhas = this.#db
      .prepare(`SELECT chave, nome FROM ${tabela} ORDER BY ordem, chave`)
      .all() as unknown as ItemDoCadastro[];
    return linhas.map(({ chave, nome }) => ({ chave, nome }));
  }

  #item(tabela: TabelaDoCadastro, chave: string, naoEncontrado: string): ItemDoCadastro {
    const item = this.#itens(tabela).find((atual) => atual.chave === chave);
    if (!item) {
      throw new DadosDoKanbanInvalidosError(naoEncontrado);
    }
    return item;
  }

  #semearCadastro(tabela: TabelaDoCadastro): void {
    if (this.#itens(tabela).length) {
      return;
    }
    const inserir = this.#db.prepare(`INSERT INTO ${tabela} (chave, nome, ordem) VALUES (?, ?, ?)`);
    CADASTROS[tabela].iniciais.forEach((item, ordem) => inserir.run(item.chave, item.nome, ordem));
  }

  #exigirNomeLivre(tabela: TabelaDoCadastro, nome: string, chaveAtual = ''): void {
    const comparavel = nome.toLocaleLowerCase('pt-BR');
    const repetido = this.#itens(tabela).some(
      (item) => item.chave !== chaveAtual && item.nome.toLocaleLowerCase('pt-BR') === comparavel,
    );
    if (repetido) {
      throw new DadosDoKanbanInvalidosError(`Já existe "${nome}".`);
    }
  }

  /** A chave nasce do nome; repetida (de um item excluído e recriado) ganha um número. */
  #criarItem(tabela: TabelaDoCadastro, nomeInformado: string): ItemDoCadastro {
    const nome = nomeDoCadastroValido(nomeInformado);
    this.#exigirNomeLivre(tabela, nome);
    const usadas = new Set(this.#itens(tabela).map((item) => item.chave));
    const base = chaveDoNome(nome) || 'item';
    let chave = base;
    for (let numero = 2; usadas.has(chave); numero += 1) {
      chave = `${base}_${numero}`;
    }
    this.#db
      .prepare(
        `INSERT INTO ${tabela} (chave, nome, ordem)
         VALUES (?, ?, (SELECT COALESCE(MAX(ordem) + 1, 0) FROM ${tabela}))`,
      )
      .run(chave, nome);
    this.#avisarCadastros();
    return { chave, nome };
  }

  #renomearItem(
    tabela: TabelaDoCadastro,
    chave: string,
    nomeInformado: string,
    naoEncontrado: string,
  ): ItemDoCadastro {
    this.#item(tabela, chave, naoEncontrado);
    const nome = nomeDoCadastroValido(nomeInformado);
    this.#exigirNomeLivre(tabela, nome, chave);
    this.#db.prepare(`UPDATE ${tabela} SET nome = ? WHERE chave = ?`).run(nome, chave);
    this.#avisarCadastros();
    return { chave, nome };
  }

  #excluirItem(tabela: TabelaDoCadastro, chave: string, emUso: string): void {
    const tarefas = this.#db
      .prepare(
        `SELECT t.id, t.titulo, d.cliente_id AS clienteId, d.nome AS quadro
           FROM kb_tarefas t JOIN kb_demandas d ON d.id = t.demanda_id
          WHERE t.${CADASTROS[tabela].campo} = ?
          ORDER BY d.cliente_id, d.nome, t.titulo`,
      )
      .all(chave) as unknown as TarefaQueImpede[];
    if (tarefas.length) {
      throw new CadastroEmUsoError(
        emUso,
        tarefas.map(({ id, titulo, clienteId, quadro }) => ({ id, titulo, clienteId, quadro })),
      );
    }
    this.#db.prepare(`DELETE FROM ${tabela} WHERE chave = ?`).run(chave);
    this.#avisarCadastros();
  }

  #avisarCadastros(): void {
    for (const ouvinte of this.#ouvintesDosCadastros) {
      ouvinte();
    }
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
