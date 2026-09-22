import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { requisicaoVeioDaMaquinaLocal } from './protecaoDeOrigem.ts';

const PORTA = 4100;

function veioDaMaquinaLocal(host: string | undefined, origem?: string): boolean {
  return requisicaoVeioDaMaquinaLocal({ host, origem, porta: PORTA });
}

describe('requisicaoVeioDaMaquinaLocal', () => {
  it('aceita os endereços locais que o navegador usa para abrir o HUB SNK', () => {
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100'), true);
    assert.equal(veioDaMaquinaLocal('localhost:4100'), true);
    assert.equal(veioDaMaquinaLocal('[::1]:4100'), true);
    assert.equal(veioDaMaquinaLocal('LOCALHOST:4100'), true);
  });

  it('aceita a chamada da própria janela do HUB SNK', () => {
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', 'http://127.0.0.1:4100'), true);
    assert.equal(veioDaMaquinaLocal('localhost:4100', 'http://localhost:4100'), true);
  });

  it('aceita requisição sem origem, como navegação direta e linha de comando', () => {
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', undefined), true);
  });

  it('recusa domínio apontado para o endereço local (DNS rebinding)', () => {
    assert.equal(veioDaMaquinaLocal('hub-snk.exemplo.com:4100'), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1.exemplo.com:4100'), false);
  });

  it('recusa chamada disparada por outra página (CSRF)', () => {
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', 'http://exemplo.com'), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', 'https://127.0.0.1:4100'), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', 'null'), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', 'http://127.0.0.1:9999'), false);
  });

  it('recusa porta diferente da que o servidor está escutando', () => {
    assert.equal(veioDaMaquinaLocal('127.0.0.1:9999'), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1'), false);
  });

  it('recusa cabeçalho ausente ou malformado', () => {
    assert.equal(veioDaMaquinaLocal(undefined), false);
    assert.equal(veioDaMaquinaLocal(''), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100/qualquer-coisa'), false);
    assert.equal(veioDaMaquinaLocal('usuario@127.0.0.1:4100'), false);
    assert.equal(veioDaMaquinaLocal('127.0.0.1:4100', 'nao-e-uma-url'), false);
  });
});
