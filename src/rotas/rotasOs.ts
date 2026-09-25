import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { Credenciais } from '../sankhya/credenciais.ts';
import { SessaoExpiradaError, type Experience } from '../sankhya/experience.ts';
import {
  fapsDoParceiro,
  parsearNegociacoes,
  PayloadDeNegociacoesInvalidoError,
} from '../sankhya/negociacoes.ts';
import { responderErroDoShell } from './respostasDoShell.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const esquemaDeConsulta = z.object({
  de: z.string().regex(ISO, 'Informe "de" no formato YYYY-MM-DD.'),
  ate: z.string().regex(ISO, 'Informe "ate" no formato YYYY-MM-DD.'),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.issues[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

/**
 * Rotas da aba OS: consulta ao vivo no Sankhya Experience, sem persistência — cada troca
 * de mês ou clique em "atualizar" busca de novo. O `personId` vem da configuração geral
 * (`experiencePersonId`), a mesma conta em qualquer projeto.
 *
 * A aba OS geral usa `Experience.minhasOrdens`, que traz as OS do usuário em TODOS os
 * projetos de uma vez. A aba OS do cadastro do cliente usa `Experience.ordensDoCliente`,
 * que filtra pelo `implantation_id` de verdade — descoberto a partir do(s) FAP(s) do
 * parceiro do ERP vinculado ao cliente (`consultarNegociacoesDoParceiro`, mesma fonte que
 * `/api/agenda/situacao-do-dia` usa). Por isso, ao contrário da geral, ela depende da aba
 * ERP aberta e logada, com a tela Agenda de Recursos carregada.
 */
export function registrarRotasDeOs(
  servidor: FastifyInstance,
  experience: Experience,
  repositorioDeClientes: RepositorioClientes,
  repositorioDeConfiguracao: RepositorioConfiguracao,
  credenciais: Credenciais,
): void {
  async function experiencePersonIdOuErro(resposta: FastifyReply): Promise<number | null> {
    const { experiencePersonId } = await repositorioDeConfiguracao.ler();
    if (experiencePersonId === '') {
      resposta.status(400).send({
        mensagem: 'Capture a sessão do Sankhya Experience em Credenciais Sankhya.',
        codigoDeUsuarioAusente: true,
      });
      return null;
    }
    return Number(experiencePersonId);
  }

  function responderErroDeOrdens(resposta: FastifyReply, erro: unknown): FastifyReply {
    if (erro instanceof SessaoExpiradaError) {
      return resposta.status(409).send({ mensagem: erro.message, sessaoExpirada: true });
    }
    return responderErroDoShell(resposta, erro);
  }

  /** Os FAPs de um parceiro (`consultarNegociacoesDoParceiro`, tipo 2) — pode ter mais de um codparc vinculado. */
  async function fapsDoCliente(agendaCodparcs: number[]): Promise<number[]> {
    const faps = new Set<number>();
    for (const codparc of agendaCodparcs) {
      const negociacoesResultado = await credenciais.consultarNegociacoesDoParceiro(codparc);
      const negociacoes = parsearNegociacoes(JSON.parse(negociacoesResultado.conteudo));
      for (const fap of fapsDoParceiro(negociacoes)) {
        faps.add(fap);
      }
    }
    return [...faps];
  }

  /** Todas as OS do usuário logado no período, em todos os projetos. */
  servidor.post('/api/os/consultar', async (requisicao, resposta) => {
    const dados = esquemaDeConsulta.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    const personId = await experiencePersonIdOuErro(resposta);
    if (personId === null) return resposta;

    try {
      const itens = await experience.minhasOrdens(personId, dados.data.de, dados.data.ate);
      return { itens, buscadoEm: new Date().toISOString() };
    } catch (erro) {
      return responderErroDeOrdens(resposta, erro);
    }
  });

  /** As OS do usuário logado, só nos projetos do(s) FAP(s) deste cliente. */
  servidor.post<{ Params: { id: string } }>(
    '/api/clientes/:id/os-consultar',
    async (requisicao, resposta) => {
      const cliente = await repositorioDeClientes.buscarPorId(requisicao.params.id);
      if (!cliente) {
        return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
      }

      const dados = esquemaDeConsulta.safeParse(requisicao.body);
      if (!dados.success) {
        return responderErroDeValidacao(resposta, dados.error);
      }

      const personId = await experiencePersonIdOuErro(resposta);
      if (personId === null) return resposta;

      if (cliente.agendaCodparcs.length === 0) {
        return resposta.status(400).send({
          mensagem: 'Vincule um parceiro do ERP a este cliente, na Agenda, para consultar as OS dele.',
          semParceiroVinculado: true,
        });
      }

      let faps: number[];
      try {
        faps = await fapsDoCliente(cliente.agendaCodparcs);
      } catch (erro) {
        if (erro instanceof PayloadDeNegociacoesInvalidoError) {
          return resposta.status(400).send({ mensagem: erro.message });
        }
        if (erro instanceof SyntaxError) {
          return resposta
            .status(502)
            .send({ mensagem: 'O Sankhya respondeu algo que não é JSON válido.' });
        }
        return responderErroDoShell(resposta, erro);
      }

      if (faps.length === 0) {
        return { itens: [], buscadoEm: new Date().toISOString() };
      }

      try {
        const itens = await experience.ordensDoCliente(
          personId,
          faps,
          dados.data.de,
          dados.data.ate,
        );
        return { itens, buscadoEm: new Date().toISOString() };
      } catch (erro) {
        return responderErroDeOrdens(resposta, erro);
      }
    },
  );
}
