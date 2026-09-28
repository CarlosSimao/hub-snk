/**
 * Servidor MCP do kanban do hub, para agentes de outras aplicações (Claude Code, Codex,
 * Cursor, Copilot...). Cada agente o registra na própria configuração e o roda por stdio.
 *
 * Não abre o banco nem importa o resto do hub: fala só com `/api/mcp/*` (ver
 * `src/routesMcp.ts`), que decide o que o agente vê — só as demandas com "Acesso por MCP"
 * ligado na tela. Assim toda mudança feita aqui segue o mesmo caminho da tela: grava a
 * transição, atualiza o quadro e vai para a Integração API.
 *
 * JSON-RPC por linha no stdin/stdout, sem SDK: o protocolo que as ferramentas usam cabe
 * aqui e o projeto não ganha dependência. Log vai para o stderr — o stdout é do protocolo.
 *
 *   SANKHYA_HUB_URL  endereço do hub (padrão http://127.0.0.1:4000)
 */
import { createInterface } from 'node:readline';

const URL_HUB = (process.env['SANKHYA_HUB_URL'] ?? 'http://127.0.0.1:4000').replace(/\/+$/, '');
const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ESTADOS = ['backlog', 'a_fazer', 'em_andamento', 'em_revisao', 'concluido'];

type Json = Record<string, unknown>;

class HubError extends Error {}

async function hub(metodo: string, caminho: string, corpo?: Json): Promise<unknown> {
  let resposta: Response;
  try {
    resposta = await fetch(`${URL_HUB}${caminho}`, {
      method: metodo,
      ...(corpo ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) } : {}),
    });
  } catch {
    throw new HubError(`o Development Switch não respondeu em ${URL_HUB} — ele precisa estar aberto`);
  }
  const dados = (await resposta.json().catch(() => ({}))) as Json;
  if (!resposta.ok) throw new HubError(String(dados['error'] ?? `o hub respondeu ${resposta.status}`));
  return dados;
}

function id(args: Json, campo: string): number {
  const n = Number(args[campo]);
  if (!Number.isInteger(n) || n <= 0) throw new HubError(`informe "${campo}" (número inteiro)`);
  return n;
}

interface Ferramenta {
  descricao: string;
  entrada: Json;
  executar: (args: Json) => Promise<unknown>;
}

const FERRAMENTAS: Record<string, Ferramenta> = {
  listar_demandas: {
    descricao:
      'Lista as demandas do kanban do Development Switch liberadas para agentes, com a contagem de tarefas por coluna.',
    entrada: { type: 'object', properties: {} },
    executar: () => hub('GET', '/api/mcp/demandas'),
  },
  ler_demanda: {
    descricao:
      'Lê uma demanda: resumo do escopo e todas as tarefas (estado, notas, descrição, critérios de aceite). ' +
      'Releia antes de agir — pessoas e outros agentes mexem no mesmo quadro.',
    entrada: {
      type: 'object',
      properties: { documentoId: { type: 'integer', description: 'id da demanda (de listar_demandas)' } },
      required: ['documentoId'],
    },
    executar: (a) => hub('GET', `/api/mcp/demandas/${id(a, 'documentoId')}`),
  },
  mudancas_desde: {
    descricao:
      'O que mudou no quadro desde um instante: tarefas alteradas e trocas de coluna (inclusive remoções). ' +
      'Guarde o "agora" da resposta e passe-o como "desde" na próxima chamada.',
    entrada: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'data/hora ISO; vazio traz tudo' },
        documentoId: { type: 'integer', description: 'limita a uma demanda' },
      },
    },
    executar: (a) => {
      const q = new URLSearchParams();
      if (typeof a['desde'] === 'string' && a['desde']) q.set('desde', a['desde']);
      if (a['documentoId'] !== undefined) q.set('documentoId', String(id(a, 'documentoId')));
      return hub('GET', `/api/mcp/mudancas${q.size ? `?${q}` : ''}`);
    },
  },
  mover_tarefa: {
    descricao:
      `Move a tarefa de coluna. Estados: ${ESTADOS.join(', ')}. Ao começar, em_andamento; pronta para conferência, ` +
      'em_revisao; entregue, concluido. A mudança aparece no quadro e segue para a integração.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        estado: { type: 'string', enum: ESTADOS },
        posicao: { type: 'integer', description: 'posição na coluna, 0 = topo; omitido = fim' },
      },
      required: ['tarefaId', 'estado'],
    },
    executar: (a) =>
      hub('POST', `/api/mcp/tarefas/${id(a, 'tarefaId')}/mover`, {
        estado: a['estado'],
        ...(a['posicao'] !== undefined ? { indice: a['posicao'] } : {}),
      }),
  },
  anotar_tarefa: {
    descricao:
      'Registra andamento nas notas da tarefa: o que foi feito, onde (arquivos, commit) ou o que está bloqueando. ' +
      'Acrescenta ao que já existe; use substituir=true só para reescrever as notas inteiras.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        notas: { type: 'string' },
        substituir: { type: 'boolean', default: false },
      },
      required: ['tarefaId', 'notas'],
    },
    executar: (a) =>
      hub('PUT', `/api/mcp/tarefas/${id(a, 'tarefaId')}/notas`, {
        notas: String(a['notas'] ?? ''),
        acrescentar: a['substituir'] !== true,
      }),
  },
  criar_tarefa: {
    descricao:
      'Cria uma tarefa nova no Backlog da demanda — para trabalho descoberto durante a execução. ' +
      'Não serve para reescrever tarefas existentes: título, estimativa e critérios delas são mantidos no hub.',
    entrada: {
      type: 'object',
      properties: {
        documentoId: { type: 'integer' },
        titulo: { type: 'string' },
        descricao: { type: 'string' },
        funcionalidade: { type: 'string', description: 'feature/épico que agrupa os cartões' },
        tipo: {
          type: 'string',
          enum: ['backend', 'frontend', 'dados', 'relatorio', 'bi', 'integracao', 'configuracao', 'teste', 'documentacao', 'outro'],
        },
        prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        estimativaHoras: { type: 'number' },
        criteriosAceite: { type: 'array', items: { type: 'string' } },
        notas: { type: 'string' },
      },
      required: ['documentoId', 'titulo'],
    },
    executar: (a) => {
      const { documentoId: _, ...campos } = a;
      return hub('POST', `/api/mcp/demandas/${id(a, 'documentoId')}/tarefas`, campos);
    },
  },
};

const INSTRUCOES =
  'Kanban de tarefas do Development Switch (DS-hub). Comece por listar_demandas e ler_demanda. ' +
  'Pegue as tarefas de a_fazer (ou do backlog, por prioridade), mova para em_andamento ao começar e ' +
  'registre o andamento com anotar_tarefa. Antes de cada nova etapa, chame mudancas_desde: o quadro ' +
  'também é mexido por pessoas e por outros agentes.';

function responder(msgId: unknown, corpo: { result: unknown } | { error: { code: number; message: string } }): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: msgId, ...corpo })}\n`);
}

async function tratar(msg: Json): Promise<void> {
  const metodo = String(msg['method'] ?? '');
  const params = (msg['params'] ?? {}) as Json;
  // Notificação (sem id) não tem resposta — `notifications/initialized` e afins.
  if (!('id' in msg)) return;
  const msgId = msg['id'];

  switch (metodo) {
    case 'initialize': {
      const pedida = String(params['protocolVersion'] ?? '');
      return responder(msgId, {
        result: {
          protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'DS-hub', version: '0.1.0' },
          instructions: INSTRUCOES,
        },
      });
    }
    case 'ping':
      return responder(msgId, { result: {} });
    case 'tools/list':
      return responder(msgId, {
        result: {
          tools: Object.entries(FERRAMENTAS).map(([name, f]) => ({ name, description: f.descricao, inputSchema: f.entrada })),
        },
      });
    case 'tools/call': {
      const nome = String(params['name'] ?? '');
      const ferramenta = FERRAMENTAS[nome];
      if (!ferramenta) return responder(msgId, { error: { code: -32602, message: `ferramenta desconhecida: ${nome}` } });
      try {
        const saida = await ferramenta.executar((params['arguments'] ?? {}) as Json);
        return responder(msgId, { result: { content: [{ type: 'text', text: JSON.stringify(saida, null, 2) }] } });
      } catch (err) {
        // Erro de uso volta como resultado de ferramenta: é o agente que precisa lê-lo e corrigir a chamada.
        const texto = err instanceof HubError ? err.message : `falha inesperada: ${(err as Error).message}`;
        return responder(msgId, { result: { content: [{ type: 'text', text: texto }], isError: true } });
      }
    }
    default:
      return responder(msgId, { error: { code: -32601, message: `método não suportado: ${metodo}` } });
  }
}

const pendentes = new Set<Promise<void>>();
const entrada = createInterface({ input: process.stdin });
entrada.on('line', (linha) => {
  if (!linha.trim()) return;
  let msg: Json;
  try {
    msg = JSON.parse(linha) as Json;
  } catch {
    return responder(null, { error: { code: -32700, message: 'JSON inválido' } });
  }
  const p: Promise<void> = tratar(msg)
    .catch((err: unknown) => {
      process.stderr.write(`DS-hub mcp: ${(err as Error).message}\n`);
    })
    .finally(() => pendentes.delete(p));
  pendentes.add(p);
});
// O cliente fechou o stdin: termina as chamadas em curso antes de sair, senão a última resposta se perde.
entrada.on('close', () => void Promise.allSettled([...pendentes]).then(() => process.exit(0)));
