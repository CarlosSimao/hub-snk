import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OrganogramaDoGoogle } from './organogramaDoGoogle.ts';

interface PessoaFalsa {
  nome: string;
  cargo: string;
  gestor?: string;
}

/** Diretório falso por e-mail, com as consultas anotadas. */
function diretorio(pessoas: Record<string, PessoaFalsa>) {
  const consultas: string[] = [];
  const buscar = (async (endereco: URL) => {
    const email = endereco.searchParams.get('query') ?? '';
    consultas.push(email);
    const pessoa = pessoas[email];
    const people = pessoa
      ? [
          {
            names: [{ displayName: pessoa.nome }],
            emailAddresses: [{ value: email.toUpperCase() }],
            organizations: [{ title: pessoa.cargo }],
            relations: pessoa.gestor ? [{ person: pessoa.gestor, type: 'manager' }] : [],
          },
        ]
      : [];
    return new Response(JSON.stringify({ people }), { status: 200 });
  }) as unknown as typeof fetch;
  return { buscar, consultas };
}

const conta = {
  tokenDeAcesso: async () => 'token',
  descartarTokenDeAcesso: () => {},
};

const ORGANOGRAMA = {
  'everton@x.com': { nome: 'Everton', cargo: 'GP', gestor: 'paulo@x.com' },
  'paulo@x.com': { nome: 'Paulo', cargo: 'Gerente', gestor: 'emne@x.com' },
  'emne@x.com': { nome: 'Emne', cargo: 'Executivo', gestor: 'claiton@x.com' },
  'claiton@x.com': { nome: 'Claiton', cargo: 'Diretor' },
};

describe('OrganogramaDoGoogle', () => {
  it('sobe dois graus: o gestor e o gestor do gestor', async () => {
    const { buscar, consultas } = diretorio(ORGANOGRAMA);

    const gestores = await new OrganogramaDoGoogle(conta, buscar).gestoresDe(' Everton@X.com ');

    assert.deepEqual(gestores, [
      { nome: 'Paulo', email: 'paulo@x.com', cargo: 'Gerente' },
      { nome: 'Emne', email: 'emne@x.com', cargo: 'Executivo' },
    ]);
    assert.deepEqual(consultas, ['everton@x.com', 'paulo@x.com', 'emne@x.com']);
  });

  it('para onde o diretório não tem o próximo', async () => {
    const { buscar } = diretorio({
      'everton@x.com': { nome: 'Everton', cargo: '', gestor: 'paulo@x.com' },
    });

    assert.deepEqual(await new OrganogramaDoGoogle(conta, buscar).gestoresDe('everton@x.com'), []);
  });

  it('guarda a cadeia por um dia', async () => {
    const { buscar, consultas } = diretorio(ORGANOGRAMA);
    let agora = 0;
    const organograma = new OrganogramaDoGoogle(conta, buscar, () => agora);

    await organograma.gestoresDe('everton@x.com');
    await organograma.gestoresDe('EVERTON@x.com');
    assert.equal(consultas.length, 3);

    agora = 24 * 60 * 60_000 + 1;
    await organograma.gestoresDe('everton@x.com');
    assert.equal(consultas.length, 6);
  });

  it('erro do Google vira exceção com o motivo, e 401 descarta o token', async () => {
    let descartado = false;
    const buscar = (async () =>
      new Response(JSON.stringify({ error: { message: 'Sem permissão' } }), {
        status: 401,
      })) as unknown as typeof fetch;
    const organograma = new OrganogramaDoGoogle(
      { ...conta, descartarTokenDeAcesso: () => (descartado = true) },
      buscar,
    );

    await assert.rejects(organograma.gestoresDe('everton@x.com'), /HTTP 401\): Sem permissão/);
    assert.equal(descartado, true);
  });
});
