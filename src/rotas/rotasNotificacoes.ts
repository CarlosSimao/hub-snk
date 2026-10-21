import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CentralDeNotificacoes } from '../notificacoes/centralDeNotificacoes.ts';
import { montarEmailDeCobrancaDaAgenda } from '../notificacoes/emailDeCobrancaDaAgenda.ts';
import type { EnviadorDeEmail } from '../notificacoes/enviadorDeEmail.ts';
import { dataHoraLocal } from '../notificacoes/relogio.ts';
import type { RepositorioContatos } from '../repositorio/repositorioContatos.ts';
import type { Notificacao } from '../tipos.ts';
import { esquemaDeSmtp } from './comum/esquemaDeNotificacoes.ts';
import { responderFalhaDoEnvio } from './comum/respostaDoEnvioDeEmail.ts';

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

const TAMANHO_MAXIMO_DA_OBSERVACAO = 2000;

const esquemaDaCobranca = z.object({
  contatoIds: z
    .array(z.string(), { error: 'Escolha os contatos.' })
    .min(1, { error: 'Escolha ao menos um contato.' }),
  observacao: z
    .string()
    .trim()
    .max(TAMANHO_MAXIMO_DA_OBSERVACAO, {
      error: `A observação passa de ${TAMANHO_MAXIMO_DA_OBSERVACAO} caracteres.`,
    })
    .default(''),
});

/* Só o alerta da agenda tem tarefa a cobrar na Experience. */
function ehAlertaDeAgendaSemTarefa(notificacao: Notificacao): boolean {
  return notificacao.origem === 'agenda' && notificacao.tag === 'OS';
}

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

/** Rotas do painel de notificações, do e-mail de teste do SMTP e da cobrança da agenda. */
export function registrarRotasDeNotificacoes(
  servidor: FastifyInstance,
  central: CentralDeNotificacoes,
  enviadorDeEmail: EnviadorDeEmail,
  contatos: RepositorioContatos,
  caminhoDaLogo: string,
): void {
  /** Os e-mails dos contatos escolhidos, ou a mensagem do primeiro que não serve. */
  async function emailsDosContatos(
    contatoIds: string[],
  ): Promise<{ emails: string[] } | { mensagem: string }> {
    const cadastrados = await contatos.listar();
    const emails: string[] = [];
    for (const id of new Set(contatoIds)) {
      const contato = cadastrados.find((item) => item.id === id);
      if (!contato) {
        return { mensagem: 'Contato não encontrado.' };
      }
      if (contato.email === '') {
        return { mensagem: `O contato ${contato.nome} não tem e-mail.` };
      }
      emails.push(contato.email);
    }
    return { emails };
  }

  servidor.get('/api/notificacoes', async () => comContagem(await central.listar()));

  /** Cada notificação nova chega aqui na hora, para o painel mostrar e tocar o som. */
  servidor.get('/api/notificacoes/fluxo', (requisicao, resposta) => {
    resposta.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    // Sem isto os cabeçalhos só saíam com o primeiro dado: quem assina ficava até o
    // primeiro batimento (30 s) sem saber que a conexão abriu.
    resposta.raw.flushHeaders();

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
      return responderFalhaDoEnvio(resposta, erro);
    }

    return { mensagem: `E-mail de teste enviado para ${dados.data.smtp.destinatario}.` };
  });

  /* Cobra a tarefa na Experience: o destinatário do SMTP recebe, os contatos vão em cópia. */
  servidor.post<{ Params: { id: string } }>(
    '/api/notificacoes/:id/cobranca',
    async (requisicao, resposta) => {
      const dados = esquemaDaCobranca.safeParse(requisicao.body);
      if (!dados.success) {
        return responderErroDeValidacao(resposta, dados.error);
      }

      const notificacao = (await central.listar()).find((item) => item.id === requisicao.params.id);
      if (!notificacao) {
        return resposta.status(404).send({ mensagem: 'Notificação não encontrada.' });
      }
      if (!ehAlertaDeAgendaSemTarefa(notificacao)) {
        return resposta
          .status(400)
          .send({ mensagem: 'Só o alerta de agenda sem tarefa tem cobrança por e-mail.' });
      }

      const contatosEscolhidos = await emailsDosContatos(dados.data.contatoIds);
      if ('mensagem' in contatosEscolhidos) {
        return resposta.status(400).send({ mensagem: contatosEscolhidos.mensagem });
      }

      try {
        await enviadorDeEmail.enviarPeloSmtpGravado(
          montarEmailDeCobrancaDaAgenda({
            titulo: notificacao.titulo,
            mensagem: notificacao.mensagem,
            geradoEm: dataHoraLocal(new Date(notificacao.criadaEm)),
            observacao: dados.data.observacao,
            copia: contatosEscolhidos.emails,
            caminhoDaLogo,
          }),
        );
      } catch (erro) {
        return responderFalhaDoEnvio(resposta, erro);
      }

      return { mensagem: `Cobrança enviada para ${contatosEscolhidos.emails.join(', ')}.` };
    },
  );
}
