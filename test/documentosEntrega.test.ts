/**
 * Documentos de entrega oferecidos como anexo na tela de e-mail.
 *
 * Esta lista nao e' so' conveniencia: e' ela que autoriza o envio. A rota confere cada
 * caminho pedido contra o que aparece aqui, entao um arquivo que nao esta' nesta lista
 * nao pode virar anexo por mais que o pedido insista.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { Clientes } from '../src/sankhya/clientes.ts';
import { CartaoClientes } from '../src/sankhya/cartao.ts';
import { documentosDoCliente, tipoMime } from '../src/documentosEntrega.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';
import type { ClienteEntrada } from '../src/types.ts';
import { dirTemporario } from './helpers.ts';

const helperFalso = {
  async requisitar<T>(): Promise<T> {
    return { valor: '' } as T;
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

/** Repositorio de mentira com a pasta que a skill usa. */
function repositorio(raiz: string, nome: string, arquivos: { nome: string; quando?: Date }[]): string {
  const pasta = join(raiz, nome, 'Documentacao');
  mkdirSync(pasta, { recursive: true });
  for (const arquivo of arquivos) {
    const caminho = join(pasta, arquivo.nome);
    writeFileSync(caminho, '<html>documento</html>', 'utf8');
    if (arquivo.quando) utimesSync(caminho, arquivo.quando, arquivo.quando);
  }
  return join(raiz, nome);
}

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

describe('Documentos de entrega', () => {
  test(
    'junta os documentos dos repositorios do cliente, do mais recente para o mais antigo',
    comCartao((cartao, clientes, dir) => {
      clientes.criar(CLIENTE);

      const antigo = new Date('2026-09-01T10:00:00Z');
      const novo = new Date('2026-09-20T10:00:00Z');
      const repoA = repositorio(dir, 'fiscal', [{ nome: 'Entrega - Fiscal.html', quando: antigo }]);
      const repoB = repositorio(dir, 'comissao', [{ nome: 'Entrega - Comissao.docx', quando: novo }]);

      cartao.gravarRepo(1, { nome: 'Fiscal', remoto: '', caminhoLocal: repoA, ordem: 0 });
      cartao.gravarRepo(1, { nome: 'Comissão', remoto: '', caminhoLocal: repoB, ordem: 1 });

      const documentos = documentosDoCliente(cartao, 1);

      assert.deepEqual(
        documentos.map((doc) => doc.nome),
        ['Entrega - Comissao.docx', 'Entrega - Fiscal.html'],
      );
      assert.equal(documentos[0]?.repositorio, 'Comissão');
      assert.ok(documentos[0]!.bytes > 0);
    }),
  );

  test(
    'so entra o que a skill gera — outro arquivo na mesma pasta fica de fora',
    comCartao((cartao, clientes, dir) => {
      clientes.criar(CLIENTE);
      const repo = repositorio(dir, 'projeto', [
        { nome: 'Entrega - Valido.html' },
        // Nao sao documento de entrega: nome fora do padrao, extensao fora do padrao e
        // backup que a propria skill deixa ao regravar.
        { nome: 'anotacoes.html' },
        { nome: 'Entrega - Rascunho.txt' },
        { nome: 'Entrega - Valido.html.bak' },
      ]);
      cartao.gravarRepo(1, { nome: 'Projeto', remoto: '', caminhoLocal: repo, ordem: 0 });

      assert.deepEqual(
        documentosDoCliente(cartao, 1).map((doc) => doc.nome),
        ['Entrega - Valido.html'],
      );
    }),
  );

  test(
    'repositorio sem pasta de documentacao, ou sem caminho, nao quebra a listagem',
    comCartao((cartao, clientes, dir) => {
      clientes.criar(CLIENTE);
      mkdirSync(join(dir, 'vazio'), { recursive: true });
      cartao.gravarRepo(1, { nome: 'Vazio', remoto: '', caminhoLocal: join(dir, 'vazio'), ordem: 0 });
      cartao.gravarRepo(1, { nome: 'Sem caminho', remoto: '', caminhoLocal: '', ordem: 1 });
      cartao.gravarRepo(1, { nome: 'Sumiu', remoto: '', caminhoLocal: join(dir, 'nao-existe'), ordem: 2 });

      assert.deepEqual(documentosDoCliente(cartao, 1), []);
    }),
  );

  test('o tipo MIME acompanha a extensao — o Word abre no Word', () => {
    assert.match(tipoMime('Entrega - X.docx'), /wordprocessingml/);
    assert.equal(tipoMime('Entrega - X.html'), 'text/html');
  });
});
