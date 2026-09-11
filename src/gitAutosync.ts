/**
 * Cliente do git-autosync, falando com ele pelo `hub-helper.ps1`.
 *
 * O git-autosync e um programa Python empacotado para Windows; o hub roda num container
 * Linux e nao o executa. O helper faz o shell-out e este modulo so monta as chamadas e
 * cruza os dois arquivos de estado que o CLI expoe.
 */
import type { HubHelper } from './sankhya/helper.ts';
import type {
  AlvoAutosync,
  CommitAutosync,
  EstadoRepoAutosync,
  RepoAutosync,
} from './types.ts';

interface ConfigAutosync {
  targets?: AlvoAutosync[];
  schedules?: string[];
  aiEnabled?: boolean;
  aiAgent?: string;
}

interface StatusAutosync {
  lastSyncRun?: string;
  repos?: Record<string, Omit<EstadoRepoAutosync, 'path'>>;
}

export interface VisaoAutosync {
  /** Horarios do agendamento (`config.json`), ex.: `["17:40"]`. */
  horarios: string[];
  ultimaExecucao: string | null;
  repos: RepoAutosync[];
  /**
   * Quem escreve a mensagem do commit automatico.
   *
   * Desligada, o CLI nem tenta gerar: comita com o texto fixo
   * `chore: auto-commit <data hora>`. E o que explica o historico cheio deles.
   */
  ia: { ligada: boolean; agente: string };
}

/** Caminho do Windows: compara sem diferenciar maiusculas nem `/` de `\`. */
function normalizar(caminho: string): string {
  return caminho.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export class GitAutosync {
  readonly #helper: HubHelper;

  constructor(helper: HubHelper) {
    this.#helper = helper;
  }

  async #dados<T>(caminho: string): Promise<T> {
    const corpo = await this.#helper.requisitar<{ dados: T }>(caminho);
    return corpo.dados;
  }

  /**
   * Cruza config e status num repositorio por linha.
   *
   * Nenhum dos dois arquivos sozinho serve: a config lista ALVOS (uma pasta `root` cobre
   * N repositorios sem nomear nenhum) e o status lista os repositorios que ja rodaram,
   * sem dizer se continuam no agendamento.
   */
  async visao(): Promise<VisaoAutosync> {
    const [config, status] = await Promise.all([
      this.#dados<ConfigAutosync | null>('/git-autosync/config'),
      this.#dados<StatusAutosync | null>('/git-autosync/status'),
    ]);

    const alvos = config?.targets ?? [];
    const estados = status?.repos ?? {};

    const excluidos = new Set(
      alvos.flatMap((alvo) => (alvo.exclude ?? []).map(normalizar)),
    );
    const alvosProprios = new Map(
      alvos.filter((a) => a.type === 'repo').map((a) => [normalizar(a.path), a]),
    );

    // Um repositorio pode aparecer no status sem estar mais na config (foi removido) e
    // na config sem nunca ter rodado. A uniao dos dois e a lista honesta.
    const caminhos = new Map<string, string>();
    for (const alvo of alvos) {
      if (alvo.type === 'repo') caminhos.set(normalizar(alvo.path), alvo.path);
    }
    for (const caminho of Object.keys(estados)) caminhos.set(normalizar(caminho), caminho);

    const repos: RepoAutosync[] = [...caminhos.entries()]
      .map(([chave, caminho]) => {
        const estado = estados[caminho];
        const raiz = alvos.find(
          (a) => a.type === 'root' && normalizar(caminho).startsWith(`${normalizar(a.path)}/`),
        );

        return {
          path: caminho,
          alvo: alvosProprios.has(chave) ? caminho : (raiz?.path ?? ''),
          ativo: !excluidos.has(chave),
          alvoProprio: alvosProprios.has(chave),
          estado: estado ? { path: caminho, ...estado } : null,
        };
      })
      .sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));

    return {
      horarios: config?.schedules ?? [],
      ultimaExecucao: status?.lastSyncRun ?? null,
      repos,
      ia: {
        ligada: config?.aiEnabled === true,
        // `auto` = o CLI escolhe o primeiro agente que achar instalado.
        agente: config?.aiAgent ?? 'auto',
      },
    };
  }

  /** Liga ou desliga a geração de mensagem por IA, e escolhe o agente. */
  async definirIa(ligada: boolean, agente: string): Promise<{ ok: boolean }> {
    return this.#helper.requisitar<{ ok: boolean }>('/git-autosync/ia', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ligada, agente }),
    });
  }

  async historico(repo: string, limite = 20): Promise<CommitAutosync[]> {
    const busca = new URLSearchParams({ repo, limit: String(limite), since: 'all' });
    const dados = await this.#dados<Record<string, CommitAutosync[]> | null>(
      `/git-autosync/history?${busca}`,
    );
    // A resposta e um objeto por caminho; com `--repo` vem uma chave so, mas o CLI pode
    // devolve-la com barras diferentes das que mandamos.
    return Object.values(dados ?? {})[0] ?? [];
  }

  /** Mensagem que o autosync usaria neste repositório agora. Não grava nada. */
  async previa(repo: string): Promise<{ path: string; message: string } | null> {
    const busca = new URLSearchParams({ repo });
    return this.#dados<{ path: string; message: string } | null>(
      `/git-autosync/preview?${busca}`,
    );
  }

  #acao(rota: string, corpo: Record<string, unknown>): Promise<{ saida: string }> {
    return this.#helper.requisitar<{ saida: string }>(`/git-autosync/${rota}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  }

  commit(caminho: string, mensagem?: string): Promise<{ saida: string }> {
    return this.#acao('commit', { caminho, ...(mensagem ? { mensagem } : {}) });
  }

  push(caminho: string): Promise<{ saida: string }> {
    return this.#acao('push', { caminho });
  }

  sync(caminho: string, mensagem?: string): Promise<{ saida: string }> {
    return this.#acao('sync', { caminho, ...(mensagem ? { mensagem } : {}) });
  }

  /** Merge request — só GitLab; o CLI não tem suporte a pull request do GitHub. */
  mr(caminho: string, titulo?: string): Promise<{ saida: string }> {
    return this.#acao('mr', { caminho, ...(titulo ? { titulo } : {}) });
  }

  /**
   * Liga/desliga o repositório no agendamento.
   *
   * Repositório que é alvo próprio sai com `remove`; o que veio de uma pasta `root` sai
   * com `exclude` — `remove` na pasta raiz levaria junto todos os outros repos dela.
   */
  definirAtivo(repo: RepoAutosync, ativo: boolean): Promise<{ saida: string }> {
    if (ativo) {
      return repo.alvoProprio
        ? this.#acao('repos', { caminho: repo.path, tipo: 'repo' })
        : this.#acao('include', { caminho: repo.path });
    }
    return repo.alvoProprio
      ? this.#helper.requisitar<{ saida: string }>('/git-autosync/repos', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ caminho: repo.path }),
        })
      : this.#acao('exclude', { caminho: repo.path });
  }
}
