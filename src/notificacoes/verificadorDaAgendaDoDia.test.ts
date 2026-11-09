import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import type { RepositorioConfiguracao } from '../repositorio/repositorioConfiguracao.ts';
import { SessaoExpiradaError, type SituacaoDoDia } from '../sankhya/experience.ts';
import { PonteDoDesktopIndisponivelError } from '../sankhya/ponteDoDesktop.ts';
import type {
  AlertaDaAgenda,
  ConfiguracaoGlobal,
  Contato,
  DecisaoDeCobranca,
  EventoAgenda,
  GestorDoSolicitante,
} from '../tipos.ts';
import type { DadosDeNotificacao } from './centralDeNotificacoes.ts';
import type { EstadoDoAlertaDaAgenda } from './estadoDoAlertaDaAgenda.ts';
import { diasEntre, diaUtilAnterior, proximoDiaUtil } from './relogio.ts';
import { diasMonitorados, VerificadorDaAgendaDoDia } from './verificadorDaAgendaDoDia.ts';

const CODUSU = 4817;
const DIA = '2026-09-28';
const SEXTA = '2026-10-02';
const SEGUNDA_SEGUINTE = '2026-10-05';
const DESTINATARIO_DO_SMTP = 'eu@empresa.com';

function contato(id: string, email: string): Contato {
  return {
    id,
    nome: `Contato ${id}`,
    telefone: '',
    email,
    cargo: '',
    clienteId: null,
    gestorId: null,
    gerente: false,
    criadoEm: '',
    atualizadoEm: '',
  };
}

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
let contatos: Contato[];
/** Código da DS -> id do contato do solicitante, `null` sem e-mail, ou o erro da consulta. */
let solicitantes: Map<number, string | null | Error>;
let dsConsultadas: number[];
let decisoes: Map<string, DecisaoDeCobranca>;
let gestorAtual: GestorDoSolicitante;
/* Compartilhado entre verificadores: é o que sobrevive a fechar e reabrir o HUB. */
let estadoGravado: EstadoDoAlertaDaAgenda;
let periodosAtualizados: string[];

function criarVerificador(): VerificadorDaAgendaDoDia {
  const configuracao = {
    ler: async () =>
      ({
        alertaDaAgenda: alerta,
        sankhyaOmCodUsu: String(CODUSU),
        terceiro,
        smtp: { destinatario: DESTINATARIO_DO_SMTP },
        nomeDoUsuario: 'Carlos',
        cargoDoUsuario: 'Consultor',
        timeDoUsuario: 'Implantação',
        emailDoUsuario: 'carlos@empresa.com',
      }) as ConfiguracaoGlobal,
  } as RepositorioConfiguracao;

  return new VerificadorDaAgendaDoDia({
    configuracao,
    // Como a central: a chave repetida não vira outra notificação.
    emitir: async (dados) => {
      if (!emitidas.some((emitida) => emitida.chave === dados.chave)) emitidas.push(dados);
    },
    jaEmitida: async (chave) => emitidas.some((dados) => dados.chave === chave),
    atualizarAgendaDoPeriodo: async (de, ate) => void periodosAtualizados.push(`${de}..${ate}`),
    eventosDoDia: (dia) => eventos.filter((item) => item.inicio.startsWith(dia)),
    decisoesDeCobranca: async () => decisoes,
    gestorDoSolicitante: async () => gestorAtual,
    situacaoDoDia: async (codparc, dia) => {
      consultasDeSituacao += 1;
      diasConsultados.push(dia);
      const situacao = situacoes.get(codparc) ?? { tipo: 'sem-tarefa' };
      if (situacao instanceof Error) throw situacao;
      return situacao;
    },
    contatos: async () => contatos,
    solicitanteComoContato: async (codigo) => {
      dsConsultadas.push(codigo);
      const solicitante = solicitantes.get(codigo) ?? null;
      if (solicitante instanceof Error) throw solicitante;
      return solicitante;
    },
    caminhoDaLogo: '/img/logo.png',
    agora: () => agora,
    registrador: { info: () => {}, warn: () => {} },
    estado: {
      ler: async () => estadoGravado,
      gravar: async (estado) => void (estadoGravado = estado),
    },
  });
}

beforeEach(() => {
  alerta = {
    ativo: true,
    intervaloHoras: 2,
    incluirProximoDiaUtil: false,
    diasUteisRetroativos: 0,
    diasParaGerencia: 0,
    repetirAteResolver: false,
    enviarEmail: true,
    contatoIdsEmCopia: [],
  };
  contatos = [];
  solicitantes = new Map();
  dsConsultadas = [];
  decisoes = new Map();
  gestorAtual = { codigoDaDs: 0, solicitante: null, gestor: null, motivo: '' };
  estadoGravado = { ultimaVerificacaoEm: '', emailsAoGestor: [] };
  periodosAtualizados = [];
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

describe('diaUtilAnterior e diasEntre', () => {
  it('a segunda volta para a sexta', () => {
    assert.equal(diaUtilAnterior(SEGUNDA_SEGUINTE), SEXTA);
    assert.equal(diaUtilAnterior('2026-10-04'), SEXTA);
  });

  it('conta os dias corridos, fim de semana e virada de mês incluídos', () => {
    assert.equal(diasEntre(SEXTA, SEGUNDA_SEGUINTE), 3);
    assert.equal(diasEntre(DIA, SEXTA), 4);
    assert.equal(diasEntre('2026-09-30', '2026-10-01'), 1);
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

  it('com dias retroativos, volta os dias úteis e inclui o fim de semana no meio', () => {
    assert.deepEqual(diasMonitorados('2026-10-06', { ...alerta, diasUteisRetroativos: 2 }), [
      SEXTA,
      '2026-10-03',
      '2026-10-04',
      SEGUNDA_SEGUINTE,
      '2026-10-06',
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

  it('sem repetição, avisa na véspera e de novo no próprio dia', async () => {
    alerta = { ...alerta, incluirProximoDiaUtil: true };
    agora = new Date(2026, 9, 2, 9, 0);
    eventos = [
      evento({ inicio: `${SEGUNDA_SEGUINTE} 08:00:00`, fim: `${SEGUNDA_SEGUINTE} 12:00:00` }),
    ];
    const verificador = criarVerificador();

    await verificador.verificar();
    agora = new Date(2026, 9, 5, 9, 0);
    await verificador.verificar();

    assert.equal(emitidas.length, 2);
    assert.match(emitidas[1]?.mensagem ?? '', /hoje, 08:00–12:00/);
  });

  it('com dias retroativos, cobra o atendimento passado sem tarefa, em dias corridos', async () => {
    alerta = { ...alerta, diasUteisRetroativos: 5 };
    agora = new Date(2026, 9, 5, 9, 0);

    await criarVerificador().verificar();

    assert.deepEqual(periodosAtualizados, [`${DIA}..${SEGUNDA_SEGUINTE}`]);
    assert.equal(emitidas.length, 1);
    assert.equal(emitidas[0]?.titulo, 'Tarefa não lançada na Experience');
    assert.match(
      emitidas[0]?.mensagem ?? '',
      /28\/09\/2026, 08:00–12:00\): nenhuma tarefa nem OS no dia, há 7 dias\./,
    );
    assert.equal(
      emitidas[0]?.email?.assunto,
      '[HUB SNK] Atenção - Tarefa não lançada na Experience (há 7 dias)',
    );
  });

  it('sem repetição, cobra o atendimento passado uma vez por dia', async () => {
    alerta = { ...alerta, diasUteisRetroativos: 5 };
    agora = new Date(2026, 8, 29, 9, 0);
    const verificador = criarVerificador();

    await verificador.verificar();
    await verificador.verificar();
    agora = new Date(2026, 8, 30, 9, 0);
    await verificador.verificar();

    assert.equal(emitidas.length, 2);
    assert.match(emitidas[0]?.mensagem ?? '', /há 1 dia\./);
  });

  it('não olha o dia que saiu da janela retroativa', async () => {
    alerta = { ...alerta, diasUteisRetroativos: 1 };
    agora = new Date(2026, 9, 2, 9, 0);

    await criarVerificador().verificar();

    assert.equal(consultasDeSituacao, 0);
    assert.equal(emitidas.length, 0);
  });

  it('não cobra o evento marcado, nem consulta a Experience por ele', async () => {
    decisoes = new Map([['1', { modo: 'nao-cobrar', gestorConfirmadoId: null }]]);

    await criarVerificador().verificar();

    assert.equal(consultasDeSituacao, 0);
    assert.equal(emitidas.length, 0);
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

  describe('cópia do e-mail', () => {
    beforeEach(() => {
      contatos = [
        contato('gp', 'gp@empresa.com'),
        contato('ana', 'ana@empresa.com'),
        contato('eu', 'EU@empresa.com'),
        contato('sem-email', ''),
      ];
      eventos = [evento({ descrlonga: 'Atendimento\n- ID 3536' })];
      solicitantes.set(3536, 'ana');
    });

    it('copia os contatos configurados e o solicitante da DS do evento', async () => {
      alerta = { ...alerta, contatoIdsEmCopia: ['gp'] };

      await criarVerificador().verificar();

      assert.deepEqual(dsConsultadas, [3536]);
      assert.deepEqual(emitidas[0]?.email?.copia, ['gp@empresa.com', 'ana@empresa.com']);
      assert.deepEqual(emitidas[0]?.contatoIdsEmCopia, ['gp', 'ana']);
      assert.equal(emitidas[0]?.avisoDaCopia, '');
    });

    it('não repete e-mail, tira o destinatário do SMTP e pula contato sem e-mail', async () => {
      alerta = { ...alerta, contatoIdsEmCopia: ['ana', 'eu', 'sem-email', 'excluido'] };

      await criarVerificador().verificar();

      assert.deepEqual(emitidas[0]?.email?.copia, ['ana@empresa.com']);
    });

    it('DS que não pôde ser consultada não segura o e-mail e fica anotada', async () => {
      alerta = { ...alerta, contatoIdsEmCopia: ['gp'] };
      solicitantes.set(3536, new Error('Sessão da Experience expirada.'));

      await criarVerificador().verificar();

      assert.deepEqual(emitidas[0]?.email?.copia, ['gp@empresa.com']);
      assert.match(emitidas[0]?.avisoDaCopia ?? '', /DS 3536.*Sessão da Experience expirada/);
    });

    it('sai no layout da cobrança, com quem cobra e a resposta para ele', async () => {
      await criarVerificador().verificar();

      const email = emitidas[0]?.email;
      assert.match(email?.assunto ?? '', /Atenção - Agenda sem tarefa/);
      assert.match(email?.texto ?? '', /Cobrado por:\nNome: Carlos\nCargo: Consultor/);
      assert.equal(email?.respostaPara, 'carlos@empresa.com');
    });

    it('sem e-mail marcado, nem consulta a DS', async () => {
      alerta = { ...alerta, enviarEmail: false, contatoIdsEmCopia: ['gp'] };

      await criarVerificador().verificar();

      assert.deepEqual(dsConsultadas, []);
      assert.equal(emitidas[0]?.email, undefined);
      assert.equal(emitidas[0]?.contatoIdsEmCopia, undefined);
    });
  });

  describe('dias para a gerência', () => {
    const SEGUNDO_DIA_UTIL = new Date(2026, 8, 30, 9, 0);

    function decidir(decisao: DecisaoDeCobranca) {
      decisoes = new Map([['1', decisao]]);
    }

    beforeEach(() => {
      alerta = { ...alerta, diasUteisRetroativos: 5, diasParaGerencia: 2 };
      eventos = [evento({ descrlonga: 'Atendimento\n- ID 3536' })];
      contatos = [contato('ana', 'ana@cliente.com'), contato('bruno', 'bruno@cliente.com')];
      solicitantes.set(3536, 'ana');
      gestorAtual = {
        codigoDaDs: 3536,
        solicitante: { id: 'ana', nome: 'Ana Souza', email: 'ana@cliente.com' },
        gestor: { id: 'bruno', nome: 'Bruno Lima', email: 'bruno@cliente.com' },
        motivo: '',
      };
      agora = SEGUNDO_DIA_UTIL;
    });

    it('antes do dia da gerência, o e-mail sai como sempre', async () => {
      agora = new Date(2026, 8, 29, 9, 0);

      await criarVerificador().verificar();

      assert.equal(emitidas[0]?.enviarEmail, true);
      assert.deepEqual(emitidas[0]?.email?.copia, ['ana@cliente.com']);
      assert.equal(emitidas[0]?.cobranca, undefined);
    });

    it('no dia da gerência, pausa o e-mail e pede a decisão', async () => {
      await criarVerificador().verificar();

      assert.equal(emitidas[0]?.enviarEmail, false);
      assert.equal(emitidas[0]?.email, undefined);
      assert.match(
        emitidas[0]?.mensagem ?? '',
        /há 2 dias\. E-mail pausado após 2 dias úteis: decida a cobrança\.$/,
      );
      assert.deepEqual(emitidas[0]?.cobranca, { identificacao: '1', dia: DIA, codigoDaDs: 3536 });
    });

    it('com o campo em 0 ou sem a janela retroativa, não pausa', async () => {
      alerta = { ...alerta, diasParaGerencia: 0 };

      await criarVerificador().verificar();

      assert.equal(emitidas[0]?.enviarEmail, true);
    });

    it('"só no HUB" notifica sem e-mail e sem pedir decisão', async () => {
      decidir({ modo: 'so-hub', gestorConfirmadoId: null });

      await criarVerificador().verificar();

      assert.equal(emitidas[0]?.enviarEmail, false);
      assert.equal(emitidas[0]?.cobranca, undefined);
      assert.doesNotMatch(emitidas[0]?.mensagem ?? '', /pausado/);
    });

    it('"sem o gestor" volta ao e-mail de antes', async () => {
      decidir({ modo: 'sem-gestor', gestorConfirmadoId: null });

      await criarVerificador().verificar();

      assert.equal(emitidas[0]?.enviarEmail, true);
      assert.deepEqual(emitidas[0]?.email?.copia, ['ana@cliente.com']);
    });

    it('"com o gestor" copia o gestor confirmado', async () => {
      decidir({ modo: 'com-gestor', gestorConfirmadoId: 'bruno' });

      await criarVerificador().verificar();

      assert.deepEqual(emitidas[0]?.email?.copia, ['ana@cliente.com', 'bruno@cliente.com']);
      assert.deepEqual(emitidas[0]?.contatoIdsEmCopia, ['ana', 'bruno']);
    });

    it('nunca copia um gestor diferente do confirmado: pede a decisão de novo', async () => {
      decidir({ modo: 'com-gestor', gestorConfirmadoId: 'carla' });

      await criarVerificador().verificar();

      assert.equal(emitidas[0]?.enviarEmail, false);
      assert.match(emitidas[0]?.mensagem ?? '', /O gestor de Ana Souza mudou: confirme de novo\.$/);
      assert.equal(emitidas[0]?.cobranca?.codigoDaDs, 3536);
    });

    it('o limite de um e-mail por dia ao gestor vale depois de reabrir o HUB', async () => {
      alerta = { ...alerta, repetirAteResolver: true };
      decidir({ modo: 'com-gestor', gestorConfirmadoId: 'bruno' });

      await criarVerificador().verificar();
      agora = new Date(2026, 8, 30, 11, 0);
      await criarVerificador().verificar();

      assert.equal(emitidas.length, 2);
      assert.equal(emitidas[1]?.enviarEmail, false);
      assert.deepEqual(estadoGravado.emailsAoGestor, ['1#2026-09-30']);
    });

    it('com repetição, o gestor recebe um e-mail por dia', async () => {
      alerta = { ...alerta, repetirAteResolver: true };
      decidir({ modo: 'com-gestor', gestorConfirmadoId: 'bruno' });
      const verificador = criarVerificador();

      await verificador.verificar();
      agora = new Date(2026, 8, 30, 11, 0);
      await verificador.verificar();

      assert.equal(emitidas.length, 2);
      assert.equal(emitidas[0]?.enviarEmail, true);
      assert.equal(emitidas[1]?.enviarEmail, false);
    });
  });

  describe('reabrir o HUB', () => {
    const ESPERA_DA_PRIMEIRA_VERIFICACAO_MS = 2 * 60_000;
    const HORA_MS = 60 * 60_000;

    async function abrirEEsperarAPrimeiraVerificacao(): Promise<VerificadorDaAgendaDoDia> {
      const verificador = criarVerificador();
      verificador.iniciar();
      mock.timers.tick(ESPERA_DA_PRIMEIRA_VERIFICACAO_MS);
      for (let volta = 0; volta < 20; volta++) await new Promise((r) => setImmediate(r));
      return verificador;
    }

    beforeEach(() => {
      alerta = { ...alerta, intervaloHoras: 4 };
      mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    });

    afterEach(() => mock.timers.reset());

    it('não verifica antes do intervalo contado da última verificação gravada', async () => {
      estadoGravado.ultimaVerificacaoEm = new Date(agora.getTime() - HORA_MS).toISOString();

      (await abrirEEsperarAPrimeiraVerificacao()).parar();

      assert.equal(consultasDeSituacao, 0);
      assert.equal(emitidas.length, 0);
    });

    it('passado o intervalo, verifica e grava a hora da verificação', async () => {
      estadoGravado.ultimaVerificacaoEm = new Date(agora.getTime() - 5 * HORA_MS).toISOString();

      (await abrirEEsperarAPrimeiraVerificacao()).parar();

      assert.equal(emitidas.length, 1);
      assert.equal(estadoGravado.ultimaVerificacaoEm, agora.toISOString());
    });
  });

  it('só registra, sem notificar, quando o shell desktop não está no ar', async () => {
    situacoes.set(72965, new PonteDoDesktopIndisponivelError('Shell fora do ar.'));

    await criarVerificador().verificar();

    assert.equal(emitidas.length, 0);
  });
});
