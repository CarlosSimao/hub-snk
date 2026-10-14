/**
 * Prints da página Resumo do dia da wiki (`site/wiki/resumo-do-dia.html`).
 *
 * Agenda, OS, lembretes, notificações e versão nova vêm de rotas com dados fictícios
 * montados a partir de hoje: o capturador roda em qualquer dia, sem Sankhya, sem
 * Experience e sem GitHub. Os repositórios com pendência são os de verdade, criados pelo
 * `preparar-dados.mjs`.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Mesmo id estável do `preparar-dados.mjs`, para ligar o lembrete ao cliente e ao projeto. */
function id(apelido) {
  const h = createHash('md5').update(apelido).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function diaLocal(deslocamentoEmDias = 0) {
  const data = new Date();
  data.setDate(data.getDate() + deslocamentoEmDias);
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/** Instante ISO de hoje num horário local. */
function hojeAs(hora, minuto = 0) {
  const data = new Date();
  data.setHours(hora, minuto, 0, 0);
  return data.toISOString();
}

/** A versão seguinte à do repositório: o aviso sempre mostra uma versão "nova". */
function proximaVersao() {
  const pacote = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url)));
  const [maior, menor] = pacote.version.split('.').map(Number);
  return `${maior}.${menor + 1}.0`;
}

const PARCEIRO_COM_TAREFA = 'FAZENDA BOA VISTA AGROPECUARIA LTDA';
const PARCEIRO_SEM_TAREFA = 'INDUSTRIA ALFA DE EMBALAGENS S.A.';
const EVENTO_SEM_TAREFA = 9102;

function evento(nuevento, codparc, nomeparc, inicio, fim, allday, descricao) {
  return {
    id: nuevento,
    nuevento,
    codusu: 312,
    nomeusu: 'ANA.SOUZA',
    nomeparc,
    codparc,
    allday,
    inicio,
    fim,
    descrabrev: descricao,
    descrlonga: descricao,
    tipo: 'P',
    confirmado: 'S',
    sincronizar: 'N',
    usulancador: 'COORDENACAO',
    dhlcto: `${diaLocal(-7)} 10:00:00`,
    numetapa: null,
    nufap: null,
    nueventopai: null,
    financiallate: 'N',
    diastraso: null,
    descrcargo: 'Consultora',
    corHex: '#2f80ed',
  };
}

function eventosDeHoje() {
  const hoje = diaLocal();
  return [
    evento(
      9087,
      3301,
      'MINERACAO PEDRA ALTA LTDA',
      `${diaLocal(-1)} 00:00:00`,
      `${diaLocal(1)} 23:59:59`,
      'S',
      'Levantamento de requisitos da expedição',
    ),
    evento(
      9101,
      1520,
      PARCEIRO_COM_TAREFA,
      `${hoje} 08:00:00`,
      `${hoje} 12:00:00`,
      'N',
      'Homologação da pesagem em grupo',
    ),
    evento(
      EVENTO_SEM_TAREFA,
      2210,
      PARCEIRO_SEM_TAREFA,
      `${hoje} 13:30:00`,
      `${hoje} 17:30:00`,
      'N',
      'Treinamento do módulo fiscal',
    ),
  ];
}

/** A notificação que o alerta da agenda deixaria: é ela que põe o selo no evento. */
function notificacoes() {
  return [
    {
      id: id('n-agenda-alfa'),
      origem: 'agenda',
      tag: 'OS',
      chave: `agenda:${diaLocal()}:${EVENTO_SEM_TAREFA}`,
      titulo: 'Agenda sem tarefa na Experience',
      mensagem: `${PARCEIRO_SEM_TAREFA} (hoje, 13:30–17:30): nenhuma tarefa nem OS no dia.`,
      criadaEm: hojeAs(7, 30),
      lida: false,
      erroDoEmail: '',
    },
  ];
}

function lembrete(apelido, dados) {
  return {
    id: id(apelido),
    resumo: '',
    texto: '',
    tipo: 'unico',
    dataHora: '',
    expressaoCron: '',
    clienteId: null,
    projetoId: null,
    enviarEmail: false,
    contatoIds: [],
    ativo: true,
    ultimoDisparoEm: '',
    proximoDisparo: null,
    criadoEm: hojeAs(7),
    atualizadoEm: hojeAs(7),
    ...dados,
  };
}

function lembretes() {
  return [
    lembrete('lm-marina', {
      resumo: 'Cobrar o retorno da Marina',
      texto: 'Cobrar da Marina o retorno sobre a homologação da pesagem em grupo.',
      dataHora: hojeAs(9, 30),
      ultimoDisparoEm: hojeAs(9, 30),
      clienteId: id('c-boavista'),
      projetoId: id('p-boavista-pesagem'),
    }),
    lembrete('lm-horas', {
      resumo: 'Relatório de horas',
      texto: 'Enviar o relatório de horas da semana para a coordenação.',
      tipo: 'recorrente',
      expressaoCron: '0 17 * * 1-5',
      proximoDisparo: hojeAs(17),
    }),
    lembrete('lm-amanha', {
      resumo: 'Revisar o escopo da Indústria Alfa',
      texto: 'Revisar o escopo antes da reunião.',
      dataHora: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
      proximoDisparo: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    }),
  ];
}

function ordem(numero, tipo, empresa, deslocamentoEmDias, horas, statusAceite) {
  return {
    id: numero,
    dia: diaLocal(deslocamentoEmDias),
    descricao: tipo,
    tipo,
    numeroSankhya: String(numero),
    statusAceite,
    horasFeitas: horas,
    etapa: '',
    processos: '',
    pessoa: 'Ana Souza',
    empresa,
    statusNumeroSankhya: '',
    horasExcedidas: false,
    erro: '',
    pedido: '',
    coordenador: '',
    totalProjetoPrevisto: '',
    totalProjetoFeito: '',
    horaInicio: '08:00',
    horaFim: '12:00',
    intervalo: '',
    tarefasRealizadas: '',
  };
}

function ordensDeServico() {
  return [
    ordem(48213, 'Implantação', PARCEIRO_COM_TAREFA, -1, '08:00', ''),
    ordem(48190, 'Treinamento', PARCEIRO_SEM_TAREFA, -3, '04:00', 'Gerado'),
    ordem(48102, 'Consultoria', 'LATICINIOS SERRA AZUL LTDA', -6, '02:30', 'Concluído'),
    ordem(48077, 'Suporte', 'COOPERATIVA VALE DO CAFE', -9, '01:30', ''),
  ];
}

export async function roteiro({ painel, print }) {
  const versao = proximaVersao();
  await painel.route(/\/api\/agenda\/eventos\?/, (rota) =>
    rota.fulfill({ json: { eventos: eventosDeHoje() } }),
  );
  await painel.route(/\/api\/notificacoes$/, (rota) =>
    rota.request().method() === 'GET'
      ? rota.fulfill({ json: { notificacoes: notificacoes() } })
      : rota.continue(),
  );
  await painel.route(/\/api\/lembretes$/, (rota) =>
    rota.request().method() === 'GET'
      ? rota.fulfill({ json: { lembretes: lembretes() } })
      : rota.continue(),
  );
  await painel.route(/\/api\/os\/consultar$/, (rota) =>
    rota.fulfill({ json: { itens: ordensDeServico() } }),
  );
  await painel.route(/\/api\/sistema\/atualizacao$/, (rota) =>
    rota.fulfill({
      json: {
        versaoInstalada: '',
        ultimaVersao: versao,
        atualizacaoDisponivel: true,
        url: `https://github.com/CarlosSimao/hub-snk/releases/tag/v${versao}`,
      },
    }),
  );
  await painel.reload();
  await painel.waitForSelector('#indicador-git-global:not([hidden])');

  const secao = (titulo) =>
    painel.locator('#mount-resumo .secao-recursos', {
      has: painel.locator('h3', { hasText: titulo }),
    });
  const agenda = secao('Agenda de hoje');
  const lembretesDeHoje = secao('Lembretes de hoje');
  const os = secao('OS não concluídas');
  const repositorios = secao('Repositórios com pendência');
  const versaoNova = secao('HUB SNK');
  const voltarAoResumo = async () => {
    await painel.click('#btn-visualizacao-resumo');
    await os.locator('.linha-recurso').first().waitFor();
  };

  // Abrir e atualizar
  await voltarAoResumo();
  await repositorios.locator('.linha-recurso').first().waitFor();
  await print('abrir-01-resumo', { destacando: ['#btn-visualizacao-resumo'] });

  // Agenda de hoje
  await print('agenda-01-secao', { destacando: [agenda] });
  const tituloComCliente = agenda.locator('a.recurso-nome').first();
  await print('agenda-02-titulo', { destacando: [tituloComCliente] });
  await tituloComCliente.click();
  await painel.waitForSelector('.detalhe-abas');
  await print('agenda-03-cliente', { destacando: ['#detalhe h2'] });
  await voltarAoResumo();
  await print('agenda-04-abrir-na-agenda', {
    destacando: [agenda.locator('[aria-label="Abrir na Agenda"]').first()],
  });

  // Selo "Sem tarefa na Experience"
  await print('sem-tarefa-01-selo', { destacando: [agenda.locator('.selo-situacao.erro')] });

  // Lembretes de hoje
  await lembretesDeHoje.scrollIntoViewIfNeeded();
  await print('lembretes-01-secao', { destacando: [lembretesDeHoje] });
  const editarLembrete = lembretesDeHoje.locator('[aria-label="Editar lembrete"]').first();
  await print('lembretes-02-editar', { destacando: [editarLembrete] });
  await editarLembrete.click();
  await painel.waitForSelector('#modal-lembrete[open]');
  await print('lembretes-03-janela');
  await painel.click('#btn-cancelar-lembrete');

  // OS não concluídas
  await os.scrollIntoViewIfNeeded();
  await print('os-01-secao', { destacando: [os] });
  await print('os-02-abrir', {
    destacando: [os.locator('[aria-label="Abrir na aba OS"]').first()],
  });

  // Repositórios com pendência
  await repositorios.scrollIntoViewIfNeeded();
  await print('repositorios-01-secao', { destacando: [repositorios] });
  const abrirNoCliente = repositorios.locator('[aria-label="Abrir no cliente"]').first();
  // A aba Git do cliente, aberta pela seta, mostra o caminho local do clone, que no
  // capturador fica na pasta temporária do usuário da máquina: fica sem print.
  await print('repositorios-02-abrir', { destacando: [abrirNoCliente] });

  // Versão nova
  await versaoNova.scrollIntoViewIfNeeded();
  await print('versao-01-secao', {
    destacando: [versaoNova, versaoNova.locator('[aria-label="Ver a versão nova"]')],
  });
}
