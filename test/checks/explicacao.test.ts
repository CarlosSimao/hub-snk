/**
 * A explicação do check vai para o navegador dentro do snapshot da API. O teste que
 * mais importa aqui não é de formatação: é o que garante que senha e token NUNCA
 * aparecem no texto. Um vazamento desses seria silencioso — o painel continuaria
 * bonito e funcional com a senha do banco de produção escrita na tela.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { explicarCheck } from '../../src/checks/explicacao.ts';
import { check } from '../helpers.ts';

const SENHA = 'senha-super-secreta-123';

describe('explicarCheck — segredos', () => {
  test('senha do oracle não aparece', () => {
    const texto = explicarCheck(
      check('oracle', { host: 'ora.exemplo', serviceName: 'XE', user: 'sankhya', password: SENHA }),
    ).join('\n');

    assert.ok(!texto.includes(SENHA), 'a senha vazou na explicação');
    assert.match(texto, /ora\.exemplo:1521/);
  });

  test('descritor do oracle também não é ecoado', () => {
    const texto = explicarCheck(
      check('oracle', { connectString: `host:1521/${SENHA}`, user: 'u', password: SENHA }),
    ).join('\n');

    assert.ok(!texto.includes(SENHA));
  });
});

describe('explicarCheck — conteúdo por tipo', () => {
  test('http descreve método, alvo e status aceitos', () => {
    const texto = explicarCheck(
      check('http', { url: 'https://api.exemplo/', method: 'HEAD', expectStatus: [401] }),
    ).join('\n');

    assert.match(texto, /HEAD em https:\/\/api\.exemplo\//);
    assert.match(texto, /Saudável só com HTTP 401/);
  });

  test('http sem expectStatus explica a regra padrão', () => {
    const texto = explicarCheck(check('http', { url: 'https://api.exemplo/' })).join('\n');
    assert.match(texto, /qualquer status 2xx ou 3xx/);
  });

  test('http com dois status aceitos lista os dois', () => {
    const texto = explicarCheck(
      check('http', { url: 'https://a/', expectStatus: [200, 302] }),
    ).join('\n');
    assert.match(texto, /HTTP 200 ou 302/);
  });

  test('tcp avisa que porta aberta não garante aplicação viva', () => {
    const texto = explicarCheck(check('tcp', { host: 'h', port: 5432 })).join('\n');
    assert.match(texto, /h:5432/);
    assert.match(texto, /não garante que a aplicação/);
  });

  test('oracle destaca o caso MOUNTED', () => {
    const texto = explicarCheck(
      check('oracle', { host: 'h', serviceName: 'XE', user: 'u', password: 'p' }),
    ).join('\n');
    assert.match(texto, /MOUNTED/);
    assert.match(texto, /serviço XE/);
  });

  test('oracle com sid descreve sid em vez de service name', () => {
    const texto = explicarCheck(
      check('oracle', { host: 'h', sid: 'ORCL', user: 'u', password: 'p' }),
    ).join('\n');
    assert.match(texto, /SID ORCL/);
  });

  test('docker nomeia o container', () => {
    const texto = explicarCheck(check('docker', { container: 'meu-app' })).join('\n');
    assert.match(texto, /"meu-app"/);
  });
});

describe('explicarCheck — cadência', () => {
  test('formata intervalo em segundos e minutos', () => {
    const emSegundos = explicarCheck(
      check('tcp', { host: 'h', port: 1, intervalMs: 30000, timeoutMs: 5000 }),
    ).join('\n');
    assert.match(emSegundos, /a cada 30s.*timeout de 5s/);

    const emMinutos = explicarCheck(
      check('tcp', { host: 'h', port: 1, intervalMs: 900000 }),
    ).join('\n');
    assert.match(emMinutos, /a cada 15min/);
  });

  test('failureThreshold 1 diz que a primeira falha já derruba', () => {
    const texto = explicarCheck(
      check('tcp', { host: 'h', port: 1, failureThreshold: 1 }),
    ).join('\n');
    assert.match(texto, /primeira falha já acende o vermelho/);
  });

  test('failureThreshold maior explica o amarelo intermediário', () => {
    const texto = explicarCheck(
      check('tcp', { host: 'h', port: 1, failureThreshold: 3 }),
    ).join('\n');
    assert.match(texto, /depois de 3 falhas seguidas/);
  });

  test('degradedAboveMs vira linha própria', () => {
    const texto = explicarCheck(
      check('http', { url: 'https://a/', degradedAboveMs: 2000 }),
    ).join('\n');
    assert.match(texto, /acima de 2000ms conta como degradada/);
  });

  test('check silenciado avisa que não entra no semáforo do projeto', () => {
    const texto = explicarCheck(check('tcp', { host: 'h', port: 1, muted: true })).join('\n');
    assert.match(texto, /não entra no semáforo do projeto/);
  });

  test('check normal não menciona silenciamento', () => {
    const texto = explicarCheck(check('tcp', { host: 'h', port: 1 })).join('\n');
    assert.ok(!/silenciado/i.test(texto));
  });
});
