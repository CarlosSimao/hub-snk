/**
 * `Credenciais` precisa preferir a sessao empurrada pelo shell desktop para a
 * Experience, sem mudar nada do caminho da senha/cofre DPAPI nem do ERP — sao esses
 * dois ultimos que continuam existindo em producao mesmo com o shell desktop no ar
 * (ver "Backend" no plano de Fase 2).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Credenciais } from '../src/sankhya/credenciais.ts';
import { SessaoDesktopStore } from '../src/sankhya/sessaoDesktop.ts';
import {
  DesktopBridgeError,
  DesktopBridgeIndisponivelError,
  type DesktopBridge,
} from '../src/sankhya/desktopBridge.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';

function helperFalso(resposta: Record<string, unknown>) {
  const chamadas: string[] = [];
  const helper = {
    async requisitar<T>(caminho: string): Promise<T> {
      chamadas.push(caminho);
      return resposta as T;
    },
  } as unknown as HubHelper;
  return { helper, chamadas };
}

describe('Credenciais — sankhya-experience com shell desktop', () => {
  test('sem sessao desktop, revelar cai no helper como sempre', async () => {
    const { helper, chamadas } = helperFalso({ usuario: 'u', senha: 's', sessao: '', token: 'do-helper', expira: '' });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore());

    const segredo = await credenciais.revelar('sankhya-experience');

    assert.equal(segredo.token, 'do-helper');
    assert.deepEqual(chamadas, ['/credentials/sankhya-experience/reveal']);
  });

  test('com sessao desktop presente, revelar nao chama o helper', async () => {
    const { helper, chamadas } = helperFalso({});
    const sessaoDesktop = new SessaoDesktopStore();
    sessaoDesktop.definir({ usuario: 'flaviano.santos@sankhya.com.br', token: 'do-desktop', expira: '' });
    const credenciais = new Credenciais(helper, sessaoDesktop);

    const segredo = await credenciais.revelar('sankhya-experience');

    assert.equal(segredo.token, 'do-desktop');
    assert.equal(segredo.senha, '');
    assert.deepEqual(chamadas, []);
  });

  test('sessao desktop expirada cai de volta no helper', async () => {
    const { helper, chamadas } = helperFalso({ usuario: 'u', senha: 's', sessao: '', token: 'do-helper', expira: '' });
    const sessaoDesktop = new SessaoDesktopStore();
    sessaoDesktop.definir({ usuario: 'u', token: 'vencido', expira: new Date(Date.now() - 1000).toISOString() });
    const credenciais = new Credenciais(helper, sessaoDesktop);

    const segredo = await credenciais.revelar('sankhya-experience');

    assert.equal(segredo.token, 'do-helper');
    assert.deepEqual(chamadas, ['/credentials/sankhya-experience/reveal']);
  });

  test('sankhya-erp nunca olha a sessao desktop', async () => {
    const { helper, chamadas } = helperFalso({ usuario: 'u', senha: 's', sessao: 'JSESSIONID=abc', token: '', expira: '' });
    const sessaoDesktop = new SessaoDesktopStore();
    sessaoDesktop.definir({ usuario: 'u', token: 'irrelevante-aqui', expira: '' });
    const credenciais = new Credenciais(helper, sessaoDesktop);

    const segredo = await credenciais.revelar('sankhya-erp');

    assert.equal(segredo.sessao, 'JSESSIONID=abc');
    assert.deepEqual(chamadas, ['/credentials/sankhya-erp/reveal']);
  });

  test('status reflete a sessao desktop sem consultar o helper', async () => {
    const { helper, chamadas } = helperFalso({});
    const sessaoDesktop = new SessaoDesktopStore();
    // Data RELATIVA: o store descarta sessao com `exp` no passado, entao uma data fixa
    // aqui funciona ate' chegar o dia dela e depois reprova sozinha (foi o que
    // aconteceu com o `2026-09-20` que estava escrito aqui).
    const expira = new Date(Date.now() + 86_400_000).toISOString();
    sessaoDesktop.definir({ usuario: 'flaviano.santos@sankhya.com.br', token: 't', expira });
    const credenciais = new Credenciais(helper, sessaoDesktop);

    const status = await credenciais.status('sankhya-experience');

    assert.equal(status.sessaoCapturada, true);
    assert.equal(status.sessaoExpiraEm, expira);
    assert.equal(status.usuario, 'flaviano.santos@sankhya.com.br');
    assert.deepEqual(chamadas, []);
  });
});

/**
 * Fase 3 da migracao "sem Docker": o cofre do shell desktop (safeStorage) substitui as
 * rotas /credentials do hub-helper.ps1. Os dois convivem durante a transicao, entao o
 * que precisa estar coberto e' QUEM atende cada chamada — e, principalmente, quando NAO
 * se deve tentar o outro lado.
 */
function bridgeFalso(opcoes: { erro?: Error; resposta?: Record<string, unknown> } = {}) {
  const chamadas: string[] = [];
  const responder = <T,>(rotulo: string): Promise<T> => {
    chamadas.push(rotulo);
    if (opcoes.erro) return Promise.reject(opcoes.erro);
    return Promise.resolve((opcoes.resposta ?? {}) as T);
  };
  const bridge = {
    statusCredencial: <T,>(sistema: string) => responder<T>(`status:${sistema}`),
    gravarCredencial: <T,>(sistema: string, usuario: string) => responder<T>(`gravar:${sistema}:${usuario}`),
    removerCredencial: <T,>(sistema: string) => responder<T>(`remover:${sistema}`),
    revelarCredencial: <T,>(sistema: string) => responder<T>(`revelar:${sistema}`),
  } as unknown as DesktopBridge;
  return { bridge, chamadas };
}

describe('Credenciais — shell desktop na frente do hub-helper.ps1', () => {
  test('com o shell no ar, o helper nao e consultado', async () => {
    const { helper, chamadas: doHelper } = helperFalso({ usuario: 'do-helper', definido: true });
    const { bridge, chamadas: doShell } = bridgeFalso({ resposta: { usuario: 'do-shell', definido: true } });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore(), bridge);

    const status = await credenciais.status('sankhya-erp');

    assert.equal(status.usuario, 'do-shell');
    assert.deepEqual(doShell, ['status:sankhya-erp']);
    assert.deepEqual(doHelper, []);
  });

  test('gravar e remover tambem passam pelo shell', async () => {
    const { helper, chamadas: doHelper } = helperFalso({ usuario: 'do-helper' });
    const { bridge, chamadas: doShell } = bridgeFalso({ resposta: { usuario: 'novo', definido: true } });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore(), bridge);

    await credenciais.gravar('sankhya-erp', 'novo', 'senha');
    await credenciais.remover('sankhya-erp');

    assert.deepEqual(doShell, ['gravar:sankhya-erp:novo', 'remover:sankhya-erp']);
    assert.deepEqual(doHelper, []);
  });

  test('revelar prefere o shell — a senha em claro nao passa pela porta 4102', async () => {
    const { helper, chamadas: doHelper } = helperFalso({ senha: 'do-helper' });
    const { bridge } = bridgeFalso({ resposta: { usuario: 'u', senha: 'do-shell', sessao: '', token: '', expira: '' } });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore(), bridge);

    const segredo = await credenciais.revelar('sankhya-erp');

    assert.equal(segredo.senha, 'do-shell');
    assert.deepEqual(doHelper, []);
  });

  test('shell fora do ar cai para o helper', async () => {
    const { helper, chamadas: doHelper } = helperFalso({ usuario: 'do-helper', definido: true });
    const { bridge } = bridgeFalso({ erro: new DesktopBridgeIndisponivelError('shell nao esta rodando') });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore(), bridge);

    const status = await credenciais.status('sankhya-erp');

    assert.equal(status.usuario, 'do-helper');
    assert.deepEqual(doHelper, ['/credentials/sankhya-erp']);
  });

  test('erro de negocio do shell NAO vira nova tentativa no helper', async () => {
    // Repetir no helper daria a mesma resposta e esconderia o erro real do usuario.
    const { helper, chamadas: doHelper } = helperFalso({ usuario: 'do-helper' });
    const { bridge } = bridgeFalso({ erro: new DesktopBridgeError('sistema desconhecido', 404) });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore(), bridge);

    await assert.rejects(() => credenciais.status('sankhya-erp'), DesktopBridgeError);
    assert.deepEqual(doHelper, []);
  });

  test('sem bridge configurado nada muda — o helper segue atendendo', async () => {
    const { helper, chamadas: doHelper } = helperFalso({ usuario: 'do-helper', definido: true });
    const credenciais = new Credenciais(helper, new SessaoDesktopStore());

    const status = await credenciais.status('sankhya-erp');

    assert.equal(status.usuario, 'do-helper');
    assert.deepEqual(doHelper, ['/credentials/sankhya-erp']);
  });
});
