/**
 * Cliente do git-autosync, falando com ele pelo `hub-helper.ps1`.
 *
 * O git-autosync e um programa Python empacotado para Windows; o hub roda num container
 * Linux e nao o executa. O helper faz o shell-out e este modulo so monta as chamadas e
 * cruza os dois arquivos de estado que o CLI expoe.
 */
import type { HubHelper } from './sankhya/helper.ts';

/**
 * Quem executa o git-autosync de fato.
 *
 * Duas implementacoes com a mesma assinatura: o `HubHelper` (hub em container, que
 * delega ao `hub-helper.ps1`) e o `GitAutosyncCli` (backend nativo, que chama o CLI
 * direto). Este modulo nao precisa saber qual esta' em uso.
 */
export interface TransporteAutosync {
  requisitar<T>(caminho: string, init?: RequestInit): Promise<T>;
}
import type {
  AlvoAutosync,
  CommitAutosync,
  EstadoRepoAutosync,
  RepoAutosync,
  TarefaAutosync,
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
  /**
   * As tarefas que o Agendador do Windows realmente tem.
   *
   * Nao e a mesma coisa que `horarios`: eles vivem na config e so viram tarefa depois
   * de um `install`. Lista vazia com horarios preenchidos significa agendamento que
   * parece configurado e nunca roda — o caso que a tela precisa deixar visivel.
   */
  tarefas: TarefaAutosync[];
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
  readonly #helper: TransporteAutosync;

  constructor(helper: TransporteAutosync) {
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
    const [config, status, tarefas] = await Promise.all([
      this.#dados<ConfigAutosync | null>('/git-autosync/config'),
      this.#dados<StatusAutosync | null>('/git-autosync/status'),
      // Best-effort: sem o Agendador legivel a tela perde o aviso de "nao instalado",
      // mas o resto do painel (repositorios, historico, acoes) continua inteiro.
      this.#dados<TarefaAutosync[] | null>('/git-autosync/tarefas').catch(() => null),
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
      tarefas: tarefas ?? [],
      ultimaExecucao: status?.lastSyncRun ?? null,
      repos,
      ia: {
        ligada: config?.aiEnabled === true,
        // `auto` = o CLI escolhe o primeiro agente que achar instalado.
        agente: config?.aiAgent ?? 'auto',
      },
    };
  }

  /**
   * Reescreve os horarios do agendamento.
   *
   * O CLI reinstala a tarefa do Agendador junto, entao o gatilho passa a valer na hora
   * — nao ha passo de reinstalar depois. `instalar()` continua existindo para quando
   * nao ha tarefa nenhuma, ou quando alguem a removeu por fora.
   */
  async definirHorarios(horarios: string[]): Promise<{ saida: string }> {
    return this.#acao('agendamento', { horarios });
  }

  /** Cria (ou recria) a tarefa no Agendador a partir dos horarios da config. */
  async instalar(): Promise<{ saida: string }> {
    return this.#acao('instalar', {});
  }

  /** Remove a tarefa do Agendador. Config e repositorios ficam como estao. */
  async desinstalar(): Promise<{ saida: string }> {
    return this.#acao('desinstalar', {});
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

  /** Abre CMD ou Git Bash na pasta do repositório — não roda o CLI, só resolve o que ele não resolve sozinho. */
  terminal(caminho: string, tipo: 'cmd' | 'git-bash'): Promise<{ saida: string }> {
    return this.#acao('terminal', { caminho, tipo });
  }

  /**
   * Últimas linhas do `autosync.log`.
   *
   * Texto simples que o CLI vai gravando a cada rodada agendada — não é o `git log` do
   * repositório, que é o que `historico()` devolve.
   */
  async log(limite = 200): Promise<string[]> {
    const busca = new URLSearchParams({ limite: String(limite) });
    return (await this.#dados<string[] | null>(`/git-autosync/log?${busca}`)) ?? [];
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
