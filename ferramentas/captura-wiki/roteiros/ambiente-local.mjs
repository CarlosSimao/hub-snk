/**
 * Prints da página Ambiente local da wiki (`site/wiki/ambiente-local.html`).
 *
 * O runner não tem WildFly nem Docker: a situação das bases e dos bancos e o Iniciar,
 * Reiniciar e Parar são respondidos por rota, com um estado em memória. O log e o
 * `.sankhya-mcp.env` são de verdade, numa pasta de WildFly de mentira criada em `semear`;
 * a tela mostra essa pasta como `C:\wildfly\...`, para o print não levar a pasta
 * temporária da máquina.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PASTA_DOS_PRINTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'site',
  'wiki',
  'img',
  'ambiente-local',
);
const QUALIDADE_WEBP = 0.85;
const INTERVALO_DAS_AMOSTRAS_MS = 30_000;
const AMOSTRAS_INICIAIS = 24;
const ESPERA_DOS_AVISOS_MS = 3500;
const AGORA = new Date().toISOString();

const BASE_HOMOLOGACAO = {
  id: '3f6c2a1e-8b4d-4c2a-9e1f-5a7b3c9d0e21',
  nome: 'SankhyaOm 4.32 (homologação)',
  pasta: 'sankhya-4.32',
  porta: 8080,
  versao: '4.32b146',
};
const BASE_SUPORTE = {
  id: '7d2e9b40-1c5a-4f3e-8a6d-2b9c4e7f1a03',
  nome: 'SankhyaOm 4.28 (suporte)',
  pasta: 'sankhya-4.28',
  porta: 8280,
  versao: '4.28b211',
};
const BANCO_BOAVISTA = {
  id: 'c41a7e2d-5b3f-4e8a-9c1d-6f2b8a4e0d57',
  container: 'oracle-boavista',
  host: 'localhost',
  porta: 1521,
  nomeDoServico: 'ORCL',
  usuario: 'SANKHYA',
  senha: 'senha-ficticia',
};
const BANCO_ALFA = {
  id: 'e8b3d1f6-2a4c-4b7e-a5d9-1c3f7e9b2a64',
  container: 'oracle-alfa',
  host: 'localhost',
  porta: 1522,
  nomeDoServico: 'ORCL',
  usuario: 'SANKHYA',
  senha: 'senha-ficticia',
};
const NOVA_BASE = { nome: 'SankhyaOm 4.30 (testes)', caminho: 'C:\\wildfly\\sankhya-4.30' };
const NOVO_BANCO = { container: 'oracle-norteverde', porta: '1523', servico: 'ORCL' };

/** Só a parte depois de `wildfly\` vai para a tela, como se a pasta fosse `C:\wildfly\...`. */
const PASTA_DO_WILDFLY_NA_TELA = /^.*[\\/]wildfly[\\/]/i;

function linhasDoLog() {
  const inicio = Date.now() - 6 * 60_000;
  const hora = (segundos) =>
    new Date(inicio + segundos * 1000)
      .toISOString()
      .replace('T', ' ')
      .replace('Z', '')
      .replace('.', ',');
  return [
    `${hora(0)} INFO  [org.jboss.as.server.deployment] (MSC service thread 1-4) WFLYSRV0027: Starting deployment of "mge.war" (runtime-name: "mge.war")`,
    `${hora(2)} INFO  [org.jboss.as.connector.subsystems.datasources] (MSC service thread 1-2) WFLYJCA0001: Bound data source [java:/MGEDS]`,
    `${hora(9)} INFO  [br.com.sankhya.modelcore] (ServerService Thread Pool -- 81) Dicionário de dados carregado: 1.842 entidades`,
    `${hora(14)} INFO  [br.com.sankhya.modelcore] (ServerService Thread Pool -- 81) Personalizações carregadas: 37 eventos, 12 botões de ação`,
    `${hora(21)} INFO  [org.wildfly.extension.undertow] (ServerService Thread Pool -- 81) WFLYUT0021: Registered web context: '/mge' for server 'default-server'`,
    `${hora(22)} INFO  [org.jboss.as.server] (ServerService Thread Pool -- 45) WFLYSRV0010: Deployed "mge.war" (runtime-name : "mge.war")`,
    `${hora(23)} INFO  [org.jboss.as] (Controller Boot Thread) WFLYSRV0060: Http management interface listening on http://127.0.0.1:9990/management`,
    `${hora(23)} INFO  [org.jboss.as] (Controller Boot Thread) WFLYSRV0025: WildFly started in 48211ms - Started 1203 of 1468 services`,
    `${hora(95)} INFO  [br.com.sankhya.mge.login] (default task-3) Login do usuário SUP na empresa 1`,
    `${hora(140)} WARN  [br.com.sankhya.modelcore.util] (default task-7) Consulta lenta (3.214 ms) em TGFCAB`,
    `${hora(212)} INFO  [br.com.sankhya.mge.eventos] (default task-11) Evento EventoPesagemBalanca executado em 182 ms`,
    `${hora(260)} INFO  [br.com.sankhya.mge.login] (default task-14) Login do usuário ANA.SOUZA na empresa 1`,
    '',
  ].join('\n');
}

/** Bases e bancos locais de mentira; o log da base de homologação já tem o que mostrar. */
export function semear(pastaDeDados) {
  const pastaDoWildfly = (base) => join(pastaDeDados, '..', 'wildfly', base.pasta);
  for (const base of [BASE_HOMOLOGACAO, BASE_SUPORTE]) {
    mkdirSync(join(pastaDoWildfly(base), 'standalone', 'log'), { recursive: true });
  }
  writeFileSync(
    join(pastaDoWildfly(BASE_HOMOLOGACAO), 'standalone', 'log', 'server.log'),
    linhasDoLog(),
  );

  const datas = { criadoEm: AGORA, atualizadoEm: AGORA };
  const local = {
    bases: [BASE_HOMOLOGACAO, BASE_SUPORTE].map((base) => ({
      id: base.id,
      nome: base.nome,
      caminhoWildfly: pastaDoWildfly(base),
      porta: base.porta,
      ...datas,
    })),
    bancos: [BANCO_BOAVISTA, BANCO_ALFA].map((banco) => ({ ...banco, ...datas })),
  };
  writeFileSync(
    join(pastaDeDados, 'local.json'),
    JSON.stringify({ versaoDoEsquema: 1, local }, null, 2),
  );
}

/**
 * Situação de cada base e banco: ligado ou não, e as amostras do gráfico de uptime. Cada
 * consulta acrescenta uma amostra, como o servidor faz.
 */
function criarSimulacao() {
  const ligados = new Set([BASE_HOMOLOGACAO.id, BANCO_BOAVISTA.id]);
  const versoes = new Map([BASE_HOMOLOGACAO, BASE_SUPORTE].map((base) => [base.id, base.versao]));
  // Só o que já estava cadastrado tem passado; o recém-cadastrado começa sem amostra.
  const comPassado = new Set(
    [BASE_HOMOLOGACAO, BASE_SUPORTE, BANCO_BOAVISTA, BANCO_ALFA].map((item) => item.id),
  );
  const amostras = new Map();

  const amostrasDe = (id) => {
    if (!amostras.has(id)) {
      const ligado = ligados.has(id);
      const agora = Date.now();
      amostras.set(
        id,
        !comPassado.has(id)
          ? []
          : Array.from({ length: AMOSTRAS_INICIAIS }, (_, i) => ({
              em: new Date(
                agora - (AMOSTRAS_INICIAIS - i) * INTERVALO_DAS_AMOSTRAS_MS,
              ).toISOString(),
              // Na homologação, a subida do WildFly aparece como duas checagens em amarelo.
              ligado,
              responde: ligado && !(id === BASE_HOMOLOGACAO.id && (i === 4 || i === 5)),
            })),
      );
    }
    return amostras.get(id);
  };

  const registrar = (id) => {
    const ligado = ligados.has(id);
    const lista = amostrasDe(id);
    lista.push({ em: new Date().toISOString(), ligado, responde: ligado });
    return lista;
  };

  return {
    ligar: (id) => ligados.add(id),
    desligar: (id) => ligados.delete(id),
    situacaoDaBase(id) {
      const historico = registrar(id).map(({ em, ligado, responde }) => ({
        em,
        servicoRodando: ligado,
        paginaInicialOk: responde,
      }));
      const ligado = ligados.has(id);
      return {
        servicoRodando: ligado,
        paginaInicialOk: ligado,
        versaoDaPlataforma: ligado ? (versoes.get(id) ?? null) : null,
        historico,
      };
    },
    situacaoDoBanco(id) {
      const historico = registrar(id).map(({ em, ligado, responde }) => ({
        em,
        containerRodando: ligado,
        bancoAcessivel: responde,
      }));
      const ligado = ligados.has(id);
      return { containerRodando: ligado, bancoAcessivel: ligado, historico };
    },
  };
}

const idDaUrl = (url) => new URL(url).pathname.split('/').at(-2);

async function simularRotas(painel) {
  const simulacao = criarSimulacao();

  await painel.route('**/api/local/bases', async (rota) => {
    if (rota.request().method() !== 'GET') return rota.continue();
    const resposta = await rota.fetch();
    const bases = (await resposta.json()).map((base) => ({
      ...base,
      caminhoWildfly: base.caminhoWildfly.replace(PASTA_DO_WILDFLY_NA_TELA, 'C:\\wildfly\\'),
    }));
    return rota.fulfill({ response: resposta, json: bases });
  });
  await painel.route('**/api/local/bases/*/situacao', (rota) =>
    rota.fulfill({ json: simulacao.situacaoDaBase(idDaUrl(rota.request().url())) }),
  );
  await painel.route('**/api/local/bancos/*/situacao', (rota) =>
    rota.fulfill({ json: simulacao.situacaoDoBanco(idDaUrl(rota.request().url())) }),
  );
  // Iniciar, reiniciar e parar nunca chegam ao servidor: sem WildFly e sem Docker, só mudam o estado.
  await painel.route(/\/api\/local\/(bases|bancos)\/[^/]+\/(iniciar|reiniciar|parar)$/, (rota) => {
    const id = idDaUrl(rota.request().url());
    const acao = new URL(rota.request().url()).pathname.split('/').at(-1);
    if (acao === 'iniciar') simulacao.ligar(id);
    if (acao === 'parar') simulacao.desligar(id);
    return rota.fulfill({ status: 204 });
  });
}

/** Sufixo do print no tema em que o painel está, o mesmo que o capturador usa. */
async function sufixoDoTema(painel) {
  const tema = await painel.evaluate(() => localStorage.getItem('hub-snk:tema'));
  return tema === 'light' ? '-claro' : '';
}

/**
 * A janela de log é outra janela do aplicativo, que o capturador não enxerga: o print sai
 * dela própria, no tamanho dela.
 */
async function imprimirJanela(janela, nome, sufixo) {
  const png = await janela.screenshot();
  const dataUrl = await janela.evaluate(
    async ([base64, qualidade]) => {
      const imagem = new Image();
      imagem.src = `data:image/png;base64,${base64}`;
      await imagem.decode();
      const canvas = document.createElement('canvas');
      canvas.width = imagem.width;
      canvas.height = imagem.height;
      canvas.getContext('2d').drawImage(imagem, 0, 0);
      return canvas.toDataURL('image/webp', qualidade);
    },
    [png.toString('base64'), QUALIDADE_WEBP],
  );
  mkdirSync(PASTA_DOS_PRINTS, { recursive: true });
  writeFileSync(
    join(PASTA_DOS_PRINTS, `${nome}${sufixo}.webp`),
    Buffer.from(dataUrl.split(',')[1], 'base64'),
  );
  console.log(`  ambiente-local/${nome}${sufixo}.webp`);
}

export async function roteiro({ painel, aplicativo, print }) {
  await simularRotas(painel);
  const linhaDaBase = (nome) =>
    painel.locator('#secao-bases-locais .linha-recurso', { hasText: nome });
  const linhaDoBanco = (nome) =>
    painel.locator('#secao-bancos-locais .linha-recurso', { hasText: nome });
  const botao = (local, rotulo) => local.locator(`[aria-label="${rotulo}"]`).first();
  const seloDe = (linha) => linha.locator('.situacao-banco-local');
  const esperarAvisos = () => painel.waitForTimeout(ESPERA_DOS_AVISOS_MS);
  const homologacao = linhaDaBase(BASE_HOMOLOGACAO.nome);
  const suporte = linhaDaBase(BASE_SUPORTE.nome);
  const bancoBoaVista = linhaDoBanco(BANCO_BOAVISTA.container);
  const bancoAlfa = linhaDoBanco(BANCO_ALFA.container);

  // Tela Local
  await print('visao-geral-01-aba-local', { destacando: ['#btn-visualizacao-local'] });
  await painel.click('#btn-visualizacao-local');
  await homologacao.locator('.selo-situacao.ok').waitFor();
  await bancoAlfa.locator('.selo-situacao.erro').waitFor();
  await print('visao-geral-02-tela', {
    destacando: ['#secao-bases-locais .secao-cabecalho', '#secao-bancos-locais .secao-cabecalho'],
  });

  // Situação da base
  await print('situacao-da-base-01-selo', { destacando: [seloDe(homologacao)] });
  await botao(homologacao, 'Atualizar status agora').click();
  await print('situacao-da-base-02-atualizar', {
    destacando: [botao(homologacao, 'Atualizar status agora')],
  });

  // Iniciar, reiniciar e parar a base
  await print('iniciar-e-parar-base-01-iniciar', { destacando: [botao(suporte, 'Iniciar')] });
  await botao(suporte, 'Iniciar').click();
  await suporte.locator('.selo-situacao.ok').waitFor();
  await print('iniciar-e-parar-base-02-operacional', { destacando: [seloDe(suporte)] });
  await print('iniciar-e-parar-base-03-reiniciar-e-parar', {
    destacando: [botao(suporte, 'Reiniciar'), botao(suporte, 'Parar')],
  });
  await botao(suporte, 'Parar').click();
  await suporte.locator('.selo-situacao.erro').waitFor();

  // Abrir o SankhyaOm local: só o botão, a guia seria uma tela de terceiros.
  await print('abrir-sankhyaom-01-botao', {
    destacando: [botao(homologacao, 'Abrir SankhyaOm')],
  });

  // Log ao vivo
  await print('log-da-base-01-botao', { destacando: [botao(homologacao, 'Abrir log')] });
  const [janelaDoLog] = await Promise.all([
    aplicativo.context().waitForEvent('page', {
      predicate: (pagina) => pagina.url().includes('/log.html'),
    }),
    botao(homologacao, 'Abrir log').click(),
  ]);
  await janelaDoLog.locator('#log-status', { hasText: 'Acompanhando' }).waitFor();
  await janelaDoLog.locator('#log-corpo', { hasText: 'WFLYSRV0025' }).waitFor();
  await janelaDoLog.waitForTimeout(400);
  await imprimirJanela(janelaDoLog, 'log-da-base-02-janela', await sufixoDoTema(painel));
  await janelaDoLog.close();

  // .sankhya-mcp.env da base local
  const botaoDoMcp = homologacao.locator('[aria-label="Banco de dados do MCP Claude"]');
  await print('mcp-da-base-01-botao', { destacando: [botaoDoMcp] });
  await botaoDoMcp.click();
  await painel.waitForSelector('#modal-mcp[open]');
  await painel.selectOption('#campo-base-para-importar', BANCO_BOAVISTA.id);
  await painel.click('#btn-importar-base');
  await print('mcp-da-base-02-importar', {
    destacando: ['#campo-base-para-importar', '#btn-importar-base'],
  });
  await esperarAvisos();
  await painel.click('#btn-salvar-mcp');
  const botaoDoMcpConfigurado = homologacao.locator('[aria-label^="MCP configurado"]');
  await botaoDoMcpConfigurado.waitFor();
  await print('mcp-da-base-03-salvo', { destacando: [botaoDoMcpConfigurado] });
  await esperarAvisos();

  // Cadastrar base
  await print('cadastrar-base-01-botao', {
    destacando: [botao(painel.locator('#secao-bases-locais'), 'Adicionar base')],
  });
  await botao(painel.locator('#secao-bases-locais'), 'Adicionar base').click();
  await painel.fill('#campo-nome-base-local', NOVA_BASE.nome);
  await painel.fill('#campo-caminho-wildfly', NOVA_BASE.caminho);
  await painel.fill('#campo-porta-base-local', '8380');
  await print('cadastrar-base-02-formulario', {
    destacando: ['#formulario-base-local .modal-corpo'],
  });
  await painel.click('#btn-salvar-base-local');
  const novaBase = linhaDaBase(NOVA_BASE.nome);
  await novaBase.locator('.selo-situacao.erro').waitFor();
  await print('cadastrar-base-03-salva', { destacando: [novaBase] });
  await esperarAvisos();

  // Editar e excluir base (a recém-cadastrada)
  await print('editar-e-excluir-base-01-editar', { destacando: [botao(novaBase, 'Editar base')] });
  await botao(novaBase, 'Editar base').click();
  await painel.fill('#campo-porta-base-local', '8480');
  await print('editar-e-excluir-base-02-formulario', { destacando: ['#campo-porta-base-local'] });
  await painel.click('#btn-salvar-base-local');
  await novaBase.locator('.selo-situacao.erro').waitFor();
  await esperarAvisos();
  await print('editar-e-excluir-base-03-excluir', {
    destacando: [botao(novaBase, 'Excluir base')],
  });
  await botao(novaBase, 'Excluir base').click();
  await print('editar-e-excluir-base-04-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await esperarAvisos();

  // Situação do banco
  await print('situacao-do-banco-01-selo', { destacando: [seloDe(bancoBoaVista)] });

  // Ligar, reiniciar e parar o banco
  await print('ligar-e-parar-banco-01-iniciar', { destacando: [botao(bancoAlfa, 'Iniciar')] });
  await botao(bancoAlfa, 'Iniciar').click();
  await bancoAlfa.locator('.selo-situacao.ok').waitFor();
  await print('ligar-e-parar-banco-02-operacional', { destacando: [seloDe(bancoAlfa)] });
  await print('ligar-e-parar-banco-03-reiniciar-e-parar', {
    destacando: [botao(bancoAlfa, 'Reiniciar'), botao(bancoAlfa, 'Parar')],
  });
  await botao(bancoAlfa, 'Parar').click();
  await bancoAlfa.locator('.selo-situacao.erro').waitFor();

  // Cadastrar banco
  const secaoDosBancos = painel.locator('#secao-bancos-locais');
  await secaoDosBancos.scrollIntoViewIfNeeded();
  await print('cadastrar-banco-01-botao', {
    destacando: [botao(secaoDosBancos, 'Adicionar banco')],
  });
  await botao(secaoDosBancos, 'Adicionar banco').click();
  await painel.fill('#campo-container-local', NOVO_BANCO.container);
  await painel.fill('#campo-host-local', 'localhost');
  await painel.fill('#campo-porta-local', NOVO_BANCO.porta);
  await painel.fill('#campo-servico-local', NOVO_BANCO.servico);
  await painel.fill('#campo-usuario-banco-local', 'SANKHYA');
  await painel.fill('#campo-senha-banco-local', 'senha-ficticia');
  await print('cadastrar-banco-02-formulario', {
    destacando: ['#formulario-banco-local .modal-corpo'],
  });
  await painel.click('#btn-salvar-banco-local');
  const novoBanco = linhaDoBanco(NOVO_BANCO.container);
  await novoBanco.locator('.selo-situacao.erro').waitFor();
  await novoBanco.scrollIntoViewIfNeeded();
  await print('cadastrar-banco-03-salvo', { destacando: [novoBanco] });
  await esperarAvisos();

  // Ver senha, editar e excluir banco (o recém-cadastrado)
  await botao(novoBanco, 'Mostrar senha').click();
  await botao(novoBanco, 'Copiar senha').click();
  await print('editar-e-excluir-banco-01-senha', {
    destacando: [novoBanco.locator('.base-credencial')],
  });
  await esperarAvisos();
  await print('editar-e-excluir-banco-02-editar', {
    destacando: [botao(novoBanco, 'Editar banco')],
  });
  await botao(novoBanco, 'Editar banco').click();
  await print('editar-e-excluir-banco-03-formulario', {
    destacando: ['#formulario-banco-local .modal-corpo'],
  });
  await painel.click('#btn-cancelar-banco-local');
  await botao(novoBanco, 'Excluir banco').click();
  await print('editar-e-excluir-banco-04-confirmar', { destacando: ['#btn-confirmar-exclusao'] });
  await painel.click('#btn-confirmar-exclusao');
  await esperarAvisos();
}
