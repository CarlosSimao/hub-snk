import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  lerTokenDoDesktop,
  PonteDoDesktop,
  PonteDoDesktopError,
  PonteDoDesktopIndisponivelError,
} from './ponteDoDesktop.ts';

/* Porta 1 é reservada e nunca escuta: conexão recusada na hora. */
const URL_SEM_NINGUEM_ESCUTANDO = 'http://127.0.0.1:1';

const pasta = mkdtempSync(join(tmpdir(), 'hub-snk-ponte-'));
const arquivoDeToken = join(pasta, 'desktop-token.txt');
writeFileSync(arquivoDeToken, 'token-de-teste\n');

after(() => rmSync(pasta, { recursive: true, force: true }));

function subirShellFalso(
  responder: (requisicao: IncomingMessage, resposta: ServerResponse) => void,
): Promise<{ url: string; servidor: Server }> {
  return new Promise((resolve) => {
    const servidor = createServer(responder);
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
      resolve({ url: `http://127.0.0.1:${porta}`, servidor });
    });
  });
}

describe('lerTokenDoDesktop', () => {
  it('devolve o token sem a quebra de linha final', () => {
    assert.equal(lerTokenDoDesktop(arquivoDeToken), 'token-de-teste');
  });

  it('trata arquivo ausente como shell fora do ar', () => {
    assert.throws(
      () => lerTokenDoDesktop(join(pasta, 'nao-existe.txt')),
      PonteDoDesktopIndisponivelError,
    );
  });

  it('trata arquivo vazio como shell fora do ar', () => {
    const arquivoVazio = join(pasta, 'vazio.txt');
    writeFileSync(arquivoVazio, '  \n');

    assert.throws(() => lerTokenDoDesktop(arquivoVazio), PonteDoDesktopIndisponivelError);
  });
});

describe('PonteDoDesktop', () => {
  it('manda o token no header e devolve o corpo', async () => {
    let tokenRecebido = '';
    const { url, servidor } = await subirShellFalso((requisicao, resposta) => {
      tokenRecebido = String(requisicao.headers['x-hub-token'] ?? '');
      resposta.writeHead(200, { 'content-type': 'application/json' });
      resposta.end(JSON.stringify({ conteudo: '{"status":"1"}' }));
    });

    try {
      const ponte = new PonteDoDesktop(url, arquivoDeToken);
      const corpo = await ponte.requisitar<{ conteudo: string }>('/browser/agenda', {
        method: 'POST',
      });

      assert.equal(tokenRecebido, 'token-de-teste');
      assert.equal(corpo.conteudo, '{"status":"1"}');
    } finally {
      servidor.close();
    }
  });

  it('transforma a recusa do shell em erro de negócio com o status dele', async () => {
    const { url, servidor } = await subirShellFalso((_requisicao, resposta) => {
      resposta.writeHead(401, { 'content-type': 'application/json' });
      resposta.end(JSON.stringify({ erro: 'token inválido' }));
    });

    try {
      const ponte = new PonteDoDesktop(url, arquivoDeToken);
      await assert.rejects(
        () => ponte.requisitar('/health'),
        (erro: unknown) =>
          erro instanceof PonteDoDesktopError &&
          erro.status === 401 &&
          erro.message === 'token inválido',
      );
    } finally {
      servidor.close();
    }
  });

  it('trata porta fechada como shell fora do ar', async () => {
    const ponte = new PonteDoDesktop(URL_SEM_NINGUEM_ESCUTANDO, arquivoDeToken);

    await assert.rejects(() => ponte.requisitar('/health'), PonteDoDesktopIndisponivelError);
  });
});
