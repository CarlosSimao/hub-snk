/**
 * `DesktopBridge` fala HTTP de verdade com o shell desktop (Electron) — testado contra
 * um servidor `node:http` real, mesmo espirito do teste de `HubHelper` que ele espelha:
 * o que importa e' o contrato (token no header, timeout, erro vs indisponivel), nao a
 * implementacao do outro lado.
 */
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DesktopBridge,
  DesktopBridgeError,
  DesktopBridgeIndisponivelError,
} from '../src/sankhya/desktopBridge.ts';

const PASTA = mkdtempSync(join(tmpdir(), 'sankhya-hub-desktop-bridge-'));
const ARQUIVO_TOKEN = join(PASTA, 'desktop-token.txt');
writeFileSync(ARQUIVO_TOKEN, 'token-de-teste');

after(() => rmSync(PASTA, { recursive: true, force: true }));

function subirServidorFalso(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ url: string; servidor: Server }> {
  return new Promise((resolve) => {
    const servidor = createServer(handler);
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
      resolve({ url: `http://127.0.0.1:${porta}`, servidor });
    });
  });
}

describe('DesktopBridge', () => {
  test('token indisponivel falha sem chamar a rede', async () => {
    const bridge = new DesktopBridge('http://127.0.0.1:1', join(PASTA, 'nao-existe.txt'));
    await assert.rejects(() => bridge.buscarAgenda('01/09/2026', '30/09/2026'), DesktopBridgeIndisponivelError);
  });

  test('buscarAgenda manda o token certo e devolve o conteudo', async () => {
    let tokenRecebido = '';
    const { url, servidor } = await subirServidorFalso((req, res) => {
      tokenRecebido = String(req.headers['x-hub-token'] ?? '');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ conteudo: '{"status":"1"}' }));
    });

    const bridge = new DesktopBridge(url, ARQUIVO_TOKEN);
    const resultado = await bridge.buscarAgenda('01/09/2026', '30/09/2026');

    assert.equal(tokenRecebido, 'token-de-teste');
    assert.equal(resultado.conteudo, '{"status":"1"}');
    servidor.close();
  });

  test('shell recusando o token vira DesktopBridgeError com o status certo', async () => {
    const { url, servidor } = await subirServidorFalso((_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ erro: 'token inválido' }));
    });

    const bridge = new DesktopBridge(url, ARQUIVO_TOKEN);
    await assert.rejects(
      () => bridge.buscarAgenda('01/09/2026', '30/09/2026'),
      (err: unknown) => err instanceof DesktopBridgeError && err.status === 401,
    );
    servidor.close();
  });

  test('porta fechada vira DesktopBridgeIndisponivelError', async () => {
    const bridge = new DesktopBridge('http://127.0.0.1:1', ARQUIVO_TOKEN);
    await assert.rejects(() => bridge.buscarAgenda('01/09/2026', '30/09/2026'), DesktopBridgeIndisponivelError);
  });

  test('disponivel() e best-effort: nunca lanca', async () => {
    const bridge = new DesktopBridge('http://127.0.0.1:1', ARQUIVO_TOKEN);
    assert.equal(await bridge.disponivel(), false);
  });
});
