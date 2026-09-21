/**
 * Pendencias que entram no resumo diario.
 *
 * O ponto sensivel e' o e-mail de finalizacao: ele foi pedido justamente para NAO parar
 * de cobrar enquanto nao for marcado como enviado — e' o registro de que o aviso foi
 * dado. Um "ja avisei ontem" aqui anularia a feature inteira.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { emailFinalizacaoPendente, temPendencia, textoPendencias, type PendenciasCliente } from '../src/pendencias.ts';
import type { Cliente } from '../src/types.ts';

function cliente(parcial: Partial<Cliente>): Cliente {
  return {
    id: 1,
    nome: 'AMATOOLS',
    experienceProjetoId: null,
    experiencePersonId: null,
    agendaRecursoUsuario: '',
    agendaCodparc: null,
    agendaDemandaId: '',
    sankhyaUrl: '',
    repositorioLocal: '',
    repositorioRemoto: '',
    anotacoes: '',
    anotacoesNotificar: false,
    demandaFim: '',
    emailFinalizacaoEm: '',
    ...parcial,
  };
}

function pendencia(parcial: Partial<PendenciasCliente> = {}): PendenciasCliente {
  return {
    clienteId: 1,
    nome: 'AMATOOLS',
    tarefasAtrasadas: [],
    diasSemOs: [],
    ordensSemAceite: [],
    emailFinalizacaoPendente: false,
    erro: '',
    ...parcial,
  };
}

describe('e-mail de finalização', () => {
  test('sem data de fim não cobra nada', () => {
    assert.equal(emailFinalizacaoPendente(cliente({}), '2026-09-18'), false);
  });

  test('demanda ainda em curso não cobra', () => {
    assert.equal(emailFinalizacaoPendente(cliente({ demandaFim: '2026-09-30' }), '2026-09-18'), false);
  });

  test('cobra já no último dia, não no dia seguinte', () => {
    // O combinado é que o e-mail saia ao finalizar; esperar mais um dia é atrasar o aviso.
    assert.equal(emailFinalizacaoPendente(cliente({ demandaFim: '2026-09-18' }), '2026-09-18'), true);
  });

  test('marcado como enviado, para de cobrar', () => {
    const c = cliente({ demandaFim: '2026-09-10', emailFinalizacaoEm: '2026-09-11' });
    assert.equal(emailFinalizacaoPendente(c, '2026-09-18'), false);
  });

  test('NÃO para de cobrar só porque o tempo passou', () => {
    // É o coração do pedido: enquanto não for marcado, cobra todo dia.
    const c = cliente({ demandaFim: '2026-08-01' });
    for (const dia of ['2026-08-01', '2026-08-15', '2026-09-18', '2026-12-31']) {
      assert.equal(emailFinalizacaoPendente(c, dia), true, `deveria cobrar em ${dia}`);
    }
  });
});

describe('o que conta como pendência', () => {
  test('cliente limpo não entra', () => {
    assert.equal(temPendencia(pendencia()), false);
  });

  test('cada tipo sozinho já conta', () => {
    assert.equal(temPendencia(pendencia({ tarefasAtrasadas: [{ dia: '2026-09-17', titulo: 'x' }] })), true);
    assert.equal(temPendencia(pendencia({ diasSemOs: ['2026-09-17'] })), true);
    assert.equal(temPendencia(pendencia({ ordensSemAceite: [{ dia: '2026-09-16', numero: '7169595' }] })), true);
    assert.equal(temPendencia(pendencia({ emailFinalizacaoPendente: true })), true);
  });

  test('erro de consulta sozinho NÃO é pendência do cliente', () => {
    // Senão uma sessão expirada encheria o e-mail com todos os clientes da lista.
    assert.equal(temPendencia(pendencia({ erro: 'sessão expirada' })), false);
  });
});

describe('texto do resumo', () => {
  test('sem pendência, bloco vazio — o e-mail não ganha seção à toa', () => {
    assert.equal(textoPendencias([pendencia()]), '');
  });

  test('descreve o caso real da AMATOOLS', () => {
    const texto = textoPendencias([
      pendencia({
        tarefasAtrasadas: [{ dia: '2026-09-17', titulo: 'Realizar o cálculo das comissões' }],
        diasSemOs: ['2026-09-17'],
        ordensSemAceite: [{ dia: '2026-09-16', numero: '7169595' }],
      }),
    ]);

    assert.match(texto, /AMATOOLS/);
    assert.match(texto, /tarefa atrasada em 2026-09-17: Realizar o cálculo das comissões/);
    assert.match(texto, /nenhuma OS lançada: 2026-09-17/);
    assert.match(texto, /OS 7169595 de 2026-09-16 sem aceite/);
  });

  test('a pendência de e-mail aparece em destaque', () => {
    const texto = textoPendencias([pendencia({ emailFinalizacaoPendente: true })]);
    assert.match(texto, /AINDA NÃO ENVIADO/);
  });

  test('falha de consulta é dita, não escondida', () => {
    const texto = textoPendencias([pendencia({ emailFinalizacaoPendente: true, erro: 'sessão expirada' })]);
    assert.match(texto, /não consegui consultar a Experience: sessão expirada/);
  });
});
