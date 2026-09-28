import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { AgendaRecursos } from '../sankhya/agenda.ts';
import { parsearAgenda, PayloadInvalidoError } from '../sankhya/agendaParser.ts';
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

/** `YYYY-MM-DD` -> `DD/MM/YYYY`, formato que o Sankhya ERP espera. */
function paraFormatoBrasileiro(iso: string): string {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

/**
 * `CODUSU` da configuração global, ou `null` quando não configurado. Sem ele não há
 * como recortar "só a minha agenda", então a consulta é recusada com mensagem clara.
 */
function lerCodusuConfigurado(configuracao: { sankhyaOmCodUsu: string }): number | null {
  const bruto = configuracao.sankhyaOmCodUsu.trim();
  if (!bruto) return null;
  const codusu = Number(bruto);
  return Number.isInteger(codusu) && codusu > 0 ? codusu : null;
}

/**
 * Rotas da Agenda de Recursos do Sankhya ERP: snapshot em SQLite, alimentado
 * pela consulta automática na janela oculta autenticada do shell desktop.
 */
export function registrarRotasDeAgenda(
  servidor: FastifyInstance,
  agenda: AgendaRecursos,
  repositorio: RepositorioClientes,
  configuracao: RepositorioConfiguracao,
  credenciais: Credenciais,
  experience: Experience,
): void {
  servidor.get('/api/agenda/estado', async () => agenda.estado());

  servidor.get('/api/agenda/recursos', async () => ({ recursos: agenda.recursos() }));

  /** Eventos do snapshot num período, sem recorte por cliente — a visão geral da aba Agenda. */
  servidor.get<{ Querystring: { de?: string; ate?: string } }>(
    '/api/agenda/eventos',
    async (requisicao, resposta) => {
      const { de, ate } = requisicao.query;
      if (!de || !ate || !ISO.test(de) || !ISO.test(ate)) {
        return resposta
          .status(400)
          .send({ mensagem: 'Informe ?de= e ?ate= no formato YYYY-MM-DD.' });
      }
      return { eventos: agenda.eventos(`${de} 00:00:00`, `${ate} 23:59:59`) };
    },
  );

  /**
   * Consulta automática: a janela oculta do shell busca a Agenda de Recursos de dentro do
   * Sankhya já autenticado (sem colar nada na mão) e o resultado é importado no snapshot,
   * mês a mês. Sempre recortada pelo `CODUSU` configurado — só a agenda do próprio usuário
   * entra, mesmo que o Sankhya devolva outros executantes.
   */
  servidor.post('/api/agenda/consultar', async (requisicao, resposta) => {
    const dados = esquemaDeConsulta.safeParse(requisicao.body);
    if (!dados.success) {
      const primeiraMensagem = dados.error.issues[0]?.message ?? 'Dados inválidos.';
      return resposta.status(400).send({ mensagem: primeiraMensagem });
    }

    const codusuAlvo = lerCodusuConfigurado(await configuracao.ler());
    if (codusuAlvo === null) {
      return resposta.status(400).send({
        mensagem:
          'Configure o "Meu código de usuário Sankhya OM" em Configurações › Geral para consultar a agenda.',
        cadastroIncompleto: true,
      });
    }

    const de = paraFormatoBrasileiro(dados.data.de);
    const ate = paraFormatoBrasileiro(dados.data.ate);
    const periodo = { de: `${dados.data.de} 00:00:00`, ate: `${dados.data.ate} 23:59:59` };

    // A janela oculta reloga sozinha quando a sessão cai, então aqui não há mais o
    // relogin por texto de erro que existia no fluxo da aba visível.
    let resultado: { conteudo: string };
    try {
      resultado = await credenciais.consultarAgendaDeRecursos(de, ate);
    } catch (erro) {
      return responderErroDoShell(resposta, erro);
    }

    let bruto: unknown;
    try {
      bruto = JSON.parse(resultado.conteudo);
    } catch {
      return resposta
        .status(502)
        .send({ mensagem: 'O Sankhya respondeu algo que não é JSON válido.' });
    }

    try {
      return agenda.importar(parsearAgenda(bruto), { periodo, codusuAlvo });
    } catch (erro) {
      if (erro instanceof PayloadInvalidoError) {
        return resposta.status(400).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });

  /**
   * Estado de um dia específico no Sankhya Experience pra este parceiro: sem
   * tarefa, tarefa aberta, ou já com OS lançada (com o número). Descobre os
   * FAPs dele (negociações do ERP com `tipo: "2"`) e testa nesse dia em cada
   * um — é sempre pro usuário logado, sem seleção de pessoa.
   */
  servidor.get<{ Querystring: { codparc?: string; dia?: string } }>(
    '/api/agenda/situacao-do-dia',
    async (requisicao, resposta) => {
      const codparc = Number(requisicao.query.codparc);
      if (!Number.isInteger(codparc) || codparc <= 0) {
        return resposta.status(400).send({ mensagem: 'Informe ?codparc=<número>.' });
      }
      const dia = requisicao.query.dia ?? '';
      if (!ISO.test(dia)) {
        return resposta.status(400).send({ mensagem: 'Informe ?dia= no formato YYYY-MM-DD.' });
      }

      let negociacoesResultado: { conteudo: string };
      try {
        negociacoesResultado = await credenciais.consultarNegociacoesDoParceiro(codparc);
      } catch (erro) {
        return responderErroDoShell(resposta, erro);
      }

      let faps: number[];
      try {
        faps = fapsDoParceiro(parsearNegociacoes(JSON.parse(negociacoesResultado.conteudo)));
      } catch (erro) {
        if (erro instanceof PayloadDeNegociacoesInvalidoError) {
          return resposta.status(400).send({ mensagem: erro.message });
        }
        return resposta
          .status(502)
          .send({ mensagem: 'O Sankhya respondeu algo que não é JSON válido.' });
      }

      if (!faps.length) {
        return { situacao: { tipo: 'sem-tarefa' }, faps: [] };
      }

      try {
        return { situacao: await experience.situacaoDoDia(faps, dia), faps };
      } catch (erro) {
        if (erro instanceof SessaoExpiradaError) {
          return resposta.status(409).send({ mensagem: erro.message, sessaoExpirada: true });
        }
        return responderErroDoShell(resposta, erro);
      }
    },
  );

  /**
   * Eventos do snapshot num período, recortados pelos parceiros deste cliente —
   * casados pelo NOME (o do cadastro e os "Nomes Completos"), o mesmo critério da
   * aba OS. É o que alimenta a aba Agenda dentro do cadastro do cliente; não há
   * vínculo por CODPARC a amarrar à mão.
   */
  servidor.get<{ Params: { id: string }; Querystring: { de?: string; ate?: string } }>(
    '/api/clientes/:id/agenda-eventos',
    async (requisicao, resposta) => {
      const cliente = await repositorio.buscarPorId(requisicao.params.id);
      if (!cliente) {
        return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
      }

      const { de, ate } = requisicao.query;
      if (!de || !ate || !ISO.test(de) || !ISO.test(ate)) {
        return resposta
          .status(400)
          .send({ mensagem: 'Informe ?de= e ?ate= no formato YYYY-MM-DD.' });
      }

      const codparcs = agenda.codparcsPorNomes([cliente.nome, ...cliente.nomesCompletos]);
      if (codparcs.length === 0) {
        return { eventos: [], semParceiroCasado: true };
      }

      return { eventos: agenda.eventos(`${de} 00:00:00`, `${ate} 23:59:59`, codparcs) };
    },
  );
}
