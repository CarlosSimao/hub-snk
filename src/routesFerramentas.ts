/**
 * `POST /api/ferramentas/abrir` — abre a pasta de um repositorio no terminal, no
 * IntelliJ IDEA ou numa sessao nova do Claude Code. Ver `src/ferramentas.ts`.
 *
 * Nao existe rota de leitura ("o que esta instalado?") de proposito: descobrir isso
 * significa varrer PATH e pastas de instalacao, e fazer essa varredura a cada abertura
 * da tela do cliente sairia caro para responder algo que so' importa no clique. Quando a
 * ferramenta nao esta' instalada, a resposta do clique e' que diz — com o que procurar.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  FerramentaIndisponivelError,
  PedidoFerramentaError,
  type Ferramentas,
} from './ferramentas.ts';

export interface RouteFerramentasDeps {
  ferramentas: Ferramentas;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  // Pasta que nao existe ou tipo desconhecido: erro de quem pediu.
  if (err instanceof PedidoFerramentaError) return reply.code(400).send({ error: err.message });
  // A maquina nao tem a ferramenta. 409 e nao 404: a rota existe, o ambiente e' que nao
  // atende — e a mensagem traz onde foi procurado.
  if (err instanceof FerramentaIndisponivelError) return reply.code(409).send({ error: err.message });
  throw err;
}

export function registerRoutesFerramentas(app: FastifyInstance, deps: RouteFerramentasDeps): void {
  app.post<{ Body: { ferramenta?: unknown; caminho?: unknown } }>(
    '/api/ferramentas/abrir',
    async (request, reply) => {
      const corpo = request.body ?? {};
      const ferramenta = typeof corpo.ferramenta === 'string' ? corpo.ferramenta : '';
      const caminho = typeof corpo.caminho === 'string' ? corpo.caminho : '';

      try {
        return deps.ferramentas.abrir(ferramenta, caminho);
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );
}
