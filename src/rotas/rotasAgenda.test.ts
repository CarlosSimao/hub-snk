import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import Fastify from 'fastify';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { AgendaRecursos } from '../sankhya/agenda.ts';
import type { Credenciais } from '../sankhya/credenciais.ts';
import type { Experience, OsLancada } from '../sankhya/experience.ts';
import { SolicitacaoNaoEncontradaError } from '../sankhya/solicitacaoServicos.ts';
import type { DecisaoDeCobranca, GestorDoSolicitante } from '../tipos.ts';
import { registrarRotasDeAgenda, type DependenciasDaCobranca } from './rotasAgenda.ts';

const OS: OsLancada = {
  implantationId: 9245,
  personId: 2208,
  orderId: 551755,
  numeroOs: '7183155',
  aceitePermitido: true,
};

const PEDIDO = {
  codparc: 49195,
  dia: '2026-10-16',
  horaInicio: '09:00',
  horaFim: '18:00',
  intervalo: '01:00',
  tarefasRealizadas: 'Homologação.',
  tipo: 'CONFORMIDADE',
  enviarParaAceite: true,
};

let decisoes: Map<string, DecisaoDeCobranca>;

beforeEach(() => {
  decisoes = new Map();
});

const GESTOR_DA_DS: GestorDoSolicitante = {
  codigoDaDs: 3536,
  solicitante: { id: 'ana', nome: 'Ana Souza', email: 'ana@cliente.com' },
  gestor: { id: 'bruno', nome: 'Bruno Lima', email: 'bruno@cliente.com' },
  motivo: '',
};

const cobranca: DependenciasDaCobranca = {
  decisoes: {
    descartarCache: () => {},
    listar: async () => new Map(decisoes),
    definir: async (identificacao, decisao) => {
      if (decisao) decisoes.set(identificacao, decisao);
      else decisoes.delete(identificacao);
    },
  },
  gestorDoSolicitante: async (codigo) => {
    if (codigo !== GESTOR_DA_DS.codigoDaDs)
      throw new SolicitacaoNaoEncontradaError(`DS ${codigo} não encontrada.`);
    return GESTOR_DA_DS;
  },
};

/** Só o que a rota de lançamento usa: os FAPs do parceiro no ERP e a Experience. */
function criarServidor(experience: Partial<Experience> = {}) {
  const credenciais = {
    consultarNegociacoesDoParceiro: async () => ({
      conteudo: JSON.stringify({ responseBody: { negociacoes: [] } }),
    }),
  } as unknown as Credenciais;
  const servidor = Fastify();
  registrarRotasDeAgenda(
    servidor,
    {} as AgendaRecursos,
    {} as RepositorioClientes,
    {} as RepositorioConfiguracao,
    credenciais,
    experience as Experience,
    async () => ({ situacao: 'sem-email', nome: '', contatoId: null }),
    cobranca,
  );
  return servidor;
}

function lancar(servidor: ReturnType<typeof criarServidor>, corpo: object = PEDIDO) {
  return servidor.inject({ method: 'POST', url: '/api/agenda/lancar-os', payload: corpo });
}

describe('POST /api/agenda/lancar-os', () => {
  it('lança e envia para o aceite', async () => {
    const aceites: OsLancada[] = [];
    const servidor = criarServidor({
      lancarOs: async () => OS,
      enviarParaAceite: async (os) => void aceites.push(os as OsLancada),
    });

    const resposta = await lancar(servidor);

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), { numeroOs: '7183155', avisoDoAceite: '' });
    assert.equal(aceites.length, 1);
  });

  it('não envia para o aceite sem pedido', async () => {
    let enviados = 0;
    const servidor = criarServidor({
      lancarOs: async () => OS,
      enviarParaAceite: async () => void (enviados += 1),
    });

    await lancar(servidor, { ...PEDIDO, enviarParaAceite: false });

    assert.equal(enviados, 0);
  });

  it('falha no aceite vira aviso, não erro: a OS já existe', async () => {
    const servidor = criarServidor({
      lancarOs: async () => OS,
      enviarParaAceite: async () => {
        throw new Error('sem aprovador');
      },
    });

    const resposta = await lancar(servidor);

    assert.equal(resposta.statusCode, 200);
    assert.match(resposta.json().avisoDoAceite, /lançada, mas o aceite não foi enviado/);
  });

  it('recusa horário inválido sem chamar a Experience', async () => {
    let lancamentos = 0;
    const servidor = criarServidor({ lancarOs: async () => (lancamentos++, OS) });

    const resposta = await lancar(servidor, { ...PEDIDO, horaInicio: '18:00', horaFim: '09:00' });

    assert.equal(resposta.statusCode, 400);
    assert.equal(lancamentos, 0);
  });

  it('segunda gravação ao mesmo tempo recebe 409', async () => {
    let liberar: () => void = () => {};
    const servidor = criarServidor({
      lancarOs: () => new Promise<OsLancada>((resolve) => (liberar = () => resolve(OS))),
      enviarParaAceite: async () => {},
    });

    const primeira = lancar(servidor);
    await new Promise((resolve) => setImmediate(resolve));
    const segunda = await lancar(servidor);
    liberar();

    assert.equal(segunda.statusCode, 409);
    assert.equal((await primeira).statusCode, 200);
  });
});

describe('POST /api/agenda/situacao/descartar-cache', () => {
  it('esquece os cadastros guardados na Experience', async () => {
    let descartes = 0;
    const servidor = criarServidor({ descartarCache: () => void (descartes += 1) });

    const resposta = await servidor.inject({
      method: 'POST',
      url: '/api/agenda/situacao/descartar-cache',
    });

    assert.equal(resposta.statusCode, 204);
    assert.equal(descartes, 1);
  });
});

describe('/api/agenda/cobranca', () => {
  function definir(servidor: ReturnType<typeof criarServidor>, corpo: object) {
    return servidor.inject({ method: 'PUT', url: '/api/agenda/cobranca', payload: corpo });
  }

  it('grava, lista e apaga a decisão do evento', async () => {
    const servidor = criarServidor();

    const gravacao = await definir(servidor, { identificacao: '123', modo: 'nao-cobrar' });
    const lista = await servidor.inject({ method: 'GET', url: '/api/agenda/cobranca' });
    await definir(servidor, { identificacao: '123', modo: 'cobrar' });

    assert.equal(gravacao.statusCode, 204);
    assert.deepEqual(lista.json(), {
      decisoes: { 123: { modo: 'nao-cobrar', gestorConfirmadoId: null } },
    });
    assert.deepEqual(decisoes, new Map());
  });

  it('guarda o gestor confirmado só no "com gestor"', async () => {
    const servidor = criarServidor();

    await definir(servidor, {
      identificacao: '1',
      modo: 'com-gestor',
      gestorConfirmadoId: 'bruno',
    });
    await definir(servidor, { identificacao: '2', modo: 'so-hub', gestorConfirmadoId: 'bruno' });

    assert.deepEqual(decisoes.get('1'), { modo: 'com-gestor', gestorConfirmadoId: 'bruno' });
    assert.deepEqual(decisoes.get('2'), { modo: 'so-hub', gestorConfirmadoId: null });
  });

  it('recusa "com gestor" sem o gestor confirmado, modo desconhecido e evento vazio', async () => {
    const servidor = criarServidor();

    const semGestor = await definir(servidor, { identificacao: '1', modo: 'com-gestor' });
    const modoInvalido = await definir(servidor, { identificacao: '1', modo: 'talvez' });
    const semEvento = await definir(servidor, { identificacao: '  ', modo: 'nao-cobrar' });

    assert.equal(semGestor.statusCode, 400);
    assert.match(semGestor.json().mensagem, /Confirme o gestor/);
    assert.equal(modoInvalido.statusCode, 400);
    assert.equal(semEvento.statusCode, 400);
    assert.deepEqual(decisoes, new Map());
  });
});

describe('GET /api/agenda/solicitacoes/:codigo/gestor', () => {
  it('devolve o solicitante e o gestor da DS', async () => {
    const resposta = await criarServidor().inject({
      method: 'GET',
      url: '/api/agenda/solicitacoes/3536/gestor',
    });

    assert.equal(resposta.statusCode, 200);
    assert.deepEqual(resposta.json(), GESTOR_DA_DS);
  });

  it('responde 404 para a DS que não existe', async () => {
    const resposta = await criarServidor().inject({
      method: 'GET',
      url: '/api/agenda/solicitacoes/9999/gestor',
    });

    assert.equal(resposta.statusCode, 404);
  });
});
