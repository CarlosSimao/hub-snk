import type { FastifyReply } from 'fastify';
import { SmtpNaoConfiguradoError } from '../../notificacoes/enviadorDeEmail.ts';

/**
 * Traduz a falha do envio pelo SMTP para a resposta da API. SMTP sem configurar leva o
 * `configuracaoPendente`, para a tela oferecer o atalho até Configurações › SMTP.
 */
export function responderFalhaDoEnvio(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof SmtpNaoConfiguradoError) {
    return resposta.status(400).send({ mensagem: erro.message, configuracaoPendente: 'smtp' });
  }
  const motivo = erro instanceof Error ? erro.message : String(erro);
  return resposta.status(502).send({ mensagem: `Falha no envio pelo SMTP: ${motivo}` });
}
