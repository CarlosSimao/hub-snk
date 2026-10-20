import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import Fastify from 'fastify';
import type { RepositorioClientes } from '../repositorio/repositorioClientes.ts';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import type { AgendaRecursos } from '../sankhya/agenda.ts';
import type { Credenciais } from '../sankhya/credenciais.ts';
import type { Experience, OsLancada } from '../sankhya/experience.ts';
import { registrarRotasDeAgenda } from './rotasAgenda.ts';

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

/** Só o que a rota de lançamento usa: os FAPs do parceiro no ERP e a Experience. */
function criarServidor(experience: Partial<Experience>) {
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
