/**
 * Prints da página Kanban da wiki (`site/wiki/kanban.html`). A ordem importa: cada passo
 * parte do estado que o anterior deixou na tela.
 *
 * Nenhum assistente de IA é chamado: as rotas que disparam a análise do escopo são
 * interceptadas, mandam o documento ao HUB SNK sem pedir a análise, e a tela recebe a
 * situação "Analisando com a IA…" e, depois, o resultado com tarefas fictícias gravadas
 * pela API. Os kanbans também nascem pela API (o `sankhya.db` só existe com o app aberto).
 *
 * As exportações de apoio também servem ao roteiro da página MCP (`mcp.mjs`).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const AGORA = '2026-10-14T12:00:00.000Z';
const CLIENTE = 'Fazenda Boa Vista';
const PROJETO_DA_IA = 'Pesagem de rebanho';
const PROJETO_NOVO = 'Portal do produtor';
/* A pasta fictícia que a tela mostra no lugar da pasta temporária da captura. */
const WORKSPACE_FICTICIO = 'C:\\Workspace';

/** Raiz da captura, guardada no `semear`: os documentos e a pasta do arquivo de tarefas. */
let raiz = '';

export const caminhos = {
  documentoDaPesagem: () => join(raiz, 'documentos', 'Escopo - Pesagem em grupo.md'),
  documentoDoPortal: () => join(raiz, 'documentos', 'Escopo - Portal do produtor.md'),
  pastaDoPortal: () => join(raiz, 'Workspace', 'portal-do-produtor'),
  arquivoDoPortal: () =>
    join(raiz, 'Workspace', 'portal-do-produtor', 'Tarefas', 'portal-do-produtor.json'),
};

const ESCOPO_DA_PESAGEM = `# Escopo — Pesagem em grupo

Cliente: Fazenda Boa Vista
Responsável no cliente: Marina Duarte (TI)

## Objetivo
Pesar o lote inteiro de uma vez na balança de piso Coimma e guardar cada pesagem por lote,
com o peso médio por animal calculado na hora.

## Funcionalidades
1. Tabela adicional para as pesagens em grupo, ligada ao lote.
2. Tela de pesagem em grupo, com leitura automática do peso pela balança.
3. Atualização do peso médio do lote a cada pesagem confirmada.
4. Relatório de evolução de peso por lote, com filtro por período.

## Fora do escopo
Pesagem individual com leitura de brinco eletrônico.
`;

const ESCOPO_DO_PORTAL = `# Escopo — Portal do produtor

Cliente: Fazenda Boa Vista

## Objetivo
Área web para os produtores parceiros consultarem as pesagens e as notas de entrada.

## Funcionalidades
1. Login do produtor com o CPF e senha própria.
2. Consulta das pesagens por lote e período.
3. Download das notas de entrada em PDF.
`;

const RESUMO_DA_IA = `Pesagem em grupo do rebanho na Fazenda Boa Vista: o operador pesa o lote inteiro na balança Coimma, o sistema grava cada pesagem ligada ao lote e recalcula o peso médio, e um relatório mostra a evolução de peso por lote.

Pontos a esclarecer com o cliente:
- O modelo exato da balança e se ela fica ligada a um computador fixo no curral.
- Se a pesagem individual continua sendo usada junto da pesagem em grupo.`;

/** As tarefas "geradas pela IA": vão para a primeira coluna, como as de verdade. */
const TAREFAS_DA_IA = [
  {
    titulo: 'Criar a tabela AD_PESAGEMLOTE',
    tipo: 'dados',
    prioridade: 'alta',
    estimativaHoras: 4,
    grupo: 'Pesagem em grupo',
    descricao: 'Tabela adicional com lote, data, peso total, quantidade de animais e peso médio.',
    criteriosDeAceite:
      'A tabela aparece no dicionário de dados.\nCada pesagem fica ligada ao lote.',
  },
  {
    titulo: 'Tela de pesagem em grupo',
    tipo: 'frontend',
    prioridade: 'alta',
    estimativaHoras: 8,
    grupo: 'Pesagem em grupo',
    descricao: 'Tela no Construtor de Telas para escolher o lote, ler o peso e confirmar.',
    criteriosDeAceite: 'O operador confirma a pesagem sem digitar o peso.',
  },
  {
    titulo: 'Leitura do peso pela balança Coimma',
    tipo: 'integracao',
    prioridade: 'alta',
    estimativaHoras: 12,
    grupo: 'Integração com a balança',
    descricao: 'Ler o peso estável enviado pela balança pela porta serial.',
    criteriosDeAceite: 'O peso só é aceito depois de estabilizar.',
  },
  {
    titulo: 'Evento que recalcula o peso médio do lote',
    tipo: 'backend',
    prioridade: 'media',
    estimativaHoras: 6,
    grupo: 'Pesagem em grupo',
    descricao: 'Ao confirmar a pesagem, divide o peso total pela quantidade de animais do lote.',
    criteriosDeAceite: 'O peso médio do lote muda logo após a confirmação.',
  },
  {
    titulo: 'Relatório de evolução de peso por lote',
    tipo: 'relatorio',
    prioridade: 'media',
    estimativaHoras: 6,
    grupo: 'Relatórios',
    descricao: 'Relatório com o peso médio de cada pesagem do lote no período escolhido.',
    criteriosDeAceite: 'Filtra por lote e por período.',
  },
  {
    titulo: 'Homologar com a equipe da fazenda',
    tipo: 'teste',
    prioridade: 'baixa',
    estimativaHoras: 4,
    grupo: 'Homologação',
    descricao: 'Acompanhar uma pesagem real com a Marina e o operador do curral.',
    criteriosDeAceite: 'Pesagem de um lote inteiro feita sem ajuda do consultor.',
  },
];

/** Os outros quadros, para o Kanban geral e o quadro do cliente não ficarem vazios. */
const QUADROS_DE_APOIO = [
  {
    cliente: 'Indústria Alfa',
    projeto: 'Integração com transportadora',
    tarefas: [
      [
        'Enviar o pedido de coleta pela API da transportadora',
        'integracao',
        'alta',
        10,
        'concluido',
      ],
      ['Gravar o número da coleta no pedido', 'backend', 'media', 3, 'em_revisao'],
      ['Tela de acompanhamento das coletas', 'frontend', 'media', 6, 'em_andamento'],
      ['Testar com pedidos de três filiais', 'teste', 'baixa', 4, 'a_fazer'],
    ],
  },
  {
    cliente: 'Cooperativa Vale do Café',
    projeto: '',
    tarefas: [
      ['Ajustar a regra de cota por cooperado', 'backend', 'alta', 5, 'em_andamento'],
      ['Conferir o fechamento da safra', 'configuracao', 'media', 2, 'a_fazer'],
    ],
  },
  {
    cliente: '',
    projeto: '',
    tarefas: [
      ['Atualizar o modelo de proposta técnica', 'documentacao', 'media', 3, 'a_fazer'],
      ['Revisar o checklist de implantação', 'outro', 'baixa', 2, 'backlog'],
    ],
  },
];

/** Projetos que só estas páginas usam, no cadastro fictício comum. */
const PROJETOS_EXTRAS = {
  [CLIENTE]: {
    id: '3b0f6f0e-2c55-4d8e-9a71-5c2e8f1a7d10',
    nome: PROJETO_NOVO,
    anotacoes: 'Área web para os produtores parceiros.',
  },
  'Indústria Alfa': {
    id: '8d4c1b2a-6e7f-4a90-b1c2-d3e4f5a6b7c8',
    nome: 'Integração com transportadora',
    anotacoes: '',
  },
};

export function semear(pastaDeDados) {
  raiz = dirname(pastaDeDados);
  const arquivo = join(pastaDeDados, 'clientes.json');
  const dados = JSON.parse(readFileSync(arquivo, 'utf8'));
  for (const cliente of dados.clientes) {
    const projeto = PROJETOS_EXTRAS[cliente.nome];
    if (projeto) {
      cliente.projetos.push({ ...projeto, links: [], criadoEm: AGORA, atualizadoEm: AGORA });
    }
  }
  writeFileSync(arquivo, JSON.stringify(dados, null, 2));

  mkdirSync(dirname(caminhos.documentoDaPesagem()), { recursive: true });
  writeFileSync(caminhos.documentoDaPesagem(), ESCOPO_DA_PESAGEM);
  writeFileSync(caminhos.documentoDoPortal(), ESCOPO_DO_PORTAL);
  mkdirSync(caminhos.pastaDoPortal(), { recursive: true });
}

/** Chamada à API do HUB SNK pela própria guia do Painel, com a sessão dela. */
export function chamarApi(painel, caminho, metodo = 'GET', corpo) {
  return painel.evaluate(
    async ([endereco, metodoHttp, dados]) => {
      const resposta = await fetch(endereco, {
        method: metodoHttp,
        headers: dados ? { 'content-type': 'application/json' } : undefined,
        body: dados ? JSON.stringify(dados) : undefined,
      });
      if (!resposta.ok) {
        throw new Error(`${metodoHttp} ${endereco}: ${resposta.status} ${await resposta.text()}`);
      }
      return resposta.status === 204 ? null : resposta.json();
    },
    [caminho, metodo, corpo],
  );
}

/**
 * O que a tela recebe de cada kanban, por cima do que o HUB SNK respondeu: a situação da
 * análise simulada e o resultado dela. `trocarPasta` põe a pasta fictícia no lugar da
 * temporária, que tem o nome do usuário da máquina.
 */
export const sobrescritas = new Map();

function trocarPasta(texto) {
  return typeof texto === 'string'
    ? texto.split(join(raiz, 'Workspace')).join(WORKSPACE_FICTICIO)
    : texto;
}

function comoNaTela(demanda) {
  return {
    ...demanda,
    pasta: trocarPasta(demanda.pasta),
    ...(demanda.arquivo && {
      arquivo: {
        ...demanda.arquivo,
        caminho: trocarPasta(demanda.arquivo.caminho),
        erro: trocarPasta(demanda.arquivo.erro),
      },
    }),
    ...sobrescritas.get(demanda.id),
  };
}

/** Assistentes de uma máquina fictícia: a lista real roda os CLIs instalados aqui. */
const ASSISTENTES_FICTICIOS = {
  assistentes: [
    {
      id: 'claude',
      nome: 'Claude Code',
      instalado: true,
      caminho: 'C:\\Ferramentas\\claude\\claude.exe',
      modelos: [
        'claude-fable-5-1',
        'claude-opus-5-5',
        'claude-sonnet-5-5',
        'claude-haiku-4-5-20251001',
        'opus',
        'sonnet',
        'haiku',
      ],
      modeloPadrao: '',
      lePdf: true,
      raciocinio: Object.fromEntries(
        ['', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5', 'opus', 'sonnet'].map(
          (modelo) => [modelo, { niveis: ['low', 'medium', 'high', 'xhigh', 'max'], padrao: '' }],
        ),
      ),
    },
    {
      id: 'codex',
      nome: 'Codex',
      instalado: true,
      caminho: 'C:\\Ferramentas\\npm\\codex.cmd',
      modelos: ['gpt-5-codex', 'gpt-5'],
      modeloPadrao: 'gpt-5-codex',
      lePdf: false,
      raciocinio: {
        'gpt-5-codex': { niveis: ['low', 'medium', 'high'], padrao: 'medium' },
        'gpt-5': { niveis: ['minimal', 'low', 'medium', 'high'], padrao: 'medium' },
      },
    },
    ...[
      ['opencode', 'OpenCode'],
      ['gemini', 'Gemini CLI'],
      ['cursor', 'Cursor Agent'],
    ].map(([id, nome]) => ({
      id,
      nome,
      instalado: false,
      caminho: '',
      modelos: [],
      modeloPadrao: '',
      lePdf: false,
      raciocinio: {},
    })),
  ],
};

/** O bloco `mcpServers` de uma instalação fictícia: o real traz os caminhos desta máquina. */
const CONFIGURACAO_MCP_FICTICIA = (() => {
  const programa = 'C:\\Programas\\HUB SNK';
  const configuracao = {
    command: `${programa}\\HUB SNK.exe`,
    args: [`${programa}\\resources\\hub\\dist\\mcp\\servidorMcp.js`],
    env: {
      HUB_SNK_URL: 'http://127.0.0.1:4100',
      HUB_SNK_TOKEN_FILE: `${programa}\\dados\\ipc\\desktop-token.txt`,
      ELECTRON_RUN_AS_NODE: '1',
    },
  };
  return {
    nome: 'hub-snk-kanban',
    ...configuracao,
    mcpServers: { 'hub-snk-kanban': configuracao },
  };
})();

const idNaUrl = (url) => Number(/demandas\/(\d+)/.exec(url)?.[1]);

/**
 * Rotas simuladas. Pedido de análise nunca chega ao HUB SNK: o documento vai sem ela, e
 * a tela passa a ver "Analisando com a IA…" até `concluirAnalise`.
 */
export async function simularRotas(painel) {
  await painel.route('**/api/clientes/*/kanbans', async (rota) => {
    const pedido = rota.request();
    if (pedido.method() === 'POST') {
      const corpo = pedido.postDataJSON();
      const resposta = await rota.fetch({
        postData: JSON.stringify({ ...corpo, analisar: false }),
      });
      const demanda = await resposta.json();
      if (resposta.ok() && corpo.analisar) sobrescritas.set(demanda.id, { situacao: 'analisando' });
      return rota.fulfill({
        response: resposta,
        json: resposta.ok() ? comoNaTela(demanda) : demanda,
      });
    }
    const resposta = await rota.fetch();
    const dados = await resposta.json();
    return rota.fulfill({
      response: resposta,
      json: resposta.ok() ? { ...dados, demandas: dados.demandas.map(comoNaTela) } : dados,
    });
  });
  await painel.route('**/api/kanban/demandas/*/documento', async (rota) => {
    const pedido = rota.request();
    if (pedido.method() !== 'PUT') return rota.fallback();
    const corpo = pedido.postDataJSON();
    const resposta = await rota.fetch({ postData: JSON.stringify({ ...corpo, analisar: false }) });
    if (resposta.ok() && corpo.analisar) {
      sobrescritas.set(idNaUrl(pedido.url()), { situacao: 'analisando' });
    }
    return rota.fulfill({ response: resposta });
  });
  await painel.route('**/api/kanban/demandas/*/analisar', async (rota) => {
    const id = idNaUrl(rota.request().url());
    sobrescritas.set(id, { situacao: 'analisando' });
    return rota.fulfill({ status: 202, json: { id, situacao: 'analisando' } });
  });
  await painel.route('**/api/configuracao/assistentes-de-ia', (rota) =>
    rota.fulfill({ json: ASSISTENTES_FICTICIOS }),
  );
  await painel.route('**/api/mcp/configuracao', (rota) =>
    rota.fulfill({ json: CONFIGURACAO_MCP_FICTICIA }),
  );
}

export async function idDoCliente(painel, nome) {
  const clientes = await chamarApi(painel, '/api/clientes');
  return clientes.find((cliente) => cliente.nome === nome);
}

/** "A IA terminou": grava as tarefas fictícias e entrega o resumo à tela. */
export async function concluirAnalise(painel, demandaId) {
  for (const tarefa of TAREFAS_DA_IA) {
    await chamarApi(painel, `/api/kanban/demandas/${demandaId}/tarefas`, 'POST', tarefa);
  }
  sobrescritas.set(demandaId, {
    situacao: 'analisado',
    resumo: RESUMO_DA_IA,
    assistente: 'claude',
    modelo: 'claude-sonnet-5-5',
    analisadaEm: new Date().toISOString(),
  });
}

/** O kanban da Pesagem já analisado, sem passar pela tela (para a página MCP). */
export async function criarKanbanAnalisado(painel) {
  const cliente = await idDoCliente(painel, CLIENTE);
  const projeto = cliente.projetos.find((item) => item.nome === PROJETO_DA_IA);
  const demanda = await chamarApi(painel, `/api/clientes/${cliente.id}/kanbans`, 'POST', {
    projetoId: projeto.id,
    documento: {
      nome: 'Escopo - Pesagem em grupo.md',
      conteudoBase64: Buffer.from(ESCOPO_DA_PESAGEM).toString('base64'),
    },
    analisar: false,
  });
  await concluirAnalise(painel, demanda.id);
  return demanda.id;
}

/** Quadros de outros clientes e do Interno, com as tarefas já espalhadas pelas colunas. */
export async function criarQuadrosDeApoio(painel) {
  const clientes = await chamarApi(painel, '/api/clientes');
  const ids = {};
  for (const quadro of QUADROS_DE_APOIO) {
    const cliente = clientes.find((item) => item.nome === quadro.cliente);
    const projetoId = cliente?.projetos.find((item) => item.nome === quadro.projeto)?.id ?? '';
    for (const [titulo, tipo, prioridade, estimativaHoras, estado] of quadro.tarefas) {
      const tarefa = await chamarApi(painel, '/api/kanban/tarefas', 'POST', {
        clienteId: cliente?.id ?? '',
        projetoId,
        titulo,
        tipo,
        prioridade,
        estimativaHoras,
        estado,
      });
      ids[quadro.projeto || quadro.cliente || 'Interno'] = tarefa.demandaId;
    }
  }
  return ids;
}

/** As tarefas andaram desde a análise: espalha as da Pesagem pelas colunas. */
export async function andarComAsTarefas(painel, demandaId) {
  const { tarefas } = await chamarApi(painel, '/api/kanban');
  const daPesagem = tarefas.filter((tarefa) => tarefa.demandaId === demandaId);
  const destino = {
    'Criar a tabela AD_PESAGEMLOTE': 'concluido',
    'Leitura do peso pela balança Coimma': 'em_andamento',
    'Tela de pesagem em grupo': 'em_revisao',
    'Evento que recalcula o peso médio do lote': 'a_fazer',
  };
  for (const tarefa of daPesagem) {
    if (destino[tarefa.titulo]) {
      await chamarApi(painel, `/api/kanban/tarefas/${tarefa.id}/mover`, 'POST', {
        estado: destino[tarefa.titulo],
      });
    }
  }
}

export async function roteiro({ painel, print }) {
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const abaDoDetalhe = (rotulo) => painel.locator('.detalhe-abas button', { hasText: rotulo });
  const cardDoProjeto = (nome) => painel.locator('.card-projeto', { hasText: nome });
  const linhaDoProjeto = (nome) => cardDoProjeto(nome).locator('.linha-kanban');
  const botaoDaLinha = (nome, rotulo) => linhaDoProjeto(nome).locator(`[aria-label="${rotulo}"]`);
  const cartao = (titulo) => painel.locator('#colunas-kanban .cartao-kanban', { hasText: titulo });
  const coluna = (nome) => painel.locator(`#colunas-kanban .coluna-kanban[aria-label="${nome}"]`);
  const fecharQuadro = () => painel.click('#btn-fechar-kanban');

  await simularRotas(painel);
  await criarQuadrosDeApoio(painel);

  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: CLIENTE }).click();
  await abaDoDetalhe('Projetos').click();
  for (const projeto of [PROJETO_DA_IA, PROJETO_NOVO]) {
    await cardDoProjeto(projeto).locator('[aria-label="Exibir informações do projeto"]').click();
  }
  await cardDoProjeto(PROJETO_NOVO).locator('[aria-label="Novo kanban"]').waitFor();
  await cardDoProjeto(PROJETO_NOVO).scrollIntoViewIfNeeded();

  // Criar kanban
  const novoDoPortal = cardDoProjeto(PROJETO_NOVO).locator('[aria-label="Novo kanban"]');
  await print('criar-kanban-01-botao', { destacando: [novoDoPortal] });
  await novoDoPortal.click();
  await print('criar-kanban-02-como-comecar', { destacando: ['#grupo-kanban-modo'] });
  await print('criar-kanban-03-pasta', { destacando: ['#bloco-kanban-pasta'] });
  await painel.check('#campo-kanban-modo-documento');
  await painel.setInputFiles('#campo-kanban-arquivo', caminhos.documentoDoPortal());
  await print('criar-kanban-04-com-documento', {
    destacando: ['#bloco-kanban-arquivo', '#bloco-kanban-analisar'],
  });
  await painel.check('#campo-kanban-modo-vazio');
  await painel.click('#btn-salvar-kanban-novo');
  await painel.waitForSelector('#modal-kanban[open]');
  await print('criar-kanban-05-quadro-vazio', { destacando: ['#colunas-kanban'] });
  await fecharQuadro();
  await fecharAvisos();

  // Gerar tarefas com a IA (simulada)
  const novoDaPesagem = cardDoProjeto(PROJETO_DA_IA).locator('[aria-label="Novo kanban"]');
  await novoDaPesagem.click();
  await painel.check('#campo-kanban-modo-documento');
  await painel.setInputFiles('#campo-kanban-arquivo', caminhos.documentoDaPesagem());
  await print('gerar-tarefas-com-ia-01-enviar', {
    destacando: ['#bloco-kanban-analisar', '#btn-salvar-kanban-novo'],
  });
  await painel.click('#btn-salvar-kanban-novo');
  const seloDaPesagem = linhaDoProjeto(PROJETO_DA_IA).locator('.selo-situacao').first();
  await painel.waitForSelector('.aviso');
  await linhaDoProjeto(PROJETO_DA_IA).getByText('Analisando com a IA…').waitFor();
  await print('gerar-tarefas-com-ia-02-analisando', { destacando: [seloDaPesagem, '.aviso'] });
  await fecharAvisos();

  const cliente = await idDoCliente(painel, CLIENTE);
  const { demandas } = await chamarApi(painel, `/api/clientes/${cliente.id}/kanbans`);
  const idDaPesagem = demandas.find((demanda) => demanda.nome === PROJETO_DA_IA).id;
  const idDoPortal = demandas.find((demanda) => demanda.nome === PROJETO_NOVO).id;
  await concluirAnalise(painel, idDaPesagem);
  await linhaDoProjeto(PROJETO_DA_IA).getByText('Tarefas geradas').waitFor({ timeout: 15_000 });
  await print('gerar-tarefas-com-ia-03-tarefas-geradas', {
    destacando: [linhaDoProjeto(PROJETO_DA_IA)],
  });
  await botaoDaLinha(PROJETO_DA_IA, 'Abrir o quadro').click();
  await painel.waitForSelector('#modal-kanban[open] .cartao-kanban');
  await print('gerar-tarefas-com-ia-04-quadro', {
    destacando: ['#situacao-kanban', coluna('Backlog')],
  });
  await painel.click('#resumo-kanban summary');
  await print('gerar-tarefas-com-ia-05-resumo', { destacando: ['#resumo-kanban'] });
  await painel.click('#resumo-kanban summary');
  await print('gerar-tarefas-com-ia-06-analisar-de-novo', { destacando: ['#btn-kanban-analisar'] });
  await fecharQuadro();

  // Abrir o quadro: as tarefas andaram desde a análise
  await andarComAsTarefas(painel, idDaPesagem);
  await painel.waitForTimeout(800);
  await print('abrir-quadro-01-botao', {
    destacando: [botaoDaLinha(PROJETO_DA_IA, 'Abrir o quadro')],
  });
  await botaoDaLinha(PROJETO_DA_IA, 'Abrir o quadro').click();
  await painel.waitForSelector('#modal-kanban[open] .cartao-kanban');
  await print('abrir-quadro-02-progresso', {
    destacando: ['#situacao-kanban', coluna('Concluído').locator('.coluna-kanban-cabecalho')],
  });
  await print('abrir-quadro-03-recarregar', { destacando: ['#btn-kanban-recarregar'] });

  // Nova tarefa
  await print('nova-tarefa-01-botao', { destacando: ['#btn-kanban-nova-tarefa'] });
  await painel.click('#btn-kanban-nova-tarefa');
  await painel.fill('#campo-kanban-tarefa-titulo', 'Treinar os operadores do curral');
  await painel.fill(
    '#campo-kanban-tarefa-descricao',
    'Uma hora de treinamento com os dois turnos, na própria balança.',
  );
  await painel.selectOption('#campo-kanban-tarefa-tipo', 'documentacao');
  await painel.selectOption('#campo-kanban-tarefa-prioridade', 'media');
  await painel.fill('#campo-kanban-tarefa-horas', '3');
  await painel.fill('#campo-kanban-tarefa-grupo', 'Homologação');
  await print('nova-tarefa-02-formulario', {
    destacando: ['#campo-kanban-tarefa-titulo', '#campo-kanban-tarefa-estado'],
  });
  await painel.click('#btn-salvar-kanban-tarefa');
  await cartao('Treinar os operadores do curral').waitFor();
  await print('nova-tarefa-03-cartao', { destacando: [cartao('Treinar os operadores do curral')] });

  // Mover tarefa
  const movida = 'Relatório de evolução de peso por lote';
  await print('mover-tarefa-01-arrastar', { destacando: [cartao(movida)] });
  await cartao(movida).dragTo(coluna('A fazer').locator('.coluna-kanban-cartoes'));
  await coluna('A fazer').locator('.cartao-kanban', { hasText: movida }).waitFor();
  await painel.waitForTimeout(800);
  await print('mover-tarefa-02-solta', { destacando: [cartao(movida)] });

  // Editar e excluir tarefa
  await cartao('Leitura do peso pela balança Coimma').click();
  await painel.waitForSelector('#modal-kanban-tarefa[open]');
  await painel.locator('#titulo-kanban-tarefa').scrollIntoViewIfNeeded();
  await print('editar-tarefa-01-janela', {
    destacando: ['#campo-kanban-tarefa-titulo', '#campo-kanban-tarefa-estado'],
  });
  await painel.click('#btn-cancelar-kanban-tarefa');
  await cartao('Treinar os operadores do curral').click();
  await painel.click('#btn-excluir-kanban-tarefa');
  await print('editar-tarefa-02-excluir', { destacando: ['#btn-excluir-kanban-tarefa'] });
  await painel.click('#btn-excluir-kanban-tarefa');
  await painel.waitForSelector('#modal-kanban-tarefa', { state: 'hidden' });
  await fecharAvisos();

  // Lista de verificação
  await cartao('Tela de pesagem em grupo').click();
  await painel.waitForSelector('#modal-kanban-tarefa[open]');
  for (const item of ['Campos do lote e da data', 'Botão Ler peso', 'Mensagem de peso instável']) {
    await painel.fill('#campo-kanban-tarefa-novo-item', item);
    await painel.press('#campo-kanban-tarefa-novo-item', 'Enter');
  }
  await painel.locator('#lista-kanban-tarefa input[type="checkbox"]').first().check();
  await painel.locator('#campo-kanban-tarefa-novo-item').scrollIntoViewIfNeeded();
  await print('lista-de-verificacao-01-itens', {
    destacando: ['#lista-kanban-tarefa', '#campo-kanban-tarefa-novo-item'],
  });
  await painel.click('#btn-salvar-kanban-tarefa');
  await painel.waitForSelector('#modal-kanban-tarefa', { state: 'hidden' });
  await cartao('Tela de pesagem em grupo').getByText('✓ 1/3').waitFor();
  await print('lista-de-verificacao-02-cartao', {
    destacando: [cartao('Tela de pesagem em grupo').getByText('✓ 1/3')],
  });

  // Levar a tarefa para outro quadro
  await cartao('Homologar com a equipe da fazenda').click();
  await painel.waitForSelector('#modal-kanban-tarefa[open]');
  await painel.locator('#titulo-kanban-tarefa').scrollIntoViewIfNeeded();
  await print('trocar-cliente-ou-projeto-01-campos', {
    destacando: ['#campo-kanban-tarefa-cliente', '#campo-kanban-tarefa-projeto'],
  });
  await painel.click('#btn-cancelar-kanban-tarefa');
  await fecharQuadro();

  // Arquivo de tarefas: a pasta do Portal, gravada pela API (o Escolher… é tela do sistema)
  for (const titulo of ['Login do produtor', 'Consulta das pesagens por lote']) {
    await chamarApi(painel, `/api/kanban/demandas/${idDoPortal}/tarefas`, 'POST', {
      titulo,
      tipo: 'frontend',
      estimativaHoras: 6,
    });
  }
  await chamarApi(painel, `/api/kanban/demandas/${idDoPortal}`, 'PUT', {
    pasta: caminhos.pastaDoPortal(),
  });
  // Um agente que edita arquivo leva a primeira tarefa para "Em andamento".
  await painel.waitForTimeout(2000);
  const arquivoDeTarefas = JSON.parse(readFileSync(caminhos.arquivoDoPortal(), 'utf8'));
  arquivoDeTarefas.tarefas[0].estado = 'em_andamento';
  arquivoDeTarefas.tarefas[0].notas = 'Tela de login criada no branch portal-login.';
  writeFileSync(caminhos.arquivoDoPortal(), JSON.stringify(arquivoDeTarefas, null, 2));
  await painel.waitForTimeout(3500);
  await abaDoDetalhe('Kanban').click();
  await abaDoDetalhe('Projetos').click();
  await linhaDoProjeto(PROJETO_NOVO).getByText('Arquivo', { exact: true }).waitFor();
  await linhaDoProjeto(PROJETO_NOVO).scrollIntoViewIfNeeded();
  await print('arquivo-de-tarefas-01-selo', {
    destacando: [linhaDoProjeto(PROJETO_NOVO).getByText('Arquivo', { exact: true })],
  });
  await botaoDaLinha(PROJETO_NOVO, 'Editar o kanban').click();
  await painel.waitForSelector('#modal-kanban-editar[open]');
  await print('arquivo-de-tarefas-02-pasta', {
    destacando: ['#campo-kanban-editar-pasta', '#situacao-kanban-editar-arquivo'],
  });
  await painel.click('#btn-cancelar-kanban-editar');

  // Documento de escopo: no Portal, que nasceu vazio
  const inserir = botaoDaLinha(PROJETO_NOVO, 'Inserir documento para gerar as tarefas');
  await print('documento-de-escopo-01-inserir', { destacando: [inserir] });
  await inserir.click();
  await painel.setInputFiles('#campo-kanban-arquivo', caminhos.documentoDoPortal());
  await painel.uncheck('#campo-kanban-analisar');
  await print('documento-de-escopo-02-janela', {
    destacando: ['#bloco-kanban-arquivo', '#bloco-kanban-analisar'],
  });
  await painel.click('#btn-salvar-kanban-novo');
  await linhaDoProjeto(PROJETO_NOVO).getByText('Documento enviado').waitFor();
  await fecharAvisos();
  await print('documento-de-escopo-03-enviado', { destacando: [linhaDoProjeto(PROJETO_NOVO)] });
  await print('gerar-tarefas-com-ia-07-documento-parado', {
    destacando: [linhaDoProjeto(PROJETO_NOVO).getByRole('button', { name: 'Gerar tarefas' })],
  });
  await botaoDaLinha(PROJETO_NOVO, 'Ver o documento').click();
  await painel.waitForSelector('#modal-kanban-documento[open]');
  await painel.locator('#texto-kanban-documento', { hasText: 'Portal do produtor' }).waitFor();
  await print('documento-de-escopo-04-ver', { destacando: ['#texto-kanban-documento'] });
  await print('documento-de-escopo-05-baixar', { destacando: ['#link-kanban-baixar-documento'] });
  await painel.click('#btn-fechar-kanban-documento');
  await botaoDaLinha(PROJETO_NOVO, 'Editar o kanban').click();
  await painel.click('#btn-kanban-remover-documento');
  await print('documento-de-escopo-06-remover', { destacando: ['#btn-kanban-remover-documento'] });
  await painel.click('#btn-cancelar-kanban-editar');

  // Editar, vincular e excluir o kanban
  const editarDaPesagem = botaoDaLinha(PROJETO_DA_IA, 'Editar o kanban');
  await print('editar-kanban-01-botao', { destacando: [editarDaPesagem] });
  await editarDaPesagem.click();
  await painel.waitForSelector('#modal-kanban-editar[open]');
  await print('editar-kanban-02-janela', {
    destacando: ['#campo-kanban-editar-projeto', '#campo-kanban-editar-mcp'],
  });
  await painel.click('#btn-cancelar-kanban-editar');
  const excluirDoPortal = botaoDaLinha(PROJETO_NOVO, 'Excluir o kanban');
  await excluirDoPortal.click();
  await painel.waitForSelector('#modal-exclusao[open]');
  await print('editar-kanban-03-excluir', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-cancelar-exclusao');

  // Aba Kanban do cliente
  await print('aba-do-cliente-01-aba', { destacando: [abaDoDetalhe('Kanban')] });
  await abaDoDetalhe('Kanban').click();
  const secaoDoCliente = painel.locator('.detalhe .secao-kanbans:visible');
  await secaoDoCliente.locator('[aria-label="Abrir o quadro"]').waitFor();
  await print('aba-do-cliente-02-resumo', { destacando: [secaoDoCliente] });
  await secaoDoCliente.locator('[aria-label="Abrir o quadro"]').click();
  await painel.waitForSelector('#modal-kanban[open] .cartao-kanban');
  await print('aba-do-cliente-03-quadro', {
    destacando: ['#campo-kanban-demanda', painel.locator('.cartao-kanban-demanda').first()],
  });
  await fecharQuadro();
  await print('aba-do-cliente-04-sem-projeto', {
    destacando: [secaoDoCliente.locator('[aria-label="Novo kanban sem projeto"]')],
  });

  // Kanban do menu
  await print('visao-geral-01-aba', { destacando: ['#btn-visualizacao-kanban'] });
  await painel.click('#btn-visualizacao-kanban');
  await painel.waitForSelector('#colunas-kanban-geral .cartao-kanban');
  await print('visao-geral-02-quadro', {
    destacando: [
      '#situacao-kanban-geral',
      painel.locator('#colunas-kanban-geral .cartao-kanban-demanda').first(),
    ],
  });
  await painel.selectOption('#campo-kanban-geral-cliente', { label: CLIENTE });
  await print('visao-geral-03-filtros', {
    destacando: ['#campo-kanban-geral-cliente', '#campo-kanban-geral-projeto'],
  });
  await painel.selectOption('#campo-kanban-geral-cliente', { label: 'Todos os clientes' });
  await painel.click('#btn-kanban-geral-nova-tarefa');
  await painel.waitForSelector('#modal-kanban-tarefa[open]');
  await painel.locator('#titulo-kanban-tarefa').scrollIntoViewIfNeeded();
  await print('visao-geral-04-nova-tarefa', { destacando: ['#campo-kanban-tarefa-cliente'] });
  await painel.click('#btn-cancelar-kanban-tarefa');

  // Colunas e tipos (Configurações › Kanban)
  await painel.click('#btn-configuracao');
  await painel.waitForSelector('#modal-configuracao[open]');
  await painel.click('#aba-configuracao-kanban');
  const chip = (lista, nome) =>
    painel.locator(`#lista-kanban-${lista} .chip-kanban-cadastro`, { hasText: nome });
  await chip('colunas', 'Backlog').waitFor();
  await print('colunas-e-tipos-01-aba', {
    destacando: ['#aba-configuracao-kanban', '#lista-kanban-colunas'],
  });
  await painel.fill('#campo-kanban-colunas', 'Homologação');
  await painel.click('#btn-kanban-salvar-colunas');
  await chip('colunas', 'Homologação').waitFor();
  await print('colunas-e-tipos-02-nova-coluna', { destacando: [chip('colunas', 'Homologação')] });
  await chip('colunas', 'Homologação').click();
  const moverEsquerda = painel.locator(
    '#painel-configuracao-kanban [aria-label="Mover para a esquerda"]',
  );
  await print('colunas-e-tipos-03-mover', {
    destacando: [
      moverEsquerda,
      '#painel-configuracao-kanban [aria-label="Mover para a direita"]',
      '#campo-kanban-colunas',
    ],
  });
  await moverEsquerda.click();
  await painel.waitForTimeout(500);
  await chip('colunas', 'Homologação').click();
  await chip('colunas', 'Em andamento').click();
  await painel.click('#btn-kanban-excluir-colunas');
  await painel.waitForSelector('#bloqueio-kanban-colunas:not([hidden])');
  await print('colunas-e-tipos-04-em-uso', { destacando: ['#bloqueio-kanban-colunas'] });
  await painel.click('#btn-kanban-cancelar-colunas');
  await painel.fill('#campo-kanban-tipos', 'Migração');
  await painel.click('#btn-kanban-salvar-tipos');
  await chip('tipos', 'Migração').waitFor();
  await print('colunas-e-tipos-05-tipos', { destacando: ['#lista-kanban-tipos'] });
  await painel.click('#btn-cancelar-configuracao');
}
