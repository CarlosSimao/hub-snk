/**
 * Prints da página Bases da wiki (`site/wiki/bases.html`). A Indústria Alfa tem uma base de
 * produção com banco vinculado e uma de teste sem banco. A situação das bases vem simulada
 * pelo próprio capturador.
 */
const CLIENTE = 'Indústria Alfa';
const URL_NOVA = 'http://alfa-hml.example:8180/mge';
const URL_PRODUCAO = 'http://alfa-prod.example:8180/mge';
const URL_TESTE = 'http://alfa-teste.example:8180/mge';

export async function roteiro({ painel, print }) {
  const linhaDaBase = (url) => painel.locator('.linha-recurso', { hasText: url });
  const botaoDaLinha = (url, rotulo) => linhaDaBase(url).locator(`[aria-label="${rotulo}"]`);
  const abaDoDetalhe = (rotulo) => painel.locator('.detalhe-abas button', { hasText: rotulo });
  const fecharAvisos = () => painel.waitForTimeout(3500);
  // Tira o foco e o mouse do último clique: sem isso, o botão sai realçado no print seguinte.
  const soltarFoco = async () => {
    await painel.mouse.move(5, 400);
    await painel.evaluate(() => document.activeElement?.blur());
  };

  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: CLIENTE }).click();
  await painel.waitForSelector('.detalhe-abas');
  await abaDoDetalhe('Bases').click();
  await painel.waitForSelector('.selo-situacao.ok');

  // Ver as bases
  await print('aba-bases-01-aba', { destacando: [abaDoDetalhe('Bases')] });
  await print('aba-bases-02-lista', { destacando: ['.detalhe .lista-recursos'] });

  // Situação, uptime e versão
  await print('situacao-01-selo', {
    destacando: [linhaDaBase(URL_PRODUCAO).locator('.situacao-banco-local')],
  });
  await botaoDaLinha(URL_PRODUCAO, 'Atualizar status agora').click();
  await print('situacao-02-atualizar', {
    destacando: [botaoDaLinha(URL_PRODUCAO, 'Atualizar status agora')],
  });

  // Ver e copiar a senha
  await print('senha-01-mostrar', { destacando: [botaoDaLinha(URL_PRODUCAO, 'Mostrar senha')] });
  await botaoDaLinha(URL_PRODUCAO, 'Mostrar senha').click();
  await print('senha-02-revelada', {
    destacando: [linhaDaBase(URL_PRODUCAO).locator('.base-credencial')],
  });
  await botaoDaLinha(URL_PRODUCAO, 'Ocultar senha').click();
  await botaoDaLinha(URL_PRODUCAO, 'Copiar senha').click();
  await painel.waitForSelector('.aviso');
  await print('senha-03-copiar', { destacando: [botaoDaLinha(URL_PRODUCAO, 'Copiar senha')] });
  await fecharAvisos();
  await soltarFoco();

  // Abrir a base: só o clique; a guia do SankhyaOm é tela de terceiros.
  await print('abrir-01-seta', { destacando: [botaoDaLinha(URL_PRODUCAO, 'Abrir em nova aba')] });

  // Cadastrar base
  const botaoAdicionar = painel.locator('.detalhe [aria-label="Adicionar base"]');
  await print('cadastrar-01-botao', { destacando: [botaoAdicionar] });
  await botaoAdicionar.click();
  await painel.fill('#campo-url', URL_NOVA);
  await painel.selectOption('#campo-tipo', 'teste');
  await painel.fill('#campo-usuario', 'SUP');
  await painel.fill('#campo-senha', 'senha-ficticia');
  await print('cadastrar-02-formulario', { destacando: ['#campo-url', '#campo-tipo'] });
  await painel.click('#btn-ver-senha');
  await print('cadastrar-03-senha', { destacando: ['#btn-ver-senha'] });
  await painel.click('#btn-salvar-base');
  await painel.waitForSelector('.aviso');
  await linhaDaBase(URL_NOVA).locator('.selo-situacao.ok').waitFor();
  await print('cadastrar-04-salva', { destacando: [linhaDaBase(URL_NOVA)] });
  await fecharAvisos();

  // Editar e excluir (a base recém-criada, para a lista voltar ao que era)
  await print('editar-01-botao', { destacando: [botaoDaLinha(URL_NOVA, 'Editar base')] });
  await botaoDaLinha(URL_NOVA, 'Editar base').click();
  await soltarFoco();
  await print('editar-02-formulario', { destacando: ['#campo-url'] });
  await painel.click('#btn-cancelar-base');
  await print('excluir-01-botao', { destacando: [botaoDaLinha(URL_NOVA, 'Excluir base')] });
  await botaoDaLinha(URL_NOVA, 'Excluir base').click();
  await print('excluir-02-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await fecharAvisos();

  // Vincular banco de dados (a base de teste, que não tem banco)
  const botaoVincular = botaoDaLinha(URL_TESTE, 'Vincular banco de dados');
  await print('banco-01-botao', { destacando: [botaoVincular] });
  await botaoVincular.click();
  await painel.fill('#campo-host', '10.0.0.16');
  await painel.fill('#campo-servico', 'ORCLHML');
  await painel.fill('#campo-usuario-banco', 'SANKHYA');
  await painel.fill('#campo-senha-banco', 'senha-ficticia');
  await soltarFoco();
  await print('banco-02-formulario', {
    destacando: ['#campo-sgbd', '#campo-identificador-oracle'],
  });
  await painel.selectOption('#campo-sgbd', 'sqlserver');
  await soltarFoco();
  await print('banco-03-sql-server', { destacando: ['#campo-porta', '#campo-servico'] });
  await painel.selectOption('#campo-sgbd', 'oracle');
  await painel.click('#btn-salvar-banco');
  await painel.waitForSelector('.aviso');
  await print('banco-04-salvo', {
    destacando: [botaoDaLinha(URL_TESTE, 'Editar banco de dados')],
  });
  await fecharAvisos();
  await botaoDaLinha(URL_TESTE, 'Editar banco de dados').click();
  await soltarFoco();
  await print('banco-05-desvincular', { destacando: ['#btn-desvincular-banco'] });
  await painel.click('#btn-desvincular-banco');
  await painel.waitForSelector('.aviso');
  await fecharAvisos();

  // Copiar os dados do banco
  await botaoDaLinha(URL_PRODUCAO, 'Editar banco de dados').click();
  const copiarHost = painel.locator('[data-copiar-campo="campo-host"]');
  await copiarHost.click();
  await painel.waitForSelector('.aviso');
  await print('copiar-01-host', { destacando: [copiarHost] });
  await painel.click('#btn-cancelar-banco');
}
