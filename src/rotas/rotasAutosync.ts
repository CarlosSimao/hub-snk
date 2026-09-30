/**
 * Rotas do Git AutoSync.
 *
 * Toda ação que mexe em repositório (commit, push, sincronizar, merge request) fica em
 * POST, nunca em GET: nenhuma delas pode disparar por prefetch do navegador ou por
 * alguém abrindo a URL.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  GitAutosyncFalhouError,
  GitAutosyncNaoInstaladoError,
  GitAutosyncUsoError,
  PacoteDoAutosyncAusenteError,
  PastaDoAutosyncNaoEncontradaError,
} from '../autosync/cliDoAutosync.ts';
import {
  TAMANHO_MAXIMO_DO_CAMINHO,
  type ServicoDoAutosync,
} from '../autosync/servicoDoAutosync.ts';
import { sugerirCorrecoes } from '../autosync/sugestoesDeCorrecao.ts';
import { AGENTES_DE_IA, FORMATO_DE_HORARIO } from '../autosync/tiposDoAutosync.ts';
import { PastaNaoEncontradaError } from '../sistema/pasta.ts';
import { TerminalIndisponivelError } from '../sistema/abrirShell.ts';
import {
  criarVariaveisDeAmbienteDoUsuario,
  definirGitlab,
  FORMATO_DO_HOST_DO_GITLAB,
  lerSituacaoDoGitlab,
  removerTokenDoGitlab,
  type VariaveisDeAmbienteDoUsuario,
} from '../autosync/variaveisDoGitlab.ts';

const TAMANHO_MAXIMO_DA_MENSAGEM = 2000;
const TAMANHO_MAXIMO_DO_TITULO = 255;
const TAMANHO_MAXIMO_DO_RAMO = 255;
const TAMANHO_MAXIMO_DO_GLOB = 255;
const QUANTIDADE_MAXIMA_DE_HORARIOS = 6;
const QUANTIDADE_MAXIMA_DE_GLOBS = 50;
const LIMITE_PADRAO_DO_HISTORICO = 20;
const LIMITE_MAXIMO_DO_HISTORICO = 100;
const LIMITE_PADRAO_DO_LOG = 200;
const LIMITE_MAXIMO_DO_LOG = 1000;

const esquemaDoCaminho = z
  .string({ error: 'Informe o caminho do repositório.' })
  .trim()
  .min(1, 'Informe o caminho do repositório.')
  .max(
    TAMANHO_MAXIMO_DO_CAMINHO,
    `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
  );

/* Vazio vale como ausente: a tela manda o campo do diálogo mesmo quando ninguém digitou. */
const textoOpcional = (maximo: number, rotulo: string) =>
  z
    .string()
    .trim()
    .max(maximo, `${rotulo} deve ter no máximo ${maximo} caracteres.`)
    .optional()
    .transform((valor) => (valor === '' ? undefined : valor));

const esquemaDeCaminho = z.object({ caminho: esquemaDoCaminho });

const esquemaDeRepositorio = z.object({
  caminho: esquemaDoCaminho,
  tipo: z.enum(['repo', 'root'], { error: "O tipo deve ser 'repo' ou 'root'." }).default('repo'),
});

const esquemaDoLote = z.object({
  origem: z.literal('clientes', { error: "A origem do lote deve ser 'clientes'." }),
});

/*
 * O CLI não tem "sem horário": `set-schedule ""` sai com erro. Quem quer parar a
 * rodada automática desinstala a tarefa, e a mensagem diz isso.
 */
const esquemaDoAgendamento = z.object({
  horarios: z
    .array(
      z
        .string({ error: 'Horário inválido: use HH:MM.' })
        .trim()
        .regex(FORMATO_DE_HORARIO, 'Horário inválido: use HH:MM.'),
      { error: 'Envie a lista de horários.' },
    )
    .min(1, 'Informe ao menos um horário. Para parar a rodada automática, desative o agendamento.')
    .max(
      QUANTIDADE_MAXIMA_DE_HORARIOS,
      `Informe no máximo ${QUANTIDADE_MAXIMA_DE_HORARIOS} horários.`,
    )
    .refine((horarios) => new Set(horarios).size === horarios.length, 'Há horário repetido.')
    .transform((horarios) => [...horarios].sort()),
});

const esquemaDaBandeja = z.object({
  ligada: z.boolean({ error: 'Informe se a bandeja fica ligada.' }),
});

const esquemaDaIa = z.object({
  ligada: z.boolean({ error: 'Informe se a mensagem por IA fica ligada.' }),
  agente: z.enum(AGENTES_DE_IA, { error: 'Agente de IA inválido.' }).optional(),
});

const esquemaDeGlobs = z
  .array(
    z
      .string()
      .trim()
      .min(1, 'Padrão de arquivo vazio.')
      .max(TAMANHO_MAXIMO_DO_GLOB, `Padrão com mais de ${TAMANHO_MAXIMO_DO_GLOB} caracteres.`),
  )
  .max(QUANTIDADE_MAXIMA_DE_GLOBS, `Informe no máximo ${QUANTIDADE_MAXIMA_DE_GLOBS} padrões.`)
  .optional();

const esquemaDaPolitica = z.object({
  caminho: esquemaDoCaminho,
  include: esquemaDeGlobs,
  exclude: esquemaDeGlobs,
  ramos: esquemaDeGlobs,
  maxBytes: z
    .number({ error: 'O tamanho máximo deve ser um número.' })
    .int('O tamanho máximo deve ser um número inteiro de bytes.')
    .positive('O tamanho máximo deve ser positivo.')
    .optional(),
  ia: z.enum(['on', 'off'], { error: "A IA do repositório deve ser 'on' ou 'off'." }).optional(),
});

const esquemaDoCommit = z.object({
  caminho: esquemaDoCaminho,
  mensagem: textoOpcional(TAMANHO_MAXIMO_DA_MENSAGEM, 'A mensagem'),
});

const esquemaDaSincronizacao = z.object({
  caminho: esquemaDoCaminho.optional(),
  mensagem: textoOpcional(TAMANHO_MAXIMO_DA_MENSAGEM, 'A mensagem'),
});

const esquemaDoMr = z.object({
  caminho: esquemaDoCaminho,
  titulo: textoOpcional(TAMANHO_MAXIMO_DO_TITULO, 'O título'),
  destino: textoOpcional(TAMANHO_MAXIMO_DO_RAMO, 'A branch de destino'),
  origem: textoOpcional(TAMANHO_MAXIMO_DO_RAMO, 'A branch de origem'),
});

const esquemaDaInstalacao = z.object({
  horario: z.string().trim().regex(FORMATO_DE_HORARIO, 'Horário inválido: use HH:MM.').optional(),
  bandeja: z.boolean().optional(),
  atalhos: z.boolean().optional(),
  skills: z.boolean().optional(),
  path: z.boolean().optional(),
});

const esquemaDaConsultaDaVisao = z.object({ clientes: z.string().optional() });

const esquemaDaConsultaDeCaminho = z.object({ caminho: esquemaDoCaminho });

const esquemaDaConsultaDoHistorico = z.object({
  caminho: esquemaDoCaminho,
  limite: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITE_MAXIMO_DO_HISTORICO)
    .default(LIMITE_PADRAO_DO_HISTORICO),
});

const esquemaDaConsultaDoLog = z.object({
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO_DO_LOG).default(LIMITE_PADRAO_DO_LOG),
});

const esquemaDaConsultaDoDiagnostico = z.object({ rede: z.string().optional() });

const TAMANHO_MAXIMO_DO_TOKEN = 500;

/* Token vazio vale como ausente: mantém o gravado. */
const esquemaDoGitlab = z.object({
  host: z
    .string({ error: 'Informe o host do GitLab.' })
    .trim()
    .toLowerCase()
    .regex(
      FORMATO_DO_HOST_DO_GITLAB,
      'Informe o host do GitLab sem protocolo nem caminho, por exemplo gitlab.empresa.com.br.',
    ),
  token: z
    .string()
    .trim()
    .max(
      TAMANHO_MAXIMO_DO_TOKEN,
      `O token deve ter no máximo ${TAMANHO_MAXIMO_DO_TOKEN} caracteres.`,
    )
    .regex(/^\S*$/, 'O token não pode ter espaço nem quebra de linha.')
    .optional()
    .transform((valor) => (valor === '' ? undefined : valor)),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.issues[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

/*
 * 502 carrega a saída do CLI sem reescrever: é ali que está o motivo real (branch
 * protegida, remoto inacessível, arquivo sensível). O autosync já a redige.
 */
function responderErroDoAutosync(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof GitAutosyncUsoError) {
    return resposta.status(400).send({ mensagem: erro.message });
  }
  if (erro instanceof PastaDoAutosyncNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: erro.message });
  }
  if (erro instanceof PacoteDoAutosyncAusenteError) {
    return resposta.status(409).send({ mensagem: erro.message });
  }
  if (erro instanceof GitAutosyncFalhouError) {
    return resposta
      .status(502)
      .send({ mensagem: erro.message, sugestoes: sugerirCorrecoes(erro.message) });
  }
  if (erro instanceof PastaNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: erro.message });
  }
  if (erro instanceof TerminalIndisponivelError) {
    return resposta.status(503).send({ mensagem: erro.message });
  }
  if (erro instanceof GitAutosyncNaoInstaladoError) {
    return resposta.status(503).send({ mensagem: erro.message, naoInstalado: true });
  }
  throw erro;
}

async function responder(resposta: FastifyReply, acao: () => Promise<unknown>): Promise<unknown> {
  try {
    return await acao();
  } catch (erro) {
    return responderErroDoAutosync(resposta, erro);
  }
}

export function registrarRotasDeAutosync(
  servidor: FastifyInstance,
  autosync: ServicoDoAutosync,
  variaveis: VariaveisDeAmbienteDoUsuario = criarVariaveisDeAmbienteDoUsuario(),
): void {
  /* A visão responde mesmo sem autosync instalado: é ela que diz à tela para oferecer a instalação. */
  servidor.get('/api/autosync', async (requisicao, resposta) => {
    const consulta = esquemaDaConsultaDaVisao.safeParse(requisicao.query);
    const comClientes = consulta.success && consulta.data.clientes === 'true';
    return responder(resposta, () => autosync.visao(comClientes));
  });

  servidor.get('/api/autosync/clientes', async (_requisicao, resposta) =>
    responder(resposta, () => autosync.repositoriosDosClientes()),
  );

  servidor.post('/api/autosync/instalar', async (requisicao, resposta) => {
    const dados = esquemaDaInstalacao.safeParse(requisicao.body ?? {});
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.instalar(dados.data));
  });

  servidor.post('/api/autosync/repositorios', async (requisicao, resposta) => {
    const dados = esquemaDeRepositorio.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.adicionar(dados.data.caminho, dados.data.tipo));
  });

  servidor.post('/api/autosync/repositorios/lote', async (requisicao, resposta) => {
    const dados = esquemaDoLote.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.adicionarRepositoriosDosClientes());
  });

  servidor.delete('/api/autosync/repositorios', async (requisicao, resposta) => {
    const dados = esquemaDeCaminho.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.retirar(dados.data.caminho));
  });

  for (const [rota, acao] of [
    ['excluir', (caminho: string) => autosync.excluirDaRaiz(caminho)],
    ['incluir', (caminho: string) => autosync.incluirNaRaiz(caminho)],
  ] as const) {
    servidor.post(`/api/autosync/repositorios/${rota}`, async (requisicao, resposta) => {
      const dados = esquemaDeCaminho.safeParse(requisicao.body);
      if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
      return responder(resposta, () => acao(dados.data.caminho));
    });
  }

  servidor.put('/api/autosync/agendamento', async (requisicao, resposta) => {
    const dados = esquemaDoAgendamento.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.definirHorarios(dados.data.horarios));
  });

  /*
   * POST nas duas, com a intenção no caminho: recriar a tarefa depois de remover exige
   * a instalação inteira, com os horários do config daquele momento — não é idempotente
   * como um DELETE sugeriria.
   */
  servidor.post('/api/autosync/agendamento/instalar', async (_requisicao, resposta) =>
    responder(resposta, () => autosync.instalarTarefa()),
  );
  servidor.post('/api/autosync/agendamento/desinstalar', async (_requisicao, resposta) =>
    responder(resposta, () => autosync.desinstalarTarefa()),
  );

  servidor.put('/api/autosync/bandeja', async (requisicao, resposta) => {
    const dados = esquemaDaBandeja.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.definirBandeja(dados.data.ligada));
  });

  /*
   * Ligada, o autosync manda o diff ao agente escolhido. A confirmação explícita é da
   * tela; aqui só se garante que o agente é um dos que o CLI conhece.
   */
  servidor.put('/api/autosync/ia', async (requisicao, resposta) => {
    const dados = esquemaDaIa.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.definirIa(dados.data.ligada, dados.data.agente));
  });

  servidor.put('/api/autosync/politica', async (requisicao, resposta) => {
    const dados = esquemaDaPolitica.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    const { caminho, ...campos } = dados.data;
    return responder(resposta, () => autosync.definirPolitica(caminho, campos));
  });

  servidor.get('/api/autosync/previa', async (requisicao, resposta) => {
    const dados = esquemaDaConsultaDeCaminho.safeParse(requisicao.query);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.previa(dados.data.caminho));
  });

  servidor.post('/api/autosync/commit', async (requisicao, resposta) => {
    const dados = esquemaDoCommit.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.commit(dados.data.caminho, dados.data.mensagem));
  });

  servidor.post('/api/autosync/push', async (requisicao, resposta) => {
    const dados = esquemaDeCaminho.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.push(dados.data.caminho));
  });

  servidor.post('/api/autosync/sincronizar', async (requisicao, resposta) => {
    const dados = esquemaDaSincronizacao.safeParse(requisicao.body ?? {});
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => autosync.sincronizar(dados.data.caminho, dados.data.mensagem));
  });

  servidor.post('/api/autosync/merge-request', async (requisicao, resposta) => {
    const dados = esquemaDoMr.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    const { caminho, ...opcoes } = dados.data;
    return responder(resposta, () => autosync.mergeRequest(caminho, opcoes));
  });

  servidor.post('/api/autosync/terminal', async (requisicao, resposta) => {
    const dados = esquemaDeCaminho.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    try {
      await autosync.abrirTerminal(dados.data.caminho);
      return resposta.status(204).send();
    } catch (erro) {
      return responderErroDoAutosync(resposta, erro);
    }
  });

  servidor.get('/api/autosync/historico', async (requisicao, resposta) => {
    const dados = esquemaDaConsultaDoHistorico.safeParse(requisicao.query);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, async () => ({
      commits: await autosync.historico(dados.data.caminho, dados.data.limite),
    }));
  });

  servidor.get('/api/autosync/log', async (requisicao, resposta) => {
    const dados = esquemaDaConsultaDoLog.safeParse(requisicao.query);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, async () => ({ linhas: await autosync.log(dados.data.limite) }));
  });

  servidor.get('/api/autosync/diagnostico', async (requisicao, resposta) => {
    const consulta = esquemaDaConsultaDoDiagnostico.safeParse(requisicao.query);
    const rede = consulta.success && consulta.data.rede === 'true';
    return responder(resposta, () => autosync.diagnostico(rede));
  });

  /*
   * Token do GitLab do Merge Request. A leitura diz só se há token: o valor nunca sai
   * do servidor.
   */
  servidor.get('/api/autosync/gitlab', async (_requisicao, resposta) =>
    responder(resposta, () => lerSituacaoDoGitlab(variaveis)),
  );

  servidor.put('/api/autosync/gitlab', async (requisicao, resposta) => {
    const dados = esquemaDoGitlab.safeParse(requisicao.body);
    if (!dados.success) return responderErroDeValidacao(resposta, dados.error);
    return responder(resposta, () => definirGitlab(variaveis, dados.data.host, dados.data.token));
  });

  servidor.delete('/api/autosync/gitlab', async (_requisicao, resposta) =>
    responder(resposta, () => removerTokenDoGitlab(variaveis)),
  );
}
