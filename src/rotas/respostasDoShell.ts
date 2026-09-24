import type { FastifyReply } from 'fastify';
import { PonteDoDesktopError, PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';

/**
 * Traduz as falhas da ponte com o shell desktop para a resposta da API.
 *
 * Shell fora do ar é situação NORMAL (quem roda só `npm run dev` não tem shell),
 * não defeito do HUB SNK: vira 503 com a mensagem original, que é o que a tela
 * mostra. O campo `helperIndisponivel` mantém o nome que a tela já lê.
 */
export function responderErroDoShell(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof PonteDoDesktopIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message, helperIndisponivel: true });
  }
  if (erro instanceof PonteDoDesktopError) {
    return resposta.status(erro.status).send({ mensagem: erro.message });
  }
  throw erro;
}
