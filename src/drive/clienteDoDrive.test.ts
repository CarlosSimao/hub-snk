import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ClienteDoDrive, ehIdDoDrive, ErroDoDrive } from './clienteDoDrive.ts';

const TIPO_DE_PASTA = 'application/vnd.google-apps.folder';

interface Chamada {
  url: URL;
  metodo: string;
  cabecalhos: Headers;
  corpo: unknown;
}

let chamadas: Chamada[];
let respostas: ((chamada: Chamada) => Response | undefined)[];
let tokens: string[];
let descartes: number;
let drive: ClienteDoDrive;

/** Responde com a primeira regra que reconhecer a chamada; sem regra, 500 para o teste falhar alto. */
const buscar: typeof fetch = async (entrada, init) => {
  const chamada: Chamada = {
    url: new URL(String(entrada)),
    metodo: init?.method ?? 'GET',
    cabecalhos: new Headers(init?.headers),
    corpo: init?.body,
  };
  chamadas.push(chamada);
  for (const regra of respostas) {
    const resposta = regra(chamada);
    if (resposta) {
      return resposta;
    }
  }
  return Response.json({ error: { message: 'chamada inesperada' } }, { status: 500 });
};

function erroDoGoogle(status: number, motivo: string): Response {
  return Response.json({ error: { message: motivo, errors: [{ reason: motivo }] } }, { status });
}

beforeEach(() => {
  chamadas = [];
  respostas = [];
  tokens = ['token-1', 'token-2'];
  descartes = 0;
  drive = new ClienteDoDrive(
    {
      tokenDeAcesso: async () => tokens[descartes] ?? 'token-final',
      descartarTokenDeAcesso: () => {
        descartes += 1;
      },
    },
    buscar,
  );
});

describe('ehIdDoDrive', () => {
  it('aceita só letras, dígitos, hífen e sublinhado', () => {
    assert.equal(ehIdDoDrive('1AbCdEfGhIjKlMnOpQrStUvWxYz_0-9'), true);
    assert.equal(ehIdDoDrive("1' in parents or '1"), false);
    assert.equal(ehIdDoDrive('../outra'), false);
    assert.equal(ehIdDoDrive('curto'), false);
  });
});

describe('falhas', () => {
  it('arquivo inexistente ou sem acesso vira 404', async () => {
    respostas.push(() => erroDoGoogle(404, 'notFound'));

    await assert.rejects(drive.baixarArquivo('arquivo-1'), (erro: unknown) => {
      assert.ok(erro instanceof ErroDoDrive);
      assert.equal(erro.status, 404);
      return true;
    });
  });

  it('permissão que o usuário não deu vira a instrução de conectar de novo', async () => {
    respostas.push(() => erroDoGoogle(403, 'insufficientPermissions'));

    await assert.rejects(drive.listarArquivosGuardados('pasta'), /Desconecte o Google Drive/);
  });

  it('token recusado pelo Google é trocado, e a chamada repetida uma vez', async () => {
    respostas.push((chamada) =>
      chamada.cabecalhos.get('authorization') === 'Bearer token-1'
        ? erroDoGoogle(401, 'authError')
        : Response.json({ files: [] }),
    );

    assert.deepEqual(await drive.listarArquivosGuardados('pasta'), []);
    assert.equal(descartes, 1);
    assert.equal(chamadas.length, 2);
  });

  it('token recusado duas vezes não vira laço', async () => {
    respostas.push(() => erroDoGoogle(401, 'authError'));

    await assert.rejects(drive.listarArquivosGuardados('pasta'), ErroDoDrive);
    assert.equal(chamadas.length, 2);
  });

  it('sem rede vira erro do Drive com mensagem legível', async () => {
    const semRede = new ClienteDoDrive(
      { tokenDeAcesso: async () => 't', descartarTokenDeAcesso: () => {} },
      async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      },
    );

    await assert.rejects(
      semRede.listarArquivosGuardados('pasta'),
      /Não foi possível falar com o Google Drive/,
    );
  });
});

describe('pasta e arquivos do HUB SNK', () => {
  it('reaproveita a pasta marcada como do HUB SNK, sem criar outra', async () => {
    respostas.push(() => Response.json({ files: [{ id: 'pasta-existente' }] }));

    assert.equal(await drive.garantirPastaDoHub('HUB SNK'), 'pasta-existente');
    assert.equal(chamadas.length, 1);
    assert.match(
      chamadas[0]?.url.searchParams.get('q') ?? '',
      /appProperties has \{ key='hubSnk' and value='dados' \}/,
    );
  });

  it('cria a pasta, com a marca, quando ainda não existe', async () => {
    respostas.push((chamada) =>
      chamada.metodo === 'POST'
        ? Response.json({ id: 'pasta-nova' })
        : Response.json({ files: [] }),
    );

    assert.equal(await drive.garantirPastaDoHub('HUB SNK'), 'pasta-nova');
    assert.deepEqual(JSON.parse(String(chamadas[1]?.corpo)), {
      name: 'HUB SNK',
      mimeType: TIPO_DE_PASTA,
      appProperties: { hubSnk: 'dados' },
    });
  });

  it('envia arquivo novo em dois passos, para a pasta do HUB SNK', async () => {
    const conteudo = Buffer.from('pacote');
    respostas.push((chamada) => {
      if (chamada.url.hostname === 'envio.exemplo') {
        return Response.json({ id: 'arquivo-novo' });
      }
      return new Response(null, { headers: { location: 'https://envio.exemplo/sessao' } });
    });

    const id = await drive.enviarArquivo({
      idDaPasta: 'pasta',
      nome: 'hub-snk-dados-PC.zip',
      tipo: 'application/zip',
      conteudo,
    });

    assert.equal(id, 'arquivo-novo');
    const [abertura, envio] = chamadas;
    assert.equal(abertura?.metodo, 'POST');
    assert.equal(abertura?.url.pathname, '/upload/drive/v3/files');
    assert.equal(abertura?.url.searchParams.get('uploadType'), 'resumable');
    assert.equal(abertura?.cabecalhos.get('x-upload-content-length'), String(conteudo.length));
    assert.deepEqual(JSON.parse(String(abertura?.corpo)), {
      name: 'hub-snk-dados-PC.zip',
      parents: ['pasta'],
    });
    assert.equal(envio?.metodo, 'PUT');
    assert.ok(Buffer.from(envio?.corpo as Uint8Array).equals(conteudo));
  });

  it('substitui o conteúdo do arquivo que já existe, sem mudar nome nem pasta', async () => {
    respostas.push((chamada) =>
      chamada.url.hostname === 'envio.exemplo'
        ? Response.json({ id: 'arquivo-1' })
        : new Response(null, { headers: { location: 'https://envio.exemplo/sessao' } }),
    );

    const id = await drive.enviarArquivo({
      idDaPasta: 'pasta',
      idDoArquivo: 'arquivo-1',
      nome: 'hub-snk-dados-PC.zip',
      tipo: 'application/zip',
      conteudo: Buffer.from('novo'),
    });

    assert.equal(id, 'arquivo-1');
    assert.equal(chamadas[0]?.metodo, 'PATCH');
    assert.equal(chamadas[0]?.url.pathname, '/upload/drive/v3/files/arquivo-1');
    assert.deepEqual(JSON.parse(String(chamadas[0]?.corpo)), {});
  });

  it('baixa o conteúdo do arquivo', async () => {
    respostas.push(() => new Response(Buffer.from('conteúdo do pacote')));

    const baixado = await drive.baixarArquivo('arquivo-1');

    assert.equal(baixado.toString('utf8'), 'conteúdo do pacote');
    assert.equal(chamadas[0]?.url.searchParams.get('alt'), 'media');
  });
});
