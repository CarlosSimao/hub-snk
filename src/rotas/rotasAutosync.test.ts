import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  GitAutosyncNaoInstaladoError,
  type CliDoAutosync,
  type ResultadoDoCli,
} from '../autosync/cliDoAutosync.ts';
import { ServicoDoAutosync } from '../autosync/servicoDoAutosync.ts';
import type { SituacaoDaPasta } from '../autosync/sincronizacaoComClientes.ts';
import type {
  ConfiguracaoDoAutosync,
  OpcoesDeInstalacao,
  StatusDoAutosync,
} from '../autosync/tiposDoAutosync.ts';
import type { Cliente } from '../tipos.ts';
import { registrarRotasDeAutosync } from './rotasAutosync.ts';

const BASE = resolve('/hub-teste');
const RAIZ = join(BASE, 'Demandas');
const PROPRIO = join(BASE, 'proprio');
const DO_CLIENTE = join(BASE, 'clientes', 'alfa');
const NA_RAIZ = join(RAIZ, 'beta');
const EXCLUIDO = join(RAIZ, 'gama');
const INEXISTENTE = join(BASE, 'sumiu');

type Responder = (argumentos: readonly string[]) => ResultadoDoCli;

/** Dublê do CLI: guarda cada chamada e responde pelo subcomando. */
class CliDeMentira implements CliDoAutosync {
  instalar = true;
  configuracao: ConfiguracaoDoAutosync | null = null;
  status: StatusDoAutosync | null = null;
  chamadas: string[][] = [];
  respostas = new Map<string, Responder>();

  instalado(): boolean {
    return this.instalar;
  }
  async versao(): Promise<string | null> {
    return '4.0.0';
  }
  async executar(argumentos: readonly string[]): Promise<ResultadoDoCli> {
    if (!this.instalar) throw new GitAutosyncNaoInstaladoError();
    this.chamadas.push([...argumentos]);
    const responder = this.respostas.get(argumentos[0] ?? '');
    return responder ? responder(argumentos) : { codigo: 0, saida: 'ok\n' };
  }
  async lerConfiguracao(): Promise<ConfiguracaoDoAutosync | null> {
    return this.configuracao;
  }
  async lerStatus(): Promise<StatusDoAutosync | null> {
    return this.status;
  }
  async lerLog(limite: number): Promise<string[]> {
    return ['a', 'b', 'c'].slice(-limite);
  }
  async listarTarefas() {
    return [];
  }
  async instalarPacote(_opcoes: OpcoesDeInstalacao): Promise<ResultadoDoCli> {
    return { codigo: 0, saida: 'instalado' };
  }
}

function criarCliente(caminhos: string[]): Cliente {
  return {
    id: 'c1',
    nome: 'Alfa',
    anotacoes: '',
    bases: [],
    repositorios: caminhos.map((caminhoLocal, indice) => ({
      id: `r${indice}`,
      url: 'https://gitlab.exemplo/alfa.git',
      caminhoLocal,
    })),
    links: [],
    projetos: [],
    nomesCompletos: [],
    criadoEm: '2026-01-01T00:00:00.000Z',
    atualizadoEm: '2026-01-01T00:00:00.000Z',
  };
}

let cli: CliDeMentira;
let clientes: Cliente[];
let servidor: FastifyInstance;

beforeEach(() => {
  cli = new CliDeMentira();
  cli.configuracao = {
    schedules: ['17:30'],
    targets: [
      { path: PROPRIO, type: 'repo', enabled: true },
      { path: RAIZ, type: 'root', enabled: true, exclude: [EXCLUIDO] },
    ],
  };
  clientes = [criarCliente([DO_CLIENTE])];
  const pastas = new Map<string, SituacaoDaPasta>([[INEXISTENTE, 'ausente']]);

  servidor = Fastify();
  registrarRotasDeAutosync(
    servidor,
    new ServicoDoAutosync({
      cli,
      listarClientes: async () => clientes,
      listarDaRaiz: async () => [NA_RAIZ, EXCLUIDO],
      inspecionar: (caminho) => pastas.get(caminho) ?? 'repositorio',
    }),
  );
});

describe('GET /api/autosync', () => {
  it('devolve a visão, com o vínculo de cliente quando pedido', async () => {
    cli.configuracao?.targets?.push({ path: DO_CLIENTE, type: 'repo' });

    const resposta = await servidor.inject({ url: '/api/autosync?clientes=true' });

    assert.equal(resposta.statusCode, 200);
    const visao = resposta.json();
    assert.equal(visao.instalado, true);
    const doCliente = visao.repositorios.find((r: { caminho: string }) => r.caminho === DO_CLIENTE);
    assert.equal(doCliente.clienteId, 'c1');
  });

  it('responde mesmo sem autosync instalado', async () => {
    cli.instalar = false;
    cli.configuracao = null;

    const resposta = await servidor.inject({ url: '/api/autosync' });

    assert.equal(resposta.statusCode, 200);
    assert.equal(resposta.json().instalado, false);
  });
});

describe('PUT /api/autosync/agendamento', () => {
  for (const [nome, horarios] of [
    ['horário inválido', ['25:00']],
    ['lista vazia', []],
    ['horário repetido', ['12:00', '12:00']],
    ['mais de seis horários', ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00']],
  ] as const) {
    it(`recusa ${nome}`, async () => {
      const resposta = await servidor.inject({
        method: 'PUT',
        url: '/api/autosync/agendamento',
        payload: { horarios },
      });

      assert.equal(resposta.statusCode, 400);
      assert.deepEqual(cli.chamadas, []);
    });
  }

  it('ordena e manda ao set-schedule', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/autosync/agendamento',
      payload: { horarios: ['17:30', '12:00'] },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [['set-schedule', '12:00,17:30']]);
  });
});

describe('ações por repositório', () => {
  it('responde 400 sem caminho, antes de chamar o CLI', async () => {
    for (const url of [
      '/api/autosync/commit',
      '/api/autosync/push',
      '/api/autosync/merge-request',
    ]) {
      const resposta = await servidor.inject({ method: 'POST', url, payload: {} });
      assert.equal(resposta.statusCode, 400, url);
    }
    assert.deepEqual(cli.chamadas, []);
  });

  it('recusa caminho que não é do autosync nem de cliente', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/commit',
      payload: { caminho: join(BASE, 'qualquer') },
    });

    assert.equal(resposta.statusCode, 400);
    assert.deepEqual(cli.chamadas, []);
  });

  it('commit passa --repo e a mensagem como argumentos', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/commit',
      payload: { caminho: PROPRIO, mensagem: 'feat: algo & mais' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [
      ['commit', '--repo', PROPRIO, '--message', 'feat: algo & mais'],
    ]);
  });

  it('mensagem vazia vale como ausente', async () => {
    await servidor.inject({
      method: 'POST',
      url: '/api/autosync/commit',
      payload: { caminho: PROPRIO, mensagem: '   ' },
    });

    assert.deepEqual(cli.chamadas, [['commit', '--repo', PROPRIO]]);
  });

  it('sincronizar sem caminho roda sync --all sem mensagem', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/sincronizar',
      payload: {},
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [['sync', '--all']]);
  });

  it('sincronizar sem caminho e com mensagem é 400', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/sincronizar',
      payload: { mensagem: 'x' },
    });

    assert.equal(resposta.statusCode, 400);
    assert.deepEqual(cli.chamadas, []);
  });

  it('merge request manda título e destino', async () => {
    await servidor.inject({
      method: 'POST',
      url: '/api/autosync/merge-request',
      payload: { caminho: NA_RAIZ, titulo: 'Entrega', destino: 'main', origem: '' },
    });

    assert.deepEqual(cli.chamadas, [
      ['mr', '--repo', NA_RAIZ, '--title', 'Entrega', '--target', 'main'],
    ]);
  });

  it('falha do CLI vira 502 com a saída original', async () => {
    cli.respostas.set('push', () => ({ codigo: 1, saida: '[ERRO] x: branch protegida\n' }));

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/push',
      payload: { caminho: PROPRIO },
    });

    assert.equal(resposta.statusCode, 502);
    assert.equal(resposta.json().mensagem, '[ERRO] x: branch protegida');
  });

  it('erro de argumento do CLI pede para atualizar o autosync', async () => {
    cli.respostas.set('push', () => ({ codigo: 2, saida: 'usage: git-autosync [-h]\n' }));

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/push',
      payload: { caminho: PROPRIO },
    });

    assert.equal(resposta.statusCode, 502);
    assert.match(resposta.json().mensagem, /Atualize o Git AutoSync/);
  });

  it('responde 503 quando o autosync não está instalado', async () => {
    cli.instalar = false;

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/push',
      payload: { caminho: PROPRIO },
    });

    assert.equal(resposta.statusCode, 503);
  });
});

describe('POST /api/autosync/repositorios', () => {
  it('adiciona repositório de cliente fora do autosync', async () => {
    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/repositorios',
      payload: { caminho: DO_CLIENTE, tipo: 'repo' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [['add', DO_CLIENTE, '--type', 'repo']]);
  });

  it('repositório dentro da raiz não ganha add', async () => {
    clientes = [criarCliente([NA_RAIZ])];

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/repositorios',
      payload: { caminho: NA_RAIZ },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, []);
  });

  it('repositório excluído da raiz volta com include', async () => {
    await servidor.inject({
      method: 'POST',
      url: '/api/autosync/repositorios',
      payload: { caminho: EXCLUIDO },
    });

    assert.deepEqual(cli.chamadas, [['include', EXCLUIDO]]);
  });

  it('pasta inexistente é 404', async () => {
    clientes = [criarCliente([INEXISTENTE])];

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/repositorios',
      payload: { caminho: INEXISTENTE },
    });

    assert.equal(resposta.statusCode, 404);
    assert.deepEqual(cli.chamadas, []);
  });

  it('aceita a pasta-mãe de um repositório de cliente como raiz', async () => {
    const pai = join(BASE, 'clientes');

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/repositorios',
      payload: { caminho: pai, tipo: 'root' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [['add', pai, '--type', 'root']]);
  });
});

describe('DELETE /api/autosync/repositorios', () => {
  it('repositório da raiz sai com exclude, nunca com remove', async () => {
    await servidor.inject({
      method: 'DELETE',
      url: '/api/autosync/repositorios',
      payload: { caminho: NA_RAIZ },
    });

    assert.deepEqual(cli.chamadas, [['exclude', NA_RAIZ]]);
  });

  it('alvo próprio sai com remove e é conferido depois', async () => {
    cli.respostas.set('remove', () => {
      cli.configuracao = { targets: [{ path: RAIZ, type: 'root' }] };
      return { codigo: 0, saida: `Removido: ${PROPRIO}` };
    });

    const resposta = await servidor.inject({
      method: 'DELETE',
      url: '/api/autosync/repositorios',
      payload: { caminho: PROPRIO },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [['remove', PROPRIO]]);
  });

  it('remove que não tirou o alvo vira 502', async () => {
    cli.respostas.set('remove', () => ({ codigo: 0, saida: 'Nenhum alvo encontrado.' }));

    const resposta = await servidor.inject({
      method: 'DELETE',
      url: '/api/autosync/repositorios',
      payload: { caminho: PROPRIO },
    });

    assert.equal(resposta.statusCode, 502);
  });
});

describe('POST /api/autosync/repositorios/lote', () => {
  it('continua depois de uma falha e devolve o resultado por repositório', async () => {
    const falha = join(BASE, 'clientes', 'falha');
    clientes = [criarCliente([DO_CLIENTE, falha, PROPRIO, EXCLUIDO, INEXISTENTE])];
    cli.respostas.set('add', (argumentos) =>
      argumentos[1] === falha
        ? { codigo: 1, saida: 'Caminho nao existe' }
        : { codigo: 0, saida: 'Adicionado' },
    );

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/repositorios/lote',
      payload: { origem: 'clientes' },
    });

    assert.equal(resposta.statusCode, 200);
    const resultado = resposta.json();
    assert.deepEqual(resultado.adicionados, [DO_CLIENTE]);
    assert.deepEqual(resultado.jaEstavam, [PROPRIO]);
    assert.deepEqual(
      resultado.falhas.map((f: { caminho: string }) => f.caminho),
      [falha],
    );
    assert.deepEqual(
      resultado.ignorados.map((i: { caminho: string }) => i.caminho),
      [EXCLUIDO, INEXISTENTE],
    );
  });
});

describe('PUT /api/autosync/ia', () => {
  it('liga a IA e troca o agente', async () => {
    cli.respostas.set('set-agent', () => {
      cli.configuracao = { ...cli.configuracao, aiEnabled: true, aiAgent: 'claude' };
      return { codigo: 0, saida: '' };
    });

    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/autosync/ia',
      payload: { ligada: true, agente: 'claude' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(cli.chamadas, [
      ['set-ai', 'on'],
      ['set-agent', 'claude'],
    ]);
    assert.deepEqual(resposta.json(), { ligada: true, agente: 'claude' });
  });

  it('agente desconhecido é 400', async () => {
    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/autosync/ia',
      payload: { ligada: true, agente: 'gpt' },
    });

    assert.equal(resposta.statusCode, 400);
    assert.deepEqual(cli.chamadas, []);
  });
});

describe('PUT /api/autosync/politica', () => {
  it('repete a flag para cada item da lista', async () => {
    await servidor.inject({
      method: 'PUT',
      url: '/api/autosync/politica',
      payload: { caminho: PROPRIO, exclude: ['*.log', 'build/**'], maxBytes: 1024, ia: 'off' },
    });

    assert.deepEqual(cli.chamadas, [
      [
        'set-policy',
        '--repo',
        PROPRIO,
        '--exclude',
        '*.log',
        '--exclude',
        'build/**',
        '--max-file-bytes',
        '1024',
        '--ai',
        'off',
      ],
    ]);
  });

  it('não finge limpar um campo que o CLI não sabe limpar', async () => {
    cli.configuracao = {
      ...cli.configuracao,
      repoPolicies: { [PROPRIO]: { include: ['src/**'] } },
    };

    const resposta = await servidor.inject({
      method: 'PUT',
      url: '/api/autosync/politica',
      payload: { caminho: PROPRIO, include: [] },
    });

    assert.equal(resposta.statusCode, 400);
    assert.deepEqual(cli.chamadas, []);
  });
});

describe('GET /api/autosync/previa', () => {
  it('devolve a mensagem gerada', async () => {
    cli.respostas.set('preview', () => ({
      codigo: 0,
      saida: JSON.stringify({ path: PROPRIO, message: 'feat: 🎉 algo' }),
    }));

    const resposta = await servidor.inject({
      url: `/api/autosync/previa?caminho=${encodeURIComponent(PROPRIO)}`,
    });

    assert.deepEqual(resposta.json(), { caminho: PROPRIO, mensagem: 'feat: 🎉 algo' });
  });

  it('diz quando não há alteração', async () => {
    cli.respostas.set('preview', () => ({
      codigo: 0,
      saida: `[OK] ${PROPRIO}: sem alteracoes pendentes`,
    }));

    const resposta = await servidor.inject({
      url: `/api/autosync/previa?caminho=${encodeURIComponent(PROPRIO)}`,
    });

    assert.deepEqual(resposta.json(), { semAlteracoes: true });
  });
});

describe('GET /api/autosync/historico e /log', () => {
  it('pega a única chave do history, com barras quaisquer', async () => {
    cli.respostas.set('history', () => ({
      codigo: 0,
      saida: JSON.stringify({
        [PROPRIO.replace(/\\/g, '/')]: [{ hash: 'abc', date: 'd', message: 'm' }],
      }),
    }));

    const resposta = await servidor.inject({
      url: `/api/autosync/historico?caminho=${encodeURIComponent(PROPRIO)}&limite=5`,
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json().commits, [{ hash: 'abc', date: 'd', message: 'm' }]);
    assert.deepEqual(cli.chamadas[0]?.slice(-4), ['--limit', '5', '--since', 'all']);
  });

  it('devolve as últimas linhas do log', async () => {
    const resposta = await servidor.inject({ url: '/api/autosync/log?limite=2' });

    assert.deepEqual(resposta.json(), { linhas: ['b', 'c'] });
  });
});

describe('GET /api/autosync/diagnostico', () => {
  it('devolve o JSON do doctor mesmo com código 1', async () => {
    cli.respostas.set('doctor', () => ({ codigo: 1, saida: '{"git": true, "repos": {}}' }));

    const resposta = await servidor.inject({ url: '/api/autosync/diagnostico?rede=true' });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), { git: true, repos: {} });
    assert.deepEqual(cli.chamadas, [['doctor', '--network']]);
  });
});

describe('/api/autosync/gitlab', () => {
  /** Dublê das variáveis do usuário: nenhum teste toca no registro do Windows. */
  function criarServidorDoGitlab(iniciais: Record<string, string> = {}) {
    const gravadas = new Map(Object.entries(iniciais));
    const variaveis = {
      ler: async (nome: string) => gravadas.get(nome) ?? null,
      gravar: async (nome: string, valor: string | null) => {
        if (valor === null) gravadas.delete(nome);
        else gravadas.set(nome, valor);
      },
    };
    const servidorDoGitlab = Fastify();
    registrarRotasDeAutosync(
      servidorDoGitlab,
      new ServicoDoAutosync({ cli, listarClientes: async () => [] }),
      variaveis,
    );
    return { servidorDoGitlab, gravadas };
  }

  it('diz se há token sem devolver o valor', async () => {
    const { servidorDoGitlab } = criarServidorDoGitlab({
      GIT_AUTOSYNC_GITLAB_TOKEN: 'glpat-segredo',
      GIT_AUTOSYNC_GITLAB_HOST: 'gitlab.exemplo.com',
    });

    const resposta = await servidorDoGitlab.inject({ url: '/api/autosync/gitlab' });

    assert.deepEqual(resposta.json(), { host: 'gitlab.exemplo.com', tokenDefinido: true });
    assert.doesNotMatch(resposta.body, /segredo/);
  });

  it('grava host e token, com o host em minúsculas', async () => {
    const { servidorDoGitlab, gravadas } = criarServidorDoGitlab();

    const resposta = await servidorDoGitlab.inject({
      method: 'PUT',
      url: '/api/autosync/gitlab',
      payload: { host: ' GitLab.Exemplo.com ', token: 'glpat-novo' },
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), { host: 'gitlab.exemplo.com', tokenDefinido: true });
    assert.equal(gravadas.get('GIT_AUTOSYNC_GITLAB_TOKEN'), 'glpat-novo');
    assert.equal(gravadas.get('GIT_AUTOSYNC_GITLAB_HOST'), 'gitlab.exemplo.com');
  });

  it('token vazio mantém o gravado e só troca o host', async () => {
    const { servidorDoGitlab, gravadas } = criarServidorDoGitlab({
      GIT_AUTOSYNC_GITLAB_TOKEN: 'glpat-antigo',
    });

    await servidorDoGitlab.inject({
      method: 'PUT',
      url: '/api/autosync/gitlab',
      payload: { host: 'gitlab.outro.com', token: '' },
    });

    assert.equal(gravadas.get('GIT_AUTOSYNC_GITLAB_TOKEN'), 'glpat-antigo');
    assert.equal(gravadas.get('GIT_AUTOSYNC_GITLAB_HOST'), 'gitlab.outro.com');
  });

  it('recusa host com protocolo e host sem token nenhum', async () => {
    const { servidorDoGitlab, gravadas } = criarServidorDoGitlab();

    const comProtocolo = await servidorDoGitlab.inject({
      method: 'PUT',
      url: '/api/autosync/gitlab',
      payload: { host: 'https://gitlab.exemplo.com', token: 'x' },
    });
    const semToken = await servidorDoGitlab.inject({
      method: 'PUT',
      url: '/api/autosync/gitlab',
      payload: { host: 'gitlab.exemplo.com' },
    });

    assert.equal(comProtocolo.statusCode, 400);
    assert.equal(semToken.statusCode, 400);
    assert.equal(gravadas.size, 0);
  });

  it('remove o token e mantém o host', async () => {
    const { servidorDoGitlab, gravadas } = criarServidorDoGitlab({
      GIT_AUTOSYNC_GITLAB_TOKEN: 'glpat-x',
      GIT_AUTOSYNC_GITLAB_HOST: 'gitlab.exemplo.com',
    });

    const resposta = await servidorDoGitlab.inject({
      method: 'DELETE',
      url: '/api/autosync/gitlab',
    });

    assert.deepEqual(resposta.json(), { host: 'gitlab.exemplo.com', tokenDefinido: false });
    assert.equal(gravadas.has('GIT_AUTOSYNC_GITLAB_TOKEN'), false);
  });
});

describe('sugestões e terminal', () => {
  it('o 502 traz as sugestões de correção', async () => {
    cli.respostas.set('push', () => ({
      codigo: 1,
      saida: ' ! [rejected]  main -> main (non-fast-forward)',
    }));

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/autosync/push',
      payload: { caminho: PROPRIO },
    });

    assert.equal(resposta.statusCode, 502);
    assert.deepEqual(resposta.json().sugestoes[0].comandos, ['git pull --rebase', 'git push']);
  });

  it('abre o terminal só em caminho conhecido', async () => {
    const abertos: string[] = [];
    const servidorComTerminal = Fastify();
    registrarRotasDeAutosync(
      servidorComTerminal,
      new ServicoDoAutosync({
        cli,
        listarClientes: async () => [],
        listarDaRaiz: async () => [],
        inspecionar: () => 'repositorio',
        abrirTerminal: async (caminho) => {
          abertos.push(caminho);
        },
      }),
    );

    const conhecido = await servidorComTerminal.inject({
      method: 'POST',
      url: '/api/autosync/terminal',
      payload: { caminho: PROPRIO },
    });
    const desconhecido = await servidorComTerminal.inject({
      method: 'POST',
      url: '/api/autosync/terminal',
      payload: { caminho: join(BASE, 'qualquer') },
    });

    assert.equal(conhecido.statusCode, 204);
    assert.equal(desconhecido.statusCode, 400);
    assert.deepEqual(abertos, [PROPRIO]);
    assert.deepEqual(cli.chamadas, []);
  });
});
