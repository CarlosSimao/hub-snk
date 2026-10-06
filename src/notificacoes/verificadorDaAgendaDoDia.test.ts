import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { SessaoExpiradaError, type SituacaoDoDia } from '../sankhya/experience.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import type { AlertaDaAgenda, ConfiguracaoGlobal, EventoAgenda } from '../tipos.ts';
import type { DadosDeNotificacao } from './centralDeNotificacoes.ts';
import { proximoDiaUtil } from './relogio.ts';
import { diasMonitorados, VerificadorDaAgendaDoDia } from './verificadorDaAgendaDoDia.ts';

const CODUSU = 4817;
const DIA = '2026-09-28';
const SEXTA = '2026-10-02';
const SEGUNDA_SEGUINTE = '2026-10-05';

function evento(campos: Partial<EventoAgenda>): EventoAgenda {
  return {
    nuevento: 1,
    codusu: CODUSU,
    nomeusu: 'USUARIO.TESTE',
    nomeparc: 'NECO TRUCK LTDA.',
    codparc: 72965,
    allday: 'N',
    inicio: `${DIA} 08:00:00`,
    fim: `${DIA} 12:00:00`,
    descrabrev: '',
    descrlonga: '',
    tipo: '',
    confirmado: '',
    sincronizar: '',
    usulancador: '',
    dhlcto: '',
    numetapa: null,
    nufap: null,
    nueventopai: null,
    financiallate: '',
    diastraso: null,
    ...campos,
  };
}

let alerta: AlertaDaAgenda;
let terceiro: boolean;
let eventos: EventoAgenda[];
let situacoes: Map<number, SituacaoDoDia | Error>;
let consultasDeSituacao: number;
let diasConsultados: string[];
let emitidas: DadosDeNotificacao[];
let agora: Date;

function criarVerificador(): VerificadorDaAgendaDoDia {
  const configuracao = {
    ler: async () =>
      ({
        alertaDaAgenda: alerta,
        sankhyaOmCodUsu: String(CODUSU),
        terceiro,
      }) as ConfiguracaoGlobal,
  } as RepositorioConfiguracao;

  return new VerificadorDaAgendaDoDia({
    configuracao,
    // Como a central: a chave repetida não vira outra notificação.
    emitir: async (dados) => {
      if (!emitidas.some((emitida) => emitida.chave === dados.chave)) emitidas.push(dados);
    },
    jaEmitida: async (chave) => emitidas.some((dados) => dados.chave === chave),
    atualizarAgendaDoDia: async () => {},
    eventosDoDia: (dia) => eventos.filter((item) => item.inicio.startsWith(dia)),
    situacaoDoDia: async (codparc, dia) => {
      consultasDeSituacao += 1;
      diasConsultados.push(dia);
      const situacao = situacoes.get(codparc) ?? { tipo: 'sem-tarefa' };
      if (situacao instanceof Error) throw situacao;
      return situacao;
    },
    agora: () => agora,
    registrador: { info: () => {}, warn: () => {} },
  });
}

beforeEach(() => {
  alerta = {
    ativo: true,
    intervaloMinutos: 120,
    incluirProximoDiaUtil: false,
    repetirAteResolver: false,
    enviarEmail: true,
  };
  terceiro = false;
  eventos = [evento({})];
  situacoes = new Map();
  consultasDeSituacao = 0;
  diasConsultados = [];
  emitidas = [];
  agora = new Date(2026, 8, 28, 7, 0);
});

describe('proximoDiaUtil', () => {
  it('é o dia seguinte de segunda a quinta', () => {
    assert.equal(proximoDiaUtil(DIA), '2026-09-29');
  });

  it('pula o fim de semana', () => {
    assert.equal(proximoDiaUtil(SEXTA), SEGUNDA_SEGUINTE);
    assert.equal(proximoDiaUtil('2026-10-03'), SEGUNDA_SEGUINTE);
    assert.equal(proximoDiaUtil('2026-10-04'), SEGUNDA_SEGUINTE);
  });

  it('vira o mês', () => {
    assert.equal(proximoDiaUtil('2026-09-30'), '2026-10-01');
  });
});

describe('diasMonitorados', () => {
  it('por padrão, só o dia atual', () => {
    assert.deepEqual(diasMonitorados(SEXTA, alerta), [SEXTA]);
  });

  it('com o próximo dia útil marcado, a sexta leva a segunda junto', () => {
    assert.deepEqual(diasMonitorados(SEXTA, { ...alerta, incluirProximoDiaUtil: true }), [
      SEXTA,
      SEGUNDA_SEGUINTE,
    ]);
  });
});

describe('VerificadorDaAgendaDoDia', () => {
  it('alerta o evento de hoje sem tarefa, mesmo antes de ele começar', async () => {
    await criarVerificador().verificar();

    assert.equal(emitidas.length, 1);
    assert.equal(emitidas[0]?.origem, 'agenda');
    assert.equal(emitidas[0]?.tag, 'OS');
    assert.equal(emitidas[0]?.enviarEmail, true);
    assert.match(emitidas[0]?.mensagem ?? '', /NECO TRUCK.*hoje, 08:00–12:00.*nenhuma tarefa/);
  });

  it('fica calado com tarefa aberta', async () => {
    situacoes.set(72965, { tipo: 'tarefa-aberta' });

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });

  it('fica calado quando a OS já foi lançada', async () => {
    situacoes.set(72965, { tipo: 'os-lancada', numeroOs: '123', pedido: '' } as SituacaoDoDia);

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });

  it('por padrão, não olha o próximo dia útil', async () => {
    eventos = [evento({ inicio: '2026-09-29 08:00:00', fim: '2026-09-29 12:00:00' })];

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
    assert.equal(consultasDeSituacao, 0);
  });

  it('na sexta, com o próximo dia útil marcado, alerta o evento da segunda', async () => {
    alerta = { ...alerta, incluirProximoDiaUtil: true };
    agora = new Date(2026, 9, 2, 9, 0);
    eventos = [
      evento({ inicio: `${SEGUNDA_SEGUINTE} 08:00:00`, fim: `${SEGUNDA_SEGUINTE} 12:00:00` }),
    ];

    await criarVerificador().verificar();

    assert.deepEqual(diasConsultados, [SEGUNDA_SEGUINTE]);
    assert.equal(emitidas.length, 1);
    assert.match(emitidas[0]?.chave ?? '', new RegExp(`^agenda:${SEGUNDA_SEGUINTE}:`));
    assert.match(emitidas[0]?.mensagem ?? '', /05\/10\/2026, 08:00–12:00/);
  });

  it('ignora evento sem parceiro e de outro usuário', async () => {
    eventos = [evento({ codparc: null }), evento({ nuevento: 2, codusu: 1 })];

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });

  it('sem repetição, não consulta de novo o evento já notificado', async () => {
    const verificador = criarVerificador();
    await verificador.verificar();
    await verificador.verificar();

    assert.equal(emitidas.length, 1);
    assert.equal(consultasDeSituacao, 1);
  });

  it('com repetição, avisa de novo a cada execução enquanto não houver tarefa', async () => {
    alerta = { ...alerta, repetirAteResolver: true };
    const verificador = criarVerificador();

    await verificador.verificar();
    agora = new Date(2026, 8, 28, 9, 0);
    await verificador.verificar();

    assert.equal(emitidas.length, 2);
    assert.match(emitidas[1]?.chave ?? '', new RegExp(`^agenda:${DIA}:1#`));
  });

  it('consulta o parceiro uma vez só para vários eventos dele', async () => {
    eventos = [
      evento({}),
      evento({ nuevento: 2, inicio: `${DIA} 07:00:00`, fim: `${DIA} 08:00:00` }),
    ];

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 2);
    assert.equal(consultasDeSituacao, 1);
  });

  it('não faz nada com o alerta desligado', async () => {
    alerta = { ...alerta, ativo: false };

    await criarVerificador().verificar();

    assert.equal(consultasDeSituacao, 0);
  });

  it('não faz nada com o acesso de terceiro, mesmo com o alerta ligado', async () => {
    terceiro = true;

    await criarVerificador().verificar();

    assert.equal(consultasDeSituacao, 0);
    assert.equal(emitidas.length, 0);
  });

  it('avisa uma vez por dia quando a sessão da Experience caiu', async () => {
    situacoes.set(72965, new SessaoExpiradaError('Sessão da Experience expirada.'));
    const verificador = criarVerificador();

    await verificador.verificar();
    await verificador.verificar();

    assert.equal(emitidas.length, 1);
    assert.equal(emitidas[0]?.origem, 'sistema');
    assert.equal(emitidas[0]?.enviarEmail, false);
  });

  it('só registra, sem notificar, quando o shell desktop não está no ar', async () => {
    situacoes.set(72965, new PonteDoDesktopIndisponivelError('Shell fora do ar.'));

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });
});
