import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { lerCredencialDoGoogle } from './credencialDoGoogle.ts';

let pasta: string;
let arquivo: string;

beforeEach(async () => {
  pasta = await mkdtemp(join(tmpdir(), 'hub-snk-credencial-'));
  arquivo = join(pasta, 'credencial-google.json');
});

afterEach(async () => {
  await rm(pasta, { recursive: true, force: true });
});

describe('lerCredencialDoGoogle', () => {
  it('lê o ID e a chave do arquivo, sem os espaços das pontas', async () => {
    await writeFile(arquivo, JSON.stringify({ clientId: ' id-1 ', clientSecret: ' chave-1\n' }));

    assert.deepEqual(lerCredencialDoGoogle(arquivo, {}), {
      clientId: 'id-1',
      clientSecret: 'chave-1',
    });
  });

  it('sem arquivo, vem vazia: a integração com o Drive fica desligada', () => {
    assert.deepEqual(lerCredencialDoGoogle(join(pasta, 'nao-existe.json'), {}), {
      clientId: '',
      clientSecret: '',
    });
  });

  it('arquivo quebrado ou com tipo errado vale como vazio, sem derrubar o backend', async () => {
    await writeFile(arquivo, '{ isto não é json');
    assert.deepEqual(lerCredencialDoGoogle(arquivo, {}), { clientId: '', clientSecret: '' });

    await writeFile(arquivo, JSON.stringify({ clientId: 42, clientSecret: ['x'] }));
    assert.deepEqual(lerCredencialDoGoogle(arquivo, {}), { clientId: '', clientSecret: '' });
  });

  it('as variáveis de ambiente vencem o arquivo, campo a campo', async () => {
    await writeFile(
      arquivo,
      JSON.stringify({ clientId: 'id-do-arquivo', clientSecret: 'chave-do-arquivo' }),
    );

    assert.deepEqual(lerCredencialDoGoogle(arquivo, { HUB_GOOGLE_CLIENT_ID: 'id-do-ambiente' }), {
      clientId: 'id-do-ambiente',
      clientSecret: 'chave-do-arquivo',
    });
    assert.deepEqual(
      lerCredencialDoGoogle(arquivo, {
        HUB_GOOGLE_CLIENT_ID: 'id-do-ambiente',
        HUB_GOOGLE_CLIENT_SECRET: 'chave-do-ambiente',
      }),
      { clientId: 'id-do-ambiente', clientSecret: 'chave-do-ambiente' },
    );
  });

  it('variável vazia ou só com espaços não apaga o que está no arquivo', async () => {
    await writeFile(
      arquivo,
      JSON.stringify({ clientId: 'id-do-arquivo', clientSecret: 'chave-do-arquivo' }),
    );

    assert.deepEqual(
      lerCredencialDoGoogle(arquivo, { HUB_GOOGLE_CLIENT_ID: '  ', HUB_GOOGLE_CLIENT_SECRET: '' }),
      { clientId: 'id-do-arquivo', clientSecret: 'chave-do-arquivo' },
    );
  });
});
