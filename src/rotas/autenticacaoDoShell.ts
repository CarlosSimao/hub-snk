import type { FastifyReply, FastifyRequest } from 'fastify';
import { lerTokenDoDesktop } from '../sankhya/ponteDoDesktop.ts';

/**
 * Confere se a requisição veio do shell desktop, e não da tela.
 *
 * As rotas que só o shell chama (sessão empurrada, encerramento) exigem o token
 * dele, um arquivo local que o navegador não alcança. A proteção de origem não
 * basta: ela aceita requisição sem `Origin`, e qualquer processo da máquina
 * poderia, por exemplo, derrubar o backend.
 *
 * Responde a recusa por conta própria; quem chama só precisa encerrar o handler
 * quando o retorno é `false`.
 */
export function requisicaoVeioDoShell(
  requisicao: FastifyRequest,
  resposta: FastifyReply,
  arquivoTokenDoDesktop: string,
): boolean {
  let esperado: string;
  try {
    esperado = lerTokenDoDesktop(arquivoTokenDoDesktop);
  } catch (erro) {
    resposta.status(503).send({ mensagem: (erro as Error).message });
    return false;
  }

  if (requisicao.headers['x-hub-token'] !== esperado) {
    resposta.status(401).send({ mensagem: 'Token do shell desktop inválido.' });
    return false;
  }

  return true;
}
