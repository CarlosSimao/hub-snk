/**
 * Prints da página Links gerais da wiki (`site/wiki/links-gerais.html`). A Fazenda Boa Vista
 * já tem dois links e, por isso, abre direto na aba Geral.
 */
const CLIENTE = 'Fazenda Boa Vista';
const NOME_NOVO = 'Manual da balança';
const NOME_EDITADO = 'Manual da balança Coimma';
const URL_NOVA = 'https://docs.boavista.example/balanca';

export async function roteiro({ painel, print }) {
  const secaoDeLinks = painel.locator('.secao-recursos', { hasText: 'Links gerais' });
  const linhaDoLink = (nome) => secaoDeLinks.locator('.linha-recurso', { hasText: nome });
  const botaoDaLinha = (nome, rotulo) => linhaDoLink(nome).locator(`[aria-label="${rotulo}"]`);
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const soltarFoco = async () => {
    await painel.mouse.move(5, 400);
    await painel.evaluate(() => document.activeElement?.blur());
  };

  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: CLIENTE }).click();
  await secaoDeLinks.waitFor();

  // Ver os links
  await print('ver-01-secao', { destacando: [secaoDeLinks] });

  // Abrir: só o clique; o site do link é tela de terceiros.
  await print('abrir-01-nome', {
    destacando: [linhaDoLink('Portal de chamados').locator('a.recurso-nome')],
  });

  // Cadastrar
  const botaoAdicionar = secaoDeLinks.locator('[aria-label="Adicionar link"]');
  await print('cadastrar-01-botao', { destacando: [botaoAdicionar] });
  await botaoAdicionar.click();
  await painel.fill('#campo-nome-link', NOME_NOVO);
  await painel.fill('#campo-url-link', URL_NOVA);
  await soltarFoco();
  await print('cadastrar-02-formulario', { destacando: ['#campo-nome-link', '#campo-url-link'] });
  await painel.click('#btn-salvar-link');
  await painel.waitForSelector('.aviso');
  await print('cadastrar-03-salvo', { destacando: [linhaDoLink(NOME_NOVO)] });
  await fecharAvisos();

  // Copiar, editar e excluir (o link recém-criado, para a lista voltar ao que era)
  await botaoDaLinha(NOME_NOVO, 'Copiar link').click();
  await painel.waitForSelector('.aviso');
  await print('copiar-01', { destacando: [botaoDaLinha(NOME_NOVO, 'Copiar link')] });
  await fecharAvisos();

  await print('editar-01-botao', { destacando: [botaoDaLinha(NOME_NOVO, 'Editar link')] });
  await botaoDaLinha(NOME_NOVO, 'Editar link').click();
  await painel.fill('#campo-nome-link', NOME_EDITADO);
  await soltarFoco();
  await print('editar-02-formulario', { destacando: ['#campo-nome-link'] });
  await painel.click('#btn-salvar-link');
  await painel.waitForSelector('.aviso');
  await fecharAvisos();

  await print('excluir-01-botao', { destacando: [botaoDaLinha(NOME_EDITADO, 'Excluir link')] });
  await botaoDaLinha(NOME_EDITADO, 'Excluir link').click();
  await print('excluir-02-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await painel.waitForSelector('.aviso');
  await fecharAvisos();
}
