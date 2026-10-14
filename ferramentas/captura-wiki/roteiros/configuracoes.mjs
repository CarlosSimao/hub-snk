/**
 * Prints da página Configurações da wiki (`site/wiki/configuracoes.html`): as duas micros do
 * topo e um print de cada aba da engrenagem, com os campos preenchidos com dados fictícios.
 *
 * Tudo o que a engrenagem consulta fora da máquina (cofre do Sankhya ID, Google Drive,
 * assistentes de IA instalados, versão nova no GitHub, `.env` do sankhya-schema-mcp, token do
 * GitLab, Git AutoSync) é respondido por rota: nada da máquina que captura aparece no print,
 * e nada é enviado para fora. Os campos são preenchidos na tela e não são salvos, menos no
 * passo do Salvar, que grava a configuração fictícia como veio.
 */
const AGORA = Date.now();
const HORA_MS = 3_600_000;

const situacaoDoSankhyaId = (sistema) => ({
  sistema,
  usuario: 'ana.souza',
  definido: true,
  aviso: '',
  sessaoCapturada: true,
  sessaoExpiraEm: new Date(AGORA + 8 * HORA_MS).toISOString(),
});

const assistentesDeIa = {
  assistentes: [
    {
      id: 'claude',
      nome: 'Claude Code',
      instalado: true,
      caminho: 'C:\\Users\\ana.souza\\AppData\\Roaming\\npm\\claude.cmd',
      modelos: ['opus', 'sonnet', 'haiku'],
      modeloPadrao: 'sonnet',
      lePdf: true,
      raciocinio: {
        '': { niveis: ['low', 'medium', 'high', 'xhigh', 'max'], padrao: 'high' },
        opus: { niveis: ['low', 'medium', 'high', 'xhigh', 'max'], padrao: 'high' },
        sonnet: { niveis: ['low', 'medium', 'high', 'max'], padrao: 'high' },
      },
    },
    {
      id: 'codex',
      nome: 'Codex',
      instalado: true,
      caminho: 'C:\\Users\\ana.souza\\AppData\\Roaming\\npm\\codex.cmd',
      modelos: ['gpt-5-codex'],
      modeloPadrao: 'gpt-5-codex',
      lePdf: false,
      raciocinio: { 'gpt-5-codex': { niveis: ['low', 'medium', 'high'], padrao: 'medium' } },
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

const contaDoGoogle = {
  configurado: true,
  cofreDisponivel: true,
  conectado: true,
  email: 'ana.souza@consultoria.example',
  podeGuardarCopia: true,
  autorizando: false,
  erro: '',
};

const situacaoDoBackup = {
  configuracao: {
    ativo: true,
    pasta: 'D:\\Backups\\HUB SNK',
    intervaloHoras: 24,
    copiasMantidas: 10,
    espelharNoDrive: true,
  },
  local: {
    ultimoEm: new Date(AGORA - 3 * HORA_MS).toISOString(),
    arquivo: 'D:\\Backups\\HUB SNK\\hub-snk-backup.zip',
    erro: '',
  },
  drive: {
    ultimoEm: new Date(AGORA - 20 * 60_000).toISOString(),
    erro: '',
    nomeDoArquivo: 'hub-snk-dados-NOTE-ANA.zip',
  },
  restauracaoPendente: null,
};

const configuracaoDoMcp = {
  command: 'C:\\Users\\ana.souza\\AppData\\Local\\Programs\\HUB SNK\\HUB SNK.exe',
  args: [
    'C:\\Users\\ana.souza\\AppData\\Local\\Programs\\HUB SNK\\resources\\backend\\mcp\\servidorMcp.js',
  ],
  env: { HUB_SNK_URL: 'http://127.0.0.1:4100', ELECTRON_RUN_AS_NODE: '1' },
};

const kanbansNoMcp = {
  estados: [],
  colunas: [],
  tipos: [],
  kanbans: [
    {
      kanbanId: 12,
      kanban: 'Pesagem de rebanho',
      cliente: 'Fazenda Boa Vista',
      projeto: 'Pesagem de rebanho',
      tarefas: 14,
    },
  ],
};

const autosyncNaoInstalado = {
  instalado: false,
  versao: null,
  horarios: [],
  tarefas: [],
  ultimaExecucao: null,
  bandeja: false,
  ia: { ligada: false, agente: '' },
  agenteDaTarefa: null,
  ramoDoMr: '',
  alvos: [],
  repositorios: [],
};

/** Rotas que valem a captura inteira: a engrenagem nunca fala com a máquina nem com a rede. */
async function simularOQueVemDeFora(painel) {
  const responder = (padrao, json) => painel.route(padrao, (rota) => rota.fulfill({ json }));
  await responder('**/api/sistema/atualizacao', {
    versaoInstalada: '2.10.1',
    ultimaVersao: '2.11.0',
    atualizacaoDisponivel: true,
    url: 'https://github.com/CarlosSimao/hub-snk/releases/tag/v2.11.0',
  });
  await responder('**/api/sankhya/shell', { disponivel: true });
  await responder('**/api/sankhya/credenciais', {
    credenciais: ['sankhya-erp', 'sankhya-experience'].map(situacaoDoSankhyaId),
  });
  await responder('**/api/sankhya/id/senha', { senha: 'senha-ficticia' });
  await responder('**/api/configuracao/assistentes-de-ia', assistentesDeIa);
  await responder('**/api/drive', contaDoGoogle);
  await responder('**/api/backup', situacaoDoBackup);
  await responder('**/api/mcp/configuracao', {
    nome: 'hub-snk-kanban',
    ...configuracaoDoMcp,
    mcpServers: { 'hub-snk-kanban': configuracaoDoMcp },
  });
  await responder('**/api/mcp/kanbans', kanbansNoMcp);
  await responder('**/api/notificacoes/email-de-teste', {
    mensagem: 'E-mail de teste enviado para ana.souza@consultoria.example.',
  });
  await responder('**/api/autosync/gitlab', { host: 'gitlab.demo.example', tokenDefinido: true });
  await responder(/\/api\/autosync(\?.*)?$/, autosyncNaoInstalado);
  await responder('**/api/autosync/clientes', { repositorios: [], sugestoesDeRaiz: [] });
}

/** Página do aplicativo fora do painel: a moldura (`index.html`) ou o menu flutuante (`menu.html`). */
function paginaDoAplicativo(aplicativo, arquivo) {
  return aplicativo
    .context()
    .pages()
    .find((pagina) => pagina.url().startsWith('file:') && pagina.url().endsWith(arquivo));
}

/**
 * O `print` só contorna o que está no painel. O menu flutuante é outra página: o contorno
 * vai direto nos itens dele, com o mesmo desenho do capturador, e sai antes do próximo passo.
 */
function contornarItensDoMenu(menu, rotulos) {
  return menu.evaluate((rotulos) => {
    for (const item of document.querySelectorAll('#menu .item')) {
      if (!rotulos.includes(item.children[1]?.textContent)) continue;
      Object.assign(item.style, {
        outline: '3px solid #f59e0b',
        outlineOffset: '-3px',
        borderRadius: '8px',
        boxShadow: 'inset 0 0 0 6px rgba(245, 158, 11, 0.25)',
      });
    }
  }, rotulos);
}

export async function roteiro({ painel, aplicativo, print }) {
  const modal = painel.locator('#modal-configuracao');
  // Na janela da captura, a das Configurações rola um pouco: no fim aparecem as abas e o
  // rodapé (Salvar ou Fechar); no início, o título.
  const rolarAJanela = (paraOFim) =>
    modal.evaluate((janela, fim) => (janela.scrollTop = fim ? janela.scrollHeight : 0), paraOFim);
  const abrirAba = async (id) => {
    await painel.click(`#aba-configuracao-${id}`);
    await painel.waitForSelector(`#painel-configuracao-${id}:not([hidden])`);
    await rolarAJanela(true);
  };
  const printDaAba = (id, nome, extras = []) =>
    print(`${id}-${nome}`, { destacando: [`#aba-configuracao-${id}`, ...extras] });
  const abrirConfiguracoes = async () => {
    await painel.click('#btn-configuracao');
    await painel.waitForSelector('#modal-configuracao[open]');
  };
  const fecharAvisos = () => painel.waitForTimeout(3500);

  await simularOQueVemDeFora(painel);
  // A versão nova é consultada só na abertura do painel: recarrega com a rota já no lugar.
  await painel.reload();
  await painel.waitForSelector('#indicador-git-global:not([hidden])');
  // A tela Clientes de fundo: o Resumo traria avisos de sessão que não são assunto aqui.
  await painel.click('#btn-visualizacao-clientes');

  // Abrir e salvar
  await print('abrir-e-salvar-01-engrenagem', { destacando: ['#btn-configuracao'] });
  await abrirConfiguracoes();
  await rolarAJanela(false);
  await print('abrir-e-salvar-02-abas', { destacando: ['#modal-configuracao .abas-modal'] });
  await rolarAJanela(true);
  await print('abrir-e-salvar-03-salvar', { destacando: ['#btn-salvar-configuracao'] });
  await painel.click('#btn-salvar-configuracao');
  await painel.waitForSelector('.aviso');
  await print('abrir-e-salvar-04-salvas', { destacando: ['.aviso'] });
  await fecharAvisos();
  await abrirConfiguracoes();
  await abrirAba('kanban');
  await painel.waitForSelector('#lista-kanban-colunas button');
  await print('abrir-e-salvar-05-fechar', { destacando: ['#btn-cancelar-configuracao'] });
  await painel.click('#btn-cancelar-configuracao');

  // Atalho "Abrir configuração" num erro: a lista do raio, vazia, leva à aba Atalhos.
  await painel.click('#btn-atalhos');
  const linkDaConfiguracao = painel.locator('#lista-atalhos .link-configuracao');
  await print('abrir-configuracao-pelo-erro-01-link', { destacando: [linkDaConfiguracao] });
  await linkDaConfiguracao.click();
  await painel.waitForSelector('#painel-configuracao-atalhos:not([hidden])');
  await rolarAJanela(true);
  await print('abrir-configuracao-pelo-erro-02-aba', { destacando: ['#btn-adicionar-atalho'] });

  // Atalhos, na janela aberta pelo passo anterior
  for (const [nome, caminho] of [
    ['DataGrip', 'C:\\Program Files\\JetBrains\\DataGrip\\bin\\datagrip64.exe'],
    ['SQL Developer', 'C:\\Ferramentas\\sqldeveloper\\sqldeveloper.exe'],
  ]) {
    await painel.click('#btn-adicionar-atalho');
    const linha = painel.locator('#lista-atalhos-config .linha-atalho-config').last();
    await linha.locator('input').nth(0).fill(nome);
    await linha.locator('input').nth(1).fill(caminho);
  }
  await printDaAba('atalhos', '01-aba', ['#lista-atalhos-config']);

  // Geral
  await abrirAba('geral');
  await painel.fill('#campo-email-do-usuario', 'ana.souza@consultoria.example');
  await painel.fill(
    '#campo-caminho-executavel-ide',
    'C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe',
  );
  await printDaAba('geral', '01-aba');

  // Sankhya ID, com o cofre respondido pela rota
  await abrirAba('sankhya-id');
  await painel.waitForSelector('#cartao-sankhya-id .selo-situacao.ok');
  await painel.waitForSelector('[data-sistema="sankhya-experience"] .selo-situacao.ok');
  await painel.fill('#campo-sankhya-om-codusu', '4817');
  await printDaAba('sankhya-id', '01-aba');

  // SMTP, com o e-mail de teste respondido pela rota
  await abrirAba('smtp');
  await painel.fill('#campo-smtp-host', 'smtp.consultoria.example');
  await painel.fill('#campo-smtp-usuario', 'ana.souza@consultoria.example');
  await painel.fill('#campo-smtp-senha', 'senha-ficticia');
  await painel.fill('#campo-smtp-remetente', 'ana.souza@consultoria.example');
  await painel.fill('#campo-smtp-destinatario', 'ana.souza@consultoria.example');
  await painel.click('#btn-testar-smtp');
  await painel.waitForSelector('#resultado-teste-smtp.sucesso');
  await printDaAba('smtp', '01-aba', ['#btn-testar-smtp']);

  // Avisos
  await abrirAba('avisos');
  await painel.check('#campo-alerta-agenda-ativo');
  await painel.check('#campo-alerta-agenda-email');
  await printDaAba('avisos', '01-aba');

  // Kanban
  await abrirAba('kanban');
  await painel.waitForSelector('#lista-kanban-tipos button');
  await printDaAba('kanban', '01-aba');

  // MCP: um print por grupo, que os dois abertos não cabem
  await abrirAba('mcp');
  await painel.click('#grupo-sankhya-schema summary');
  await painel.fill('#campo-caminho-schema-mcp', 'C:\\Ferramentas\\sankhya-schema-mcp');
  await painel.fill('#campo-config-mcp-host', '10.0.0.15');
  await painel.fill('#campo-config-mcp-port', '1521');
  await painel.fill('#campo-config-mcp-service', 'ORCL');
  await painel.fill('#campo-config-mcp-user', 'SANKHYA');
  await painel.fill('#campo-config-mcp-password', 'senha-ficticia');
  await printDaAba('mcp', '01-sankhya-schema', ['#grupo-sankhya-schema summary']);
  await painel.click('#grupo-sankhya-schema summary');
  await painel.click('#grupo-kanban-mcp summary');
  await painel.waitForSelector('#lista-kanbans-mcp .linha-recurso');
  await printDaAba('mcp', '02-kanban-por-mcp', ['#grupo-kanban-mcp summary']);

  // IA, com os assistentes da rota
  await abrirAba('ia');
  await painel.waitForFunction(
    () => !document.querySelector('#btn-atualizar-assistentes-ia').disabled,
  );
  await painel.selectOption('#campo-assistente-ia', 'claude');
  await painel.selectOption('#campo-modelo-ia', 'opus');
  await painel.waitForSelector('#bloco-raciocinio-ia:not([hidden])');
  await painel.selectOption('#campo-raciocinio-ia', 'xhigh');
  await printDaAba('ia', '01-aba');

  // Acessos
  await abrirAba('acessos');
  await printDaAba('acessos', '01-aba');

  // Backup, com o Drive e a situação da rota
  await abrirAba('backup');
  await painel.waitForSelector('#campo-backup-pasta');
  await rolarAJanela(true);
  await printDaAba('backup', '01-aba');

  // Sobre, com a versão nova da rota
  await abrirAba('sobre');
  await painel.waitForSelector('#rodape-atualizacao:not([hidden])');
  await printDaAba('sobre', '01-aba');
  await painel.click('#btn-cancelar-configuracao');

  // Outras preferências, fora da engrenagem
  const moldura = paginaDoAplicativo(aplicativo, 'index.html');
  const abrirMenuFlutuante = async (botao) => {
    await moldura.click(botao);
    await painel.waitForTimeout(600);
    const menu = paginaDoAplicativo(aplicativo, 'menu.html');
    await menu.waitForSelector('#menu:not([hidden])');
    return menu;
  };
  const fecharMenuFlutuante = (menu) => menu.evaluate(() => window.menuHub.fechar());

  // O menu ☰ passa um pouco da janela: no fim, cabe da Ruffle até a Ajuda.
  const menuDoAplicativo = await abrirMenuFlutuante('#menu');
  await menuDoAplicativo.evaluate(() => {
    const cartao = document.getElementById('menu');
    cartao.scrollTop = cartao.scrollHeight;
  });
  await contornarItensDoMenu(menuDoAplicativo, [
    'Compatibilidade com Flash (Ruffle)',
    'Painel',
    'SankhyaOm',
    'Experience',
    'Atualizar automaticamente',
  ]);
  await print('outras-01-menu');
  await fecharMenuFlutuante(menuDoAplicativo);

  const menuDaComunicacao = await abrirMenuFlutuante('#configurarServicos');
  await contornarItensDoMenu(menuDaComunicacao, [
    'WhatsApp',
    'Gmail',
    'Google Chat',
    'Google Agenda',
    'Google Meet',
    'Carregar WhatsApp e Google Chat',
  ]);
  await print('outras-02-barra-de-comunicacao');
  await fecharMenuFlutuante(menuDaComunicacao);

  await painel.click('#btn-visualizacao-autosync');
  await print('outras-03-engrenagem-do-autosync', { destacando: ['#btn-configuracao-autosync'] });
  await painel.click('#btn-configuracao-autosync');
  await painel.waitForSelector('#modal-autosync-configuracao[open]');
  await print('outras-04-gitlab', {
    destacando: ['#modal-autosync-configuracao .grupo-de-acessos'],
  });
}
