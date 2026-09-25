/**
 * O cartao do cliente: migracao dos campos unicos, senha das bases e posse das linhas.
 *
 * O teste que mais importa e o da migracao: ela roda em todo boot do hub, sobre o
 * cadastro real do usuario. Duplicar o repositorio de todo mundo a cada reinicio seria
 * silencioso e so apareceria depois de a lista ja estar impraticavel.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { Clientes } from '../src/sankhya/clientes.ts';
import { CartaoClientes } from '../src/sankhya/cartao.ts';
import { registerRoutesCartao } from '../src/routesCartao.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';
import type { MonitorBases } from '../src/sankhya/monitorBases.ts';
import { DesktopBridgeError, type DesktopBridge } from '../src/sankhya/desktopBridge.ts';
import type { ClienteEntrada } from '../src/types.ts';
import { dirTemporario } from './helpers.ts';

/**
 * Helper de mentira: DPAPI nao existe fora do Windows e nao e o que esta sob teste
 * aqui. A cifra vira um prefixo, o suficiente para provar que o valor guardado NAO e o
 * texto claro e que a volta desfaz a ida.
 */
const helperFalso = {
  async requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const { valor } = JSON.parse(String(init.body ?? '{}')) as { valor: string };
    const resultado = caminho.endsWith('/encrypt') ? `cifrado:${valor}` : valor.replace(/^cifrado:/, '');
    return { valor: resultado } as T;
  },
} as unknown as HubHelper;

const CLIENTE: ClienteEntrada = {
  nome: 'Cliente de teste',
  experienceProjetoId: null,
  experiencePersonId: null,
  agendaRecursoUsuario: '',
  agendaCodparc: null,
  agendaDemandaId: '',
  sankhyaUrl: '',
  repositorioLocal: '',
  repositorioRemoto: '',
  anotacoes: '',
  anotacoesNotificar: false,
  demandaFim: '',
  emailFinalizacaoEm: '',
};

/** Abre o banco, roda a prova e fecha — no Windows o SQLite aberto trava a pasta. */
function comCartao(prova: (cartao: CartaoClientes, clientes: Clientes, dir: string) => void | Promise<void>) {
  return async () => {
    const dir = dirTemporario();
    const clientes = new Clientes(dir.path);
    const cartao = new CartaoClientes(dir.path, helperFalso);
    try {
      await prova(cartao, clientes, dir.path);
    } finally {
      cartao.close();
      clientes.close();
      dir.remove();
    }
  };
}

describe('CartaoClientes — migração dos campos únicos', () => {
  test(
    'leva repositório e URL para as tabelas novas',
    comCartao((cartao, clientes, dir) => {
      clientes.criar({
        ...CLIENTE,
        repositorioLocal: 'C:\\repos\\cliente',
        repositorioRemoto: 'https://gitlab/x',
        sankhyaUrl: 'https://cliente.sankhyacloud.com.br/mge/',
      });

      // A migração roda no construtor de `Clientes`: reabrir é o que a exercita.
      const segunda = new Clientes(dir);
      try {
        assert.equal(cartao.repos(1).length, 1);
        assert.equal(cartao.repos(1)[0]?.caminhoLocal, 'C:\\repos\\cliente');
        assert.equal(cartao.bases(1).length, 1);
        assert.equal(cartao.bases(1)[0]?.url, 'https://cliente.sankhyacloud.com.br/mge/');
      } finally {
        segunda.close();
      }
    }),
  );

  test(
    'reabrir o banco não duplica nada',
    comCartao((cartao, clientes, dir) => {
      clientes.criar({ ...CLIENTE, repositorioLocal: 'C:\\repos\\cliente' });

      for (let i = 0; i < 3; i += 1) {
        const outra = new Clientes(dir);
        outra.close();
      }

      assert.equal(cartao.repos(1).length, 1, 'três reinícios do hub, um repositório');
    }),
  );

  test(
    'cliente sem repositório nem URL não ganha linha vazia',
    comCartao((cartao, clientes, dir) => {
      clientes.criar(CLIENTE);

      const outra = new Clientes(dir);
      outra.close();

      assert.equal(cartao.repos(1).length, 0);
      assert.equal(cartao.bases(1).length, 0);
    }),
  );
});

describe('CartaoClientes — login pela API', () => {
  test('migra banco existente com entrarAutomatico desligado', () => {
    const dir = dirTemporario();
    const db = new DatabaseSync(`${dir.path}/sankhya.db`);
    db.exec(`
      CREATE TABLE clientes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        experience_projeto_id INTEGER,
        experience_person_id INTEGER,
        agenda_recurso_usuario TEXT NOT NULL DEFAULT '',
        repositorio_local TEXT NOT NULL DEFAULT '',
        repositorio_remoto TEXT NOT NULL DEFAULT ''
      );
      INSERT INTO clientes (nome) VALUES ('Legado');
      CREATE TABLE cliente_bases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cliente_id INTEGER NOT NULL,
        ambiente TEXT NOT NULL DEFAULT 'producao',
        url TEXT NOT NULL DEFAULT '',
        usuario TEXT NOT NULL DEFAULT '',
        senha_cifrada TEXT NOT NULL DEFAULT '',
        versao TEXT NOT NULL DEFAULT '',
        monitorar INTEGER NOT NULL DEFAULT 0,
        ordem INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO cliente_bases (cliente_id, url) VALUES (1, 'https://legado.example/mge/');
    `);
    db.close();

    const clientes = new Clientes(dir.path);
    const cartao = new CartaoClientes(dir.path, helperFalso);
    try {
      assert.equal(cartao.base(1)?.entrarAutomatico, false);
    } finally {
      cartao.close();
      clientes.close();
      dir.remove();
    }
  });

  test(
    'rota grava e devolve entrarAutomatico no cartão',
    comCartao(async (cartao, clientes) => {
      const cliente = clientes.criar(CLIENTE);
      const app = Fastify();
      registerRoutesCartao(app, {
        cartao,
        clientes,
        monitor: {} as MonitorBases,
      });

      try {
        const criado = await app.inject({
          method: 'POST',
          url: `/api/clientes/${cliente.id}/bases`,
          payload: {
            ambiente: 'producao',
            url: 'https://cliente.example/mge/',
            usuario: 'SUP',
            senha: 'segredo',
            entrarAutomatico: true,
            monitorar: false,
            ordem: 0,
          },
        });
        assert.equal(criado.statusCode, 201);

        const resposta = await app.inject({
          method: 'GET',
          url: `/api/clientes/${cliente.id}/cartao`,
        });
        assert.equal(resposta.statusCode, 200);
        assert.equal(resposta.json().bases[0].entrarAutomatico, true);

        const invalido = await app.inject({
          method: 'POST',
          url: `/api/clientes/${cliente.id}/bases`,
          payload: {
            ambiente: 'producao',
            url: 'https://cliente.example/mge/',
            entrarAutomatico: 'sim',
          },
        });
        assert.equal(invalido.statusCode, 400);
      } finally {
        await app.close();
      }
    }),
  );
});

describe('rotas do diagnóstico da base', () => {
  const DIAGNOSTICO = {
    ok: true as const,
    modulos: [],
    botoes: [],
    parametros: [],
    parametrosAusentes: [],
  };

  test(
    'resolve o origin pela base cadastrada e repassa os parâmetros',
    comCartao(async (cartao, clientes) => {
      const cliente = clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(cliente.id, {
        ambiente: 'producao',
        url: 'https://cliente.example/mge/',
        usuario: '',
        monitorar: false,
        ordem: 0,
      });
      let recebido: { origin: string; parametros: string } | undefined;
      const desktopBridge = {
        diagnosticarBase: async (origin: string, parametros: string) => {
          recebido = { origin, parametros };
          return DIAGNOSTICO;
        },
      } as unknown as DesktopBridge;
      const app = Fastify();
      registerRoutesCartao(app, { cartao, clientes, monitor: {} as MonitorBases, desktopBridge });

      try {
        const resposta = await app.inject({
          method: 'GET',
          url: `/api/clientes/${cliente.id}/bases/${base!.id}/diagnostico?parametros=UTILIZAWMS%2C%20CODEMPPADRAO`,
        });
        assert.equal(resposta.statusCode, 200);
        assert.deepEqual(recebido, {
          origin: 'https://cliente.example',
          parametros: 'UTILIZAWMS, CODEMPPADRAO',
        });
      } finally {
        await app.close();
      }
    }),
  );

  test(
    'responde 503 quando o bridge não está configurado',
    comCartao(async (cartao, clientes) => {
      const cliente = clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(cliente.id, {
        ambiente: 'producao',
        url: 'https://cliente.example/mge/',
        usuario: '',
        monitorar: false,
        ordem: 0,
      });
      const app = Fastify();
      registerRoutesCartao(app, { cartao, clientes, monitor: {} as MonitorBases });

      try {
        const resposta = await app.inject({
          method: 'GET',
          url: `/api/clientes/${cliente.id}/bases/${base!.id}/diagnostico`,
        });
        assert.equal(resposta.statusCode, 503);
        assert.match(resposta.json().error, /Desktop não está configurado/);
      } finally {
        await app.close();
      }
    }),
  );

  test(
    'repassa status, mensagem e expiração do erro 409',
    comCartao(async (cartao, clientes) => {
      const cliente = clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(cliente.id, {
        ambiente: 'producao',
        url: 'https://cliente.example/mge/',
        usuario: '',
        monitorar: false,
        ordem: 0,
      });
      const desktopBridge = {
        diagnosticarBase: async () => {
          throw new DesktopBridgeError('sessão da base expirou', 409, true);
        },
      } as unknown as DesktopBridge;
      const app = Fastify();
      registerRoutesCartao(app, { cartao, clientes, monitor: {} as MonitorBases, desktopBridge });

      try {
        const resposta = await app.inject({
          method: 'GET',
          url: `/api/clientes/${cliente.id}/bases/${base!.id}/diagnostico`,
        });
        assert.equal(resposta.statusCode, 409);
        assert.deepEqual(resposta.json(), { error: 'sessão da base expirou', expirou: true });
      } finally {
        await app.close();
      }
    }),
  );
});

describe('CartaoClientes — senha da base', () => {
  test(
    'a senha não sai na listagem, só pela revelação',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        { base: 'segredo' },
      );

      assert.equal(base?.temSenha, true);
      assert.ok(!JSON.stringify(base).includes('segredo'), 'o objeto listado não carrega a senha');
      assert.equal(await cartao.revelarSenha(base!.id), 'segredo');
    }),
  );

  test(
    'editar sem mandar senha mantém a guardada',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        { base: 'segredo' },
      );

      // `undefined` = "não mexe". Tratar campo ausente como apagar faria toda edição de
      // URL perder a senha em silêncio.
      await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://outro/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        {},
        base!.id,
      );

      assert.equal(await cartao.revelarSenha(base!.id), 'segredo');
      assert.equal(cartao.base(base!.id)?.url, 'https://outro/mge/');
    }),
  );

  test(
    'senha vazia explícita apaga',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        { base: 'segredo' },
      );

      await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        { base: '' },
        base!.id,
      );

      assert.equal(cartao.base(base!.id)?.temSenha, false);
      assert.equal(await cartao.revelarSenha(base!.id), null);
    }),
  );

  test(
    'ambiente desconhecido não vira ambiente inventado',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(
        1,
        // A rota valida antes, mas o banco pode ter vindo de uma versão futura.
        { ambiente: 'sandbox' as never, url: 'https://x/mge/', usuario: '', monitorar: false, ordem: 0 },
        {},
      );
      assert.equal(base?.ambiente, 'outro');
    }),
  );
});

describe('CartaoClientes — banco de dados da base', () => {
  const BASE = { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 } as const;
  const BANCO = {
    sgbd: 'oracle',
    host: 'db.cliente.local',
    porta: 1521,
    servico: 'ORCL',
    esquema: 'SANKHYA',
    usuario: 'SANKHYA',
  } as const;

  test(
    'grava e devolve a conexão, com a senha só pela revelação',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(1, { ...BASE, banco: BANCO }, { banco: 'segredo-do-banco' });

      assert.deepEqual(base?.banco, { ...BANCO, temSenha: true });
      assert.ok(!JSON.stringify(base).includes('segredo-do-banco'), 'a listagem não carrega a senha do banco');
      assert.equal(await cartao.revelarSenha(base!.id, 'banco_senha_cifrada'), 'segredo-do-banco');
    }),
  );

  test(
    'as duas senhas da base são independentes',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(
        1,
        { ...BASE, banco: BANCO },
        { base: 'senha-sankhya', banco: 'senha-banco' },
      );

      assert.equal(await cartao.revelarSenha(base!.id), 'senha-sankhya');
      assert.equal(await cartao.revelarSenha(base!.id, 'banco_senha_cifrada'), 'senha-banco');

      // Apagar uma não pode levar a outra junto.
      await cartao.gravarBase(1, { ...BASE, banco: BANCO }, { banco: '' }, base!.id);
      assert.equal(await cartao.revelarSenha(base!.id), 'senha-sankhya');
      assert.equal(cartao.base(base!.id)?.banco.temSenha, false);
    }),
  );

  test(
    'gravação sem `banco` não apaga a conexão guardada',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(1, { ...BASE, banco: BANCO }, { banco: 'segredo' });

      // É exatamente o que o botão "Monitorar" da tela manda: a base sem o bloco do
      // banco. Tratar ausente como vazio apagaria a conexão a cada clique no toggle.
      await cartao.gravarBase(1, { ...BASE, monitorar: true }, {}, base!.id);

      const depois = cartao.base(base!.id);
      assert.deepEqual(depois?.banco, { ...BANCO, temSenha: true });
      assert.equal(depois?.monitorar, true);
    }),
  );

  test(
    'base sem banco informado devolve o bloco vazio, não undefined',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(1, BASE, {});

      assert.deepEqual(base?.banco, {
        sgbd: '',
        host: '',
        porta: null,
        servico: '',
        esquema: '',
        usuario: '',
        temSenha: false,
      });
    }),
  );

  test(
    'SGBD desconhecido não vira SGBD inventado',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      // A rota valida antes, mas o banco pode ter vindo de uma versão futura.
      const base = await cartao.gravarBase(
        1,
        { ...BASE, banco: { ...BANCO, sgbd: 'db2' as never } },
        {},
      );
      assert.equal(base?.banco.sgbd, '');
    }),
  );
});

describe('CartaoClientes — posse das linhas', () => {
  test(
    'donoDe aponta o cliente certo, e some depois de remover',
    comCartao((cartao, clientes) => {
      clientes.criar(CLIENTE);
      clientes.criar({ ...CLIENTE, nome: 'Outro' });

      const link = cartao.gravarLink(2, { titulo: 'x', url: 'https://x', ordem: 0 });

      assert.equal(cartao.donoDe('links', link!.id), 2);
      assert.notEqual(cartao.donoDe('links', link!.id), 1);

      assert.equal(cartao.remover('links', link!.id), true);
      assert.equal(cartao.donoDe('links', link!.id), undefined);
      assert.equal(cartao.remover('links', link!.id), false, 'remover de novo não mente que deu certo');
    }),
  );

  test(
    'cada linha nova vai para o fim da lista',
    comCartao((cartao, clientes) => {
      clientes.criar(CLIENTE);
      for (const titulo of ['um', 'dois', 'três']) {
        cartao.gravarLink(1, { titulo, url: 'https://x', ordem: 0 });
      }

      assert.deepEqual(
        cartao.links(1).map((l) => l.titulo),
        ['um', 'dois', 'três'],
      );
      assert.deepEqual(
        cartao.links(1).map((l) => l.ordem),
        [0, 1, 2],
      );
    }),
  );
});

describe('CartaoClientes — repositórios cadastrados (lista da aba Git)', () => {
  test(
    'junta os repositórios de todos os clientes, com o nome do cliente',
    comCartao((cartao, clientes) => {
      clientes.criar({ ...CLIENTE, nome: 'Zeta' });
      clientes.criar({ ...CLIENTE, nome: 'Alfa' });

      cartao.gravarRepo(1, { nome: 'Fiscal', remoto: '', caminhoLocal: 'C:/repos/zeta-fiscal', ordem: 0 });
      cartao.gravarRepo(2, { nome: 'Comissão', remoto: '', caminhoLocal: 'C:/repos/alfa-com', ordem: 0 });

      const repos = cartao.reposCadastrados();

      // Ordenado por cliente: na aba Git a lista é agrupada por cliente, e vir fora de
      // ordem faria o mesmo cliente aparecer em dois grupos separados.
      assert.deepEqual(
        repos.map((r) => `${r.clienteNome}/${r.nome}`),
        ['Alfa/Comissão', 'Zeta/Fiscal'],
      );
      assert.equal(repos[0]?.caminhoLocal, 'C:/repos/alfa-com');
    }),
  );

  test(
    'repositório sem caminho local fica de fora — não há o que dar ao git-autosync',
    comCartao((cartao, clientes) => {
      clientes.criar(CLIENTE);
      cartao.gravarRepo(1, { nome: 'Só remoto', remoto: 'https://git/x.git', caminhoLocal: '', ordem: 0 });
      cartao.gravarRepo(1, { nome: 'Em branco', remoto: '', caminhoLocal: '   ', ordem: 1 });
      cartao.gravarRepo(1, { nome: 'Válido', remoto: '', caminhoLocal: 'C:/repos/x', ordem: 2 });

      assert.deepEqual(
        cartao.reposCadastrados().map((r) => r.nome),
        ['Válido'],
      );
    }),
  );
});
