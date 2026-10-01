/**
 * O lado do HUB SNK do servidor MCP do kanban (`src/mcp/servidorMcp.ts`).
 *
 * O servidor MCP não abre o banco: fala só com estas rotas, e é aqui que mora a trava —
 * só o kanban marcado como "Disponível por MCP" aparece, e tarefa de kanban não
 * liberado responde 404 como se não existisse. Deixar o filtro no processo MCP seria
 * confiar num cliente que qualquer um pode trocar.
 *
 * Tudo passa pelos mesmos métodos que a tela usa: a transição de coluna é gravada e o
 * arquivo de tarefas é reescrito, sem o quadro saber que a mudança veio de um agente.
 *
 * O que um agente pode mudar: `estado` (com posição), `notas` e criar tarefa nova, que
 * sempre nasce no Backlog. Título, estimativa e critérios das tarefas existentes são o
 * escopo combinado com o cliente e continuam só na tela.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { estadoDoTexto } from '../kanban/arquivoDeTarefas.ts';
import {
  DadosDoKanbanInvalidosError,
  DemandaNaoEncontradaError,
  ITENS_MAXIMOS_DA_LISTA,
  TAMANHO_MAXIMO_DO_ITEM,
  TarefaNaoEncontradaError,
  type KanbanDosProjetos,
} from '../kanban/kanbanDosProjetos.ts';
import {
  ESTADOS_DE_TAREFA,
  type DemandaDoKanban,
  type EstadoDeTarefa,
  type TarefaDoKanban,
} from '../kanban/tiposDoKanban.ts';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';

const TAMANHO_MAXIMO_DAS_NOTAS = 4000;
const NOME_DO_SERVIDOR = 'hub-snk-kanban';

export interface DependenciasDoMcp {
  kanban: KanbanDosProjetos;
  clientes: RepositorioClientes;
  /** Endereço em que o processo MCP alcança este HUB SNK. */
  enderecoDoHub: string;
  /** O arquivo do token do shell; vazio quando a API roda sem token (desenvolvimento). */
  arquivoDoToken: string;
}

const esquemaDoId = z.coerce.number().int().positive();

function idDe(valor: unknown): number {
  const resultado = esquemaDoId.safeParse(valor);
  return resultado.success ? resultado.data : 0;
}

/** O que o agente vê de uma tarefa: sem ordem interna. */
function tarefaParaAgente(tarefa: TarefaDoKanban) {
  return {
    id: tarefa.id,
    kanbanId: tarefa.demandaId,
    titulo: tarefa.titulo,
    estado: tarefa.estado,
    notas: tarefa.notas,
    funcionalidade: tarefa.grupo,
    tipo: tarefa.tipo,
    prioridade: tarefa.prioridade,
    estimativaHoras: tarefa.estimativaHoras,
    descricao: tarefa.descricao,
    criteriosAceite: tarefa.criteriosDeAceite
      ? tarefa.criteriosDeAceite.split('\n').filter((linha) => linha.trim())
      : [],
    checklist: tarefa.checklist.map((item, indice) => ({ indice, ...item })),
    atualizadaEm: tarefa.atualizadaEm,
  };
}

function ordenadas(tarefas: TarefaDoKanban[]): TarefaDoKanban[] {
  const coluna = (estado: EstadoDeTarefa) => ESTADOS_DE_TAREFA.indexOf(estado);
  return [...tarefas].sort(
    (uma, outra) =>
      coluna(uma.estado) - coluna(outra.estado) || uma.ordem - outra.ordem || uma.id - outra.id,
  );
}

/** O script do servidor MCP, ao lado das rotas: `src/mcp/servidorMcp.ts`. */
function scriptDoServidor(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'servidorMcp.ts');
}

function naoLiberado(resposta: FastifyReply, oQue: 'kanban' | 'tarefa'): FastifyReply {
  return resposta.status(404).send({
    mensagem:
      oQue === 'kanban'
        ? 'Kanban não encontrado ou não liberado para MCP.'
        : 'Tarefa não encontrada ou de kanban não liberado para MCP.',
  });
}

export function registrarRotasDeMcp(
  servidor: FastifyInstance,
  dependencias: DependenciasDoMcp,
): void {
  const { kanban, clientes } = dependencias;

  function liberado(id: number): DemandaDoKanban | undefined {
    if (!id) return undefined;
    try {
      const demanda = kanban.demanda(id);
      return demanda.mcp ? demanda : undefined;
    } catch (erro) {
      if (erro instanceof DemandaNaoEncontradaError) return undefined;
      throw erro;
    }
  }

  function tarefaLiberada(id: number): TarefaDoKanban | undefined {
    if (!id) return undefined;
    try {
      const tarefa = kanban.tarefa(id);
      return liberado(tarefa.demandaId) ? tarefa : undefined;
    } catch (erro) {
      if (erro instanceof TarefaNaoEncontradaError) return undefined;
      throw erro;
    }
  }

  async function resumo(demanda: DemandaDoKanban) {
    const tarefas = kanban.tarefasDaDemanda(demanda.id);
    const porEstado = Object.fromEntries(ESTADOS_DE_TAREFA.map((estado) => [estado, 0])) as Record<
      EstadoDeTarefa,
      number
    >;
    for (const tarefa of tarefas) porEstado[tarefa.estado] += 1;
    const cliente = await clientes.buscarPorId(demanda.clienteId);
    const projeto = cliente?.projetos.find((item) => item.id === demanda.projetoId);
    return {
      kanbanId: demanda.id,
      kanban: demanda.nome,
      cliente: cliente?.nome ?? '',
      projeto: projeto?.nome ?? '',
      documentoDeEscopo: demanda.documento?.nome ?? '',
      tarefas: tarefas.length,
      porEstado,
      atualizadoEm: tarefas.reduce(
        (maisRecente, tarefa) =>
          tarefa.atualizadaEm > maisRecente ? tarefa.atualizadaEm : maisRecente,
        demanda.analisadaEm || demanda.criadaEm,
      ),
    };
  }

  /**
   * O bloco `mcpServers` para colar na configuração de cada agente. No aplicativo o
   * HUB SNK roda no Node do Electron: o mesmo executável serve, com `ELECTRON_RUN_AS_NODE`.
   */
  servidor.get('/api/mcp/configuracao', async () => {
    const env: Record<string, string> = { HUB_SNK_URL: dependencias.enderecoDoHub };
    if (dependencias.arquivoDoToken) env['HUB_SNK_TOKEN_FILE'] = dependencias.arquivoDoToken;
    if (process.versions['electron']) env['ELECTRON_RUN_AS_NODE'] = '1';
    const configuracao = { command: process.execPath, args: [scriptDoServidor()], env };
    return {
      nome: NOME_DO_SERVIDOR,
      ...configuracao,
      mcpServers: { [NOME_DO_SERVIDOR]: configuracao },
    };
  });

  /** Para a aba MCP das Configurações: os kanbans liberados, com cliente e projeto. */
  servidor.get('/api/mcp/kanbans', async () => ({
    estados: ESTADOS_DE_TAREFA,
    kanbans: await Promise.all(kanban.demandasNoMcp().map(resumo)),
  }));

  servidor.get('/api/mcp/kanbans/:id', async (requisicao, resposta) => {
    const demanda = liberado(idDe((requisicao.params as { id?: string }).id));
    if (!demanda) return naoLiberado(resposta, 'kanban');
    return {
      ...(await resumo(demanda)),
      resumoDoEscopo: demanda.resumo,
      tarefas: ordenadas(kanban.tarefasDaDemanda(demanda.id)).map(tarefaParaAgente),
    };
  });

  /**
   * O que mudou desde `?desde=` (ISO) nos kanbans liberados: tarefas alteradas e trocas
   * de coluna, inclusive remoções. `agora` é o cursor para a próxima chamada.
   */
  servidor.get('/api/mcp/mudancas', async (requisicao, resposta) => {
    const consulta = (requisicao.query ?? {}) as { desde?: string; kanbanId?: string };
    const informado = String(consulta.desde ?? '');
    if (informado && Number.isNaN(Date.parse(informado))) {
      return resposta.status(400).send({ mensagem: '"desde" deve ser uma data ISO.' });
    }
    // O banco guarda ISO em UTC e compara como texto: "-03:00" do agente vira "Z".
    const desde = informado ? new Date(informado).toISOString() : '';
    const agora = new Date().toISOString();
    const filtro = idDe(consulta.kanbanId);
    const liberados = kanban.demandasNoMcp().filter((demanda) => !filtro || demanda.id === filtro);
    const ids = new Set(liberados.map((demanda) => demanda.id));
    return {
      agora,
      tarefas: liberados
        .flatMap((demanda) => kanban.tarefasDaDemanda(demanda.id))
        .filter((tarefa) => !desde || tarefa.atualizadaEm > desde)
        .map(tarefaParaAgente),
      transicoes: kanban
        .transicoes(desde ? { desde } : {})
        .filter((transicao) => ids.has(transicao.demandaId) && (!desde || transicao.em > desde))
        .map(({ tarefaId, demandaId, de, para, em, origem }) => ({
          tarefaId,
          kanbanId: demandaId,
          de,
          para,
          em,
          origem,
        })),
    };
  });

  servidor.post('/api/mcp/tarefas/:id/mover', async (requisicao, resposta) => {
    const atual = tarefaLiberada(idDe((requisicao.params as { id?: string }).id));
    if (!atual) return naoLiberado(resposta, 'tarefa');
    const corpo = (requisicao.body ?? {}) as { estado?: unknown; indice?: unknown };
    const estado = estadoDoTexto(String(corpo.estado ?? ''));
    if (!estado) {
      return resposta
        .status(400)
        .send({ mensagem: `Estado desconhecido: use um de ${ESTADOS_DE_TAREFA.join(', ')}.` });
    }
    const indice = corpo.indice === undefined ? Number.POSITIVE_INFINITY : Number(corpo.indice);
    return { tarefa: tarefaParaAgente(kanban.moverTarefa(atual.id, estado, indice)) };
  });

  servidor.put('/api/mcp/tarefas/:id/notas', async (requisicao, resposta) => {
    const atual = tarefaLiberada(idDe((requisicao.params as { id?: string }).id));
    if (!atual) return naoLiberado(resposta, 'tarefa');
    const corpo = (requisicao.body ?? {}) as { notas?: unknown; acrescentar?: unknown };
    if (typeof corpo.notas !== 'string') {
      return resposta.status(400).send({ mensagem: 'Informe { notas }.' });
    }
    const texto = corpo.notas.trim();
    // Acrescentar é o padrão: um agente não apaga o registro de outro sem querer.
    const notas = corpo.acrescentar === false || !atual.notas ? texto : `${atual.notas}\n${texto}`;
    if (notas.length > TAMANHO_MAXIMO_DAS_NOTAS) {
      return resposta.status(400).send({
        mensagem: `As notas passariam de ${TAMANHO_MAXIMO_DAS_NOTAS} caracteres: resuma ou substitua.`,
      });
    }
    return { tarefa: tarefaParaAgente(kanban.atualizarTarefa(atual.id, { notas })) };
  });

  /**
   * A lista de verificação da tarefa: o agente cria, altera (texto e/ou marcação) e
   * exclui itens, sempre pela posição (`indice`, a partir de 0, como em `ler_kanban`).
   */
  function itemDaLista(
    requisicao: { params: unknown },
    resposta: FastifyReply,
  ): { tarefa: TarefaDoKanban; indice: number } | FastifyReply {
    const parametros = requisicao.params as { id?: string; indice?: string };
    const tarefa = tarefaLiberada(idDe(parametros.id));
    if (!tarefa) return naoLiberado(resposta, 'tarefa');
    const indice = Number(parametros.indice);
    if (!Number.isInteger(indice) || indice < 0 || indice >= tarefa.checklist.length) {
      return resposta.status(404).send({
        mensagem: tarefa.checklist.length
          ? `A tarefa tem ${tarefa.checklist.length} itens na lista: use um índice de 0 a ${tarefa.checklist.length - 1}.`
          : 'A tarefa não tem itens na lista.',
      });
    }
    return { tarefa, indice };
  }

  /** Texto do item vindo do agente: obrigatório ao criar, opcional ao alterar. */
  function textoDoItem(valor: unknown, resposta: FastifyReply): string | FastifyReply | undefined {
    if (valor === undefined) return undefined;
    if (typeof valor !== 'string' || !valor.trim()) {
      return resposta.status(400).send({ mensagem: 'O texto do item não pode ficar vazio.' });
    }
    if (valor.trim().length > TAMANHO_MAXIMO_DO_ITEM) {
      return resposta.status(400).send({
        mensagem: `O texto do item tem no máximo ${TAMANHO_MAXIMO_DO_ITEM} caracteres.`,
      });
    }
    return valor.trim();
  }

  servidor.post('/api/mcp/tarefas/:id/lista', async (requisicao, resposta) => {
    const atual = tarefaLiberada(idDe((requisicao.params as { id?: string }).id));
    if (!atual) return naoLiberado(resposta, 'tarefa');
    const corpo = (requisicao.body ?? {}) as {
      texto?: unknown;
      feito?: unknown;
      posicao?: unknown;
    };
    const texto = textoDoItem(corpo.texto ?? '', resposta);
    if (typeof texto !== 'string') return texto;
    if (atual.checklist.length >= ITENS_MAXIMOS_DA_LISTA) {
      return resposta
        .status(400)
        .send({ mensagem: `A lista já tem ${ITENS_MAXIMOS_DA_LISTA} itens, o máximo.` });
    }
    // Sem posição, vai para o fim; posição além do fim também.
    const posicao =
      corpo.posicao === undefined
        ? atual.checklist.length
        : Math.max(0, Math.min(Math.floor(Number(corpo.posicao)) || 0, atual.checklist.length));
    const checklist = [...atual.checklist];
    checklist.splice(posicao, 0, { texto, feito: corpo.feito === true });
    return resposta.status(201).send({
      tarefa: tarefaParaAgente(kanban.atualizarTarefa(atual.id, { checklist })),
      indice: posicao,
    });
  });

  servidor.put('/api/mcp/tarefas/:id/lista/:indice', async (requisicao, resposta) => {
    const alvo = itemDaLista(requisicao, resposta);
    if (!('tarefa' in alvo)) return alvo;
    const corpo = (requisicao.body ?? {}) as { texto?: unknown; feito?: unknown };
    if (corpo.feito !== undefined && typeof corpo.feito !== 'boolean') {
      return resposta.status(400).send({ mensagem: '"feito" deve ser true ou false.' });
    }
    const texto = textoDoItem(corpo.texto, resposta);
    if (texto !== undefined && typeof texto !== 'string') return texto;
    if (texto === undefined && corpo.feito === undefined) {
      return resposta.status(400).send({ mensagem: 'Informe { texto } e/ou { feito }.' });
    }
    const checklist = alvo.tarefa.checklist.map((item, posicao) =>
      posicao === alvo.indice
        ? {
            texto: texto ?? item.texto,
            feito: typeof corpo.feito === 'boolean' ? corpo.feito : item.feito,
          }
        : item,
    );
    return { tarefa: tarefaParaAgente(kanban.atualizarTarefa(alvo.tarefa.id, { checklist })) };
  });

  servidor.delete('/api/mcp/tarefas/:id/lista/:indice', async (requisicao, resposta) => {
    const alvo = itemDaLista(requisicao, resposta);
    if (!('tarefa' in alvo)) return alvo;
    const checklist = alvo.tarefa.checklist.filter((_item, posicao) => posicao !== alvo.indice);
    return { tarefa: tarefaParaAgente(kanban.atualizarTarefa(alvo.tarefa.id, { checklist })) };
  });

  servidor.post('/api/mcp/kanbans/:id/tarefas', async (requisicao, resposta) => {
    const demanda = liberado(idDe((requisicao.params as { id?: string }).id));
    if (!demanda) return naoLiberado(resposta, 'kanban');
    const corpo = (requisicao.body ?? {}) as Record<string, unknown>;
    const texto = (campo: string) =>
      typeof corpo[campo] === 'string' ? (corpo[campo] as string) : undefined;
    const criterios = Array.isArray(corpo['criteriosAceite'])
      ? (corpo['criteriosAceite'] as unknown[])
          .filter((linha): linha is string => typeof linha === 'string')
          .join('\n')
      : texto('criteriosAceite');
    try {
      const tarefa = kanban.criarTarefa(
        demanda.id,
        {
          titulo: texto('titulo') ?? '',
          ...(texto('descricao') !== undefined ? { descricao: texto('descricao') } : {}),
          ...((texto('funcionalidade') ?? texto('grupo')) !== undefined
            ? { grupo: texto('funcionalidade') ?? texto('grupo') }
            : {}),
          ...(texto('tipo') !== undefined ? { tipo: texto('tipo') } : {}),
          ...(texto('prioridade') !== undefined ? { prioridade: texto('prioridade') } : {}),
          ...(corpo['estimativaHoras'] !== undefined
            ? { estimativaHoras: Number(corpo['estimativaHoras']) }
            : {}),
          ...(criterios !== undefined ? { criteriosDeAceite: criterios } : {}),
          ...(texto('notas') !== undefined ? { notas: texto('notas') } : {}),
          ...(Array.isArray(corpo['checklist'])
            ? {
                checklist: (corpo['checklist'] as unknown[])
                  .filter((item): item is string => typeof item === 'string')
                  .map((item) => ({ texto: item, feito: false })),
              }
            : {}),
        },
        'backlog',
      );
      return resposta.status(201).send({ tarefa: tarefaParaAgente(tarefa) });
    } catch (erro) {
      if (erro instanceof DadosDoKanbanInvalidosError) {
        return resposta.status(400).send({ mensagem: erro.message });
      }
      throw erro;
    }
  });
}
