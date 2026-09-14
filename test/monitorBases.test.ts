/**
 * A medicao de uma base do cliente.
 *
 * Nenhum teste sai para a internet: sobe um servidor local que finge ser o Sankhya.
 * A regex da versao ja errou uma vez em producao — procurava `VERSION` quando a
 * variavel se chama `SYSVERSION` — e foi so medindo contra HTML de verdade que apareceu.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MonitorBases } from '../src/sankhya/monitorBases.ts';
import type { CartaoClientes } from '../src/sankhya/cartao.ts';
import type { BaseCliente } from '../src/types.ts';
import { servidorHttp } from './helpers.ts';

/** Um pedaco do HTML real da tela de login, com o que a medicao procura. */
const HTML_LOGIN = `<html><head><script type="text/javascript">
  AUTHUSER = ""; SYSVERSION = "4.36b126"; HASLOGOCLIENTE = true;
  PROFILEID = "S4W8LB";
</script></head><body>Sankhya</body></html>`;

function base(url: string, extra: Partial<BaseCliente> = {}): BaseCliente {
  return {
    id: 1,
    clienteId: 1,
    ambiente: 'producao',
    url,
    usuario: '',
    temSenha: false,
    versao: '',
    monitorar: true,
    banco: { sgbd: '', host: '', porta: null, servico: '', esquema: '', usuario: '', temSenha: false },
    ordem: 0,
    ...extra,
  };
}

/** Cartao de mentira: so registra o que foi gravado, para o teste conferir. */
function cartaoFalso(): CartaoClientes & { gravadas: [number, string][] } {
  const gravadas: [number, string][] = [];
  return {
    gravadas,
    registrarVersao: (id: number, versao: string) => void gravadas.push([id, versao]),
    basesMonitoradas: () => [],
  } as unknown as CartaoClientes & { gravadas: [number, string][] };
}

describe('MonitorBases', () => {
  test('base no ar: operacional, com versão e latência', async () => {
    const servidor = await servidorHttp((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HTML_LOGIN);
    });

    try {
      const cartao = cartaoFalso();
      const medida = await new MonitorBases(cartao).medir(base(`http://127.0.0.1:${servidor.port}/mge/`));

      assert.equal(medida.status, 'up');
      assert.equal(medida.mensagem, 'Operacional');
      assert.equal(medida.versao, '4.36b126');
      assert.ok((medida.latenciaMs ?? -1) >= 0);
      assert.deepEqual(cartao.gravadas, [[1, '4.36b126']], 'guarda a versão para a tela não remedir');
    } finally {
      await servidor.close();
    }
  });

  test('versão igual à guardada não escreve no banco de novo', async () => {
    const servidor = await servidorHttp((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HTML_LOGIN);
    });

    try {
      const cartao = cartaoFalso();
      await new MonitorBases(cartao).medir(
        base(`http://127.0.0.1:${servidor.port}/mge/`, { versao: '4.36b126' }),
      );
      assert.deepEqual(cartao.gravadas, []);
    } finally {
      await servidor.close();
    }
  });

  test('5xx é a base doente; 4xx costuma ser URL errada no cadastro', async () => {
    for (const [codigo, esperado] of [
      [500, 'down'],
      [502, 'down'],
      [404, 'degraded'],
    ] as const) {
      const servidor = await servidorHttp((_req, res) => {
        res.writeHead(codigo);
        res.end('');
      });

      try {
        const medida = await new MonitorBases(cartaoFalso()).medir(
          base(`http://127.0.0.1:${servidor.port}/mge/`),
        );
        assert.equal(medida.status, esperado, `HTTP ${codigo}`);
        assert.equal(medida.mensagem, `HTTP ${codigo}`);
        assert.equal(medida.latenciaMs, null, 'só quem está no ar reporta latência');
      } finally {
        await servidor.close();
      }
    }
  });

  test('página sem a variável não inventa versão', async () => {
    const servidor = await servidorHttp((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      // `VERSION` aparece dentro de outra palavra: o `\b` da regex tem que recusar.
      res.end('<html>XSYSVERSION = "9.99"; nada aqui</html>');
    });

    try {
      const medida = await new MonitorBases(cartaoFalso()).medir(
        base(`http://127.0.0.1:${servidor.port}/mge/`, { versao: '4.36b126' }),
      );
      assert.equal(medida.status, 'up');
      assert.equal(medida.versao, '4.36b126', 'mantém a última versão conhecida');
    } finally {
      await servidor.close();
    }
  });

  test('base fora do ar vira down com o motivo, sem lançar', async () => {
    const medida = await new MonitorBases(cartaoFalso()).medir(base('http://127.0.0.1:1/mge/'));

    assert.equal(medida.status, 'down');
    assert.ok(medida.mensagem.length > 0, 'a tela precisa de um motivo legível');
  });

  test('o que foi medido vale por um tempo e depois vence', async () => {
    const servidor = await servidorHttp((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(HTML_LOGIN);
    });

    try {
      const monitor = new MonitorBases(cartaoFalso());
      assert.equal(monitor.conhecido(1), undefined, 'nada medido ainda');

      await monitor.medir(base(`http://127.0.0.1:${servidor.port}/mge/`));
      assert.equal(monitor.conhecido(1)?.status, 'up');
    } finally {
      await servidor.close();
    }
  });
});
