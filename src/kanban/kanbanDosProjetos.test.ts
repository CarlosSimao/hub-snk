import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  DadosDoKanbanInvalidosError,
  DemandaNaoEncontradaError,
  KanbanDosProjetos,
} from './kanbanDosProjetos.ts';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PROJETO = '22222222-2222-4222-8222-222222222222';
const OUTRO_PROJETO = '33333333-3333-4333-8333-333333333333';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-kanban-'));
after(() => rmSync(pasta, { recursive: true, force: true }));

function criarKanban(): KanbanDosProjetos {
  return new KanbanDosProjetos(mkdtempSync(join(pasta, 'dados-')));
}

function documentoDeTexto(texto: string) {
  return { nome: 'escopo.md', tipo: 'md' as const, bruto: Buffer.from(texto), texto };
}

describe('KanbanDosProjetos', () => {
  it('cria kanban sem documento e com documento', () => {
    const kanban = criarKanban();

    const vazio = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'Projeto X' });
    assert.equal(vazio.situacao, 'sem-documento');
    assert.equal(vazio.documento, null);

    const comDocumento = kanban.criarDemanda(CLIENTE, {
      projetoId: PROJETO,
      nome: 'Escopo',
      documento: documentoDeTexto('Criar tela de pedidos'),
    });
    assert.equal(comDocumento.situacao, 'enviado');
    assert.equal(comDocumento.documento?.caracteres, 21);
    assert.equal(kanban.conteudoDoDocumento(comDocumento.id)?.texto, 'Criar tela de pedidos');

    assert.equal(kanban.doCliente(CLIENTE).demandas.length, 2);
    kanban.close();
  });

  it('recusa kanban sem nome', () => {
    const kanban = criarKanban();
    assert.throws(
      () => kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: '  ' }),
      DadosDoKanbanInvalidosError,
    );
    kanban.close();
  });

  it('reanálise troca só as tarefas que continuam no Backlog', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, {
      projetoId: PROJETO,
      nome: 'Escopo',
      documento: documentoDeTexto('escopo'),
    });
    const primeira = kanban.registrarAnalise(demanda.id, {
      resumo: 'r',
      tarefas: [{ titulo: 'A' }, { titulo: 'B' }, { titulo: '' }],
      assistente: 'claude',
      modelo: 'sonnet',
    });
    assert.deepEqual(primeira, { criadas: 2, mantidas: 0 });

    const tarefaA = kanban.tarefasDaDemanda(demanda.id).find((tarefa) => tarefa.titulo === 'A');
    assert.ok(tarefaA);
    kanban.moverTarefa(tarefaA.id, 'em_andamento', 0);

    const segunda = kanban.registrarAnalise(demanda.id, {
      resumo: 'r2',
      tarefas: [{ titulo: 'C' }],
      assistente: 'codex',
      modelo: '',
    });
    assert.deepEqual(segunda, { criadas: 1, mantidas: 1 });

    const titulos = kanban
      .tarefasDaDemanda(demanda.id)
      .map((tarefa) => `${tarefa.estado}:${tarefa.titulo}`)
      .sort();
    assert.deepEqual(titulos, ['backlog:C', 'em_andamento:A']);
    const atualizada = kanban.demanda(demanda.id);
    assert.equal(atualizada.situacao, 'analisado');
    assert.equal(atualizada.assistente, 'codex');
    kanban.close();
  });

  it('normaliza tipo, prioridade e horas vindos da IA', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K' });
    const tarefa = kanban.criarTarefa(demanda.id, {
      titulo: 'T',
      tipo: 'qualquer',
      prioridade: 'Média',
      estimativaHoras: 2.26,
    });
    assert.equal(tarefa.tipo, 'outro');
    assert.equal(tarefa.prioridade, 'media');
    assert.equal(tarefa.estimativaHoras, 2.5);
    kanban.close();
  });

  it('mantém a ordem densa ao mover e registra só a troca de coluna', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K' });
    const [a, b, c] = ['A', 'B', 'C'].map((titulo) => kanban.criarTarefa(demanda.id, { titulo }));
    assert.ok(a && b && c);

    kanban.moverTarefa(c.id, 'backlog', 0);
    assert.deepEqual(
      kanban.tarefasDaDemanda(demanda.id).map((tarefa) => [tarefa.titulo, tarefa.ordem]),
      [
        ['C', 0],
        ['A', 1],
        ['B', 2],
      ],
    );

    kanban.moverTarefa(a.id, 'concluido', 5);
    const backlog = kanban
      .tarefasDaDemanda(demanda.id)
      .filter((tarefa) => tarefa.estado === 'backlog')
      .map((tarefa) => [tarefa.titulo, tarefa.ordem]);
    assert.deepEqual(backlog, [
      ['C', 0],
      ['B', 1],
    ]);

    const origens = kanban.transicoes({ clienteId: CLIENTE }).map((transicao) => transicao.origem);
    assert.deepEqual(origens, ['criada', 'criada', 'criada', 'movida']);
    kanban.close();
  });

  it('remover o documento mantém o quadro', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, {
      projetoId: PROJETO,
      nome: 'K',
      documento: documentoDeTexto('escopo'),
    });
    kanban.criarTarefa(demanda.id, { titulo: 'T' });
    const arquivo = kanban.conteudoDoDocumento(demanda.id)?.arquivo ?? '';
    assert.ok(existsSync(arquivo));

    const semDocumento = kanban.removerDocumento(demanda.id);
    assert.equal(semDocumento.situacao, 'sem-documento');
    assert.equal(kanban.tarefasDaDemanda(demanda.id).length, 1);
    assert.equal(existsSync(arquivo), false);
    kanban.close();
  });

  it('desvincula do projeto excluído e vincula a outro', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K' });

    kanban.desvincularDoProjeto(CLIENTE, PROJETO);
    assert.equal(kanban.demanda(demanda.id).projetoId, '');

    const vinculada = kanban.alterarDemanda(demanda.id, { projetoId: OUTRO_PROJETO, nome: 'K2' });
    assert.equal(vinculada.projetoId, OUTRO_PROJETO);
    assert.equal(vinculada.nome, 'K2');
    kanban.close();
  });

  it('exclui as demandas do projeto com as tarefas', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K' });
    kanban.criarTarefa(demanda.id, { titulo: 'T' });
    kanban.criarDemanda(CLIENTE, { projetoId: OUTRO_PROJETO, nome: 'Outro' });

    kanban.removerDoProjeto(CLIENTE, PROJETO);

    assert.throws(() => kanban.demanda(demanda.id), DemandaNaoEncontradaError);
    const restante = kanban.doCliente(CLIENTE);
    assert.deepEqual(
      restante.demandas.map((item) => item.nome),
      ['Outro'],
    );
    assert.equal(restante.tarefas.length, 0);
    kanban.close();
  });

  it('marca como falha a análise interrompida por reinício', () => {
    const dados = mkdtempSync(join(pasta, 'reinicio-'));
    const primeiro = new KanbanDosProjetos(dados);
    const demanda = primeiro.criarDemanda(CLIENTE, {
      projetoId: PROJETO,
      nome: 'K',
      documento: documentoDeTexto('escopo'),
    });
    primeiro.marcarAnalisando(demanda.id);
    primeiro.close();

    const segundo = new KanbanDosProjetos(dados);
    assert.equal(segundo.demanda(demanda.id).situacao, 'falhou');
    segundo.close();
  });

  it('guarda a lista de verificação limpa, e avisa com o cliente', () => {
    const kanban = criarKanban();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K' });
    const avisos: string[] = [];
    kanban.aoMudar((mudanca) => avisos.push(mudanca.clienteId));

    const tarefa = kanban.criarTarefa(demanda.id, {
      titulo: 'T',
      checklist: [
        { texto: ' Criar tabela ', feito: true },
        { texto: '   ', feito: false },
        { texto: 'Testar', feito: false },
      ],
    });
    assert.deepEqual(tarefa.checklist, [
      { texto: 'Criar tabela', feito: true },
      { texto: 'Testar', feito: false },
    ]);

    const marcada = kanban.atualizarTarefa(tarefa.id, {
      checklist: [
        { texto: 'Criar tabela', feito: true },
        { texto: 'Testar', feito: true },
      ],
    });
    assert.equal(marcada.checklist.filter((item) => item.feito).length, 2);
    assert.deepEqual(avisos, [CLIENTE, CLIENTE]);
    kanban.close();
  });
});
