/**
 * Onde o módulo `serverlog` está instalado, e até quando pode ficar.
 *
 * O módulo entra na base DO CLIENTE só para acompanhar uma demanda (ver
 * `desktop/src/serverLog.ts`). O risco é ele ficar lá depois que a demanda acaba: código
 * nosso lendo o log de produção de terceiro sem motivo. Esta tabela existe para isso não
 * depender de alguém lembrar — o hub registra sozinho quando DETECTA o módulo (numa
 * verificação ou na primeira leitura que dá certo), com um prazo padrão, e o shell avisa
 * quando o prazo vence.
 *
 * Chave é o origin, não o id da base: é o origin que a leitura usa, e duas linhas de
 * cadastro apontando para a mesma URL são a mesma instalação.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { InstalacaoServerLog } from '../types.ts';

/**
 * Prazo quando o cliente não tem fim de demanda cadastrado. Curto de propósito: é para
 * incomodar, não para o módulo morar na base.
 */
export const DIAS_PADRAO_REMOCAO = 7;

interface LinhaBanco {
  origin: string;
  cliente_nome: string;
  detectado_em: string;
  remover_ate: string;
  demanda: string;
  removido_em: string;
  modulo: string;
  botao_id: string;
  botao_monitor_id: string;
  ultima_verificacao: string;
  ultimo_status: string;
}

/**
 * `YYYY-MM-DD` no fuso LOCAL. Não `toISOString()`: aquele é UTC, e depois das 21h em
 * São Paulo o "hoje" já seria amanhã — o prazo venceria um dia antes do combinado.
 */
function dataLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hojeIso(): string {
  return dataLocal(new Date());
}

function somarDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return dataLocal(d);
}

function converter(l: LinhaBanco): InstalacaoServerLog {
  const ativa = !l.removido_em;
  return {
    origin: l.origin,
    clienteNome: l.cliente_nome,
    detectadoEm: l.detectado_em,
    removerAte: l.remover_ate,
    demanda: l.demanda,
    removidoEm: l.removido_em,
    modulo: l.modulo,
    botaoId: l.botao_id,
    botaoMonitorId: l.botao_monitor_id,
    ultimaVerificacao: l.ultima_verificacao,
    ultimoStatus: l.ultimo_status,
    ativa,
    // Comparação de texto: `YYYY-MM-DD` ordena como data.
    vencida: ativa && Boolean(l.remover_ate) && l.remover_ate <= hojeIso(),
  };
}

export class ServerLogInstalacoes {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(join(dataDir, 'sankhya.db'));
    this.#db.exec('PRAGMA journal_mode = WAL');
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS serverlog_instalacoes (
        origin             TEXT PRIMARY KEY,
        cliente_nome       TEXT NOT NULL DEFAULT '',
        detectado_em       TEXT NOT NULL DEFAULT '',
        remover_ate        TEXT NOT NULL DEFAULT '',
        demanda            TEXT NOT NULL DEFAULT '',
        removido_em        TEXT NOT NULL DEFAULT '',
        modulo             TEXT NOT NULL DEFAULT '',
        botao_id           TEXT NOT NULL DEFAULT '',
        botao_monitor_id   TEXT NOT NULL DEFAULT '',
        ultima_verificacao TEXT NOT NULL DEFAULT '',
        ultimo_status      TEXT NOT NULL DEFAULT ''
      );
    `);
  }

  listar(): InstalacaoServerLog[] {
    const linhas = this.#db
      .prepare('SELECT * FROM serverlog_instalacoes ORDER BY removido_em <> \'\', remover_ate, origin')
      .all() as unknown as LinhaBanco[];
    return linhas.map(converter);
  }

  obter(origin: string): InstalacaoServerLog | undefined {
    const linha = this.#db.prepare('SELECT * FROM serverlog_instalacoes WHERE origin = ?').get(origin) as
      | LinhaBanco
      | undefined;
    return linha ? converter(linha) : undefined;
  }

  /** Ativas com prazo vencido — o que o shell notifica ao abrir. */
  pendencias(): InstalacaoServerLog[] {
    return this.listar().filter((i) => i.vencida);
  }

  /**
   * O módulo foi visto nesta base.
   *
   * Primeira vez (ou volta depois de dado como removido): abre instalação nova, com prazo
   * padrão. Já ativa: só atualiza o que foi visto, SEM mexer no prazo nem na demanda que
   * o usuário escreveu — uma leitura a cada 5s não pode ficar empurrando o prazo.
   */
  registrarDeteccao(
    origin: string,
    visto: {
      clienteNome?: string;
      modulo?: string;
      botaoId?: string;
      botaoMonitorId?: string;
      /** Prazo de uma instalação NOVA — o fim da demanda do cliente, quando cadastrado. */
      removerAtePadrao?: string;
    },
  ): InstalacaoServerLog {
    const atual = this.obter(origin);
    const agora = new Date().toISOString();
    // Fim de demanda já passado é resto da demanda ANTERIOR do cliente: usá-lo faria a
    // instalação nova nascer vencida e avisar no mesmo dia em que o módulo entrou.
    const prazoNovo =
      visto.removerAtePadrao && visto.removerAtePadrao >= hojeIso()
        ? visto.removerAtePadrao
        : somarDias(DIAS_PADRAO_REMOCAO);

    if (!atual || !atual.ativa) {
      this.#db
        .prepare(
          `INSERT INTO serverlog_instalacoes
             (origin, cliente_nome, detectado_em, remover_ate, demanda, removido_em, modulo, botao_id, botao_monitor_id)
           VALUES (?, ?, ?, ?, '', '', ?, ?, ?)
           ON CONFLICT(origin) DO UPDATE SET
             cliente_nome = excluded.cliente_nome,
             detectado_em = excluded.detectado_em,
             remover_ate = excluded.remover_ate,
             demanda = '',
             removido_em = '',
             modulo = excluded.modulo,
             botao_id = excluded.botao_id,
             botao_monitor_id = excluded.botao_monitor_id`,
        )
        .run(
          origin,
          visto.clienteNome ?? atual?.clienteNome ?? '',
          agora,
          prazoNovo,
          visto.modulo ?? '',
          visto.botaoId ?? '',
          visto.botaoMonitorId ?? '',
        );
    } else {
      // Só sobrescreve o que veio preenchido: a leitura conhece o botão mas não o módulo,
      // e não pode apagar o módulo que a verificação anterior anotou.
      this.#db
        .prepare(
          `UPDATE serverlog_instalacoes SET
             cliente_nome = CASE WHEN ? <> '' THEN ? ELSE cliente_nome END,
             modulo = CASE WHEN ? <> '' THEN ? ELSE modulo END,
             botao_id = CASE WHEN ? <> '' THEN ? ELSE botao_id END,
             botao_monitor_id = CASE WHEN ? <> '' THEN ? ELSE botao_monitor_id END
           WHERE origin = ?`,
        )
        .run(
          visto.clienteNome ?? '', visto.clienteNome ?? '',
          visto.modulo ?? '', visto.modulo ?? '',
          visto.botaoId ?? '', visto.botaoId ?? '',
          visto.botaoMonitorId ?? '', visto.botaoMonitorId ?? '',
          origin,
        );
    }
    return this.obter(origin)!;
  }

  registrarVerificacao(origin: string, resumo: string): void {
    this.#db
      .prepare('UPDATE serverlog_instalacoes SET ultima_verificacao = ?, ultimo_status = ? WHERE origin = ?')
      .run(new Date().toISOString(), resumo, origin);
  }

  atualizar(origin: string, entrada: { removerAte?: string; demanda?: string }): InstalacaoServerLog | undefined {
    if (!this.obter(origin)) return undefined;
    if (entrada.removerAte !== undefined) {
      this.#db.prepare('UPDATE serverlog_instalacoes SET remover_ate = ? WHERE origin = ?').run(entrada.removerAte, origin);
    }
    if (entrada.demanda !== undefined) {
      this.#db.prepare('UPDATE serverlog_instalacoes SET demanda = ? WHERE origin = ?').run(entrada.demanda, origin);
    }
    return this.obter(origin);
  }

  /** Só chamado depois de a verificação confirmar que módulo e botões sumiram da base. */
  marcarRemovido(origin: string): InstalacaoServerLog | undefined {
    this.#db
      .prepare('UPDATE serverlog_instalacoes SET removido_em = ? WHERE origin = ?')
      .run(new Date().toISOString(), origin);
    return this.obter(origin);
  }

  close(): void {
    this.#db.close();
  }
}

