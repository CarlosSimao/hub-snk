/**
 * Escopo do cliente: envio do documento, análise por IA e o kanban de tarefas.
 *
 * O upload vai como base64 dentro do JSON — o projeto não tem plugin de multipart, e um
 * documento de escopo cabe folgado no limite abaixo. A análise leva minutos, então roda
 * em segundo plano: a rota responde na hora e a tela acompanha o `status` do documento.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { extname } from 'node:path';
import { Escopo, EscopoUsoError, ehEstado, type TarefaEntrada } from './sankhya/escopo.ts';
import { DocxInvalidoError, textoDoDocx } from './sankhya/docxTexto.ts';
import { AnaliseEscopoError, resumoComDuvidas, type ResultadoAnalise } from './sankhya/escopoIa.ts';
import type { Clientes } from './sankhya/clientes.ts';

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
  for (const campo of ['titulo', 'descricao', 'grupo', 'tipo', 'prioridade', 'criteriosAceite'] as const) {
    if (typeof c[campo] === 'string') saida[campo] = c[campo] as string;
  }
  if (c['estimativaHoras'] !== undefined) saida.estimativaHoras = Number(c['estimativaHoras']);
  return saida;
}

export function registerRoutesEscopo(app: FastifyInstance, deps: RouteEscopoDeps): void {
  const { escopo, clientes, analisar, log } = deps;
  /** Documentos com análise em curso NESTE processo — impede disparar a mesma duas vezes. */
  const emAnalise = new Set<number>();

  app.get<{ Params: { id: string } }>('/api/clientes/:id/escopo', async (request, reply) => {
    const clienteId = numero(request.params.id);
    if (!clienteId || !clientes.obter(clienteId)) return reply.code(404).send({ error: 'cliente não encontrado' });
    return { documentos: escopo.documentos(clienteId), tarefas: escopo.tarefas(clienteId) };
  });

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
        return { documento: escopo.adicionarDocumento(clienteId, { nome, tipo, bruto, texto }) };
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
    if (!docId || !escopo.removerDocumento(docId)) return reply.code(404).send({ error: 'documento não encontrado' });
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
