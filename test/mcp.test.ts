/**
 * Servidor MCP do kanban: o processo de verdade (`src/mcp/servidor.ts`) falando JSON-RPC
 * por stdio com um hub de teste em porta efêmera. O que importa aqui é a trava — só a
 * demanda liberada aparece — e que o que o agente faz entra no quadro pelo caminho da
 * tela (transição gravada, notas acrescentadas, tarefa nova no Backlog).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { Escopo } from '../src/sankhya/escopo.ts';
import type { Clientes } from '../src/sankhya/clientes.ts';
import { registerRoutesMcp } from '../src/routesMcp.ts';
import { dirTemporario } from './helpers.ts';

const SERVIDOR = fileURLToPath(new URL('../src/mcp/servidor.ts', import.meta.url));

class ClienteMcp {
  readonly #proc: ChildProcessWithoutNullStreams;
  readonly #espera = new Map<number, (msg: Record<string, unknown>) => void>();
  #proximo = 1;

  constructor(urlHub: string) {
    this.#proc = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', SERVIDOR], {
      env: { ...process.env, SANKHYA_HUB_URL: urlHub },
    });
    createInterface({ input: this.#proc.stdout }).on('line', (linha) => {
      const msg = JSON.parse(linha) as Record<string, unknown>;
      this.#espera.get(Number(msg['id']))?.(msg);
    });
  }

  pedir(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.#proximo++;
    return new Promise((resolve) => {
      this.#espera.set(id, resolve);
      this.#proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** Chama a ferramenta e devolve o JSON do texto, ou `{ erro }` quando veio `isError`. */
  async chamar(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const r = (await this.pedir('tools/call', { name, arguments: args }))['result'] as {
      content: { text: string }[];
      isError?: boolean;
    };
    const texto = r.content[0]!.text;
    return r.isError ? { erro: texto } : JSON.parse(texto);
  }

  fechar(): Promise<void> {
    return new Promise((resolve) => {
      this.#proc.once('exit', () => resolve());
      this.#proc.stdin.end();
    });
  }
}

describe('servidor MCP do kanban', () => {
  test('só a demanda liberada aparece e o que o agente faz entra no quadro', async () => {
    const dir = dirTemporario();
    const escopo = new Escopo(dir.path);
    const clientes = { obter: () => ({ nome: 'ACME' }) } as unknown as Clientes;
    const app = Fastify();
    registerRoutesMcp(app, { escopo, clientes, urlHub: '', nativo: true });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const endereco = app.server.address() as { port: number };
    const mcp = new ClienteMcp(`http://127.0.0.1:${endereco.port}`);

    try {
      const liberada = escopo.adicionarDocumento(1, { nome: 'portal.txt', tipo: 'txt', bruto: Buffer.from('x'), texto: 'x' });
      const fechada = escopo.adicionarDocumento(1, { nome: 'outra.txt', tipo: 'txt', bruto: Buffer.from('y'), texto: 'y' });
      const t1 = escopo.criarTarefa(1, { titulo: 'Tela de pedidos', documentoId: liberada.id, notas: 'começo' }, 'a_fazer');
      const tFechada = escopo.criarTarefa(1, { titulo: 'Segredo', documentoId: fechada.id });
      const avulsa = escopo.criarTarefa(1, { titulo: 'Avulsa' });

      const init = (await mcp.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {} }))['result'] as any;
      assert.equal(init.protocolVersion, '2025-06-18');
      assert.equal(init.serverInfo.name, 'DS-hub');
      const ferramentas = ((await mcp.pedir('tools/list'))['result'] as any).tools.map((f: { name: string }) => f.name);
      assert.deepEqual(ferramentas.sort(), [
        'anotar_tarefa',
        'criar_tarefa',
        'ler_demanda',
        'listar_demandas',
        'mover_tarefa',
        'mudancas_desde',
      ]);

      // Nada liberado ainda: o agente não vê nem lê.
      assert.deepEqual((await mcp.chamar('listar_demandas')).demandas, []);
      assert.ok((await mcp.chamar('ler_demanda', { documentoId: liberada.id })).erro);

      escopo.definirMcp(liberada.id, true);
      const lista = (await mcp.chamar('listar_demandas')).demandas;
      assert.deepEqual(lista.map((d: { documentoId: number }) => d.documentoId), [liberada.id]);
      assert.equal(lista[0].porEstado.a_fazer, 1);
      const lida = await mcp.chamar('ler_demanda', { documentoId: liberada.id });
      assert.deepEqual(lida.tarefas.map((t: { id: number }) => t.id), [t1.id]);

      // Tarefa de demanda fechada ou avulsa: como se não existisse.
      assert.ok((await mcp.chamar('mover_tarefa', { tarefaId: tFechada.id, estado: 'concluido' })).erro);
      assert.ok((await mcp.chamar('anotar_tarefa', { tarefaId: avulsa.id, notas: 'x' })).erro);
      assert.equal(escopo.tarefa(tFechada.id)!.estado, 'backlog');

      const cursor = (await mcp.chamar('mudancas_desde', { documentoId: liberada.id })).agora as string;

      const movida = await mcp.chamar('mover_tarefa', { tarefaId: t1.id, estado: 'Em andamento' });
      assert.equal(movida.tarefa.estado, 'em_andamento');
      assert.ok((await mcp.chamar('mover_tarefa', { tarefaId: t1.id, estado: 'voando' })).erro);
      const ultima = escopo.transicoes({ clienteId: 1 }).at(-1)!;
      assert.deepEqual([ultima.tarefaId, ultima.de, ultima.para, ultima.origem], [t1.id, 'a_fazer', 'em_andamento', 'movida']);

      await mcp.chamar('anotar_tarefa', { tarefaId: t1.id, notas: 'feito o grid' });
      assert.equal(escopo.tarefa(t1.id)!.notas, 'começo\nfeito o grid');
      await mcp.chamar('anotar_tarefa', { tarefaId: t1.id, notas: 'só isto', substituir: true });
      assert.equal(escopo.tarefa(t1.id)!.notas, 'só isto');

      const nova = await mcp.chamar('criar_tarefa', {
        documentoId: liberada.id,
        titulo: 'Validar CNPJ',
        tipo: 'backend',
        criteriosAceite: ['rejeita inválido', 'aceita com máscara'],
      });
      assert.equal(nova.tarefa.estado, 'backlog');
      assert.equal(nova.tarefa.documentoId, liberada.id);
      assert.equal(escopo.tarefa(nova.tarefa.id)!.criteriosAceite, 'rejeita inválido\naceita com máscara');
      assert.ok((await mcp.chamar('criar_tarefa', { documentoId: fechada.id, titulo: 'x' })).erro);

      const mudancas = await mcp.chamar('mudancas_desde', { desde: cursor });
      assert.ok(mudancas.tarefas.some((t: { id: number }) => t.id === t1.id));
      assert.ok(mudancas.transicoes.some((x: { para: string }) => x.para === 'em_andamento'));
      assert.ok(mudancas.tarefas.every((t: { documentoId: number }) => t.documentoId === liberada.id));

      // Desligar tira o acesso na hora.
      escopo.definirMcp(liberada.id, false);
      assert.deepEqual((await mcp.chamar('listar_demandas')).demandas, []);
    } finally {
      await mcp.fechar();
      await app.close();
      escopo.close();
      dir.remove();
    }
  });
});
