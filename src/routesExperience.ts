/**
 * Agenda de um cliente, vinda do Sankhya Experience.
 *
 * O painel manda o id do cliente e o mês; quem traduz isso para `experienceProjetoId` e
 * `experiencePersonId` é o backend — o navegador não precisa saber esses números, e
 * mandá-los pela URL deixaria a tela livre para consultar projeto de qualquer um.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { HelperError, HelperIndisponivelError } from './sankhya/helper.ts';
import { SessaoExpiradaError, type Experience } from './sankhya/experience.ts';
import type { Clientes } from './sankhya/clientes.ts';

export interface RouteExperienceDeps {
  experience: Experience;
  clientes: Clientes;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof SessaoExpiradaError) {
    return reply.code(409).send({ error: err.message, sessaoExpirada: true });
  }
  if (err instanceof HelperIndisponivelError) {
    return reply.code(503).send({ error: err.message, helperIndisponivel: true });
  }
  if (err instanceof HelperError) {
    return reply.code(err.status).send({ error: err.message });
  }
  throw err;
}

/** Primeiro e último dia do mês `YYYY-MM`, em `YYYY-MM-DD`. */
function limitesDoMes(mes: string): { de: string; ate: string } | null {
  const partes = /^(\d{4})-(\d{2})$/.exec(mes);
  if (!partes) return null;

  const ano = Number(partes[1]);
  const numeroMes = Number(partes[2]);
  if (numeroMes < 1 || numeroMes > 12) return null;

  // Dia 0 do mês seguinte é o último dia deste — evita tabela de dias e ano bissexto.
  const ultimo = new Date(Date.UTC(ano, numeroMes, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

export function registerRoutesExperience(app: FastifyInstance, deps: RouteExperienceDeps): void {
  const { experience, clientes } = deps;

  app.get<{ Querystring: { clienteId?: string; mes?: string } }>(
    '/api/experience/agenda',
    async (request, reply) => {
      const cliente = clientes.obter(Number(request.query.clienteId));
      if (!cliente) return reply.code(404).send({ error: 'cliente não encontrado' });

      if (cliente.experienceProjetoId === null || cliente.experiencePersonId === null) {
        return reply.code(400).send({
          error: `"${cliente.nome}" ainda não tem o ID do projeto e o person_id preenchidos no cadastro`,
          cadastroIncompleto: true,
        });
      }

      const limites = limitesDoMes(request.query.mes ?? '');
      if (!limites) return reply.code(400).send({ error: 'informe ?mes=YYYY-MM' });

      try {
        // Em paralelo: são dois endpoints independentes e a tela precisa dos dois para
        // saber quais tarefas do dia ainda não viraram OS.
        const [tarefas, ordens] = await Promise.all([
          experience.tarefas(cliente.experienceProjetoId, cliente.experiencePersonId),
          experience.ordens(
            cliente.experienceProjetoId,
            cliente.experiencePersonId,
            limites.de,
            limites.ate,
          ),
        ]);

        return { tarefas, ordens };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );
}
