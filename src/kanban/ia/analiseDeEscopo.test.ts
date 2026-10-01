import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnaliseDeEscopoError, extrairResultado, resumoComDuvidas } from './analiseDeEscopo.ts';

describe('extrairResultado', () => {
  it('aceita o JSON cercado de texto e crases', () => {
    const saida = [
      'Aqui está:',
      '```json',
      JSON.stringify({
        resumo: 'Tela de pedidos',
        duvidas: ['Qual empresa?'],
        tarefas: [
          {
            titulo: 'Criar tabela',
            tipo: 'dados',
            estimativaHoras: 3,
            prioridade: 'alta',
            criteriosAceite: ['tabela criada', 'campos conferidos'],
          },
        ],
      }),
      '```',
    ].join('\n');

    const resultado = extrairResultado(saida);

    assert.equal(resultado.resumo, 'Tela de pedidos');
    assert.deepEqual(resultado.duvidas, ['Qual empresa?']);
    assert.equal(resultado.tarefas[0]?.titulo, 'Criar tabela');
    assert.equal(resultado.tarefas[0]?.criteriosDeAceite, 'tabela criada\ncampos conferidos');
  });

  it('falha sem JSON', () => {
    assert.throws(() => extrairResultado('não consegui'), AnaliseDeEscopoError);
  });

  it('falha sem tarefas', () => {
    assert.throws(() => extrairResultado('{"resumo":"x","tarefas":[]}'), AnaliseDeEscopoError);
  });
});

describe('resumoComDuvidas', () => {
  it('acrescenta os pontos a esclarecer', () => {
    assert.equal(
      resumoComDuvidas({ resumo: 'R', duvidas: ['A?'], tarefas: [] }),
      'R\n\nPontos a esclarecer com o cliente:\n- A?',
    );
  });
});
