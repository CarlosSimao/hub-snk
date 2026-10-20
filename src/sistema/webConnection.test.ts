import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  consultarWebConnection,
  interpretarInformacoes,
  rodaDiretoNaPastaDele,
} from './webConnection.ts';

const RESPOSTA_DO_INFO = 'dados do sistema:  versao: 2.0b725 uptime: 5:45:42';

function respondendo(corpo: string, status = 200): typeof fetch {
  return async () => new Response(corpo, { status });
}

describe('interpretarInformacoes', () => {
  it('lê versão e tempo ligado', () => {
    assert.deepEqual(interpretarInformacoes(RESPOSTA_DO_INFO), {
      ligado: true,
      versao: '2.0b725',
      tempoLigado: '5:45:42',
    });
  });

  it('sem versão, quem respondeu não é o Web Connection', () => {
    assert.deepEqual(interpretarInformacoes('<html>Not Found</html>'), { ligado: false });
  });
});

describe('consultarWebConnection', () => {
  it('ligado quando o .info responde', async () => {
    const situacao = await consultarWebConnection(respondendo(RESPOSTA_DO_INFO));
    assert.equal(situacao.ligado, true);
  });

  it('desligado com a porta fechada', async () => {
    const recusada: typeof fetch = async () => {
      throw new TypeError('fetch failed');
    };
    assert.deepEqual(await consultarWebConnection(recusada), { ligado: false });
  });

  it('desligado com erro HTTP', async () => {
    const situacao = await consultarWebConnection(respondendo(RESPOSTA_DO_INFO, 500));
    assert.deepEqual(situacao, { ligado: false });
  });
});

describe('rodaDiretoNaPastaDele', () => {
  const arquivo = (mode: number) => ({ isFile: () => true, mode });
  const pasta = { isFile: () => false, mode: 0o755 };

  it('Windows: só o .exe', () => {
    assert.equal(rodaDiretoNaPastaDele('C:\\wc\\iniciar.exe', arquivo(0o666), 'win32'), true);
    assert.equal(rodaDiretoNaPastaDele('C:\\wc\\WC.lnk', arquivo(0o666), 'win32'), false);
  });

  it('Linux: com bit de execução roda direto; sem ele, vai ao despachante', () => {
    assert.equal(rodaDiretoNaPastaDele('/opt/wc/iniciar.sh', arquivo(0o755), 'linux'), true);
    assert.equal(rodaDiretoNaPastaDele('/opt/wc/iniciar.sh', arquivo(0o644), 'linux'), false);
  });

  it('macOS: .app e .command vão ao despachante', () => {
    assert.equal(rodaDiretoNaPastaDele('/Applications/WC.app', pasta, 'darwin'), false);
    assert.equal(rodaDiretoNaPastaDele('/opt/wc/iniciar.command', arquivo(0o755), 'darwin'), false);
    assert.equal(rodaDiretoNaPastaDele('/opt/wc/iniciar.sh', arquivo(0o755), 'darwin'), true);
  });
});
