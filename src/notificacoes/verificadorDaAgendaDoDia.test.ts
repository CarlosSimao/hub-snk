import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { SessaoExpiradaError, type SituacaoDoDia } from '../sankhya/experience.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import type { AlertaDaAgenda, ConfiguracaoGlobal, EventoAgenda } from '../tipos.ts';
import type { DadosDeNotificacao } from './centralDeNotificacoes.ts';
import { momentoDoAlerta, VerificadorDaAgendaDoDia } from './verificadorDaAgendaDoDia.ts';

const CODUSU = 4817;
const DIA = '2026-09-28';

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
    eventosDoDia: () => eventos,
    situacaoDoDia: async (codparc) => {
      consultasDeSituacao += 1;
      const situacao = situacoes.get(codparc) ?? { tipo: 'sem-tarefa' };
      if (situacao instanceof Error) throw situacao;
      return situacao;
    },
    agora: () => agora,
    registrador: { info: () => {}, warn: () => {} },
  });
}

beforeEach(() => {
  alerta = { ativo: true, toleranciaMinutos: 30, enviarEmail: true };
  terceiro = false;
  eventos = [evento({})];
  situacoes = new Map();
  consultasDeSituacao = 0;
  emitidas = [];
  agora = new Date(2026, 8, 28, 12, 30);
});

describe('momentoDoAlerta', () => {
  it('é o fim do evento mais a tolerância', () => {
    assert.equal(
      momentoDoAlerta(evento({}), DIA, 30).getTime(),
      new Date(2026, 8, 28, 12, 30).getTime(),
    );
  });

  it('usa o fim do expediente para o evento que continua amanhã', () => {
    const doisDias = evento({ fim: '2026-09-29 18:00:00' });
    assert.equal(
      momentoDoAlerta(doisDias, DIA, 0).getTime(),
      new Date(2026, 8, 28, 18, 0).getTime(),
    );
  });
});

describe('VerificadorDaAgendaDoDia', () => {
  it('alerta o evento que terminou sem OS lançada', async () => {
    situacoes.set(72965, { tipo: 'tarefa-aberta' });

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 1);
    assert.equal(emitidas[0]?.origem, 'agenda');
    assert.equal(emitidas[0]?.enviarEmail, true);
    assert.match(emitidas[0]?.mensagem ?? '', /NECO TRUCK.*08:00–12:00.*tarefa aberta/);
  });

  it('fica calado quando a OS já foi lançada', async () => {
    situacoes.set(72965, { tipo: 'os-lancada', numeroOs: '123', pedido: '' } as SituacaoDoDia);

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });

  it('espera a tolerância depois do fim do evento', async () => {
    agora = new Date(2026, 8, 28, 12, 29);

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });

  it('ignora evento sem parceiro e de outro usuário', async () => {
    eventos = [evento({ codparc: null }), evento({ nuevento: 2, codusu: 1 })];

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });

  it('não consulta de novo o evento já notificado', async () => {
    const verificador = criarVerificador();
    await verificador.verificar();
    await verificador.verificar();

    assert.equal(emitidas.length, 1);
    assert.equal(consultasDeSituacao, 1);
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
