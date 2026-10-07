import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { AgendaRecursos } from '../sankhya/agenda.ts';
import { PayloadInvalidoError } from '../sankhya/agendaParser.ts';
import {
  importarAgendaDoPeriodo,
  lerCodusuConfigurado,
  RespostaDoSankhyaInvalidaError,
  situacaoDoDiaDoParceiro,
} from '../sankhya/consultasDaAgenda.ts';
import type { Credenciais } from '../sankhya/credenciais.ts';
import { SessaoExpiradaError, type Experience } from '../sankhya/experience.ts';
import { PayloadDeNegociacoesInvalidoError } from '../sankhya/negociacoes.ts';
import { MOTIVOS_OCORRENCIA, validarNovaOcorrencia } from '../sankhya/ocorrencias.ts';
import { responderErroDoShell } from './comum/respostasDoShell.ts';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const esquemaDeConsulta = z.object({
  de: z.string().regex(ISO, 'Informe "de" no formato YYYY-MM-DD.'),
  ate: z.string().regex(ISO, 'Informe "ate" no formato YYYY-MM-DD.'),
});

/** Erros das consultas ao Sankhya que viram resposta HTTP; o resto segue para o Fastify. */
function responderErroDaConsulta(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof RespostaDoSankhyaInvalidaError) {
    return resposta.status(502).send({ mensagem: erro.message });
  }
  if (erro instanceof PayloadInvalidoError || erro instanceof PayloadDeNegociacoesInvalidoError) {
    return resposta.status(400).send({ mensagem: erro.message });
  }
  if (erro instanceof SessaoExpiradaError) {
    return resposta.status(409).send({
      mensagem: erro.message,
      sessaoExpirada: true,
      configuracaoPendente: 'sessao-experience',
    });
  }
  return responderErroDoShell(resposta, erro);
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
          'Informe o "Meu código de usuário SankhyaOm" em Sankhya ID para consultar a agenda.',
        cadastroIncompleto: true,
        configuracaoPendente: 'codusu',
      });
    }

    // A janela oculta reloga sozinha quando a sessão cai, então aqui não há mais o
    // relogin por texto de erro que existia no fluxo da aba visível.
    try {
      // Sem o login salvo, a janela oculta não entra no ERP e o erro chegaria genérico.
      if (!(await credenciais.status('sankhya-erp')).definido) {
        return resposta.status(400).send({
          mensagem: 'Salve o Sankhya ID (usuário e senha) para consultar a agenda.',
          configuracaoPendente: 'login-erp',
        });
      }
      return await importarAgendaDoPeriodo({
        agenda,
        credenciais,
        periodo: dados.data,
        codusuAlvo,
      });
    } catch (erro) {
      return responderErroDaConsulta(resposta, erro);
    }
  });

  /**
   * Ocorrência de agenda (férias, folga, atestado...) lançada direto no ERP, pela janela
   * oculta do shell — ver `src/sankhya/ocorrencias.ts`. Nenhuma rota aceita usuário: vale
   * o da sessão, e ela tem que ser do `CODUSU` configurado quando há um.
   */
  servidor.get('/api/agenda/ocorrencias/motivos', async () => ({ motivos: MOTIVOS_OCORRENCIA }));

  servidor.get('/api/agenda/ocorrencias/usuario', async (_requisicao, resposta) => {
    try {
      const usuario = await credenciais.usuarioDaOcorrencia();
      return { ...usuario, codusuConfigurado: lerCodusuConfigurado(await configuracao.ler()) };
    } catch (erro) {
      return responderErroDoShell(resposta, erro);
    }
  });

  servidor.post('/api/agenda/ocorrencias', async (requisicao, resposta) => {
    const validada = validarNovaOcorrencia(requisicao.body as Record<string, unknown> | undefined);
    if (!validada.ok) return resposta.status(400).send({ mensagem: validada.erro });
    try {
      const codusuEsperado = lerCodusuConfigurado(await configuracao.ler());
      const { mensagem } = await credenciais.criarOcorrencia(validada.ocorrencia, codusuEsperado);
      requisicao.log.info({ motivo: validada.ocorrencia.motivo }, 'ocorrência criada no ERP');
      return { mensagem: mensagem || 'Ocorrência criada.' };
    } catch (erro) {
      return responderErroDoShell(resposta, erro);
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

      try {
        return await situacaoDoDiaDoParceiro({ credenciais, experience, codparc, dia });
      } catch (erro) {
        return responderErroDaConsulta(resposta, erro);
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
