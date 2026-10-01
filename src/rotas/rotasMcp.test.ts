import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { KanbanDosProjetos } from '../kanban/kanbanDosProjetos.ts';
import { RepositorioClientesArquivo } from '../repositorio/repositorioClientesArquivo.ts';
import { registrarRotasDeMcp } from './rotasMcp.ts';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-rotas-mcp-'));
const kanbansAbertos: KanbanDosProjetos[] = [];
after(() => {
  for (const kanban of kanbansAbertos) kanban.close();
  rmSync(pasta, { recursive: true, force: true });
});

async function criarCenario(): Promise<{
  servidor: FastifyInstance;
  kanban: KanbanDosProjetos;
  liberado: number;
  fechado: number;
  tarefaLiberada: number;
  tarefaFechada: number;
}> {
  const dados = mkdtempSync(join(pasta, 'dados-'));
  const clientes = new RepositorioClientesArquivo(dados);
  const kanban = new KanbanDosProjetos(dados);
  kanbansAbertos.push(kanban);
  const cliente = await clientes.criar({ nome: 'Indústria Alfa' });
  const projeto = await clientes.adicionarProjeto(cliente.id, { nome: 'Portal de pedidos' });

  const liberado = kanban.criarDemanda(cliente.id, { projetoId: projeto.id, nome: 'Liberado' });
  kanban.definirMcp(liberado.id, true);
  const fechado = kanban.criarDemanda(cliente.id, { projetoId: projeto.id, nome: 'Fechado' });
  const tarefaLiberada = kanban.criarTarefa(liberado.id, {
    titulo: 'Criar tabela',
    notas: 'início',
  });
  const tarefaFechada = kanban.criarTarefa(fechado.id, { titulo: 'Secreta' });

  const servidor = Fastify();
  registrarRotasDeMcp(servidor, {
    kanban,
    clientes,
    enderecoDoHub: 'http://127.0.0.1:4100',
    arquivoDoToken: '',
  });
  return {
    servidor,
    kanban,
    liberado: liberado.id,
    fechado: fechado.id,
    tarefaLiberada: tarefaLiberada.id,
    tarefaFechada: tarefaFechada.id,
  };
}

describe('rotas do MCP', () => {
  it('lista só os kanbans liberados, com cliente e projeto', async () => {
    const { servidor } = await criarCenario();

    const resposta = await servidor.inject({ url: '/api/mcp/kanbans' });

    const { kanbans } = resposta.json<{
      kanbans: { kanban: string; cliente: string; projeto: string }[];
    }>();
    assert.deepEqual(
      kanbans.map(({ kanban, cliente, projeto }) => [kanban, cliente, projeto]),
      [['Liberado', 'Indústria Alfa', 'Portal de pedidos']],
    );
  });

  it('kanban e tarefa não liberados respondem 404', async () => {
    const { servidor, fechado, tarefaFechada } = await criarCenario();

    assert.equal((await servidor.inject({ url: `/api/mcp/kanbans/${fechado}` })).statusCode, 404);
    const mover = await servidor.inject({
      method: 'POST',
      url: `/api/mcp/tarefas/${tarefaFechada}/mover`,
      payload: { estado: 'concluido' },
    });
    assert.equal(mover.statusCode, 404);
  });

  it('move pelo rótulo, acrescenta notas e cria no Backlog', async () => {
    const { servidor, kanban, liberado, tarefaLiberada } = await criarCenario();

    const movida = await servidor.inject({
      method: 'POST',
      url: `/api/mcp/tarefas/${tarefaLiberada}/mover`,
      payload: { estado: 'Em andamento' },
    });
    assert.equal(movida.json<{ tarefa: { estado: string } }>().tarefa.estado, 'em_andamento');

    await servidor.inject({
      method: 'PUT',
      url: `/api/mcp/tarefas/${tarefaLiberada}/notas`,
      payload: { notas: 'tabela criada' },
    });
    assert.equal(kanban.tarefa(tarefaLiberada).notas, 'início\ntabela criada');

    const criada = await servidor.inject({
      method: 'POST',
      url: `/api/mcp/kanbans/${liberado}/tarefas`,
      payload: {
        titulo: 'Achado no caminho',
        criteriosAceite: ['um', 'dois'],
        estado: 'concluido',
      },
    });
    assert.equal(criada.statusCode, 201);
    const { tarefa } = criada.json<{ tarefa: { estado: string; criteriosAceite: string[] } }>();
    assert.equal(tarefa.estado, 'backlog');
    assert.deepEqual(tarefa.criteriosAceite, ['um', 'dois']);
  });

  it('mudancas_desde traz as trocas de coluna depois do cursor', async () => {
    const { servidor, tarefaLiberada } = await criarCenario();
    const { agora } = (await servidor.inject({ url: '/api/mcp/mudancas' })).json<{
      agora: string;
    }>();
    await new Promise((resolver) => setTimeout(resolver, 5));
    await servidor.inject({
      method: 'POST',
      url: `/api/mcp/tarefas/${tarefaLiberada}/mover`,
      payload: { estado: 'concluido' },
    });

    const mudancas = (
      await servidor.inject({ url: `/api/mcp/mudancas?desde=${encodeURIComponent(agora)}` })
    ).json<{ transicoes: { para: string; origem: string }[]; tarefas: unknown[] }>();

    assert.deepEqual(
      mudancas.transicoes.map(({ para, origem }) => [para, origem]),
      [['concluido', 'movida']],
    );
    assert.equal(mudancas.tarefas.length, 1);
  });

  it('a configuração aponta para o servidor MCP com o endereço do hub', async () => {
    const { servidor } = await criarCenario();

    const configuracao = (await servidor.inject({ url: '/api/mcp/configuracao' })).json<{
      command: string;
      args: string[];
      env: Record<string, string>;
    }>();

    assert.equal(configuracao.command, process.execPath);
    assert.match(configuracao.args[0] ?? '', /servidorMcp\.ts$/);
    assert.equal(configuracao.env['HUB_SNK_URL'], 'http://127.0.0.1:4100');
  });
});

describe('lista de verificação pelo MCP', () => {
  type ListaDoAgente = {
    tarefa: { checklist: { indice: number; texto: string; feito: boolean }[] };
  };

  it('cria no fim ou na posição pedida, altera e exclui itens', async () => {
    const { servidor, tarefaLiberada } = await criarCenario();
    const url = `/api/mcp/tarefas/${tarefaLiberada}/lista`;
    const textos = (corpo: ListaDoAgente) =>
      corpo.tarefa.checklist.map((item) => `${item.indice}:${item.texto}:${item.feito}`);

    const primeiro = await servidor.inject({
      method: 'POST',
      url,
      payload: { texto: 'Criar tabela' },
    });
    assert.equal(primeiro.statusCode, 201);
    await servidor.inject({ method: 'POST', url, payload: { texto: 'Testar', feito: true } });
    const noMeio = await servidor.inject({
      method: 'POST',
      url,
      payload: { texto: 'Criar tela', posicao: 1 },
    });
    assert.equal(noMeio.json<{ indice: number }>().indice, 1);
    assert.deepEqual(textos(noMeio.json<ListaDoAgente>()), [
      '0:Criar tabela:false',
      '1:Criar tela:false',
      '2:Testar:true',
    ]);

    const alterado = await servidor.inject({
      method: 'PUT',
      url: `${url}/1`,
      payload: { texto: 'Criar tela de pedidos', feito: true },
    });
    assert.deepEqual(textos(alterado.json<ListaDoAgente>())[1], '1:Criar tela de pedidos:true');

    const soTexto = await servidor.inject({
      method: 'PUT',
      url: `${url}/2`,
      payload: { texto: 'Testar envio' },
    });
    assert.deepEqual(textos(soTexto.json<ListaDoAgente>())[2], '2:Testar envio:true');

    const excluido = await servidor.inject({ method: 'DELETE', url: `${url}/0` });
    assert.deepEqual(textos(excluido.json<ListaDoAgente>()), [
      '0:Criar tela de pedidos:true',
      '1:Testar envio:true',
    ]);
  });

  it('recusa texto vazio, alteração sem nada, índice fora e a lista cheia', async () => {
    const { servidor, kanban, tarefaLiberada } = await criarCenario();
    const url = `/api/mcp/tarefas/${tarefaLiberada}/lista`;

    const vazio = await servidor.inject({ method: 'POST', url, payload: { texto: '   ' } });
    assert.equal(vazio.statusCode, 400);

    await servidor.inject({ method: 'POST', url, payload: { texto: 'Um' } });
    const semNada = await servidor.inject({ method: 'PUT', url: `${url}/0`, payload: {} });
    assert.equal(semNada.statusCode, 400);
    const fora = await servidor.inject({ method: 'DELETE', url: `${url}/3` });
    assert.equal(fora.statusCode, 404);

    kanban.atualizarTarefa(tarefaLiberada, {
      checklist: Array.from({ length: 50 }, (_item, posicao) => ({
        texto: `Item ${posicao}`,
        feito: false,
      })),
    });
    const cheia = await servidor.inject({ method: 'POST', url, payload: { texto: 'Mais um' } });
    assert.equal(cheia.statusCode, 400);
    assert.match(cheia.json<{ mensagem: string }>().mensagem, /50/);
  });

  it('marca o item pelo índice e recusa índice fora da lista', async () => {
    const { servidor, kanban, tarefaLiberada } = await criarCenario();
    kanban.atualizarTarefa(tarefaLiberada, {
      checklist: [
        { texto: 'Passo 1', feito: false },
        { texto: 'Passo 2', feito: false },
      ],
    });

    const marcada = await servidor.inject({
      method: 'PUT',
      url: `/api/mcp/tarefas/${tarefaLiberada}/lista/1`,
      payload: { feito: true },
    });
    assert.equal(marcada.statusCode, 200);
    const { tarefa } = marcada.json<{
      tarefa: { checklist: { indice: number; texto: string; feito: boolean }[] };
    }>();
    assert.deepEqual(tarefa.checklist[1], { indice: 1, texto: 'Passo 2', feito: true });

    const fora = await servidor.inject({
      method: 'PUT',
      url: `/api/mcp/tarefas/${tarefaLiberada}/lista/5`,
      payload: { feito: true },
    });
    assert.equal(fora.statusCode, 404);
  });
});

describe('servidor MCP por stdio', () => {
  it('conversa com o hub: initialize, tools/list e tools/call com o token', async () => {
    const { kanban, liberado } = await criarCenario();
    const dados = mkdtempSync(join(pasta, 'token-'));
    const arquivoDoToken = join(dados, 'token.txt');
    writeFileSync(arquivoDoToken, 'segredo');

    // Hub de teste que exige o mesmo cabeçalho do HUB SNK.
    const hub = Fastify();
    hub.addHook('onRequest', async (requisicao, resposta) => {
      if (requisicao.headers['x-hub-token'] !== 'segredo') {
        await resposta.status(401).send({ mensagem: 'sem token' });
      }
    });
    registrarRotasDeMcp(hub, {
      kanban,
      clientes: new RepositorioClientesArquivo(mkdtempSync(join(pasta, 'vazio-'))),
      enderecoDoHub: '',
      arquivoDoToken,
    });
    const endereco = await hub.listen({ port: 0, host: '127.0.0.1' });

    const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'servidorMcp.ts');
    const processo = spawn(process.execPath, [script], {
      env: { ...process.env, HUB_SNK_URL: endereco, HUB_SNK_TOKEN_FILE: arquivoDoToken },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const respostas = new Map<number, Record<string, unknown>>();
    let resto = '';
    processo.stdout.on('data', (parte: Buffer) => {
      resto += parte.toString('utf8');
      for (let quebra = resto.indexOf('\n'); quebra >= 0; quebra = resto.indexOf('\n')) {
        const linha = resto.slice(0, quebra);
        resto = resto.slice(quebra + 1);
        const mensagem = JSON.parse(linha) as { id: number };
        respostas.set(mensagem.id, mensagem as unknown as Record<string, unknown>);
      }
    });
    const pedir = async (id: number, method: string, params: unknown = {}) => {
      processo.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      for (let tentativa = 0; tentativa < 200 && !respostas.has(id); tentativa += 1) {
        await new Promise((resolver) => setTimeout(resolver, 25));
      }
      return respostas.get(id) as { result?: Record<string, unknown> };
    };

    try {
      const inicio = await pedir(1, 'initialize', { protocolVersion: '2025-06-18' });
      assert.equal(inicio.result?.['protocolVersion'], '2025-06-18');

      const lista = await pedir(2, 'tools/list');
      const nomes = (lista.result?.['tools'] as { name: string }[]).map(
        (ferramenta) => ferramenta.name,
      );
      assert.ok(nomes.includes('ler_kanban') && nomes.includes('mover_tarefa'));
      for (const ferramenta of [
        'adicionar_item_da_lista',
        'alterar_item_da_lista',
        'remover_item_da_lista',
      ]) {
        assert.ok(nomes.includes(ferramenta), ferramenta);
      }

      const leitura = await pedir(3, 'tools/call', {
        name: 'ler_kanban',
        arguments: { kanbanId: liberado },
      });
      const [conteudo] = leitura.result?.['content'] as { text: string }[];
      assert.equal(leitura.result?.['isError'], undefined);
      assert.match(conteudo?.text ?? '', /Criar tabela/);
    } finally {
      processo.stdin.end();
      processo.kill();
      await hub.close();
    }
  });
});
