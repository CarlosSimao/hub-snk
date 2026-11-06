import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DadosDeContato, RepositorioContatos } from '../repositorio/repositorioContatos.ts';
import type { Contato } from '../tipos.ts';
import { cadastrarSolicitante } from './contatoDoSolicitante.ts';
import { nomeDoLogin } from './solicitacaoServicos.ts';

function repositorioEmMemoria(iniciais: Contato[] = []) {
  const contatos = [...iniciais];
  const repositorio = {
    listar: async () => contatos,
    criar: async (dados: DadosDeContato) => {
      const contato = { ...dados, id: String(contatos.length + 1), criadoEm: '', atualizadoEm: '' };
      contatos.push(contato);
      return contato;
    },
    atualizar: async (id: string, dados: DadosDeContato) => {
      const indice = contatos.findIndex((c) => c.id === id);
      contatos[indice] = { ...contatos[indice]!, ...dados };
      return contatos[indice]!;
    },
  } as unknown as RepositorioContatos;
  return { repositorio, contatos };
}

const EVERTON = { nome: 'Everton Mendes', cargo: 'GERENTE DE PROJETOS', email: 'everton@x.com' };

function contato(dados: Partial<Contato>): Contato {
  return {
    id: 'a',
    nome: 'Everton',
    telefone: '',
    email: 'EVERTON@x.com',
    cargo: '',
    clienteId: null,
    criadoEm: '',
    atualizadoEm: '',
    ...dados,
  };
}

test('login vira nome: EVERTON.MENDES é Everton Mendes', () => {
  assert.equal(nomeDoLogin('EVERTON.MENDES'), 'Everton Mendes');
  assert.equal(nomeDoLogin('JOAO_FILHO'), 'Joao Filho');
  assert.equal(nomeDoLogin(''), '');
});

test('cria o contato sem cliente quando o e-mail é novo', async () => {
  const { repositorio, contatos } = repositorioEmMemoria();
  assert.deepEqual(await cadastrarSolicitante(repositorio, EVERTON), {
    situacao: 'criado',
    nome: 'Everton Mendes',
    contatoId: '1',
  });
  assert.deepEqual(
    contatos.map(({ nome, cargo, email, telefone, clienteId }) => ({
      nome,
      cargo,
      email,
      telefone,
      clienteId,
    })),
    [{ ...EVERTON, telefone: '', clienteId: null }],
  );
});

test('e-mail já cadastrado (sem diferenciar maiúscula) só ganha o cargo que faltava', async () => {
  const { repositorio, contatos } = repositorioEmMemoria([contato({ telefone: '11999' })]);
  assert.equal((await cadastrarSolicitante(repositorio, EVERTON)).situacao, 'completado');
  assert.equal(contatos.length, 1);
  assert.equal(contatos[0]?.nome, 'Everton', 'o nome digitado fica');
  assert.equal(contatos[0]?.telefone, '11999');
  assert.equal(contatos[0]?.cargo, 'GERENTE DE PROJETOS');
});

test('contato com cargo preenchido não muda', async () => {
  const { repositorio, contatos } = repositorioEmMemoria([contato({ cargo: 'GP' })]);
  assert.deepEqual(await cadastrarSolicitante(repositorio, EVERTON), {
    situacao: 'existente',
    nome: 'Everton',
    contatoId: 'a',
  });
  assert.equal(contatos[0]?.cargo, 'GP');
});

test('sem e-mail não cadastra', async () => {
  const { repositorio, contatos } = repositorioEmMemoria();
  assert.equal(
    (await cadastrarSolicitante(repositorio, { ...EVERTON, email: '' })).situacao,
    'sem-email',
  );
  assert.equal((await cadastrarSolicitante(repositorio, null)).situacao, 'sem-email');
  assert.equal(contatos.length, 0);
});
