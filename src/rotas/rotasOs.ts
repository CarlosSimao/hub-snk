import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { chaveNome } from '../sankhya/agenda.ts';
import { SessaoExpiradaError, type Experience } from '../sankhya/experience.ts';
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
 * de mês ou clique em "atualizar" busca de novo.
 *
 * Usa `Experience.minhasOrdens(personId, de, ate)`, que traz as OS do usuário em TODOS
 * os projetos de uma vez — sem precisar de um `implantation_id` por cliente. O
 * `personId` vem da configuração geral (`experiencePersonId`), a mesma conta em
 * qualquer projeto. A aba OS do cadastro do cliente reaproveita a mesma consulta e
 * recorta pelos "Nomes Completos" do cliente — a razão social pode ser diferente (e até
 * mais de uma) do nome digitado no cadastro do hub, por isso a lista em vez de comparar
 * direto com `cliente.nome`; sem nenhum nome cadastrado, cai em `cliente.nome`.
 */
export function registrarRotasDeOs(
  servidor: FastifyInstance,
  experience: Experience,
  repositorioDeClientes: RepositorioClientes,
  repositorioDeConfiguracao: RepositorioConfiguracao,
): void {
  async function consultarMinhasOrdens(resposta: FastifyReply, de: string, ate: string) {
    const { experiencePersonId } = await repositorioDeConfiguracao.ler();
    if (experiencePersonId === '') {
      return resposta.status(400).send({
        mensagem: 'Capture a sessão do Sankhya Experience em Credenciais Sankhya.',
        codigoDeUsuarioAusente: true,
      });
    }

    try {
      const itens = await experience.minhasOrdens(Number(experiencePersonId), de, ate);
      return { itens, buscadoEm: new Date().toISOString() };
    } catch (erro) {
      if (erro instanceof SessaoExpiradaError) {
        return resposta.status(409).send({ mensagem: erro.message, sessaoExpirada: true });
      }
      return responderErroDoShell(resposta, erro);
    }
  }

  /** Todas as OS do usuário logado no período, em todos os projetos. */
  servidor.post('/api/os/consultar', async (requisicao, resposta) => {
    const dados = esquemaDeConsulta.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    return consultarMinhasOrdens(resposta, dados.data.de, dados.data.ate);
  });

  /** As mesmas OS, recortadas pelos "Nomes Completos" deste cliente (ou o nome do cadastro, sem nenhum cadastrado). */
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

      const resultado = await consultarMinhasOrdens(resposta, dados.data.de, dados.data.ate);
      if (!resultado || typeof resultado !== 'object' || !('itens' in resultado)) {
        return resultado;
      }

      const nomes = cliente.nomesCompletos.length ? cliente.nomesCompletos : [cliente.nome];
      const chavesDoCliente = new Set(nomes.map(chaveNome));
      const itensFiltrados = resultado.itens.filter((item) =>
        chavesDoCliente.has(chaveNome(item.empresa)),
      );
      return { ...resultado, itens: itensFiltrados };
    },
  );
}
