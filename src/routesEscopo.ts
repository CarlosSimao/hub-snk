/**
 * Escopo do cliente: envio do documento, análise por IA e o kanban de tarefas.
 *
 * O upload vai como base64 dentro do JSON — o projeto não tem plugin de multipart, e um
 * documento de escopo cabe folgado no limite abaixo. A análise leva minutos, então roda
 * em segundo plano: a rota responde na hora e a tela acompanha o `status` do documento.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import { Escopo, EscopoUsoError, ehEstado, type TarefaEntrada } from './sankhya/escopo.ts';
import { DocxInvalidoError, textoDoDocx } from './sankhya/docxTexto.ts';
import { AnaliseEscopoError, resumoComDuvidas, type ResultadoAnalise } from './sankhya/escopoIa.ts';
import {
  PASTA_TAREFAS,
  arquivoLivrePara,
  ignorarNoGit,
  type ResultadoGitignore,
  nomeDeArquivoSeguro,
  nomeSugerido,
  type CompartilhamentoTarefas,
} from './sankhya/escopoCompartilhado.ts';
import type { Clientes } from './sankhya/clientes.ts';
import type { DocumentoEscopo } from './types.ts';

/** Como o original volta para o visualizador. Texto vai como `text/plain` para nunca virar página. */
const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  md: 'text/plain; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** Arquivo original. O corpo JSON cresce ~1/3 com o base64 — daí o limite da rota ser maior. */
const LIMITE_ARQUIVO_BYTES = 20 * 1024 * 1024;
const LIMITE_CORPO_BYTES = 30 * 1024 * 1024;

const TIPOS_ACEITOS: Record<string, string> = {
  '.docx': 'docx',
  '.pdf': 'pdf',
  '.md': 'md',
  '.markdown': 'md',
  '.txt': 'txt',
};

export interface RouteEscopoDeps {
  escopo: Escopo;
  clientes: Clientes;
  compartilhamento: CompartilhamentoTarefas;
  /** Injetável para teste; em produção é o `analisarEscopo` que chama o `claude`. */
  analisar: (doc: { texto: string; tipo: string; arquivo: string; nome: string }) => Promise<ResultadoAnalise>;
  log?: { error: (obj: unknown, msg?: string) => void };
}

function numero(valor: string): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

function responderErro(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof EscopoUsoError || err instanceof DocxInvalidoError) {
    return reply.code(400).send({ error: err.message });
  }
  throw err;
}

function entradaDeTarefa(corpo: Record<string, unknown> | undefined): Partial<TarefaEntrada> {
  const c = corpo ?? {};
  const saida: Partial<TarefaEntrada> = {};
  for (const campo of ['titulo', 'descricao', 'grupo', 'tipo', 'prioridade', 'criteriosAceite', 'notas'] as const) {
    if (typeof c[campo] === 'string') saida[campo] = c[campo] as string;
  }
  if (c['estimativaHoras'] !== undefined) saida.estimativaHoras = Number(c['estimativaHoras']);
  if (c['documentoId'] === null) saida.documentoId = null;
  else if (c['documentoId'] !== undefined) saida.documentoId = numero(String(c['documentoId'])) || null;
  return saida;
}

export function registerRoutesEscopo(app: FastifyInstance, deps: RouteEscopoDeps): void {
  const { escopo, clientes, compartilhamento, analisar, log } = deps;
  /** Documentos com análise em curso NESTE processo — impede disparar a mesma duas vezes. */
  const emAnalise = new Set<number>();

  const comSituacao = (doc: DocumentoEscopo): DocumentoEscopo => {
    const situacao = compartilhamento.situacao(doc.id);
    return situacao ? { ...doc, compartilhamento: situacao } : doc;
  };

  /** O repositório do cliente é onde o agente de código já está trabalhando; sem ele, a pasta do hub. */
  const pastaSugerida = (clienteId: number): string => {
    const repo = clientes.obter(clienteId)?.repositorioLocal.trim() ?? '';
    return repo && isAbsolute(repo) && existsSync(repo) ? repo : escopo.pastaPadraoCompartilhada(clienteId);
  };

  app.get<{ Params: { id: string } }>('/api/clientes/:id/escopo', async (request, reply) => {
    const clienteId = numero(request.params.id);
    if (!clienteId || !clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });
    return {
      documentos: escopo.documentos(clienteId).map(comSituacao),
      tarefas: escopo.tarefas(clienteId),
      pastaSugerida: pastaSugerida(clienteId),
    };
  });

  app.get<{ Params: { docId: string }; Querystring: { baixar?: string } }>(
    '/api/escopo/documentos/:docId/arquivo',
    async (request, reply) => {
      const docId = numero(request.params.docId);
      const conteudo = docId ? escopo.conteudo(docId) : undefined;
      if (!conteudo || !conteudo.arquivo || !existsSync(conteudo.arquivo)) {
        return reply.code(404).send({ error: 'arquivo original não encontrado' });
      }
      const disposicao = request.query.baixar ? 'attachment' : 'inline';
      reply
        .header('content-type', CONTENT_TYPE[conteudo.tipo] ?? 'application/octet-stream')
        .header('content-disposition', `${disposicao}; filename*=UTF-8''${encodeURIComponent(conteudo.nome)}`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'no-store');
      return reply.send(createReadStream(conteudo.arquivo));
    },
  );

  /** Texto extraído: é a prévia de .docx/.md/.txt (o PDF o navegador mostra sozinho). */
  app.get<{ Params: { docId: string } }>('/api/escopo/documentos/:docId/texto', async (request, reply) => {
    const docId = numero(request.params.docId);
    const conteudo = docId ? escopo.conteudo(docId) : undefined;
    if (!conteudo) return reply.code(404).send({ error: 'documento não encontrado' });
    return { texto: conteudo.texto, tipo: conteudo.tipo, nome: conteudo.nome };
  });

  app.put<{ Params: { docId: string }; Body: { demanda?: unknown } }>(
    '/api/escopo/documentos/:docId',
    async (request, reply) => {
      const docId = numero(request.params.docId);
      try {
        const doc = docId ? escopo.renomearDemanda(docId, String(request.body?.demanda ?? '')) : undefined;
        if (!doc) return reply.code(404).send({ error: 'documento não encontrado' });
        return { documento: comSituacao(doc) };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.put<{
    Params: { docId: string };
    Body: { pasta?: unknown; nome?: unknown; criarPastaTarefas?: unknown; ignorarNoGit?: unknown };
  }>(
    '/api/escopo/documentos/:docId/compartilhamento',
    async (request, reply) => {
      const docId = numero(request.params.docId);
      const doc = docId ? escopo.documento(docId) : undefined;
      if (!doc) return reply.code(404).send({ error: 'documento não encontrado' });

      const informada = String(request.body?.pasta ?? '').trim();
      if (!informada) {
        compartilhamento.desligar(docId);
        return { documento: comSituacao(escopo.documento(docId)!) };
      }
      if (!isAbsolute(informada)) return reply.code(400).send({ error: 'informe o caminho completo da pasta' });

      const nome = nomeDeArquivoSeguro(String(request.body?.nome ?? '') || nomeSugerido(doc.demanda));
      if (!nome) return reply.code(400).send({ error: 'informe um nome para o arquivo' });

      // Só a pasta do próprio hub é criada: criar a digitada espalharia pastas por erro de digitação.
      // A subpasta Tarefas é criada DENTRO de uma que já existe — e não é repetida se já for ela.
      const base = resolve(informada);
      if (base === resolve(escopo.pastaPadraoCompartilhada(doc.clienteId))) {
        mkdirSync(base, { recursive: true });
      } else if (!existsSync(base) || !statSync(base).isDirectory()) {
        return reply.code(400).send({ error: `a pasta não existe: ${base}` });
      }
      const pasta =
        request.body?.criarPastaTarefas === true && basename(base).toLowerCase() !== PASTA_TAREFAS.toLowerCase()
          ? join(base, PASTA_TAREFAS)
          : base;
      mkdirSync(pasta, { recursive: true });

      const arquivo = join(pasta, nome);
      const outro = compartilhamento.quemUsa(arquivo, docId);
      if (outro !== undefined) {
        const dele = escopo.documento(outro);
        return reply
          .code(409)
          .send({ error: `a demanda "${dele?.demanda ?? outro}" já usa ${arquivo} — escolha outro nome` });
      }
      const ehOAtual = compartilhamento.situacao(docId)?.arquivo === arquivo;
      if (!ehOAtual && !arquivoLivrePara(arquivo, docId)) {
        return reply.code(409).send({ error: `já existe um arquivo ${nome} nesta pasta que não é do hub — escolha outro nome` });
      }

      compartilhamento.ligar(docId, pasta, nome);

      // Padrão ligado: só `false` explícito (a caixa desmarcada na tela) deixa o .gitignore em paz.
      let gitignore: ResultadoGitignore | { erro: string } | undefined;
      if (request.body?.ignorarNoGit !== false) {
        const ehTarefas = basename(pasta).toLowerCase() === PASTA_TAREFAS.toLowerCase();
        try {
          gitignore = ignorarNoGit(ehTarefas ? pasta : arquivo, ehTarefas);
        } catch (err) {
          gitignore = { erro: `não consegui atualizar o .gitignore: ${(err as Error).message}` };
        }
      }
      return { documento: comSituacao(escopo.documento(docId)!), gitignore };
    },
  );

  app.post<{ Params: { id: string }; Body: { nome?: unknown; conteudoBase64?: unknown } }>(
    '/api/clientes/:id/escopo/documentos',
    { bodyLimit: LIMITE_CORPO_BYTES },
    async (request, reply) => {
      const clienteId = numero(request.params.id);
      if (!clienteId || !clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });

      const nome = String(request.body?.nome ?? '').trim();
      const base64 = String(request.body?.conteudoBase64 ?? '');
      if (!nome || !base64) return reply.code(400).send({ error: 'informe { nome, conteudoBase64 }' });

      const extensao = extname(nome).toLowerCase();
      const tipo = TIPOS_ACEITOS[extensao];
      if (!tipo) {
        return reply.code(400).send({
          error:
            extensao === '.doc'
              ? '.doc (Word antigo) não é suportado — salve como .docx ou .pdf'
              : 'formato não suportado — envie .docx, .pdf, .md ou .txt',
        });
      }

      const bruto = Buffer.from(base64, 'base64');
      if (!bruto.length) return reply.code(400).send({ error: 'o arquivo veio vazio' });
      if (bruto.length > LIMITE_ARQUIVO_BYTES) return reply.code(413).send({ error: 'arquivo maior que 20 MB' });

      try {
        // PDF fica sem texto aqui: quem lê é a própria IA, no diretório isolado.
        const texto =
          tipo === 'docx' ? textoDoDocx(bruto) : tipo === 'pdf' ? '' : bruto.toString('utf8').replace(/^﻿/, '');
        return { documento: comSituacao(escopo.adicionarDocumento(clienteId, { nome, tipo, bruto, texto })) };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.post<{ Params: { docId: string } }>('/api/escopo/documentos/:docId/analisar', async (request, reply) => {
    const docId = numero(request.params.docId);
    const doc = docId ? escopo.documento(docId) : undefined;
    const conteudo = docId ? escopo.conteudo(docId) : undefined;
    if (!doc || !conteudo) return reply.code(404).send({ error: 'documento não encontrado' });
    if (emAnalise.has(docId)) return reply.code(409).send({ error: 'a análise deste documento já está em andamento' });

    emAnalise.add(docId);
    escopo.marcarAnalisando(docId);

    // Sem `await`: a análise leva minutos e a tela acompanha pelo status do documento.
    void (async () => {
      try {
        const resultado = await analisar(conteudo);
        escopo.registrarAnalise(docId, resumoComDuvidas(resultado), resultado.tarefas);
      } catch (err) {
        const mensagem = err instanceof AnaliseEscopoError ? err.message : `falha inesperada: ${(err as Error).message}`;
        if (!(err instanceof AnaliseEscopoError)) log?.error({ err, docId }, 'análise de escopo falhou');
        escopo.marcarFalha(docId, mensagem);
      } finally {
        emAnalise.delete(docId);
      }
    })();

    return reply.code(202).send({ documento: escopo.documento(docId) });
  });

  app.delete<{ Params: { docId: string } }>('/api/escopo/documentos/:docId', async (request, reply) => {
    const docId = numero(request.params.docId);
    if (emAnalise.has(docId)) return reply.code(409).send({ error: 'aguarde a análise terminar para remover' });
    if (!docId || !escopo.documento(docId)) return reply.code(404).send({ error: 'documento não encontrado' });
    compartilhamento.esquecer(docId);
    escopo.removerDocumento(docId);
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/clientes/:id/escopo/tarefas',
    async (request, reply) => {
      const clienteId = numero(request.params.id);
      if (!clienteId || !clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });
      const estado = String(request.body?.['estado'] ?? 'backlog');
      if (!ehEstado(estado)) return reply.code(400).send({ error: `estado desconhecido: ${estado}` });
      try {
        return { tarefa: escopo.criarTarefa(clienteId, { titulo: '', ...entradaDeTarefa(request.body) }, estado) };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.put<{ Params: { tarefaId: string }; Body: Record<string, unknown> }>(
    '/api/escopo/tarefas/:tarefaId',
    async (request, reply) => {
      const tarefaId = numero(request.params.tarefaId);
      try {
        const tarefa = tarefaId ? escopo.atualizarTarefa(tarefaId, entradaDeTarefa(request.body)) : undefined;
        if (!tarefa) return reply.code(404).send({ error: 'tarefa não encontrada' });
        return { tarefa };
      } catch (err) {
        return responderErro(reply, err);
      }
    },
  );

  app.post<{ Params: { tarefaId: string }; Body: { estado?: unknown; indice?: unknown } }>(
    '/api/escopo/tarefas/:tarefaId/mover',
    async (request, reply) => {
      const tarefaId = numero(request.params.tarefaId);
      const estado = String(request.body?.estado ?? '');
      if (!ehEstado(estado)) return reply.code(400).send({ error: `estado desconhecido: ${estado}` });
      const indice = Number(request.body?.indice ?? Number.MAX_SAFE_INTEGER);
      const tarefa = tarefaId ? escopo.mover(tarefaId, estado, indice) : undefined;
      if (!tarefa) return reply.code(404).send({ error: 'tarefa não encontrada' });
      return { tarefa };
    },
  );

  app.delete<{ Params: { tarefaId: string } }>('/api/escopo/tarefas/:tarefaId', async (request, reply) => {
    const tarefaId = numero(request.params.tarefaId);
    if (!tarefaId || !escopo.removerTarefa(tarefaId)) return reply.code(404).send({ error: 'tarefa não encontrada' });
    return { ok: true };
  });
}
