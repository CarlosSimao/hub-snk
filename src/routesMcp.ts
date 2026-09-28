/**
 * O lado do hub do servidor MCP (`src/mcp/servidor.ts`).
 *
 * O servidor MCP não abre o banco: fala só com estas rotas. É aqui que mora a trava —
 * só a demanda com `compartilharMcp` ligado aparece, e tarefa de demanda não liberada
 * (ou avulsa) responde 404 como se não existisse. Deixar o filtro no processo MCP seria
 * confiar num cliente que qualquer um pode trocar.
 *
 * Tudo passa pelos mesmos métodos do `Escopo` que a tela usa: a transição de coluna é
 * gravada, o arquivo compartilhado é reescrito e a Integração API envia a mudança sem
 * saber que ela veio de um agente.
 *
 * O que um agente pode mudar: `estado` (com posição), `notas` e criar tarefa nova — que
 * sempre nasce no Backlog da demanda. Título, estimativa e critérios das tarefas
 * existentes são o escopo combinado com o cliente e continuam só no hub.
 */
import type { FastifyInstance } from 'fastify';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EscopoUsoError, type Escopo } from './sankhya/escopo.ts';
import { estadoDoTexto } from './sankhya/escopoCompartilhado.ts';
import type { Clientes } from './sankhya/clientes.ts';
import { ESTADOS_TAREFA, type DocumentoEscopo, type EstadoTarefa, type TarefaEscopo } from './types.ts';

export interface RouteMcpDeps {
  escopo: Escopo;
  clientes: Clientes;
  /** Endereço em que o processo MCP alcança este hub. */
  urlHub: string;
  /** false no container: o caminho do script lá dentro não serve para um agente da máquina. */
  nativo: boolean;
}

const LIMITE_NOTAS = 4000;

function numero(valor: string): number {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** O que o agente vê de uma tarefa: sem ordem interna nem cliente (a demanda já diz). */
function tarefaParaAgente(t: TarefaEscopo) {
  return {
    id: t.id,
    documentoId: t.documentoId,
    titulo: t.titulo,
    estado: t.estado,
    notas: t.notas,
    funcionalidade: t.grupo,
    tipo: t.tipo,
    prioridade: t.prioridade,
    estimativaHoras: t.estimativaHoras,
    descricao: t.descricao,
    criteriosAceite: t.criteriosAceite ? t.criteriosAceite.split('\n').filter((l) => l.trim()) : [],
    atualizadaEm: t.atualizadaEm,
  };
}

function ordenadas(tarefas: TarefaEscopo[]): TarefaEscopo[] {
  const coluna = (e: EstadoTarefa) => ESTADOS_TAREFA.indexOf(e);
  return [...tarefas].sort((a, b) => coluna(a.estado) - coluna(b.estado) || a.ordem - b.ordem || a.id - b.id);
}

/** Onde está o script do servidor MCP — ao lado deste arquivo, em `src/` (dev) ou `dist/`. */
function scriptDoServidor(): { caminho: string; ts: boolean } {
  const aqui = fileURLToPath(import.meta.url);
  const ts = extname(aqui) === '.ts';
  return { caminho: join(dirname(aqui), 'mcp', ts ? 'servidor.ts' : 'servidor.js'), ts };
}

export function registerRoutesMcp(app: FastifyInstance, deps: RouteMcpDeps): void {
  const { escopo, clientes } = deps;

  const liberada = (docId: number): DocumentoEscopo | undefined => {
    const doc = docId ? escopo.documento(docId) : undefined;
    return doc?.compartilharMcp ? doc : undefined;
  };

  /** Tarefa só é visível pela demanda: avulsa não tem a quem pedir permissão. */
  const tarefaLiberada = (tarefaId: number): TarefaEscopo | undefined => {
    const t = tarefaId ? escopo.tarefa(tarefaId) : undefined;
    return t && t.documentoId !== null && liberada(t.documentoId) ? t : undefined;
  };

  const resumoDaDemanda = (doc: DocumentoEscopo) => {
    const tarefas = escopo.tarefasDaDemanda(doc.id);
    const porEstado = Object.fromEntries(ESTADOS_TAREFA.map((e) => [e, 0])) as Record<EstadoTarefa, number>;
    for (const t of tarefas) porEstado[t.estado] += 1;
    return {
      documentoId: doc.id,
      demanda: doc.demanda,
      cliente: clientes.obter(doc.clienteId)?.nome ?? String(doc.clienteId),
      documentoDeEscopo: doc.nome,
      tarefas: tarefas.length,
      porEstado,
      atualizadoEm: tarefas.reduce((m, t) => (t.atualizadaEm > m ? t.atualizadaEm : m), doc.analisadoEm || doc.enviadoEm),
    };
  };

  /** O que colar na configuração MCP de cada agente — a tela mostra pronto para copiar. */
  app.get('/api/mcp/config', async () => {
    const script = scriptDoServidor();
    const viaElectron = Boolean(process.versions['electron']);
    const env: Record<string, string> = { SANKHYA_HUB_URL: deps.urlHub };
    if (viaElectron) env['ELECTRON_RUN_AS_NODE'] = '1';
    const args = [...(script.ts ? ['--experimental-strip-types', '--no-warnings'] : []), script.caminho];
    return {
      disponivel: deps.nativo,
      ...(deps.nativo ? {} : { aviso: 'o hub está rodando em container: rode o servidor MCP a partir do repositório na sua máquina' }),
      nome: 'DS-hub',
      command: process.execPath,
      args,
      env,
    };
  });

  app.get('/api/mcp/demandas', async () => ({
    estados: ESTADOS_TAREFA,
    demandas: escopo.documentosMcp().map(resumoDaDemanda),
  }));

  app.get<{ Params: { docId: string } }>('/api/mcp/demandas/:docId', async (request, reply) => {
    const doc = liberada(numero(request.params.docId));
    if (!doc) return reply.code(404).send({ error: 'demanda não encontrada ou não liberada para MCP' });
    return {
      ...resumoDaDemanda(doc),
      resumoDoEscopo: doc.resumo,
      tarefas: ordenadas(escopo.tarefasDaDemanda(doc.id)).map(tarefaParaAgente),
    };
  });

  /**
   * O que mudou desde `?desde=` (ISO) nas demandas liberadas: tarefas alteradas e as
   * trocas de coluna (inclusive remoções). `agora` é o cursor para a próxima chamada.
   */
  app.get<{ Querystring: { desde?: string; documentoId?: string } }>('/api/mcp/mudancas', async (request, reply) => {
    const informado = String(request.query.desde ?? '');
    if (informado && Number.isNaN(Date.parse(informado))) return reply.code(400).send({ error: 'desde deve ser uma data ISO' });
    // O banco guarda ISO em UTC e compara como texto: "-03:00" do agente precisa virar "Z".
    const desde = informado ? new Date(informado).toISOString() : '';
    const agora = new Date().toISOString();
    const filtro = numero(request.query.documentoId ?? '');
    const docs = escopo.documentosMcp().filter((d) => !filtro || d.id === filtro);
    const ids = new Set(docs.map((d) => d.id));
    const tarefas = docs
      .flatMap((d) => escopo.tarefasDaDemanda(d.id))
      .filter((t) => !desde || t.atualizadaEm > desde)
      .map(tarefaParaAgente);
    const transicoes = escopo
      .transicoes(desde ? { desde } : {})
      .filter((x) => x.documentoId !== null && ids.has(x.documentoId) && x.origem !== 'carga-inicial')
      .filter((x) => !desde || x.em > desde)
      .map(({ tarefaId, documentoId, de, para, em, origem }) => ({ tarefaId, documentoId, de, para, em, origem }));
    return { agora, tarefas, transicoes };
  });

  app.post<{ Params: { tarefaId: string }; Body: { estado?: unknown; indice?: unknown } }>(
    '/api/mcp/tarefas/:tarefaId/mover',
    async (request, reply) => {
      const atual = tarefaLiberada(numero(request.params.tarefaId));
      if (!atual) return reply.code(404).send({ error: 'tarefa não encontrada ou de demanda não liberada para MCP' });
      const estado = estadoDoTexto(String(request.body?.estado ?? ''));
      if (!estado) return reply.code(400).send({ error: `estado desconhecido — use um de: ${ESTADOS_TAREFA.join(', ')}` });
      const indice = request.body?.indice === undefined ? Number.MAX_SAFE_INTEGER : Number(request.body.indice);
      return { tarefa: tarefaParaAgente(escopo.mover(atual.id, estado, indice)!) };
    },
  );

  app.put<{ Params: { tarefaId: string }; Body: { notas?: unknown; acrescentar?: unknown } }>(
    '/api/mcp/tarefas/:tarefaId/notas',
    async (request, reply) => {
      const atual = tarefaLiberada(numero(request.params.tarefaId));
      if (!atual) return reply.code(404).send({ error: 'tarefa não encontrada ou de demanda não liberada para MCP' });
      if (typeof request.body?.notas !== 'string') return reply.code(400).send({ error: 'informe { notas }' });
      const texto = request.body.notas.trim();
      // Acrescentar é o padrão das ferramentas: um agente não apaga o registro de outro sem querer.
      const notas = request.body.acrescentar === false || !atual.notas ? texto : `${atual.notas}\n${texto}`;
      if (notas.length > LIMITE_NOTAS) {
        return reply.code(400).send({ error: `as notas passariam de ${LIMITE_NOTAS} caracteres — resuma ou substitua` });
      }
      return { tarefa: tarefaParaAgente(escopo.atualizarTarefa(atual.id, { notas })!) };
    },
  );

  app.post<{ Params: { docId: string }; Body: Record<string, unknown> }>(
    '/api/mcp/demandas/:docId/tarefas',
    async (request, reply) => {
      const doc = liberada(numero(request.params.docId));
      if (!doc) return reply.code(404).send({ error: 'demanda não encontrada ou não liberada para MCP' });
      const c = request.body ?? {};
      const texto = (campo: string) => (typeof c[campo] === 'string' ? (c[campo] as string) : undefined);
      const criterios = Array.isArray(c['criteriosAceite'])
        ? (c['criteriosAceite'] as unknown[]).filter((l): l is string => typeof l === 'string').join('\n')
        : texto('criteriosAceite');
      try {
        const tarefa = escopo.criarTarefa(
          doc.clienteId,
          {
            titulo: texto('titulo') ?? '',
            descricao: texto('descricao'),
            grupo: texto('funcionalidade') ?? texto('grupo'),
            tipo: texto('tipo'),
            prioridade: texto('prioridade'),
            estimativaHoras: c['estimativaHoras'] === undefined ? undefined : Number(c['estimativaHoras']),
            criteriosAceite: criterios,
            notas: texto('notas'),
            documentoId: doc.id,
          },
          'backlog',
        );
        return { tarefa: tarefaParaAgente(tarefa) };
      } catch (err) {
        if (err instanceof EscopoUsoError) return reply.code(400).send({ error: err.message });
        throw err;
      }
    },
  );
}
