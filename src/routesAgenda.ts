/**
 * Agenda de Recursos do Sankhya ERP.
 *
 * A carga é por colagem manual do JSON capturado no DevTools. Não é preguiça: a ACL do
 * `service.sbr` nega a chamada direta para este usuário (ver `Sankhya-agenda.md` seção
 * 1.4), então não há como o hub buscar sozinho enquanto o admin não liberar o serviço.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { PayloadInvalidoError, parsearAgenda } from './sankhya/agendaParser.ts';
import type { AgendaRecursos } from './sankhya/agenda.ts';
import { HelperError, HelperIndisponivelError, type HubHelper } from './sankhya/helper.ts';

export interface RouteAgendaDeps {
  agenda: AgendaRecursos;
  helper: HubHelper;
}

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, que é o formato que o serviço do ERP espera. */
function paraFormatoSankhya(data: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(data ?? '');
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : '';
}

/**
 * Helper fora do ar ou guia sem sessão é situação normal, não defeito do hub — vira a
 * mensagem que a tela mostra em vez de um 500.
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

/** Limite do corpo colado. O snapshot de referência tem 244 KB; 8 MB é folga larga. */
const MAX_BYTES = 8 * 1024 * 1024;

export function registerRoutesAgenda(app: FastifyInstance, deps: RouteAgendaDeps): void {
  const { agenda, helper } = deps;

  /**
   * Busca a agenda direto do Sankhya, sem colagem manual.
   *
   * Funciona porque a chamada sai de DENTRO da guia autenticada do navegador do hub: a
   * ACL do `service.sbr` nega o acesso de fora, mas a sessão de tela passa. É o mesmo
   * motivo pelo qual a automação de UI funciona.
   */
  app.post<{ Body: { de?: unknown; ate?: unknown } }>(
    '/api/agenda/buscar',
    async (request, reply) => {
      const de = paraFormatoSankhya(String(request.body?.de ?? ''));
      const ate = paraFormatoSankhya(String(request.body?.ate ?? ''));
      if (!de || !ate) {
        return reply.code(400).send({ error: 'informe { de, ate } no formato YYYY-MM-DD' });
      }

      let conteudo: string;
      try {
        const resposta = await helper.requisitar<{ conteudo: string }>(
          '/browser/agenda',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ de, ate }),
          },
          // Vai muito além do padrão: a chamada atravessa o helper, o navegador e o
          // Sankhya, e um período de meses traz centenas de eventos.
          { timeoutMs: 120_000 },
        );
        conteudo = resposta.conteudo;
      } catch (err) {
        return responderErroHelper(reply, err);
      }

      try {
        return agenda.importar(parsearAgenda(JSON.parse(conteudo)));
      } catch (err) {
        if (err instanceof PayloadInvalidoError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get('/api/agenda', async () => agenda.estado());

  app.get('/api/agenda/recursos', async () => ({ recursos: agenda.recursos() }));

  /**
   * Parceiros que aparecem na agenda — a lista de onde o cadastro tira o `agendaCodparc`.
   *
   * Sem `?usuario=`, traz os de todos os recursos; com, só os do consultor.
   */
  app.get<{ Querystring: { usuario?: string } }>('/api/agenda/parceiros', async (request) => ({
    parceiros: agenda.parceiros(request.query.usuario ?? ''),
  }));

  /** Dias de atuação num cliente: todo o passado e o futuro que o snapshot contém. */
  app.get<{ Querystring: { codparc?: string; usuario?: string } }>(
    '/api/agenda/atuacao',
    async (request, reply) => {
      const codparc = Number(request.query.codparc);
      if (!Number.isInteger(codparc) || codparc <= 0) {
        return reply.code(400).send({ error: 'informe ?codparc=<número>' });
      }
      return agenda.atuacao(codparc, request.query.usuario ?? '');
    },
  );

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
