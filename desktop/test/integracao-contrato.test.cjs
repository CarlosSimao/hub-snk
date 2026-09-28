const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

require.extensions['.ts'] = (mod, arquivo) => {
  const fonte = fs.readFileSync(arquivo, 'utf8');
  const js = ts.transpileModule(fonte, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(js, arquivo);
};

const { atrasoAleatorioInstalacao, FilaIntegracao } = require('../src/integracaoFila.ts');
const { validarEvento, CAMINHO_API } = require('../src/integracaoValidacao.ts');
const apiUrl = `https://api.exemplo.com${CAMINHO_API}`;
const installationId = '123e4567-e89b-42d3-a456-426614174000';
const occurredAt = '2026-09-24T12:00:00Z';

const eventos = {
  usuario: { id: 'usuario-1', type: 'usuario.upsert', occurredAt, data: { externalId: 'usuario-1', name: 'Ana' } },
  cliente: { id: 'cliente-1', type: 'cliente.upsert', occurredAt, data: { externalId: 'cliente-1', name: 'Cliente', erpPartnerCode: 77 } },
  os: { id: 'os-1', type: 'os.upsert', occurredAt, data: { externalId: 'os-1', userExternalId: 'usuario-1', code: 'OS-1', title: 'OS', status: 'ABERTA', progress: 0 } },
  progresso: { id: 'progresso-1', type: 'os.progresso', occurredAt, data: { osExternalId: 'os-1', progress: 50, status: 'EM_ANDAMENTO' } },
  demanda: { id: 'demanda-1', type: 'demanda.upsert', occurredAt, data: { externalId: 'demanda-1', clientExternalId: 'cliente-1', name: 'Demanda', status: 'ANALISANDO', createdAt: occurredAt, analyzedAt: null } },
  tarefa: { id: 'tarefa-1', type: 'tarefa.upsert', occurredAt, data: { externalId: 'tarefa-1', userExternalId: 'usuario-1', clientExternalId: 'cliente-1', demandExternalId: 'demanda-1', title: 'Tarefa', kind: 'BACKEND', priority: 'ALTA', estimatedMinutes: 60, status: 'A_FAZER', position: 0, createdAt: occurredAt, updatedAt: occurredAt } },
  transicao: { id: 'transicao-1', type: 'tarefa.transicao', occurredAt, data: { taskExternalId: 'tarefa-1', from: 'A_FAZER', to: 'EM_ANDAMENTO' } },
  planejamento: { id: 'planejamento-1', type: 'planejamento.upsert', occurredAt, data: { externalId: 'planejamento-1', osExternalId: 'os-1', userExternalId: 'usuario-1', plannedDate: '2026-09-26', startTime: '09:00', endTime: '12:00:00', status: 'FUTURA' } },
  agenda: { id: 'agenda-1', type: 'agenda.evento.upsert', occurredAt, data: { externalId: 'agenda-1', userExternalId: 'usuario-1', clientCode: 77, clientName: 'Cliente', start: '2026-09-26T13:00:00.000Z', end: '2026-09-26T15:00:00.000Z', allDay: false, title: 'Reuniao', kind: 'REUNIAO', confirmed: true, fapCode: 123 } },
  horas: { id: 'horas-1', type: 'horas.apontar', occurredAt, data: { externalId: 'horas-1', osExternalId: 'os-1', userExternalId: 'usuario-1', minutes: 90, startedAt: '2026-09-24T13:00:00.000Z', endedAt: '2026-09-24T14:30:00.000Z', activityType: 'Desenvolvimento', stage: 'Homologacao', process: 'Faturamento', acceptance: 'CONCLUIDO', erpNumber: 12345, erpStatus: 'LANCADO', exceeded: false, requestCode: 'PED-778' } },
};

const copiar = (evento, id = evento.id) => ({ ...evento, id, data: { ...evento.data } });
const resposta = results => ({ ok: true, json: async () => ({ status: 'COMPLETED', output: { results } }) });
const novaFila = (fetcher, aleatorio) => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'integracao-contrato-'));
  const arquivo = path.join(pasta, 'fila.json');
  const fila = new FilaIntegracao(arquivo, fetcher, aleatorio);
  fila.definirIdentidade(apiUrl, installationId);
  return { fila, arquivo, limpar: () => fs.rmSync(pasta, { recursive: true, force: true }) };
};

test('aceita os dez tipos e todos os campos novos do contrato', () => {
  for (const evento of Object.values(eventos)) validarEvento(evento);
  validarEvento({ ...copiar(eventos.cliente, 'cliente-string'), data: { ...eventos.cliente.data, erpPartnerCode: '77' } });
  validarEvento({ ...copiar(eventos.horas, 'horas-string'), data: { ...eventos.horas.data, erpNumber: '12345', requestCode: 778 } });
});

test('recusa payload incompleto em cada um dos dez tipos', () => {
  const obrigatorios = {
    usuario: 'name', cliente: 'name', os: 'code', progresso: 'status', demanda: 'clientExternalId',
    tarefa: 'kind', transicao: 'to', planejamento: 'plannedDate', agenda: 'clientCode', horas: 'minutes',
  };
  for (const [nome, campo] of Object.entries(obrigatorios)) {
    const evento = copiar(eventos[nome], `${nome}-invalido`);
    delete evento.data[campo];
    assert.throws(() => validarEvento(evento), new RegExp(`${campo} obrigatorio`));
  }
});

test('aplica enums, limites, datas UTC e regras cruzadas', () => {
  const invalido = (base, id, data) => assert.throws(() => validarEvento({ ...copiar(base, id), data: { ...base.data, ...data } }));
  invalido(eventos.demanda, 'demanda-status', { status: 'ABERTA' });
  invalido(eventos.tarefa, 'tarefa-kind', { kind: 'JAVA' });
  invalido(eventos.tarefa, 'tarefa-minutos', { estimatedMinutes: 961 });
  invalido(eventos.transicao, 'transicao-igual', { from: 'A_FAZER', to: 'A_FAZER' });
  invalido(eventos.planejamento, 'planejamento-sem-fim', { endTime: undefined });
  invalido(eventos.planejamento, 'planejamento-invertido', { startTime: '12:00', endTime: '09:00' });
  invalido(eventos.planejamento, 'planejamento-hora', { startTime: '24:00' });
  invalido(eventos.planejamento, 'planejamento-data', { plannedDate: '2026-02-30' });
  invalido(eventos.agenda, 'agenda-invertida', { end: eventos.agenda.data.start });
  invalido(eventos.horas, 'horas-invertidas', { endedAt: eventos.horas.data.startedAt });
  invalido(eventos.horas, 'horas-aceite', { acceptance: 'ACEITO' });
  assert.throws(() => validarEvento({ ...copiar(eventos.usuario, 'data-offset'), occurredAt: '2026-09-24T12:00:00-03:00' }));
  assert.throws(() => validarEvento({ ...copiar(eventos.usuario, 'data-fracao'), occurredAt: '2026-09-24T12:00:00.1Z' }));
});

test('ordena os dez tipos conforme a secao 4', async () => {
  const enviados = [];
  const { fila, limpar } = novaFila(async (_url, opcoes) => {
    const lote = JSON.parse(opcoes.body).events;
    enviados.push(...lote.map(evento => evento.type));
    return resposta(lote.map(evento => ({ id: evento.id, status: 'accepted' })));
  });
  try {
    fila.enfileirarLote(Object.values(eventos).reverse(), apiUrl, installationId);
    await fila.enviar(apiUrl, installationId, 'dsk_teste');
    assert.deepEqual(enviados, [
      'usuario.upsert', 'cliente.upsert', 'demanda.upsert', 'os.upsert', 'os.progresso',
      'tarefa.upsert', 'tarefa.transicao', 'planejamento.upsert', 'agenda.evento.upsert',
      'horas.apontar',
    ]);
  } finally { limpar(); }
});

test('bloqueia cada dependencia quando a entidade referenciada falha', async t => {
  const casos = [
    ['usuario de OS', eventos.usuario, eventos.os],
    ['OS de progresso', eventos.os, eventos.progresso],
    ['cliente de demanda', eventos.cliente, eventos.demanda],
    ['usuario de tarefa', eventos.usuario, eventos.tarefa],
    ['cliente de tarefa', eventos.cliente, eventos.tarefa],
    ['demanda de tarefa', eventos.demanda, eventos.tarefa],
    ['tarefa de transicao', eventos.tarefa, eventos.transicao],
    ['OS de planejamento', eventos.os, eventos.planejamento],
    ['usuario de planejamento', eventos.usuario, eventos.planejamento],
    ['usuario de agenda', eventos.usuario, eventos.agenda],
    ['cliente por codigo de agenda', eventos.cliente, eventos.agenda],
    ['OS de horas', eventos.os, eventos.horas],
    ['usuario de horas', eventos.usuario, eventos.horas],
  ];
  for (const [nome, paiBase, filhoBase] of casos) await t.test(nome, async () => {
    let chamadas = 0;
    const pai = copiar(paiBase, `${paiBase.id}-${nome.replaceAll(' ', '-')}`);
    const filho = copiar(filhoBase, `${filhoBase.id}-${nome.replaceAll(' ', '-')}`);
    const { fila, limpar } = novaFila(async () => {
      chamadas++;
      return resposta([{ id: pai.id, status: 'failed', error: 'dependencia invalida' }]);
    });
    try {
      fila.enfileirarLote([filho, pai], apiUrl, installationId);
      await fila.enviar(apiUrl, installationId, 'dsk_teste');
      await fila.enviar(apiUrl, installationId, 'dsk_teste', true);
      assert.equal(chamadas, 1);
      assert.equal(fila.estado().pendentes, 1);
    } finally { limpar(); }
  });
});

test('lote mira 100, usa teto 200 com acumulo e mantem o restante', async () => {
  const tamanhos = [];
  const { fila, limpar } = novaFila(async (_url, opcoes) => {
    const lote = JSON.parse(opcoes.body).events;
    tamanhos.push(lote.length);
    return resposta(lote.map(evento => ({ id: evento.id, status: 'accepted' })));
  });
  try {
    fila.enfileirarLote(Array.from({ length: 201 }, (_, i) => copiar(eventos.usuario, `usuario-lote-${i}`)), apiUrl, installationId);
    await fila.enviar(apiUrl, installationId, 'dsk_teste');
    assert.deepEqual(tamanhos, [200]);
    assert.equal(fila.estado().pendentes, 1);
  } finally { limpar(); }
});

test('backoff de 5 segundos aplica jitter entre menos e mais 20 por cento', async () => {
  for (const [aleatorio, minimo, maximo] of [[0, 3900, 4100], [1, 5900, 6100]]) {
    const { fila, arquivo, limpar } = novaFila(async () => { throw new Error('rede'); }, () => aleatorio);
    try {
      fila.enfileirar(copiar(eventos.usuario, `usuario-jitter-${aleatorio}`), apiUrl, installationId);
      const antes = Date.now();
      await fila.enviar(apiUrl, installationId, 'dsk_teste');
      const persistido = JSON.parse(fs.readFileSync(arquivo, 'utf8')).eventos[0];
      const atraso = Date.parse(persistido.proximaTentativa) - antes;
      assert.ok(atraso >= minimo && atraso <= maximo, `atraso ${atraso} fora de ${minimo}-${maximo}`);
    } finally { limpar(); }
  }
});

test('jitter por instalacao fica entre zero e dois minutos', () => {
  assert.equal(atrasoAleatorioInstalacao(() => 0), 0);
  assert.equal(atrasoAleatorioInstalacao(() => 0.5), 60_000);
  assert.equal(atrasoAleatorioInstalacao(() => 1), 120_000);
});
