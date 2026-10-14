/**
 * Prints da página MCP e agentes de IA da wiki (`site/wiki/mcp.html`). Os kanbans, as rotas
 * simuladas e os dados fictícios vêm do roteiro do Kanban. O agente de IA externo não roda:
 * o que ele faria pelo servidor MCP é feito pelas mesmas rotas `/api/mcp/*` que o servidor
 * chama, para a tela mostrar o resultado.
 */
import {
  andarComAsTarefas,
  chamarApi,
  criarKanbanAnalisado,
  criarQuadrosDeApoio,
  semear,
  simularRotas,
} from './kanban.mjs';

export { semear };

const CLIENTE = 'Fazenda Boa Vista';
const PROJETO = 'Pesagem de rebanho';
const TAREFA_DO_AGENTE = 'Leitura do peso pela balança Coimma';

export async function roteiro({ painel, print }) {
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const cardDoProjeto = painel.locator('.card-projeto', { hasText: PROJETO });
  const linhaDoKanban = cardDoProjeto.locator('.linha-kanban');
  const botaoDaLinha = (rotulo) => linhaDoKanban.locator(`[aria-label="${rotulo}"]`);
  const cartao = (titulo) => painel.locator('#colunas-kanban .cartao-kanban', { hasText: titulo });
  const abrirConfiguracoes = async (aba) => {
    await painel.click('#btn-configuracao');
    await painel.waitForSelector('#modal-configuracao[open]');
    await painel.click(aba);
  };

  await simularRotas(painel);
  const quadros = await criarQuadrosDeApoio(painel);
  const idDaPesagem = await criarKanbanAnalisado(painel);
  await andarComAsTarefas(painel, idDaPesagem);
  await chamarApi(
    painel,
    `/api/kanban/demandas/${quadros['Integração com transportadora']}/mcp`,
    'PUT',
    {
      ligado: true,
    },
  );

  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: CLIENTE }).click();
  await painel.locator('.detalhe-abas button', { hasText: 'Projetos' }).click();
  await cardDoProjeto.locator('[aria-label="Exibir informações do projeto"]').click();
  await linhaDoKanban.waitFor();
  await linhaDoKanban.scrollIntoViewIfNeeded();

  // Liberar o kanban para os agentes
  await print('liberar-kanban-01-editar', { destacando: [botaoDaLinha('Editar o kanban')] });
  await botaoDaLinha('Editar o kanban').click();
  await painel.waitForSelector('#modal-kanban-editar[open]');
  await painel.check('#campo-kanban-editar-mcp');
  await print('liberar-kanban-02-caixa', {
    destacando: [painel.locator('label', { has: painel.locator('#campo-kanban-editar-mcp') })],
  });
  await painel.click('#btn-salvar-kanban-editar');
  const seloMcp = linhaDoKanban.getByText('MCP', { exact: true });
  await seloMcp.waitFor();
  await print('liberar-kanban-03-selo', { destacando: [seloMcp] });
  await fecharAvisos();

  // Ligar o agente: o bloco mcpServers
  await abrirConfiguracoes('#aba-configuracao-mcp');
  await print('kanban-por-mcp-01-aba', { destacando: ['#aba-configuracao-mcp'] });
  await painel.click('#grupo-kanban-mcp summary');
  await painel.locator('#configuracao-kanban-mcp', { hasText: 'mcpServers' }).waitFor();
  await print('kanban-por-mcp-02-bloco', { destacando: ['#configuracao-kanban-mcp'] });
  // A área de transferência é do sistema: a cópia é simulada.
  await painel.evaluate(() => {
    navigator.clipboard.writeText = async () => {};
  });
  await painel.click('#btn-copiar-configuracao-kanban-mcp');
  await painel.waitForSelector('.aviso');
  await print('kanban-por-mcp-03-copiar', {
    destacando: ['#btn-copiar-configuracao-kanban-mcp', '.aviso'],
  });
  await fecharAvisos();

  // Kanbans disponíveis e Tirar do MCP
  const listaMcp = painel.locator('#lista-kanbans-mcp');
  await listaMcp.scrollIntoViewIfNeeded();
  await print('kanbans-disponiveis-01-lista', { destacando: [listaMcp] });
  const linhaDaAlfa = listaMcp.locator('.linha-recurso', { hasText: 'Indústria Alfa' });
  await print('kanbans-disponiveis-02-tirar', {
    destacando: [linhaDaAlfa.getByRole('button', { name: 'Tirar do MCP' })],
  });
  await linhaDaAlfa.getByRole('button', { name: 'Tirar do MCP' }).click();
  await painel.waitForSelector('.aviso');
  await linhaDaAlfa.waitFor({ state: 'detached' });
  await print('kanbans-disponiveis-03-tirado', { destacando: [listaMcp, '.aviso'] });
  await fecharAvisos();
  await painel.click('#grupo-kanban-mcp summary');

  // sankhya-schema-mcp
  await painel.click('#grupo-sankhya-schema summary');
  await print('sankhya-schema-01-grupo', {
    destacando: ['#grupo-sankhya-schema summary', '#btn-importar-env-mcp'],
  });
  await painel.fill('#campo-caminho-schema-mcp', 'C:\\Workspace\\sankhya-schema-mcp');
  await painel.fill('#campo-config-mcp-host', '10.0.0.15');
  await painel.fill('#campo-config-mcp-port', '1521');
  await painel.fill('#campo-config-mcp-service', 'ORCL');
  await painel.fill('#campo-config-mcp-user', 'SANKHYA');
  await painel.fill('#campo-config-mcp-password', 'senha-ficticia');
  await print('sankhya-schema-02-campos', {
    destacando: ['#grupo-sankhya-schema .grupo-recolhivel-corpo'],
  });
  await painel.click('#btn-cancelar-configuracao');

  // Assistente de IA que gera as tarefas
  await abrirConfiguracoes('#aba-configuracao-ia');
  await painel.locator('#situacao-assistente-ia', { hasText: 'Usa o' }).waitFor();
  await print('assistente-de-ia-01-aba', {
    destacando: ['#aba-configuracao-ia', '#campo-assistente-ia'],
  });
  await painel.selectOption('#campo-assistente-ia', 'claude');
  await painel.selectOption('#campo-modelo-ia', 'claude-sonnet-5-5');
  await painel.selectOption('#campo-raciocinio-ia', 'high');
  await print('assistente-de-ia-02-modelo', {
    destacando: ['#campo-assistente-ia', '#campo-modelo-ia', '#campo-raciocinio-ia'],
  });
  await painel.selectOption('#campo-modelo-ia', '__outro__');
  await painel.fill('#campo-modelo-ia-outro', 'claude-sonnet-5-5-20260915');
  await print('assistente-de-ia-03-outro-modelo', { destacando: ['#bloco-modelo-ia-outro'] });
  await print('assistente-de-ia-04-procurar', {
    destacando: ['#btn-atualizar-assistentes-ia', '#situacao-assistente-ia'],
  });
  await painel.click('#btn-cancelar-configuracao');

  // O que o agente faz: as mesmas chamadas que o servidor MCP faria
  await botaoDaLinha('Abrir o quadro').click();
  await painel.waitForSelector('#modal-kanban[open] .cartao-kanban');
  await print('agente-no-kanban-01-antes', { destacando: [cartao(TAREFA_DO_AGENTE)] });
  const { tarefas } = await chamarApi(painel, '/api/kanban');
  const tarefa = tarefas.find((item) => item.titulo === TAREFA_DO_AGENTE);
  await chamarApi(painel, `/api/mcp/tarefas/${tarefa.id}/mover`, 'POST', { estado: 'em_revisao' });
  await chamarApi(painel, `/api/mcp/tarefas/${tarefa.id}/notas`, 'PUT', {
    notas:
      'Leitura pela porta COM3 pronta no branch pesagem-balanca. Peso aceito só depois de 3 leituras iguais.',
  });
  for (const [texto, feito] of [
    ['Abrir a porta serial', true],
    ['Descartar leitura instável', true],
    ['Testar com a balança do curral', false],
  ]) {
    await chamarApi(painel, `/api/mcp/tarefas/${tarefa.id}/lista`, 'POST', { texto, feito });
  }
  const atualizado = painel
    .locator('#colunas-kanban .coluna-kanban[aria-label="Em revisão"] .cartao-kanban', {
      hasText: TAREFA_DO_AGENTE,
    })
    .getByText('✓ 2/3');
  // O quadro acompanha sozinho pelo fluxo do servidor; se o aviso se perder, relê à mão.
  await atualizado.waitFor({ timeout: 8000 }).catch(() => painel.click('#btn-kanban-recarregar'));
  await atualizado.waitFor();
  await print('agente-no-kanban-02-depois', { destacando: [cartao(TAREFA_DO_AGENTE)] });
  await cartao(TAREFA_DO_AGENTE).click();
  await painel.waitForSelector('#modal-kanban-tarefa[open]');
  await painel.locator('#campo-kanban-tarefa-notas').scrollIntoViewIfNeeded();
  await print('agente-no-kanban-03-notas', {
    destacando: ['#lista-kanban-tarefa', '#campo-kanban-tarefa-notas'],
  });
  await painel.click('#btn-cancelar-kanban-tarefa');
}
