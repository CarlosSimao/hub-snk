import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, test } from 'node:test';
import { DriveNaoConectadoError } from '../drive/contaDoGoogle.ts';
import type { PessoaDoDiretorio } from '../drive/organogramaDoGoogle.ts';
import { RepositorioContatosArquivo } from '../repositorio/arquivo/repositorioContatosArquivo.ts';
import type { DadosDeContato, RepositorioContatos } from '../repositorio/repositorioContatos.ts';
import type { Contato } from '../tipos.ts';
import { cadastrarSolicitante, cadastrarSolicitanteComGestores } from './contatoDoSolicitante.ts';
import { nomeDoLogin } from './solicitacaoServicos.ts';

function repositorioEmMemoria(iniciais: Contato[] = []) {
  const contatos = [...iniciais];
  const repositorio = {
    listar: async () => contatos,
    criar: async (dados: DadosDeContato) => {
      const contato = {
        gestorId: null,
        gerente: false,
        ...dados,
        id: String(contatos.length + 1),
        criadoEm: '',
        atualizadoEm: '',
      };
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
    gestorId: null,
    gerente: false,
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

describe('gestores do solicitante pelo organograma', () => {
  let diretorio: string;
  let contatos: RepositorioContatosArquivo;
  const avisos: string[] = [];
  const registrador = { warn: (mensagem: string) => avisos.push(mensagem) };
  const PAULO = { nome: 'Paulo Mello', email: 'paulo@x.com', cargo: 'Gerente' };
  const EMNE = { nome: 'Emne Nassif', email: 'emne@x.com', cargo: 'Executivo' };
  const organograma = (gestores: PessoaDoDiretorio[]) => ({ gestoresDe: async () => gestores });

  beforeEach(async () => {
    diretorio = await mkdtemp(join(tmpdir(), 'hub-snk-gestores-'));
    contatos = new RepositorioContatosArquivo(diretorio);
    avisos.length = 0;
  });

  afterEach(async () => {
    await rm(diretorio, { recursive: true, force: true });
  });

  const porEmail = async (email: string) =>
    (await contatos.listar()).find((contato) => contato.email === email);

  it('cadastra o gestor e o gestor do gestor, ligados e marcados como "Gerente"', async () => {
    await cadastrarSolicitanteComGestores(
      contatos,
      EVERTON,
      organograma([PAULO, EMNE]),
      registrador,
    );

    const everton = await porEmail(EVERTON.email);
    const paulo = await porEmail(PAULO.email);
    const emne = await porEmail(EMNE.email);
    assert.equal(everton?.gestorId, paulo?.id);
    assert.equal(paulo?.gestorId, emne?.id);
    assert.equal(emne?.gestorId, null);
    assert.deepEqual([everton?.gerente, paulo?.gerente, emne?.gerente], [false, true, true]);
    assert.deepEqual(
      { nome: paulo?.nome, cargo: paulo?.cargo, clienteId: paulo?.clienteId },
      { nome: 'Paulo Mello', cargo: 'Gerente', clienteId: null },
    );
  });

  it('gestor que já é contato é reaproveitado e só ganha o cargo que faltava', async () => {
    await contatos.criar({ ...PAULO, nome: 'Paulo', cargo: '', telefone: '119', clienteId: null });

    await cadastrarSolicitanteComGestores(contatos, EVERTON, organograma([PAULO]), registrador);

    const lidos = await contatos.listar();
    assert.equal(lidos.length, 2);
    const paulo = await porEmail(PAULO.email);
    assert.deepEqual([paulo?.nome, paulo?.cargo, paulo?.telefone], ['Paulo', 'Gerente', '119']);
  });

  it('gestor diferente no diretório troca o gravado; o antigo continua "Gerente"', async () => {
    await cadastrarSolicitanteComGestores(contatos, EVERTON, organograma([PAULO]), registrador);
    await cadastrarSolicitanteComGestores(contatos, EVERTON, organograma([EMNE]), registrador);

    assert.equal((await porEmail(EVERTON.email))?.gestorId, (await porEmail(EMNE.email))?.id);
    assert.equal((await porEmail(PAULO.email))?.gerente, true);
  });

  it('sem gestor no diretório, o gravado fica', async () => {
    await cadastrarSolicitanteComGestores(contatos, EVERTON, organograma([PAULO]), registrador);
    await cadastrarSolicitanteComGestores(contatos, EVERTON, organograma([]), registrador);

    assert.equal((await porEmail(EVERTON.email))?.gestorId, (await porEmail(PAULO.email))?.id);
  });

  it('organograma desconectado não vai para o log; outra falha vai, e o solicitante fica', async () => {
    const falhar = (erro: Error) => ({
      gestoresDe: async () => {
        throw erro;
      },
    });

    await cadastrarSolicitanteComGestores(
      contatos,
      EVERTON,
      falhar(new DriveNaoConectadoError('desconectado')),
      registrador,
    );
    assert.deepEqual(avisos, []);

    const resultado = await cadastrarSolicitanteComGestores(
      contatos,
      EVERTON,
      falhar(new Error('HTTP 500')),
      registrador,
    );
    assert.equal(resultado.situacao, 'existente');
    assert.deepEqual(avisos, ['Gestores de everton@x.com fora dos contatos: HTTP 500']);
    assert.equal((await contatos.listar()).length, 1);
  });
});
