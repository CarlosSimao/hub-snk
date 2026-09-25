const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Transpila apenas os modulos puros em memoria; nao inicia Electron nem altera dist/.
require.extensions['.ts'] = (mod, arquivo) => {
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const js = ts.transpileModule(fonte, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  mod._compile(js, arquivo);
};
const { FilaIntegracao } = require('../src/integracaoFila.ts');
const { validarEvento, validarConfig, CAMINHO_API } = require('../src/integracaoValidacao.ts');
const url = `https://api.exemplo.com${CAMINHO_API}`;
const instalacao = '123e4567-e89b-42d3-a456-426614174000';
const usuario = (id = 'usuario:exp-usuario:ana@x.com:1a2b3c4d') => ({ id, type: 'usuario.upsert', occurredAt: '2026-09-24T12:00:00.000Z', data: { externalId: 'exp-usuario:ana@x.com', name: 'Ana' } });
const osEvento = { id: 'os:10269:abcdef12', type: 'os.upsert', occurredAt: '2026-09-24T12:01:00.000Z', data: { externalId: 'exp-projeto-10269', userExternalId: 'exp-usuario:ana@x.com', code: 'FAP-10269', title: 'Projeto', status: 'EM_ANDAMENTO', progress: 15 } };
const progresso = { id: 'prog:10269:3600', type: 'os.progresso', occurredAt: '2026-09-24T12:02:00.000Z', data: { osExternalId: 'exp-projeto-10269', progress: 30, status: 'EM_ANDAMENTO' } };
const novo = (fetcher) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'integracao-api-'));
  const arquivo = path.join(pasta, 'fila.json');
  const fila = new FilaIntegracao(arquivo, fetcher);
  fila.definirIdentidade(url, instalacao);
  return { fila, arquivo, limpar: () => fs.rmSync(pasta, { recursive: true, force: true }) };
};
const resposta = (results, string = false) => ({ ok: true, json: async () => ({ status: 'COMPLETED', output: string ? JSON.stringify({ results }) : { results } }) });

test('valida URL, IDs com dois pontos e limites do contrato', () => {
  validarConfig(url, instalacao); validarEvento(usuario());
  assert.throws(() => validarConfig(`http://api.exemplo.com${CAMINHO_API}`, instalacao));
  assert.throws(() => validarConfig(`${url}${CAMINHO_API}`, instalacao));
  assert.throws(() => validarEvento({ ...usuario(), id: 'x'.repeat(121) }));
  assert.throws(() => validarEvento({ ...osEvento, data: { ...osEvento.data, progress: 101 } }));
  assert.throws(() => validarEvento({ id: 'horas:98765:ab12cd34', type: 'horas.apontar', occurredAt: usuario().occurredAt, data: { externalId: 'exp-os-98765', osExternalId: 'exp-projeto-10269', userExternalId: 'exp-usuario:ana@x.com', minutes: 0 } }));
});

test('persiste antes do envio, ordena dependencias e deduplica apos confirmar', async () => {
  const pedidos = [];
  const { fila, arquivo, limpar } = novo(async (_url, options) => {
    const body = JSON.parse(options.body); pedidos.push(body);
    assert.equal(fs.existsSync(arquivo), true);
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).eventos.length, 3);
    return resposta(body.events.map(e => ({ id: e.id, status: 'accepted' })), true);
  });
  try {
    assert.equal(fila.enfileirarLote([progresso, osEvento, usuario()], url, instalacao), 3);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.deepEqual(pedidos[0].events.map(e => e.type), ['usuario.upsert', 'os.upsert', 'os.progresso']);
    assert.equal(fila.estado().pendentes, 0);
    assert.equal(fila.enfileirar(usuario(), url, instalacao), false);
    assert.equal(new FilaIntegracao(arquivo).enfileirar(usuario(), url, instalacao), false);
  } finally { limpar(); }
});

test('resposta parcial e failed bloqueiam dependentes sem retry', async () => {
  let chamadas = 0;
  const { fila, limpar } = novo(async () => { chamadas++; return resposta([{ id: usuario().id, status: 'failed', error: 'dsk_segredo invalido' }]); });
  try {
    fila.enfileirarLote([usuario(), osEvento], url, instalacao);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.equal(fila.estado().rejeitados, 1);
    assert.equal(fila.estado().pendentes, 1);
    assert.ok(!fila.estado().eventos[0].erro.includes('dsk_segredo'));
    await fila.enviar(url, instalacao, 'dsk_segredo', true);
    assert.equal(chamadas, 1);
  } finally { limpar(); }
});

test('queda de rede conserva id, tentativas e identidade apos reinicio', async () => {
  const { fila, arquivo, limpar } = novo(async () => { throw new Error('segredo dsk_segredo'); });
  try {
    fila.enfileirar(usuario(), url, instalacao);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    const recuperada = new FilaIntegracao(arquivo, async () => resposta([{ id: usuario().id, status: 'duplicate' }]));
    assert.equal(recuperada.estado().eventos[0].tentativas, 1);
    assert.throws(() => recuperada.definirIdentidade(url, '123e4567-e89b-42d3-a456-426614174001'));
    await recuperada.enviar(url, instalacao, 'dsk_segredo', true);
    assert.equal(recuperada.estado().pendentes, 0);
  } finally { limpar(); }
});

test('HTTP nao OK agenda retry; envelope incompleto exige acao manual', async () => {
  let chamadas = 0;
  const { fila, limpar } = novo(async () => {
    chamadas++;
    return chamadas === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ status: 'FAILED' }) };
  });
  try {
    fila.enfileirar(usuario(), url, instalacao);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.equal(fila.estado().eventos[0].tentativas, 1);
    assert.ok(fila.estado().proximaTentativa);
    await fila.enviar(url, instalacao, 'dsk_segredo', true);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.equal(chamadas, 2);
    assert.equal(fila.estado().pendentes, 1);
  } finally { limpar(); }
});

test('limita lote a 200 e impede envios simultaneos', async () => {
  let liberar;
  let chamadas = 0;
  const espera = new Promise(resolve => { liberar = resolve; });
  const { fila, limpar } = novo(async (_url, options) => {
    chamadas++;
    const events = JSON.parse(options.body).events;
    assert.equal(events.length, 200);
    await espera;
    return resposta(events.map(e => ({ id: e.id, status: 'accepted' })));
  });
  try {
    fila.enfileirarLote(Array.from({ length: 201 }, (_, i) => usuario(`usuario:${i}`)), url, instalacao);
    const primeiro = fila.enviar(url, instalacao, 'dsk_segredo');
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.equal(chamadas, 1);
    liberar(); await primeiro;
    assert.equal(fila.estado().pendentes, 1);
  } finally { limpar(); }
});

test('HTTP 401 nao entra em retry automatico; so envio forcado repete', async () => {
  let chamadas = 0;
  const { fila, limpar } = novo(async () => { chamadas++; return { ok: false, status: 401 }; });
  try {
    fila.enfileirar(usuario(), url, instalacao);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.equal(fila.estado().eventos[0].tentativas, 0);
    assert.equal(fila.estado().proximaTentativa, '');
    assert.match(fila.estado().eventos[0].erro, /HTTP 401/);
    await fila.enviar(url, instalacao, 'dsk_segredo');
    assert.equal(chamadas, 1);
    await fila.enviar(url, instalacao, 'dsk_segredo', true);
    assert.equal(chamadas, 2);
    assert.equal(fila.estado().pendentes, 1);
  } finally { limpar(); }
});

const { montarEventos, minutos } = require('../src/integracaoEventos.ts');
const ordem = (id, horas, extra = {}) => ({ id, dia: '2026-09-10', descricao: `OS ${id}`, horasFeitas: horas,
  totalProjetoPrevisto: '40:00', totalProjetoFeito: '10:00', coordenador: 'Maria', ...extra });
const consultor = { email: 'Ana.Souza+x@Sankhya.com.br', nome: 'Ana Souza' };

test('adaptadores: eventos validos no contrato, em ordem de dependencia', () => {
  const eventos = montarEventos(consultor, [{ projetoId: 10269, nome: 'Cliente X', ordens: [ordem(1, '08:00'), ordem(2, '00:00')] }], new Date('2026-09-25T12:00:00Z'));
  for (const e of eventos) validarEvento(e);
  assert.deepEqual(eventos.map(e => e.type), ['usuario.upsert', 'os.upsert', 'os.progresso', 'horas.apontar']);
  const [u, os, prog, horas] = eventos;
  assert.equal(u.data.externalId, 'exp-usuario:ana.souza_x@sankhya.com.br');
  assert.equal(os.data.progress, 25);
  assert.equal(os.data.status, 'EM_ANDAMENTO');
  assert.equal(prog.id, 'prog:10269:600');
  assert.equal(horas.data.minutes, 480);
  assert.equal(horas.data.externalId, 'exp-os-1');
  assert.equal(horas.data.startedAt, '2026-09-10T00:00:00.000Z');
});

test('adaptadores: mesmo dado gera mesmos ids; mudanca real gera id novo', () => {
  const p = (feito, desc) => [{ projetoId: 7, nome: 'C', ordens: [ordem(9, '02:30', { totalProjetoFeito: feito, descricao: desc })] }];
  const ids = (x) => montarEventos(consultor, x, new Date()).map(e => e.id);
  assert.deepEqual(ids(p('10:00', 'a')), ids(p('10:00', 'a')));
  const mudou = ids(p('12:30', 'b'));
  const antes = ids(p('10:00', 'a'));
  assert.equal(mudou[0], antes[0]);
  assert.notEqual(mudou[2], antes[2]);
  assert.notEqual(mudou[3], antes[3]);
});

test('adaptadores: sem email ou sem OS nao sintetiza nada; previsto atingido conclui', () => {
  assert.equal(montarEventos({ email: '', nome: '' }, [], new Date()).length, 0);
  assert.equal(montarEventos(consultor, [{ projetoId: 1, nome: 'C', ordens: [] }], new Date()).length, 1);
  const [, os] = montarEventos(consultor, [{ projetoId: 1, nome: 'C', ordens: [ordem(3, '01:00', { totalProjetoFeito: '45:00' })] }], new Date());
  assert.equal(os.data.progress, 100);
  assert.equal(os.data.status, 'CONCLUIDO');
  assert.equal(minutos('125:05'), 7505);
  assert.equal(minutos('x'), 0);
});
