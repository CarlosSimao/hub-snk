/**
 * Rotas das skills do Claude Code — ver `src/skills.ts`.
 *
 * O chat e' um fluxo de eventos, entao a leitura e' SSE: o turno da skill demora minutos
 * e produz dezenas de eventos (texto, ferramenta executada, resultado), e fazer a tela
 * perguntar de novo a cada segundo transformaria isso em polling de um stream que ja'
 * existe. O mesmo padrao que o painel ja' usa para o monitor.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PedidoSkillError, type Skills } from './skills.ts';

export interface RouteSkillsDeps {
  skills: Skills;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof PedidoSkillError) return reply.code(400).send({ error: err.message });
  throw err;
}

function texto(corpo: Record<string, unknown> | undefined, chave: string): string {
  const valor = (corpo ?? {})[chave];
  return typeof valor === 'string' ? valor : '';
}

export function registerRoutesSkills(app: FastifyInstance, deps: RouteSkillsDeps): void {
  const { skills } = deps;

  /** O que existe nesta máquina. Lido do disco a cada chamada: `/plugin update` muda a
   *  versão instalada sem o hub saber, e uma lista velha ofereceria skill que sumiu. */
  app.get('/api/skills', async () => ({ skills: skills.listar() }));

  app.get('/api/skills/sessoes', async () => ({ sessoes: skills.sessoes() }));

  app.post<{ Body: Record<string, unknown> }>('/api/skills/sessoes', async (request, reply) => {
    try {
      return skills.iniciar({
        skill: texto(request.body, 'skill'),
        pasta: texto(request.body, 'pasta'),
        modelo: texto(request.body, 'modelo'),
        esforco: texto(request.body, 'esforco'),
        mensagem: texto(request.body, 'mensagem') || `/${texto(request.body, 'skill')}`,
      });
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/skills/sessoes/:id/mensagem',
    async (request, reply) => {
      try {
        return skills.enviar(request.params.id, texto(request.body, 'mensagem'));
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.post<{ Params: { id: string } }>('/api/skills/sessoes/:id/encerrar', async (request, reply) => {
    try {
      return skills.encerrar(request.params.id);
    } catch (err) {
      return responderErro(reply, err);
    }
  });

  /**
   * Stream da conversa. `desde` traz o que já passou antes de a tela assinar — sem isso,
   * recarregar a página no meio de um turno perderia tudo que chegou até ali.
   */
  app.get<{ Params: { id: string }; Querystring: { desde?: string } }>(
    '/api/skills/sessoes/:id/eventos',
    async (request, reply) => {
      const { id } = request.params;
      let historico;
      try {
        historico = skills.historico(id, Number(request.query.desde ?? 0) || 0);
      } catch (err) {
        return responderErro(reply, err);
      }

      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const escrever = (evento: unknown) => reply.raw.write(`data: ${JSON.stringify(evento)}\n\n`);
      for (const evento of historico) escrever(evento);

      const cancelar = skills.acompanhar(id, escrever);
      request.raw.on('close', cancelar);

      // A resposta fica aberta: o Fastify não deve considerar a rota terminada.
      return reply;
    },
  );
}
