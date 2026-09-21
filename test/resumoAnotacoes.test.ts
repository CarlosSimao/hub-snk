/**
 * Resumo diario das anotacoes marcadas.
 *
 * O que merece teste aqui e' o "quando NAO enviar": o agendador roda a cada minuto, e
 * qualquer descuido vira um e-mail por minuto a partir do horario configurado. Duas
 * guardas seguram isso — a hora e o registro de que o dia ja' foi enviado.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diaLocal, montarCorpo, paraLembrar, ResumoAnotacoes } from '../src/resumoAnotacoes.ts';
import type { Clientes } from '../src/sankhya/clientes.ts';
import type { EmailInterno } from '../src/sankhya/emailInterno.ts';
import type { Cliente } from '../src/types.ts';

function cliente(parcial: Partial<Cliente>): Cliente {
  return {
    id: 1,
    nome: 'Cliente',
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

function montar(opcoes: { ativo?: boolean; hora?: string; enviadoEm?: string; lista?: Cliente[] } = {}) {
  const enviados: { destinatario: string; assunto: string; corpo: string }[] = [];
  let enviadoEm = opcoes.enviadoEm ?? '';

  const email = {
    obterConfig: () => ({
      smtpUsuario: 'eu@empresa.com',
      resumoAnotacoes: { ativo: opcoes.ativo ?? true, hora: opcoes.hora ?? '08:00' },
    }),
    ultimoResumoEm: () => enviadoEm,
    registrarResumoEnviado: (dia: string) => {
      enviadoEm = dia;
    },
    enviarPara: (destinatario: string, mensagem: { assunto: string; corpo: string }) => {
      enviados.push({ destinatario, ...mensagem });
      return Promise.resolve();
    },
  } as unknown as EmailInterno;

  const clientes = { listar: () => opcoes.lista ?? [] } as unknown as Clientes;

  return { resumo: new ResumoAnotacoes(clientes, email), enviados, lidoEm: () => enviadoEm };
}

const MARCADO = cliente({ id: 7, nome: 'AMATOOLS', anotacoes: 'Renovar contrato', anotacoesNotificar: true });

describe('resumo — quem entra', () => {
  test('só cliente com anotação preenchida E marcada', () => {
    const lista = [
      MARCADO,
      cliente({ id: 2, anotacoes: 'tem texto mas não marcado' }),
      // Marcado sem texto não vira aviso: marca sozinha não é lembrete de nada.
      cliente({ id: 3, anotacoes: '   ', anotacoesNotificar: true }),
    ];
    assert.deepEqual(paraLembrar(lista).map((c) => c.id), [7]);
  });

  test('o corpo traz nome e anotação de cada um', () => {
    const corpo = montarCorpo([MARCADO]);
    assert.match(corpo, /AMATOOLS/);
    assert.match(corpo, /Renovar contrato/);
    assert.match(corpo, /Uma anotação/);
  });
});

describe('resumo — quando enviar', () => {
  test('não envia antes da hora', async () => {
    const { resumo, enviados } = montar({ hora: '08:00', lista: [MARCADO] });
    const r = await resumo.tentarEnviar(new Date(2026, 8, 18, 7, 59));
    assert.equal(r.enviado, false);
    assert.match(r.motivo, /ainda não deu a hora/);
    assert.equal(enviados.length, 0);
  });

  test('envia na hora, para o e-mail do SMTP', async () => {
    const { resumo, enviados } = montar({ hora: '08:00', lista: [MARCADO] });
    const r = await resumo.tentarEnviar(new Date(2026, 8, 18, 8, 0));
    assert.equal(r.enviado, true);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0]?.destinatario, 'eu@empresa.com');
  });

  test('não repete no mesmo dia — é o que evita um e-mail por minuto', async () => {
    const { resumo, enviados } = montar({ hora: '08:00', lista: [MARCADO] });
    const agora = new Date(2026, 8, 18, 8, 30);

    await resumo.tentarEnviar(agora);
    const segunda = await resumo.tentarEnviar(agora);

    assert.equal(segunda.enviado, false);
    assert.match(segunda.motivo, /já enviado hoje/);
    assert.equal(enviados.length, 1);
  });

  test('desativado não envia', async () => {
    const { resumo, enviados } = montar({ ativo: false, lista: [MARCADO] });
    const r = await resumo.tentarEnviar(new Date(2026, 8, 18, 9, 0));
    assert.equal(r.enviado, false);
    assert.equal(enviados.length, 0);
  });

  test('sem anotação marcada, marca o dia para não reavaliar a cada minuto', async () => {
    const { resumo, enviados, lidoEm } = montar({ hora: '08:00', lista: [] });
    const r = await resumo.tentarEnviar(new Date(2026, 8, 18, 8, 5));

    assert.equal(r.enviado, false);
    assert.equal(enviados.length, 0);
    assert.equal(lidoEm(), '2026-09-18');
  });

  test('forçar ignora hora, dia e o desligado — é o botão de conferência', async () => {
    const { resumo, enviados } = montar({ ativo: false, hora: '23:00', enviadoEm: '2026-09-18', lista: [MARCADO] });
    const r = await resumo.tentarEnviar(new Date(2026, 8, 18, 1, 0), true);

    assert.equal(r.enviado, true);
    assert.equal(enviados.length, 1);
  });

  test('forçar sem anotação nenhuma não marca o dia como enviado', async () => {
    // Senão testar o botão de manhã cancelaria o resumo real daquele dia.
    const { resumo, lidoEm } = montar({ lista: [] });
    await resumo.tentarEnviar(new Date(2026, 8, 18, 8, 5), true);
    assert.equal(lidoEm(), '');
  });
});

describe('resumo — dia local', () => {
  test('usa a data local, não UTC', () => {
    // 18/09 às 21h no Brasil já é 19/09 em UTC; o "hoje" do usuário é o local.
    assert.equal(diaLocal(new Date(2026, 8, 18, 21, 0)), '2026-09-18');
  });
});
