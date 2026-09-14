/**
 * As colecoes do cartao de um cliente: bases, repositorios e links.
 *
 * Separado de `Clientes` porque a natureza e outra. `Clientes` guarda os campos que
 * amarram o cliente aos tres sistemas (Experience, Agenda, git) e que o resto do painel
 * consulta o tempo todo; aqui ficam listas que so a tela do cliente le, com o mesmo
 * CRUD repetido tres vezes.
 *
 * A senha da base e o unico dado sensivel: ela e cifrada pelo `hub-helper.ps1` com
 * DPAPI, do mesmo jeito que as credenciais do Sankhya, e o texto claro so sai daqui
 * pela rota de revelar — nunca na listagem.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { HubHelper } from './helper.ts';
import {
  AMBIENTES_BASE,
  SGBDS,
  type AmbienteBase,
  type BancoDaBaseEntrada,
  type BaseCliente,
  type BaseClienteEntrada,
  type LinkCliente,
  type LinkClienteEntrada,
  type RepoCliente,
  type RepoClienteEntrada,
  type Sgbd,
} from '../types.ts';

function ehAmbiente(valor: string): valor is AmbienteBase {
  return (AMBIENTES_BASE as readonly string[]).includes(valor);
}

function ehSgbd(valor: string): valor is Sgbd {
  return (SGBDS as readonly string[]).includes(valor);
}

/** Uma base sem nada anotado sobre o banco — o estado inicial de toda base. */
const BANCO_VAZIO: BancoDaBaseEntrada = {
  sgbd: '',
  host: '',
  porta: null,
  servico: '',
  esquema: '',
  usuario: '',
};

/** Uma linha nova vai para o fim da lista, como quem acrescenta na tela. */
function proximaOrdem(db: DatabaseSync, tabela: string, clienteId: number): number {
  const linha = db
    .prepare(`SELECT COALESCE(MAX(ordem), -1) + 1 AS proxima FROM ${tabela} WHERE cliente_id = ?`)
    .get(clienteId) as { proxima: number };
  return Number(linha.proxima);
}

export class CartaoClientes {
  readonly #db: DatabaseSync;
  readonly #helper: HubHelper;

  constructor(dataDir: string, helper: HubHelper) {
    mkdirSync(dataDir, { recursive: true });
    // Mesmo arquivo que `Clientes` — as tabelas sao criadas la, junto da migracao.
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#helper = helper;
  }

  /* ------------------------------- bases -------------------------------- */

  bases(clienteId: number): BaseCliente[] {
    const linhas = this.#db
      .prepare('SELECT * FROM cliente_bases WHERE cliente_id = ? ORDER BY ordem, id')
      .all(clienteId) as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      id: Number(l['id']),
      clienteId: Number(l['cliente_id']),
      ambiente: ehAmbiente(String(l['ambiente'])) ? (String(l['ambiente']) as AmbienteBase) : 'outro',
      url: String(l['url']),
      usuario: String(l['usuario']),
      // Nunca o valor: so se existe. Quem quer ler pede pela rota de revelar.
      temSenha: String(l['senha_cifrada']) !== '',
      versao: String(l['versao']),
      monitorar: Number(l['monitorar']) === 1,
      banco: {
        sgbd: ehSgbd(String(l['banco_sgbd'] ?? '')) ? (String(l['banco_sgbd']) as Sgbd) : '',
        host: String(l['banco_host'] ?? ''),
        // 0 na coluna significa "nao informado" — ver o ALTER em clientes.ts.
        porta: Number(l['banco_porta'] ?? 0) || null,
        servico: String(l['banco_servico'] ?? ''),
        esquema: String(l['banco_esquema'] ?? ''),
        usuario: String(l['banco_usuario'] ?? ''),
        // Mesma regra da senha da base: so se existe, nunca o valor.
        temSenha: String(l['banco_senha_cifrada'] ?? '') !== '',
      },
      ordem: Number(l['ordem']),
    }));
  }

  base(id: number): BaseCliente | undefined {
    const linha = this.#db.prepare('SELECT cliente_id FROM cliente_bases WHERE id = ?').get(id) as
      | { cliente_id: number }
      | undefined;
    return linha ? this.bases(Number(linha.cliente_id)).find((b) => b.id === id) : undefined;
  }

  /**
   * Cria ou atualiza uma base.
   *
   * Uma senha ausente em `senhas` mantem a que estava — a tela edita a URL sem precisar
   * redigitar senha nenhuma, e mandar vazio para "nao mexer" seria ambiguo com "apagar".
   * Para apagar, o valor `''` explicito. Vale para as duas: a do Sankhya (`base`) e a do
   * banco de dados (`banco`).
   */
  async gravarBase(
    clienteId: number,
    entrada: BaseClienteEntrada,
    senhas: { base?: string | undefined; banco?: string | undefined } = {},
    id?: number,
  ): Promise<BaseCliente | undefined> {
    const cifrada = await this.#cifrarOpcional(senhas.base);
    const cifradaBanco = await this.#cifrarOpcional(senhas.banco);
    const banco = entrada.banco ?? BANCO_VAZIO;

    if (id === undefined) {
      const resultado = this.#db
        .prepare(
          `INSERT INTO cliente_bases
             (cliente_id, ambiente, url, usuario, senha_cifrada, monitorar, ordem,
              banco_sgbd, banco_host, banco_porta, banco_servico, banco_esquema,
              banco_usuario, banco_senha_cifrada)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          clienteId,
          entrada.ambiente,
          entrada.url,
          entrada.usuario,
          cifrada ?? '',
          entrada.monitorar ? 1 : 0,
          proximaOrdem(this.#db, 'cliente_bases', clienteId),
          banco.sgbd,
          banco.host,
          banco.porta ?? 0,
          banco.servico,
          banco.esquema,
          banco.usuario,
          cifradaBanco ?? '',
        );
      return this.base(Number(resultado.lastInsertRowid));
    }

    // `banco` ausente na edicao = nao mexe, mesma regra das senhas. Sem isso, qualquer
    // gravacao parcial apagaria a conexao anotada: o botao "Monitorar" da tela manda so
    // ambiente, URL, usuario e o proprio monitorar, e limparia o banco em silencio.
    const colunasBanco =
      entrada.banco === undefined
        ? ''
        : `, banco_sgbd = ?, banco_host = ?, banco_porta = ?, banco_servico = ?,
             banco_esquema = ?, banco_usuario = ?`;
    const valoresBanco =
      entrada.banco === undefined
        ? []
        : [banco.sgbd, banco.host, banco.porta ?? 0, banco.servico, banco.esquema, banco.usuario];

    const resultado = this.#db
      .prepare(
        `UPDATE cliente_bases
            SET ambiente = ?, url = ?, usuario = ?, monitorar = ?, ordem = ?
                ${colunasBanco}
                ${cifrada === undefined ? '' : ', senha_cifrada = ?'}
                ${cifradaBanco === undefined ? '' : ', banco_senha_cifrada = ?'}
          WHERE id = ?`,
      )
      .run(
        entrada.ambiente,
        entrada.url,
        entrada.usuario,
        entrada.monitorar ? 1 : 0,
        entrada.ordem,
        ...valoresBanco,
        ...(cifrada === undefined ? [] : [cifrada]),
        ...(cifradaBanco === undefined ? [] : [cifradaBanco]),
        id,
      );

    return Number(resultado.changes ?? 0) ? this.base(id) : undefined;
  }

  /**
   * A senha em texto claro. Chamada so pela rota de revelar, a pedido explicito de quem
   * esta na tela — nao por carregamento de pagina.
   *
   * `coluna` escolhe qual senha da base: a do Sankhya ou a do banco de dados. O valor e
   * um literal do proprio codigo, nunca algo vindo da requisicao — a rota traduz o
   * caminho dela para um destes dois.
   */
  async revelarSenha(
    id: number,
    coluna: 'senha_cifrada' | 'banco_senha_cifrada' = 'senha_cifrada',
  ): Promise<string | null> {
    const linha = this.#db
      .prepare(`SELECT ${coluna} AS cifrada FROM cliente_bases WHERE id = ?`)
      .get(id) as { cifrada: string } | undefined;
    if (!linha?.cifrada) return null;

    const corpo = await this.#helper.requisitar<{ valor: string }>('/secret/decrypt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor: linha.cifrada }),
    });
    return corpo.valor ?? null;
  }

  /** Guarda o que a ultima medicao leu, para a tela mostrar a versao sem medir de novo. */
  registrarVersao(id: number, versao: string): void {
    this.#db.prepare('UPDATE cliente_bases SET versao = ? WHERE id = ?').run(versao, id);
  }

  /** Todas as bases marcadas para monitorar, de todos os clientes. */
  basesMonitoradas(): BaseCliente[] {
    const ids = this.#db
      .prepare('SELECT DISTINCT cliente_id AS id FROM cliente_bases WHERE monitorar = 1')
      .all() as unknown as { id: number }[];
    return ids.flatMap((l) => this.bases(Number(l.id))).filter((b) => b.monitorar);
  }

  /* ---------------------------- repositorios ---------------------------- */

  repos(clienteId: number): RepoCliente[] {
    const linhas = this.#db
      .prepare('SELECT * FROM cliente_repos WHERE cliente_id = ? ORDER BY ordem, id')
      .all(clienteId) as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      id: Number(l['id']),
      clienteId: Number(l['cliente_id']),
      nome: String(l['nome']),
      remoto: String(l['remoto']),
      caminhoLocal: String(l['caminho_local']),
      ordem: Number(l['ordem']),
    }));
  }

  gravarRepo(clienteId: number, entrada: RepoClienteEntrada, id?: number): RepoCliente | undefined {
    if (id === undefined) {
      const resultado = this.#db
        .prepare(
          `INSERT INTO cliente_repos (cliente_id, nome, remoto, caminho_local, ordem)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          clienteId,
          entrada.nome,
          entrada.remoto,
          entrada.caminhoLocal,
          proximaOrdem(this.#db, 'cliente_repos', clienteId),
        );
      return this.repos(clienteId).find((r) => r.id === Number(resultado.lastInsertRowid));
    }

    const resultado = this.#db
      .prepare(
        `UPDATE cliente_repos SET nome = ?, remoto = ?, caminho_local = ?, ordem = ? WHERE id = ?`,
      )
      .run(entrada.nome, entrada.remoto, entrada.caminhoLocal, entrada.ordem, id);

    return Number(resultado.changes ?? 0) ? this.repos(clienteId).find((r) => r.id === id) : undefined;
  }

  /* -------------------------------- links -------------------------------- */

  links(clienteId: number): LinkCliente[] {
    const linhas = this.#db
      .prepare('SELECT * FROM cliente_links WHERE cliente_id = ? ORDER BY ordem, id')
      .all(clienteId) as unknown as Record<string, unknown>[];

    return linhas.map((l) => ({
      id: Number(l['id']),
      clienteId: Number(l['cliente_id']),
      titulo: String(l['titulo']),
      url: String(l['url']),
      ordem: Number(l['ordem']),
    }));
  }

  gravarLink(clienteId: number, entrada: LinkClienteEntrada, id?: number): LinkCliente | undefined {
    if (id === undefined) {
      const resultado = this.#db
        .prepare('INSERT INTO cliente_links (cliente_id, titulo, url, ordem) VALUES (?, ?, ?, ?)')
        .run(clienteId, entrada.titulo, entrada.url, proximaOrdem(this.#db, 'cliente_links', clienteId));
      return this.links(clienteId).find((l) => l.id === Number(resultado.lastInsertRowid));
    }

    const resultado = this.#db
      .prepare('UPDATE cliente_links SET titulo = ?, url = ?, ordem = ? WHERE id = ?')
      .run(entrada.titulo, entrada.url, entrada.ordem, id);

    return Number(resultado.changes ?? 0) ? this.links(clienteId).find((l) => l.id === id) : undefined;
  }

  /* ------------------------------- comum --------------------------------- */

  /** Remove uma linha de qualquer uma das tres colecoes. */
  remover(colecao: 'bases' | 'repos' | 'links', id: number): boolean {
    const tabela = { bases: 'cliente_bases', repos: 'cliente_repos', links: 'cliente_links' }[colecao];
    const resultado = this.#db.prepare(`DELETE FROM ${tabela} WHERE id = ?`).run(id);
    return Number(resultado.changes ?? 0) > 0;
  }

  /** A quem pertence uma linha — a rota confere antes de deixar mexer. */
  donoDe(colecao: 'bases' | 'repos' | 'links', id: number): number | undefined {
    const tabela = { bases: 'cliente_bases', repos: 'cliente_repos', links: 'cliente_links' }[colecao];
    const linha = this.#db.prepare(`SELECT cliente_id FROM ${tabela} WHERE id = ?`).get(id) as
      | { cliente_id: number }
      | undefined;
    return linha ? Number(linha.cliente_id) : undefined;
  }

  /** `undefined` passa direto (= nao mexe) e `''` tambem (= apaga), sem chamar o helper. */
  async #cifrarOpcional(valor: string | undefined): Promise<string | undefined> {
    if (valor === undefined) return undefined;
    if (valor === '') return '';
    return this.#cifrar(valor);
  }

  async #cifrar(valor: string): Promise<string> {
    const corpo = await this.#helper.requisitar<{ valor: string }>('/secret/encrypt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ valor }),
    });
    return corpo.valor ?? '';
  }

  close(): void {
    this.#db.close();
  }
}
