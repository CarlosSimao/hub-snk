/**
 * Roteamento por formato do blob (Fase 3 da migracao "sem Docker").
 *
 * O que esta' sob teste e' a regra que evita perda de senha: o blob do `hub-helper.ps1`
 * (DPAPI cru) e o do shell (`safeStorage`) nao se abrem mutuamente, e mandar um para o
 * lado errado devolve "não consegui decriptar" — indistinguivel de "senha gravada noutro
 * usuario do Windows", que e' outro problema. A marca `sb1:` torna a escolha
 * deterministica.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Cifra, ehFormatoShell, PREFIXO_SHELL } from '../src/sankhya/cifra.ts';
import { DesktopBridgeIndisponivelError, type DesktopBridge } from '../src/sankhya/desktopBridge.ts';
import type { HubHelper } from '../src/sankhya/helper.ts';

/** Cifra de mentira do helper: prefixo, o bastante para provar ida e volta. */
function helperFalso() {
  const chamadas: string[] = [];
  const helper = {
    async requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
      chamadas.push(caminho);
      const { valor } = JSON.parse(String(init.body ?? '{}')) as { valor: string };
      const resultado = caminho.endsWith('/encrypt') ? `ps:${valor}` : valor.replace(/^ps:/, '');
      return { valor: resultado } as T;
    },
  } as unknown as HubHelper;
  return { helper, chamadas };
}

function bridgeFalso(opcoes: { indisponivel?: boolean } = {}) {
  const chamadas: string[] = [];
  const responder = <T,>(rotulo: string, valor: string): Promise<T> => {
    chamadas.push(rotulo);
    if (opcoes.indisponivel) return Promise.reject(new DesktopBridgeIndisponivelError('shell fora do ar'));
    return Promise.resolve({ valor } as T);
  };
  const bridge = {
    cifrarSegredo: <T,>(valor: string) => responder<T>('encrypt', `${PREFIXO_SHELL}${valor}`),
    decifrarSegredo: <T,>(valor: string) =>
      responder<T>('decrypt', valor.replace(new RegExp(`^${PREFIXO_SHELL}`), '')),
  } as unknown as DesktopBridge;
  return { bridge, chamadas };
}

describe('Cifra — quem cifra', () => {
  test('com o shell no ar, o blob sai marcado e o helper nao e chamado', async () => {
    const { helper, chamadas: doHelper } = helperFalso();
    const { bridge } = bridgeFalso();

    const cifrada = await new Cifra(helper, bridge).cifrar('senha-da-base');

    assert.equal(ehFormatoShell(cifrada), true);
    assert.deepEqual(doHelper, []);
  });

  test('sem shell, cifra pelo helper e o blob fica sem marca', async () => {
    const { helper, chamadas: doHelper } = helperFalso();

    const cifrada = await new Cifra(helper).cifrar('senha-da-base');

    assert.equal(ehFormatoShell(cifrada), false);
    assert.deepEqual(doHelper, ['/secret/encrypt']);
  });

  test('shell fora do ar cai para o helper em vez de falhar', async () => {
    const { helper, chamadas: doHelper } = helperFalso();
    const { bridge } = bridgeFalso({ indisponivel: true });

    const cifrada = await new Cifra(helper, bridge).cifrar('senha-da-base');

    assert.equal(ehFormatoShell(cifrada), false);
    assert.deepEqual(doHelper, ['/secret/encrypt']);
  });
});

describe('Cifra — quem decifra e escolhido pela marca, nao pela disponibilidade', () => {
  test('blob do helper vai para o helper mesmo com o shell no ar', async () => {
    const { helper, chamadas: doHelper } = helperFalso();
    const { bridge, chamadas: doShell } = bridgeFalso();

    const claro = await new Cifra(helper, bridge).decifrar('ps:senha-antiga');

    assert.equal(claro, 'senha-antiga');
    assert.deepEqual(doHelper, ['/secret/decrypt']);
    assert.deepEqual(doShell, []);
  });

  test('blob do shell vai para o shell', async () => {
    const { helper, chamadas: doHelper } = helperFalso();
    const { bridge, chamadas: doShell } = bridgeFalso();

    const claro = await new Cifra(helper, bridge).decifrar(`${PREFIXO_SHELL}senha-nova`);

    assert.equal(claro, 'senha-nova');
    assert.deepEqual(doShell, ['decrypt']);
    assert.deepEqual(doHelper, []);
  });

  test('blob do shell sem shell no ar explica o que fazer, em vez de tentar no helper', async () => {
    // Tentar no helper devolveria "não consegui decriptar", e o usuário iria procurar
    // defeito na senha dele.
    const { helper, chamadas: doHelper } = helperFalso();

    await assert.rejects(
      () => new Cifra(helper).decifrar(`${PREFIXO_SHELL}senha-nova`),
      DesktopBridgeIndisponivelError,
    );
    assert.deepEqual(doHelper, []);
  });

  test('vazio devolve null sem chamar ninguem', async () => {
    const { helper, chamadas } = helperFalso();
    assert.equal(await new Cifra(helper).decifrar(''), null);
    assert.deepEqual(chamadas, []);
  });
});

describe('Cifra — migracao de blob antigo', () => {
  test('converte o blob do helper para o formato do shell', async () => {
    const { helper } = helperFalso();
    const { bridge } = bridgeFalso();

    const novo = await new Cifra(helper, bridge).migrar('ps:senha-antiga');

    assert.equal(novo, `${PREFIXO_SHELL}senha-antiga`);
  });

  test('blob ja migrado nao e tocado', async () => {
    const { helper } = helperFalso();
    const { bridge, chamadas } = bridgeFalso();

    assert.equal(await new Cifra(helper, bridge).migrar(`${PREFIXO_SHELL}x`), null);
    assert.deepEqual(chamadas, []);
  });

  test('sem shell no ar, nao migra nada', async () => {
    const { helper, chamadas } = helperFalso();

    assert.equal(await new Cifra(helper).migrar('ps:senha-antiga'), null);
    assert.deepEqual(chamadas, []);
  });

  test('helper que nao abre o blob nao apaga nem corrompe o valor', async () => {
    // Blob de outro usuário do Windows: o certo é devolver null e manter o que está lá.
    const helper = {
      async requisitar(): Promise<never> {
        throw new Error('não consegui decriptar');
      },
    } as unknown as HubHelper;
    const { bridge } = bridgeFalso();

    assert.equal(await new Cifra(helper, bridge).migrar('ps:ilegivel'), null);
  });
});
