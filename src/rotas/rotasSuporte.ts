import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  RelatoRecusadoError,
  TIPOS_DE_RELATO,
  type ServicoDeRelatos,
} from '../suporte/servicoDeRelatos.ts';

const TAMANHO_MAXIMO_DA_MENSAGEM = 5000;
const TAMANHO_MAXIMO_DO_EMAIL = 200;

const esquemaDeEmail = z.email();

const esquemaDeRelato = z.object({
  tipo: z.enum(TIPOS_DE_RELATO, { error: 'Escolha o tipo do relato.' }),
  mensagem: z
    .string({ error: 'Descreva o que aconteceu.' })
    .trim()
    .min(1, 'Descreva o que aconteceu.')
    .max(
      TAMANHO_MAXIMO_DA_MENSAGEM,
      `A descrição deve ter no máximo ${TAMANHO_MAXIMO_DA_MENSAGEM} caracteres.`,
    ),
  /* Opcional: vazio é aceito, mas o que vier preenchido precisa ser um e-mail. */
  email: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_EMAIL,
      `O e-mail deve ter no máximo ${TAMANHO_MAXIMO_DO_EMAIL} caracteres.`,
    )
    .refine((valor) => valor === '' || esquemaDeEmail.safeParse(valor).success, 'E-mail inválido.')
    .default(''),
  incluirLog: z.boolean().default(true),
});

/**
 * Relato de problema e sugestões, enviado ao suporte de dentro do aplicativo.
 *
 * É a única rota do HUB SNK que manda dado do usuário para fora da máquina, e só o faz
 * quando ele confirma o envio na tela. A prévia existe para ele ver, antes de enviar,
 * exatamente o que seguiria junto. Nome, empresa e time (Configurações) são obrigatórios:
 * sem os três, a rota responde 400 apontando o que falta.
 */
export function registrarRotasDeSuporte(
  servidor: FastifyInstance,
  relatos: ServicoDeRelatos,
): void {
  servidor.get('/api/suporte/previa', async () => relatos.previa());

  servidor.post('/api/suporte/relatos', async (requisicao, resposta) => {
    const dados = esquemaDeRelato.safeParse(requisicao.body);
    if (!dados.success) {
      const primeiraMensagem = dados.error.issues[0]?.message ?? 'Dados inválidos.';
      return resposta.status(400).send({ mensagem: primeiraMensagem });
    }

    const pendentes = await relatos.camposDeIdentificacaoPendentes();
    if (pendentes.length > 0) {
      return resposta.status(400).send({
        mensagem: `Preencha em Configurações antes de enviar: ${pendentes.join(', ')}.`,
      });
    }

    try {
      const situacao = await relatos.relatar({
        tipo: dados.data.tipo,
        mensagem: dados.data.mensagem,
        incluirLog: dados.data.incluirLog,
        ...(dados.data.email ? { email: dados.data.email } : {}),
      });
      return resposta.status(situacao === 'enviado' ? 201 : 202).send({ situacao });
    } catch (erro) {
      if (erro instanceof RelatoRecusadoError) {
        return resposta.status(422).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });
}
