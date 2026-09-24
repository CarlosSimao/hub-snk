import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { Credenciais } from './credenciais.ts';
import { PonteDoDesktop, PonteDoDesktopError } from './ponteDoDesktop.ts';
import { SessaoDoDesktop } from './sessaoDoDesktop.ts';

/* Porta 1 é reservada e nunca escuta: conexão recusada na hora. */
const URL_SEM_NINGUEM_ESCUTANDO = 'http://127.0.0.1:1';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-credenciais-'));
const arquivoDeToken = join(pasta, 'token.txt');
writeFileSync(arquivoDeToken, 'token-de-teste');

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
  sessaoDoDesktop?: SessaoDoDesktop;
}): Credenciais {
  return new Credenciais(
    new PonteDoDesktop(parametros.urlDaPonte, arquivoDeToken),
    parametros.sessaoDoDesktop ?? new SessaoDoDesktop(),
  );
}

describe('Credenciais', () => {
  it('consulta o cofre do shell desktop', async () => {
    const shell = await subirServidorFalso(200, { usuario: 'usuario', definido: true });

    try {
      const status = await criarCredenciais({ urlDaPonte: shell.url }).status('sankhya-erp');

      assert.equal(status.definido, true);
      assert.equal(status.usuario, 'usuario');
      assert.deepEqual(shell.chamadas, ['/credentials/sankhya-erp']);
    } finally {
      shell.servidor.close();
    }
  });

  it('propaga o erro de negócio devolvido pelo shell', async () => {
    const shell = await subirServidorFalso(400, { erro: 'corpo inválido' });

    try {
      const credenciais = criarCredenciais({ urlDaPonte: shell.url });

      await assert.rejects(() => credenciais.gravar('sankhya-erp', 'u', 's'), PonteDoDesktopError);
    } finally {
      shell.servidor.close();
    }
  });

  it('consulta a agenda e as negociações pela aba ERP do shell', async () => {
    const shell = await subirServidorFalso(200, { conteudo: '{"status":"1"}' });

    try {
      const credenciais = criarCredenciais({ urlDaPonte: shell.url });
      const agenda = await credenciais.consultarAgendaDeRecursos('01/09/2026', '30/09/2026');
      await credenciais.consultarNegociacoesDoParceiro(42);

      assert.equal(agenda.conteudo, '{"status":"1"}');
      assert.deepEqual(shell.chamadas, ['/agenda/fetch', '/agenda/negociacoes']);
    } finally {
      shell.servidor.close();
    }
  });

  it('entrega o JWT empurrado pelo shell sem consultar o cofre', async () => {
    const sessaoDoDesktop = new SessaoDoDesktop();
    sessaoDoDesktop.definir({ usuario: 'usuario', token: 'jwt-da-guia', expira: '' });
    const credenciais = criarCredenciais({
      urlDaPonte: URL_SEM_NINGUEM_ESCUTANDO,
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
      const credenciais = criarCredenciais({ urlDaPonte: shell.url, sessaoDoDesktop });
      const segredo = await credenciais.revelar('sankhya-erp');

      assert.equal(segredo.token, 'jwt-do-cofre');
    } finally {
      shell.servidor.close();
    }
  });

  it('informa indisponível quando o shell não responde', async () => {
    const credenciais = criarCredenciais({ urlDaPonte: URL_SEM_NINGUEM_ESCUTANDO });

    assert.equal(await credenciais.disponivel(), false);
  });
});
