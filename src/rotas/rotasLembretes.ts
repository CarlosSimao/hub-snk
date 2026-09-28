import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  ExpressaoCronInvalidaError,
  proximasOcorrencias,
  proximoDisparo,
  validarExpressaoCron,
} from '../notificacoes/disparoDeLembretes.ts';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import {
  LembreteNaoEncontradoError,
  type DadosDeLembrete,
  type RepositorioLembretes,
} from '../repositorio/repositorioLembretes.ts';
import { TIPOS_DE_LEMBRETE, type Lembrete } from '../tipos.ts';

const TAMANHO_MAXIMO_DO_TEXTO = 1000;
const TAMANHO_MAXIMO_DA_EXPRESSAO = 120;
const OCORRENCIAS_NA_PREVIA = 3;

const esquemaDeLembrete = z
  .object({
    texto: z
      .string({ error: 'Informe o texto do lembrete.' })
      .trim()
      .min(1, 'Informe o texto do lembrete.')
      .max(
        TAMANHO_MAXIMO_DO_TEXTO,
        `O lembrete deve ter no máximo ${TAMANHO_MAXIMO_DO_TEXTO} caracteres.`,
      ),
    tipo: z.enum(TIPOS_DE_LEMBRETE, { error: 'Escolha se o lembrete é único ou recorrente.' }),
    /* A tela manda ISO 8601 com fuso; vazio é aceito aqui e cobrado abaixo, só no único. */
    dataHora: z
      .string()
      .refine((valor) => valor === '' || !Number.isNaN(Date.parse(valor)), 'Data e hora inválidas.')
      .default(''),
    expressaoCron: z.string().trim().max(TAMANHO_MAXIMO_DA_EXPRESSAO).default(''),
    clienteId: z.string().min(1).nullable().default(null),
    projetoId: z.string().min(1).nullable().default(null),
    enviarEmail: z.boolean().default(false),
    ativo: z.boolean().default(true),
  })
  .superRefine((lembrete, contexto) => {
    if (lembrete.tipo === 'unico' && lembrete.dataHora === '') {
      contexto.addIssue({ code: 'custom', message: 'Informe a data e a hora do lembrete.' });
    }
    if (lembrete.tipo === 'recorrente' && lembrete.expressaoCron === '') {
      contexto.addIssue({ code: 'custom', message: 'Informe a expressão da recorrência.' });
    }
    if (lembrete.projetoId !== null && lembrete.clienteId === null) {
      contexto.addIssue({ code: 'custom', message: 'Escolha o cliente do projeto.' });
    }
  });

const esquemaDaPrevia = z.object({
  expressao: z.string({ error: 'Informe a expressão.' }).trim().min(1, 'Informe a expressão.'),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.issues[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

/** A tela mostra quando cada um dispara; a regra fica só no servidor. */
function comProximoDisparo(lembrete: Lembrete, agora: Date) {
  let proximo: Date | null = null;
  try {
    proximo = proximoDisparo(lembrete, agora);
  } catch {
    // Cron editado à mão no arquivo: o lembrete aparece, só sem previsão.
  }
  return { ...lembrete, proximoDisparo: proximo?.toISOString() ?? null };
}

/**
 * Registra as rotas do cadastro de lembretes. O disparo não passa por aqui: é do
 * `AgendadorDeLembretes`, que lê o mesmo repositório.
 */
export function registrarRotasDeLembretes(
  servidor: FastifyInstance,
  repositorio: RepositorioLembretes,
  clientes: RepositorioClientes,
): void {
  /** Cliente e projeto precisam existir, e o projeto precisa ser daquele cliente. */
  async function validarVinculo(dados: DadosDeLembrete): Promise<string | null> {
    if (dados.clienteId === null) {
      return null;
    }

    const cliente = await clientes.buscarPorId(dados.clienteId);
    if (!cliente) {
      return 'Cliente não encontrado.';
    }
    if (dados.projetoId !== null && !cliente.projetos.some((p) => p.id === dados.projetoId)) {
      return 'Projeto não encontrado neste cliente.';
    }
    return null;
  }

  /** Validação que depende de outro cadastro ou do `croner`, fora do alcance do zod. */
  async function validarLembrete(dados: DadosDeLembrete): Promise<string | null> {
    if (dados.tipo === 'recorrente') {
      try {
        validarExpressaoCron(dados.expressaoCron);
      } catch (erro) {
        if (erro instanceof ExpressaoCronInvalidaError) return erro.message;
        throw erro;
      }
    }
    return validarVinculo(dados);
  }

  /** O corpo validado, ou a mensagem do primeiro problema encontrado. */
  async function lerCorpo(
    corpo: unknown,
  ): Promise<{ dados: DadosDeLembrete } | { mensagem: string }> {
    const dados = esquemaDeLembrete.safeParse(corpo);
    if (!dados.success) {
      return { mensagem: dados.error.issues[0]?.message ?? 'Dados inválidos.' };
    }

    const mensagem = await validarLembrete(dados.data);
    return mensagem ? { mensagem } : { dados: dados.data };
  }

  function responderNaoEncontrado(resposta: FastifyReply, erro: unknown): FastifyReply {
    if (erro instanceof LembreteNaoEncontradoError) {
      return resposta.status(404).send({ mensagem: 'Lembrete não encontrado.' });
    }
    throw erro;
  }

  servidor.get('/api/lembretes', async () => {
    const agora = new Date();
    const lembretes = await repositorio.listar();
    return { lembretes: lembretes.map((lembrete) => comProximoDisparo(lembrete, agora)) };
  });

  /** As próximas ocorrências de uma expressão, para o formulário mostrar antes de salvar. */
  servidor.get('/api/lembretes/previa', async (requisicao, resposta) => {
    const consulta = esquemaDaPrevia.safeParse(requisicao.query);
    if (!consulta.success) {
      return responderErroDeValidacao(resposta, consulta.error);
    }

    try {
      const ocorrencias = proximasOcorrencias(
        consulta.data.expressao,
        new Date(),
        OCORRENCIAS_NA_PREVIA,
      );
      return { ocorrencias: ocorrencias.map((ocorrencia) => ocorrencia.toISOString()) };
    } catch (erro) {
      if (erro instanceof ExpressaoCronInvalidaError) {
        return resposta.status(400).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });

  servidor.post('/api/lembretes', async (requisicao, resposta) => {
    const corpo = await lerCorpo(requisicao.body);
    if ('mensagem' in corpo) {
      return resposta.status(400).send(corpo);
    }

    const lembrete = await repositorio.criar(corpo.dados);
    return resposta.status(201).send(comProximoDisparo(lembrete, new Date()));
  });

  servidor.put<{ Params: { id: string } }>('/api/lembretes/:id', async (requisicao, resposta) => {
    const corpo = await lerCorpo(requisicao.body);
    if ('mensagem' in corpo) {
      return resposta.status(400).send(corpo);
    }

    try {
      const lembrete = await repositorio.atualizar(requisicao.params.id, corpo.dados);
      return comProximoDisparo(lembrete, new Date());
    } catch (erro) {
      return responderNaoEncontrado(resposta, erro);
    }
  });

  servidor.delete<{ Params: { id: string } }>(
    '/api/lembretes/:id',
    async (requisicao, resposta) => {
      try {
        await repositorio.remover(requisicao.params.id);
      } catch (erro) {
        return responderNaoEncontrado(resposta, erro);
      }
      return resposta.status(204).send();
    },
  );
}
