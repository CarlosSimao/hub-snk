import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  idsCitadosNaAgenda,
  idsCitadosNaSolicitacao,
  interpretarSolicitacao,
  SolicitacaoNaoEncontradaError,
} from './solicitacaoServicos.ts';

test('agenda: só "ID" seguido do número conta', () => {
  assert.deepEqual(idsCitadosNaAgenda('ID 3536'), [3536]);
  assert.deepEqual(
    idsCitadosNaAgenda('Processos: Atendimento Avulso\n- Atendimento\nOBS:\n- ID 3216\n'),
    [3216],
  );
  assert.deepEqual(idsCitadosNaAgenda('Demanda ID 3238'), [3238]);
  assert.deepEqual(idsCitadosNaAgenda('id: 3238, ID#3240 e ID-3241'), [3238, 3240, 3241]);
  assert.deepEqual(idsCitadosNaAgenda('ID 3238 de novo ID 3238'), [3238]);
  assert.deepEqual(idsCitadosNaAgenda('Reunião 0830 a 1200 em 2026, nota 12345, DS 3619'), []);
  assert.deepEqual(idsCitadosNaAgenda('IDENTIFICADOR 3619 e ID 361'), []);
});

test('DS: aceita também "DS3264", "DS 3264" e "ID DSTECH 3619"', () => {
  assert.deepEqual(
    idsCitadosNaSolicitacao('complemento do DS3264; ver DS 3265, ID 3266 e ID DSTECH 3267'),
    [3264, 3265, 3266, 3267],
  );
  assert.deepEqual(idsCitadosNaSolicitacao('pedido 12345 de 2026'), []);
});

const SOLICITACAO = JSON.stringify({
  fields: [
    'CODIGO',
    'TIPOSOLICITACAO',
    'MOVORC',
    'CODPARC',
    'Parceiro.NOMEPARC',
    'ORIGBASE',
    'Usuario.NOMEUSU',
    'CARGOSOL',
    'COMPLEXIDADE',
    'DTABERTURA',
    'DTPRIAGENDA',
    'ANEXODOC',
    'DESCRSOL',
  ],
  total: '1',
  result: [
    [
      '3619',
      '2',
      '5',
      '100',
      'CLIENTE TESTE LTDA',
      '3',
      'FULANO',
      'GERENTE',
      'lixo',
      '29/10/2026 11:13:43',
      '',
      '{"name":"Escopo.docx.pdf","size":10,"type":"application/pdf"}',
      'Complemento ao DS3264 e ao próprio DS3619.',
    ],
  ],
});
const HISTORICO = JSON.stringify({
  fields: ['SEQUENCIA', 'DTGER', 'MOVIMENTACAO', 'NOMEUSUMOV', 'OBSERVACAO'],
  result: [
    ['2', '29/10/2026 13:36:17', ' Orçamento Aprovado ', 'FULANO', 'ok'],
    [
      '3',
      '30/10/2026 15:44:35',
      'Orçamento Aprovado',
      'BELTRANO',
      'ID 3264 é o original; ver ID 3500',
    ],
    ['1', '29/10/2026 11:13:43', 'Nao Iniciado', 'FULANO', 'Tarefa Criada'],
  ],
});
const ANEXOS = JSON.stringify({
  fields: ['NUATTACH', 'NOMEARQUIVO', 'CHAVEARQUIVO', 'DESCRICAO', 'Usuario.NOMEUSU', 'DHCAD'],
  result: [['99', 'ORCAMENTO.docx', 'abc', 'Orçamento', 'BELTRANO', '29/10/2026 12:45:50']],
});

test('interpreta a DS com códigos traduzidos, histórico do mais novo e anexos', () => {
  const ds = interpretarSolicitacao(3619, {
    solicitacao: SOLICITACAO,
    historico: HISTORICO,
    anexos: ANEXOS,
  });

  assert.equal(ds.titulo, 'DS 3619 - CLIENTE TESTE LTDA');
  assert.deepEqual(ds.campos.slice(0, 5), [
    { rotulo: 'Tipo', valor: 'Personalização e Customização' },
    { rotulo: 'Status do orçamento', valor: 'Orçamento Aprovado' },
    { rotulo: 'Origem', valor: 'Projeto em Andamento' },
    { rotulo: 'Parceiro', valor: '100 - CLIENTE TESTE LTDA' },
    { rotulo: 'Solicitante', valor: 'FULANO - GERENTE' },
  ]);
  assert.ok(!ds.campos.some((c) => c.rotulo === 'Primeira agenda'), 'campo vazio fica de fora');
  assert.ok(!ds.campos.some((c) => c.valor === 'lixo'), 'COMPLEXIDADE não é exibida');
  assert.deepEqual(ds.solicitante, { nome: 'Fulano', cargo: 'GERENTE', email: '' });

  assert.deepEqual(
    ds.historico.map((h) => h.data.slice(0, 10)),
    ['30/10/2026', '29/10/2026', '29/10/2026'],
  );
  assert.equal(ds.historico[1]?.movimentacao, 'Orçamento Aprovado');

  assert.deepEqual(
    ds.anexos.map((a) => [a.origem, a.nome, a.tipo, a.previsualizavel]),
    [
      ['formulario', 'Escopo.docx.pdf', 'application/pdf', true],
      ['sistema', 'ORCAMENTO.docx', 'application/octet-stream', false],
    ],
  );
  assert.equal(ds.anexos[1]?.nuAttach, '99');

  assert.deepEqual(ds.relacionados, [
    { codigo: 3264, origem: 'citado na DS 3619' },
    { codigo: 3500, origem: 'citado na DS 3619' },
  ]);
});

test('DS sem registro é "não encontrada"', () => {
  const vazia = JSON.stringify({ fields: ['CODIGO'], total: '0', result: [] });
  assert.throws(
    () => interpretarSolicitacao(1, { solicitacao: vazia, historico: vazia, anexos: vazia }),
    SolicitacaoNaoEncontradaError,
  );
});
