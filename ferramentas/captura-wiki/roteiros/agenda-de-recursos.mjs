/**
 * Prints da página Agenda de Recursos da wiki (`site/wiki/agenda-de-recursos.html`).
 *
 * Na captura não há login no SankhyaOm nem na Experience: a agenda, a situação no
 * Experience e o lançamento de ocorrência vêm de rotas simuladas, com eventos fictícios do
 * mês corrente. Nada é gravado no ERP. A ordem importa: cada passo parte do estado que o
 * anterior deixou na tela.
 */
import { createHash } from 'node:crypto';

/** Mesmo id estável do `preparar-dados.mjs`, para reconhecer o cliente na rota da aba. */
function id(apelido) {
  const h = createHash('md5').update(apelido).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const ID_DA_BOA_VISTA = id('c-boavista');
const CODUSU_FICTICIO = 4817;

const PARCEIROS = {
  boaVista: { codparc: 1201, nomeparc: 'FAZENDA BOA VISTA AGROPECUARIA LTDA' },
  alfa: { codparc: 1388, nomeparc: 'INDUSTRIA ALFA DE EMBALAGENS S.A.' },
  serraAzul: { codparc: 1450, nomeparc: 'LATICINIOS SERRA AZUL LTDA' },
  valeDoCafe: { codparc: 1502, nomeparc: 'COOPERATIVA VALE DO CAFE' },
  ferraco: { codparc: 1617, nomeparc: 'METALURGICA FERRACO LTDA' },
  // Razão social que não lembra o nome do cadastro: é o caso de vincular à mão.
  semVinculo: { codparc: 2214, nomeparc: 'NV DISTRIBUICAO DE ALIMENTOS LTDA' },
};

const doisDigitos = (numero) => String(numero).padStart(2, '0');
const agora = new Date();
const MES_ATUAL = `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}`;
const DIA_DE_HOJE = agora.getDate();
const dia = (numero) => `${MES_ATUAL}-${doisDigitos(numero)}`;
/** Dia fixo do mês que não cai hoje (os dias fixos vão até 27, então o seguinte existe). */
const outroDiaQueNaoHoje = (numero) => (numero === DIA_DE_HOJE ? numero + 1 : numero);

const DIA_SEM_VINCULO = outroDiaQueNaoHoje(16);

function osLancada(numeroOs, horaInicio, horaFim, tempoRealizado, tarefasRealizadas) {
  return {
    faps: [3120],
    situacao: {
      tipo: 'os-lancada',
      numeroOs,
      status: 'Concluído',
      pedido: '4471',
      tarefasRealizadas,
      horaInicio,
      horaFim,
      intervalo: '00:00',
      tempoRealizado,
    },
  };
}

/** Vira `true` quando o roteiro lança a OS do Alfa: o selo passa a mostrar a OS. */
let osDoAlfaLancada = false;

/** Situação do parceiro no dia, no formato de `/api/agenda/situacao-do-dia`. */
function situacaoNoExperience(codparc, diaIso) {
  if (codparc === PARCEIROS.boaVista.codparc) {
    return diaIso === dia(DIA_DE_HOJE)
      ? osLancada('58213', '08:00', '12:00', '04:00', 'Ajuste no evento de pesagem em grupo.')
      : osLancada(
          '58190',
          '08:00',
          '17:00',
          '09:00',
          'Homologação da pesagem em grupo com a equipe de TI.',
        );
  }
  if (codparc === PARCEIROS.alfa.codparc && osDoAlfaLancada && diaIso === dia(DIA_DE_HOJE))
    return osLancada('58240', '13:00', '18:00', '05:00', 'Treinamento do módulo de compras.');
  if (codparc === PARCEIROS.alfa.codparc)
    return { faps: [2987], situacao: { tipo: 'tarefa-aberta' } };
  if (codparc === PARCEIROS.serraAzul.codparc)
    return { faps: [3301], situacao: { tipo: 'sem-tarefa' } };
  return { faps: [], situacao: { tipo: 'sem-tarefa' } };
}

function evento(nuevento, parceiro, inicio, fim, descricao, diaTodo = false) {
  return {
    nuevento,
    codusu: CODUSU_FICTICIO,
    nomeusu: 'ANA SOUZA',
    nomeparc: parceiro?.nomeparc ?? '',
    codparc: parceiro?.codparc ?? null,
    allday: diaTodo ? 'S' : 'N',
    inicio,
    fim,
    descrabrev: descricao,
    descrlonga: descricao,
    tipo: 'A',
    confirmado: 'S',
    sincronizar: 'N',
    usulancador: 'ANA SOUZA',
    dhlcto: `${dia(1)} 09:00:00`,
    numetapa: null,
    nufap: null,
    nueventopai: null,
    financiallate: 'N',
    diastraso: null,
    id: nuevento,
    descrcargo: 'Consultora',
    corHex: '#2e7d32',
  };
}

const EVENTOS = [
  evento(
    9001,
    PARCEIROS.boaVista,
    `${dia(DIA_DE_HOJE)} 08:00:00`,
    `${dia(DIA_DE_HOJE)} 12:00:00`,
    'Pesagem em grupo',
  ),
  evento(
    9002,
    PARCEIROS.alfa,
    `${dia(DIA_DE_HOJE)} 13:00:00`,
    `${dia(DIA_DE_HOJE)} 18:00:00`,
    'Revisão do faturamento',
  ),
  evento(
    9003,
    PARCEIROS.serraAzul,
    `${dia(outroDiaQueNaoHoje(2))} 08:00:00`,
    `${dia(outroDiaQueNaoHoje(2))} 18:00:00`,
    'Implantação do módulo fiscal',
  ),
  evento(
    9004,
    PARCEIROS.boaVista,
    `${dia(outroDiaQueNaoHoje(6))} 08:00:00`,
    `${dia(outroDiaQueNaoHoje(6))} 18:00:00`,
    'Homologação da pesagem',
  ),
  evento(
    9005,
    null,
    `${dia(outroDiaQueNaoHoje(9))} 00:00:00`,
    `${dia(outroDiaQueNaoHoje(9))} 23:59:00`,
    'Folga - compensação de banco de horas',
    true,
  ),
  evento(
    9006,
    PARCEIROS.semVinculo,
    `${dia(DIA_SEM_VINCULO)} 08:00:00`,
    `${dia(DIA_SEM_VINCULO)} 18:00:00`,
    'Levantamento de requisitos',
  ),
  evento(
    9007,
    PARCEIROS.valeDoCafe,
    `${dia(21)} 08:00:00`,
    `${dia(23)} 18:00:00`,
    'Treinamento de usuários',
  ),
  evento(
    9008,
    PARCEIROS.ferraco,
    `${dia(outroDiaQueNaoHoje(27))} 08:00:00`,
    `${dia(outroDiaQueNaoHoje(27))} 18:00:00`,
    'Apoio no fechamento do mês',
  ),
];

function eventosDoPeriodo(de, ate, codparcs = null) {
  return EVENTOS.filter(
    (e) =>
      e.inicio.slice(0, 10) <= ate &&
      e.fim.slice(0, 10) >= de &&
      (!codparcs || codparcs.includes(e.codparc)),
  );
}

const MOTIVOS = [
  'Férias',
  'Treinamento',
  'Workshop',
  'Atestado Médico',
  'Exame Médico',
  'Atrasos',
  'Finalização Antecipada Agenda',
  'Saída Antecipada',
  'Folga',
  'Folga Eleitoral',
  'Day Off',
  'Compensação Bco Horas',
  'Licença Paternidade',
  'Licença Maternidade',
  'Traslado',
  'Serviços Gerais',
  'Licença Luto',
  'Licença Casamento',
  'Feriado',
].map((rotulo, indice) => ({ valor: String(indice), rotulo }));

const caminhoE = (caminho) => (url) => url.pathname === caminho;
/** Mesma função sempre: o `unroute` só tira a rota registrada com a mesma referência. */
const ROTA_DA_CONSULTA = caminhoE('/api/agenda/consultar');

/** Rotas da agenda que respondem com os dados fictícios. `consultar` fica à parte: o fim do roteiro a tira. */
async function simularAgenda(painel, estado) {
  await painel.route(caminhoE('/api/agenda/estado'), (rota) =>
    rota.fulfill({
      json: { recursos: 1, eventos: EVENTOS.length, importadoEm: estado.importadoEm },
    }),
  );
  await painel.route(caminhoE('/api/agenda/eventos'), (rota) => {
    const url = new URL(rota.request().url());
    rota.fulfill({
      json: { eventos: eventosDoPeriodo(url.searchParams.get('de'), url.searchParams.get('ate')) },
    });
  });
  await painel.route(/\/api\/clientes\/[^/]+\/agenda-eventos/, (rota) => {
    const url = new URL(rota.request().url());
    if (!url.pathname.includes(ID_DA_BOA_VISTA)) {
      rota.fulfill({ json: { eventos: [], semParceiroCasado: true } });
      return;
    }
    const eventos = eventosDoPeriodo(url.searchParams.get('de'), url.searchParams.get('ate'), [
      PARCEIROS.boaVista.codparc,
    ]);
    rota.fulfill({ json: { eventos } });
  });
  await painel.route(caminhoE('/api/agenda/situacao-do-dia'), (rota) => {
    const parametros = new URL(rota.request().url()).searchParams;
    rota.fulfill({
      json: situacaoNoExperience(Number(parametros.get('codparc')), parametros.get('dia')),
    });
  });
  await painel.route(caminhoE('/api/agenda/ocorrencias/motivos'), (rota) =>
    rota.fulfill({ json: { motivos: MOTIVOS } }),
  );
  await painel.route(caminhoE('/api/agenda/ocorrencias/usuario'), (rota) =>
    rota.fulfill({
      json: { codusu: CODUSU_FICTICIO, nomeusu: 'ANA SOUZA', codusuConfigurado: CODUSU_FICTICIO },
    }),
  );
  // Nada vai ao ERP: a resposta do lançamento é inventada aqui.
  await painel.route(caminhoE('/api/agenda/ocorrencias'), (rota) =>
    rota.fulfill({ json: { mensagem: 'Ocorrência criada.' } }),
  );
  // Nem à Experience.
  await painel.route(caminhoE('/api/agenda/lancar-os'), (rota) => {
    osDoAlfaLancada = true;
    rota.fulfill({ json: { numeroOs: '58240', avisoDoAceite: '' } });
  });
}

async function simularConsulta(painel, estado, esperaMs = 0) {
  await painel.route(ROTA_DA_CONSULTA, async (rota) => {
    if (esperaMs) await new Promise((resolver) => setTimeout(resolver, esperaMs));
    estado.importadoEm = Date.now();
    rota.fulfill({
      json: { recursos: 1, eventos: EVENTOS.length, importadoEm: estado.importadoEm },
    });
  });
}

export async function roteiro({ painel, print }) {
  // O roteiro roda uma vez por tema: a OS lançada no primeiro não pode valer no segundo.
  osDoAlfaLancada = false;
  const estado = { importadoEm: Date.now() - 20 * 60_000 };
  await simularAgenda(painel, estado);
  await simularConsulta(painel, estado);

  const agenda = (seletor) => painel.locator(`#visualizacao-agenda ${seletor}`);
  const celula = (numero) => agenda(`.celula-calendario[data-dia="${dia(numero)}"]`);
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const esperarCarregamento = () =>
    painel.waitForSelector('.camada-carregando', { state: 'detached' });
  // Tira o mouse de cima da grade: o realce do dia sob o cursor sairia no print.
  const esperarSituacoes = async () => {
    await painel.waitForFunction(
      () =>
        ![...document.querySelectorAll('.selo-situacao')].some((selo) =>
          selo.textContent.startsWith('Verificando'),
        ),
    );
    await painel.mouse.move(0, 0);
  };
  // O detalhe do dia fica abaixo da grade, fora da janela: rola até ele aparecer inteiro.
  const mostrarDetalhe = () =>
    agenda('.detalhe-dia-agenda').evaluate((detalhe) => detalhe.scrollIntoView({ block: 'end' }));
  const abrirAgenda = async () => {
    await painel.click('#btn-visualizacao-agenda');
    await agenda('.celula-calendario').first().waitFor();
    await esperarCarregamento();
    await esperarSituacoes();
  };

  // Visão geral
  await print('visao-geral-01-botao', { destacando: ['#btn-visualizacao-agenda'] });
  await abrirAgenda();
  await print('visao-geral-02-tela', { destacando: [agenda('.secao-agenda-geral')] });

  // Navegar no calendário e ver o dia
  await print('navegar-01-mes', { destacando: [agenda('.navegacao-calendario')] });
  const diaDaPesagem = outroDiaQueNaoHoje(6);
  await celula(diaDaPesagem).click();
  await esperarSituacoes();
  await mostrarDetalhe();
  await print('navegar-02-dia', {
    destacando: [celula(diaDaPesagem), agenda('.detalhe-dia-agenda')],
  });
  await celula(DIA_DE_HOJE).click();
  await esperarSituacoes();

  // Atualizar da Sankhya (a consulta simulada demora, para a camada aparecer no print)
  await print('atualizar-01-botao', {
    destacando: ['#btn-atualizar-agenda', '#ultima-atualizacao-agenda'],
  });
  await painel.unroute(ROTA_DA_CONSULTA);
  await simularConsulta(painel, estado, 4000);
  await painel.click('#btn-atualizar-agenda');
  await painel.waitForSelector('.camada-carregando');
  await print('atualizar-02-atualizando');
  await esperarCarregamento();
  await esperarSituacoes();
  await print('atualizar-03-atualizado', { destacando: ['#ultima-atualizacao-agenda'] });
  await painel.unroute(ROTA_DA_CONSULTA);
  await simularConsulta(painel, estado);

  // Situação no Experience
  await mostrarDetalhe();
  await print('situacao-01-selos', { destacando: [agenda('.detalhe-dia-agenda')] });
  await print('situacao-02-atualizar', {
    destacando: [agenda('[aria-label="Atualizar situação no Experience"]').first()],
  });

  // Abrir o cliente pelo evento
  const tituloDaBoaVista = agenda('a.recurso-nome').filter({ hasText: 'FAZENDA BOA VISTA' });
  await print('abrir-cliente-01-titulo', { destacando: [tituloDaBoaVista] });
  await tituloDaBoaVista.click();
  await painel.waitForSelector('.detalhe-abas');
  await print('abrir-cliente-02-cadastro', {
    destacando: [painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' })],
  });

  // Vincular o parceiro a um cliente
  await abrirAgenda();
  await celula(DIA_SEM_VINCULO).click();
  await esperarSituacoes();
  await mostrarDetalhe();
  const botaoDeVinculo = agenda('[aria-label^="Vincular a um cliente"]').first();
  await print('vincular-01-botao', { destacando: [botaoDeVinculo] });
  await botaoDeVinculo.click();
  await painel.waitForSelector('.painel-vinculo');
  await print('vincular-02-painel', { destacando: ['.painel-vinculo'] });
  await painel.fill('.painel-vinculo input[type="search"]', 'norte');
  const opcao = painel.locator('.painel-vinculo-opcao', { hasText: 'Distribuidora Norte Verde' });
  await print('vincular-03-buscar', { destacando: [opcao] });
  await opcao.click();
  await painel.waitForSelector('.aviso');
  await esperarSituacoes();
  await print('vincular-04-vinculado', {
    destacando: ['.aviso', agenda('[aria-label^="Vinculado a"]').first()],
  });
  await fecharAvisos();

  // Lançar ocorrência (a gravação é simulada: nada chega ao ERP)
  await celula(DIA_DE_HOJE).click();
  await esperarSituacoes();
  await print('ocorrencia-01-botao', { destacando: ['#btn-lancar-ocorrencia'] });
  await painel.click('#btn-lancar-ocorrencia');
  await painel.waitForSelector('#btn-salvar-ocorrencia:not([disabled])');
  await painel.selectOption('#campo-motivo-ocorrencia', { label: 'Folga' });
  await print('ocorrencia-02-formulario', {
    destacando: ['#usuario-ocorrencia', '#campo-motivo-ocorrencia'],
  });
  await print('ocorrencia-03-lancar', { destacando: ['#btn-salvar-ocorrencia'] });
  await painel.click('#btn-salvar-ocorrencia');
  await painel.waitForSelector('.aviso');
  await esperarCarregamento();
  await print('ocorrencia-04-lancada', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Lançar OS (a gravação é simulada: nada chega à Experience)
  await mostrarDetalhe();
  const botaoLancarOs = agenda('button').filter({ hasText: 'Lançar OS' }).first();
  await print('lancar-os-01-botao', { destacando: [botaoLancarOs] });
  await botaoLancarOs.click();
  await painel.waitForSelector('#modal-lancar-os[open]');
  await painel.fill('#campo-tarefas-os', 'Treinamento do módulo de compras.');
  await print('lancar-os-02-formulario', {
    destacando: ['#campo-inicio-os', '#campo-fim-os', '#campo-intervalo-os', '#campo-tarefas-os'],
  });
  await print('lancar-os-03-lancar', { destacando: ['#campo-aceite-os', '#btn-salvar-lancar-os'] });
  await painel.click('#btn-salvar-lancar-os');
  await painel.waitForSelector('.aviso');
  await esperarSituacoes();
  await mostrarDetalhe();
  await print('lancar-os-04-lancada', { destacando: ['.aviso', agenda('.detalhe-dia-agenda')] });
  await fecharAvisos();

  // Aba Agenda do cliente
  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' }).click();
  await painel.waitForSelector('.detalhe-abas');
  const abaAgenda = painel.locator('.detalhe-abas [data-chave="agenda"]');
  await abaAgenda.click();
  await painel.locator('.detalhe .celula-calendario').first().waitFor();
  await esperarCarregamento();
  await esperarSituacoes();
  await print('aba-do-cliente-01', { destacando: [abaAgenda, '.detalhe .secao-agenda-geral'] });

  // Erro de configuração: sem a simulação, a consulta vai ao backend de verdade, que recusa
  // sem o código de usuário (os dados fictícios não têm um).
  await painel.unroute(ROTA_DA_CONSULTA);
  await painel.click('#btn-visualizacao-agenda');
  await agenda('.erro-formulario:not([hidden])').waitFor();
  await esperarCarregamento();
  await print('avisos-01-erro', { destacando: [agenda('.erro-formulario')] });
  await agenda('.link-configuracao').click();
  await painel.waitForSelector('#modal-configuracao[open]');
  await print('avisos-02-configuracao', { destacando: ['#campo-sankhya-om-codusu'] });
  await painel.click('#btn-cancelar-configuracao');
}
