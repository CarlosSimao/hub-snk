/**
 * Agenda de Recursos do Sankhya ERP.
 *
 * A carga é por colagem manual do JSON capturado no DevTools. Não é preguiça: a ACL do
 * `service.sbr` nega a chamada direta para este usuário (ver `Sankhya-agenda.md` seção
 * 1.4), então não há como o hub buscar sozinho enquanto o admin não liberar o serviço.
 */
import type { FastifyInstance } from 'fastify';
import { PayloadInvalidoError, parsearAgenda } from './sankhya/agendaParser.ts';
import type { AgendaRecursos } from './sankhya/agenda.ts';

export interface RouteAgendaDeps {
  agenda: AgendaRecursos;
}

/** Limite do corpo colado. O snapshot de referência tem 244 KB; 8 MB é folga larga. */
const MAX_BYTES = 8 * 1024 * 1024;

export function registerRoutesAgenda(app: FastifyInstance, deps: RouteAgendaDeps): void {
  const { agenda } = deps;

  app.get('/api/agenda', async () => agenda.estado());

  app.get('/api/agenda/recursos', async () => ({ recursos: agenda.recursos() }));

  app.get<{ Querystring: { de?: string; ate?: string; usuario?: string } }>(
    '/api/agenda/eventos',
    async (request, reply) => {
      const { de, ate } = request.query;
      if (!de || !ate) {
        return reply.code(400).send({ error: 'informe ?de= e ?ate= no formato YYYY-MM-DD' });
      }

      // A janela chega como dia e vira instante aqui: quem consulta pensa em datas, e a
      // comparação no banco é de texto com hora.
      return {
        eventos: agenda.eventos(`${de} 00:00:00`, `${ate} 23:59:59`, request.query.usuario ?? ''),
      };
    },
  );

  /**
   * Recebe o JSON colado da tela. `conteudo` é texto, não objeto: o usuário cola o que
   * copiou do DevTools, e um JSON malformado tem que virar mensagem de erro legível em
   * vez de um 400 genérico do parser de corpo do Fastify.
   */
  app.post<{ Body: { conteudo?: unknown } }>('/api/agenda/importar', async (request, reply) => {
    const conteudo = request.body?.conteudo;
    if (typeof conteudo !== 'string' || !conteudo.trim()) {
      return reply.code(400).send({ error: 'cole o JSON capturado no campo' });
    }
    if (conteudo.length > MAX_BYTES) {
      return reply.code(413).send({ error: 'o conteúdo colado é grande demais' });
    }

    let bruto: unknown;
    try {
      bruto = JSON.parse(conteudo);
    } catch (err) {
      return reply.code(400).send({
        error: `o texto colado não é um JSON válido: ${(err as Error).message}`,
      });
    }

    try {
      return agenda.importar(parsearAgenda(bruto));
    } catch (err) {
      if (err instanceof PayloadInvalidoError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
