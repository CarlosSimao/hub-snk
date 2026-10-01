/**
 * Servidor MCP do kanban do HUB SNK, para agentes de outras aplicações (Claude Code,
 * Codex, Cursor, Copilot...). Cada agente o registra na própria configuração — o bloco
 * pronto sai de Configurações › MCP — e o roda por stdio.
 *
 * Não abre o banco nem importa o resto do HUB SNK: fala só com `/api/mcp/*` (ver
 * `src/rotas/rotasMcp.ts`), que decide o que o agente vê — só os kanbans marcados como
 * "Disponível por MCP". Toda mudança feita aqui segue o mesmo caminho da tela.
 *
 * O HUB SNK precisa estar aberto. A API exige o token do shell: o servidor o lê do
 * arquivo que só o usuário do Windows enxerga, o mesmo que o shell usa.
 *
 * JSON-RPC por linha no stdin/stdout, sem SDK: o protocolo que as ferramentas usam cabe
 * aqui e o projeto não ganha dependência. Log vai para o stderr — o stdout é do protocolo.
 *
 *   HUB_SNK_URL         endereço do HUB SNK (padrão http://127.0.0.1:4100)
 *   HUB_SNK_TOKEN_FILE  arquivo com o token do shell; ausente, vai sem token
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const ENDERECO = (process.env['HUB_SNK_URL'] ?? 'http://127.0.0.1:4100').replace(/\/+$/, '');
const ARQUIVO_DO_TOKEN = process.env['HUB_SNK_TOKEN_FILE'] ?? '';
const VERSOES = ['2025-06-18', '2025-03-26', '2024-11-05'];
const ESTADOS = ['backlog', 'a_fazer', 'em_andamento', 'em_revisao', 'concluido'];
const TIPOS = [
  'backend',
  'frontend',
  'dados',
  'relatorio',
  'bi',
  'integracao',
  'configuracao',
  'teste',
  'documentacao',
  'outro',
];

type Json = Record<string, unknown>;

class HubError extends Error {}

/** Lido a cada chamada: o shell gera o token no primeiro boot e pode regravá-lo. */
function token(): string {
  if (!ARQUIVO_DO_TOKEN) return '';
  try {
    return readFileSync(ARQUIVO_DO_TOKEN, 'utf8').trim();
  } catch {
    throw new HubError('não consegui ler o token do HUB SNK — abra o aplicativo ao menos uma vez');
  }
}

async function hub(metodo: string, caminho: string, corpo?: Json): Promise<unknown> {
  const cabecalhos: Record<string, string> = {};
  const atual = token();
  if (atual) cabecalhos['x-hub-token'] = atual;
  if (corpo) cabecalhos['content-type'] = 'application/json';

  let resposta: Response;
  try {
    resposta = await fetch(`${ENDERECO}${caminho}`, {
      method: metodo,
      headers: cabecalhos,
      ...(corpo ? { body: JSON.stringify(corpo) } : {}),
    });
  } catch {
    throw new HubError(`o HUB SNK não respondeu em ${ENDERECO} — ele precisa estar aberto`);
  }
  const dados = (await resposta.json().catch(() => ({}))) as Json;
  if (!resposta.ok) {
    throw new HubError(String(dados['mensagem'] ?? `o HUB SNK respondeu ${resposta.status}`));
  }
  return dados;
}

function id(argumentos: Json, campo: string): number {
  const numero = Number(argumentos[campo]);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw new HubError(`informe "${campo}" (número inteiro)`);
  }
  return numero;
}

function indiceDe(argumentos: Json): number {
  const indice = Number(argumentos['indice']);
  if (!Number.isInteger(indice) || indice < 0) {
    throw new HubError('informe "indice" (inteiro a partir de 0)');
  }
  return indice;
}

interface Ferramenta {
  descricao: string;
  entrada: Json;
  executar: (argumentos: Json) => Promise<unknown>;
}

const FERRAMENTAS: Record<string, Ferramenta> = {
  listar_kanbans: {
    descricao:
      'Lista os kanbans do HUB SNK liberados para agentes, com cliente, projeto e a contagem de tarefas por coluna.',
    entrada: { type: 'object', properties: {} },
    executar: () => hub('GET', '/api/mcp/kanbans'),
  },
  ler_kanban: {
    descricao:
      'Lê um kanban: resumo do escopo e todas as tarefas (estado, notas, descrição, critérios de aceite). ' +
      'Releia antes de agir — pessoas e outros agentes mexem no mesmo quadro.',
    entrada: {
      type: 'object',
      properties: {
        kanbanId: { type: 'integer', description: 'id do kanban (de listar_kanbans)' },
      },
      required: ['kanbanId'],
    },
    executar: (argumentos) => hub('GET', `/api/mcp/kanbans/${id(argumentos, 'kanbanId')}`),
  },
  mudancas_desde: {
    descricao:
      'O que mudou no quadro desde um instante: tarefas alteradas e trocas de coluna (inclusive remoções). ' +
      'Guarde o "agora" da resposta e passe-o como "desde" na próxima chamada.',
    entrada: {
      type: 'object',
      properties: {
        desde: { type: 'string', description: 'data/hora ISO; vazio traz tudo' },
        kanbanId: { type: 'integer', description: 'limita a um kanban' },
      },
    },
    executar: (argumentos) => {
      const consulta = new URLSearchParams();
      if (typeof argumentos['desde'] === 'string' && argumentos['desde']) {
        consulta.set('desde', argumentos['desde']);
      }
      if (argumentos['kanbanId'] !== undefined) {
        consulta.set('kanbanId', String(id(argumentos, 'kanbanId')));
      }
      return hub('GET', `/api/mcp/mudancas${consulta.size ? `?${consulta}` : ''}`);
    },
  },
  mover_tarefa: {
    descricao:
      `Move a tarefa de coluna. Estados: ${ESTADOS.join(', ')}. Ao começar, em_andamento; pronta para ` +
      'conferência, em_revisao; entregue, concluido. A mudança aparece no quadro do HUB SNK.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        estado: { type: 'string', enum: ESTADOS },
        posicao: { type: 'integer', description: 'posição na coluna, 0 = topo; omitido = fim' },
      },
      required: ['tarefaId', 'estado'],
    },
    executar: (argumentos) =>
      hub('POST', `/api/mcp/tarefas/${id(argumentos, 'tarefaId')}/mover`, {
        estado: argumentos['estado'],
        ...(argumentos['posicao'] !== undefined ? { indice: argumentos['posicao'] } : {}),
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
    executar: (argumentos) =>
      hub('PUT', `/api/mcp/tarefas/${id(argumentos, 'tarefaId')}/notas`, {
        notas: String(argumentos['notas'] ?? ''),
        acrescentar: argumentos['substituir'] !== true,
      }),
  },
  adicionar_item_da_lista: {
    descricao:
      'Acrescenta um item à lista de verificação da tarefa — um passo a cumprir. Sem "posicao", ' +
      'vai para o fim. A lista tem no máximo 50 itens de até 300 caracteres.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        texto: { type: 'string' },
        feito: { type: 'boolean', default: false },
        posicao: { type: 'integer', description: 'onde inserir, a partir de 0; omitido = fim' },
      },
      required: ['tarefaId', 'texto'],
    },
    executar: (argumentos) =>
      hub('POST', `/api/mcp/tarefas/${id(argumentos, 'tarefaId')}/lista`, {
        texto: String(argumentos['texto'] ?? ''),
        feito: argumentos['feito'] === true,
        ...(argumentos['posicao'] !== undefined ? { posicao: argumentos['posicao'] } : {}),
      }),
  },
  alterar_item_da_lista: {
    descricao:
      'Altera um item da lista de verificação pela posição ("indice" em ler_kanban): o texto, ' +
      'a marcação ("feito") ou os dois.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        indice: { type: 'integer', description: 'posição do item na lista, a partir de 0' },
        texto: { type: 'string' },
        feito: { type: 'boolean' },
      },
      required: ['tarefaId', 'indice'],
    },
    executar: (argumentos) =>
      hub('PUT', `/api/mcp/tarefas/${id(argumentos, 'tarefaId')}/lista/${indiceDe(argumentos)}`, {
        ...(argumentos['texto'] !== undefined ? { texto: argumentos['texto'] } : {}),
        ...(argumentos['feito'] !== undefined ? { feito: argumentos['feito'] } : {}),
      }),
  },
  marcar_item_da_lista: {
    descricao:
      'Atalho de alterar_item_da_lista: marca (ou desmarca, com feito=false) um item da lista ' +
      'pela posição. Use ao terminar cada passo da tarefa.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        indice: { type: 'integer', description: 'posição do item na lista, a partir de 0' },
        feito: { type: 'boolean', default: true },
      },
      required: ['tarefaId', 'indice'],
    },
    executar: (argumentos) =>
      hub('PUT', `/api/mcp/tarefas/${id(argumentos, 'tarefaId')}/lista/${indiceDe(argumentos)}`, {
        feito: argumentos['feito'] !== false,
      }),
  },
  remover_item_da_lista: {
    descricao:
      'Exclui um item da lista de verificação pela posição. Os itens seguintes sobem uma posição: ' +
      'releia a tarefa antes de mexer em outro item pelo índice.',
    entrada: {
      type: 'object',
      properties: {
        tarefaId: { type: 'integer' },
        indice: { type: 'integer', description: 'posição do item na lista, a partir de 0' },
      },
      required: ['tarefaId', 'indice'],
    },
    executar: (argumentos) =>
      hub('DELETE', `/api/mcp/tarefas/${id(argumentos, 'tarefaId')}/lista/${indiceDe(argumentos)}`),
  },
  criar_tarefa: {
    descricao:
      'Cria uma tarefa nova no Backlog do kanban — para trabalho descoberto durante a execução. ' +
      'Não serve para reescrever tarefas existentes: título, estimativa e critérios delas ficam no HUB SNK.',
    entrada: {
      type: 'object',
      properties: {
        kanbanId: { type: 'integer' },
        titulo: { type: 'string' },
        descricao: { type: 'string' },
        funcionalidade: { type: 'string', description: 'funcionalidade que agrupa os cartões' },
        tipo: { type: 'string', enum: TIPOS },
        prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        estimativaHoras: { type: 'number' },
        criteriosAceite: { type: 'array', items: { type: 'string' } },
        checklist: {
          type: 'array',
          items: { type: 'string' },
          description: 'passos para marcar conforme a tarefa avança',
        },
        notas: { type: 'string' },
      },
      required: ['kanbanId', 'titulo'],
    },
    executar: (argumentos) => {
      const { kanbanId: _kanbanId, ...campos } = argumentos;
      return hub('POST', `/api/mcp/kanbans/${id(argumentos, 'kanbanId')}/tarefas`, campos);
    },
  },
};

const INSTRUCOES =
  'Kanban de tarefas do HUB SNK. Comece por listar_kanbans e ler_kanban. Pegue as tarefas de ' +
  'a_fazer (ou do backlog, por prioridade), mova para em_andamento ao começar e registre o ' +
  'andamento com anotar_tarefa. Antes de cada nova etapa, chame mudancas_desde: o quadro também ' +
  'é mexido por pessoas e por outros agentes.';

function responder(
  idDaMensagem: unknown,
  corpo: { result: unknown } | { error: { code: number; message: string } },
): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: idDaMensagem, ...corpo })}\n`);
}

async function tratar(mensagem: Json): Promise<void> {
  const metodo = String(mensagem['method'] ?? '');
  const parametros = (mensagem['params'] ?? {}) as Json;
  // Notificação (sem id) não tem resposta: `notifications/initialized` e afins.
  if (!('id' in mensagem)) return;
  const idDaMensagem = mensagem['id'];

  switch (metodo) {
    case 'initialize': {
      const pedida = String(parametros['protocolVersion'] ?? '');
      return responder(idDaMensagem, {
        result: {
          protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'hub-snk-kanban', version: '1.0.0' },
          instructions: INSTRUCOES,
        },
      });
    }
    case 'ping':
      return responder(idDaMensagem, { result: {} });
    case 'tools/list':
      return responder(idDaMensagem, {
        result: {
          tools: Object.entries(FERRAMENTAS).map(([name, ferramenta]) => ({
            name,
            description: ferramenta.descricao,
            inputSchema: ferramenta.entrada,
          })),
        },
      });
    case 'tools/call': {
      const nome = String(parametros['name'] ?? '');
      const ferramenta = FERRAMENTAS[nome];
      if (!ferramenta) {
        return responder(idDaMensagem, {
          error: { code: -32602, message: `ferramenta desconhecida: ${nome}` },
        });
      }
      try {
        const saida = await ferramenta.executar((parametros['arguments'] ?? {}) as Json);
        return responder(idDaMensagem, {
          result: { content: [{ type: 'text', text: JSON.stringify(saida, null, 2) }] },
        });
      } catch (erro) {
        // Erro de uso volta como resultado de ferramenta: é o agente que precisa lê-lo e corrigir.
        const texto =
          erro instanceof HubError ? erro.message : `falha inesperada: ${(erro as Error).message}`;
        return responder(idDaMensagem, {
          result: { content: [{ type: 'text', text: texto }], isError: true },
        });
      }
    }
    default:
      return responder(idDaMensagem, {
        error: { code: -32601, message: `método não suportado: ${metodo}` },
      });
  }
}

const pendentes = new Set<Promise<void>>();
const entrada = createInterface({ input: process.stdin });
entrada.on('line', (linha) => {
  if (!linha.trim()) return;
  let mensagem: Json;
  try {
    mensagem = JSON.parse(linha) as Json;
  } catch {
    return responder(null, { error: { code: -32700, message: 'JSON inválido' } });
  }
  const tarefa: Promise<void> = tratar(mensagem)
    .catch((erro: unknown) => {
      process.stderr.write(`hub-snk mcp: ${(erro as Error).message}\n`);
    })
    .finally(() => pendentes.delete(tarefa));
  pendentes.add(tarefa);
});
// O cliente fechou o stdin: termina as chamadas em curso antes de sair, senão a última resposta se perde.
entrada.on('close', () => void Promise.allSettled([...pendentes]).then(() => process.exit(0)));
