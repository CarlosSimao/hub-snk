import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AnaliseConcluida } from '../kanban/ia/analiseDeEscopo.ts';
import { AnaliseDeEscopoError } from '../kanban/ia/analiseDeEscopo.ts';
import { KanbanDosProjetos } from '../kanban/kanbanDosProjetos.ts';
import type { DemandaDoKanban, KanbansDoCliente, TarefaDoKanban } from '../kanban/tiposDoKanban.ts';
import { RepositorioClientesArquivo } from '../repositorio/arquivo/repositorioClientesArquivo.ts';
import { RepositorioConfiguracaoArquivo } from '../repositorio/arquivo/repositorioConfiguracaoArquivo.ts';
import { registrarRotasDeClientes } from './rotasClientes.ts';
import { registrarRotasDeKanban } from './rotasKanban.ts';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-rotas-kanban-'));
/* O Windows não apaga o `sankhya.db` aberto: cada cenário fecha o seu antes da limpeza. */
const kanbansAbertos: KanbanDosProjetos[] = [];
after(() => {
  for (const kanban of kanbansAbertos) {
    kanban.close();
  }
  rmSync(pasta, { recursive: true, force: true });
});

const ANALISE: AnaliseConcluida = {
  resumo: 'Tela de pedidos',
  duvidas: ['Qual empresa?'],
  tarefas: [{ titulo: 'Criar tabela AD_PEDIDO' }, { titulo: 'Criar tela' }],
  assistente: 'claude',
  modelo: 'sonnet',
};

interface Cenario {
  servidor: FastifyInstance;
  kanban: KanbanDosProjetos;
  idDoCliente: string;
  idDoProjeto: string;
  /** Resolve a análise que está pendurada no `analisar` falso. */
  concluirAnalise: (resultado: AnaliseConcluida | Error) => Promise<void>;
  escolhas: unknown[];
}

async function criarCenario(): Promise<Cenario> {
  const pastaDeDados = mkdtempSync(join(pasta, 'dados-'));
  const clientes = new RepositorioClientesArquivo(pastaDeDados);
  const configuracao = new RepositorioConfiguracaoArquivo(pastaDeDados);
  const kanban = new KanbanDosProjetos(pastaDeDados);
  kanbansAbertos.push(kanban);
  const cliente = await clientes.criar({ nome: 'Indústria Alfa' });
  const projeto = await clientes.adicionarProjeto(cliente.id, { nome: 'Portal de pedidos' });

  let resolverAnalise: ((resultado: AnaliseConcluida | Error) => void) | null = null;
  let analiseTerminou: Promise<void> = Promise.resolve();
  const escolhas: unknown[] = [];

  const servidor = Fastify();
  registrarRotasDeClientes(
    servidor,
    clientes,
    configuracao,
    join(pastaDeDados, 'token.txt'),
    async (clienteId) => kanban.removerDoCliente(clienteId),
    {
      quantos: (idDoCliente, idDoProjeto) =>
        kanban.demandasDoProjeto(idDoCliente, idDoProjeto).length,
      manterOrfaos: (idDoCliente, idDoProjeto) =>
        kanban.desvincularDoProjeto(idDoCliente, idDoProjeto),
      excluir: (idDoCliente, idDoProjeto) => kanban.removerDoProjeto(idDoCliente, idDoProjeto),
    },
  );
  registrarRotasDeKanban(servidor, {
    kanban,
    clientes,
    configuracao,
    analisar: (_documento, escolha) => {
      escolhas.push(escolha);
      return new Promise<AnaliseConcluida>((resolver, rejeitar) => {
        let avisar: () => void = () => {};
        analiseTerminou = new Promise<void>((pronto) => (avisar = pronto));
        resolverAnalise = (resultado) => {
          if (resultado instanceof Error) {
            rejeitar(resultado);
          } else {
            resolver(resultado);
          }
          // A gravação acontece no próximo giro, depois do `await` da rota.
          setImmediate(avisar);
        };
      });
    },
  });

  return {
    servidor,
    kanban,
    idDoCliente: cliente.id,
    idDoProjeto: projeto.id,
    escolhas,
    concluirAnalise: async (resultado) => {
      assert.ok(resolverAnalise, 'nenhuma análise pendente');
      resolverAnalise(resultado);
      await analiseTerminou;
    },
  };
}

function documentoMd(texto: string) {
  return { nome: 'Escopo do portal.md', conteudoBase64: Buffer.from(texto).toString('base64') };
}

describe('rotas do kanban', () => {
  it('cria kanban sem documento com o nome do projeto', async () => {
    const { servidor, idDoCliente, idDoProjeto } = await criarCenario();

    const resposta = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/kanbans`,
      payload: { projetoId: idDoProjeto },
    });

    assert.equal(resposta.statusCode, 201);
    const demanda = resposta.json<DemandaDoKanban>();
    assert.equal(demanda.nome, 'Portal de pedidos');
    assert.equal(demanda.situacao, 'sem-documento');
  });

  it('recusa projeto de fora do cliente', async () => {
    const { servidor, idDoCliente } = await criarCenario();

    const resposta = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/kanbans`,
      payload: { projetoId: '00000000-0000-4000-8000-000000000000' },
    });

    assert.equal(resposta.statusCode, 404);
  });

  it('recusa .doc e pasta inexistente', async () => {
    const { servidor, idDoCliente, idDoProjeto } = await criarCenario();
    const url = `/api/clientes/${idDoCliente}/kanbans`;

    const doc = await servidor.inject({
      method: 'POST',
      url,
      payload: {
        projetoId: idDoProjeto,
        documento: { nome: 'escopo.doc', conteudoBase64: 'AAAA' },
      },
    });
    assert.equal(doc.statusCode, 400);
    assert.match(doc.json<{ mensagem: string }>().mensagem, /\.docx/);

    const semPasta = await servidor.inject({
      method: 'POST',
      url,
      payload: { projetoId: idDoProjeto, pasta: join(pasta, 'nao-existe') },
    });
    assert.equal(semPasta.statusCode, 400);
  });

  it('envia o documento, analisa em segundo plano e grava as tarefas', async () => {
    const { servidor, idDoCliente, idDoProjeto, concluirAnalise, escolhas } = await criarCenario();

    const criada = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/kanbans`,
      payload: { projetoId: idDoProjeto, documento: documentoMd('Criar tela'), analisar: true },
    });
    assert.equal(criada.statusCode, 201);
    const demanda = criada.json<DemandaDoKanban>();
    assert.equal(demanda.nome, 'Escopo do portal');
    assert.equal(demanda.situacao, 'analisando');
    assert.deepEqual(escolhas, [{ assistente: 'auto', modelo: '', raciocinio: '' }]);

    const repetida = await servidor.inject({
      method: 'POST',
      url: `/api/kanban/demandas/${demanda.id}/analisar`,
    });
    assert.equal(repetida.statusCode, 409);

    await concluirAnalise(ANALISE);

    const quadro = await servidor.inject({ url: `/api/clientes/${idDoCliente}/kanbans` });
    const { demandas, tarefas } = quadro.json<KanbansDoCliente>();
    assert.equal(demandas[0]?.situacao, 'analisado');
    assert.match(demandas[0]?.resumo ?? '', /Pontos a esclarecer/);
    assert.deepEqual(
      tarefas.map((tarefa) => tarefa.titulo),
      ['Criar tabela AD_PEDIDO', 'Criar tela'],
    );
  });

  it('registra a falha da análise na demanda', async () => {
    const { servidor, idDoCliente, idDoProjeto, concluirAnalise, kanban } = await criarCenario();
    const criada = await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/kanbans`,
      payload: { projetoId: idDoProjeto, documento: documentoMd('x'), analisar: true },
    });
    const { id } = criada.json<DemandaDoKanban>();

    await concluirAnalise(new AnaliseDeEscopoError('A IA não devolveu JSON.'));

    const demanda = kanban.demanda(id);
    assert.equal(demanda.situacao, 'falhou');
    assert.equal(demanda.erro, 'A IA não devolveu JSON.');
  });

  it('cria, move e exclui tarefa', async () => {
    const { servidor, idDoCliente, idDoProjeto } = await criarCenario();
    const { id } = (
      await servidor.inject({
        method: 'POST',
        url: `/api/clientes/${idDoCliente}/kanbans`,
        payload: { projetoId: idDoProjeto },
      })
    ).json<DemandaDoKanban>();

    const criada = await servidor.inject({
      method: 'POST',
      url: `/api/kanban/demandas/${id}/tarefas`,
      payload: { titulo: 'Configurar TOP', tipo: 'configuracao', estimativaHoras: 2 },
    });
    assert.equal(criada.statusCode, 201);
    const tarefa = criada.json<TarefaDoKanban>();

    const movida = await servidor.inject({
      method: 'POST',
      url: `/api/kanban/tarefas/${tarefa.id}/mover`,
      payload: { estado: 'em_andamento' },
    });
    assert.equal(movida.json<TarefaDoKanban>().estado, 'em_andamento');

    const estadoInvalido = await servidor.inject({
      method: 'POST',
      url: `/api/kanban/tarefas/${tarefa.id}/mover`,
      payload: { estado: 'feito' },
    });
    assert.equal(estadoInvalido.statusCode, 400);

    const excluida = await servidor.inject({
      method: 'DELETE',
      url: `/api/kanban/tarefas/${tarefa.id}`,
    });
    assert.equal(excluida.statusCode, 204);
  });

  it('devolve o texto e o original do documento', async () => {
    const { servidor, idDoCliente, idDoProjeto } = await criarCenario();
    const { id } = (
      await servidor.inject({
        method: 'POST',
        url: `/api/clientes/${idDoCliente}/kanbans`,
        payload: { projetoId: idDoProjeto, documento: documentoMd('# Escopo') },
      })
    ).json<DemandaDoKanban>();

    const texto = await servidor.inject({ url: `/api/kanban/demandas/${id}/documento/texto` });
    assert.equal(texto.json<{ texto: string }>().texto, '# Escopo');

    const original = await servidor.inject({
      url: `/api/kanban/demandas/${id}/documento?baixar=1`,
    });
    assert.equal(original.statusCode, 200);
    assert.match(original.headers['content-type'] ?? '', /^text\/plain/);
    assert.match(String(original.headers['content-disposition']), /^attachment/);
    assert.equal(original.body, '# Escopo');
  });

  it('exclusão do projeto com kanban pede escolha e mantém órfãos', async () => {
    const { servidor, idDoCliente, idDoProjeto, kanban } = await criarCenario();
    const { id } = (
      await servidor.inject({
        method: 'POST',
        url: `/api/clientes/${idDoCliente}/kanbans`,
        payload: { projetoId: idDoProjeto },
      })
    ).json<DemandaDoKanban>();
    const url = `/api/clientes/${idDoCliente}/projetos/${idDoProjeto}`;

    const semEscolha = await servidor.inject({ method: 'DELETE', url });
    assert.equal(semEscolha.statusCode, 409);
    assert.equal(semEscolha.json<{ kanbans: number }>().kanbans, 1);

    const mantendo = await servidor.inject({ method: 'DELETE', url: `${url}?kanbans=manter` });
    assert.equal(mantendo.statusCode, 204);
    assert.equal(kanban.demanda(id).projetoId, '');
  });

  it('exclusão do projeto pode levar os kanbans junto', async () => {
    const { servidor, idDoCliente, idDoProjeto, kanban } = await criarCenario();
    await servidor.inject({
      method: 'POST',
      url: `/api/clientes/${idDoCliente}/kanbans`,
      payload: { projetoId: idDoProjeto },
    });

    const resposta = await servidor.inject({
      method: 'DELETE',
      url: `/api/clientes/${idDoCliente}/projetos/${idDoProjeto}?kanbans=excluir`,
    });

    assert.equal(resposta.statusCode, 204);
    assert.equal(kanban.doCliente(idDoCliente).demandas.length, 0);
  });

  it('órfã volta a ter projeto ao ser vinculada', async () => {
    const { servidor, idDoCliente, idDoProjeto, kanban } = await criarCenario();
    const { id } = (
      await servidor.inject({
        method: 'POST',
        url: `/api/clientes/${idDoCliente}/kanbans`,
        payload: { projetoId: idDoProjeto },
      })
    ).json<DemandaDoKanban>();
    kanban.desvincularDoProjeto(idDoCliente, idDoProjeto);

    const vinculada = await servidor.inject({
      method: 'PUT',
      url: `/api/kanban/demandas/${id}`,
      payload: { projetoId: idDoProjeto, nome: 'Portal antigo' },
    });

    assert.equal(vinculada.statusCode, 200);
    assert.equal(vinculada.json<DemandaDoKanban>().projetoId, idDoProjeto);
    assert.equal(vinculada.json<DemandaDoKanban>().nome, 'Portal antigo');
  });
});
