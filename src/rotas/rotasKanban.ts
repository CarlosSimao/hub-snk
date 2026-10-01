/**
 * Kanban dos projetos do cliente: envio do documento de escopo, análise pela IA e as
 * tarefas do quadro.
 *
 * O upload vai como base64 dentro do JSON: o projeto não tem plugin de multipart, e um
 * documento de escopo cabe folgado no limite abaixo. A análise leva minutos, então roda
 * em segundo plano: a rota responde na hora e a tela acompanha a `situacao` da demanda.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { AssistenteFalhouError, AssistenteIndisponivelError } from '../kanban/assistentesDeIa.ts';
import {
  AnaliseDeEscopoError,
  resumoComDuvidas,
  type AnaliseConcluida,
} from '../kanban/analiseDeEscopo.ts';
import type { ArquivoDeTarefas } from '../kanban/arquivoDeTarefas.ts';
import {
  DadosDoKanbanInvalidosError,
  DemandaNaoEncontradaError,
  TarefaNaoEncontradaError,
  type ConteudoDoDocumento,
  type DocumentoRecebido,
  type KanbanDosProjetos,
} from '../kanban/kanbanDosProjetos.ts';
import { DocxInvalidoError, textoDoDocx } from '../kanban/textoDoDocx.ts';
import { PdfIlegivelError, textoDoPdf } from '../kanban/textoDoPdf.ts';
import {
  ESTADOS_DE_TAREFA,
  type ConfiguracaoDoAssistenteDeIa,
  type DemandaDoKanban,
  type TipoDeDocumento,
} from '../kanban/tiposDoKanban.ts';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { Cliente } from '../tipos.ts';

/** O corpo JSON cresce cerca de 1/3 com o base64: daí o limite da rota ser maior. */
const LIMITE_DO_ARQUIVO_BYTES = 20 * 1024 * 1024;
const LIMITE_DO_CORPO_BYTES = 30 * 1024 * 1024;
const TAMANHO_MAXIMO_DO_NOME = 120;
const TAMANHO_MAXIMO_DO_CAMINHO = 400;
const TAMANHO_MAXIMO_DO_TITULO = 200;
const TAMANHO_MAXIMO_DO_TEXTO = 20_000;
const TAMANHO_MAXIMO_DAS_NOTAS = 4000;
const ESTIMATIVA_MAXIMA_HORAS = 999;
/* Sem tráfego, proxy e antivírus fecham a conexão do fluxo: o batimento a mantém viva. */
const INTERVALO_DO_BATIMENTO_DO_FLUXO_MS = 30_000;
const ITENS_MAXIMOS_DA_LISTA = 50;
const TAMANHO_MAXIMO_DO_ITEM = 300;

const TIPO_PELA_EXTENSAO: Record<string, TipoDeDocumento> = {
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
};

/** Como o original volta para o visor. Texto vai como `text/plain` para nunca virar página. */
const TIPO_DE_CONTEUDO: Record<TipoDeDocumento, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

class AnaliseEmAndamentoError extends Error {
  constructor(acao: string) {
    super(`A análise deste kanban está em andamento. Aguarde terminar para ${acao}.`);
    this.name = 'AnaliseEmAndamentoError';
  }
}

export interface DependenciasDoKanban {
  kanban: KanbanDosProjetos;
  clientes: RepositorioClientes;
  configuracao: RepositorioConfiguracao;
  /** Injetável para teste; em produção é o `analisarEscopo`, que chama o assistente. */
  analisar: (
    documento: ConteudoDoDocumento,
    escolha: ConfiguracaoDoAssistenteDeIa,
  ) => Promise<AnaliseConcluida>;
  registrador?: { error: (objeto: unknown, mensagem?: string) => void };
  /** O arquivo JSON de tarefas: ausente nos testes que não tratam dele. */
  arquivoDeTarefas?: ArquivoDeTarefas;
}

const esquemaDeParametrosDeCliente = z.object({
  id: z.string().uuid('Identificador de cliente inválido.'),
});

const esquemaDeParametrosDeDemanda = z.object({
  idDemanda: z.coerce
    .number({ error: 'Identificador de kanban inválido.' })
    .int('Identificador de kanban inválido.')
    .positive('Identificador de kanban inválido.'),
});

const esquemaDeParametrosDeTarefa = z.object({
  idTarefa: z.coerce
    .number({ error: 'Identificador de tarefa inválido.' })
    .int('Identificador de tarefa inválido.')
    .positive('Identificador de tarefa inválido.'),
});

const esquemaDeDocumento = z.object({
  nome: z
    .string({ error: 'Informe o nome do arquivo.' })
    .trim()
    .min(1, 'Informe o nome do arquivo.')
    .max(TAMANHO_MAXIMO_DO_CAMINHO, 'O nome do arquivo é longo demais.'),
  conteudoBase64: z
    .string({ error: 'Envie o conteúdo do arquivo.' })
    .min(1, 'O arquivo veio vazio.'),
});

const esquemaDoNome = z
  .string()
  .trim()
  .min(1, 'Informe o nome do kanban.')
  .max(TAMANHO_MAXIMO_DO_NOME, `O nome deve ter no máximo ${TAMANHO_MAXIMO_DO_NOME} caracteres.`);

/* Vazia é válida: a pasta do arquivo de tarefas pode ser escolhida depois. */
const esquemaDaPasta = z
  .string()
  .trim()
  .max(
    TAMANHO_MAXIMO_DO_CAMINHO,
    `O caminho deve ter no máximo ${TAMANHO_MAXIMO_DO_CAMINHO} caracteres.`,
  );

const esquemaDeNovaDemanda = z.object({
  projetoId: z.string().uuid('Escolha o projeto do kanban.'),
  /* Ausente: o nome do arquivo sem extensão, ou o do projeto quando não há documento. */
  nome: esquemaDoNome.optional(),
  pasta: esquemaDaPasta.default(''),
  documento: esquemaDeDocumento.optional(),
  /* Com documento, já dispara a análise: é o que a tela faz logo depois do upload. */
  analisar: z.boolean().default(false),
});

const esquemaDeAlteracaoDeDemanda = z.object({
  nome: esquemaDoNome.optional(),
  projetoId: z.string().uuid('Projeto inválido.').optional(),
  pasta: esquemaDaPasta.optional(),
});

const esquemaDeDadosDeTarefa = z.object({
  titulo: z
    .string()
    .trim()
    .min(1, 'Informe o título da tarefa.')
    .max(
      TAMANHO_MAXIMO_DO_TITULO,
      `O título deve ter no máximo ${TAMANHO_MAXIMO_DO_TITULO} caracteres.`,
    ),
  descricao: z.string().max(TAMANHO_MAXIMO_DO_TEXTO, 'A descrição é longa demais.').optional(),
  grupo: z.string().max(TAMANHO_MAXIMO_DO_NOME, 'O grupo é longo demais.').optional(),
  tipo: z.string().optional(),
  estimativaHoras: z.coerce
    .number({ error: 'A estimativa deve ser um número de horas.' })
    .min(0, 'A estimativa não pode ser negativa.')
    .max(ESTIMATIVA_MAXIMA_HORAS, 'A estimativa é grande demais.')
    .optional(),
  prioridade: z.string().optional(),
  criteriosDeAceite: z
    .string()
    .max(TAMANHO_MAXIMO_DO_TEXTO, 'Os critérios de aceite são longos demais.')
    .optional(),
  notas: z
    .string()
    .max(
      TAMANHO_MAXIMO_DAS_NOTAS,
      `As notas devem ter no máximo ${TAMANHO_MAXIMO_DAS_NOTAS} caracteres.`,
    )
    .optional(),
  checklist: z
    .array(
      z.object({
        texto: z.string().max(TAMANHO_MAXIMO_DO_ITEM, 'Um item da lista é longo demais.'),
        feito: z.boolean().default(false),
      }),
    )
    .max(ITENS_MAXIMOS_DA_LISTA, `A lista tem no máximo ${ITENS_MAXIMOS_DA_LISTA} itens.`)
    .optional(),
});

const esquemaDoEstado = z.enum(ESTADOS_DE_TAREFA, { error: 'Coluna do kanban desconhecida.' });

const esquemaDeNovaTarefa = esquemaDeDadosDeTarefa.extend({
  estado: esquemaDoEstado.default('backlog'),
});

const esquemaDoMovimento = z.object({
  estado: esquemaDoEstado,
  /* Ausente vai para o fim da coluna. */
  indice: z.coerce.number().int().min(0).optional(),
});

const esquemaDoFiltroDeTransicoes = z.object({
  clienteId: z.string().uuid('Identificador de cliente inválido.').optional(),
  desde: z.string().optional(),
});

function responderErroDeValidacao(resposta: FastifyReply, erro: z.ZodError): FastifyReply {
  const primeiraMensagem = erro.issues[0]?.message ?? 'Dados inválidos.';
  return resposta.status(400).send({ mensagem: primeiraMensagem });
}

function responderErroDeDominio(resposta: FastifyReply, erro: unknown): FastifyReply {
  if (erro instanceof DemandaNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: 'Kanban não encontrado.' });
  }
  if (erro instanceof TarefaNaoEncontradaError) {
    return resposta.status(404).send({ mensagem: 'Tarefa não encontrada.' });
  }
  if (erro instanceof DadosDoKanbanInvalidosError || erro instanceof DocxInvalidoError) {
    return resposta.status(400).send({ mensagem: erro.message });
  }
  throw erro;
}

/** Valida o arquivo recebido e extrai o texto. */
function lerDocumento(documento: z.infer<typeof esquemaDeDocumento>): DocumentoRecebido {
  const extensao = extname(documento.nome).toLowerCase();
  const tipo = TIPO_PELA_EXTENSAO[extensao];
  if (!tipo) {
    throw new DadosDoKanbanInvalidosError(
      extensao === '.doc'
        ? 'O .doc do Word antigo não é suportado: salve como .docx ou .pdf.'
        : 'Formato não suportado: envie .docx, .pdf, .md ou .txt.',
    );
  }

  const bruto = Buffer.from(documento.conteudoBase64, 'base64');
  if (!bruto.length) {
    throw new DadosDoKanbanInvalidosError('O arquivo veio vazio.');
  }
  if (bruto.length > LIMITE_DO_ARQUIVO_BYTES) {
    throw new DadosDoKanbanInvalidosError('O arquivo passa de 20 MB.');
  }

  return { nome: documento.nome, tipo, bruto, texto: extrairTexto(tipo, bruto) };
}

/**
 * O texto que o visor mostra e a análise usa. No PDF ele é só para o visor e para o
 * Codex e o Cursor: quem lê PDF recebe o original, e PDF ilegível não impede o envio.
 */
function extrairTexto(tipo: TipoDeDocumento, bruto: Buffer): string {
  if (tipo === 'docx') {
    return textoDoDocx(bruto);
  }
  if (tipo === 'pdf') {
    try {
      return textoDoPdf(bruto);
    } catch (erro) {
      if (erro instanceof PdfIlegivelError) {
        return '';
      }
      throw erro;
    }
  }
  return bruto.toString('utf8').replace(/^\uFEFF/, '');
}

/** A pasta do arquivo de tarefas precisa existir: criar a digitada espalharia pastas por erro. */
function conferirPasta(pasta: string): void {
  if (!pasta) {
    return;
  }
  if (!isAbsolute(pasta)) {
    throw new DadosDoKanbanInvalidosError('Informe o caminho completo da pasta.');
  }
  if (!existsSync(pasta) || !statSync(pasta).isDirectory()) {
    throw new DadosDoKanbanInvalidosError(`A pasta não existe: ${pasta}`);
  }
}

function nomeSemExtensao(nome: string): string {
  return nome.replace(/\.[^.]+$/, '').trim();
}

export function registrarRotasDeKanban(
  servidor: FastifyInstance,
  dependencias: DependenciasDoKanban,
): void {
  const { kanban, clientes, configuracao, analisar, registrador, arquivoDeTarefas } = dependencias;

  /** A demanda com a situação do arquivo de tarefas, depois de a gravação em curso terminar. */
  async function comArquivo(demanda: DemandaDoKanban): Promise<DemandaDoKanban> {
    if (!arquivoDeTarefas) return demanda;
    await arquivoDeTarefas.aguardar(demanda.id);
    const atual = kanban.demanda(demanda.id);
    const situacao = arquivoDeTarefas.situacao(demanda.id);
    return situacao ? { ...atual, arquivo: situacao } : atual;
  }
  /** Demandas com análise em curso neste processo: impede disparar a mesma duas vezes. */
  const emAnalise = new Set<number>();

  async function clienteOuNada(id: string): Promise<Cliente | undefined> {
    return clientes.buscarPorId(id);
  }

  function exigirForaDeAnalise(idDemanda: number, acao: string): void {
    if (emAnalise.has(idDemanda)) {
      throw new AnaliseEmAndamentoError(acao);
    }
  }

  /** Sem `await`: a análise leva minutos e a tela acompanha pela situação da demanda. */
  async function iniciarAnalise(idDemanda: number): Promise<void> {
    const conteudo = kanban.conteudoDoDocumento(idDemanda);
    if (!conteudo) {
      throw new DadosDoKanbanInvalidosError('Este kanban não tem documento para analisar.');
    }
    const { assistenteDeIa } = await configuracao.ler();

    emAnalise.add(idDemanda);
    kanban.marcarAnalisando(idDemanda);

    void (async () => {
      try {
        const resultado = await analisar(conteudo, assistenteDeIa);
        kanban.registrarAnalise(idDemanda, {
          resumo: resumoComDuvidas(resultado),
          tarefas: resultado.tarefas,
          assistente: resultado.assistente,
          modelo: resultado.modelo,
        });
      } catch (erro) {
        const conhecido =
          erro instanceof AnaliseDeEscopoError ||
          erro instanceof AssistenteIndisponivelError ||
          erro instanceof AssistenteFalhouError;
        if (!conhecido) {
          registrador?.error({ err: erro, idDemanda }, 'análise do escopo do kanban falhou');
        }
        try {
          kanban.marcarFalha(
            idDemanda,
            conhecido ? erro.message : `Falha inesperada: ${(erro as Error).message}`,
          );
        } catch {
          // A demanda foi apagada enquanto a análise rodava: não há onde registrar.
        }
      } finally {
        emAnalise.delete(idDemanda);
      }
    })();
  }

  function responder(resposta: FastifyReply, erro: unknown): FastifyReply {
    if (erro instanceof AnaliseEmAndamentoError) {
      return resposta.status(409).send({ mensagem: erro.message });
    }
    return responderErroDeDominio(resposta, erro);
  }

  /*
   * Cada mudança num kanban — da tela, do MCP, do arquivo de tarefas ou da IA — chega
   * aqui na hora, com o cliente: a tela relê o que está aberto sem recarregar o painel.
   */
  servidor.get('/api/kanban/fluxo', (requisicao, resposta) => {
    resposta.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const pararDeOuvir = kanban.aoMudar(({ demandaId, clienteId, removida }) => {
      resposta.raw.write(
        `event: kanban\ndata: ${JSON.stringify({ demandaId, clienteId, removida })}\n\n`,
      );
    });
    const batimento = setInterval(
      () => resposta.raw.write(': batimento\n\n'),
      INTERVALO_DO_BATIMENTO_DO_FLUXO_MS,
    );
    requisicao.raw.on('close', () => {
      clearInterval(batimento);
      pararDeOuvir();
    });
    resposta.hijack();
  });

  servidor.get('/api/clientes/:id/kanbans', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    if (!(await clienteOuNada(parametros.data.id))) {
      return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
    }
    const dados = kanban.doCliente(parametros.data.id);
    return { ...dados, demandas: await Promise.all(dados.demandas.map(comArquivo)) };
  });

  servidor.post(
    '/api/clientes/:id/kanbans',
    { bodyLimit: LIMITE_DO_CORPO_BYTES },
    async (requisicao, resposta) => {
      const parametros = esquemaDeParametrosDeCliente.safeParse(requisicao.params);
      if (!parametros.success) {
        return responderErroDeValidacao(resposta, parametros.error);
      }
      const dados = esquemaDeNovaDemanda.safeParse(requisicao.body);
      if (!dados.success) {
        return responderErroDeValidacao(resposta, dados.error);
      }

      const cliente = await clienteOuNada(parametros.data.id);
      if (!cliente) {
        return resposta.status(404).send({ mensagem: 'Cliente não encontrado.' });
      }
      const projeto = cliente.projetos.find((item) => item.id === dados.data.projetoId);
      if (!projeto) {
        return resposta.status(404).send({ mensagem: 'Projeto não encontrado.' });
      }

      try {
        conferirPasta(dados.data.pasta);
        const documento = dados.data.documento ? lerDocumento(dados.data.documento) : undefined;
        const nome =
          dados.data.nome ?? (documento ? nomeSemExtensao(documento.nome) : projeto.nome);
        const demanda = kanban.criarDemanda(cliente.id, {
          projetoId: projeto.id,
          nome: nome || projeto.nome,
          pasta: dados.data.pasta,
          ...(documento ? { documento } : {}),
        });
        if (documento && dados.data.analisar) {
          await iniciarAnalise(demanda.id);
        }
        return resposta.status(201).send(await comArquivo(kanban.demanda(demanda.id)));
      } catch (erro) {
        return responder(resposta, erro);
      }
    },
  );

  servidor.put('/api/kanban/demandas/:idDemanda', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    const dados = esquemaDeAlteracaoDeDemanda.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }

    try {
      const atual = kanban.demanda(parametros.data.idDemanda);
      const { projetoId, nome, pasta } = dados.data;
      // Só projeto do mesmo cliente: senão o kanban sumiria de um cadastro e apareceria em outro.
      if (projetoId !== undefined) {
        const cliente = await clienteOuNada(atual.clienteId);
        if (!cliente?.projetos.some((projeto) => projeto.id === projetoId)) {
          return resposta.status(404).send({ mensagem: 'Projeto não encontrado neste cliente.' });
        }
      }
      if (pasta !== undefined) {
        conferirPasta(pasta);
      }
      return await comArquivo(
        kanban.alterarDemanda(atual.id, {
          ...(nome !== undefined ? { nome } : {}),
          ...(projetoId !== undefined ? { projetoId } : {}),
          ...(pasta !== undefined ? { pasta } : {}),
        }),
      );
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  /* Libera (ou tira) o kanban do servidor MCP. Independe do arquivo de tarefas. */
  servidor.put('/api/kanban/demandas/:idDemanda/mcp', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    const dados = z
      .object({ ligado: z.boolean({ error: 'Informe { ligado: true ou false }.' }) })
      .safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }
    try {
      return await comArquivo(kanban.definirMcp(parametros.data.idDemanda, dados.data.ligado));
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.delete('/api/kanban/demandas/:idDemanda', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    try {
      exigirForaDeAnalise(parametros.data.idDemanda, 'excluir o kanban');
      kanban.removerDemanda(parametros.data.idDemanda);
      return resposta.status(204).send();
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.put(
    '/api/kanban/demandas/:idDemanda/documento',
    { bodyLimit: LIMITE_DO_CORPO_BYTES },
    async (requisicao, resposta) => {
      const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
      if (!parametros.success) {
        return responderErroDeValidacao(resposta, parametros.error);
      }
      const dados = esquemaDeDocumento
        .extend({ analisar: z.boolean().default(false) })
        .safeParse(requisicao.body);
      if (!dados.success) {
        return responderErroDeValidacao(resposta, dados.error);
      }

      try {
        exigirForaDeAnalise(parametros.data.idDemanda, 'trocar o documento');
        const demanda = kanban.anexarDocumento(parametros.data.idDemanda, lerDocumento(dados.data));
        if (dados.data.analisar) {
          await iniciarAnalise(demanda.id);
        }
        return kanban.demanda(demanda.id);
      } catch (erro) {
        return responder(resposta, erro);
      }
    },
  );

  servidor.delete('/api/kanban/demandas/:idDemanda/documento', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    try {
      exigirForaDeAnalise(parametros.data.idDemanda, 'remover o documento');
      return kanban.removerDocumento(parametros.data.idDemanda);
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  /* O original, para o visor. `?baixar=1` força o download em vez de abrir. */
  servidor.get('/api/kanban/demandas/:idDemanda/documento', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    try {
      const conteudo = kanban.conteudoDoDocumento(parametros.data.idDemanda);
      if (!conteudo || !existsSync(conteudo.arquivo)) {
        return resposta.status(404).send({ mensagem: 'Documento original não encontrado.' });
      }
      const { baixar } = (requisicao.query ?? {}) as { baixar?: string };
      const disposicao = baixar ? 'attachment' : 'inline';
      return resposta
        .header('content-type', TIPO_DE_CONTEUDO[conteudo.tipo])
        .header(
          'content-disposition',
          `${disposicao}; filename*=UTF-8''${encodeURIComponent(conteudo.nome)}`,
        )
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store')
        .send(createReadStream(conteudo.arquivo));
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  /* O texto extraído: é a prévia do .docx, .md e .txt. O PDF o navegador mostra sozinho. */
  servidor.get('/api/kanban/demandas/:idDemanda/documento/texto', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    try {
      const conteudo = kanban.conteudoDoDocumento(parametros.data.idDemanda);
      if (!conteudo) {
        return resposta.status(404).send({ mensagem: 'Este kanban não tem documento.' });
      }
      return { nome: conteudo.nome, tipo: conteudo.tipo, texto: conteudo.texto };
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.post('/api/kanban/demandas/:idDemanda/analisar', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    try {
      exigirForaDeAnalise(parametros.data.idDemanda, 'analisar de novo');
      await iniciarAnalise(parametros.data.idDemanda);
      return resposta.status(202).send(kanban.demanda(parametros.data.idDemanda));
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.post('/api/kanban/demandas/:idDemanda/tarefas', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeDemanda.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    const dados = esquemaDeNovaTarefa.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }
    try {
      const { estado, ...tarefa } = dados.data;
      return resposta
        .status(201)
        .send(kanban.criarTarefa(parametros.data.idDemanda, tarefa, estado));
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.put('/api/kanban/tarefas/:idTarefa', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeTarefa.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    const dados = esquemaDeDadosDeTarefa.partial().safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }
    try {
      return kanban.atualizarTarefa(parametros.data.idTarefa, dados.data);
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.post('/api/kanban/tarefas/:idTarefa/mover', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeTarefa.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    const dados = esquemaDoMovimento.safeParse(requisicao.body);
    if (!dados.success) {
      return responderErroDeValidacao(resposta, dados.error);
    }
    try {
      return kanban.moverTarefa(
        parametros.data.idTarefa,
        dados.data.estado,
        dados.data.indice ?? Number.POSITIVE_INFINITY,
      );
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  servidor.delete('/api/kanban/tarefas/:idTarefa', async (requisicao, resposta) => {
    const parametros = esquemaDeParametrosDeTarefa.safeParse(requisicao.params);
    if (!parametros.success) {
      return responderErroDeValidacao(resposta, parametros.error);
    }
    try {
      kanban.removerTarefa(parametros.data.idTarefa);
      return resposta.status(204).send();
    } catch (erro) {
      return responder(resposta, erro);
    }
  });

  /*
   * Histórico de colunas: de um cliente (`?clienteId=`) ou de todos, a partir de
   * `?desde=` (ISO). Base para gráficos de fluxo e para o MCP da fase seguinte.
   */
  servidor.get('/api/kanban/transicoes', async (requisicao, resposta) => {
    const filtro = esquemaDoFiltroDeTransicoes.safeParse(requisicao.query ?? {});
    if (!filtro.success) {
      return responderErroDeValidacao(resposta, filtro.error);
    }
    return {
      transicoes: kanban.transicoes({
        ...(filtro.data.clienteId ? { clienteId: filtro.data.clienteId } : {}),
        ...(filtro.data.desde ? { desde: filtro.data.desde } : {}),
      }),
    };
  });
}
