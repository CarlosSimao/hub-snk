import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Credenciais } from './credenciais.ts';
import { HubHelper } from './helper.ts';
import { PonteDoDesktop, PonteDoDesktopError } from './ponteDoDesktop.ts';
import { SessaoDoDesktop } from './sessaoDoDesktop.ts';

/* Porta 1 é reservada e nunca escuta: conexão recusada na hora. */
const URL_SEM_NINGUEM_ESCUTANDO = 'http://127.0.0.1:1';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-credenciais-'));
const arquivoDeToken = join(pasta, 'token.txt');
writeFileSync(arquivoDeToken, 'token-de-teste');
const arquivoDeTokenAusente = join(pasta, 'nao-existe.txt');

after(() => rmSync(pasta, { recursive: true, force: true }));

interface ServidorFalso {
  url: string;
  servidor: Server;
  chamadas: string[];
}

/** Servidor que responde sempre o mesmo e anota os caminhos pedidos. */
function subirServidorFalso(status: number, corpo: unknown): Promise<ServidorFalso> {
  const chamadas: string[] = [];
  return new Promise((resolve) => {
    const servidor = createServer((requisicao, resposta) => {
      chamadas.push(requisicao.url ?? '');
      resposta.writeHead(status, { 'content-type': 'application/json' });
      resposta.end(JSON.stringify(corpo));
    });
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
      resolve({ url: `http://127.0.0.1:${porta}`, servidor, chamadas });
    });
  });
}

function criarCredenciais(parametros: {
  urlDaPonte: string;
  tokenDaPonte: string;
  urlDoHelper: string;
  sessaoDoDesktop?: SessaoDoDesktop;
}): Credenciais {
  return new Credenciais(
    new PonteDoDesktop(parametros.urlDaPonte, parametros.tokenDaPonte),
    new HubHelper(parametros.urlDoHelper, arquivoDeToken),
    parametros.sessaoDoDesktop ?? new SessaoDoDesktop(),
  );
}

const CREDENCIAL_DEFINIDA = { usuario: 'usuario', definido: true };

describe('Credenciais', () => {
  it('usa o shell desktop quando ele está no ar, sem chamar o helper', async () => {
    const shell = await subirServidorFalso(200, CREDENCIAL_DEFINIDA);
    const helper = await subirServidorFalso(200, CREDENCIAL_DEFINIDA);

    try {
      const credenciais = criarCredenciais({
        urlDaPonte: shell.url,
        tokenDaPonte: arquivoDeToken,
        urlDoHelper: helper.url,
      });
      const status = await credenciais.status('sankhya-erp');

      assert.equal(status.definido, true);
      assert.deepEqual(shell.chamadas, ['/credentials/sankhya-erp']);
      assert.deepEqual(helper.chamadas, []);
    } finally {
      shell.servidor.close();
      helper.servidor.close();
    }
  });

  it('cai para o helper quando o shell desktop está fora do ar', async () => {
    const helper = await subirServidorFalso(200, CREDENCIAL_DEFINIDA);

    try {
      const credenciais = criarCredenciais({
        urlDaPonte: URL_SEM_NINGUEM_ESCUTANDO,
        tokenDaPonte: arquivoDeTokenAusente,
        urlDoHelper: helper.url,
      });
      const status = await credenciais.status('sankhya-erp');

      assert.equal(status.usuario, 'usuario');
      assert.deepEqual(helper.chamadas, ['/credentials/sankhya-erp']);
    } finally {
      helper.servidor.close();
    }
  });

  it('não repete no helper o erro de negócio devolvido pelo shell', async () => {
    const shell = await subirServidorFalso(400, { erro: 'corpo inválido' });
    const helper = await subirServidorFalso(200, CREDENCIAL_DEFINIDA);

    try {
      const credenciais = criarCredenciais({
        urlDaPonte: shell.url,
        tokenDaPonte: arquivoDeToken,
        urlDoHelper: helper.url,
      });

      await assert.rejects(() => credenciais.gravar('sankhya-erp', 'u', 's'), PonteDoDesktopError);
      assert.deepEqual(helper.chamadas, []);
    } finally {
      shell.servidor.close();
      helper.servidor.close();
    }
  });

  it('entrega o JWT empurrado pelo shell sem consultar o cofre', async () => {
    const sessaoDoDesktop = new SessaoDoDesktop();
    sessaoDoDesktop.definir({ usuario: 'usuario', token: 'jwt-da-guia', expira: '' });
    const credenciais = criarCredenciais({
      urlDaPonte: URL_SEM_NINGUEM_ESCUTANDO,
      tokenDaPonte: arquivoDeToken,
      urlDoHelper: URL_SEM_NINGUEM_ESCUTANDO,
      sessaoDoDesktop,
    });

    const segredo = await credenciais.revelar('sankhya-experience');
    const status = await credenciais.status('sankhya-experience');

    assert.equal(segredo.token, 'jwt-da-guia');
    assert.equal(segredo.senha, '');
    assert.equal(status.sessaoCapturada, true);
  });

  it('não usa a sessão empurrada da Experience para o ERP', async () => {
    const sessaoDoDesktop = new SessaoDoDesktop();
    sessaoDoDesktop.definir({ usuario: 'usuario', token: 'jwt-da-guia', expira: '' });
    const shell = await subirServidorFalso(200, { usuario: 'do-cofre', token: 'jwt-do-cofre' });

    try {
      const credenciais = criarCredenciais({
        urlDaPonte: shell.url,
        tokenDaPonte: arquivoDeToken,
        urlDoHelper: URL_SEM_NINGUEM_ESCUTANDO,
        sessaoDoDesktop,
      });
      const segredo = await credenciais.revelar('sankhya-erp');

      assert.equal(segredo.token, 'jwt-do-cofre');
    } finally {
      shell.servidor.close();
    }
  });

  it('informa indisponível quando nem o shell nem o helper respondem', async () => {
    const credenciais = criarCredenciais({
      urlDaPonte: URL_SEM_NINGUEM_ESCUTANDO,
      tokenDaPonte: arquivoDeToken,
      urlDoHelper: URL_SEM_NINGUEM_ESCUTANDO,
    });

    assert.equal(await credenciais.disponivel(), false);
  });
});
