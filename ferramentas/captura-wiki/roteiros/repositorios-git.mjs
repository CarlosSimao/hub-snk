/**
 * Prints da página Repositórios Git da wiki (`site/wiki/repositorios-git.html`).
 *
 * O diagnóstico é de verdade, sobre os repositórios de `preparar-dados.mjs`. Os botões que
 * abrem programas da máquina (pasta, terminal, IDE) nunca chegam ao servidor: a IDE responde
 * por rota o mesmo erro de "nenhuma IDE configurada", e a pasta e o terminal só aparecem
 * destacados. A seção AutoSync, no pé da aba, usa o Git AutoSync simulado da página dele.
 */
import { idFicticio, mostrarRepositoriosEmCWorkspace, simularAutosync } from './git-autosync.mjs';

const ESPERA_DOS_AVISOS_MS = 3500;
const NOVO_REPOSITORIO = {
  caminho: 'C:\\Workspace\\boavista-balanca',
  url: 'https://github.com/consultoria-demo/boavista-balanca.git',
};

async function simularProgramasDaMaquina(painel) {
  await painel.route(/\/api\/clientes\/[^/]+\/repositorios\/[^/]+\/abrir-ide$/, (rota) =>
    rota.fulfill({
      status: 503,
      json: {
        mensagem: 'Nenhuma IDE configurada. Cadastre o executável em Configurações › Geral.',
        configuracaoPendente: 'ide',
      },
    }),
  );
  await painel.route(/\/api\/clientes\/[^/]+\/repositorios\/[^/]+\/abrir-(pasta|shell)$/, (rota) =>
    rota.fulfill({ status: 204 }),
  );
}

export async function roteiro({ painel, print }) {
  await mostrarRepositoriosEmCWorkspace(painel);
  await simularAutosync(painel);
  await simularProgramasDaMaquina(painel);
  const esperarAvisos = () => painel.waitForTimeout(ESPERA_DOS_AVISOS_MS);
  const abaGit = painel.locator('.detalhe-abas button', { hasText: 'Git' });
  const repositorios = painel.locator('.detalhe .secao-recursos', {
    has: painel.locator('h3', { hasText: 'Repositórios' }),
  });
  const linha = (nome) => repositorios.locator('.linha-recurso', { hasText: nome });
  const abrirCliente = async (nome) => {
    await painel.locator('.item-cliente', { hasText: nome }).click();
    await abaGit.click();
    await repositorios.locator('.situacao-git').first().waitFor();
  };

  // Aba Git do cliente
  await painel.click('#btn-visualizacao-clientes');
  await painel.locator('.item-cliente', { hasText: 'Fazenda Boa Vista' }).click();
  await print('aba-git-01-aba', { destacando: [abaGit] });
  await abaGit.click();
  const boaVista = linha('boavista-pesagem');
  await boaVista.locator('.situacao-git').waitFor();
  await print('aba-git-02-lista', { destacando: [repositorios] });

  // Diagnóstico
  await print('diagnostico-01-verde', { destacando: [boaVista.locator('.situacao-git')] });

  // Pasta, terminal, IDE e assistente: só a IDE é clicada, e responde por rota.
  await print('abrir-pasta-terminal-ou-ide-01-botoes', {
    destacando: [
      boaVista.locator('[aria-label^="Abrir a pasta"]'),
      boaVista.locator('[aria-label^="Abrir o terminal"]'),
      boaVista.locator('[aria-label^="Abrir IDE"]'),
      boaVista.locator('[aria-label^="Abrir o assistente"]'),
    ],
  });
  await boaVista.locator('[aria-label^="Abrir IDE"]').click();
  await painel.locator('.aviso.erro').waitFor();
  await print('abrir-pasta-terminal-ou-ide-02-sem-ide', { destacando: ['.aviso.erro'] });
  await esperarAvisos();

  // .sankhya-mcp.env do repositório
  const botaoDoMcp = boaVista.locator('[aria-label="Banco de dados do MCP Claude"]');
  await print('mcp-do-repositorio-01-botao', { destacando: [botaoDoMcp] });
  await botaoDoMcp.click();
  await painel.waitForSelector('#modal-mcp[open]');
  await painel.selectOption('#campo-base-para-importar', idFicticio('b-boavista-prod'));
  await painel.click('#btn-importar-base');
  await print('mcp-do-repositorio-02-importar', {
    destacando: ['#campo-base-para-importar', '#btn-importar-base'],
  });
  await esperarAvisos();
  await painel.click('#btn-salvar-mcp');
  const botaoDoMcpConfigurado = boaVista.locator('[aria-label^="MCP configurado"]');
  await botaoDoMcpConfigurado.waitFor();
  await print('mcp-do-repositorio-03-salvo', { destacando: [botaoDoMcpConfigurado] });
  await esperarAvisos();

  // Cadastrar repositório
  const botaoAdicionar = repositorios.locator('[aria-label="Adicionar repositório"]');
  await print('cadastrar-repositorio-01-botao', { destacando: [botaoAdicionar] });
  await botaoAdicionar.click();
  await painel.fill('#campo-caminho-local', NOVO_REPOSITORIO.caminho);
  await painel.fill('#campo-url-repositorio', NOVO_REPOSITORIO.url);
  await print('cadastrar-repositorio-02-formulario', {
    destacando: ['#formulario-repositorio .modal-corpo'],
  });
  await painel.click('#btn-salvar-repositorio');
  const novo = linha('boavista-balanca');
  await novo.locator('.situacao-git').waitFor();
  await print('cadastrar-repositorio-03-salvo', { destacando: [novo] });
  await esperarAvisos();

  // A pasta do repositório novo não existe: a pendência vermelha traz o clone.
  await novo.locator('.situacao-git button.selo-situacao').click();
  await print('pendencias-01-lista', { destacando: [novo.locator('.lista-pendencias')] });
  await novo.locator('[aria-label="Copiar comando"]').click();
  await painel.locator('.aviso', { hasText: 'Comando copiado.' }).waitFor();
  await print('pendencias-02-copiar', {
    destacando: [novo.locator('[aria-label="Copiar comando"]'), '.aviso'],
  });
  await esperarAvisos();

  // Editar e excluir (o repositório recém-cadastrado)
  await print('editar-e-excluir-01-editar', {
    destacando: [novo.locator('[aria-label="Editar repositório"]')],
  });
  await novo.locator('[aria-label="Editar repositório"]').click();
  await print('editar-e-excluir-02-formulario', {
    destacando: ['#formulario-repositorio .modal-corpo'],
  });
  await painel.click('#btn-cancelar-repositorio');
  await novo.locator('[aria-label="Excluir repositório"]').click();
  await print('editar-e-excluir-03-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await novo.waitFor({ state: 'detached' });
  await esperarAvisos();

  // Diagnóstico em amarelo e em vermelho
  await abrirCliente('Indústria Alfa');
  await print('diagnostico-02-amarelo', {
    destacando: [linha('alfa-embalagens').locator('.situacao-git')],
  });
  await abrirCliente('Transportadora Rota Sul');
  await print('diagnostico-03-vermelho', {
    destacando: [linha('rotasul-fretes').locator('.situacao-git')],
  });
}
