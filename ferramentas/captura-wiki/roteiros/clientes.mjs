/**
 * Prints da página Clientes da wiki (`site/wiki/clientes.html`). A ordem importa: cada
 * passo parte do estado que o anterior deixou na tela.
 */
const NOVO_CLIENTE = 'Agropecuária Santa Clara';

export async function roteiro({ painel, print }) {
  const itemDaLista = (nome) => painel.locator('.item-cliente', { hasText: nome });
  const botaoDoCabecalho = (rotulo) => painel.locator(`.detalhe [aria-label="${rotulo}"]`);
  const fecharAvisos = () => painel.waitForTimeout(3500);

  // Lista e detalhe
  await print('lista-01-aba-clientes', { destacando: ['#btn-visualizacao-clientes'] });
  await painel.click('#btn-visualizacao-clientes');
  await print('lista-02-lista', { destacando: ['#lista-clientes'] });
  await itemDaLista('Fazenda Boa Vista').click();
  await painel.waitForSelector('.detalhe-abas');
  await print('lista-03-selecionar', { destacando: [itemDaLista('Fazenda Boa Vista')] });
  await print('lista-04-abas', { destacando: ['.detalhe-abas'] });

  // Situação do Git
  await print('git-01-bolinhas', {
    destacando: ['#lista-clientes', '#indicador-git-global'],
  });

  // Filtro por nome
  await painel.fill('#campo-busca', 'vale');
  await print('filtro-nome-01', { destacando: ['#campo-busca'] });
  await painel.fill('#campo-busca', '');

  // Filtro pela situação do Git
  await painel.click('#btn-filtros');
  await print('filtro-git-01-painel', { destacando: ['#btn-filtros'] });
  await painel.locator('#filtros-situacao button', { hasText: 'Amarelo' }).click();
  await print('filtro-git-02-amarelo', {
    destacando: [painel.locator('#filtros-situacao button', { hasText: 'Amarelo' })],
  });
  await painel.click('#btn-limpar-filtros');
  await painel.keyboard.press('Escape');

  // Cadastrar, com nomes completos
  await print('cadastrar-01-botao', { destacando: ['#btn-novo-cliente'] });
  await painel.click('#btn-novo-cliente');
  await painel.fill('#campo-nome', NOVO_CLIENTE);
  await print('cadastrar-02-nome', { destacando: ['#campo-nome'] });
  await painel.click('#btn-adicionar-nome-completo');
  await painel.locator('#lista-nomes-completos input').last().fill('AGROPECUARIA SANTA CLARA LTDA');
  await painel.click('#btn-adicionar-nome-completo');
  await painel
    .locator('#lista-nomes-completos input')
    .last()
    .fill('SANTA CLARA ARMAZENS GERAIS LTDA');
  await print('nomes-completos-01', { destacando: ['#campo-nomes-completos'] });
  await painel.click('#btn-salvar');
  await painel.waitForSelector('.aviso');
  await print('cadastrar-03-salvo', { destacando: [itemDaLista(NOVO_CLIENTE)] });
  await fecharAvisos();

  // Editar
  await print('editar-01-botao', { destacando: [botaoDoCabecalho('Editar cliente')] });
  await botaoDoCabecalho('Editar cliente').click();
  await print('editar-02-formulario', { destacando: ['#campo-nome'] });
  await painel.click('#btn-cancelar');

  // Excluir (o cliente recém-criado, para a lista voltar ao que era)
  await print('excluir-01-botao', { destacando: [botaoDoCabecalho('Excluir cliente')] });
  await botaoDoCabecalho('Excluir cliente').click();
  await print('excluir-02-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await fecharAvisos();

  // Anotações gerais
  await itemDaLista('Fazenda Boa Vista').click();
  await painel.locator('.detalhe-abas button', { hasText: 'Geral' }).click();
  await painel.waitForSelector('#campo-anotacoes');
  await print('anotacoes-01-campo', { destacando: ['#campo-anotacoes'] });
  await painel.locator('#campo-anotacoes').press('End');
  await painel
    .locator('#campo-anotacoes')
    .pressSequentially('\nRetorno da Marina previsto para sexta.');
  await painel.locator('.detalhe h2').first().click();
  await painel.waitForSelector('.aviso');
  await print('anotacoes-02-salvas', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Compartilhar bases
  const botaoCompartilhar = botaoDoCabecalho('Compartilhar informações de bases');
  await print('compartilhar-01-botao', { destacando: [botaoCompartilhar] });
  await botaoCompartilhar.click();
  await print('compartilhar-02-escolher', { destacando: ['#linhas-de-exportacao'] });
  await painel.click('#btn-copiar-exportacao');
  await print('compartilhar-03-copiar', {
    destacando: ['#btn-copiar-exportacao', '#btn-baixar-exportacao'],
  });
  await painel.click('#btn-fechar-exportacao');
  await fecharAvisos();

  // Recarregar
  const botaoRecarregar = botaoDoCabecalho('Recarregar informações do cliente');
  await botaoRecarregar.click();
  await painel.waitForSelector('.aviso');
  await print('recarregar-01', { destacando: [botaoRecarregar] });
  await fecharAvisos();

  // Atualização automática (Configurações › Geral)
  await painel.click('#btn-configuracao');
  await painel.click('#aba-configuracao-geral');
  await painel.locator('#campo-intervalo-execucao-automatica').scrollIntoViewIfNeeded();
  await print('atualizacao-01-configuracao', {
    destacando: ['#campo-intervalo-execucao-automatica', '#campo-tempo-limite'],
  });
  await painel.click('#btn-cancelar-configuracao');

  // Primeiro uso: a lista vazia sem apagar o cadastro, só respondendo vazio à tela. Com o
  // cadastro vazio, o próprio painel abre a aba Sankhya ID das Configurações.
  await painel.route('**/api/clientes', (rota) => rota.fulfill({ json: [] }));
  await painel.reload();
  await painel.waitForSelector('#modal-configuracao[open]');
  await print('primeiro-uso-01-sankhya-id');
  await painel.click('#btn-cancelar-configuracao');
  await print('primeiro-uso-02-vazio', { destacando: ['#detalhe'] });
  await painel.unroute('**/api/clientes');
}
