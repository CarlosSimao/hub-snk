/**
 * Prints da página Projetos da wiki (`site/wiki/projetos.html`). A Fazenda Boa Vista tem o
 * projeto "Pesagem de rebanho"; o roteiro dá a ele um kanban vazio, criado pela própria
 * tela, para mostrar a pergunta que a exclusão faz quando o projeto tem kanban.
 */
const CLIENTE = 'Fazenda Boa Vista';
const PROJETO = 'Pesagem de rebanho';
const PROJETO_NOVO = 'Painel de vendas';
const PROJETO_RENOMEADO = 'Painel de vendas e metas';
const LINK_NOVO = 'Ficha técnica da balança';
const URL_NOVA = 'https://docs.boavista.example/balanca/ficha-tecnica';

export async function roteiro({ painel, print }) {
  const cardDoProjeto = (nome) =>
    painel.locator('.card-projeto', {
      has: painel.locator('.card-projeto-titulo', { hasText: new RegExp(`^${nome}$`) }),
    });
  const botaoDoCard = (nome, rotulo) =>
    cardDoProjeto(nome).locator('.card-projeto-cabecalho').locator(`[aria-label="${rotulo}"]`);
  const secaoDeLinks = () =>
    cardDoProjeto(PROJETO).locator('.secao-recursos', { hasText: 'Links do projeto' });
  const linhaDoLink = (nome) => secaoDeLinks().locator('.linha-recurso', { hasText: nome });
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const soltarFoco = async () => {
    await painel.mouse.move(5, 400);
    await painel.evaluate(() => document.activeElement?.blur());
  };

  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: CLIENTE }).click();
  await painel.waitForSelector('.detalhe-abas');
  const abaProjetos = painel.locator('.detalhe-abas button', { hasText: 'Projetos' });
  await abaProjetos.click();

  // Preparação, sem print: um kanban vazio no projeto, criado como o usuário criaria.
  await botaoDoCard(PROJETO, 'Exibir informações do projeto').click();
  await cardDoProjeto(PROJETO).locator('[aria-label="Novo kanban"]').click();
  await painel.click('#btn-salvar-kanban-novo');
  await painel.waitForSelector('#modal-kanban[open]');
  await painel.click('#btn-fechar-kanban');
  await botaoDoCard(PROJETO, 'Ocultar informações do projeto').click();
  await fecharAvisos();
  await soltarFoco();

  // Cadastrar
  const botaoAdicionar = painel.locator('.detalhe [aria-label="Adicionar projeto"]');
  await print('cadastrar-01-botao', { destacando: [abaProjetos, botaoAdicionar] });
  await botaoAdicionar.click();
  await painel.fill('#campo-nome-projeto', PROJETO_NOVO);
  await soltarFoco();
  await print('cadastrar-02-formulario', { destacando: ['#campo-nome-projeto'] });
  await painel.click('#btn-salvar-projeto');
  await painel.waitForSelector('.aviso');
  await print('cadastrar-03-salvo', { destacando: [cardDoProjeto(PROJETO_NOVO)] });
  await fecharAvisos();

  // Renomear
  await soltarFoco();
  await print('renomear-01-botao', { destacando: [botaoDoCard(PROJETO_NOVO, 'Editar projeto')] });
  await botaoDoCard(PROJETO_NOVO, 'Editar projeto').click();
  await painel.fill('#campo-nome-projeto', PROJETO_RENOMEADO);
  await soltarFoco();
  await print('renomear-02-formulario', { destacando: ['#campo-nome-projeto'] });
  await painel.click('#btn-salvar-projeto');
  await painel.waitForSelector('.aviso');
  await fecharAvisos();

  // Excluir projeto sem kanban (o recém-criado)
  await soltarFoco();
  await print('excluir-01-botao', {
    destacando: [botaoDoCard(PROJETO_RENOMEADO, 'Excluir projeto')],
  });
  await botaoDoCard(PROJETO_RENOMEADO, 'Excluir projeto').click();
  await print('excluir-02-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await painel.waitForSelector('.aviso');
  await fecharAvisos();

  // Exibir e ocultar
  await soltarFoco();
  const seta = botaoDoCard(PROJETO, 'Exibir informações do projeto');
  await print('expandir-01-seta', { destacando: [seta] });
  await seta.click();
  await cardDoProjeto(PROJETO).locator('.linha-recurso').first().waitFor();
  await soltarFoco();
  await print('expandir-02-aberto', { destacando: [cardDoProjeto(PROJETO)] });

  // Anotações do projeto
  const anotacoes = cardDoProjeto(PROJETO).locator('textarea');
  await anotacoes.press('End');
  await anotacoes.pressSequentially('\nCalibrar a balança antes da virada do lote.');
  await print('anotacoes-01-campo', { destacando: [anotacoes] });
  await painel.locator('.detalhe h2').first().click();
  await painel.waitForSelector('.aviso');
  await print('anotacoes-02-salvas', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Links do projeto
  const adicionarLink = secaoDeLinks().locator('[aria-label="Adicionar link"]');
  await soltarFoco();
  await print('links-01-botao', { destacando: [adicionarLink] });
  await adicionarLink.click();
  await painel.fill('#campo-nome-link', LINK_NOVO);
  await painel.fill('#campo-url-link', URL_NOVA);
  await soltarFoco();
  await print('links-02-formulario', { destacando: ['#modal-link-subtitulo'] });
  await painel.click('#btn-salvar-link');
  await painel.waitForSelector('.aviso');
  await fecharAvisos();
  await linhaDoLink(LINK_NOVO).locator('[aria-label="Copiar link"]').click();
  await painel.waitForSelector('.aviso');
  await soltarFoco();
  await print('links-03-linha', {
    destacando: [
      linhaDoLink(LINK_NOVO).locator('a.recurso-nome'),
      linhaDoLink(LINK_NOVO).locator('.recurso-acoes'),
    ],
  });
  await fecharAvisos();

  // Excluir projeto com kanban: a janela pergunta o que fazer com ele.
  await print('excluir-03-com-kanban-botao', {
    destacando: [botaoDoCard(PROJETO, 'Excluir projeto')],
  });
  await botaoDoCard(PROJETO, 'Excluir projeto').click();
  await painel.waitForSelector('#modal-kanban-exclusao-projeto[open]');
  await soltarFoco();
  await print('excluir-04-com-kanban', {
    destacando: ['#modal-kanban-exclusao-projeto fieldset'],
  });
  await painel.check('#campo-kanban-exclusao-excluir');
  await print('excluir-05-excluir-junto', {
    destacando: ['#btn-confirmar-kanban-exclusao-projeto'],
  });
  await painel.check('#campo-kanban-exclusao-manter');
  await painel.click('#btn-confirmar-kanban-exclusao-projeto');
  await painel.waitForSelector('.aviso');
  await print('excluir-06-mantido', { destacando: ['.aviso'] });
}
