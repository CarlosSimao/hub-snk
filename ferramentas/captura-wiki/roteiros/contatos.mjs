/**
 * Prints da página Contatos da wiki (`site/wiki/contatos.html`). A ordem importa: cada
 * passo parte do estado que o anterior deixou na tela.
 *
 * Os botões de WhatsApp e e-mail abrem o painel da barra de comunicação com as telas
 * fictícias de `comunicacao-ficticia.mjs`, no lugar do WhatsApp Web e do Gmail.
 */
import { servirComunicacaoFicticia } from '../comunicacao-ficticia.mjs';

const ESPERA_DO_PAINEL_MS = 10_000;

const NOVO_CONTATO = {
  nome: 'Juliana Prado',
  cargo: 'Analista de suporte',
  telefone: '(48) 99654-3321',
  email: 'juliana.prado@horizonte.example',
  cliente: 'Construtora Horizonte',
};

/** Abre o painel com o botão do contato e espera a tela fictícia do serviço carregar. */
async function abrirNoPainel(aplicativo, painel, botao, host, tela) {
  await botao.click();
  const limite = Date.now() + ESPERA_DO_PAINEL_MS;
  let pagina;
  while (!pagina) {
    if (Date.now() > limite) throw new Error(`O painel de ${host} não abriu.`);
    await painel.waitForTimeout(100);
    pagina = aplicativo
      .context()
      .pages()
      .find((p) => p.url().startsWith('https://') && new URL(p.url()).hostname === host);
  }
  await pagina.waitForSelector(tela);
  await painel.waitForTimeout(600);
}

export async function roteiro({ aplicativo, painel, print }) {
  await servirComunicacaoFicticia(aplicativo);
  const moldura = aplicativo
    .context()
    .pages()
    .find((p) => p.url().startsWith('file:') && p.url().split('?')[0].endsWith('/index.html'));
  const linhaDoContato = (nome) => painel.locator('.linha-recurso', { hasText: nome });
  const botaoDoContato = (nome, rotulo) => linhaDoContato(nome).locator(`[aria-label="${rotulo}"]`);
  const listaDoMenu = painel.locator('#mount-contatos');
  const fecharAvisos = () => painel.waitForTimeout(3500);

  // Lista de contatos (menu)
  await painel.click('#btn-visualizacao-contatos');
  await painel.waitForSelector('#mount-contatos .linha-recurso');
  await print('lista-01-aba-contatos', { destacando: ['#btn-visualizacao-contatos'] });
  await print('lista-02-lista', { destacando: ['#mount-contatos .lista-recursos'] });

  // Filtrar por nome e por cliente
  await painel.fill('#campo-filtro-nome-contato', 'mar');
  await print('filtrar-01-nome', { destacando: ['#campo-filtro-nome-contato'] });
  await painel.fill('#campo-filtro-nome-contato', '');
  await painel.selectOption('#campo-filtro-cliente-contato', { label: 'Fazenda Boa Vista' });
  await print('filtrar-02-cliente', { destacando: ['#campo-filtro-cliente-contato'] });
  await painel.selectOption('#campo-filtro-cliente-contato', { label: 'Todos os clientes' });

  // Cadastrar contato
  const botaoNovo = listaDoMenu.locator('[aria-label="Novo contato"]');
  await print('cadastrar-01-botao', { destacando: [botaoNovo] });
  await botaoNovo.click();
  await painel.fill('#campo-nome-contato', NOVO_CONTATO.nome);
  await painel.fill('#campo-cargo-contato', NOVO_CONTATO.cargo);
  await painel.fill('#campo-telefone-contato', NOVO_CONTATO.telefone);
  await painel.fill('#campo-email-contato', NOVO_CONTATO.email);
  await painel.selectOption('#campo-cliente-contato', { label: NOVO_CONTATO.cliente });
  await print('cadastrar-02-formulario', { destacando: ['#formulario-contato .modal-corpo'] });
  await painel.click('#btn-salvar-contato');
  await painel.waitForSelector('.aviso');
  await print('cadastrar-03-salvo', { destacando: [linhaDoContato(NOVO_CONTATO.nome)] });
  await fecharAvisos();

  // WhatsApp e e-mail: o botão e o painel que ele abre
  await print('whatsapp-01-botao', {
    destacando: [botaoDoContato('Marina Duarte', 'Conversar no WhatsApp')],
  });
  const botaoDoWhatsapp = botaoDoContato('Marina Duarte', 'Conversar no WhatsApp');
  await abrirNoPainel(aplicativo, painel, botaoDoWhatsapp, 'web.whatsapp.com', '#whatsapp.ativa');
  await print('whatsapp-02-conversa');
  await moldura.click('#servicos [data-servico="whatsapp"]');
  await print('email-01-botao', {
    destacando: [botaoDoContato('Marina Duarte', 'Escrever e-mail')],
  });
  const botaoDoEmail = botaoDoContato('Marina Duarte', 'Escrever e-mail');
  await abrirNoPainel(aplicativo, painel, botaoDoEmail, 'mail.google.com', '#gmail.compondo');
  await print('email-02-novo');
  await moldura.click('#servicos [data-servico="gmail"]');

  // Editar e excluir (o contato recém-criado, para a lista voltar ao que era)
  await print('editar-01-botao', {
    destacando: [botaoDoContato(NOVO_CONTATO.nome, 'Editar contato')],
  });
  await botaoDoContato(NOVO_CONTATO.nome, 'Editar contato').click();
  await painel.fill('#campo-cargo-contato', 'Coordenadora de suporte');
  await print('editar-02-formulario', { destacando: ['#campo-cargo-contato'] });
  await painel.click('#btn-cancelar-contato');
  await print('excluir-01-botao', {
    destacando: [botaoDoContato(NOVO_CONTATO.nome, 'Excluir contato')],
  });
  await botaoDoContato(NOVO_CONTATO.nome, 'Excluir contato').click();
  await print('excluir-02-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await fecharAvisos();

  // Aba Contatos do cliente
  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' }).click();
  const abaContatos = painel.locator('.detalhe-abas button', { hasText: 'Contatos' });
  await abaContatos.click();
  await painel.locator('#detalhe .linha-recurso', { hasText: 'Paulo Henrique Lima' }).waitFor();
  await print('aba-do-cliente-01-aba', { destacando: [abaContatos] });
  await painel.locator('#detalhe [aria-label="Novo contato"]').click();
  await print('aba-do-cliente-02-novo', { destacando: ['#formulario-contato .modal-corpo'] });
  await painel.click('#btn-cancelar-contato');

  // Sem cliente: excluir a Indústria Alfa deixa a Renata Campos sem cliente
  await painel.locator('.item-cliente', { hasText: 'Indústria Alfa' }).click();
  await painel.locator('.detalhe [aria-label="Excluir cliente"]').click();
  await painel.click('#btn-confirmar-exclusao');
  await fecharAvisos();
  await painel.click('#btn-visualizacao-contatos');
  await painel.selectOption('#campo-filtro-cliente-contato', { label: 'Sem cliente' });
  await painel.waitForSelector('#mount-contatos .linha-recurso');
  await print('sem-cliente-01-filtro', {
    destacando: ['#campo-filtro-cliente-contato', linhaDoContato('Renata Campos')],
  });
}
