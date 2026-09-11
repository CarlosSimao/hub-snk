/**
 * O cartao do cliente: bases, repositorios e links.
 *
 * Tres colecoes com o mesmo formato de rota (`/api/clientes/:id/<colecao>`), porque sao
 * a mesma coisa do ponto de vista da tela: lista ordenada que se adiciona, edita e
 * remove. O que muda e o corpo de cada uma — e, no caso das bases, a senha.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HelperError, HelperIndisponivelError } from './sankhya/helper.ts';
import type { CartaoClientes } from './sankhya/cartao.ts';
import type { Clientes } from './sankhya/clientes.ts';
import type { MonitorBases } from './sankhya/monitorBases.ts';
import { AMBIENTES_BASE, type AmbienteBase } from './types.ts';

export interface RouteCartaoDeps {
  cartao: CartaoClientes;
  clientes: Clientes;
  monitor: MonitorBases;
}

function responderErroHelper(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}

const texto = (dados: Record<string, unknown>, chave: string): string =>
  typeof dados[chave] === 'string' ? (dados[chave] as string).trim() : '';

/**
 * Guardar um `javascript:` aqui vira clique armado depois, quando a tela abrir o link.
 * Só http(s) entra — e a mensagem diz o porquê, porque a recusa parece arbitrária.
 */
function urlValida(valor: string): boolean {
  return /^https?:\/\//i.test(valor);
}

export function registerRoutesCartao(app: FastifyInstance, deps: RouteCartaoDeps): void {
  const { cartao, clientes, monitor } = deps;

  /** O cartão inteiro numa ida só — a tela do cliente precisa das três listas juntas. */
  app.get<{ Params: { id: string } }>('/api/clientes/:id/cartao', async (request, reply) => {
    const id = Number(request.params.id);
    const cliente = clientes.obter(id);
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });

    return {
      cliente,
      bases: cartao.bases(id),
      repos: cartao.repos(id),
      links: cartao.links(id),
    };
  });

  /* -------------------------------- bases -------------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/bases',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!clientes.obter(id)) return reply.code(404).send({ error: 'cliente não encontrado' });

      const erro = validarBase(request.body ?? {});
      if (erro) return reply.code(400).send({ error: erro });

      try {
        const base = await cartao.gravarBase(id, lerBase(request.body ?? {}), lerSenha(request.body ?? {}));
        return reply.code(201).send(base);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  app.put<{ Params: { id: string; baseId: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/bases/:baseId',
    async (request, reply) => {
      const id = Number(request.params.id);
      const baseId = Number(request.params.baseId);
      if (cartao.donoDe('bases', baseId) !== id) {
        return reply.code(404).send({ error: 'base não encontrada neste cliente' });
      }

      const erro = validarBase(request.body ?? {});
      if (erro) return reply.code(400).send({ error: erro });

      try {
        const base = await cartao.gravarBase(
          id,
          lerBase(request.body ?? {}),
          lerSenha(request.body ?? {}),
          baseId,
        );
        if (!base) return reply.code(404).send({ error: 'base não encontrada' });
        return base;
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  /**
   * A senha em texto claro de uma base.
   *
   * Rota separada e POST, não GET: revelar senha é uma ação deliberada de quem está na
   * tela, não algo que acontece ao carregar a página. Nada é registrado em log, e o
   * valor não aparece em nenhuma listagem.
   */
  app.post<{ Params: { id: string; baseId: string } }>(
    '/api/clientes/:id/bases/:baseId/revelar',
    async (request, reply) => {
      const baseId = Number(request.params.baseId);
      if (cartao.donoDe('bases', baseId) !== Number(request.params.id)) {
        return reply.code(404).send({ error: 'base não encontrada neste cliente' });
      }

      try {
        const senha = await cartao.revelarSenha(baseId);
        if (senha === null) return reply.code(404).send({ error: 'esta base não tem senha guardada' });
        return { senha };
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  /** Mede uma base agora: responde? em que versão? */
  app.post<{ Params: { id: string; baseId: string } }>(
    '/api/clientes/:id/bases/:baseId/medir',
    async (request, reply) => {
      const baseId = Number(request.params.baseId);
      if (cartao.donoDe('bases', baseId) !== Number(request.params.id)) {
        return reply.code(404).send({ error: 'base não encontrada neste cliente' });
      }

      const base = cartao.base(baseId);
      if (!base?.url) return reply.code(400).send({ error: 'esta base não tem URL cadastrada' });

      return monitor.medir(base);
    },
  );

  /* ---------------------------- repositórios ----------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/repos',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!clientes.obter(id)) return reply.code(404).send({ error: 'cliente não encontrado' });

      const corpo = request.body ?? {};
      if (!texto(corpo, 'caminhoLocal')) {
        return reply.code(400).send({ error: 'informe a pasta local do repositório' });
      }
      return reply.code(201).send(cartao.gravarRepo(id, lerRepo(corpo)));
    },
  );

  app.put<{ Params: { id: string; repoId: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/repos/:repoId',
    async (request, reply) => {
      const id = Number(request.params.id);
      const repoId = Number(request.params.repoId);
      if (cartao.donoDe('repos', repoId) !== id) {
        return reply.code(404).send({ error: 'repositório não encontrado neste cliente' });
      }

      const corpo = request.body ?? {};
      if (!texto(corpo, 'caminhoLocal')) {
        return reply.code(400).send({ error: 'informe a pasta local do repositório' });
      }

      const repo = cartao.gravarRepo(id, lerRepo(corpo), repoId);
      if (!repo) return reply.code(404).send({ error: 'repositório não encontrado' });
      return repo;
    },
  );

  /* -------------------------------- links -------------------------------- */

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/links',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!clientes.obter(id)) return reply.code(404).send({ error: 'cliente não encontrado' });

      const erro = validarLink(request.body ?? {});
      if (erro) return reply.code(400).send({ error: erro });
      return reply.code(201).send(cartao.gravarLink(id, lerLink(request.body ?? {})));
    },
  );

  app.put<{ Params: { id: string; linkId: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/links/:linkId',
    async (request, reply) => {
      const id = Number(request.params.id);
      const linkId = Number(request.params.linkId);
      if (cartao.donoDe('links', linkId) !== id) {
        return reply.code(404).send({ error: 'link não encontrado neste cliente' });
      }

      const erro = validarLink(request.body ?? {});
      if (erro) return reply.code(400).send({ error: erro });

      const link = cartao.gravarLink(id, lerLink(request.body ?? {}), linkId);
      if (!link) return reply.code(404).send({ error: 'link não encontrado' });
      return link;
    },
  );

  /* ------------------------------- remoção ------------------------------- */

  for (const colecao of ['bases', 'repos', 'links'] as const) {
    app.delete<{ Params: { id: string; itemId: string } }>(
      `/api/clientes/:id/${colecao}/:itemId`,
      async (request, reply) => {
        const itemId = Number(request.params.itemId);
        if (cartao.donoDe(colecao, itemId) !== Number(request.params.id)) {
          return reply.code(404).send({ error: 'item não encontrado neste cliente' });
        }
        cartao.remover(colecao, itemId);
        return { ok: true };
      },
    );
  }
}

/* ---------------------------- leitura do corpo ---------------------------- */

function validarBase(corpo: Record<string, unknown>): string | null {
  const url = texto(corpo, 'url');
  if (!url) return 'informe a URL da base';
  if (!urlValida(url)) return 'a URL da base precisa começar com http:// ou https://';

  const ambiente = texto(corpo, 'ambiente') || 'producao';
  if (!(AMBIENTES_BASE as readonly string[]).includes(ambiente)) {
    return `ambiente inválido — use um de: ${AMBIENTES_BASE.join(', ')}`;
  }
  return null;
}

function lerBase(corpo: Record<string, unknown>) {
  return {
    ambiente: (texto(corpo, 'ambiente') || 'producao') as AmbienteBase,
    url: texto(corpo, 'url'),
    usuario: texto(corpo, 'usuario'),
    monitorar: corpo['monitorar'] === true,
    ordem: Number(corpo['ordem']) || 0,
  };
}

/**
 * `undefined` = não mexe na senha guardada; `''` = apaga.
 *
 * A diferença importa: a tela edita a URL sem redigitar a senha, e tratar campo ausente
 * como "apagar" faria toda edição perder a senha em silêncio.
 */
function lerSenha(corpo: Record<string, unknown>): string | undefined {
  return typeof corpo['senha'] === 'string' ? (corpo['senha'] as string) : undefined;
}

function lerRepo(corpo: Record<string, unknown>) {
  return {
    nome: texto(corpo, 'nome'),
    remoto: texto(corpo, 'remoto'),
    caminhoLocal: texto(corpo, 'caminhoLocal'),
    ordem: Number(corpo['ordem']) || 0,
  };
}

function validarLink(corpo: Record<string, unknown>): string | null {
  if (!texto(corpo, 'titulo')) return 'informe o título do link';
  if (!urlValida(texto(corpo, 'url'))) return 'o link precisa começar com http:// ou https://';
  return null;
}

function lerLink(corpo: Record<string, unknown>) {
  return {
    titulo: texto(corpo, 'titulo'),
    url: texto(corpo, 'url'),
    ordem: Number(corpo['ordem']) || 0,
  };
}
