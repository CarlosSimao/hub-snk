import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { CofreDoDrive, SegredoDoDrive } from './cofreDoDrive.ts';
import {
  ContaDoGoogle,
  DriveNaoConectadoError,
  DriveNaoConfiguradoError,
  ESCOPO_DOS_ARQUIVOS_DO_HUB,
} from './contaDoGoogle.ts';

const CREDENCIAL = { clientId: 'id-do-hub.apps.googleusercontent.com', clientSecret: 'segredo' };

class CofreEmMemoria implements CofreDoDrive {
  segredo: SegredoDoDrive | null = null;
  indisponivel = false;

  async ler(): Promise<SegredoDoDrive | null> {
    if (this.indisponivel) {
      throw new Error('shell fora do ar');
    }
    return this.segredo;
  }

  async gravar(segredo: SegredoDoDrive): Promise<void> {
    this.segredo = segredo;
  }

  async remover(): Promise<void> {
    this.segredo = null;
  }
}

interface ChamadaAoGoogle {
  url: string;
  corpo: URLSearchParams;
}

let cofre: CofreEmMemoria;
let chamadas: ChamadaAoGoogle[];
let respostaDoToken: Record<string, unknown>;
let abertos: string[];
let agoraMs: number;
let conta: ContaDoGoogle;

/** O Google de mentira: só as chamadas feitas a ele; o retorno em 127.0.0.1 é de verdade. */
const googleFalso: typeof fetch = async (entrada, init) => {
  const url = String(entrada);
  chamadas.push({ url, corpo: new URLSearchParams(String(init?.body ?? '')) });

  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return Response.json(respostaDoToken);
  }
  if (url.startsWith('https://www.googleapis.com/drive/v3/about')) {
    return Response.json({ user: { emailAddress: 'ana@exemplo.com' } });
  }
  return Response.json({});
};

function chamadasDeToken(): ChamadaAoGoogle[] {
  return chamadas.filter((chamada) => chamada.url.includes('/token'));
}

/** O que o navegador faz depois do consentimento: volta ao endereço de retorno com o código. */
async function voltarDoGoogle(url: string, parametros: Record<string, string>): Promise<Response> {
  const autorizacao = new URL(url);
  const retorno = new URL(autorizacao.searchParams.get('redirect_uri') ?? '');
  retorno.search = new URLSearchParams({
    state: autorizacao.searchParams.get('state') ?? '',
    ...parametros,
  }).toString();
  return fetch(retorno);
}

beforeEach(() => {
  cofre = new CofreEmMemoria();
  chamadas = [];
  abertos = [];
  agoraMs = 1_000_000;
  respostaDoToken = {
    access_token: 'acesso-1',
    refresh_token: 'renovacao-1',
    expires_in: 3600,
    scope: ESCOPO_DOS_ARQUIVOS_DO_HUB,
  };
  conta = new ContaDoGoogle({
    credencial: CREDENCIAL,
    cofre,
    abrirNoNavegador: async (endereco) => {
      abertos.push(endereco);
    },
    buscar: googleFalso,
    agora: () => agoraMs,
  });
});

afterEach(() => {
  conta.encerrar();
});

describe('autorização', () => {
  it('abre o consentimento com PKCE, os dois escopos e retorno em 127.0.0.1', async () => {
    const { url } = await conta.iniciarAutorizacao();
    const parametros = new URL(url).searchParams;

    assert.deepEqual(abertos, [url]);
    assert.equal(new URL(url).origin, 'https://accounts.google.com');
    assert.equal(parametros.get('client_id'), CREDENCIAL.clientId);
    assert.equal(parametros.get('scope'), ESCOPO_DOS_ARQUIVOS_DO_HUB);
    assert.equal(parametros.get('code_challenge_method'), 'S256');
    assert.equal(parametros.get('access_type'), 'offline');
    assert.match(parametros.get('redirect_uri') ?? '', /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await conta.situacao()).autorizando, true);
  });

  it('troca o código pelo token, com o verificador do PKCE, e guarda a conta no cofre', async () => {
    const { url } = await conta.iniciarAutorizacao();

    const pagina = await voltarDoGoogle(url, { code: 'codigo-do-google' });

    assert.match(await pagina.text(), /Google Drive conectado.*ana@exemplo\.com/s);
    assert.deepEqual(cofre.segredo, {
      refreshToken: 'renovacao-1',
      email: 'ana@exemplo.com',
      escopos: [ESCOPO_DOS_ARQUIVOS_DO_HUB],
    });

    const [troca] = chamadasDeToken();
    assert.equal(troca?.corpo.get('grant_type'), 'authorization_code');
    assert.equal(troca?.corpo.get('code'), 'codigo-do-google');
    assert.equal(troca?.corpo.get('redirect_uri'), new URL(url).searchParams.get('redirect_uri'));
    const desafio = createHash('sha256')
      .update(troca?.corpo.get('code_verifier') ?? '')
      .digest('base64url');
    assert.equal(desafio, new URL(url).searchParams.get('code_challenge'));

    assert.deepEqual(await conta.situacao(), {
      configurado: true,
      cofreDisponivel: true,
      conectado: true,
      email: 'ana@exemplo.com',
      podeGuardarCopia: true,
      autorizando: false,
      erro: '',
    });
  });

  it('o token recebido na autorização já serve, sem pedir outro', async () => {
    const { url } = await conta.iniciarAutorizacao();
    await voltarDoGoogle(url, { code: 'codigo' });

    assert.equal(await conta.tokenDeAcesso(), 'acesso-1');
    assert.equal(chamadasDeToken().length, 1);
  });

  it('registra que o usuário não deu a permissão de guardar a cópia', async () => {
    respostaDoToken = { ...respostaDoToken, scope: 'openid' };
    const { url } = await conta.iniciarAutorizacao();

    await voltarDoGoogle(url, { code: 'codigo' });

    const situacao = await conta.situacao();
    assert.equal(situacao.conectado, true);
    assert.equal(situacao.podeGuardarCopia, false);
  });

  it('ignora o retorno com outro state: não troca código nem encerra a tentativa', async () => {
    const { url } = await conta.iniciarAutorizacao();
    const retorno = new URL(new URL(url).searchParams.get('redirect_uri') ?? '');
    retorno.search = 'state=de-outro-lugar&code=codigo-forjado';

    const resposta = await fetch(retorno);

    assert.equal(resposta.status, 404);
    assert.equal(chamadasDeToken().length, 0);
    assert.equal(cofre.segredo, null);
    assert.equal((await conta.situacao()).autorizando, true);
  });

  it('o cancelamento na tela do Google vira o motivo mostrado, sem conectar', async () => {
    const { url } = await conta.iniciarAutorizacao();

    await voltarDoGoogle(url, { error: 'access_denied' });

    const situacao = await conta.situacao();
    assert.equal(situacao.conectado, false);
    assert.equal(situacao.autorizando, false);
    assert.match(situacao.erro, /cancelada/);
  });

  it('sem o token de renovação não conecta, e diz por quê', async () => {
    respostaDoToken = {
      access_token: 'acesso-1',
      expires_in: 3600,
      scope: ESCOPO_DOS_ARQUIVOS_DO_HUB,
    };
    const { url } = await conta.iniciarAutorizacao();

    await voltarDoGoogle(url, { code: 'codigo' });

    assert.equal(cofre.segredo, null);
    assert.match((await conta.situacao()).erro, /autorização permanente/);
    await assert.rejects(conta.tokenDeAcesso(), DriveNaoConectadoError);
  });

  it('sem a credencial do Google Cloud recusa, e a situação diz que não está configurado', async () => {
    const semCredencial = new ContaDoGoogle({
      credencial: { clientId: '', clientSecret: '' },
      cofre,
      abrirNoNavegador: async () => {},
      buscar: googleFalso,
    });

    await assert.rejects(semCredencial.iniciarAutorizacao(), DriveNaoConfiguradoError);
    assert.equal((await semCredencial.situacao()).configurado, false);
  });

  it('sem o cofre não manda o usuário ao Google, e a situação mostra o cofre fora do ar', async () => {
    cofre.indisponivel = true;

    await assert.rejects(conta.iniciarAutorizacao(), /shell fora do ar/);
    assert.deepEqual(abertos, []);
    const situacao = await conta.situacao();
    assert.equal(situacao.cofreDisponivel, false);
    assert.equal(situacao.conectado, false);
  });

  it('o navegador que não abre não derruba a tentativa: o endereço volta para a tela', async () => {
    const semNavegador = new ContaDoGoogle({
      credencial: CREDENCIAL,
      cofre,
      abrirNoNavegador: async () => {
        throw new Error('sem navegador');
      },
      buscar: googleFalso,
    });

    try {
      const { url } = await semNavegador.iniciarAutorizacao();
      assert.match(url, /^https:\/\/accounts\.google\.com/);
      assert.equal((await semNavegador.situacao()).autorizando, true);
    } finally {
      semNavegador.encerrar();
    }
  });
});

describe('token de acesso', () => {
  beforeEach(() => {
    cofre.segredo = { refreshToken: 'renovacao-1', email: 'ana@exemplo.com', escopos: [] };
    respostaDoToken = { access_token: 'acesso-renovado', expires_in: 3600 };
  });

  it('renova com o token do cofre e reaproveita até perto de vencer', async () => {
    assert.equal(await conta.tokenDeAcesso(), 'acesso-renovado');
    assert.equal(await conta.tokenDeAcesso(), 'acesso-renovado');
    assert.equal(chamadasDeToken().length, 1);
    assert.equal(chamadasDeToken()[0]?.corpo.get('grant_type'), 'refresh_token');
    assert.equal(chamadasDeToken()[0]?.corpo.get('refresh_token'), 'renovacao-1');

    agoraMs += 3_590_000;
    await conta.tokenDeAcesso();
    assert.equal(chamadasDeToken().length, 2);
  });

  it('pedidos simultâneos com o token vencido renovam uma vez só', async () => {
    await Promise.all([conta.tokenDeAcesso(), conta.tokenDeAcesso(), conta.tokenDeAcesso()]);

    assert.equal(chamadasDeToken().length, 1);
  });

  it('token descartado é buscado de novo', async () => {
    await conta.tokenDeAcesso();
    conta.descartarTokenDeAcesso();
    await conta.tokenDeAcesso();

    assert.equal(chamadasDeToken().length, 2);
  });

  it('acesso revogado na conta do Google desconecta e pede para conectar de novo', async () => {
    respostaDoToken = { error: 'invalid_grant', error_description: 'Token has been revoked.' };

    await assert.rejects(conta.tokenDeAcesso(), /revogado ou expirou/);
    assert.equal(cofre.segredo, null);
    assert.equal((await conta.situacao()).conectado, false);
  });

  it('outra falha do Google não apaga a conexão', async () => {
    respostaDoToken = { error: 'temporarily_unavailable' };

    await assert.rejects(conta.tokenDeAcesso(), /temporarily_unavailable/);
    assert.notEqual(cofre.segredo, null);
  });
});

describe('desconectar', () => {
  it('revoga o token no Google e tira a conta do cofre', async () => {
    cofre.segredo = { refreshToken: 'renovacao-1', email: 'ana@exemplo.com', escopos: [] };

    await conta.desconectar();

    assert.equal(cofre.segredo, null);
    const revogacao = chamadas.find((chamada) => chamada.url.includes('/revoke'));
    assert.equal(revogacao?.corpo.get('token'), 'renovacao-1');
    await assert.rejects(conta.tokenDeAcesso(), DriveNaoConectadoError);
  });

  it('sem rede para revogar, a conta sai do cofre do mesmo jeito', async () => {
    cofre.segredo = { refreshToken: 'renovacao-1', email: 'ana@exemplo.com', escopos: [] };
    const semRede = new ContaDoGoogle({
      credencial: CREDENCIAL,
      cofre,
      abrirNoNavegador: async () => {},
      buscar: async () => {
        throw new Error('sem rede');
      },
    });

    await semRede.desconectar();

    assert.equal(cofre.segredo, null);
  });
});
