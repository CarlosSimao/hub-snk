import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { GitAutosyncFalhouError, PacoteDoAutosyncAusenteError } from './cliDoAutosync.ts';
import { baixarPacoteDoAutosync } from './pacoteDoGithub.ts';

function responderCom(status: number, corpo: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(corpo), { status })) as typeof fetch;
}

describe('baixarPacoteDoAutosync', () => {
  it('avisa quando o repositório ainda não tem Release', async () => {
    await assert.rejects(
      baixarPacoteDoAutosync(responderCom(404, { message: 'Not Found' })),
      PacoteDoAutosyncAusenteError,
    );
  });

  it('avisa quando a Release não tem o pacote para Windows', async () => {
    await assert.rejects(
      baixarPacoteDoAutosync(
        responderCom(200, { tag_name: 'v4.1.0', assets: [{ name: 'outro.zip' }] }),
      ),
      /v4\.1\.0.*git-autosync\.exe/,
    );
  });

  it('com só os executáveis na Release, busca o resto no repositório na mesma tag', async () => {
    const pedidos: string[] = [];
    const buscarUrl = (async (url: string | URL | Request) => {
      const endereco = String(url);
      pedidos.push(endereco);
      if (endereco.endsWith('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v4.1.0',
            assets: ['git-autosync.exe', 'git-autosync-sync.exe'].map((name) => ({
              name,
              browser_download_url: `https://github.com/x/releases/download/v4.1.0/${name}`,
            })),
          }),
        );
      }
      return new Response(`conteúdo de ${endereco.split('/').pop()}`);
    }) as typeof fetch;

    const pacote = await baixarPacoteDoAutosync(buscarUrl);
    try {
      assert.equal(pacote.versao, 'v4.1.0');
      assert.equal(
        readFileSync(join(pacote.pasta, 'install-standalone.ps1'), 'utf8'),
        'conteúdo de install-standalone.ps1',
      );
      for (const nome of ['git-autosync.exe', 'git-autosync-sync.exe', 'SKILL.md', 'VERSION']) {
        assert.ok(readFileSync(join(pacote.pasta, nome)).length > 0, nome);
      }
      assert.ok(
        pedidos.includes(
          'https://raw.githubusercontent.com/FlavianoRS/git-autosync/v4.1.0/installer/install-standalone.ps1',
        ),
      );
    } finally {
      await pacote.descartar();
    }
  });

  it('traduz falha de rede numa mensagem sobre a conexão', async () => {
    const semRede = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;

    await assert.rejects(baixarPacoteDoAutosync(semRede), GitAutosyncFalhouError);
  });
});
