/**
 * O cartao do cliente: migracao dos campos unicos, senha das bases e posse das linhas.
 *
 * O teste que mais importa e o da migracao: ela roda em todo boot do hub, sobre o
 * cadastro real do usuario. Duplicar o repositorio de todo mundo a cada reinicio seria
 * silencioso e so apareceria depois de a lista ja estar impraticavel.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Clientes } from '../src/sankhya/clientes.ts';
import { CartaoClientes } from '../src/sankhya/cartao.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';
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
  sankhyaUrl: '',
  repositorioLocal: '',
  repositorioRemoto: '',
  anotacoes: '',
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

describe('CartaoClientes — senha da base', () => {
  test(
    'a senha não sai na listagem, só pela revelação',
    comCartao(async (cartao, clientes) => {
      clientes.criar(CLIENTE);
      const base = await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        'segredo',
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
        'segredo',
      );

      // `undefined` = "não mexe". Tratar campo ausente como apagar faria toda edição de
      // URL perder a senha em silêncio.
      await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://outro/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        undefined,
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
        'segredo',
      );

      await cartao.gravarBase(
        1,
        { ambiente: 'producao', url: 'https://x/mge/', usuario: 'SUP', monitorar: false, ordem: 0 },
        '',
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
        undefined,
      );
      assert.equal(base?.ambiente, 'outro');
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
