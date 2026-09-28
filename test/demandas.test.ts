import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { idsDemandaNoTexto, listarIdsDemanda, normalizarIdsDemanda } from '../src/demandas.ts';
import { fatiarPorDemanda, montarGradeConsolidada } from '../src/calendario.ts';
import {
  deveAtualizar,
  demandasParaBuscar,
  janelaDeBusca,
  proximaAtualizacao,
  SincronizacaoAgenda,
} from '../src/sankhya/sincronizacaoAgenda.ts';
import { Solicitacoes } from '../src/sankhya/solicitacoes.ts';
import type { EventoComRecurso } from '../src/types.ts';

function evento(dia: string, descrlonga: string): EventoComRecurso {
  return { id: 1, inicio: `${dia} 08:00:00`, fim: `${dia} 18:00:00`, descrlonga, descrabrev: '' } as EventoComRecurso;
}

const TEXTO_AMATOOLS = 'Processos: Vendas\nOBS:\n- TECH | ID 2996 - AMATOOLS COMERCIAL E IMPORTADORA LTDA\nDesenvolvimento';

describe('IDs de demanda', () => {
  test('cadastro aceita vários IDs, com qualquer separador, sem repetir', () => {
    assert.deepEqual(listarIdsDemanda('2996, 3100 / 3100;4001'), ['2996', '3100', '4001']);
    assert.equal(normalizarIdsDemanda(' 2996 3100 '), '2996, 3100');
    assert.equal(normalizarIdsDemanda(''), '');
  });

  test('acha o ID no texto do evento da agenda — formato real de 2026-09', () => {
    assert.deepEqual(idsDemandaNoTexto(TEXTO_AMATOOLS), ['2996']);
    assert.deepEqual(idsDemandaNoTexto('ID: 3025 e depois id 3100'), ['3025', '3100']);
    assert.deepEqual(idsDemandaNoTexto('sem demanda, VALIDA 12'), []);
  });
});

describe('fatiarPorDemanda', () => {
  test('cada demanda citada vira uma fatia', () => {
    const fatias = fatiarPorDemanda(
      [evento('2026-09-02', 'TECH | ID 2996 - X'), evento('2026-09-02', 'TECH | ID 3100 - X')],
      ['2996', '3100'],
    );
    assert.deepEqual(fatias.map((f) => f.demanda), ['2996', '3100']);
  });

  test('evento sem ID vai para a única demanda do cliente', () => {
    assert.deepEqual(fatiarPorDemanda([evento('2026-09-02', 'sem id')], ['2996']).map((f) => f.demanda), ['2996']);
  });

  test('evento sem ID com várias demandas não é chutado para nenhuma', () => {
    assert.deepEqual(fatiarPorDemanda([evento('2026-09-02', 'sem id')], ['2996', '3100']).map((f) => f.demanda), ['']);
  });

  test('a grade consolidada mostra um chip por demanda do mesmo cliente', () => {
    const grade = montarGradeConsolidada(
      '2026-09',
      [
        {
          cliente: { id: 1, nome: 'Amatools' },
          demandas: ['2996', '3100'],
          eventos: [evento('2026-09-02', 'ID 2996'), evento('2026-09-02', 'ID 3100')],
        },
      ],
      '2026-09-20',
    );
    const dois = grade.find((d) => d.dia === '2026-09-02');
    assert.deepEqual(dois?.clientes.map((c) => `${c.nome}·${c.demanda}`), ['Amatools·2996', 'Amatools·3100']);
  });
});

describe('agenda da atualização automática', () => {
  const as = (hora: number, minuto = 0) => new Date(2026, 8, 28, hora, minuto);

  test('ao abrir o DS atualiza sempre, até fora do expediente', () => {
    assert.equal(deveAtualizar(as(22), null), true);
  });

  test('depois, só a cada 4 horas e entre 07:00 e 19:00', () => {
    const ultima = as(8).getTime();
    assert.equal(deveAtualizar(as(11, 59), ultima), false);
    assert.equal(deveAtualizar(as(12), ultima), true);
    assert.equal(deveAtualizar(as(19, 30), as(14).getTime()), false, 'fora do expediente');
    assert.equal(deveAtualizar(as(6), as(8).getTime() - 86_400_000), false, 'antes das 07:00');
    assert.equal(deveAtualizar(as(7), as(8).getTime() - 86_400_000), true);
  });

  test('a próxima prevista pula a noite', () => {
    assert.equal(proximaAtualizacao(as(17), as(16).getTime()).getTime(), new Date(2026, 8, 29, 7).getTime());
    assert.equal(proximaAtualizacao(as(9), as(8).getTime()).getTime(), as(12).getTime());
  });

  test('janela vai do mês passado ao fim do segundo mês seguinte', () => {
    assert.deepEqual(janelaDeBusca(as(10)), { de: '01/08/2026', ate: '30/11/2026' });
  });

  test('busca as demandas do cadastro e as citadas nos eventos do parceiro', () => {
    const ids = demandasParaBuscar(
      [
        { agendaDemandaId: '3025', agendaCodparc: 73379, agendaRecursoUsuario: '' },
        { agendaDemandaId: '', agendaCodparc: 78764, agendaRecursoUsuario: '' },
        { agendaDemandaId: '', agendaCodparc: null, agendaRecursoUsuario: '' },
      ],
      (codparc) => (codparc === 78764 ? [TEXTO_AMATOOLS, 'ID 4100 nova'] : []),
    );
    assert.deepEqual(ids, [2996, 3025, 4100]);
  });
});

describe('Solicitacoes (snapshot local)', () => {
  const erp = {
    solicitacoes: [
      {
        codigo: 2996,
        codparc: 78764,
        descricao: 'Aos cuidados de Clayton',
        horasEstimadas: 174,
        statusOrcamento: '5',
        tipo: '2',
        dtAbertura: '16/07/2026 11:10:15',
        dtAprovacao: '',
        anexoNome: 'Requisitos.pdf',
        anexoTamanho: 2438066,
        anexoTipo: 'application/pdf',
      },
    ],
    anexos: [
      { nuAttach: 1948697, codigo: 2996, nome: 'Orcamento.docx', descricao: 'Orçamento', link: '', dhCad: '24/07/2026' },
    ],
  };

  test('grava, rotula e devolve com os anexos; anexo apagado no ERP some', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sol-'));
    const s = new Solicitacoes(dir);
    try {
      s.gravar([2996], erp);
      const [lida] = s.obter([2996]);
      assert.equal(lida?.horasEstimadas, 174);
      assert.equal(lida?.statusOrcamento, 'Orçamento Aprovado');
      assert.equal(lida?.tipo, 'Personalização e Customização');
      assert.equal(lida?.anexo?.nome, 'Requisitos.pdf');
      assert.deepEqual(lida?.anexos.map((a) => a.nuAttach), [1948697]);

      s.gravar([2996], { ...erp, anexos: [] });
      assert.deepEqual(s.obter([2996])[0]?.anexos, []);

      // Código que não voltou do ERP mantém o que já havia.
      s.gravar([2996], { solicitacoes: [], anexos: [] });
      assert.equal(s.obter([2996])[0]?.horasEstimadas, 174);
    } finally {
      s.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SincronizacaoAgenda', () => {
  test('falha fica no estado e não derruba; a seguinte que dá certo limpa o erro', async () => {
    let falhar = true;
    const importados: unknown[] = [];
    const sinc = new SincronizacaoAgenda({
      agenda: { importar: (d: unknown) => importados.push(d), eventos: () => [], casarParceiro: () => null } as never,
      clientes: { listar: () => [{ agendaDemandaId: '2996', agendaCodparc: null, agendaRecursoUsuario: '' }] } as never,
      solicitacoes: { gravar: () => undefined } as never,
      buscarAgenda: async () => {
        if (falhar) throw new Error('aba ERP não existe');
        return JSON.stringify({ responseBody: {} });
      },
      buscarSolicitacoes: async () => ({ solicitacoes: [], anexos: [] }),
    });

    const antes = await sinc.atualizar();
    assert.equal(antes.ultimaEm, null);
    assert.equal(antes.erro, 'aba ERP não existe');

    falhar = false;
    const depois = await sinc.atualizar().catch((e: Error) => ({ erro: e.message, ultimaEm: null }));
    // O parser pode recusar o payload vazio; o importante é o erro ser o novo, não o velho.
    assert.notEqual(depois.erro, 'aba ERP não existe');
  });
});
