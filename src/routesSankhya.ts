/**
 * Rotas da suite Sankhya: credenciais (via hub-helper) e cadastro de clientes.
 *
 * Registradas ao lado de `registerRoutes` (routes.ts), que continua com o contrato
 * inalterado — o painel de monitoramento nao sabe que estas existem.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HelperError, HelperIndisponivelError, type HubHelper } from './sankhya/helper.ts';
import { ehSistemaValido, type Credenciais } from './sankhya/credenciais.ts';
import type { Clientes } from './sankhya/clientes.ts';
import { SISTEMAS_SANKHYA, type Cliente, type ClienteEntrada } from './types.ts';

export interface RouteSankhyaDeps {
  helper: HubHelper;
  credenciais: Credenciais;
  clientes: Clientes;
}

/**
 * Helper fora do ar e situacao NORMAL (o processo Windows pode nao ter subido), nao
 * defeito do hub — vira 503 com a mensagem original, que e o que a tela mostra.
 */
function responderErroHelper(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}

/** Numero opcional vindo de formulario: `''`, `null` e ausente viram `null`. */
function numeroOpcional(valor: unknown): number | null | 'invalido' {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero >= 0 ? numero : 'invalido';
}

function normalizarCliente(corpo: unknown): ClienteEntrada | string {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) {
    return 'envie um objeto com os dados do cliente';
  }
  const dados = corpo as Record<string, unknown>;

  const nome = typeof dados['nome'] === 'string' ? dados['nome'].trim() : '';
  if (!nome) return 'o nome do cliente é obrigatório';

  const projetoId = numeroOpcional(dados['experienceProjetoId']);
  if (projetoId === 'invalido') return 'experienceProjetoId precisa ser um número inteiro';

  const personId = numeroOpcional(dados['experiencePersonId']);
  if (personId === 'invalido') return 'experiencePersonId precisa ser um número inteiro';

  const texto = (chave: string) => (typeof dados[chave] === 'string' ? (dados[chave] as string).trim() : '');

  return {
    nome,
    experienceProjetoId: projetoId,
    experiencePersonId: personId,
    agendaRecursoUsuario: texto('agendaRecursoUsuario'),
    repositorioLocal: texto('repositorioLocal'),
    repositorioRemoto: texto('repositorioRemoto'),
  };
}

export function registerRoutesSankhya(app: FastifyInstance, deps: RouteSankhyaDeps): void {
  const { helper, credenciais, clientes } = deps;

  app.get('/api/sankhya/helper', async () => ({ disponivel: await helper.disponivel() }));

  /**
   * Estado das duas credenciais. Nunca devolve senha — so o nome de usuario e se ha
   * valor guardado, espelhando o `EnvVarStatus` do cofre de infra.
   */
  app.get('/api/sankhya/credenciais', async (_request, reply) => {
    try {
      return { credenciais: await Promise.all(SISTEMAS_SANKHYA.map((s) => credenciais.status(s))) };
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  app.post<{ Params: { sistema: string }; Body: { usuario?: unknown; senha?: unknown } }>(
    '/api/sankhya/credenciais/:sistema',
    async (request, reply) => {
      const { sistema } = request.params;
      if (!ehSistemaValido(sistema)) {
        return reply.code(404).send({ error: `sistema "${sistema}" não existe` });
      }

      const { usuario, senha } = request.body ?? {};
      if (typeof usuario !== 'string' || typeof senha !== 'string' || !usuario.trim() || !senha) {
        return reply.code(400).send({ error: 'envie { usuario, senha }' });
      }

      try {
        return await credenciais.gravar(sistema, usuario.trim(), senha);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  app.get('/api/sankhya/navegador', async (_request, reply) => {
    try {
      return await credenciais.statusNavegador();
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  /**
   * Abre a janela do hub na tela de login, e depois lê o cookie de sessão dela.
   *
   * Separado em dois passos de propósito: entre um e outro quem age é o usuário,
   * digitando a senha no navegador. O hub nunca vê a senha — só o cookie que sobra.
   */
  for (const acao of ['abrir', 'capturar'] as const) {
    app.post<{ Params: { sistema: string }; Body: { tela?: unknown; navegador?: unknown } }>(
      `/api/sankhya/navegador/${acao}/:sistema`,
      async (request, reply) => {
        const { sistema } = request.params;
        if (!ehSistemaValido(sistema)) {
          return reply.code(404).send({ error: `sistema "${sistema}" não existe` });
        }

        const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '');

        try {
          if (acao === 'abrir') {
            return await credenciais.abrirNavegador(sistema, {
              tela: texto(request.body?.tela),
              navegador: texto(request.body?.navegador),
            });
          }

          const resultado = await credenciais.capturarSessao(sistema);
          if (!resultado.ok) {
            return reply.code(409).send({ error: resultado.erro ?? 'nenhum cookie capturado' });
          }
          return resultado;
        } catch (err) {
          return responderErroHelper(reply, err);
        }
      },
    );
  }

  app.post('/api/sankhya/navegador/fechar', async (_request, reply) => {
    try {
      return await credenciais.fecharNavegador();
    } catch (err) {
      return responderErroHelper(reply, err);
    }
  });

  /** Traz só os favoritos de um perfil pessoal — nada de senha, cookie ou histórico. */
  app.post<{ Body: { navegador?: unknown; perfil?: unknown } }>(
    '/api/sankhya/navegador/favoritos',
    async (request, reply) => {
      const navegador = String(request.body?.navegador ?? '');
      const perfil = String(request.body?.perfil ?? '');
      if (!navegador || !perfil) {
        return reply.code(400).send({ error: 'envie { navegador, perfil }' });
      }

      try {
        return await credenciais.importarFavoritos(navegador, perfil);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  app.delete<{ Params: { sistema: string } }>(
    '/api/sankhya/credenciais/:sistema',
    async (request, reply) => {
      const { sistema } = request.params;
      if (!ehSistemaValido(sistema)) {
        return reply.code(404).send({ error: `sistema "${sistema}" não existe` });
      }

      try {
        return await credenciais.remover(sistema);
      } catch (err) {
        return responderErroHelper(reply, err);
      }
    },
  );

  app.get('/api/clientes', async () => ({ clientes: clientes.listar() }));

  app.post<{ Body: unknown }>('/api/clientes', async (request, reply) => {
    const entrada = normalizarCliente(request.body);
    if (typeof entrada === 'string') return reply.code(400).send({ error: entrada });
    return reply.code(201).send(clientes.criar(entrada));
  });

  app.get<{ Params: { id: string } }>('/api/clientes/:id', async (request, reply) => {
    const cliente = clientes.obter(Number(request.params.id));
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });
    return cliente;
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/clientes/:id', async (request, reply) => {
    const entrada = normalizarCliente(request.body);
    if (typeof entrada === 'string') return reply.code(400).send({ error: entrada });

    const cliente: Cliente | undefined = clientes.atualizar(Number(request.params.id), entrada);
    if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });
    return cliente;
  });

  app.delete<{ Params: { id: string } }>('/api/clientes/:id', async (request, reply) => {
    if (!clientes.remover(Number(request.params.id))) {
      return reply.code(404).send({ error: 'cliente não encontrado' });
    }
    return { ok: true };
  });
}
