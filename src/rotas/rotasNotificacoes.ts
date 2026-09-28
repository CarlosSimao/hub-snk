import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CentralDeNotificacoes } from '../notificacoes/centralDeNotificacoes.ts';
import { SmtpNaoConfiguradoError, type EnviadorDeEmail } from '../notificacoes/enviadorDeEmail.ts';
import type { Notificacao } from '../tipos.ts';
import { esquemaDeSmtp } from './esquemaDeNotificacoes.ts';

/*
 * Comentário SSE periódico: sem tráfego, algum intermediário (antivírus com proxy local,
 * por exemplo) pode derrubar a conexão parada, e o painel só perceberia na próxima.
 */
const INTERVALO_DO_BATIMENTO_DO_FLUXO_MS = 30_000;

const esquemaDeLeitura = z.object({
  /* Ausente marca todas: é o "marcar todas como lidas" do painel. */
  ids: z.array(z.string()).optional(),
});

const esquemaDoEmailDeTeste = z.object({ smtp: esquemaDeSmtp });

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.issues[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

function comContagem(notificacoes: Notificacao[]) {
  return {
    notificacoes,
    naoLidas: notificacoes.filter((notificacao) => !notificacao.lida).length,
  };
}

/** Rotas do painel de notificações e do e-mail de teste do SMTP. */
export function registrarRotasDeNotificacoes(
  servidor: FastifyInstance,
  central: CentralDeNotificacoes,
  enviadorDeEmail: EnviadorDeEmail,
): void {
  servidor.get('/api/notificacoes', async () => comContagem(await central.listar()));

  /** Cada notificação nova chega aqui na hora, para o painel mostrar e tocar o som. */
  servidor.get('/api/notificacoes/fluxo', (requisicao, resposta) => {
    resposta.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });

    const cancelarAssinatura = central.assinar((notificacao) => {
      resposta.raw.write(`event: notificacao\ndata: ${JSON.stringify(notificacao)}\n\n`);
    });
    const batimento = setInterval(
      () => resposta.raw.write(': batimento\n\n'),
      INTERVALO_DO_BATIMENTO_DO_FLUXO_MS,
    );

    requisicao.raw.on('close', () => {
      clearInterval(batimento);
      cancelarAssinatura();
    });
    resposta.hijack();
  });

  servidor.post('/api/notificacoes/lidas', async (requisicao, resposta) => {
    const dados = esquemaDeLeitura.safeParse(requisicao.body ?? {});
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    return comContagem(await central.marcarComoLidas(dados.data.ids));
  });

  servidor.delete('/api/notificacoes', async (_requisicao, resposta) => {
    await central.limpar();
    return resposta.status(204).send();
  });

  /* Usa o SMTP do formulário, ainda não gravado: testar antes de salvar é o ponto. */
  servidor.post('/api/notificacoes/email-de-teste', async (requisicao, resposta) => {
    const dados = esquemaDoEmailDeTeste.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      await enviadorDeEmail.enviar(dados.data.smtp, {
        assunto: '[HUB SNK] E-mail de teste',
        texto: 'Se este e-mail chegou, o SMTP das notificações do HUB SNK está funcionando.',
      });
    } catch (erro) {
      if (erro instanceof SmtpNaoConfiguradoError) {
        return resposta.status(400).send({ mensagem: erro.message });
      }
      const motivo = erro instanceof Error ? erro.message : String(erro);
      return resposta.status(502).send({ mensagem: `Falha no envio pelo SMTP: ${motivo}` });
    }

    return { mensagem: `E-mail de teste enviado para ${dados.data.smtp.destinatario}.` };
  });
}
