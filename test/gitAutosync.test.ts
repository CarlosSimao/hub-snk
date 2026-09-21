/**
 * A visao do git-autosync e as acoes de agendamento.
 *
 * O que importa aqui e o cruzamento: nem `config.json` nem `status.json` sozinho diz
 * quais repositorios estao no agendamento, e a lista errada faria o painel mostrar como
 * ativo um repo que o agendador nao toca mais. E, desde o agendamento editavel, tambem
 * importa que a leitura do Agendador do Windows seja best-effort — ela e a unica parte
 * da visao que depende de um cmdlet que pode nao responder.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { GitAutosync } from '../src/gitAutosync.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';

interface Chamada {
  caminho: string;
  metodo: string;
  corpo: unknown;
}

/**
 * Helper de mentira: devolve o que o teste mandar por rota e registra as chamadas.
 *
 * `respostas` e consultada por prefixo porque as rotas de leitura levam query string
 * (`/git-autosync/history?repo=...`) montada dentro do proprio modulo.
 */
function helperFalso(respostas: Record<string, unknown>) {
  const chamadas: Chamada[] = [];
  const helper = {
    async requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
      chamadas.push({
        caminho,
        metodo: String(init.method ?? 'GET'),
        corpo: init.body ? JSON.parse(String(init.body)) : null,
      });

      const chave = Object.keys(respostas).find((rota) => caminho.startsWith(rota));
      if (chave === undefined) throw new Error(`rota sem resposta no teste: ${caminho}`);

      const resposta = respostas[chave];
      if (resposta instanceof Error) throw resposta;
      return { dados: resposta, ok: true, saida: '' } as T;
    },
  } as unknown as HubHelper;

  return { helper, chamadas };
}

const CONFIG = {
  schedules: ['17:40'],
  aiEnabled: false,
  aiAgent: 'auto',
  targets: [
    { path: 'C:\\Demandas', type: 'root', enabled: true, exclude: ['C:\\Demandas\\pausado'] },
    { path: 'C:\\Projetos\\solo', type: 'repo', enabled: true, exclude: [] },
  ],
};

const STATUS = {
  lastSyncRun: '2026-09-11 17:46:04',
  repos: {
    'C:\\Demandas\\ativo': { lastRun: '2026-09-11 17:40:00', success: true, state: 'synced' },
    'C:\\Demandas\\pausado': { lastRun: '2026-08-01 17:40:00', success: true, state: 'synced' },
  },
};

const TAREFAS = [
  {
    nome: 'GitAutoSyncPy',
    estado: 'Ready',
    proximaExecucao: '2026-09-14 17:40:00',
    ultimaExecucao: '2026-09-14 08:42:05',
    ultimoResultado: 2147946720,
  },
];

describe('GitAutosync — visão', () => {
  test('traz as tarefas do Agendador junto dos horários da config', async () => {
    const { helper } = helperFalso({
      '/git-autosync/config': CONFIG,
      '/git-autosync/status': STATUS,
      '/git-autosync/tarefas': TAREFAS,
    });

    const visao = await new GitAutosync(helper).visao();

    assert.deepEqual(visao.horarios, ['17:40']);
    assert.deepEqual(visao.tarefas, TAREFAS);
    assert.equal(visao.ultimaExecucao, '2026-09-11 17:46:04');
  });

  test('Agendador ilegível não derruba o resto da visão', async () => {
    const { helper } = helperFalso({
      '/git-autosync/config': CONFIG,
      '/git-autosync/status': STATUS,
      '/git-autosync/tarefas': new Error('não consegui ler o Agendador'),
    });

    // Sem o best-effort, uma máquina com o cmdlet bloqueado por política perderia a aba
    // inteira — repositórios, histórico e ações — por causa de um selo informativo.
    const visao = await new GitAutosync(helper).visao();

    assert.deepEqual(visao.tarefas, []);
    assert.equal(visao.repos.length, 3);
  });

  test('excluído de um alvo root aparece inativo, sem sumir da lista', async () => {
    const { helper } = helperFalso({
      '/git-autosync/config': CONFIG,
      '/git-autosync/status': STATUS,
      '/git-autosync/tarefas': [],
    });

    const visao = await new GitAutosync(helper).visao();
    const pausado = visao.repos.find((repo) => repo.path === 'C:\\Demandas\\pausado');
    const solo = visao.repos.find((repo) => repo.path === 'C:\\Projetos\\solo');

    assert.equal(pausado?.ativo, false, 'está no exclude do alvo root');
    assert.equal(pausado?.alvoProprio, false, 'veio varrido da pasta, não é alvo');
    assert.equal(solo?.alvoProprio, true, 'é alvo do tipo repo');
    assert.equal(solo?.ativo, true);
  });
});

describe('GitAutosync — agendamento', () => {
  test('definirHorarios manda a lista para o helper', async () => {
    const { helper, chamadas } = helperFalso({ '/git-autosync/agendamento': null });

    await new GitAutosync(helper).definirHorarios(['08:30', '17:40']);

    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]?.caminho, '/git-autosync/agendamento');
    assert.equal(chamadas[0]?.metodo, 'POST');
    assert.deepEqual(chamadas[0]?.corpo, { horarios: ['08:30', '17:40'] });
  });

  test('instalar e desinstalar são rotas distintas, as duas em POST', async () => {
    const { helper, chamadas } = helperFalso({
      '/git-autosync/instalar': null,
      '/git-autosync/desinstalar': null,
    });
    const autosync = new GitAutosync(helper);

    await autosync.instalar();
    await autosync.desinstalar();

    assert.deepEqual(
      chamadas.map((c) => `${c.metodo} ${c.caminho}`),
      ['POST /git-autosync/instalar', 'POST /git-autosync/desinstalar'],
    );
  });
});

describe('GitAutosync — terminal e log', () => {
  test('terminal manda o caminho e o tipo para o helper, sem passar pelo CLI', async () => {
    const { helper, chamadas } = helperFalso({ '/git-autosync/terminal': null });

    await new GitAutosync(helper).terminal('C:\\Projetos\\solo', 'git-bash');

    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]?.caminho, '/git-autosync/terminal');
    assert.equal(chamadas[0]?.metodo, 'POST');
    assert.deepEqual(chamadas[0]?.corpo, { caminho: 'C:\\Projetos\\solo', tipo: 'git-bash' });
  });

  test('log devolve as linhas e usa o limite pedido na query', async () => {
    const { helper, chamadas } = helperFalso({
      '/git-autosync/log': ['linha 1', 'linha 2'],
    });

    const linhas = await new GitAutosync(helper).log(50);

    assert.deepEqual(linhas, ['linha 1', 'linha 2']);
    assert.equal(chamadas[0]?.caminho, '/git-autosync/log?limite=50');
  });

  test('log sem linhas registradas devolve lista vazia, não null', async () => {
    const { helper } = helperFalso({ '/git-autosync/log': null });

    const linhas = await new GitAutosync(helper).log();

    assert.deepEqual(linhas, []);
  });
});
