import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import {
  ContatoNaoEncontradoError,
  type DadosDeContato,
  type RepositorioContatos,
} from '../repositorio/repositorioContatos.ts';

const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DO_TELEFONE = 40;
const TAMANHO_MAXIMO_DO_EMAIL = 254;
const TAMANHO_MAXIMO_DO_CARGO = 120;

const esquemaDeEmail = z.email();

const esquemaDeContato = z.object({
  nome: z
    .string({ error: 'Informe o nome do contato.' })
    .trim()
    .min(1, 'Informe o nome do contato.')
    .max(TAMANHO_MAXIMO_DO_NOME, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`),
  telefone: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_TELEFONE,
      `O telefone deve ter no máximo ${TAMANHO_MAXIMO_DO_TELEFONE} caracteres.`,
    )
    .default(''),
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
  cargo: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_CARGO,
      `O cargo deve ter no máximo ${TAMANHO_MAXIMO_DO_CARGO} caracteres.`,
    )
    .default(''),
  clienteId: z.string().min(1).nullable().default(null),
});

/** Registra as rotas do cadastro de contatos. */
export function registrarRotasDeContatos(
  servidor: FastifyInstance,
  repositorio: RepositorioContatos,
  clientes: RepositorioClientes,
): void {
  /** O corpo validado, ou a mensagem do primeiro problema encontrado. */
  async function lerCorpo(
    corpo: unknown,
  ): Promise<{ dados: DadosDeContato } | { mensagem: string }> {
    const dados = esquemaDeContato.safeParse(corpo);
    if (!dados.success) {
      return { mensagem: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
    }

    const { clienteId } = dados.data;
    if (clienteId !== null && !(await clientes.buscarPorId(clienteId))) {
      return { mensagem: 'Cliente não encontrado.' };
    }
    return { dados: dados.data };
  }

  function responderNaoEncontrado(resposta: FastifyReply, erro: unknown): FastifyReply {
    if (erro instanceof ContatoNaoEncontradoError) {
      return resposta.status(404).send({ mensagem: 'Contato não encontrado.' });
    }
    throw erro;
  }

  servidor.get('/api/contatos', async () => ({ contatos: await repositorio.listar() }));

  servidor.post('/api/contatos', async (requisicao, resposta) => {
    const corpo = await lerCorpo(requisicao.body);
    if ('mensagem' in corpo) {
      return resposta.status(400).send(corpo);
    }

    return resposta.status(201).send(await repositorio.criar(corpo.dados));
  });

  servidor.put<{ Params: { id: string } }>('/api/contatos/:id', async (requisicao, resposta) => {
    const corpo = await lerCorpo(requisicao.body);
    if ('mensagem' in corpo) {
      return resposta.status(400).send(corpo);
    }

    try {
      return await repositorio.atualizar(requisicao.params.id, corpo.dados);
    } catch (erro) {
      return responderNaoEncontrado(resposta, erro);
    }
  });

  servidor.delete<{ Params: { id: string } }>('/api/contatos/:id', async (requisicao, resposta) => {
    try {
      await repositorio.remover(requisicao.params.id);
    } catch (erro) {
      return responderNaoEncontrado(resposta, erro);
    }
    return resposta.status(204).send();
  });
}
