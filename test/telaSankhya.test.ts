import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { montarUrlTelaSankhya } from '../web/src/lib/telaSankhya.ts';

describe('montarUrlTelaSankhya', () => {
  test('codifica resourceID e registro numérico em base64 UTF-8', () => {
    assert.equal(
      montarUrlTelaSankhya(
        'https://cliente.example/mge/',
        'br.com.sankhya.core.cad.parceiros',
        'CODPARC=1',
      ),
      'https://cliente.example/mge/system.jsp#app/YnIuY29tLnNhbmtoeWEuY29yZS5jYWQucGFyY2Vpcm9z/eyJDT0RQQVJDIjoxfQ==',
    );
  });

  test('mantém texto como string e codifica Unicode com segurança', () => {
    const url = montarUrlTelaSankhya('https://cliente.example/qualquer', 'br.com.tela_1', 'NOME=João');
    const registro = url.slice(url.indexOf('/', url.indexOf('#app/') + 5) + 1);
    assert.equal(Buffer.from(registro, 'base64').toString('utf8'), '{"NOME":"João"}');
  });

  test('recusa resourceID e campo inválidos', () => {
    assert.throws(() => montarUrlTelaSankhya('https://cliente.example', 'parceiros'), /ID da tela inválido/);
    assert.throws(
      () => montarUrlTelaSankhya('https://cliente.example', 'br.com.parceiros', 'codparc=1'),
      /Registro inválido/,
    );
  });
});
