/**
 * Prints da página Ordens de Serviço da wiki (`site/wiki/ordens-de-servico.html`).
 *
 * Na captura não há sessão da Experience: as OS vêm de rotas simuladas, com dados
 * fictícios do mês corrente e do anterior. A ordem importa: cada passo parte do estado que
 * o anterior deixou na tela.
 */
const EMPRESAS = {
  boaVista: 'FAZENDA BOA VISTA AGROPECUARIA LTDA',
  alfa: 'INDUSTRIA ALFA DE EMBALAGENS S.A.',
  serraAzul: 'LATICINIOS SERRA AZUL LTDA',
  valeDoCafe: 'COOPERATIVA VALE DO CAFE',
  ferraco: 'METALURGICA FERRACO LTDA',
};
/** Os nomes completos da Fazenda Boa Vista no `preparar-dados.mjs`: o recorte da aba do cliente. */
const NOMES_DA_BOA_VISTA = [EMPRESAS.boaVista, 'BOA VISTA SEMENTES LTDA'];

const doisDigitos = (numero) => String(numero).padStart(2, '0');
const agora = new Date();
const MES_ATUAL = `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}`;
const DIA_DE_HOJE = agora.getDate();
const ULTIMO_DIA_FIXO = 28;

/**
 * OS do mês corrente com conclusão no futuro ficaria estranha: no mês atual, os dias (1 a
 * 28) são encolhidos para caber até hoje, seja qual for o dia em que a captura roda.
 */
function diaJaPassado(mes, diaDoMes) {
  if (mes !== MES_ATUAL) return diaDoMes;
  return Math.max(1, Math.round((diaDoMes * DIA_DE_HOJE) / ULTIMO_DIA_FIXO));
}

function os(mes, diaDoMes, numero, empresa, statusAceite, inicio, fim, extras = {}) {
  const horas = fim - inicio;
  return {
    id: numero,
    dia: `${mes}-${doisDigitos(diaJaPassado(mes, diaDoMes))}`,
    descricao: '',
    tipo: 'Atendimento remoto',
    numeroSankhya: String(numero),
    statusAceite,
    horasFeitas: `${doisDigitos(horas)}:00`,
    etapa: 'Execução',
    processos: 'Parametrização',
    pessoa: 'Ana Souza',
    empresa,
    statusNumeroSankhya: '',
    horasExcedidas: false,
    erro: '',
    pedido: '',
    coordenador: 'Rafael Moreira',
    totalProjetoPrevisto: '',
    totalProjetoFeito: '',
    horaInicio: `${doisDigitos(inicio)}:00`,
    horaFim: `${doisDigitos(fim)}:00`,
    intervalo: '00:00',
    observacoes: '',
    ...extras,
  };
}

/** As OS de um mês `YYYY-MM`: o mês corrente tem a lista cheia; os outros, uma menor. */
function osDoMes(mes, ehOMesAtual) {
  if (!ehOMesAtual) {
    return [
      os(mes, 4, 57902, EMPRESAS.boaVista, 'Concluído', 8, 17),
      os(mes, 11, 57955, EMPRESAS.alfa, 'Concluído', 8, 12),
      os(mes, 18, 58011, EMPRESAS.serraAzul, 'Concluído', 8, 17),
      os(mes, 25, 58064, EMPRESAS.ferraco, 'Concluído', 13, 17),
    ];
  }
  return [
    os(mes, 2, 58177, EMPRESAS.serraAzul, 'Concluído', 8, 18, {
      tipo: 'Atendimento presencial',
      horasExcedidas: true,
      observacoes: 'Implantação do módulo fiscal na matriz.',
    }),
    os(mes, 6, 58190, EMPRESAS.boaVista, 'Concluído', 8, 17, {
      etapa: 'Homologação',
      processos: 'Pesagem',
      pedido: '4471',
      observacoes: 'Homologação da pesagem em grupo com a equipe de TI.',
    }),
    os(mes, 8, 58201, EMPRESAS.alfa, 'Gerado', 8, 12, {
      observacoes: 'Revisão das regras de faturamento.',
    }),
    os(mes, 13, 58213, EMPRESAS.boaVista, 'Concluído', 8, 12, {
      processos: 'Pesagem',
      pedido: '4471',
      observacoes: 'Ajuste no evento de pesagem em grupo.',
    }),
    os(mes, 20, 58230, EMPRESAS.valeDoCafe, 'Gerado', 8, 17, {
      tipo: 'Atendimento presencial',
      etapa: 'Treinamento',
      processos: 'Cotas de cooperados',
      observacoes: 'Treinamento de usuários, primeiro dia.',
    }),
    os(mes, 21, 58231, EMPRESAS.valeDoCafe, 'Gerado', 8, 17, {
      tipo: 'Atendimento presencial',
      etapa: 'Treinamento',
      processos: 'Cotas de cooperados',
      observacoes: 'Treinamento de usuários, segundo dia.',
    }),
    os(mes, 27, 58244, EMPRESAS.ferraco, '', 13, 17, {
      erro: 'OS sem processo vinculado na Experience.',
      processos: '',
    }),
  ];
}

function responder(rota, filtrar = () => true) {
  const { de } = rota.request().postDataJSON();
  const mes = de.slice(0, 7);
  rota.fulfill({
    json: { itens: osDoMes(mes, mes === MES_ATUAL).filter(filtrar), buscadoEm: new Date() },
  });
}

/** Mesma função sempre: o `unroute` só tira a rota registrada com a mesma referência. */
const ROTA_DAS_OS = (url) => url.pathname === '/api/os/consultar';
const ROTA_DAS_OS_DO_CLIENTE = /\/api\/clientes\/[^/]+\/os-consultar/;

export async function roteiro({ painel, print }) {
  await painel.route(ROTA_DAS_OS, (rota) => responder(rota));
  // Só a Fazenda Boa Vista é aberta no roteiro: recorta pelos nomes completos dela.
  await painel.route(ROTA_DAS_OS_DO_CLIENTE, (rota) =>
    responder(rota, (item) => NOMES_DA_BOA_VISTA.includes(item.empresa)),
  );

  const telaDeOs = (seletor) => painel.locator(`#visualizacao-os ${seletor}`);
  const esperarCarregamento = () =>
    painel.waitForSelector('.camada-carregando', { state: 'detached' });
  const agrupador = (status) => telaDeOs('.agrupador-status').filter({ hasText: status });

  // Visão geral
  await print('visao-geral-01-botao', { destacando: ['#btn-visualizacao-os'] });
  await painel.click('#btn-visualizacao-os');
  await telaDeOs('.linha-recurso').first().waitFor();
  await esperarCarregamento();
  await print('visao-geral-02-lista', { destacando: [telaDeOs('.lista-os')] });

  // Navegar entre meses
  await telaDeOs('.navegacao-calendario button').first().click();
  await esperarCarregamento();
  await print('navegar-01-mes-anterior', { destacando: [telaDeOs('.navegacao-calendario')] });
  await telaDeOs('.navegacao-calendario button').last().click();
  await esperarCarregamento();

  // Filtrar por status e somar horas
  await print('filtrar-01-agrupadores', { destacando: [telaDeOs('.barra-os')] });
  await agrupador('Gerado').click();
  await print('filtrar-02-gerado', {
    destacando: [agrupador('Gerado'), telaDeOs('.totais-os')],
  });
  await agrupador('Gerado').click();

  // Dados de uma OS
  await print('dados-01-linha', { destacando: [telaDeOs('.linha-recurso').nth(1)] });

  // Atualizar
  await print('atualizar-01-botao', {
    destacando: ['#btn-atualizar-os', '#ultima-atualizacao-os'],
  });

  // Aba OS do cliente
  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' }).click();
  await painel.waitForSelector('.detalhe-abas');
  const abaOs = painel.locator('.detalhe-abas [data-chave="os"]');
  await abaOs.click();
  await painel.locator('.detalhe .painel-aba[data-chave="os"] .linha-recurso').first().waitFor();
  await esperarCarregamento();
  await print('aba-do-cliente-01', {
    destacando: [abaOs, '.detalhe .painel-aba[data-chave="os"] .secao-agenda-geral'],
  });

  // Sem sessão da Experience: sem a simulação, o backend de verdade recusa, porque os dados
  // fictícios não têm sessão capturada.
  await painel.unroute(ROTA_DAS_OS);
  await painel.click('#btn-visualizacao-os');
  await painel.click('#btn-atualizar-os');
  await telaDeOs('.erro-formulario:not([hidden])').waitFor();
  await esperarCarregamento();
  await print('sem-sessao-01-erro', { destacando: [telaDeOs('.erro-formulario')] });
  await telaDeOs('.link-configuracao').click();
  await painel.waitForSelector('#modal-configuracao[open]');
  await print('sem-sessao-02-configuracao', {
    destacando: [painel.locator('[data-sistema="sankhya-experience"]')],
  });
  await painel.click('#btn-cancelar-configuracao');
}
