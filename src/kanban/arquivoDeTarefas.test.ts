import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { ArquivoDeTarefas, estadoDoTexto, slugDoNome } from './arquivoDeTarefas.ts';
import { KanbanDosProjetos } from './kanbanDosProjetos.ts';

const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PROJETO = '22222222-2222-4222-8222-222222222222';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-arquivo-de-tarefas-'));
const abertos: { kanban: KanbanDosProjetos; arquivo: ArquivoDeTarefas }[] = [];
after(() => {
  for (const { kanban, arquivo } of abertos) {
    arquivo.fechar();
    kanban.close();
  }
  rmSync(pasta, { recursive: true, force: true });
});

function criarCenario() {
  const kanban = new KanbanDosProjetos(mkdtempSync(join(pasta, 'dados-')));
  const arquivo = new ArquivoDeTarefas(kanban, async () => ({
    cliente: 'Indústria Alfa',
    projeto: 'Portal de Pedidos',
  }));
  abertos.push({ kanban, arquivo });
  const destino = mkdtempSync(join(pasta, 'destino-'));
  return { kanban, arquivo, destino };
}

function lerJson(caminho: string) {
  return JSON.parse(readFileSync(caminho, 'utf8')) as {
    geradoPor: string;
    documentoId: number;
    projeto: string;
    tarefas: { id: number; titulo: string; estado: string; notas: string }[];
  };
}

describe('ArquivoDeTarefas', () => {
  it('cria a pasta Tarefas com o arquivo no nome do projeto, sem Git na pasta', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    kanban.criarTarefa(demanda.id, { titulo: 'Criar tabela' });
    await arquivo.aguardar(demanda.id);

    const caminho = join(destino, 'Tarefas', 'portal-de-pedidos.json');
    assert.equal(arquivo.situacao(demanda.id)?.caminho, caminho);
    assert.equal(arquivo.situacao(demanda.id)?.gitignore, '');
    assert.equal(arquivo.situacao(demanda.id)?.erro, '');
    const conteudo = lerJson(caminho);
    assert.equal(conteudo.geradoPor, 'hub-snk');
    assert.equal(conteudo.projeto, 'Portal de Pedidos');
    assert.deepEqual(
      conteudo.tarefas.map((tarefa) => tarefa.titulo),
      ['Criar tabela'],
    );
    assert.equal(kanban.demanda(demanda.id).arquivoNome, 'portal-de-pedidos.json');
  });

  it('o segundo kanban do projeto na mesma pasta leva também o nome do kanban', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const primeira = kanban.criarDemanda(CLIENTE, {
      projetoId: PROJETO,
      nome: 'A',
      pasta: destino,
    });
    await arquivo.aguardar(primeira.id);
    const segunda = kanban.criarDemanda(CLIENTE, {
      projetoId: PROJETO,
      nome: 'Fase 2',
      pasta: destino,
    });
    await arquivo.aguardar(segunda.id);

    assert.equal(
      arquivo.situacao(segunda.id)?.caminho,
      join(destino, 'Tarefas', 'portal-de-pedidos-fase-2.json'),
    );
  });

  it('não sobrescreve arquivo que não é do HUB SNK', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    mkdirSync(join(destino, 'Tarefas'));
    writeFileSync(join(destino, 'Tarefas', 'portal-de-pedidos.json'), '{"meu": "arquivo"}');

    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    await arquivo.aguardar(demanda.id);

    assert.equal(
      readFileSync(join(destino, 'Tarefas', 'portal-de-pedidos.json'), 'utf8'),
      '{"meu": "arquivo"}',
    );
    assert.equal(
      arquivo.situacao(demanda.id)?.caminho,
      join(destino, 'Tarefas', 'portal-de-pedidos-k.json'),
    );
  });

  it('põe a pasta Tarefas no .gitignore quando a pasta é de um repositório', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    mkdirSync(join(destino, '.git'));
    writeFileSync(join(destino, '.gitignore'), 'node_modules\n');

    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    await arquivo.aguardar(demanda.id);

    assert.equal(arquivo.situacao(demanda.id)?.gitignore, join(destino, '.gitignore'));
    assert.match(readFileSync(join(destino, '.gitignore'), 'utf8'), /^\/Tarefas\/$/m);
  });

  it('importa estado e notas editados no arquivo, e ignora o resto', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    const tarefa = kanban.criarTarefa(demanda.id, { titulo: 'Criar tabela' });
    await arquivo.aguardar(demanda.id);

    const caminho = arquivo.situacao(demanda.id)?.caminho ?? '';
    const conteudo = lerJson(caminho);
    const [primeira] = conteudo.tarefas;
    assert.ok(primeira);
    primeira.estado = 'Em andamento';
    primeira.notas = 'Tabela criada no ambiente de teste';
    primeira.titulo = 'Título trocado pelo agente';
    writeFileSync(caminho, JSON.stringify(conteudo));

    // A vigia leva até 1,5 s para notar; o teste dispara a sincronização direto.
    kanban.alterarDemanda(demanda.id, {});
    await arquivo.aguardar(demanda.id);

    const atual = kanban.tarefa(tarefa.id);
    assert.equal(atual.estado, 'em_andamento');
    assert.equal(atual.notas, 'Tabela criada no ambiente de teste');
    assert.equal(atual.titulo, 'Criar tabela');
    assert.equal(arquivo.situacao(demanda.id)?.mudancasImportadas, 2);
    assert.equal(lerJson(caminho).tarefas[0]?.titulo, 'Criar tabela');
  });

  it('JSON quebrado não é sobrescrito: espera a próxima gravação válida', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    await arquivo.aguardar(demanda.id);
    const caminho = arquivo.situacao(demanda.id)?.caminho ?? '';

    writeFileSync(caminho, '{ "tarefas": [');
    kanban.alterarDemanda(demanda.id, {});
    await arquivo.aguardar(demanda.id);

    assert.equal(readFileSync(caminho, 'utf8'), '{ "tarefas": [');
    assert.match(arquivo.situacao(demanda.id)?.erro ?? '', /JSON válido/);
  });

  it('tirar a pasta apaga o arquivo e para de vigiar', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    await arquivo.aguardar(demanda.id);
    const caminho = arquivo.situacao(demanda.id)?.caminho ?? '';
    assert.ok(existsSync(caminho));

    kanban.alterarDemanda(demanda.id, { pasta: '' });
    await arquivo.aguardar(demanda.id);

    assert.equal(existsSync(caminho), false);
    assert.equal(arquivo.situacao(demanda.id), undefined);
    assert.equal(kanban.demanda(demanda.id).arquivoNome, '');
  });

  it('excluir o kanban apaga o arquivo', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    await arquivo.aguardar(demanda.id);
    const caminho = arquivo.situacao(demanda.id)?.caminho ?? '';

    kanban.removerDemanda(demanda.id);
    await arquivo.aguardar(demanda.id);

    assert.equal(existsSync(caminho), false);
  });
});

describe('ArquivoDeTarefas e a lista de verificação', () => {
  it('importa o item marcado no arquivo, sem trocar o texto', async () => {
    const { kanban, arquivo, destino } = criarCenario();
    const demanda = kanban.criarDemanda(CLIENTE, { projetoId: PROJETO, nome: 'K', pasta: destino });
    const tarefa = kanban.criarTarefa(demanda.id, {
      titulo: 'T',
      checklist: [
        { texto: 'Passo 1', feito: false },
        { texto: 'Passo 2', feito: false },
      ],
    });
    await arquivo.aguardar(demanda.id);

    const caminho = arquivo.situacao(demanda.id)?.caminho ?? '';
    const conteudo = JSON.parse(readFileSync(caminho, 'utf8')) as {
      tarefas: { checklist: { texto: string; feito: boolean }[] }[];
    };
    const lista = conteudo.tarefas[0]?.checklist ?? [];
    assert.equal(lista.length, 2);
    lista[1] = { texto: 'Texto trocado pelo agente', feito: true };
    writeFileSync(caminho, JSON.stringify(conteudo));

    kanban.alterarDemanda(demanda.id, {});
    await arquivo.aguardar(demanda.id);

    assert.deepEqual(kanban.tarefa(tarefa.id).checklist, [
      { texto: 'Passo 1', feito: false },
      { texto: 'Passo 2', feito: true },
    ]);
  });
});

describe('estadoDoTexto', () => {
  it('aceita o código, o rótulo e os apelidos em inglês', () => {
    assert.equal(estadoDoTexto('em_revisao'), 'em_revisao');
    assert.equal(estadoDoTexto('Concluído'), 'concluido');
    assert.equal(estadoDoTexto('done'), 'concluido');
    assert.equal(estadoDoTexto('qualquer'), undefined);
  });
});

describe('slugDoNome', () => {
  it('tira acento, espaço e pontuação', () => {
    assert.equal(slugDoNome('Integração CERTADOC / Fase 2'), 'integracao-certadoc-fase-2');
  });
});
