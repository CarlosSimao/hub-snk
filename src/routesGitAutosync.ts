/**
 * Rotas do git-autosync. Repassam para o `hub-helper.ps1`, que executa o CLI no Windows.
 *
 * As acoes de escrita (commit, push, sync, mr) mexem em repositorio de verdade — ficam
 * todas em POST, nunca em GET, para que nenhuma delas dispare por prefetch do navegador
 * ou por alguem abrindo a URL.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HelperError, HelperIndisponivelError } from './sankhya/helper.ts';
import type { GitAutosync } from './gitAutosync.ts';
import type { RepoAutosync } from './types.ts';

export interface RouteGitDeps {
  gitAutosync: GitAutosync;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}

function caminhoDoCorpo(corpo: unknown): string {
  const dados = (corpo ?? {}) as { caminho?: unknown };
  return typeof dados.caminho === 'string' ? dados.caminho.trim() : '';
}

export function registerRoutesGitAutosync(app: FastifyInstance, deps: RouteGitDeps): void {
  const { gitAutosync } = deps;

  app.get('/api/git-autosync', async (_request, reply) => {
    try {
      return await gitAutosync.visao();
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  app.get<{ Querystring: { repo?: string; limite?: string } }>(
    '/api/git-autosync/historico',
    async (request, reply) => {
      const repo = request.query.repo?.trim();
      if (!repo) return reply.code(400).send({ error: 'informe ?repo=<caminho>' });

      try {
        const limite = Math.min(100, Number(request.query.limite) || 20);
        return { commits: await gitAutosync.historico(repo, limite) };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.get<{ Querystring: { repo?: string } }>(
    '/api/git-autosync/previa',
    async (request, reply) => {
      const repo = request.query.repo?.trim();
      if (!repo) return reply.code(400).send({ error: 'informe ?repo=<caminho>' });

      try {
        return { previa: await gitAutosync.previa(repo) };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  for (const acao of ['commit', 'push', 'sync', 'mr'] as const) {
    app.post<{ Body: { caminho?: unknown; mensagem?: unknown; titulo?: unknown } }>(
      `/api/git-autosync/${acao}`,
      async (request, reply) => {
        const caminho = caminhoDoCorpo(request.body);
        if (!caminho) return reply.code(400).send({ error: 'envie { caminho }' });

        const texto = (valor: unknown) =>
          typeof valor === 'string' && valor.trim() ? valor.trim() : undefined;

        try {
          const resultado =
            acao === 'push'
              ? await gitAutosync.push(caminho)
              : acao === 'mr'
                ? await gitAutosync.mr(caminho, texto(request.body?.titulo))
                : await gitAutosync[acao](caminho, texto(request.body?.mensagem));

          return { ok: true, saida: resultado.saida };
        } catch (err) {
          return responderErro(reply, err);
        }
      },
    );
  }

  /**
   * Quem escreve a mensagem do commit automático.
   *
   * Desligada, o git-autosync nem tenta gerar: comita com o texto fixo
   * `chore: auto-commit <data hora>`. Ligada, ele manda o diff staged para o agente
   * escolhido, que roda nesta máquina — por isso é escolha explícita, não padrão.
   */
  app.post<{ Body: { ligada?: unknown; agente?: unknown } }>(
    '/api/git-autosync/ia',
    async (request, reply) => {
      const { ligada, agente } = request.body ?? {};
      if (typeof ligada !== 'boolean') {
        return reply.code(400).send({ error: 'envie { ligada: boolean, agente? }' });
      }

      const escolhido = typeof agente === 'string' ? agente : '';
      if (escolhido && !['auto', 'claude', 'codex', 'opencode'].includes(escolhido)) {
        return reply.code(400).send({ error: `agente inválido: ${escolhido}` });
      }

      try {
        await gitAutosync.definirIa(ligada, escolhido);
        return { ok: true };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.post<{ Body: { repo?: RepoAutosync; ativo?: unknown } }>(
    '/api/git-autosync/ativo',
    async (request, reply) => {
      const { repo, ativo } = request.body ?? {};
      if (!repo?.path || typeof ativo !== 'boolean') {
        return reply.code(400).send({ error: 'envie { repo, ativo: boolean }' });
      }

      try {
        const resultado = await gitAutosync.definirAtivo(repo, ativo);
        return { ok: true, saida: resultado.saida };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );
}
