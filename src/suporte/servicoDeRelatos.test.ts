import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { gunzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { registrarRotasDeSuporte } from '../rotas/rotasSuporte.ts';
import { lerFinalDoArquivo, montarLogDeDiagnostico } from './logDeDiagnostico.ts';
import { mascararTexto } from './mascaramento.ts';
import { RelatoRecusadoError, ServicoDeRelatos } from './servicoDeRelatos.ts';

const raiz = mkdtempSync(join(tmpdir(), 'hub-snk-relatos-'));
after(() => rmSync(raiz, { recursive: true, force: true }));

interface Pedido {
  url: string;
  corpo: Record<string, unknown>;
}

let pastaDeLog: string;
let pastaDeEstado: string;
let pedidos: Pedido[];
/** O que o "suporte" responde a cada envio: um status HTTP, ou `null` para simular queda de rede. */
let respostaDoSuporte: number | null;
let contador = 0;
/** O que Configurações tem gravado de nome, empresa e time. */
let identificacao: { nome: string; empresa: string; time: string };

function criarServico(): ServicoDeRelatos {
  return new ServicoDeRelatos({
    endereco: 'https://suporte.exemplo/intake/v1/reports/hub-snk',
    pastaDeLog,
    pastaDeEstado,
    versaoDoAplicativo: '2.4.0',
    lerPerfil: async () => 'consultor',
    lerIdentificacao: async () => identificacao,
    buscar: (async (url: string | URL | Request, opcoes?: RequestInit) => {
      if (respostaDoSuporte === null) throw new TypeError('fetch failed');
      pedidos.push({
        url: String(url),
        corpo: JSON.parse(String(opcoes?.body)) as Record<string, unknown>,
      });
      return new Response('{}', { status: respostaDoSuporte });
    }) as typeof fetch,
  });
}

beforeEach(() => {
  contador += 1;
  pastaDeLog = join(raiz, `caso-${contador}`, 'log');
  pastaDeEstado = join(raiz, `caso-${contador}`, 'suporte');
  mkdirSync(pastaDeLog, { recursive: true });
  pedidos = [];
  respostaDoSuporte = 201;
  identificacao = { nome: 'Ana Souza', empresa: 'Acme', time: 'Suporte' };
});

const fila = () => {
  try {
    return readdirSync(join(pastaDeEstado, 'relatos-pendentes'));
  } catch {
    return [];
  }
};

describe('mascararTexto', () => {
  it('tira token, senha, e-mail e o nome da conta do sistema', () => {
    const cru = [
      'GET /sso?token=abc123&x=1',
      'authorization: Bearer segredo-de-sessao',
      '{"usuario":"ana","senha":"minhaSenha123"}',
      "password='outra'",
      'contato ana.silva@cliente.com.br respondeu',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123 fim',
      String.raw`ENOENT C:\Users\carlos.nascimento\AppData\Roaming\x`,
      '/home/carlos/.config/x',
    ].join('\n');

    const limpo = mascararTexto(cru);

    for (const segredo of [
      'abc123',
      'segredo-de-sessao',
      'minhaSenha123',
      'outra',
      'ana.silva@cliente.com.br',
      'eyJhbGciOiJIUzI1NiJ9',
      'carlos.nascimento',
      '/home/carlos/',
    ]) {
      assert.ok(!limpo.includes(segredo), `vazou: ${segredo}`);
    }
    assert.ok(limpo.includes('GET /sso?token=[redigido]&x=1'));
    assert.ok(limpo.includes(String.raw`C:\Users\[usuario]\AppData`));
    assert.ok(limpo.includes('"usuario":"ana"'), 'o que não é segredo fica como está');
  });
});

describe('log de diagnóstico', () => {
  it('pega só o final de cada arquivo, a partir de uma linha inteira', async () => {
    const caminho = join(pastaDeLog, 'backend.log');
    writeFileSync(caminho, Array.from({ length: 100 }, (_, i) => `linha ${i}`).join('\n'));

    const final = await lerFinalDoArquivo(caminho, 40);

    assert.ok(final.endsWith('linha 99'));
    assert.ok(final.startsWith('linha '), 'a primeira linha, cortada ao meio, é descartada');
    assert.ok(!final.includes('linha 1\n'));
  });

  it('junta os dois arquivos, mascarados, com o nome de cada um', async () => {
    writeFileSync(join(pastaDeLog, 'desktop.log'), '{"evento":"backend-iniciando"}\n');
    writeFileSync(join(pastaDeLog, 'backend.log'), 'erro ao logar ana@cliente.com\n');

    const log = await montarLogDeDiagnostico(pastaDeLog);

    assert.match(log, /===== desktop\.log =====\n\{"evento":"backend-iniciando"\}/);
    assert.match(log, /===== backend\.log =====\nerro ao logar \[email-redigido\]/);
  });

  it('sem arquivo de log devolve vazio em vez de falhar', async () => {
    assert.equal(await montarLogDeDiagnostico(join(raiz, 'nao-existe')), '');
  });
});

describe('ServicoDeRelatos', () => {
  it('envia o relato com o contexto e o log compactado e já mascarado', async () => {
    writeFileSync(join(pastaDeLog, 'backend.log'), 'falha com token=abc123\n');

    const situacao = await criarServico().relatar({
      tipo: 'BUG',
      mensagem: 'A aba Git não abre.',
      email: 'eu@exemplo.com',
      incluirLog: true,
    });

    assert.equal(situacao, 'enviado');
    const corpo = pedidos[0]!.corpo;
    assert.equal(corpo['type'], 'BUG');
    assert.equal(corpo['message'], 'A aba Git não abre.');
    assert.equal(corpo['email'], 'eu@exemplo.com');
    assert.match(String(corpo['externalId']), /^[0-9a-f-]{36}$/);
    const contexto = corpo['context'] as Record<string, string>;
    assert.equal(contexto['appVersion'], '2.4.0');
    assert.equal(contexto['perfil'], 'consultor');
    assert.equal(contexto['usuario'], 'Ana Souza');
    assert.equal(contexto['empresa'], 'Acme');
    assert.equal(contexto['time'], 'Suporte');

    const log = gunzipSync(Buffer.from(String(corpo['logGzipBase64']), 'base64')).toString('utf8');
    assert.ok(log.includes('token=[redigido]'));
    assert.ok(!log.includes('abc123'));
  });

  it('sem marcar o log, nada de log sai da máquina', async () => {
    writeFileSync(join(pastaDeLog, 'backend.log'), 'qualquer coisa\n');
    await criarServico().relatar({ tipo: 'SUGESTAO', mensagem: 'ideia', incluirLog: false });

    assert.equal(pedidos[0]!.corpo['logGzipBase64'], undefined);
    assert.equal(pedidos[0]!.corpo['email'], undefined);
  });

  it('o id da instalação é criado uma vez e reaproveitado', async () => {
    const servico = criarServico();
    const primeiro = await servico.identificadorDaInstalacao();
    assert.equal(await criarServico().identificadorDaInstalacao(), primeiro);

    await servico.relatar({ tipo: 'OUTRO', mensagem: 'x', incluirLog: false });
    assert.equal(pedidos[0]!.corpo['installId'], primeiro);
  });

  it('sem rede, o relato fica na fila e sai depois com o mesmo id', async () => {
    respostaDoSuporte = null;
    const servico = criarServico();
    assert.equal(
      await servico.relatar({ tipo: 'BUG', mensagem: 'offline', incluirLog: false }),
      'enfileirado',
    );
    assert.equal(fila().length, 1);

    assert.equal(await servico.reenviarPendentes(), 0, 'ainda sem rede: continua na fila');
    assert.equal(fila().length, 1);

    respostaDoSuporte = 201;
    assert.equal(await servico.reenviarPendentes(), 1);
    assert.equal(fila().length, 0);
    assert.equal(pedidos[0]!.corpo['message'], 'offline');
  });

  it('suporte fora do ar (5xx) também enfileira', async () => {
    respostaDoSuporte = 502;
    assert.equal(
      await criarServico().relatar({ tipo: 'BUG', mensagem: 'x', incluirLog: false }),
      'enfileirado',
    );
  });

  it('teto diário atingido é recusa definitiva: avisa e não enfileira', async () => {
    respostaDoSuporte = 429;
    await assert.rejects(
      criarServico().relatar({ tipo: 'BUG', mensagem: 'x', incluirLog: false }),
      (erro: Error) => erro instanceof RelatoRecusadoError && /limite diário/.test(erro.message),
    );
    assert.equal(fila().length, 0);
  });

  it('relato recusado na fila é descartado sem travar os seguintes', async () => {
    respostaDoSuporte = null;
    const servico = criarServico();
    await servico.relatar({ tipo: 'BUG', mensagem: 'primeiro', incluirLog: false });
    await servico.relatar({ tipo: 'BUG', mensagem: 'segundo', incluirLog: false });

    let chamadas = 0;
    const comRecusa = new ServicoDeRelatos({
      endereco: 'https://suporte.exemplo/x',
      pastaDeLog,
      pastaDeEstado,
      versaoDoAplicativo: '2.4.0',
      lerIdentificacao: async () => identificacao,
      buscar: (async () =>
        new Response('{}', { status: (chamadas += 1) === 1 ? 400 : 201 })) as typeof fetch,
    });

    assert.equal(await comRecusa.reenviarPendentes(), 1);
    assert.equal(fila().length, 0);
  });
});

describe('rotas de suporte', () => {
  async function servidor() {
    const fastify = Fastify();
    registrarRotasDeSuporte(fastify, criarServico());
    await fastify.ready();
    return fastify;
  }

  it('POST /api/suporte/relatos envia e responde 201', async () => {
    const fastify = await servidor();
    const resposta = await fastify.inject({
      method: 'POST',
      url: '/api/suporte/relatos',
      payload: { tipo: 'BUG', mensagem: '  travou  ', email: '', incluirLog: false },
    });

    assert.equal(resposta.statusCode, 201);
    assert.deepEqual(resposta.json(), { situacao: 'enviado' });
    assert.equal(pedidos[0]!.corpo['message'], 'travou');
  });

  it('responde 202 quando o relato fica na fila', async () => {
    respostaDoSuporte = null;
    const fastify = await servidor();
    const resposta = await fastify.inject({
      method: 'POST',
      url: '/api/suporte/relatos',
      payload: { tipo: 'BUG', mensagem: 'x' },
    });
    assert.equal(resposta.statusCode, 202);
    assert.deepEqual(resposta.json(), { situacao: 'enfileirado' });
  });

  it('valida tipo, mensagem e e-mail', async () => {
    const fastify = await servidor();
    const enviar = (payload: object) =>
      fastify.inject({ method: 'POST', url: '/api/suporte/relatos', payload });

    assert.equal((await enviar({ tipo: 'XPTO', mensagem: 'x' })).statusCode, 400);
    assert.equal((await enviar({ tipo: 'BUG', mensagem: '   ' })).statusCode, 400);
    const email = await enviar({ tipo: 'BUG', mensagem: 'x', email: 'nao-e-email' });
    assert.equal(email.statusCode, 400);
    assert.equal(email.json().mensagem, 'E-mail inválido.');
    assert.equal(pedidos.length, 0);
  });

  it('sem nome, empresa e time o envio é bloqueado e a mensagem aponta o que falta', async () => {
    const fastify = await servidor();
    const enviar = () =>
      fastify.inject({
        method: 'POST',
        url: '/api/suporte/relatos',
        payload: { tipo: 'BUG', mensagem: 'x', incluirLog: false },
      });

    identificacao = { nome: '', empresa: '   ', time: '' };
    const todosFaltando = await enviar();
    assert.equal(todosFaltando.statusCode, 400);
    assert.equal(
      todosFaltando.json().mensagem,
      'Preencha em Configurações antes de enviar: Nome do usuário, Empresa, Time.',
    );

    identificacao = { nome: 'Ana Souza', empresa: 'Acme', time: ' ' };
    const soOTimeFaltando = await enviar();
    assert.equal(soOTimeFaltando.statusCode, 400);
    assert.equal(
      soOTimeFaltando.json().mensagem,
      'Preencha em Configurações antes de enviar: Time.',
    );

    assert.equal(pedidos.length, 0, 'nada sai sem a identificação');
    assert.equal(fila().length, 0, 'e também não vai para a fila');
  });

  it('a prévia mostra nome, empresa e time que seguirão no relato', async () => {
    const fastify = await servidor();
    const previa = (await fastify.inject({ method: 'GET', url: '/api/suporte/previa' })).json();

    assert.equal(previa.contexto.usuario, 'Ana Souza');
    assert.equal(previa.contexto.empresa, 'Acme');
    assert.equal(previa.contexto.time, 'Suporte');
  });

  it('recusa definitiva do suporte vira 422 com a explicação', async () => {
    respostaDoSuporte = 429;
    const fastify = await servidor();
    const resposta = await fastify.inject({
      method: 'POST',
      url: '/api/suporte/relatos',
      payload: { tipo: 'BUG', mensagem: 'x' },
    });
    assert.equal(resposta.statusCode, 422);
    assert.match(resposta.json().mensagem, /limite diário/);
  });

  it('GET /api/suporte/previa mostra o contexto e o log que seguiriam', async () => {
    writeFileSync(join(pastaDeLog, 'backend.log'), 'senha="123456"\n');
    const fastify = await servidor();
    const previa = (await fastify.inject({ method: 'GET', url: '/api/suporte/previa' })).json();

    assert.equal(previa.contexto.appVersion, '2.4.0');
    assert.ok(previa.log.includes('senha="[redigido]"'));
  });
});
