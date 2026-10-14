/**
 * Prints da página Importar e exportar da wiki (`site/wiki/importar-e-exportar.html`). A
 * ordem importa: cada passo parte do estado que o anterior deixou na tela.
 *
 * Nada aqui toca a máquina de quem roda: os arquivos de favoritos e de cadastros nascem
 * em memória e entram direto no campo de arquivo do assistente; o seletor de pastas do
 * sistema e a varredura de repositórios são respondidos por rota, com pastas fictícias; e
 * o "Baixar .txt" grava numa pasta temporária, não nos Downloads de verdade.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PASTA_DE_DOWNLOADS = join(
  tmpdir(),
  `hub-snk-captura-${process.env['CAPTURA_INSTANCIA'] ?? 0}`,
  'Downloads',
);

/** Arquivo `Bookmarks` do Chrome, com uma pasta de clientes e outra de ferramentas. */
function favoritosDoChrome() {
  let id = 1;
  const favorito = (name, url) => ({ id: String(id++), type: 'url', name, url });
  const pasta = (name, children) => ({ id: String(id++), type: 'folder', name, children });
  const raizes = {
    bookmark_bar: pasta('Barra de favoritos', [
      pasta('Clientes', [
        favorito('Agropecuária Santa Clara - PROD', 'http://santaclara-prod.example:8180/mge'),
        favorito('Agropecuária Santa Clara - HML', 'http://santaclara-teste.example:8180/mge'),
        favorito('Laticínios Serra Azul [T]', 'http://serraazul-teste.example:8180/mge'),
        favorito('COOPERATIVA VALE DO CAFE', 'http://valedocafe-treino.example:8180/mge'),
      ]),
      pasta('Ferramentas', [
        favorito('Portal de chamados', 'https://chamados.consultoria.example'),
        favorito('Calculadora de horas', 'javascript:void(0)'),
      ]),
    ]),
    other: pasta('Outros favoritos', []),
  };
  return { name: 'Bookmarks', mimeType: 'application/json', buffer: json({ roots: raizes }) };
}

function json(conteudo) {
  return Buffer.from(JSON.stringify(conteudo, null, 2));
}

/**
 * O `.txt` do "Exportar" de outra máquina: duas bases que já existem aqui, com outro
 * usuário (viram conflito), um cliente novo e um bloco sem URL (fica de fora).
 */
function arquivoDeCadastros() {
  const separador = '-'.repeat(60);
  const blocos = [
    [
      'Cliente: Fazenda Boa Vista',
      '',
      'Tipo de base: Produção',
      'URL: http://boavista-prod.example:8180/mge',
      'Usuário: CONSULTOR',
      'Senha: outra-senha-ficticia',
    ],
    [
      'Cliente: Fazenda Boa Vista',
      '',
      'Tipo de base: Teste',
      'URL: http://boavista-teste.example:8180/mge',
      'Usuário: CONSULTOR',
      'Senha: outra-senha-ficticia',
    ],
    [
      'Cliente: Mineração Pedra Alta',
      '',
      'Tipo de base: Produção',
      'URL: http://pedraalta-prod.example:8180/mge',
      'Usuário: SUP',
      'Senha: senha-ficticia',
    ],
    ['Cliente: Mineração Pedra Alta', '', 'Tipo de base: Teste', 'Usuário: SUP'],
  ];
  const texto = blocos.map((linhas) => linhas.join('\n')).join(`\n\n${separador}\n\n`);
  return { name: 'Cadastros HUB SNK.txt', mimeType: 'text/plain', buffer: Buffer.from(texto) };
}

const PASTA_ESCOLHIDA = 'C:\\Workspace\\clientes';

/** Resposta da varredura, no formato de `src/git/varreduraDeRepositorios.ts`. */
const REPOSITORIOS_ENCONTRADOS = [
  {
    caminho: `${PASTA_ESCOLHIDA}\\construtora-horizonte-medicoes`,
    nome: 'construtora-horizonte-medicoes',
    url: 'https://github.com/consultoria-demo/construtora-horizonte-medicoes.git',
    branch: 'main',
  },
  {
    caminho: `${PASTA_ESCOLHIDA}\\laticinios-serra-azul-relatorios`,
    nome: 'laticinios-serra-azul-relatorios',
    url: 'https://gitlab.consultoria.example/laticinios/laticinios-serra-azul-relatorios.git',
    branch: 'develop',
  },
  {
    caminho: `${PASTA_ESCOLHIDA}\\tres-irmaos-pecuaria`,
    nome: 'tres-irmaos-pecuaria',
    url: 'https://github.com/consultoria-demo/tres-irmaos-pecuaria.git',
    branch: 'main',
  },
  {
    caminho: `${PASTA_ESCOLHIDA}\\rascunhos-sql`,
    nome: 'rascunhos-sql',
    url: '',
    branch: 'main',
  },
];

export async function roteiro({ painel, aplicativo, print }) {
  const fecharAvisos = () => painel.waitForTimeout(3500);
  const opcao = (texto) => painel.locator('.opcao-de-importacao', { hasText: texto });
  const linhaDeImportacao = (indice) => painel.locator('.linha-de-importacao').nth(indice);
  const repositorio = (nome) => painel.locator('.repositorio-encontrado', { hasText: nome });

  const abrirImportacao = async (texto) => {
    await painel.locator('.acoes-da-lista button', { hasText: 'Importar' }).click();
    await opcao(texto).click();
    await painel.click('#btn-avancar-importacao');
  };

  // Seletor de pasta do sistema e varredura respondidos por rota: nada de diálogo nativo.
  await painel.route('**/api/sistema/selecionar-pasta', (rota) =>
    rota.fulfill({ json: { caminho: PASTA_ESCOLHIDA } }),
  );
  await painel.route('**/api/sistema/repositorios-locais', (rota) =>
    rota.fulfill({ json: { repositorios: REPOSITORIOS_ENCONTRADOS } }),
  );
  // Sem cadastrar caminhos que não existem: o diagnóstico do Git os pintaria de vermelho.
  await painel.route('**/api/clientes/importacao-de-repositorios', (rota) =>
    rota.fulfill({ status: 201, json: { repositoriosImportados: 3, clientesCriados: 1 } }),
  );
  mkdirSync(PASTA_DE_DOWNLOADS, { recursive: true });
  await aplicativo.evaluate(
    ({ app }, pasta) => app.setPath('downloads', pasta),
    PASTA_DE_DOWNLOADS,
  );

  // Abrir o assistente
  await painel.click('#btn-visualizacao-clientes');
  const botaoImportar = painel.locator('.acoes-da-lista button', { hasText: 'Importar' });
  await print('abrir-01-botao', { destacando: [botaoImportar] });
  await botaoImportar.click();
  await opcao('favoritos do navegador').click();
  await print('abrir-02-origem', {
    destacando: [opcao('favoritos do navegador'), '#btn-avancar-importacao'],
  });
  await painel.click('#btn-cancelar-importacao');

  // Importar favoritos
  await abrirImportacao('favoritos do navegador');
  await print('favoritos-01-arquivo', { destacando: ['#area-de-arquivo'] });
  await painel.setInputFiles('#campo-arquivo-de-favoritos', favoritosDoChrome());
  await painel.waitForSelector('#etapa-importacao-arvore:not([hidden])');
  await print('favoritos-02-arvore', { destacando: ['#arvore-de-favoritos'] });
  await painel.locator('.no-de-pasta-cabecalho', { hasText: 'Clientes' }).locator('input').check();
  await print('favoritos-03-marcar', {
    destacando: [
      painel.locator('.no-de-pasta-cabecalho', { hasText: 'Clientes' }),
      '#btn-avancar-importacao',
    ],
  });
  await painel.click('#btn-avancar-importacao');

  // Conferir as bases dos favoritos
  await painel.waitForSelector('#etapa-importacao-formulario:not([hidden])');
  await linhaDeImportacao(0).getByLabel('Usuário (opcional)').fill('SUP');
  await print('conferir-01-linhas', {
    destacando: [
      linhaDeImportacao(0).getByLabel('Nome do cliente'),
      linhaDeImportacao(0).getByLabel('Tipo de base'),
    ],
  });
  await linhaDeImportacao(3).scrollIntoViewIfNeeded();
  await print('conferir-02-erro', { destacando: [linhaDeImportacao(3)] });
  await linhaDeImportacao(3).getByLabel('Tipo de base').selectOption({ label: 'Outro' });
  await print('conferir-03-completar', {
    destacando: [linhaDeImportacao(3).getByLabel('Tipo de base'), '#btn-concluir-importacao'],
  });
  await painel.click('#btn-concluir-importacao');
  await painel.waitForSelector('.aviso');
  await print('favoritos-04-concluido', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Importar repositórios locais
  await abrirImportacao('repositórios locais');
  await print('repositorios-01-pastas', { destacando: ['#btn-adicionar-pasta-varrida'] });
  await painel.click('#btn-adicionar-pasta-varrida');
  await painel.waitForSelector('.pasta-varrida');
  await print('repositorios-02-pasta-escolhida', {
    destacando: ['#pastas-varridas', '#btn-avancar-importacao'],
  });
  await painel.click('#btn-avancar-importacao');
  await painel.waitForSelector('#etapa-importacao-repositorios:not([hidden])');
  await print('repositorios-03-encontrados', { destacando: ['#repositorios-encontrados'] });
  await fecharAvisos();
  await painel.click('#btn-marcar-repositorios');
  await repositorio('tres-irmaos-pecuaria')
    .locator('select')
    .selectOption({ label: 'Novo cliente…' });
  await repositorio('tres-irmaos-pecuaria')
    .getByPlaceholder('Nome do novo cliente')
    .fill('Pecuária Três Irmãos');
  await print('repositorios-04-clientes', {
    destacando: [
      '#btn-marcar-repositorios',
      repositorio('tres-irmaos-pecuaria').locator('.campo-de-cliente-do-repositorio'),
    ],
  });
  await painel.click('#btn-concluir-importacao');
  await painel.waitForSelector('.aviso');
  await print('repositorios-05-concluido', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Importar cadastros de arquivo
  await abrirImportacao('cadastros de arquivo');
  await print('cadastros-01-arquivo', { destacando: ['#area-de-arquivo-de-cadastros'] });
  await painel.setInputFiles('#campo-arquivo-de-cadastros', arquivoDeCadastros());
  await painel.waitForSelector('#etapa-importacao-cadastros:not([hidden])');
  await print('cadastros-02-conferir', {
    destacando: ['#resumo-dos-cadastros', '.avisos-do-arquivo', '.resumo-da-importacao'],
  });

  // Decidir bases já cadastradas
  const primeiroConflito = painel.locator('.conflito-de-importacao').first();
  await primeiroConflito.scrollIntoViewIfNeeded();
  await primeiroConflito.locator('label', { hasText: 'Usar o importado' }).click();
  await print('ja-cadastradas-01-cartao', { destacando: [primeiroConflito] });
  await painel.click('#btn-substituir-todos');
  await print('ja-cadastradas-02-em-bloco', { destacando: ['#acoes-dos-conflitos'] });
  await painel.click('#btn-concluir-importacao');
  await painel.waitForSelector('.aviso');
  await print('cadastros-03-concluido', { destacando: ['.aviso'] });
  await fecharAvisos();

  // Exportar cadastros
  const botaoExportar = painel.locator('.acoes-da-lista button', { hasText: 'Exportar' });
  await print('exportar-01-botao', { destacando: [botaoExportar] });
  await botaoExportar.click();
  await painel.click('#btn-desmarcar-clientes-a-exportar');
  for (const nome of ['Fazenda Boa Vista', 'Indústria Alfa']) {
    await painel
      .locator('#linhas-de-clientes-a-exportar .linha-de-exportacao', { hasText: nome })
      .locator('input')
      .check();
  }
  await print('exportar-02-clientes', {
    destacando: ['#linhas-de-clientes-a-exportar', '#btn-avancar-exportacao-de-cadastros'],
  });
  await painel.click('#btn-avancar-exportacao-de-cadastros');
  await painel
    .locator('#linhas-de-exportacao-de-cadastros .linha-de-exportacao', {
      hasText: 'Fazenda Boa Vista',
    })
    .locator('label', { hasText: 'Credenciais' })
    .click();
  await print('exportar-03-colunas', {
    destacando: ['#barra-de-exportacao-de-cadastros', '#linhas-de-exportacao-de-cadastros'],
  });
  await painel.click('#btn-copiar-exportacao-de-cadastros');
  await painel.waitForSelector('.aviso');
  await print('exportar-04-copiar', { destacando: ['#btn-copiar-exportacao-de-cadastros'] });
  await fecharAvisos();
  await painel.click('#btn-baixar-exportacao-de-cadastros');
  await painel.waitForSelector('.aviso');
  await print('exportar-05-baixar', { destacando: ['#btn-baixar-exportacao-de-cadastros'] });
  await fecharAvisos();
  await painel.click('#btn-cancelar-exportacao-de-cadastros');
}
