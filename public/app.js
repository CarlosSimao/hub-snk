/*
 * HUB SNK — camada de interface.
 *
 * Sem framework: o estado vive em um objeto único e a tela é redesenhada a
 * partir dele. O DOM é montado com `createElement`/`textContent`, nunca com
 * concatenação de HTML, para que dado digitado pelo usuário não vire injeção
 * de markup.
 */

import { lerCadastrosDoTexto } from './leitorDeArquivoDeCadastros.js';
import { lerArvoreDeFavoritos } from './leitorDeFavoritos.js';
import { separarTipoDoNome } from './tipoDeBaseNoNome.js';

const CAMINHO_DA_API = '/api/clientes';
const CAMINHO_DA_CONFIGURACAO = '/api/configuracao';
const CAMINHO_DA_SITUACAO_GIT = '/api/situacao-git';
const CAMINHO_DOS_ATALHOS = '/api/atalhos';
const CAMINHO_DO_SISTEMA = '/api/sistema';
const CAMINHO_DAS_BASES_LOCAIS = '/api/local/bases';
const CAMINHO_DOS_BANCOS_LOCAIS = '/api/local/bancos';
const CAMINHO_DA_IMPORTACAO = `${CAMINHO_DA_API}/importacao`;
const CAMINHO_DA_IMPORTACAO_DE_REPOSITORIOS = `${CAMINHO_DA_API}/importacao-de-repositorios`;
const CAMINHO_DA_IMPORTACAO_DE_CADASTROS = `${CAMINHO_DA_API}/importacao-de-cadastros`;
const DURACAO_DO_AVISO_MS = 4000;
/* Mesmos padrões do backend (repositorioConfiguracaoArquivo.ts) — usados até a configuração carregar. */
const INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S = 30;
const TEMPO_LIMITE_PADRAO_S = 5;
const MILISSEGUNDOS_POR_SEGUNDO = 1000;
/* Até esta quantidade a lista de atalhos é lida de relance, e a busca só atrapalharia. */
const ATALHOS_ATE_DISPENSAR_A_BUSCA = 5;
const CHAVE_DO_TEMA = 'hub-snk:tema';
const SENHA_MASCARADA = '••••••••';
/* Marca de campo opcional não preenchido — usuário ou senha de uma base. */
const SEM_VALOR = '—';
const NOME_DO_ARQUIVO_MCP = '.sankhya-mcp.env';
const PORTA_PADRAO_DO_BANCO = 1521;
/* O id fixo é o que permite reencontrar o campo depois de o detalhe ser redesenhado. */
const ID_DO_CAMPO_DE_ANOTACOES = 'campo-anotacoes';
const LINHAS_DO_CAMPO_DE_ANOTACOES = 5;
/* Mesmo limite validado no servidor. */
const TAMANHO_MAXIMO_DAS_ANOTACOES = 5000;

const ROTULOS_DE_TIPO_DE_BASE = {
  producao: 'Produção',
  teste: 'Teste',
  outro: 'Outro',
};

/* Ordem de exibição das bases do cliente; tipo desconhecido vai para o fim. */
const ORDEM_DOS_TIPOS_DE_BASE = ['producao', 'teste', 'outro'];

/* ---------------------- importação de favoritos --------------------------- */

const ETAPAS_DA_IMPORTACAO = {
  origem: {
    subtitulo: 'O que você quer importar?',
    anterior: null,
  },
  arquivo: {
    subtitulo: 'Selecione o arquivo de favoritos exportado pelo navegador.',
    anterior: 'origem',
  },
  arvore: {
    subtitulo: 'Marque os favoritos que devem virar bases.',
    anterior: 'arquivo',
  },
  formulario: {
    subtitulo: 'Confira nome e URL, escolha o tipo e, se quiser, informe usuário e senha.',
    anterior: 'arvore',
  },
  pastas: {
    subtitulo: 'Escolha as pastas onde procurar repositórios Git.',
    anterior: 'origem',
  },
  repositorios: {
    subtitulo: 'Marque os repositórios a importar e informe o cliente de cada um.',
    anterior: 'pastas',
  },
  arquivoDeCadastros: {
    subtitulo: 'Selecione o arquivo de cadastros gerado pelo HUB SNK.',
    anterior: 'origem',
  },
  cadastros: {
    subtitulo: 'Confira o que entra e decida o que fica no lugar do que já está cadastrado.',
    anterior: 'arquivoDeCadastros',
  },
};

/* Etapa em que o botão "Concluir" aparece, por origem escolhida. */
const ETAPAS_FINAIS_DA_IMPORTACAO = new Set(['formulario', 'repositorios', 'cadastros']);

/* Primeira etapa de cada origem, escolhida ao avançar da etapa da origem. */
const PRIMEIRA_ETAPA_POR_ORIGEM = {
  favoritos: 'arquivo',
  repositorios: 'pastas',
  cadastros: 'arquivoDeCadastros',
};

/*
 * Etapas com botão "Avançar" e a condição que o habilita. A etapa do arquivo
 * fica de fora: ler o arquivo já leva para a árvore sozinho.
 */
const CONDICOES_PARA_AVANCAR = {
  origem: () => estado.importacao.origem !== '',
  arvore: () => estado.importacao.selecionados.size > 0,
  pastas: () => estado.importacao.repositoriosLocais.pastasVarridas.length > 0,
};

/* Da mais grave para a menos grave: define a cor que o cliente herda na lista. */
const ORDEM_DE_SEVERIDADE = { erro: 0, atencao: 1, desconhecido: 2, ok: 3 };

const ROTULOS_DE_SEVERIDADE = {
  erro: 'Precisa de ação',
  atencao: 'Pendência',
  desconhecido: 'Não foi possível verificar',
  ok: 'Sincronizado com o remoto',
};

/* Cliente sem nenhum repositório cadastrado: não é severidade, é ausência de Git. */
const SITUACAO_SEM_GIT = 'sem-git';

/* Só estas severidades contam para o indicador do cabeçalho: `desconhecido` é ausência de resposta, não uma cor. */
const SEVERIDADES_DO_INDICADOR_GLOBAL = ['erro', 'atencao', 'ok'];

const ROTULOS_DO_INDICADOR_GLOBAL = {
  erro: 'Há repositório precisando de ação',
  atencao: 'Há repositório com pendência',
  ok: 'Todos os repositórios verificados estão sincronizados',
};

/* Chips da coluna lateral, na ordem em que aparecem sob o campo de busca. */
const FILTROS_DE_SITUACAO = [
  { chave: 'ok', rotulo: 'Verde', descricao: ROTULOS_DE_SEVERIDADE.ok },
  { chave: 'atencao', rotulo: 'Amarelo', descricao: ROTULOS_DE_SEVERIDADE.atencao },
  { chave: 'erro', rotulo: 'Vermelho', descricao: ROTULOS_DE_SEVERIDADE.erro },
  {
    chave: 'desconhecido',
    rotulo: 'Não verificado',
    descricao: ROTULOS_DE_SEVERIDADE.desconhecido,
  },
  { chave: SITUACAO_SEM_GIT, rotulo: 'Sem Git', descricao: 'Nenhum repositório cadastrado' },
];

const NAMESPACE_SVG = 'http://www.w3.org/2000/svg';

/* Traçados dos ícones, no mesmo grid 24x24 e desenhados só com contorno. */
const ICONES = {
  olho: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  olhoFechado:
    'M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94 M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 M14.12 14.12a3 3 0 1 1-4.24-4.24 M1 1l22 22',
  seta: 'M7 17L17 7 M7 7h10v10',
  mais: 'M12 5v14 M5 12h14',
  pasta: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  /* Chaves de bloco de código: o botão que abre o projeto na IDE. */
  intellij:
    'M10 4h-.5a2 2 0 0 0-2 2v3.2a2 2 0 0 1-2 2 2 2 0 0 1 2 2V17a2 2 0 0 0 2 2h.5 M14 4h.5a2 2 0 0 1 2 2v3.2a2 2 0 0 0 2 2 2 2 0 0 0-2 2V17a2 2 0 0 1-2 2H14',
  banco:
    'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z M3 5v7c0 1.66 4.03 3 9 3s9-1.34 9-3V5 M3 12v7c0 1.66 4.03 3 9 3s9-1.34 9-3v-7',
  plugue: 'M9 2v6 M15 2v6 M6 8h12v3a6 6 0 0 1-12 0z M12 17v5',
  copiar:
    'M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  engrenagem:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  lapis: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z',
  recarregar: 'M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6',
  /* Bifurcação de commits: identifica a branch em que o repositório está. */
  ramo: 'M6 3v12 M18 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9',
  lixeira:
    'M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2 M10 11v6 M14 11v6',
  /* Raio: o botão que abre a lista de atalhos. */
  raio: 'M13 2L3 14h7l-1 8 10-12h-7l1-8z',
  /* Funil: o botão que abre o painel de filtros da lista de clientes. */
  funil: 'M3 4h18l-7 8.5V20l-4-2.5v-5z',
  /* Triângulo de play: iniciar processo. */
  iniciar: 'M6 4l14 8-14 8z',
  /* Quadrado sólido: parar processo. */
  parar: 'M5 5h14v14H5z',
  /* Folha com linhas de texto: abrir o arquivo de log. */
  log: 'M6 2h9l5 5v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M14 2v6h6 M8 13h8 M8 17h8 M8 9h3',
  /* Sol: exibido no tema escuro, indica a troca para o tema claro. */
  temaClaro:
    'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  /* Lua crescente: exibida no tema claro, indica a troca para o tema escuro. */
  temaEscuro: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  /* Três nós ligados: o botão que compartilha as informações das bases do cliente. */
  compartilhar:
    'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 3.5 M15.4 7l-6.8 3.5',
  /* Seta entrando na bandeja: o botão que importa favoritos e repositórios. */
  importar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  /* A mesma bandeja com a seta saindo: o botão que exporta os cadastros. */
  exportar: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 8l5-5 5 5 M12 3v12',
};

const estado = {
  clientes: [],
  idSelecionado: null,
  filtro: '',
  /*
   * Situações do Git marcadas nos chips da coluna lateral. Vazio significa
   * "todas": é o mesmo resultado de marcar as cinco, com um clique só.
   */
  situacoesFiltradas: new Set(),
  clienteEmEdicao: null,
  clienteDaBaseEmEdicao: null,
  baseEmEdicao: null,
  clienteDoRepositorioEmEdicao: null,
  repositorioEmEdicao: null,
  clienteDoLinkEmEdicao: null,
  linkEmEdicao: null,
  clienteDoBancoEmEdicao: null,
  baseDoBancoEmEdicao: null,
  /* Alvo do modal do MCP: repositório de cliente ou base local. */
  alvoDoMcp: null,
  /* 'clientes' ou 'local': qual das duas telas está visível. */
  visualizacao: 'clientes',
  basesLocais: [],
  bancosLocais: [],
  baseLocalEmEdicao: null,
  bancoLocalEmEdicao: null,
  exclusaoPendente: null,
  /*
   * Anotações digitadas e ainda não gravadas, no formato
   * `{ idDoCliente, texto }`. O detalhe é redesenhado sozinho (atualização
   * automática do Git, mostrar/ocultar senha) e recria o campo do zero: sem esse
   * rascunho, o que estivesse sendo digitado sumiria no meio da frase.
   */
  anotacoesEmEdicao: null,
  senhasReveladas: new Set(),
  /* Situação Git por id de repositório, preenchida depois do primeiro desenho. */
  situacoesGit: {},
  pendenciasExpandidas: new Set(),
  /* Situação (container + banco) por id de banco local, preenchida depois do primeiro desenho. */
  situacoesDeBancosLocais: {},
  /* Situação (serviço + HTTP) por id de base local, preenchida depois do primeiro desenho. */
  situacoesDeBasesLocais: {},
  /* Situação (HTTP na URL cadastrada) por id de base de cliente. */
  situacoesDeBasesDeClientes: {},
  /* Atalhos da barra da direita, relidos a cada gravação da configuração. */
  atalhos: [],
  /*
   * Assistente de importação de favoritos. `pastas` é a árvore lida do arquivo,
   * `selecionados` guarda as chaves marcadas na etapa da árvore e `linhas` são
   * as bases em edição na etapa final, uma por favorito escolhido.
   */
  importacao: {
    etapa: 'origem',
    origem: '',
    nomeDoArquivo: '',
    pastas: [],
    selecionados: new Set(),
    linhas: [],
    errosPorChave: new Map(),
    /*
     * Ramo da importação de repositórios locais. `pastasVarridas` são as pastas
     * apontadas pelo usuário, `encontrados` é o que a varredura devolveu,
     * `selecionados` e `clientesPorCaminho` — este guardando `{ modo, nome }` —
     * são indexados pelo caminho do clone,
     * que é o que identifica um repositório na máquina.
     */
    repositoriosLocais: {
      pastasVarridas: [],
      encontrados: [],
      selecionados: new Set(),
      clientesPorCaminho: new Map(),
      errosPorCaminho: new Map(),
    },
    /*
     * Ramo da importação do arquivo de cadastros. `clientes` é o que o leitor
     * devolveu, `conflitos` são as bases cuja URL já está cadastrada — uma
     * decisão de substituir ou não por linha — e `clientesNovos` e `basesNovas`
     * alimentam o resumo do que entra sem perguntar nada.
     */
    cadastros: {
      nomeDoArquivo: '',
      clientes: [],
      clientesNovos: [],
      basesNovas: [],
      conflitos: [],
    },
  },
  /*
   * Exportação de bases do cliente. `selecoes` é indexado pelo id da base e
   * guarda o que cada linha marcou; vive só enquanto o modal está aberto.
   */
  exportacao: {
    cliente: null,
    selecoes: new Map(),
  },
  /*
   * Exportação de cadastros para arquivo. `selecionados` são os clientes
   * marcados na primeira etapa e `selecoes`, indexado pelo id do cliente, guarda
   * o que sai de cada um na segunda.
   */
  exportacaoDeCadastros: {
    etapa: 'clientes',
    selecionados: new Set(),
    selecoes: new Map(),
  },
};

const elementos = {
  busca: document.getElementById('campo-busca'),
  botaoFiltros: document.getElementById('btn-filtros'),
  painelDeFiltros: document.getElementById('painel-filtros'),
  botaoLimparFiltros: document.getElementById('btn-limpar-filtros'),
  filtrosDeSituacao: document.getElementById('filtros-situacao'),
  lista: document.getElementById('lista-clientes'),
  detalhe: document.getElementById('detalhe'),
  avisos: document.getElementById('avisos'),
  botaoNovoCliente: document.getElementById('btn-novo-cliente'),
  botaoConfiguracao: document.getElementById('btn-configuracao'),
  botaoTema: document.getElementById('btn-tema'),
  indicadorGitGlobal: document.getElementById('indicador-git-global'),

  botaoVisualizacaoClientes: document.getElementById('btn-visualizacao-clientes'),
  botaoVisualizacaoLocal: document.getElementById('btn-visualizacao-local'),
  visualizacaoClientes: document.getElementById('visualizacao-clientes'),
  visualizacaoLocal: document.getElementById('visualizacao-local'),
  secaoBasesLocais: document.getElementById('secao-bases-locais'),
  secaoBancosLocais: document.getElementById('secao-bancos-locais'),

  modalBaseLocal: document.getElementById('modal-base-local'),
  formularioBaseLocal: document.getElementById('formulario-base-local'),
  modalBaseLocalTitulo: document.getElementById('modal-base-local-titulo'),
  campoNomeBaseLocal: document.getElementById('campo-nome-base-local'),
  campoCaminhoWildfly: document.getElementById('campo-caminho-wildfly'),
  botaoEscolherCaminhoWildfly: document.getElementById('btn-escolher-caminho-wildfly'),
  campoPortaBaseLocal: document.getElementById('campo-porta-base-local'),
  erroBaseLocal: document.getElementById('erro-base-local'),
  botaoSalvarBaseLocal: document.getElementById('btn-salvar-base-local'),
  botaoCancelarBaseLocal: document.getElementById('btn-cancelar-base-local'),

  modalBancoLocal: document.getElementById('modal-banco-local'),
  formularioBancoLocal: document.getElementById('formulario-banco-local'),
  modalBancoLocalTitulo: document.getElementById('modal-banco-local-titulo'),
  campoContainerLocal: document.getElementById('campo-container-local'),
  campoHostLocal: document.getElementById('campo-host-local'),
  campoPortaLocal: document.getElementById('campo-porta-local'),
  campoServicoLocal: document.getElementById('campo-servico-local'),
  campoUsuarioBancoLocal: document.getElementById('campo-usuario-banco-local'),
  campoSenhaBancoLocal: document.getElementById('campo-senha-banco-local'),
  botaoVerSenhaBancoLocal: document.getElementById('btn-ver-senha-banco-local'),
  erroBancoLocal: document.getElementById('erro-banco-local'),
  botaoSalvarBancoLocal: document.getElementById('btn-salvar-banco-local'),
  botaoCancelarBancoLocal: document.getElementById('btn-cancelar-banco-local'),

  modalConfiguracao: document.getElementById('modal-configuracao'),
  formularioConfiguracao: document.getElementById('formulario-configuracao'),
  abaConfiguracaoGeral: document.getElementById('aba-configuracao-geral'),
  abaConfiguracaoMcp: document.getElementById('aba-configuracao-mcp'),
  abaConfiguracaoAtalhos: document.getElementById('aba-configuracao-atalhos'),
  painelConfiguracaoGeral: document.getElementById('painel-configuracao-geral'),
  painelConfiguracaoMcp: document.getElementById('painel-configuracao-mcp'),
  painelConfiguracaoAtalhos: document.getElementById('painel-configuracao-atalhos'),
  listaDeAtalhosDaConfiguracao: document.getElementById('lista-atalhos-config'),
  botaoAdicionarAtalho: document.getElementById('btn-adicionar-atalho'),
  campoScriptPadrao: document.getElementById('campo-script-padrao'),
  campoIntervaloDeExecucaoAutomatica: document.getElementById(
    'campo-intervalo-execucao-automatica',
  ),
  campoTempoLimite: document.getElementById('campo-tempo-limite'),
  campoCaminhoSchemaMcp: document.getElementById('campo-caminho-schema-mcp'),
  campoConfigMcpHost: document.getElementById('campo-config-mcp-host'),
  campoConfigMcpPorta: document.getElementById('campo-config-mcp-port'),
  campoConfigMcpServico: document.getElementById('campo-config-mcp-service'),
  campoConfigMcpUsuario: document.getElementById('campo-config-mcp-user'),
  campoConfigMcpSenha: document.getElementById('campo-config-mcp-password'),
  botaoVerSenhaConfigMcp: document.getElementById('btn-ver-senha-config-mcp'),
  erroConfiguracao: document.getElementById('erro-configuracao'),
  botaoSalvarConfiguracao: document.getElementById('btn-salvar-configuracao'),
  botaoCancelarConfiguracao: document.getElementById('btn-cancelar-configuracao'),

  menuDeAtalhos: document.getElementById('menu-atalhos'),
  botaoAtalhos: document.getElementById('btn-atalhos'),
  listaDeAtalhos: document.getElementById('lista-atalhos'),

  modalCliente: document.getElementById('modal-cliente'),
  formularioCliente: document.getElementById('formulario-cliente'),
  modalTitulo: document.getElementById('modal-titulo'),
  modalSubtitulo: document.getElementById('modal-subtitulo'),
  campoNome: document.getElementById('campo-nome'),
  erroCliente: document.getElementById('erro-formulario'),
  botaoSalvarCliente: document.getElementById('btn-salvar'),
  botaoCancelarCliente: document.getElementById('btn-cancelar'),

  modalBase: document.getElementById('modal-base'),
  formularioBase: document.getElementById('formulario-base'),
  modalBaseTitulo: document.getElementById('modal-base-titulo'),
  modalBaseSubtitulo: document.getElementById('modal-base-subtitulo'),
  campoUrl: document.getElementById('campo-url'),
  campoTipo: document.getElementById('campo-tipo'),
  campoUsuario: document.getElementById('campo-usuario'),
  campoSenha: document.getElementById('campo-senha'),
  botaoVerSenha: document.getElementById('btn-ver-senha'),
  erroBase: document.getElementById('erro-base'),
  botaoSalvarBase: document.getElementById('btn-salvar-base'),
  botaoCancelarBase: document.getElementById('btn-cancelar-base'),

  modalBanco: document.getElementById('modal-banco'),
  formularioBanco: document.getElementById('formulario-banco'),
  modalBancoTitulo: document.getElementById('modal-banco-titulo'),
  modalBancoSubtitulo: document.getElementById('modal-banco-subtitulo'),
  campoHost: document.getElementById('campo-host'),
  campoPorta: document.getElementById('campo-porta'),
  campoServico: document.getElementById('campo-servico'),
  campoUsuarioBanco: document.getElementById('campo-usuario-banco'),
  campoSenhaBanco: document.getElementById('campo-senha-banco'),
  botaoVerSenhaBanco: document.getElementById('btn-ver-senha-banco'),
  erroBanco: document.getElementById('erro-banco'),
  botaoSalvarBanco: document.getElementById('btn-salvar-banco'),
  botaoCancelarBanco: document.getElementById('btn-cancelar-banco'),
  botaoDesvincularBanco: document.getElementById('btn-desvincular-banco'),

  modalMcp: document.getElementById('modal-mcp'),
  formularioMcp: document.getElementById('formulario-mcp'),
  modalMcpSubtitulo: document.getElementById('modal-mcp-subtitulo'),
  seletorDeBaseParaImportar: document.getElementById('campo-base-para-importar'),
  botaoImportarBase: document.getElementById('btn-importar-base'),
  campoMcpHost: document.getElementById('campo-mcp-host'),
  campoMcpPorta: document.getElementById('campo-mcp-port'),
  campoMcpServico: document.getElementById('campo-mcp-service'),
  campoMcpUsuario: document.getElementById('campo-mcp-user'),
  campoMcpSenha: document.getElementById('campo-mcp-password'),
  botaoVerSenhaMcp: document.getElementById('btn-ver-senha-mcp'),
  erroMcp: document.getElementById('erro-mcp'),
  botaoSalvarMcp: document.getElementById('btn-salvar-mcp'),
  botaoCancelarMcp: document.getElementById('btn-cancelar-mcp'),

  modalRepositorio: document.getElementById('modal-repositorio'),
  formularioRepositorio: document.getElementById('formulario-repositorio'),
  modalRepositorioTitulo: document.getElementById('modal-repositorio-titulo'),
  modalRepositorioSubtitulo: document.getElementById('modal-repositorio-subtitulo'),
  campoNomeRepositorio: document.getElementById('campo-nome-repositorio'),
  campoUrlRepositorio: document.getElementById('campo-url-repositorio'),
  campoCaminhoLocal: document.getElementById('campo-caminho-local'),
  botaoEscolherCaminhoLocal: document.getElementById('btn-escolher-caminho-local'),
  erroRepositorio: document.getElementById('erro-repositorio'),
  botaoSalvarRepositorio: document.getElementById('btn-salvar-repositorio'),
  botaoCancelarRepositorio: document.getElementById('btn-cancelar-repositorio'),

  modalLink: document.getElementById('modal-link'),
  formularioLink: document.getElementById('formulario-link'),
  modalLinkTitulo: document.getElementById('modal-link-titulo'),
  modalLinkSubtitulo: document.getElementById('modal-link-subtitulo'),
  campoNomeLink: document.getElementById('campo-nome-link'),
  campoUrlLink: document.getElementById('campo-url-link'),
  erroLink: document.getElementById('erro-link'),
  botaoSalvarLink: document.getElementById('btn-salvar-link'),
  botaoCancelarLink: document.getElementById('btn-cancelar-link'),

  modalImportacao: document.getElementById('modal-importacao'),
  formularioImportacao: document.getElementById('formulario-importacao'),
  modalImportacaoSubtitulo: document.getElementById('modal-importacao-subtitulo'),
  etapaImportacaoOrigem: document.getElementById('etapa-importacao-origem'),
  etapaImportacaoArquivo: document.getElementById('etapa-importacao-arquivo'),
  etapaImportacaoArvore: document.getElementById('etapa-importacao-arvore'),
  etapaImportacaoFormulario: document.getElementById('etapa-importacao-formulario'),
  etapaImportacaoPastas: document.getElementById('etapa-importacao-pastas'),
  etapaImportacaoRepositorios: document.getElementById('etapa-importacao-repositorios'),
  pastasVarridas: document.getElementById('pastas-varridas'),
  resumoDasPastasVarridas: document.getElementById('resumo-das-pastas-varridas'),
  botaoAdicionarPastaVarrida: document.getElementById('btn-adicionar-pasta-varrida'),
  repositoriosEncontrados: document.getElementById('repositorios-encontrados'),
  resumoDosRepositorios: document.getElementById('resumo-dos-repositorios'),
  botaoMarcarRepositorios: document.getElementById('btn-marcar-repositorios'),
  botaoDesmarcarRepositorios: document.getElementById('btn-desmarcar-repositorios'),
  areaDeArquivo: document.getElementById('area-de-arquivo'),
  campoArquivoDeFavoritos: document.getElementById('campo-arquivo-de-favoritos'),
  nomeDoArquivoDeFavoritos: document.getElementById('nome-do-arquivo-de-favoritos'),
  arvoreDeFavoritos: document.getElementById('arvore-de-favoritos'),
  resumoDaSelecao: document.getElementById('resumo-da-selecao'),
  botaoMarcarFavoritos: document.getElementById('btn-marcar-favoritos'),
  botaoDesmarcarFavoritos: document.getElementById('btn-desmarcar-favoritos'),
  linhasDeImportacao: document.getElementById('linhas-de-importacao'),
  etapaImportacaoArquivoDeCadastros: document.getElementById(
    'etapa-importacao-arquivo-de-cadastros',
  ),
  areaDeArquivoDeCadastros: document.getElementById('area-de-arquivo-de-cadastros'),
  campoArquivoDeCadastros: document.getElementById('campo-arquivo-de-cadastros'),
  nomeDoArquivoDeCadastros: document.getElementById('nome-do-arquivo-de-cadastros'),
  etapaImportacaoCadastros: document.getElementById('etapa-importacao-cadastros'),
  resumoDosCadastros: document.getElementById('resumo-dos-cadastros'),
  acoesDosConflitos: document.getElementById('acoes-dos-conflitos'),
  botaoManterAtuais: document.getElementById('btn-manter-atuais'),
  botaoSubstituirTodos: document.getElementById('btn-substituir-todos'),
  linhasDeCadastros: document.getElementById('linhas-de-cadastros'),
  erroImportacao: document.getElementById('erro-importacao'),
  botaoCancelarImportacao: document.getElementById('btn-cancelar-importacao'),
  botaoVoltarImportacao: document.getElementById('btn-voltar-importacao'),
  botaoAvancarImportacao: document.getElementById('btn-avancar-importacao'),
  botaoConcluirImportacao: document.getElementById('btn-concluir-importacao'),

  modalExportacao: document.getElementById('modal-exportacao'),
  modalExportacaoSubtitulo: document.getElementById('modal-exportacao-subtitulo'),
  barraDeExportacao: document.getElementById('barra-de-exportacao'),
  mestresDeExportacao: document.getElementById('mestres-de-exportacao'),
  linhasDeExportacao: document.getElementById('linhas-de-exportacao'),
  botaoFecharExportacao: document.getElementById('btn-fechar-exportacao'),
  botaoCopiarExportacao: document.getElementById('btn-copiar-exportacao'),
  botaoBaixarExportacao: document.getElementById('btn-baixar-exportacao'),

  modalExportacaoDeCadastros: document.getElementById('modal-exportacao-de-cadastros'),
  modalExportacaoDeCadastrosSubtitulo: document.getElementById(
    'modal-exportacao-de-cadastros-subtitulo',
  ),
  etapaExportacaoClientes: document.getElementById('etapa-exportacao-clientes'),
  resumoDosClientesAExportar: document.getElementById('resumo-dos-clientes-a-exportar'),
  botaoMarcarClientesAExportar: document.getElementById('btn-marcar-clientes-a-exportar'),
  botaoDesmarcarClientesAExportar: document.getElementById('btn-desmarcar-clientes-a-exportar'),
  linhasDeClientesAExportar: document.getElementById('linhas-de-clientes-a-exportar'),
  etapaExportacaoOpcoes: document.getElementById('etapa-exportacao-opcoes'),
  barraDeExportacaoDeCadastros: document.getElementById('barra-de-exportacao-de-cadastros'),
  mestresDeExportacaoDeCadastros: document.getElementById('mestres-de-exportacao-de-cadastros'),
  linhasDeExportacaoDeCadastros: document.getElementById('linhas-de-exportacao-de-cadastros'),
  erroExportacaoDeCadastros: document.getElementById('erro-exportacao-de-cadastros'),
  botaoCancelarExportacaoDeCadastros: document.getElementById(
    'btn-cancelar-exportacao-de-cadastros',
  ),
  botaoVoltarExportacaoDeCadastros: document.getElementById('btn-voltar-exportacao-de-cadastros'),
  botaoAvancarExportacaoDeCadastros: document.getElementById('btn-avancar-exportacao-de-cadastros'),
  botaoCopiarExportacaoDeCadastros: document.getElementById('btn-copiar-exportacao-de-cadastros'),
  botaoBaixarExportacaoDeCadastros: document.getElementById('btn-baixar-exportacao-de-cadastros'),

  rodapeVersao: document.getElementById('rodape-versao'),
  rodapeAtualizacao: document.getElementById('rodape-atualizacao'),

  modalExclusao: document.getElementById('modal-exclusao'),
  tituloExclusao: document.getElementById('titulo-exclusao'),
  textoExclusao: document.getElementById('texto-exclusao'),
  botaoConfirmarExclusao: document.getElementById('btn-confirmar-exclusao'),
  botaoCancelarExclusao: document.getElementById('btn-cancelar-exclusao'),
};

/* ------------------------------ acesso à API ----------------------------- */

async function requisitar(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    headers: opcoes.corpo ? { 'content-type': 'application/json' } : undefined,
    method: opcoes.metodo ?? 'GET',
    body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
  });

  if (resposta.status === 204) {
    return null;
  }

  const conteudo = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    throw new Error(conteudo?.mensagem ?? `Falha na requisição (HTTP ${resposta.status}).`);
  }

  return conteudo;
}

const api = {
  listar: () => requisitar(CAMINHO_DA_API),
  buscar: (id) => requisitar(`${CAMINHO_DA_API}/${id}`),
  criar: (nome) => requisitar(CAMINHO_DA_API, { metodo: 'POST', corpo: { nome } }),
  atualizar: (id, nome) =>
    requisitar(`${CAMINHO_DA_API}/${id}`, { metodo: 'PUT', corpo: { nome } }),
  salvarAnotacoes: (id, anotacoes) =>
    requisitar(`${CAMINHO_DA_API}/${id}/anotacoes`, { metodo: 'PUT', corpo: { anotacoes } }),
  remover: (id) => requisitar(`${CAMINHO_DA_API}/${id}`, { metodo: 'DELETE' }),

  importarFavoritos: (bases) =>
    requisitar(CAMINHO_DA_IMPORTACAO, { metodo: 'POST', corpo: { bases } }),

  importarRepositorios: (repositorios) =>
    requisitar(CAMINHO_DA_IMPORTACAO_DE_REPOSITORIOS, {
      metodo: 'POST',
      corpo: { repositorios },
    }),

  importarCadastros: (clientes) =>
    requisitar(CAMINHO_DA_IMPORTACAO_DE_CADASTROS, { metodo: 'POST', corpo: { clientes } }),

  adicionarBase: (idDoCliente, base) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/bases`, { metodo: 'POST', corpo: base }),
  atualizarBase: (idDoCliente, idDaBase, base) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/bases/${idDaBase}`, {
      metodo: 'PUT',
      corpo: base,
    }),
  removerBase: (idDoCliente, idDaBase) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/bases/${idDaBase}`, { metodo: 'DELETE' }),
  situacaoDaBaseDoCliente: (idDoCliente, idDaBase) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/bases/${idDaBase}/situacao`),

  definirBancoDeDados: (idDoCliente, idDaBase, banco) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/bases/${idDaBase}/banco`, {
      metodo: 'PUT',
      corpo: banco,
    }),
  removerBancoDeDados: (idDoCliente, idDaBase) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/bases/${idDaBase}/banco`, { metodo: 'DELETE' }),

  adicionarRepositorio: (idDoCliente, repositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios`, {
      metodo: 'POST',
      corpo: repositorio,
    }),
  atualizarRepositorio: (idDoCliente, idDoRepositorio, repositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}`, {
      metodo: 'PUT',
      corpo: repositorio,
    }),
  removerRepositorio: (idDoCliente, idDoRepositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}`, {
      metodo: 'DELETE',
    }),
  adicionarLink: (idDoCliente, link) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/links`, { metodo: 'POST', corpo: link }),
  atualizarLink: (idDoCliente, idDoLink, link) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/links/${idDoLink}`, {
      metodo: 'PUT',
      corpo: link,
    }),
  removerLink: (idDoCliente, idDoLink) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/links/${idDoLink}`, { metodo: 'DELETE' }),

  abrirPastaDoRepositorio: (idDoCliente, idDoRepositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}/abrir-pasta`, {
      metodo: 'POST',
    }),
  lerConfiguracaoMcp: (idDoCliente, idDoRepositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}/mcp`),
  salvarConfiguracaoMcp: (idDoCliente, idDoRepositorio, configuracao) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}/mcp`, {
      metodo: 'PUT',
      corpo: configuracao,
    }),

  abrirShellDoRepositorio: (idDoCliente, idDoRepositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}/abrir-shell`, {
      metodo: 'POST',
    }),

  abrirIntelliJDoRepositorio: (idDoCliente, idDoRepositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}/abrir-intellij`, {
      metodo: 'POST',
    }),

  /* `forcar` ignora o cache do servidor: é o que o botão de recarregar usa. */
  lerSituacaoGit: (forcar) =>
    requisitar(forcar ? `${CAMINHO_DA_SITUACAO_GIT}?forcar=true` : CAMINHO_DA_SITUACAO_GIT),

  lerConfiguracao: () => requisitar(CAMINHO_DA_CONFIGURACAO),
  salvarConfiguracao: (configuracao) =>
    requisitar(CAMINHO_DA_CONFIGURACAO, { metodo: 'PUT', corpo: configuracao }),
  lerConfiguracaoMcpGlobal: () => requisitar(`${CAMINHO_DA_CONFIGURACAO}/mcp`),

  abrirAtalho: (id) => requisitar(`${CAMINHO_DOS_ATALHOS}/${id}/abrir`, { metodo: 'POST' }),
  selecionarExecutavel: () =>
    requisitar(`${CAMINHO_DOS_ATALHOS}/selecionar-executavel`, { metodo: 'POST' }),

  lerVersao: () => requisitar(`${CAMINHO_DO_SISTEMA}/versao`),
  lerAtualizacao: () => requisitar(`${CAMINHO_DO_SISTEMA}/atualizacao`),
  selecionarPasta: () => requisitar(`${CAMINHO_DO_SISTEMA}/selecionar-pasta`, { metodo: 'POST' }),
  varrerRepositoriosLocais: (pastas) =>
    requisitar(`${CAMINHO_DO_SISTEMA}/repositorios-locais`, {
      metodo: 'POST',
      corpo: { pastas },
    }),

  listarBasesLocais: () => requisitar(CAMINHO_DAS_BASES_LOCAIS),
  criarBaseLocal: (dados) => requisitar(CAMINHO_DAS_BASES_LOCAIS, { metodo: 'POST', corpo: dados }),
  atualizarBaseLocal: (id, dados) =>
    requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}`, { metodo: 'PUT', corpo: dados }),
  removerBaseLocal: (id) => requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}`, { metodo: 'DELETE' }),
  iniciarBaseLocal: (id) =>
    requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}/iniciar`, { metodo: 'POST' }),
  reiniciarBaseLocal: (id) =>
    requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}/reiniciar`, { metodo: 'POST' }),
  pararBaseLocal: (id) => requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}/parar`, { metodo: 'POST' }),
  lerConfiguracaoMcpDaBaseLocal: (id) => requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}/mcp`),
  salvarConfiguracaoMcpDaBaseLocal: (id, configuracao) =>
    requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}/mcp`, { metodo: 'PUT', corpo: configuracao }),

  listarBancosLocais: () => requisitar(CAMINHO_DOS_BANCOS_LOCAIS),
  criarBancoLocal: (dados) =>
    requisitar(CAMINHO_DOS_BANCOS_LOCAIS, { metodo: 'POST', corpo: dados }),
  atualizarBancoLocal: (id, dados) =>
    requisitar(`${CAMINHO_DOS_BANCOS_LOCAIS}/${id}`, { metodo: 'PUT', corpo: dados }),
  removerBancoLocal: (id) => requisitar(`${CAMINHO_DOS_BANCOS_LOCAIS}/${id}`, { metodo: 'DELETE' }),
  iniciarBancoLocal: (id) =>
    requisitar(`${CAMINHO_DOS_BANCOS_LOCAIS}/${id}/iniciar`, { metodo: 'POST' }),
  reiniciarBancoLocal: (id) =>
    requisitar(`${CAMINHO_DOS_BANCOS_LOCAIS}/${id}/reiniciar`, { metodo: 'POST' }),
  pararBancoLocal: (id) =>
    requisitar(`${CAMINHO_DOS_BANCOS_LOCAIS}/${id}/parar`, { metodo: 'POST' }),
  situacaoDoBancoLocal: (id) => requisitar(`${CAMINHO_DOS_BANCOS_LOCAIS}/${id}/situacao`),
  situacaoDaBaseLocal: (id) => requisitar(`${CAMINHO_DAS_BASES_LOCAIS}/${id}/situacao`),
};

/* -------------------------------- auxiliares ----------------------------- */

function criarElemento(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) {
    elemento.className = classe;
  }
  if (texto !== undefined) {
    elemento.textContent = texto;
  }
  return elemento;
}

function criarBotao(classe, texto, aoClicar) {
  const botao = criarElemento('button', classe, texto);
  botao.type = 'button';
  botao.addEventListener('click', aoClicar);
  return botao;
}

function criarIcone(tracado) {
  const svg = document.createElementNS(NAMESPACE_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const caminho = document.createElementNS(NAMESPACE_SVG, 'path');
  caminho.setAttribute('d', tracado);
  svg.append(caminho);

  return svg;
}

/** Botão só com ícone: o rótulo vai para o `title` e para o leitor de tela. */
function criarBotaoDeIcone(classe, tracado, rotulo, aoClicar) {
  const botao = criarBotao(`${classe} botao-icone`, undefined, aoClicar);
  botao.append(criarIcone(tracado));
  botao.title = rotulo;
  botao.setAttribute('aria-label', rotulo);
  return botao;
}

/**
 * Link só com ícone, com a aparência de botão.
 *
 * É âncora e não `<button>` de propósito: assim o clique do meio, o Ctrl+clique
 * e o menu de contexto do navegador funcionam como o usuário espera de um link.
 */
function criarLinkDeIcone(classe, tracado, rotulo, endereco) {
  const link = criarElemento('a', `${classe} botao-icone`);
  link.href = endereco;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = rotulo;
  link.setAttribute('aria-label', rotulo);
  link.append(criarIcone(tracado));
  return link;
}

/** O servidor só aceita http/https, mas o arquivo de dados pode ter sido editado à mão. */
function ehEnderecoNavegavel(endereco) {
  try {
    const protocolo = new URL(endereco).protocol;
    return protocolo === 'http:' || protocolo === 'https:';
  } catch {
    return false;
  }
}

function exibirAviso(mensagem, tipo = 'sucesso') {
  const aviso = criarElemento('div', `aviso ${tipo}`, mensagem);
  elementos.avisos.append(aviso);
  setTimeout(() => aviso.remove(), DURACAO_DO_AVISO_MS);
}

function clientesFiltradosPorNome() {
  const filtro = estado.filtro.trim().toLocaleLowerCase('pt-BR');
  if (!filtro) {
    return estado.clientes;
  }
  return estado.clientes.filter((cliente) =>
    cliente.nome.toLocaleLowerCase('pt-BR').includes(filtro),
  );
}

/**
 * Chave do cliente nos chips de situação: a pior severidade entre os seus
 * repositórios, `sem-git` quando não há nenhum cadastrado e `desconhecido`
 * enquanto a primeira verificação do Git não voltou.
 */
function situacaoDoClienteParaFiltro(cliente) {
  if (cliente.repositorios.length === 0) {
    return SITUACAO_SEM_GIT;
  }

  return severidadeDoCliente(cliente) ?? 'desconhecido';
}

function clientesFiltrados() {
  const porNome = clientesFiltradosPorNome();
  if (estado.situacoesFiltradas.size === 0) {
    return porNome;
  }

  return porNome.filter((cliente) =>
    estado.situacoesFiltradas.has(situacaoDoClienteParaFiltro(cliente)),
  );
}

function clienteSelecionado() {
  return estado.clientes.find((cliente) => cliente.id === estado.idSelecionado);
}

/* -------------------------------- renderização --------------------------- */

function contarPorSituacao(clientes) {
  const contagens = new Map();

  for (const cliente of clientes) {
    const chave = situacaoDoClienteParaFiltro(cliente);
    contagens.set(chave, (contagens.get(chave) ?? 0) + 1);
  }

  return contagens;
}

function alternarFiltroDeSituacao(chave) {
  if (estado.situacoesFiltradas.has(chave)) {
    estado.situacoesFiltradas.delete(chave);
  } else {
    estado.situacoesFiltradas.add(chave);
  }

  renderizarLista();
}

/** Uma linha do painel: ponto colorido, rótulo e quantidade de clientes. */
function criarOpcaoDeSituacao({ chave, rotulo, descricao }, quantidade, marcado) {
  const opcao = criarBotao(marcado ? 'opcao-situacao ativo' : 'opcao-situacao', undefined, () =>
    alternarFiltroDeSituacao(chave),
  );
  opcao.title = descricao;
  opcao.setAttribute('aria-pressed', String(marcado));
  opcao.append(
    criarPontoDeSituacao(chave),
    criarElemento('span', 'opcao-rotulo', rotulo),
    criarElemento('span', 'opcao-contagem', String(quantidade)),
  );
  return opcao;
}

/**
 * Opções de situação do Git. As contagens ignoram a própria seleção — só o
 * filtro de nome as limita — senão as opções não marcadas zerariam e o usuário
 * perderia a noção de quantos clientes existem em cada cor.
 */
function renderizarFiltroDeSituacao() {
  const contagens = contarPorSituacao(clientesFiltradosPorNome());

  const opcoes = FILTROS_DE_SITUACAO.map((filtro) =>
    criarOpcaoDeSituacao(
      filtro,
      contagens.get(filtro.chave) ?? 0,
      estado.situacoesFiltradas.has(filtro.chave),
    ),
  );

  elementos.filtrosDeSituacao.replaceChildren(...opcoes);
  elementos.botaoLimparFiltros.disabled = estado.situacoesFiltradas.size === 0;
  elementos.botaoFiltros.classList.toggle('com-filtro', estado.situacoesFiltradas.size > 0);
}

function definirPainelDeFiltros(aberto) {
  elementos.painelDeFiltros.hidden = !aberto;
  elementos.botaoFiltros.setAttribute('aria-expanded', String(aberto));
}

/** O painel é um popover comum: fecha no Esc e em qualquer clique fora dele. */
function registrarFechamentoDoPainelDeFiltros() {
  document.addEventListener('click', (evento) => {
    if (elementos.painelDeFiltros.hidden) {
      return;
    }

    /*
     * `composedPath` em vez de `contains`: clicar numa opção redesenha o painel,
     * e o nó clicado já saiu do DOM quando o evento chega aqui — pelo `contains`
     * o clique pareceria ter sido fora e fecharia o painel a cada marcação.
     */
    const caminho = evento.composedPath();
    const dentro =
      caminho.includes(elementos.painelDeFiltros) || caminho.includes(elementos.botaoFiltros);

    if (!dentro) {
      definirPainelDeFiltros(false);
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && !elementos.painelDeFiltros.hidden) {
      definirPainelDeFiltros(false);
    }
  });
}

function renderizarLista() {
  renderizarFiltroDeSituacao();
  const visiveis = clientesFiltrados();
  elementos.lista.replaceChildren();

  if (visiveis.length === 0) {
    const mensagem = estado.clientes.length === 0 ? 'Nenhum cliente ainda.' : 'Nada encontrado.';
    elementos.lista.append(criarElemento('p', 'item-titulo', mensagem), criarAcoesDaLista());
    return;
  }

  for (const cliente of visiveis) {
    const item = criarBotao('item-cliente', undefined, () => selecionarCliente(cliente.id));

    if (cliente.id === estado.idSelecionado) {
      item.classList.add('ativo');
      item.setAttribute('aria-current', 'true');
    }

    const titulo = criarElemento('span', 'item-titulo');
    titulo.append(criarElemento('h2', null, cliente.nome));

    item.append(titulo);

    const severidade = severidadeDoCliente(cliente);
    if (severidade) {
      const ponto = criarPontoDeSituacao(severidade);
      ponto.title = ROTULOS_DE_SEVERIDADE[severidade];
      ponto.removeAttribute('aria-hidden');
      ponto.setAttribute('role', 'img');
      ponto.setAttribute('aria-label', `Repositórios: ${ROTULOS_DE_SEVERIDADE[severidade]}`);
      item.append(ponto);
    }

    elementos.lista.append(item);
  }

  elementos.lista.append(criarAcoesDaLista());
}

/** Abre o assistente de importação; a classe muda conforme onde o botão aparece. */
function criarBotaoDeImportacao(classe = 'btn ghost botao-da-lista') {
  const botao = criarBotao(classe, 'Importar', abrirModalDeImportacao);
  botao.prepend(criarIcone(ICONES.importar));
  return botao;
}

/**
 * Importar e Exportar no pé da lista de clientes, lado a lado.
 *
 * Sem cliente cadastrado o Exportar fica bloqueado: a primeira etapa do
 * assistente não teria nada para marcar.
 */
function criarAcoesDaLista() {
  const temCliente = estado.clientes.length > 0;

  const exportar = criarBotao(
    'btn ghost botao-da-lista',
    'Exportar',
    abrirModalDeExportacaoDeCadastros,
  );
  exportar.prepend(criarIcone(ICONES.exportar));
  exportar.disabled = !temCliente;
  exportar.title = temCliente
    ? 'Exportar cadastros de clientes para arquivo'
    : 'Nenhum cliente cadastrado para exportar';

  const acoes = criarElemento('div', 'acoes-da-lista');
  acoes.append(criarBotaoDeImportacao(), exportar);
  return acoes;
}

/** Linha com a URL e, quando ela é navegável, a seta que abre em nova aba. */
function criarLinhaDeUrl(url, classeExtra) {
  const linha = criarElemento('div', classeExtra ? `recurso-url ${classeExtra}` : 'recurso-url');
  linha.append(criarElemento('span', null, url));

  if (ehEnderecoNavegavel(url)) {
    linha.append(criarLinkDeIcone('btn tiny ghost', ICONES.seta, 'Abrir em nova aba', url));
  }

  return linha;
}

/**
 * `navigator.clipboard` só existe em contexto seguro. O `localhost` conta como
 * seguro, mas o HUB SNK pode estar sendo acessado por IP de outra máquina.
 */
async function copiarParaAreaDeTransferencia(texto, mensagemDeSucesso = 'Senha copiada.') {
  if (!navigator.clipboard) {
    exibirAviso('O navegador não liberou a área de transferência nesta página.', 'erro');
    return;
  }

  try {
    await navigator.clipboard.writeText(texto);
    exibirAviso(mensagemDeSucesso);
  } catch (erro) {
    exibirAviso(`Não foi possível copiar: ${erro.message}`, 'erro');
  }
}

/**
 * Linha "usuário • senha" com os botões de revelar e copiar.
 *
 * Nas bases de cliente a credencial é opcional, então a senha em branco vira um
 * traço: mascarar o vazio faria parecer que existe uma senha guardada.
 */
function criarLinhaDeCredencial(chaveDaSenha, usuario, senha) {
  const revelada = estado.senhasReveladas.has(chaveDaSenha);

  const linha = criarElemento('p', 'base-credencial');
  linha.append(
    criarElemento('span', null, usuario || SEM_VALOR),
    criarElemento('span', 'separador'),
  );

  if (!senha) {
    linha.append(criarElemento('span', 'base-senha', SEM_VALOR));
    return linha;
  }

  linha.append(
    criarElemento('span', 'base-senha', revelada ? senha : SENHA_MASCARADA),
    criarBotaoDeIcone(
      'btn tiny ghost',
      revelada ? ICONES.olhoFechado : ICONES.olho,
      revelada ? 'Ocultar senha' : 'Mostrar senha',
      () => {
        if (revelada) {
          estado.senhasReveladas.delete(chaveDaSenha);
        } else {
          estado.senhasReveladas.add(chaveDaSenha);
        }
        /* A mesma linha aparece nas duas telas; redesenhar só o detalhe do
         * cliente deixaria os registros locais congelados na máscara. */
        if (estado.visualizacao === 'local') {
          renderizarLocal();
        } else {
          renderizarDetalhe();
        }
      },
    ),
    criarBotaoDeIcone('btn tiny ghost', ICONES.copiar, 'Copiar senha', () =>
      copiarParaAreaDeTransferencia(senha),
    ),
  );

  return linha;
}

/**
 * Bloco de ações do recurso, em duas fileiras.
 *
 * Em cima, no canto superior direito, o que mexe no cadastro: editar e excluir,
 * com `antesDeEditar` opcional à esquerda do editar (ex.: forçar atualização de
 * status). Embaixo, separadas por uma linha, as ações que usam o recurso — abrir
 * pasta, terminal, IDE. A separação é para o clique de excluir não ficar
 * encostado nos botões de uso frequente. Sem extras, a linha separadora não
 * aparece.
 */
function criarAcoesDeRecurso({
  rotuloDeEdicao,
  aoEditar,
  rotuloDeExclusao,
  aoExcluir,
  antesDeEditar = [],
  extras = [],
}) {
  const acoes = criarElemento('div', 'recurso-acoes');

  const cadastro = criarElemento('div', 'recurso-acoes-linha');
  cadastro.append(
    ...antesDeEditar,
    criarBotaoDeIcone('btn tiny', ICONES.lapis, rotuloDeEdicao, aoEditar),
    criarBotaoDeIcone('btn tiny danger', ICONES.lixeira, rotuloDeExclusao, aoExcluir),
  );
  acoes.append(cadastro);

  if (extras.length > 0) {
    const uso = criarElemento('div', 'recurso-acoes-linha recurso-acoes-extras');
    uso.append(...extras);
    acoes.append(uso);
  }

  return acoes;
}

function criarLinhaDeBase(cliente, base) {
  const selo = criarElemento(
    'span',
    `selo-tipo ${base.tipo}`,
    ROTULOS_DE_TIPO_DE_BASE[base.tipo] ?? base.tipo,
  );

  const situacao = estado.situacoesDeBasesDeClientes[base.id];

  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarLinhaDeUrl(base.url),
    criarLinhaDeCredencial(base.id, base.usuario, base.senha),
  );
  if (situacao?.versaoDaPlataforma) {
    informacoes.append(
      criarElemento('p', 'recurso-caminho', `Versão: ${situacao.versaoDaPlataforma}`),
    );
  }

  const botaoDeBanco = criarBotaoDeIcone(
    base.bancoDeDados ? 'btn tiny vinculado' : 'btn tiny',
    ICONES.banco,
    base.bancoDeDados ? 'Editar banco de dados' : 'Vincular banco de dados',
    () => abrirModalDeBanco(cliente, base),
  );

  const acoes = criarAcoesDeRecurso({
    rotuloDeEdicao: 'Editar base',
    aoEditar: () => abrirModalDeEdicaoDeBase(cliente, base),
    rotuloDeExclusao: 'Excluir base',
    aoExcluir: () => pedirExclusaoDeBase(cliente, base),
    extras: [botaoDeBanco],
  });

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(selo, informacoes, criarBlocoDeSituacaoDaBaseDoCliente(cliente.id, base), acoes);
  return linha;
}

/** Ações que apenas disparam algo no sistema: sem recarregar a lista. */
async function executarAcaoDoSistema(acao, botao) {
  botao.disabled = true;

  try {
    await acao();
  } catch (erro) {
    exibirAviso(erro.message, 'erro');
  } finally {
    botao.disabled = false;
  }
}

/**
 * Cor do botão do MCP: verde quando o `.sankhya-mcp.env` existe com as cinco
 * variáveis preenchidas, neutro em qualquer outro caso — arquivo ausente ou
 * incompleto. O rótulo distingue os dois casos neutros.
 */
function situacaoDoMcp(cadastro) {
  const arquivo = cadastro.mcp;

  if (arquivo?.completo) {
    return { classe: 'vinculado', rotulo: `MCP configurado — ${NOME_DO_ARQUIVO_MCP} completo` };
  }

  if (arquivo?.existe) {
    return { classe: null, rotulo: `MCP incompleto — faltam variáveis no ${NOME_DO_ARQUIVO_MCP}` };
  }

  return { classe: null, rotulo: 'Banco de dados do MCP Claude' };
}

/**
 * Botões que agem sobre a pasta do repositório, na ordem em que aparecem na
 * fileira de baixo. Só fazem sentido com caminho local gravado — sem pasta não
 * há o que abrir.
 */
function criarAcoesDeUsoDoRepositorio(cliente, repositorio) {
  const botaoDeArquivos = criarBotaoDeIcone(
    'btn tiny',
    ICONES.pasta,
    `Abrir a pasta ${repositorio.caminhoLocal}`,
    () =>
      executarAcaoDoSistema(
        () => api.abrirPastaDoRepositorio(cliente.id, repositorio.id),
        botaoDeArquivos,
      ),
  );

  const botaoDeShell = criarBotaoDeIcone(
    'btn tiny',
    ICONES.terminal,
    `Abrir o terminal em ${repositorio.caminhoLocal}`,
    () =>
      executarAcaoDoSistema(
        () => api.abrirShellDoRepositorio(cliente.id, repositorio.id),
        botaoDeShell,
      ),
  );

  const botaoDeIntelliJ = criarBotaoDeIcone(
    'btn tiny',
    ICONES.intellij,
    `Abrir ${repositorio.caminhoLocal} no IntelliJ IDEA`,
    () =>
      executarAcaoDoSistema(
        () => api.abrirIntelliJDoRepositorio(cliente.id, repositorio.id),
        botaoDeIntelliJ,
      ),
  );

  const situacao = situacaoDoMcp(repositorio);
  const botaoDeMcp = criarBotaoDeIcone(
    situacao.classe ? `btn tiny ${situacao.classe}` : 'btn tiny',
    ICONES.plugue,
    situacao.rotulo,
    () => abrirModalDeMcp(alvoDoMcpDoRepositorio(cliente, repositorio)),
  );

  return [botaoDeArquivos, botaoDeShell, botaoDeIntelliJ, botaoDeMcp];
}

/* --------------------------- situação do Git ------------------------------ */

/** Bolinha colorida. A cor nunca aparece sozinha: sempre acompanha um texto. */
function criarPontoDeSituacao(severidade) {
  const ponto = criarElemento('span', `ponto-situacao ${severidade}`);
  ponto.setAttribute('aria-hidden', 'true');
  return ponto;
}

/**
 * Texto do selo: a pendência mais grave, com a contagem das demais. Mostrar as
 * seis de uma vez tornaria a lista ilegível — o resto abre no clique.
 */
function resumirSituacao(situacao) {
  const [primeira, ...demais] = situacao.pendencias;

  if (!primeira) {
    return 'Sem pendências: tudo commitado e enviado';
  }

  return demais.length === 0 ? primeira.mensagem : `${primeira.mensagem}  +${demais.length}`;
}

function descreverSituacao(situacao) {
  const hora = new Date(situacao.verificadoEm).toLocaleTimeString('pt-BR');
  const provedor =
    situacao.provedor && situacao.provedor !== 'desconhecido' ? ` • ${situacao.provedor}` : '';
  return `${ROTULOS_DE_SEVERIDADE[situacao.severidade]}${provedor} • verificado às ${hora}`;
}

function alternarPendencias(idDoRepositorio) {
  if (estado.pendenciasExpandidas.has(idDoRepositorio)) {
    estado.pendenciasExpandidas.delete(idDoRepositorio);
  } else {
    estado.pendenciasExpandidas.add(idDoRepositorio);
  }

  renderizarDetalhe();
}

function criarConteudoDoSelo(situacao) {
  const partes = [criarPontoDeSituacao(situacao.severidade)];

  if (situacao.branchAtual) {
    const branch = criarElemento('span', 'selo-branch');
    branch.append(criarIcone(ICONES.ramo), criarElemento('span', null, situacao.branchAtual));
    partes.push(branch);
  }

  partes.push(criarElemento('span', 'situacao-resumo', resumirSituacao(situacao)));

  return partes;
}

/** Sem pendência não há o que abrir: aí o selo é texto, não botão. */
function criarSeloDeSituacao(repositorio, situacao) {
  if (situacao.pendencias.length === 0) {
    const selo = criarElemento('div', `selo-situacao ${situacao.severidade}`);
    selo.title = descreverSituacao(situacao);
    selo.append(...criarConteudoDoSelo(situacao));
    return selo;
  }

  const selo = criarBotao(`selo-situacao ${situacao.severidade}`, undefined, () =>
    alternarPendencias(repositorio.id),
  );
  selo.title = descreverSituacao(situacao);
  selo.setAttribute('aria-expanded', String(estado.pendenciasExpandidas.has(repositorio.id)));
  selo.append(...criarConteudoDoSelo(situacao));
  return selo;
}

function criarListaDePendencias(situacao) {
  const lista = criarElemento('ul', 'lista-pendencias');

  for (const pendencia of situacao.pendencias) {
    const item = criarElemento('li', 'pendencia');
    item.append(
      criarPontoDeSituacao(pendencia.severidade),
      criarElemento('span', 'pendencia-mensagem', pendencia.mensagem),
    );

    if (pendencia.comandoSugerido) {
      const comando = criarElemento('div', 'pendencia-comando');
      comando.append(
        criarElemento('code', null, pendencia.comandoSugerido),
        criarBotaoDeIcone('btn tiny ghost', ICONES.copiar, 'Copiar comando', () =>
          copiarParaAreaDeTransferencia(pendencia.comandoSugerido, 'Comando copiado.'),
        ),
      );
      item.append(comando);
    }

    lista.append(item);
  }

  return lista;
}

/**
 * Repositório sem pasta local não tem o que verificar, e enquanto a rota de
 * situação não responde ainda não há nada a dizer — nos dois casos, nada é
 * desenhado em vez de um selo cinza que assustaria à toa.
 */
function criarBlocoDeSituacaoGit(repositorio) {
  const situacao = estado.situacoesGit[repositorio.id];
  if (!situacao) {
    return null;
  }

  const bloco = criarElemento('div', 'situacao-git');
  bloco.append(criarSeloDeSituacao(repositorio, situacao));

  if (estado.pendenciasExpandidas.has(repositorio.id) && situacao.pendencias.length > 0) {
    bloco.append(criarListaDePendencias(situacao));
  }

  return bloco;
}

/** Pior severidade entre os repositórios do cliente, para a lista lateral. */
function severidadeDoCliente(cliente) {
  const severidades = cliente.repositorios
    .map((repositorio) => estado.situacoesGit[repositorio.id]?.severidade)
    .filter((severidade) => severidade !== undefined);

  if (severidades.length === 0) {
    return null;
  }

  return severidades.reduce((pior, atual) =>
    ORDEM_DE_SEVERIDADE[atual] < ORDEM_DE_SEVERIDADE[pior] ? atual : pior,
  );
}

/**
 * Pior severidade entre os repositórios de todos os clientes, para o indicador
 * do cabeçalho. Ignora de propósito o filtro de situação da lista lateral: o
 * indicador vale pelo cadastro inteiro. Repositório ainda não verificado e
 * cliente sem repositório ficam de fora — só entram cores que o Git reportou.
 */
function severidadeGlobalDoGit() {
  const severidades = estado.clientes
    .flatMap((cliente) => cliente.repositorios)
    .map((repositorio) => estado.situacoesGit[repositorio.id]?.severidade)
    .filter((severidade) => SEVERIDADES_DO_INDICADOR_GLOBAL.includes(severidade));

  if (severidades.length === 0) {
    return null;
  }

  return severidades.reduce((pior, atual) =>
    ORDEM_DE_SEVERIDADE[atual] < ORDEM_DE_SEVERIDADE[pior] ? atual : pior,
  );
}

/** Bolinha do cabeçalho: pisca em vermelho ou amarelo e fica acesa em verde. */
function renderizarIndicadorGitGlobal() {
  const severidade = severidadeGlobalDoGit();
  const indicador = elementos.indicadorGitGlobal;

  indicador.hidden = severidade === null;

  if (severidade === null) {
    indicador.className = 'indicador-git-global';
    indicador.removeAttribute('title');
    indicador.removeAttribute('aria-label');
    return;
  }

  indicador.className = `indicador-git-global ${severidade}`;
  indicador.title = ROTULOS_DO_INDICADOR_GLOBAL[severidade];
  indicador.setAttribute('aria-label', ROTULOS_DO_INDICADOR_GLOBAL[severidade]);
}

function criarLinhaDeRepositorio(cliente, repositorio) {
  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', repositorio.nome),
    criarLinhaDeUrl(repositorio.url, 'secundaria'),
  );

  if (repositorio.caminhoLocal) {
    informacoes.append(criarElemento('p', 'recurso-caminho', repositorio.caminhoLocal));
  }

  const situacao = criarBlocoDeSituacaoGit(repositorio);
  if (situacao) {
    informacoes.append(situacao);
  }

  const acoes = criarAcoesDeRecurso({
    rotuloDeEdicao: 'Editar repositório',
    aoEditar: () => abrirModalDeEdicaoDeRepositorio(cliente, repositorio),
    rotuloDeExclusao: 'Excluir repositório',
    aoExcluir: () => pedirExclusaoDeRepositorio(cliente, repositorio),
    extras: repositorio.caminhoLocal ? criarAcoesDeUsoDoRepositorio(cliente, repositorio) : [],
  });

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, acoes);
  return linha;
}

/** Bloco de "Bases" ou "Repositórios": cabeçalho, botão de adicionar e as linhas. */
function criarSecaoDeRecursos({ titulo, rotuloDoBotao, aoAdicionar, linhas, mensagemVazia }) {
  const cabecalho = criarElemento('div', 'secao-cabecalho');
  cabecalho.append(
    criarElemento('h3', null, titulo),
    criarBotaoDeIcone('btn tiny primario', ICONES.mais, rotuloDoBotao, aoAdicionar),
  );

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(cabecalho);

  if (linhas.length === 0) {
    secao.append(criarElemento('p', 'secao-vazia', mensagemVazia));
    return secao;
  }

  const lista = criarElemento('div', 'lista-recursos');
  lista.append(...linhas);
  secao.append(lista);

  return secao;
}

/** Produção, teste e outro; dentro do mesmo tipo mantém a ordem de cadastro. */
function basesOrdenadasPorTipo(bases) {
  const posicaoDoTipo = (tipo) => {
    const posicao = ORDEM_DOS_TIPOS_DE_BASE.indexOf(tipo);
    return posicao === -1 ? ORDEM_DOS_TIPOS_DE_BASE.length : posicao;
  };

  return [...bases].sort((uma, outra) => posicaoDoTipo(uma.tipo) - posicaoDoTipo(outra.tipo));
}

function criarSecaoDeBases(cliente) {
  return criarSecaoDeRecursos({
    titulo: 'Bases',
    rotuloDoBotao: 'Adicionar base',
    aoAdicionar: () => abrirModalDeCadastroDeBase(cliente),
    linhas: basesOrdenadasPorTipo(cliente.bases).map((base) => criarLinhaDeBase(cliente, base)),
    mensagemVazia: 'Nenhuma base cadastrada para este cliente.',
  });
}

function criarSecaoDeRepositorios(cliente) {
  return criarSecaoDeRecursos({
    titulo: 'Repositórios',
    rotuloDoBotao: 'Adicionar repositório',
    aoAdicionar: () => abrirModalDeCadastroDeRepositorio(cliente),
    linhas: cliente.repositorios.map((repositorio) =>
      criarLinhaDeRepositorio(cliente, repositorio),
    ),
    mensagemVazia: 'Nenhum repositório cadastrado para este cliente.',
  });
}

function criarLinhaDeLink(cliente, link) {
  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', link.nome),
    criarLinhaDeUrl(link.url, 'secundaria'),
  );

  const acoes = criarAcoesDeRecurso({
    rotuloDeEdicao: 'Editar link',
    aoEditar: () => abrirModalDeEdicaoDeLink(cliente, link),
    rotuloDeExclusao: 'Excluir link',
    aoExcluir: () => pedirExclusaoDeLink(cliente, link),
  });

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, acoes);
  return linha;
}

function criarSecaoDeLinks(cliente) {
  return criarSecaoDeRecursos({
    titulo: 'Links',
    rotuloDoBotao: 'Adicionar link',
    aoAdicionar: () => abrirModalDeCadastroDeLink(cliente),
    linhas: cliente.links.map((link) => criarLinhaDeLink(cliente, link)),
    mensagemVazia: 'Nenhum link cadastrado para este cliente.',
  });
}

/** O rascunho tem precedência sobre o gravado: é o que o usuário acabou de digitar. */
function anotacoesEmExibicao(cliente) {
  const rascunho = estado.anotacoesEmEdicao;
  return rascunho?.idDoCliente === cliente.id ? rascunho.texto : (cliente.anotacoes ?? '');
}

/**
 * Bloco de anotações livres do cliente.
 *
 * Não tem botão de salvar: a gravação acontece ao sair do campo. Enquanto isso
 * o texto digitado fica no estado, e é de lá que o campo é preenchido a cada
 * redesenho do detalhe.
 */
function criarSecaoDeAnotacoes(cliente) {
  const cabecalho = criarElemento('div', 'secao-cabecalho');
  cabecalho.append(criarElemento('h3', null, 'Anotações'));

  const campo = criarElemento('textarea', 'campo-anotacoes');
  campo.id = ID_DO_CAMPO_DE_ANOTACOES;
  campo.rows = LINHAS_DO_CAMPO_DE_ANOTACOES;
  campo.maxLength = TAMANHO_MAXIMO_DAS_ANOTACOES;
  campo.placeholder = 'Anotações avulsas sobre o cliente: contatos, particularidades, combinados.';
  campo.value = anotacoesEmExibicao(cliente);

  campo.addEventListener('input', () => {
    estado.anotacoesEmEdicao = { idDoCliente: cliente.id, texto: campo.value };
  });
  campo.addEventListener('blur', () => salvarAnotacoes(cliente.id));

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(cabecalho, campo);
  return secao;
}

/** Grava o rascunho pendente do cliente, se houver e se ele mudou algo. */
async function salvarAnotacoes(idDoCliente) {
  const rascunho = estado.anotacoesEmEdicao;
  if (!rascunho || rascunho.idDoCliente !== idDoCliente) {
    return;
  }

  const cliente = estado.clientes.find((candidato) => candidato.id === idDoCliente);
  const texto = rascunho.texto.trim();
  estado.anotacoesEmEdicao = null;

  if (!cliente || texto === cliente.anotacoes) {
    return;
  }

  try {
    const atualizado = await api.salvarAnotacoes(idDoCliente, texto);
    /*
     * Só os campos que a rota altera: a resposta não traz a situação do MCP dos
     * repositórios, que vem da leitura do disco feita em `GET /api/clientes`.
     */
    cliente.anotacoes = atualizado.anotacoes;
    cliente.atualizadoEm = atualizado.atualizadoEm;
    exibirAviso('Anotações salvas.');
  } catch (erro) {
    // O rascunho volta para o estado: o texto digitado não pode se perder num erro de rede.
    estado.anotacoesEmEdicao = { idDoCliente, texto };
    exibirAviso(`Não foi possível salvar as anotações: ${erro.message}`, 'erro');
  }
}

/* ------------------------- recursos locais (visão "Local") ---------------- */

/**
 * Botão de ação ainda sem funcionalidade — só o cadastro de base/banco local é
 * funcional por enquanto. Fica desabilitado para não parecer quebrado.
 */
function criarBotaoDeAcaoNaoImplementada(tracado, rotulo) {
  const botao = criarBotaoDeIcone(
    'btn tiny',
    tracado,
    `${rotulo} (ainda não implementado)`,
    () => {},
  );
  botao.disabled = true;
  return botao;
}

/** Botão de ação de base local que, além do ciclo padrão, atualiza o selo de situação ao terminar. */
function criarBotaoDeAcaoDeBaseLocal(tracado, rotulo, acao, idDaBase) {
  const botao = criarBotaoDeIcone('btn tiny', tracado, rotulo, async () => {
    await executarAcaoDoSistema(acao, botao);
    await carregarSituacaoDaBaseLocal(idDaBase);
  });
  return botao;
}

/**
 * Recursos de janela (em vez de só `target="_blank"`) para o navegador abrir
 * uma janela própria, sem abas de navegação — mais parecido com um `tail -f`
 * dedicado do que com mais uma aba do HUB SNK.
 */
function abrirJanelaDeLogDaBase(base) {
  const endereco = `/log.html?baseId=${encodeURIComponent(base.id)}&nome=${encodeURIComponent(base.nome)}`;
  window.open(endereco, `log-base-${base.id}`, 'noopener,width=960,height=640');
}

/** Mesmo botão do repositório de cliente, agindo sobre a pasta do WildFly da base. */
function criarBotaoDeMcpDaBaseLocal(base) {
  const situacao = situacaoDoMcp(base);
  return criarBotaoDeIcone(
    situacao.classe ? `btn tiny ${situacao.classe}` : 'btn tiny',
    ICONES.plugue,
    situacao.rotulo,
    () => abrirModalDeMcp(alvoDoMcpDaBaseLocal(base)),
  );
}

/**
 * `situacao` só existe depois da primeira checagem — antes disso nenhum botão
 * é bloqueado, porque ainda não se sabe se o serviço está de pé ou não.
 */
function criarAcoesDeBaseLocal(base) {
  const situacao = estado.situacoesDeBasesLocais[base.id];
  const servicoRodando = situacao?.servicoRodando ?? false;

  const botaoIniciar = criarBotaoDeAcaoDeBaseLocal(
    ICONES.iniciar,
    'Iniciar',
    () => api.iniciarBaseLocal(base.id),
    base.id,
  );
  botaoIniciar.disabled = servicoRodando;

  const botaoParar = criarBotaoDeAcaoDeBaseLocal(
    ICONES.parar,
    'Parar',
    () => api.pararBaseLocal(base.id),
    base.id,
  );
  botaoParar.disabled = situacao != null && !servicoRodando;

  return [
    botaoIniciar,
    criarBotaoDeAcaoDeBaseLocal(
      ICONES.recarregar,
      'Reiniciar',
      () => api.reiniciarBaseLocal(base.id),
      base.id,
    ),
    botaoParar,
    criarBotaoDeIcone('btn tiny', ICONES.log, 'Abrir log', () => abrirJanelaDeLogDaBase(base)),
    criarBotaoDeMcpDaBaseLocal(base),
    criarLinkDeIcone(
      'btn tiny',
      ICONES.seta,
      'Abrir SankhyaOm',
      `http://localhost:${base.porta}/mge`,
    ),
  ];
}

/** Ação de banco local que, além do ciclo padrão, atualiza o selo de situação ao terminar. */
function criarBotaoDeAcaoDeBancoLocal(tracado, rotulo, acao, idDoBanco) {
  const botao = criarBotaoDeIcone('btn tiny', tracado, rotulo, async () => {
    await executarAcaoDoSistema(acao, botao);
    await carregarSituacaoDoBancoLocal(idDoBanco);
  });
  return botao;
}

/**
 * `situacao` só existe depois da primeira checagem — antes disso nenhum botão
 * é bloqueado, porque ainda não se sabe se o container está de pé ou não.
 */
function criarAcoesDeBancoLocal(banco) {
  const situacao = estado.situacoesDeBancosLocais[banco.id];
  const containerRodando = situacao?.containerRodando ?? false;

  const botaoIniciar = criarBotaoDeAcaoDeBancoLocal(
    ICONES.iniciar,
    'Iniciar',
    () => api.iniciarBancoLocal(banco.id),
    banco.id,
  );
  botaoIniciar.disabled = containerRodando;

  const botaoParar = criarBotaoDeAcaoDeBancoLocal(
    ICONES.parar,
    'Parar',
    () => api.pararBancoLocal(banco.id),
    banco.id,
  );
  botaoParar.disabled = situacao != null && !containerRodando;

  return [
    botaoIniciar,
    criarBotaoDeAcaoDeBancoLocal(
      ICONES.recarregar,
      'Reiniciar',
      () => api.reiniciarBancoLocal(banco.id),
      banco.id,
    ),
    botaoParar,
  ];
}

/** Severidade (mesma escala do selo) de uma amostra do histórico de situação. */
function severidadeDaAmostra(amostra) {
  if (amostra.bancoAcessivel) return 'ok';
  if (amostra.containerRodando) return 'atencao';
  return 'erro';
}

const ROTULOS_DE_SEVERIDADE_DO_BANCO = {
  ok: 'Operacional',
  atencao: 'Container ativo, banco não responde',
  erro: 'Container parado',
};

/** Severidade (mesma escala do selo) de uma amostra do histórico de situação da base local. */
function severidadeDaAmostraDaBase(amostra) {
  if (amostra.paginaInicialOk) return 'ok';
  if (amostra.servicoRodando) return 'atencao';
  return 'erro';
}

const ROTULOS_DE_SEVERIDADE_DA_BASE = {
  ok: 'Operacional',
  atencao: 'Serviço ativo, HTTP não responde',
  erro: 'Serviço parado',
};

/**
 * Selo de situação do banco local: "Verificando…" até a primeira resposta da
 * checagem, depois reflete os dois níveis — container rodando e banco
 * aceitando login com as credenciais cadastradas.
 */
function criarSeloDeSituacaoDoBancoLocal(situacao, idDoBanco) {
  if (!situacao) {
    const selo = criarElemento('div', 'selo-situacao atencao');
    selo.append(
      criarPontoDeSituacao('atencao'),
      criarElemento('span', 'situacao-resumo', 'Verificando…'),
      criarBotaoDeAtualizarStatusDoBancoLocal(idDoBanco),
    );
    return selo;
  }

  const severidade = severidadeDaAmostra(situacao);
  const rotulo = ROTULOS_DE_SEVERIDADE_DO_BANCO[severidade];

  const selo = criarElemento('div', `selo-situacao ${severidade}`);
  selo.title = rotulo;
  selo.append(
    criarPontoDeSituacao(severidade),
    criarElemento('span', 'situacao-resumo', rotulo),
    criarBotaoDeAtualizarStatusDoBancoLocal(idDoBanco),
  );
  return selo;
}

/**
 * Gráfico de uptime: uma barra por amostra do histórico, mais antiga à
 * esquerda, colorida pela mesma severidade do selo. Sem biblioteca de
 * gráfico — é uma faixa de status, não um plot de eixos.
 */
function criarGraficoDeUptimeDoBancoLocal(historico) {
  const grafico = criarElemento('div', 'grafico-uptime');

  if (!historico || historico.length === 0) {
    grafico.append(criarElemento('span', 'grafico-uptime-vazio', 'Sem histórico ainda'));
    return grafico;
  }

  for (const amostra of historico) {
    const severidade = severidadeDaAmostra(amostra);
    const barra = criarElemento('span', `barra-uptime ${severidade}`);
    const horario = new Date(amostra.em).toLocaleString('pt-BR');
    barra.title = `${horario} — ${ROTULOS_DE_SEVERIDADE_DO_BANCO[severidade]}`;
    grafico.append(barra);
  }

  return grafico;
}

/** Botão que força uma nova checagem de situação do banco, fora do intervalo automático. */
function criarBotaoDeAtualizarStatusDoBancoLocal(idDoBanco) {
  const botao = criarBotaoDeIcone('btn tiny', ICONES.recarregar, 'Atualizar status agora', () =>
    executarAcaoDoSistema(() => carregarSituacaoDoBancoLocal(idDoBanco), botao),
  );
  return botao;
}

/** Bloco de situação do banco local: selo, botão de forçar atualização e gráfico de uptime. */
function criarBlocoDeSituacaoDoBancoLocal(banco) {
  const situacao = estado.situacoesDeBancosLocais[banco.id];

  const bloco = criarElemento('div', 'situacao-banco-local');
  bloco.append(
    criarSeloDeSituacaoDoBancoLocal(situacao, banco.id),
    criarGraficoDeUptimeDoBancoLocal(situacao?.historico),
  );
  return bloco;
}

/**
 * Selo de situação da base local: "Verificando…" até a primeira resposta da
 * checagem, depois reflete os dois níveis — serviço do WildFly de pé e
 * `localhost:8080` respondendo HTTP 200.
 */
function criarSeloDeSituacaoDaBaseLocal(situacao, idDaBase) {
  if (!situacao) {
    const selo = criarElemento('div', 'selo-situacao atencao');
    selo.append(
      criarPontoDeSituacao('atencao'),
      criarElemento('span', 'situacao-resumo', 'Verificando…'),
      criarBotaoDeAtualizarStatusDaBaseLocal(idDaBase),
    );
    return selo;
  }

  const severidade = severidadeDaAmostraDaBase(situacao);
  const rotulo = ROTULOS_DE_SEVERIDADE_DA_BASE[severidade];

  const selo = criarElemento('div', `selo-situacao ${severidade}`);
  selo.title = rotulo;
  selo.append(
    criarPontoDeSituacao(severidade),
    criarElemento('span', 'situacao-resumo', rotulo),
    criarBotaoDeAtualizarStatusDaBaseLocal(idDaBase),
  );
  return selo;
}

/**
 * Gráfico de uptime da base local: uma barra por amostra do histórico, mesma
 * lógica do gráfico do banco local, colorida pela severidade do serviço.
 */
function criarGraficoDeUptimeDaBaseLocal(historico) {
  const grafico = criarElemento('div', 'grafico-uptime');

  if (!historico || historico.length === 0) {
    grafico.append(criarElemento('span', 'grafico-uptime-vazio', 'Sem histórico ainda'));
    return grafico;
  }

  for (const amostra of historico) {
    const severidade = severidadeDaAmostraDaBase(amostra);
    const barra = criarElemento('span', `barra-uptime ${severidade}`);
    const horario = new Date(amostra.em).toLocaleString('pt-BR');
    barra.title = `${horario} — ${ROTULOS_DE_SEVERIDADE_DA_BASE[severidade]}`;
    grafico.append(barra);
  }

  return grafico;
}

/** Botão que força uma nova checagem de situação da base, fora do intervalo automático. */
function criarBotaoDeAtualizarStatusDaBaseLocal(idDaBase) {
  const botao = criarBotaoDeIcone('btn tiny', ICONES.recarregar, 'Atualizar status agora', () =>
    executarAcaoDoSistema(() => carregarSituacaoDaBaseLocal(idDaBase), botao),
  );
  return botao;
}

/** Bloco de situação da base local: selo, botão de forçar atualização e gráfico de uptime. */
function criarBlocoDeSituacaoDaBaseLocal(base) {
  const situacao = estado.situacoesDeBasesLocais[base.id];

  const bloco = criarElemento('div', 'situacao-banco-local');
  bloco.append(
    criarSeloDeSituacaoDaBaseLocal(situacao, base.id),
    criarGraficoDeUptimeDaBaseLocal(situacao?.historico),
  );
  return bloco;
}

/**
 * Severidade da situação de uma base de cliente: só a URL cadastrada responde
 * ou não, dentro do tempo limite configurado — sem porta de management
 * separada como na base local, então só há dois níveis (sem "atencao"
 * intermediário, que aqui fica reservado ao estado "Verificando…").
 */
function severidadeDaAmostraDaBaseDoCliente(amostra) {
  return amostra.urlOk ? 'ok' : 'erro';
}

const ROTULOS_DE_SEVERIDADE_DA_BASE_DO_CLIENTE = {
  ok: 'Operacional',
  erro: 'Não responde',
};

/** Botão que força uma nova checagem de situação da base do cliente, fora do intervalo automático. */
function criarBotaoDeAtualizarStatusDaBaseDoCliente(idDoCliente, idDaBase) {
  const botao = criarBotaoDeIcone('btn tiny', ICONES.recarregar, 'Atualizar status agora', () =>
    executarAcaoDoSistema(() => carregarSituacaoDaBaseDoCliente(idDoCliente, idDaBase), botao),
  );
  return botao;
}

/**
 * Selo de situação da base de cliente: "Verificando…" até a primeira resposta
 * da checagem, depois reflete se a URL cadastrada respondeu dentro do tempo
 * limite configurado.
 */
function criarSeloDeSituacaoDaBaseDoCliente(situacao, idDoCliente, idDaBase) {
  if (!situacao) {
    const selo = criarElemento('div', 'selo-situacao atencao');
    selo.append(
      criarPontoDeSituacao('atencao'),
      criarElemento('span', 'situacao-resumo', 'Verificando…'),
      criarBotaoDeAtualizarStatusDaBaseDoCliente(idDoCliente, idDaBase),
    );
    return selo;
  }

  const severidade = severidadeDaAmostraDaBaseDoCliente(situacao);
  const rotulo = ROTULOS_DE_SEVERIDADE_DA_BASE_DO_CLIENTE[severidade];

  const selo = criarElemento('div', `selo-situacao ${severidade}`);
  selo.title = rotulo;
  selo.append(
    criarPontoDeSituacao(severidade),
    criarElemento('span', 'situacao-resumo', rotulo),
    criarBotaoDeAtualizarStatusDaBaseDoCliente(idDoCliente, idDaBase),
  );
  return selo;
}

/**
 * Gráfico de uptime da base de cliente: uma barra por amostra do histórico,
 * mesma lógica dos gráficos de banco/base locais.
 */
function criarGraficoDeUptimeDaBaseDoCliente(historico) {
  const grafico = criarElemento('div', 'grafico-uptime');

  if (!historico || historico.length === 0) {
    grafico.append(criarElemento('span', 'grafico-uptime-vazio', 'Sem histórico ainda'));
    return grafico;
  }

  for (const amostra of historico) {
    const severidade = severidadeDaAmostraDaBaseDoCliente(amostra);
    const barra = criarElemento('span', `barra-uptime ${severidade}`);
    const horario = new Date(amostra.em).toLocaleString('pt-BR');
    barra.title = `${horario} — ${ROTULOS_DE_SEVERIDADE_DA_BASE_DO_CLIENTE[severidade]}`;
    grafico.append(barra);
  }

  return grafico;
}

/** Bloco de situação da base de cliente: selo, botão de forçar atualização e gráfico de uptime. */
function criarBlocoDeSituacaoDaBaseDoCliente(idDoCliente, base) {
  const situacao = estado.situacoesDeBasesDeClientes[base.id];

  const bloco = criarElemento('div', 'situacao-banco-local');
  bloco.append(
    criarSeloDeSituacaoDaBaseDoCliente(situacao, idDoCliente, base.id),
    criarGraficoDeUptimeDaBaseDoCliente(situacao?.historico),
  );
  return bloco;
}

function criarLinhaDeBaseLocal(base) {
  const situacao = estado.situacoesDeBasesLocais[base.id];

  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', base.nome),
    criarElemento('p', 'recurso-caminho', base.caminhoWildfly),
    criarElemento('p', 'recurso-caminho', `Porta: ${base.porta}`),
  );
  if (situacao?.versaoDaPlataforma) {
    informacoes.append(
      criarElemento('p', 'recurso-caminho', `Versão: ${situacao.versaoDaPlataforma}`),
    );
  }

  const acoes = criarAcoesDeRecurso({
    rotuloDeEdicao: 'Editar base',
    aoEditar: () => abrirModalDeEdicaoDeBaseLocal(base),
    rotuloDeExclusao: 'Excluir base',
    aoExcluir: () => pedirExclusaoDeBaseLocal(base),
    extras: criarAcoesDeBaseLocal(base),
  });

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, criarBlocoDeSituacaoDaBaseLocal(base), acoes);
  return linha;
}

function criarLinhaDeBancoLocal(banco) {
  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', banco.container),
    criarLinhaDeUrl(`${banco.host}:${banco.porta}/${banco.nomeDoServico}`),
    criarLinhaDeCredencial(banco.id, banco.usuario, banco.senha),
  );

  const acoes = criarAcoesDeRecurso({
    rotuloDeEdicao: 'Editar banco',
    aoEditar: () => abrirModalDeEdicaoDeBancoLocal(banco),
    rotuloDeExclusao: 'Excluir banco',
    aoExcluir: () => pedirExclusaoDeBancoLocal(banco),
    extras: criarAcoesDeBancoLocal(banco),
  });

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, criarBlocoDeSituacaoDoBancoLocal(banco), acoes);
  return linha;
}

function renderizarLocal() {
  elementos.secaoBasesLocais.replaceChildren(
    criarSecaoDeRecursos({
      titulo: 'Bases',
      rotuloDoBotao: 'Adicionar base',
      aoAdicionar: abrirModalDeCadastroDeBaseLocal,
      linhas: estado.basesLocais.map(criarLinhaDeBaseLocal),
      mensagemVazia: 'Nenhuma base local cadastrada.',
    }),
  );

  elementos.secaoBancosLocais.replaceChildren(
    criarSecaoDeRecursos({
      titulo: 'Bancos de dados',
      rotuloDoBotao: 'Adicionar banco',
      aoAdicionar: abrirModalDeCadastroDeBancoLocal,
      linhas: estado.bancosLocais.map(criarLinhaDeBancoLocal),
      mensagemVazia: 'Nenhum banco de dados local cadastrado.',
    }),
  );
}

/** Busca a situação de um banco local e só redesenha se a resposta ainda for relevante. */
async function carregarSituacaoDoBancoLocal(idDoBanco) {
  try {
    estado.situacoesDeBancosLocais[idDoBanco] = await api.situacaoDoBancoLocal(idDoBanco);
  } catch {
    delete estado.situacoesDeBancosLocais[idDoBanco];
  }

  if (estado.bancosLocais.some((banco) => banco.id === idDoBanco)) {
    renderizarLocal();
  }
}

/** Dispara a checagem de situação de cada banco local em paralelo, sem travar o desenho da lista. */
function carregarSituacoesDosBancosLocais() {
  for (const banco of estado.bancosLocais) {
    carregarSituacaoDoBancoLocal(banco.id);
  }
}

/** Busca a situação de uma base local e só redesenha se a resposta ainda for relevante. */
async function carregarSituacaoDaBaseLocal(idDaBase) {
  try {
    estado.situacoesDeBasesLocais[idDaBase] = await api.situacaoDaBaseLocal(idDaBase);
  } catch {
    delete estado.situacoesDeBasesLocais[idDaBase];
  }

  if (estado.basesLocais.some((base) => base.id === idDaBase)) {
    renderizarLocal();
  }
}

/** Dispara a checagem de situação de cada base local em paralelo, sem travar o desenho da lista. */
function carregarSituacoesDasBasesLocais() {
  for (const base of estado.basesLocais) {
    carregarSituacaoDaBaseLocal(base.id);
  }
}

/** Busca a situação de uma base de cliente e só redesenha se a resposta ainda for relevante. */
async function carregarSituacaoDaBaseDoCliente(idDoCliente, idDaBase) {
  try {
    estado.situacoesDeBasesDeClientes[idDaBase] = await api.situacaoDaBaseDoCliente(
      idDoCliente,
      idDaBase,
    );
  } catch {
    delete estado.situacoesDeBasesDeClientes[idDaBase];
  }

  if (estado.idSelecionado === idDoCliente) {
    renderizarDetalhe();
  }
}

/** Dispara a checagem de situação de cada base do cliente selecionado, em paralelo. */
function carregarSituacoesDasBasesDoClienteSelecionado() {
  const cliente = clienteSelecionado();
  if (!cliente) {
    return;
  }

  for (const base of cliente.bases) {
    carregarSituacaoDaBaseDoCliente(cliente.id, base.id);
  }
}

/**
 * Relê só o cadastro das bases locais, preservando as situações já coletadas —
 * ao contrário de `carregarLocal`, que zera os históricos de uptime.
 */
async function recarregarBasesLocais() {
  estado.basesLocais = await api.listarBasesLocais();
  renderizarLocal();
}

async function carregarLocal() {
  try {
    [estado.basesLocais, estado.bancosLocais] = await Promise.all([
      api.listarBasesLocais(),
      api.listarBancosLocais(),
    ]);
  } catch (erro) {
    exibirAviso(`Não foi possível carregar a visão local: ${erro.message}`, 'erro');
    return;
  }

  estado.situacoesDeBancosLocais = {};
  estado.situacoesDeBasesLocais = {};
  renderizarLocal();
  carregarSituacoesDosBancosLocais();
  carregarSituacoesDasBasesLocais();
}

/** Troca entre as visões "Clientes" e "Local", refletindo na chave e no conteúdo visível. */
function alternarVisualizacao(visualizacao) {
  estado.visualizacao = visualizacao;

  const emClientes = visualizacao === 'clientes';
  elementos.visualizacaoClientes.hidden = !emClientes;
  elementos.visualizacaoLocal.hidden = emClientes;

  elementos.botaoVisualizacaoClientes.classList.toggle('ativo', emClientes);
  elementos.botaoVisualizacaoClientes.setAttribute('aria-pressed', String(emClientes));
  elementos.botaoVisualizacaoLocal.classList.toggle('ativo', !emClientes);
  elementos.botaoVisualizacaoLocal.setAttribute('aria-pressed', String(!emClientes));

  if (!emClientes) {
    carregarLocal();
  }
}

function renderizarDetalheVazio() {
  const vazio = criarElemento('div', 'vazio');

  if (estado.clientes.length === 0) {
    const acoes = criarElemento('div', 'vazio-acoes');
    acoes.append(
      criarBotao('btn primario', 'Cadastrar cliente', abrirModalDeCadastro),
      criarBotaoDeImportacao('btn botao-com-icone'),
    );

    vazio.append(
      criarElemento('h2', null, 'Nenhum cliente cadastrado'),
      criarElemento(
        'p',
        null,
        'Cadastre o primeiro cliente ou importe de uma vez os favoritos do navegador e os repositórios já clonados na máquina.',
      ),
      acoes,
    );
  } else {
    vazio.append(
      criarElemento('h2', null, 'Nenhum cliente selecionado'),
      criarElemento('p', null, 'Escolha um cliente na lista à esquerda para ver os detalhes.'),
    );
  }

  elementos.detalhe.replaceChildren(vazio);
}

/** Sem base cadastrada não há o que compartilhar: o botão fica bloqueado e explica o porquê. */
function criarBotaoDeExportacaoDeBases(cliente) {
  const temBase = cliente.bases.length > 0;
  const botao = criarBotaoDeIcone(
    'btn',
    ICONES.compartilhar,
    temBase ? 'Compartilhar informações de bases' : 'Nenhuma base cadastrada para compartilhar',
    () => abrirModalDeExportacao(cliente),
  );
  botao.disabled = !temBase;
  return botao;
}

/**
 * Onde o cursor estava no campo de anotações, ou `null` se ele não tinha o foco.
 *
 * O detalhe é redesenhado do zero em situações que não partem do usuário — a
 * atualização automática do Git, por exemplo. Sem devolver o foco e o cursor, a
 * digitação seria interrompida no meio.
 */
function posicaoDoCursorNasAnotacoes() {
  const campo = document.getElementById(ID_DO_CAMPO_DE_ANOTACOES);
  if (!campo || campo !== document.activeElement) {
    return null;
  }

  return { inicio: campo.selectionStart, fim: campo.selectionEnd };
}

function restaurarCursorNasAnotacoes(posicao) {
  if (!posicao) {
    return;
  }

  const campo = document.getElementById(ID_DO_CAMPO_DE_ANOTACOES);
  if (!campo) {
    return;
  }

  campo.focus();
  campo.setSelectionRange(posicao.inicio, posicao.fim);
}

function renderizarDetalhe() {
  const cliente = clienteSelecionado();
  if (!cliente) {
    renderizarDetalheVazio();
    return;
  }

  const cursorNasAnotacoes = posicaoDoCursorNasAnotacoes();

  const identidade = criarElemento('div', 'detalhe-identidade');
  identidade.append(criarElemento('h2', null, cliente.nome));

  const acoes = criarElemento('div', 'detalhe-acoes');
  acoes.append(
    criarBotaoDeIcone('btn', ICONES.recarregar, 'Recarregar informações do cliente', () =>
      recarregarDetalhe(cliente.id),
    ),
    criarBotaoDeExportacaoDeBases(cliente),
    criarBotaoDeIcone('btn', ICONES.lapis, 'Editar cliente', () => abrirModalDeEdicao(cliente)),
    criarBotaoDeIcone('btn danger', ICONES.lixeira, 'Excluir cliente', () =>
      pedirExclusaoDeCliente(cliente),
    ),
  );

  const cabecalho = criarElemento('div', 'detalhe-cabecalho');
  cabecalho.append(identidade, acoes);

  const card = criarElemento('div', 'card');
  card.append(
    cabecalho,
    criarSecaoDeBases(cliente),
    criarSecaoDeRepositorios(cliente),
    criarSecaoDeLinks(cliente),
    criarSecaoDeAnotacoes(cliente),
  );
  elementos.detalhe.replaceChildren(card);
  restaurarCursorNasAnotacoes(cursorNasAnotacoes);
}

function renderizar() {
  renderizarLista();
  renderizarDetalhe();
  renderizarIndicadorGitGlobal();
}

/* -------------------------------- formulários ----------------------------- */

function limparErro(elementoDeErro) {
  elementoDeErro.hidden = true;
  elementoDeErro.textContent = '';
}

function exibirErro(elementoDeErro, mensagem) {
  elementoDeErro.textContent = mensagem;
  elementoDeErro.hidden = false;
}

function abrirModalDeCadastro() {
  estado.clienteEmEdicao = null;
  elementos.modalTitulo.textContent = 'Cadastrar cliente';
  elementos.modalSubtitulo.textContent = 'Informe o nome do cliente.';
  elementos.campoNome.value = '';
  limparErro(elementos.erroCliente);
  elementos.modalCliente.showModal();
  elementos.campoNome.focus();
}

function abrirModalDeEdicao(cliente) {
  estado.clienteEmEdicao = cliente;
  elementos.modalTitulo.textContent = 'Editar cliente';
  elementos.modalSubtitulo.textContent = 'Altere o nome do cliente.';
  elementos.campoNome.value = cliente.nome;
  limparErro(elementos.erroCliente);
  elementos.modalCliente.showModal();
  elementos.campoNome.select();
}

async function salvarCliente(evento) {
  evento.preventDefault();

  const nome = elementos.campoNome.value.trim();
  if (!nome) {
    exibirErro(elementos.erroCliente, 'Informe o nome do cliente.');
    return;
  }

  limparErro(elementos.erroCliente);
  elementos.botaoSalvarCliente.disabled = true;

  try {
    const emEdicao = estado.clienteEmEdicao;
    const cliente = emEdicao ? await api.atualizar(emEdicao.id, nome) : await api.criar(nome);

    estado.idSelecionado = cliente.id;
    await recarregarClientes();
    elementos.modalCliente.close();
    exibirAviso(emEdicao ? 'Cliente atualizado.' : 'Cliente cadastrado.');
  } catch (erro) {
    exibirErro(elementos.erroCliente, erro.message);
  } finally {
    elementos.botaoSalvarCliente.disabled = false;
  }
}

/** Toggle genérico de mostrar/ocultar senha, reaproveitado pelos dois campos de token. */
function definirVisibilidadeDoCampo(campo, botao, visivel) {
  const rotulo = visivel ? 'Ocultar' : 'Mostrar';

  campo.type = visivel ? 'text' : 'password';
  botao.replaceChildren(criarIcone(visivel ? ICONES.olhoFechado : ICONES.olho));
  botao.title = rotulo;
  botao.setAttribute('aria-label', rotulo);
  botao.setAttribute('aria-pressed', String(visivel));
}

function definirVisibilidadeDaSenha(visivel) {
  const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';

  elementos.campoSenha.type = visivel ? 'text' : 'password';
  elementos.botaoVerSenha.replaceChildren(criarIcone(visivel ? ICONES.olhoFechado : ICONES.olho));
  elementos.botaoVerSenha.title = rotulo;
  elementos.botaoVerSenha.setAttribute('aria-label', rotulo);
  elementos.botaoVerSenha.setAttribute('aria-pressed', String(visivel));
}

function abrirModalDeBase(cliente, base) {
  estado.clienteDaBaseEmEdicao = cliente;
  estado.baseEmEdicao = base;

  elementos.modalBaseTitulo.textContent = base ? 'Editar base' : 'Cadastrar base';
  elementos.modalBaseSubtitulo.textContent = `Cliente: ${cliente.nome}`;
  elementos.campoUrl.value = base?.url ?? '';
  elementos.campoTipo.value = base?.tipo ?? 'producao';
  elementos.campoUsuario.value = base?.usuario ?? '';
  elementos.campoSenha.value = base?.senha ?? '';

  definirVisibilidadeDaSenha(false);
  limparErro(elementos.erroBase);
  elementos.modalBase.showModal();
  elementos.campoUrl.focus();
}

function abrirModalDeCadastroDeBase(cliente) {
  abrirModalDeBase(cliente, null);
}

function abrirModalDeEdicaoDeBase(cliente, base) {
  abrirModalDeBase(cliente, base);
}

function lerFormularioDeBase() {
  return {
    url: elementos.campoUrl.value.trim(),
    tipo: elementos.campoTipo.value,
    usuario: elementos.campoUsuario.value.trim(),
    senha: elementos.campoSenha.value,
  };
}

function validarFormularioDeBase(dados) {
  if (!dados.url) {
    return 'Informe a URL da base.';
  }

  try {
    const protocolo = new URL(dados.url).protocol;
    if (protocolo !== 'http:' && protocolo !== 'https:') {
      return 'Informe uma URL http ou https válida.';
    }
  } catch {
    return 'Informe uma URL http ou https válida.';
  }

  /* Usuário e senha são opcionais: há base cadastrada só para abrir a URL. */
  return null;
}

async function salvarBase(evento) {
  evento.preventDefault();

  const dados = lerFormularioDeBase();
  const mensagemDeErro = validarFormularioDeBase(dados);
  if (mensagemDeErro) {
    exibirErro(elementos.erroBase, mensagemDeErro);
    return;
  }

  limparErro(elementos.erroBase);
  elementos.botaoSalvarBase.disabled = true;

  try {
    const cliente = estado.clienteDaBaseEmEdicao;
    const emEdicao = estado.baseEmEdicao;

    if (emEdicao) {
      await api.atualizarBase(cliente.id, emEdicao.id, dados);
    } else {
      await api.adicionarBase(cliente.id, dados);
    }

    await recarregarClientes();
    elementos.modalBase.close();
    exibirAviso(emEdicao ? 'Base atualizada.' : 'Base cadastrada.');
  } catch (erro) {
    exibirErro(elementos.erroBase, erro.message);
  } finally {
    elementos.botaoSalvarBase.disabled = false;
  }
}

function definirVisibilidadeDaSenhaDoBanco(visivel) {
  const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';

  elementos.campoSenhaBanco.type = visivel ? 'text' : 'password';
  elementos.botaoVerSenhaBanco.replaceChildren(
    criarIcone(visivel ? ICONES.olhoFechado : ICONES.olho),
  );
  elementos.botaoVerSenhaBanco.title = rotulo;
  elementos.botaoVerSenhaBanco.setAttribute('aria-label', rotulo);
  elementos.botaoVerSenhaBanco.setAttribute('aria-pressed', String(visivel));
}

function abrirModalDeBanco(cliente, base) {
  const banco = base.bancoDeDados;

  estado.clienteDoBancoEmEdicao = cliente;
  estado.baseDoBancoEmEdicao = base;

  elementos.modalBancoTitulo.textContent = banco
    ? 'Editar banco de dados'
    : 'Vincular banco de dados';
  elementos.modalBancoSubtitulo.textContent = `Base: ${base.url}`;
  elementos.campoHost.value = banco?.host ?? '';
  elementos.campoPorta.value = banco?.porta ?? PORTA_PADRAO_DO_BANCO;
  elementos.campoServico.value = banco?.nomeDoServico ?? '';
  elementos.campoUsuarioBanco.value = banco?.usuario ?? '';
  elementos.campoSenhaBanco.value = banco?.senha ?? '';
  elementos.botaoDesvincularBanco.hidden = !banco;

  definirVisibilidadeDaSenhaDoBanco(false);
  limparErro(elementos.erroBanco);
  elementos.modalBanco.showModal();
  elementos.campoHost.focus();
}

function lerFormularioDeBanco() {
  return {
    host: elementos.campoHost.value.trim(),
    porta: elementos.campoPorta.value.trim(),
    nomeDoServico: elementos.campoServico.value.trim(),
    usuario: elementos.campoUsuarioBanco.value.trim(),
    senha: elementos.campoSenhaBanco.value,
  };
}

function validarFormularioDeBanco(dados) {
  if (!dados.host) {
    return 'Informe o host do banco.';
  }

  const porta = Number(dados.porta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    return 'A porta deve ser um número inteiro entre 1 e 65535.';
  }

  if (!dados.nomeDoServico) {
    return 'Informe o service name.';
  }

  if (!dados.usuario) {
    return 'Informe o usuário do banco.';
  }

  if (!dados.senha) {
    return 'Informe a senha do banco.';
  }

  return null;
}

async function salvarBanco(evento) {
  evento.preventDefault();

  const dados = lerFormularioDeBanco();
  const mensagemDeErro = validarFormularioDeBanco(dados);
  if (mensagemDeErro) {
    exibirErro(elementos.erroBanco, mensagemDeErro);
    return;
  }

  limparErro(elementos.erroBanco);
  elementos.botaoSalvarBanco.disabled = true;

  try {
    await api.definirBancoDeDados(estado.clienteDoBancoEmEdicao.id, estado.baseDoBancoEmEdicao.id, {
      ...dados,
      porta: Number(dados.porta),
    });

    await recarregarClientes();
    elementos.modalBanco.close();
    exibirAviso('Banco de dados salvo.');
  } catch (erro) {
    exibirErro(elementos.erroBanco, erro.message);
  } finally {
    elementos.botaoSalvarBanco.disabled = false;
  }
}

async function desvincularBanco() {
  elementos.botaoDesvincularBanco.disabled = true;

  try {
    await api.removerBancoDeDados(estado.clienteDoBancoEmEdicao.id, estado.baseDoBancoEmEdicao.id);

    await recarregarClientes();
    elementos.modalBanco.close();
    exibirAviso('Banco de dados desvinculado.');
  } catch (erro) {
    exibirErro(elementos.erroBanco, erro.message);
  } finally {
    elementos.botaoDesvincularBanco.disabled = false;
  }
}

/* --------------------------- base e banco locais --------------------------- */

function abrirModalDeBaseLocal(base) {
  estado.baseLocalEmEdicao = base;

  elementos.modalBaseLocalTitulo.textContent = base ? 'Editar base' : 'Cadastrar base';
  elementos.campoNomeBaseLocal.value = base?.nome ?? '';
  elementos.campoCaminhoWildfly.value = base?.caminhoWildfly ?? '';
  elementos.campoPortaBaseLocal.value = base?.porta ?? '';

  limparErro(elementos.erroBaseLocal);
  elementos.modalBaseLocal.showModal();
  elementos.campoNomeBaseLocal.focus();
}

/**
 * Preenche o caminho do WildFly com a pasta escolhida no seletor do sistema.
 *
 * O campo continua editável: dá para colar um caminho ou ajustar o que veio do
 * seletor.
 */
async function escolherCaminhoDoWildfly() {
  elementos.botaoEscolherCaminhoWildfly.disabled = true;

  try {
    const escolha = await api.selecionarPasta();
    // Sem resposta o usuário cancelou: o que já estava digitado continua valendo.
    if (escolha?.caminho) {
      elementos.campoCaminhoWildfly.value = escolha.caminho;
    }
  } catch (erro) {
    exibirErro(elementos.erroBaseLocal, erro.message);
  } finally {
    elementos.botaoEscolherCaminhoWildfly.disabled = false;
  }
}

function abrirModalDeCadastroDeBaseLocal() {
  abrirModalDeBaseLocal(null);
}

function abrirModalDeEdicaoDeBaseLocal(base) {
  abrirModalDeBaseLocal(base);
}

async function salvarBaseLocal(evento) {
  evento.preventDefault();

  const dados = {
    nome: elementos.campoNomeBaseLocal.value.trim(),
    caminhoWildfly: elementos.campoCaminhoWildfly.value.trim(),
    porta: elementos.campoPortaBaseLocal.value.trim(),
  };

  if (!dados.nome) {
    exibirErro(elementos.erroBaseLocal, 'Informe o nome da base.');
    return;
  }

  if (!dados.caminhoWildfly) {
    exibirErro(elementos.erroBaseLocal, 'Informe o caminho do WildFly.');
    return;
  }

  const porta = Number(dados.porta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    exibirErro(elementos.erroBaseLocal, 'A porta deve ser um número inteiro entre 1 e 65535.');
    return;
  }

  limparErro(elementos.erroBaseLocal);
  elementos.botaoSalvarBaseLocal.disabled = true;

  try {
    const emEdicao = estado.baseLocalEmEdicao;
    const dadosComPortaNumerica = { ...dados, porta };

    if (emEdicao) {
      await api.atualizarBaseLocal(emEdicao.id, dadosComPortaNumerica);
    } else {
      await api.criarBaseLocal(dadosComPortaNumerica);
    }

    await carregarLocal();
    elementos.modalBaseLocal.close();
    exibirAviso(emEdicao ? 'Base atualizada.' : 'Base cadastrada.');
  } catch (erro) {
    exibirErro(elementos.erroBaseLocal, erro.message);
  } finally {
    elementos.botaoSalvarBaseLocal.disabled = false;
  }
}

function pedirExclusaoDeBaseLocal(base) {
  pedirExclusao(
    'Excluir base',
    `Excluir a base "${base.nome}"? Esta ação não pode ser desfeita.`,
    () => api.removerBaseLocal(base.id),
    'Base excluída.',
    carregarLocal,
  );
}

function definirVisibilidadeDaSenhaDoBancoLocal(visivel) {
  const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';

  elementos.campoSenhaBancoLocal.type = visivel ? 'text' : 'password';
  elementos.botaoVerSenhaBancoLocal.replaceChildren(
    criarIcone(visivel ? ICONES.olhoFechado : ICONES.olho),
  );
  elementos.botaoVerSenhaBancoLocal.title = rotulo;
  elementos.botaoVerSenhaBancoLocal.setAttribute('aria-label', rotulo);
  elementos.botaoVerSenhaBancoLocal.setAttribute('aria-pressed', String(visivel));
}

function abrirModalDeBancoLocal(banco) {
  estado.bancoLocalEmEdicao = banco;

  elementos.modalBancoLocalTitulo.textContent = banco
    ? 'Editar banco de dados'
    : 'Cadastrar banco de dados';
  elementos.campoContainerLocal.value = banco?.container ?? '';
  elementos.campoHostLocal.value = banco?.host ?? '';
  elementos.campoPortaLocal.value = banco?.porta ?? PORTA_PADRAO_DO_BANCO;
  elementos.campoServicoLocal.value = banco?.nomeDoServico ?? '';
  elementos.campoUsuarioBancoLocal.value = banco?.usuario ?? '';
  elementos.campoSenhaBancoLocal.value = banco?.senha ?? '';

  definirVisibilidadeDaSenhaDoBancoLocal(false);
  limparErro(elementos.erroBancoLocal);
  elementos.modalBancoLocal.showModal();
  elementos.campoContainerLocal.focus();
}

function abrirModalDeCadastroDeBancoLocal() {
  abrirModalDeBancoLocal(null);
}

function abrirModalDeEdicaoDeBancoLocal(banco) {
  abrirModalDeBancoLocal(banco);
}

function lerFormularioDeBancoLocal() {
  return {
    container: elementos.campoContainerLocal.value.trim(),
    host: elementos.campoHostLocal.value.trim(),
    porta: elementos.campoPortaLocal.value.trim(),
    nomeDoServico: elementos.campoServicoLocal.value.trim(),
    usuario: elementos.campoUsuarioBancoLocal.value.trim(),
    senha: elementos.campoSenhaBancoLocal.value,
  };
}

function validarFormularioDeBancoLocal(dados) {
  if (!dados.container) {
    return 'Informe o container.';
  }

  if (!dados.host) {
    return 'Informe o host do banco.';
  }

  const porta = Number(dados.porta);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    return 'A porta deve ser um número inteiro entre 1 e 65535.';
  }

  if (!dados.nomeDoServico) {
    return 'Informe o service name.';
  }

  if (!dados.usuario) {
    return 'Informe o usuário do banco.';
  }

  if (!dados.senha) {
    return 'Informe a senha do banco.';
  }

  return null;
}

async function salvarBancoLocal(evento) {
  evento.preventDefault();

  const dados = lerFormularioDeBancoLocal();
  const mensagemDeErro = validarFormularioDeBancoLocal(dados);
  if (mensagemDeErro) {
    exibirErro(elementos.erroBancoLocal, mensagemDeErro);
    return;
  }

  limparErro(elementos.erroBancoLocal);
  elementos.botaoSalvarBancoLocal.disabled = true;

  try {
    const emEdicao = estado.bancoLocalEmEdicao;
    const dadosComPortaNumerica = { ...dados, porta: Number(dados.porta) };

    if (emEdicao) {
      await api.atualizarBancoLocal(emEdicao.id, dadosComPortaNumerica);
    } else {
      await api.criarBancoLocal(dadosComPortaNumerica);
    }

    await carregarLocal();
    elementos.modalBancoLocal.close();
    exibirAviso(emEdicao ? 'Banco atualizado.' : 'Banco cadastrado.');
  } catch (erro) {
    exibirErro(elementos.erroBancoLocal, erro.message);
  } finally {
    elementos.botaoSalvarBancoLocal.disabled = false;
  }
}

function pedirExclusaoDeBancoLocal(banco) {
  pedirExclusao(
    'Excluir banco',
    `Excluir o banco "${banco.host}:${banco.porta}/${banco.nomeDoServico}"? Esta ação não pode ser desfeita.`,
    () => api.removerBancoLocal(banco.id),
    'Banco excluído.',
    carregarLocal,
  );
}

function abrirModalDeRepositorio(cliente, repositorio) {
  estado.clienteDoRepositorioEmEdicao = cliente;
  estado.repositorioEmEdicao = repositorio;

  elementos.modalRepositorioTitulo.textContent = repositorio
    ? 'Editar repositório'
    : 'Cadastrar repositório';
  elementos.modalRepositorioSubtitulo.textContent = `Cliente: ${cliente.nome}`;
  elementos.campoNomeRepositorio.value = repositorio?.nome ?? '';
  elementos.campoUrlRepositorio.value = repositorio?.url ?? '';
  elementos.campoCaminhoLocal.value = repositorio?.caminhoLocal ?? '';

  limparErro(elementos.erroRepositorio);
  elementos.modalRepositorio.showModal();
  elementos.campoNomeRepositorio.focus();
}

/**
 * Preenche o caminho local com a pasta escolhida no seletor do sistema.
 *
 * O campo continua editável: dá para colar um caminho, ajustar o que veio do
 * seletor ou cadastrar uma pasta que ainda não foi clonada.
 */
async function escolherCaminhoLocalDoRepositorio() {
  elementos.botaoEscolherCaminhoLocal.disabled = true;

  try {
    const escolha = await api.selecionarPasta();
    // Sem resposta o usuário cancelou: o que já estava digitado continua valendo.
    if (escolha?.caminho) {
      elementos.campoCaminhoLocal.value = escolha.caminho;
    }
  } catch (erro) {
    exibirErro(elementos.erroRepositorio, erro.message);
  } finally {
    elementos.botaoEscolherCaminhoLocal.disabled = false;
  }
}

function abrirModalDeCadastroDeRepositorio(cliente) {
  abrirModalDeRepositorio(cliente, null);
}

function abrirModalDeEdicaoDeRepositorio(cliente, repositorio) {
  abrirModalDeRepositorio(cliente, repositorio);
}

async function salvarRepositorio(evento) {
  evento.preventDefault();

  const dados = {
    nome: elementos.campoNomeRepositorio.value.trim(),
    url: elementos.campoUrlRepositorio.value.trim(),
    caminhoLocal: elementos.campoCaminhoLocal.value.trim(),
  };

  if (!dados.nome) {
    exibirErro(elementos.erroRepositorio, 'Informe o nome do repositório.');
    return;
  }

  if (!dados.url) {
    exibirErro(elementos.erroRepositorio, 'Informe a URL do repositório.');
    return;
  }

  if (!ehEnderecoNavegavel(dados.url)) {
    exibirErro(elementos.erroRepositorio, 'Informe uma URL http ou https válida.');
    return;
  }

  limparErro(elementos.erroRepositorio);
  elementos.botaoSalvarRepositorio.disabled = true;

  try {
    const cliente = estado.clienteDoRepositorioEmEdicao;
    const emEdicao = estado.repositorioEmEdicao;

    if (emEdicao) {
      await api.atualizarRepositorio(cliente.id, emEdicao.id, dados);
    } else {
      await api.adicionarRepositorio(cliente.id, dados);
    }

    await recarregarClientes();
    elementos.modalRepositorio.close();
    exibirAviso(emEdicao ? 'Repositório atualizado.' : 'Repositório cadastrado.');
  } catch (erro) {
    exibirErro(elementos.erroRepositorio, erro.message);
  } finally {
    elementos.botaoSalvarRepositorio.disabled = false;
  }
}

/* ------------------------------ links do cliente -------------------------- */

function abrirModalDeLink(cliente, link) {
  estado.clienteDoLinkEmEdicao = cliente;
  estado.linkEmEdicao = link;

  elementos.modalLinkTitulo.textContent = link ? 'Editar link' : 'Cadastrar link';
  elementos.modalLinkSubtitulo.textContent = `Cliente: ${cliente.nome}`;
  elementos.campoNomeLink.value = link?.nome ?? '';
  elementos.campoUrlLink.value = link?.url ?? '';

  limparErro(elementos.erroLink);
  elementos.modalLink.showModal();
  elementos.campoNomeLink.focus();
}

function abrirModalDeCadastroDeLink(cliente) {
  abrirModalDeLink(cliente, null);
}

function abrirModalDeEdicaoDeLink(cliente, link) {
  abrirModalDeLink(cliente, link);
}

async function salvarLink(evento) {
  evento.preventDefault();

  const dados = {
    nome: elementos.campoNomeLink.value.trim(),
    url: elementos.campoUrlLink.value.trim(),
  };

  if (!dados.nome) {
    exibirErro(elementos.erroLink, 'Informe o nome do link.');
    return;
  }

  if (!dados.url) {
    exibirErro(elementos.erroLink, 'Informe a URL do link.');
    return;
  }

  if (!ehEnderecoNavegavel(dados.url)) {
    exibirErro(elementos.erroLink, 'Informe uma URL http ou https válida.');
    return;
  }

  limparErro(elementos.erroLink);
  elementos.botaoSalvarLink.disabled = true;

  try {
    const cliente = estado.clienteDoLinkEmEdicao;
    const emEdicao = estado.linkEmEdicao;

    if (emEdicao) {
      await api.atualizarLink(cliente.id, emEdicao.id, dados);
    } else {
      await api.adicionarLink(cliente.id, dados);
    }

    await recarregarClientes();
    elementos.modalLink.close();
    exibirAviso(emEdicao ? 'Link atualizado.' : 'Link cadastrado.');
  } catch (erro) {
    exibirErro(elementos.erroLink, erro.message);
  } finally {
    elementos.botaoSalvarLink.disabled = false;
  }
}

/* ------------------------- banco de dados do MCP -------------------------- */

function definirVisibilidadeDaSenhaDoMcp(visivel) {
  const rotulo = visivel ? 'Ocultar senha' : 'Mostrar senha';

  elementos.campoMcpSenha.type = visivel ? 'text' : 'password';
  elementos.botaoVerSenhaMcp.replaceChildren(
    criarIcone(visivel ? ICONES.olhoFechado : ICONES.olho),
  );
  elementos.botaoVerSenhaMcp.title = rotulo;
  elementos.botaoVerSenhaMcp.setAttribute('aria-label', rotulo);
  elementos.botaoVerSenhaMcp.setAttribute('aria-pressed', String(visivel));
}

function preencherFormularioDoMcp(configuracao) {
  elementos.campoMcpHost.value = configuracao.SANKHYA_DB_HOST ?? '';
  elementos.campoMcpPorta.value = configuracao.SANKHYA_DB_PORT ?? '';
  elementos.campoMcpServico.value = configuracao.SANKHYA_DB_SERVICE_NAME ?? '';
  elementos.campoMcpUsuario.value = configuracao.SANKHYA_DB_USER ?? '';
  elementos.campoMcpSenha.value = configuracao.SANKHYA_DB_PASSWORD ?? '';
}

/**
 * O mesmo modal atende dois cadastros — repositório de cliente e base local.
 * O alvo diz onde o arquivo é gravado, de onde os dados podem ser importados e
 * o que recarregar depois de salvar, para o botão trocar de cor.
 */
function alvoDoMcpDoRepositorio(cliente, repositorio) {
  return {
    caminho: repositorio.caminhoLocal,
    origens: cliente.bases
      .filter((base) => base.bancoDeDados)
      .map((base) => ({
        id: base.id,
        rotulo: `${ROTULOS_DE_TIPO_DE_BASE[base.tipo] ?? base.tipo} — ${base.url}`,
        banco: base.bancoDeDados,
      })),
    mensagemSemOrigem: 'Nenhuma base com banco configurado',
    ler: () => api.lerConfiguracaoMcp(cliente.id, repositorio.id),
    salvar: (dados) => api.salvarConfiguracaoMcp(cliente.id, repositorio.id, dados),
    recarregar: recarregarClientes,
  };
}

function alvoDoMcpDaBaseLocal(base) {
  return {
    caminho: base.caminhoWildfly,
    origens: estado.bancosLocais.map((banco) => ({
      id: banco.id,
      rotulo: `${banco.container} — ${banco.host}:${banco.porta}/${banco.nomeDoServico}`,
      banco,
    })),
    mensagemSemOrigem: 'Nenhum banco de dados local cadastrado',
    ler: () => api.lerConfiguracaoMcpDaBaseLocal(base.id),
    salvar: (dados) => api.salvarConfiguracaoMcpDaBaseLocal(base.id, dados),
    recarregar: recarregarBasesLocais,
  };
}

/** Só origens com banco de dados completo servem para importar. */
function preencherSeletorDeOrigens(alvo) {
  elementos.seletorDeBaseParaImportar.replaceChildren();

  if (alvo.origens.length === 0) {
    elementos.seletorDeBaseParaImportar.append(
      criarElemento('option', null, alvo.mensagemSemOrigem),
    );
    elementos.seletorDeBaseParaImportar.disabled = true;
    elementos.botaoImportarBase.disabled = true;
    return;
  }

  for (const origem of alvo.origens) {
    const opcao = criarElemento('option', null, origem.rotulo);
    opcao.value = origem.id;
    elementos.seletorDeBaseParaImportar.append(opcao);
  }

  elementos.seletorDeBaseParaImportar.disabled = false;
  elementos.botaoImportarBase.disabled = false;
}

function importarDadosDaBase() {
  const origem = estado.alvoDoMcp?.origens.find(
    (candidata) => candidata.id === elementos.seletorDeBaseParaImportar.value,
  );

  if (!origem) {
    return;
  }

  const banco = origem.banco;
  preencherFormularioDoMcp({
    SANKHYA_DB_HOST: banco.host,
    SANKHYA_DB_PORT: String(banco.porta),
    SANKHYA_DB_SERVICE_NAME: banco.nomeDoServico,
    SANKHYA_DB_USER: banco.usuario,
    SANKHYA_DB_PASSWORD: banco.senha,
  });

  limparErro(elementos.erroMcp);
  exibirAviso(`Dados importados. Salve para gravar o ${NOME_DO_ARQUIVO_MCP}.`);
}

async function abrirModalDeMcp(alvo) {
  estado.alvoDoMcp = alvo;

  limparErro(elementos.erroMcp);
  preencherFormularioDoMcp({});
  preencherSeletorDeOrigens(alvo);
  definirVisibilidadeDaSenhaDoMcp(false);

  try {
    const arquivo = await alvo.ler();
    preencherFormularioDoMcp(arquivo.configuracao);
    elementos.modalMcpSubtitulo.textContent = arquivo.existe
      ? `Lido de ${alvo.caminho}\\${NOME_DO_ARQUIVO_MCP}`
      : `Será criado em ${alvo.caminho}\\${NOME_DO_ARQUIVO_MCP}`;
  } catch (erro) {
    exibirAviso(`Não foi possível ler o ${NOME_DO_ARQUIVO_MCP}: ${erro.message}`, 'erro');
    return;
  }

  elementos.modalMcp.showModal();
  elementos.campoMcpHost.focus();
}

function lerFormularioDoMcp() {
  return {
    SANKHYA_DB_HOST: elementos.campoMcpHost.value.trim(),
    SANKHYA_DB_PORT: elementos.campoMcpPorta.value.trim(),
    SANKHYA_DB_SERVICE_NAME: elementos.campoMcpServico.value.trim(),
    SANKHYA_DB_USER: elementos.campoMcpUsuario.value.trim(),
    SANKHYA_DB_PASSWORD: elementos.campoMcpSenha.value,
  };
}

function validarFormularioDoMcp(dados) {
  if (!dados.SANKHYA_DB_HOST) {
    return 'Informe o SANKHYA_DB_HOST.';
  }

  const porta = Number(dados.SANKHYA_DB_PORT);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    return 'O SANKHYA_DB_PORT deve ser um número inteiro entre 1 e 65535.';
  }

  if (!dados.SANKHYA_DB_SERVICE_NAME) {
    return 'Informe o SANKHYA_DB_SERVICE_NAME.';
  }

  if (!dados.SANKHYA_DB_USER) {
    return 'Informe o SANKHYA_DB_USER.';
  }

  if (!dados.SANKHYA_DB_PASSWORD) {
    return 'Informe o SANKHYA_DB_PASSWORD.';
  }

  return null;
}

async function salvarConfiguracaoMcp(evento) {
  evento.preventDefault();

  const dados = lerFormularioDoMcp();
  const mensagemDeErro = validarFormularioDoMcp(dados);
  if (mensagemDeErro) {
    exibirErro(elementos.erroMcp, mensagemDeErro);
    return;
  }

  limparErro(elementos.erroMcp);
  elementos.botaoSalvarMcp.disabled = true;

  const alvo = estado.alvoDoMcp;

  try {
    await alvo.salvar(dados);

    // Recarrega para o botão trocar de cor com a nova situação do arquivo.
    await alvo.recarregar();
    elementos.modalMcp.close();
    exibirAviso(`${NOME_DO_ARQUIVO_MCP} gravado em ${alvo.caminho}.`);
  } catch (erro) {
    exibirErro(elementos.erroMcp, erro.message);
  } finally {
    elementos.botaoSalvarMcp.disabled = false;
  }
}

/* ----------------------------- configuração global ------------------------ */

/** Alterna entre as abas do modal de configuração. */
function selecionarAbaDaConfiguracao(abaEscolhida) {
  const abas = [
    { aba: elementos.abaConfiguracaoGeral, painel: elementos.painelConfiguracaoGeral },
    { aba: elementos.abaConfiguracaoMcp, painel: elementos.painelConfiguracaoMcp },
    { aba: elementos.abaConfiguracaoAtalhos, painel: elementos.painelConfiguracaoAtalhos },
  ];

  for (const { aba, painel } of abas) {
    const ativa = aba === abaEscolhida;
    aba.classList.toggle('ativa', ativa);
    aba.setAttribute('aria-selected', String(ativa));
    painel.hidden = !ativa;
  }
}

function preencherCamposDoMcpGlobal(configuracao) {
  elementos.campoConfigMcpHost.value = configuracao?.SANKHYA_DB_HOST ?? '';
  elementos.campoConfigMcpPorta.value = configuracao?.SANKHYA_DB_PORT ?? '';
  elementos.campoConfigMcpServico.value = configuracao?.SANKHYA_DB_SERVICE_NAME ?? '';
  elementos.campoConfigMcpUsuario.value = configuracao?.SANKHYA_DB_USER ?? '';
  elementos.campoConfigMcpSenha.value = configuracao?.SANKHYA_DB_PASSWORD ?? '';
}

function lerCamposDoMcpGlobal() {
  return {
    SANKHYA_DB_HOST: elementos.campoConfigMcpHost.value.trim(),
    SANKHYA_DB_PORT: elementos.campoConfigMcpPorta.value.trim(),
    SANKHYA_DB_SERVICE_NAME: elementos.campoConfigMcpServico.value.trim(),
    SANKHYA_DB_USER: elementos.campoConfigMcpUsuario.value.trim(),
    SANKHYA_DB_PASSWORD: elementos.campoConfigMcpSenha.value,
  };
}

/* ------------------------------- atalhos ---------------------------------- */

function criarCampoDeAtalho(valor, rotulo, exemplo, tamanhoMaximo) {
  const campo = criarElemento('input');
  campo.type = 'text';
  campo.value = valor;
  campo.maxLength = tamanhoMaximo;
  campo.autocomplete = 'off';
  campo.spellcheck = false;
  campo.placeholder = exemplo;
  campo.setAttribute('aria-label', rotulo);
  return campo;
}

/**
 * Uma linha do cadastro de atalhos.
 *
 * O id fica no `dataset` porque é ele que distingue um atalho já gravado de um
 * recém-adicionado — o que ainda não tem id ganha um no servidor.
 */
function criarLinhaDeAtalhoDaConfiguracao(atalho) {
  const linha = criarElemento('div', 'linha-atalho-config');
  linha.dataset.id = atalho.id;

  const nome = criarCampoDeAtalho(atalho.nome, 'Nome do atalho', 'Ex.: DataGrip', 60);
  const caminho = criarCampoDeAtalho(
    atalho.caminhoDoExecutavel,
    'Caminho do executável',
    'Ex.: C:\\Program Files\\JetBrains\\DataGrip\\bin\\datagrip64.exe',
    400,
  );

  const procurar = criarBotaoDeIcone('btn tiny', ICONES.pasta, 'Escolher o executável', () =>
    escolherExecutavelDoAtalho(caminho, procurar),
  );

  const remover = criarBotaoDeIcone('btn tiny danger', ICONES.lixeira, 'Remover atalho', () =>
    linha.remove(),
  );

  linha.append(nome, caminho, procurar, remover);
  return linha;
}

/**
 * Preenche o campo com o arquivo escolhido no seletor do sistema.
 *
 * O campo continua editável: dá para colar um caminho, ajustar o que veio do
 * seletor ou cadastrar o caminho de um programa ainda não instalado.
 */
async function escolherExecutavelDoAtalho(campoDoCaminho, botao) {
  botao.disabled = true;

  try {
    const escolha = await api.selecionarExecutavel();
    // Sem resposta o usuário cancelou: o que já estava digitado continua valendo.
    if (escolha?.caminho) {
      campoDoCaminho.value = escolha.caminho;
    }
  } catch (erro) {
    exibirErro(elementos.erroConfiguracao, erro.message);
  } finally {
    botao.disabled = false;
  }
}

function adicionarLinhaDeAtalho(atalho) {
  const linha = criarLinhaDeAtalhoDaConfiguracao(atalho);
  elementos.listaDeAtalhosDaConfiguracao.append(linha);
  return linha;
}

function preencherAtalhosDaConfiguracao(atalhos) {
  elementos.listaDeAtalhosDaConfiguracao.replaceChildren();
  for (const atalho of atalhos) {
    adicionarLinhaDeAtalho(atalho);
  }
}

/** Linha em branco é descartada: é o que sobra de um "Adicionar" desistido. */
function lerAtalhosDaConfiguracao() {
  const linhas = [...elementos.listaDeAtalhosDaConfiguracao.children];

  return linhas
    .map((linha) => {
      const [campoDoNome, campoDoCaminho] = linha.querySelectorAll('input');
      return {
        id: linha.dataset.id,
        nome: campoDoNome.value.trim(),
        caminhoDoExecutavel: campoDoCaminho.value.trim(),
      };
    })
    .filter((atalho) => atalho.nome !== '' || atalho.caminhoDoExecutavel !== '')
    .map((atalho) => (atalho.id === '' ? { ...atalho, id: undefined } : atalho));
}

function validarAtalhos(atalhos) {
  for (const atalho of atalhos) {
    if (atalho.nome === '') {
      return 'Informe o nome do atalho.';
    }
    if (atalho.caminhoDoExecutavel === '') {
      return `Informe o caminho do executável do atalho "${atalho.nome}".`;
    }
  }

  return null;
}

/** Item da lista suspensa. O caminho completo fica no `title`, sem roubar largura. */
function criarItemDeAtalho(atalho) {
  const item = criarBotao('item-atalho', undefined, () =>
    executarAcaoDoSistema(async () => {
      await api.abrirAtalho(atalho.id);
      fecharListaDeAtalhos();
      exibirAviso(`${atalho.nome} iniciado.`);
    }, item),
  );

  item.title = `${atalho.nome} — ${atalho.caminhoDoExecutavel}`;
  item.append(criarElemento('span', 'atalho-nome', atalho.nome));
  return item;
}

/*
 * Os dois nós são criados junto com a lista, e não existem no HTML: guardá-los
 * aqui evita procurá-los no DOM a cada tecla digitada na busca.
 */
let buscaDeAtalhos = null;
let itensDaListaDeAtalhos = null;

function atalhoCasaComOFiltro(atalho, filtro) {
  if (filtro === '') {
    return true;
  }

  const alvo = `${atalho.nome} ${atalho.caminhoDoExecutavel}`.toLowerCase();
  return alvo.includes(filtro);
}

/* Só os itens são redesenhados: o campo de busca não pode perder o foco. */
function renderizarItensDaListaDeAtalhos(filtro) {
  itensDaListaDeAtalhos.replaceChildren();

  const encontrados = estado.atalhos.filter((atalho) => atalhoCasaComOFiltro(atalho, filtro));

  if (encontrados.length === 0) {
    itensDaListaDeAtalhos.append(
      criarElemento('p', 'lista-atalhos-vazia', 'Nenhum atalho com esse nome.'),
    );
    return;
  }

  for (const atalho of encontrados) {
    itensDaListaDeAtalhos.append(criarItemDeAtalho(atalho));
  }
}

/**
 * Campo de busca da lista, que só aparece quando ela fica grande demais para
 * ser lida de relance.
 *
 * O filtro casa nome e caminho: quem cadastra dois "IntelliJ" os distingue pela
 * pasta, e é ela que a pessoa lembra.
 */
function criarBuscaDeAtalhos() {
  const busca = criarElemento('input', 'busca-atalhos');
  busca.type = 'search';
  busca.placeholder = 'Buscar atalho';
  busca.setAttribute('aria-label', 'Buscar atalho');
  busca.autocomplete = 'off';

  busca.addEventListener('input', () => {
    renderizarItensDaListaDeAtalhos(busca.value.trim().toLowerCase());
  });

  return busca;
}

function renderizarListaDeAtalhos() {
  elementos.listaDeAtalhos.replaceChildren();
  buscaDeAtalhos = null;

  if (estado.atalhos.length === 0) {
    elementos.listaDeAtalhos.append(
      criarElemento('p', 'lista-atalhos-vazia', 'Cadastre em Configurações › Atalhos.'),
    );
    return;
  }

  if (estado.atalhos.length > ATALHOS_ATE_DISPENSAR_A_BUSCA) {
    buscaDeAtalhos = criarBuscaDeAtalhos();
    elementos.listaDeAtalhos.append(buscaDeAtalhos);
  }

  itensDaListaDeAtalhos = criarElemento('div', 'itens-atalhos');
  elementos.listaDeAtalhos.append(itensDaListaDeAtalhos);
  renderizarItensDaListaDeAtalhos('');
}

function listaDeAtalhosEstaAberta() {
  return !elementos.listaDeAtalhos.hidden;
}

/*
 * A lista é posicionada por cima da tela, e não no fluxo: abrir e fechar não
 * desloca nada do que já está desenhado.
 */
function abrirListaDeAtalhos() {
  elementos.listaDeAtalhos.hidden = false;
  elementos.botaoAtalhos.setAttribute('aria-expanded', 'true');

  // Com a busca na tela, digitar já filtra: é o motivo de ela estar ali.
  buscaDeAtalhos?.focus();
}

function fecharListaDeAtalhos() {
  elementos.listaDeAtalhos.hidden = true;
  elementos.botaoAtalhos.setAttribute('aria-expanded', 'false');

  // A lista reabre inteira: um filtro esquecido esconderia atalhos sem motivo.
  if (buscaDeAtalhos && buscaDeAtalhos.value !== '') {
    buscaDeAtalhos.value = '';
    renderizarItensDaListaDeAtalhos('');
  }
}

function alternarListaDeAtalhos() {
  if (listaDeAtalhosEstaAberta()) {
    fecharListaDeAtalhos();
    return;
  }

  abrirListaDeAtalhos();
}

async function abrirModalDeConfiguracao() {
  limparErro(elementos.erroConfiguracao);
  selecionarAbaDaConfiguracao(elementos.abaConfiguracaoGeral);
  elementos.campoCaminhoSchemaMcp.value = '';
  preencherCamposDoMcpGlobal(null);
  definirVisibilidadeDoCampo(
    elementos.campoConfigMcpSenha,
    elementos.botaoVerSenhaConfigMcp,
    false,
  );
  elementos.campoScriptPadrao.value = '';
  elementos.campoIntervaloDeExecucaoAutomatica.value = INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S;
  elementos.campoTempoLimite.value = TEMPO_LIMITE_PADRAO_S;
  preencherAtalhosDaConfiguracao([]);

  try {
    const configuracao = await api.lerConfiguracao();
    elementos.campoScriptPadrao.value = configuracao.scriptPadrao ?? '';
    elementos.campoIntervaloDeExecucaoAutomatica.value =
      configuracao.intervaloDeExecucaoAutomaticaSegundos ??
      INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S;
    elementos.campoTempoLimite.value = configuracao.tempoLimiteSegundos ?? TEMPO_LIMITE_PADRAO_S;
    elementos.campoCaminhoSchemaMcp.value = configuracao.caminhoDoSchemaMcp ?? '';
    preencherAtalhosDaConfiguracao(configuracao.atalhos ?? []);
  } catch (erro) {
    exibirAviso(`Não foi possível carregar as configurações: ${erro.message}`, 'erro');
    return;
  }

  /*
   * O `.env` do MCP é lido à parte e não impede abrir o modal: pasta apagada
   * fora do HUB SNK só deixa os campos em branco, com aviso.
   */
  try {
    const arquivo = await api.lerConfiguracaoMcpGlobal();
    preencherCamposDoMcpGlobal(arquivo.configuracao);
  } catch (erro) {
    exibirAviso(`Não foi possível ler o .env do sankhya-schema-mcp: ${erro.message}`, 'erro');
  }

  elementos.modalConfiguracao.showModal();
  elementos.campoScriptPadrao.focus();
}

async function salvarConfiguracao(evento) {
  evento.preventDefault();

  /* Sem caminho não há `.env` a gravar, e as variáveis nem são enviadas. */
  const caminhoDoSchemaMcp = elementos.campoCaminhoSchemaMcp.value.trim();
  const mcp = caminhoDoSchemaMcp === '' ? undefined : lerCamposDoMcpGlobal();

  if (mcp) {
    const mensagemDeErro = validarFormularioDoMcp(mcp);
    if (mensagemDeErro) {
      selecionarAbaDaConfiguracao(elementos.abaConfiguracaoMcp);
      exibirErro(elementos.erroConfiguracao, mensagemDeErro);
      return;
    }
  }

  const atalhos = lerAtalhosDaConfiguracao();
  const erroDosAtalhos = validarAtalhos(atalhos);
  if (erroDosAtalhos) {
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoAtalhos);
    exibirErro(elementos.erroConfiguracao, erroDosAtalhos);
    return;
  }

  limparErro(elementos.erroConfiguracao);
  elementos.botaoSalvarConfiguracao.disabled = true;

  try {
    const salva = await api.salvarConfiguracao({
      caminhoDoSchemaMcp,
      mcp,
      scriptPadrao: elementos.campoScriptPadrao.value.trim(),
      intervaloDeExecucaoAutomaticaSegundos: Number(
        elementos.campoIntervaloDeExecucaoAutomatica.value,
      ),
      tempoLimiteSegundos: Number(elementos.campoTempoLimite.value),
      atalhos,
    });
    elementos.modalConfiguracao.close();
    exibirAviso('Configurações salvas.');
    definirExecucaoAutomatica(Number(elementos.campoIntervaloDeExecucaoAutomatica.value));

    /* A resposta traz os ids gerados: é dela que a barra passa a viver. */
    estado.atalhos = salva.atalhos ?? [];
    renderizarListaDeAtalhos();
  } catch (erro) {
    exibirErro(elementos.erroConfiguracao, erro.message);
  } finally {
    elementos.botaoSalvarConfiguracao.disabled = false;
  }
}

/* ----------------- correspondência de nome de cliente --------------------- */

const DIACRITICOS = /\p{Diacritic}/gu;

/* Fronteiras de camelCase: "NecoTruck" e "NFEEmissor" viram "Neco Truck" e "NFE Emissor". */
const FIM_DE_PALAVRA_ANTES_DE_MAIUSCULA = /(\p{Ll}|\p{N})(\p{Lu})/gu;
const SIGLA_ANTES_DE_PALAVRA = /(\p{Lu})(\p{Lu}\p{Ll})/gu;

/* O que não é letra nem dígito some da chave achatada. */
const FORA_DE_LETRA_OU_DIGITO = /[^\p{L}\p{N}]+/gu;

function separarCamelCase(valor) {
  return valor
    .replace(FIM_DE_PALAVRA_ANTES_DE_MAIUSCULA, '$1 $2')
    .replace(SIGLA_ANTES_DE_PALAVRA, '$1 $2');
}

function semAcentos(valor) {
  return valor.normalize('NFD').replace(DIACRITICOS, '');
}

/**
 * Só letras e dígitos, minúsculos e sem acento.
 *
 * "NecoTruck", "necotruck" e "Neco Truck" viram a mesma chave — é o que permite
 * a importação reconhecer o cliente já cadastrado escrito de outro jeito.
 */
function chaveAchatadaDeNome(valor) {
  return semAcentos(valor).toLocaleLowerCase('pt-BR').replace(FORA_DE_LETRA_OU_DIGITO, '');
}

/**
 * Nome exato do cliente cadastrado equivalente ao informado, ou vazio.
 *
 * Dois cadastros na mesma chave é ambiguidade: aí nenhum é escolhido, e o nome
 * digitado segue como está.
 */
function clienteCadastradoEquivalente(nome) {
  const alvo = chaveAchatadaDeNome(nome);
  if (!alvo) {
    return '';
  }

  const equivalentes = estado.clientes.filter(
    (cliente) => chaveAchatadaDeNome(cliente.nome) === alvo,
  );
  return equivalentes.length === 1 ? equivalentes[0].nome : '';
}

/* ----------------------- importação de favoritos -------------------------- */

/** Todos os favoritos da árvore, na mesma ordem em que aparecem na tela. */
function achatarFavoritos(nos) {
  return nos.flatMap((no) => (no.pasta ? achatarFavoritos(no.filhos) : [no]));
}

/* O arquivo do navegador guarda `javascript:`, `place:` e outros esquemas que o HUB SNK não abre. */
function favoritosImportaveis(nos) {
  return achatarFavoritos(nos).filter((favorito) => ehEnderecoNavegavel(favorito.url));
}

/* O mesmo trio que o servidor usa para recusar a importação. */
function chaveDeBase(nomeDoCliente, url, tipo) {
  return [nomeDoCliente, url, tipo]
    .map((valor) => valor.trim().toLocaleLowerCase('pt-BR'))
    .join('|');
}

function chavesDeBasesCadastradas() {
  const chaves = new Set();

  for (const cliente of estado.clientes) {
    for (const base of cliente.bases) {
      chaves.add(chaveDeBase(cliente.nome, base.url, base.tipo));
    }
  }

  return chaves;
}

/**
 * Uma linha por favorito marcado. Favoritos idênticos — mesmo nome e mesma URL —
 * viram uma linha só: o mesmo favorito não entra duas vezes na importação.
 */
function montarLinhasDaImportacao() {
  const identidadesVistas = new Set();
  const linhas = [];

  for (const favorito of achatarFavoritos(estado.importacao.pastas)) {
    if (!estado.importacao.selecionados.has(favorito.chave)) {
      continue;
    }

    const identidade = chaveDeBase(favorito.nome, favorito.url, '');
    if (identidadesVistas.has(identidade)) {
      continue;
    }
    identidadesVistas.add(identidade);

    const { nome, tipo } = separarTipoDoNome(favorito.nome);
    /* Havendo cadastro equivalente, a linha já nasce com o nome dele: a base
     * entra no cliente que existe em vez de criar um quase-igual. */
    const nomeDoCliente = clienteCadastradoEquivalente(nome) || nome;
    linhas.push({
      chave: favorito.chave,
      nome: nomeDoCliente,
      url: favorito.url,
      tipo,
      usuario: '',
      senha: '',
    });
  }

  return linhas;
}

function validarLinhaDaImportacao(linha, chavesCadastradas, contagemPorChave) {
  if (!linha.nome.trim()) {
    return 'Informe o nome do cliente.';
  }

  if (!ehEnderecoNavegavel(linha.url.trim())) {
    return 'Informe uma URL http ou https válida.';
  }

  if (!linha.tipo) {
    return 'Selecione o tipo da base.';
  }

  /* Usuário e senha ficam de fora: são opcionais também na importação. */
  const chave = chaveDeBase(linha.nome, linha.url, linha.tipo);

  if (chavesCadastradas.has(chave)) {
    return 'Este cliente já tem uma base com esta URL e este tipo.';
  }

  if (contagemPorChave.get(chave) > 1) {
    return 'Outra linha desta importação repete o mesmo nome, URL e tipo.';
  }

  return '';
}

/** Revalida o lote inteiro: duplicidade só aparece olhando as linhas em conjunto. */
function atualizarValidacaoDaImportacao() {
  const chavesCadastradas = chavesDeBasesCadastradas();
  const contagemPorChave = new Map();

  for (const linha of estado.importacao.linhas) {
    const chave = chaveDeBase(linha.nome, linha.url, linha.tipo);
    contagemPorChave.set(chave, (contagemPorChave.get(chave) ?? 0) + 1);
  }

  let tudoValido = true;

  for (const linha of estado.importacao.linhas) {
    const mensagem = validarLinhaDaImportacao(linha, chavesCadastradas, contagemPorChave);
    const elementoDeErro = estado.importacao.errosPorChave.get(linha.chave);

    if (elementoDeErro) {
      elementoDeErro.textContent = mensagem;
      elementoDeErro.hidden = mensagem === '';
    }

    if (mensagem) {
      tudoValido = false;
    }
  }

  elementos.botaoConcluirImportacao.disabled = !tudoValido;
  return tudoValido;
}

function criarEntradaDaImportacao(linha, propriedade, rotulo, opcoes) {
  const campo = criarElemento('div', opcoes.classe ? `campo ${opcoes.classe}` : 'campo');
  const identificador = `importacao-${propriedade}-${linha.chave}`;

  const etiqueta = criarElemento('label', null, rotulo);
  etiqueta.htmlFor = identificador;

  const entrada = document.createElement('input');
  entrada.id = identificador;
  entrada.type = opcoes.tipo ?? 'text';
  entrada.maxLength = opcoes.tamanhoMaximo;
  entrada.autocomplete = opcoes.tipo === 'password' ? 'new-password' : 'off';
  entrada.spellcheck = false;
  entrada.value = linha[propriedade];
  entrada.addEventListener('input', () => {
    linha[propriedade] = entrada.value;
    atualizarValidacaoDaImportacao();
  });

  campo.append(etiqueta, entrada);
  return campo;
}

function criarSeletorDeTipoDaImportacao(linha) {
  const campo = criarElemento('div', 'campo');
  const identificador = `importacao-tipo-${linha.chave}`;

  const etiqueta = criarElemento('label', null, 'Tipo de base');
  etiqueta.htmlFor = identificador;

  const seletor = document.createElement('select');
  seletor.id = identificador;

  const opcaoVazia = criarElemento('option', null, 'Selecione…');
  opcaoVazia.value = '';
  seletor.append(opcaoVazia);

  for (const [valor, rotulo] of Object.entries(ROTULOS_DE_TIPO_DE_BASE)) {
    const opcao = criarElemento('option', null, rotulo);
    opcao.value = valor;
    seletor.append(opcao);
  }

  seletor.value = linha.tipo;
  seletor.addEventListener('change', () => {
    linha.tipo = seletor.value;
    atualizarValidacaoDaImportacao();
  });

  campo.append(etiqueta, seletor);
  return campo;
}

function criarLinhaDeImportacao(linha) {
  const cartao = criarElemento('div', 'linha-de-importacao');

  const campos = criarElemento('div', 'linha-de-importacao-campos');
  campos.append(
    criarEntradaDaImportacao(linha, 'nome', 'Nome do cliente', { tamanhoMaximo: 120 }),
    criarEntradaDaImportacao(linha, 'url', 'URL', {
      tamanhoMaximo: 300,
      classe: 'campo-largura-total',
    }),
    criarSeletorDeTipoDaImportacao(linha),
    criarEntradaDaImportacao(linha, 'usuario', 'Usuário (opcional)', { tamanhoMaximo: 120 }),
    criarEntradaDaImportacao(linha, 'senha', 'Senha (opcional)', {
      tamanhoMaximo: 200,
      tipo: 'password',
    }),
  );

  const erro = criarElemento('p', 'erro-formulario');
  erro.hidden = true;
  estado.importacao.errosPorChave.set(linha.chave, erro);

  cartao.append(campos, erro);
  return cartao;
}

function renderizarLinhasDaImportacao() {
  estado.importacao.errosPorChave.clear();
  elementos.linhasDeImportacao.replaceChildren(
    ...estado.importacao.linhas.map((linha) => criarLinhaDeImportacao(linha)),
  );
  atualizarValidacaoDaImportacao();
}

/* ----------------- importação de repositórios locais ---------------------- */

const MODO_DE_CLIENTE_EXISTENTE = 'existente';
const MODO_DE_CLIENTE_NOVO = 'novo';

/* Valor reservado do seletor: nenhum cliente pode se chamar assim. */
const VALOR_DE_CLIENTE_NOVO = ' novo-cliente';

/* Separadores usados em nome de pasta de repositório. */
const DELIMITADORES_DO_NOME = /[-_.\s+@/\\]+/;

/**
 * Minúsculas, sem acento e com o camelCase desfeito: "Smart Química",
 * "smart-quimica" e "SmartQuimica" viram o mesmo.
 */
function palavrasDoNome(valor) {
  return semAcentos(separarCamelCase(valor))
    .toLocaleLowerCase('pt-BR')
    .split(DELIMITADORES_DO_NOME)
    .filter(Boolean);
}

/*
 * Quantas palavras o nome do cliente precisa ter para valer o casamento colado.
 * Nome de uma palavra só é curto demais: "DS" abriria "dstech-...".
 */
const QUANTIDADE_MINIMA_DE_PALAVRAS_PARA_CASAMENTO_COLADO = 2;

/**
 * Cliente já cadastrado cujo nome abre o nome do repositório.
 *
 * "comelli-transportes-customizacoes" é do cliente "Comelli"; a comparação é
 * por palavra inteira para "DS" não casar com "dstech-...". Nome de cliente com
 * mais de uma palavra vence o de uma só, que é o palpite mais fraco.
 *
 * O casamento colado cobre o repositório que grudou as palavras sem maiúscula
 * ("necotruck-customizacoes" para o cliente "Neco Truck"), onde não há fronteira
 * nenhuma para separar.
 */
function clienteSugeridoParaRepositorio(nomeDoRepositorio) {
  const palavrasDoRepositorio = palavrasDoNome(nomeDoRepositorio);
  const chaveDoRepositorio = chaveAchatadaDeNome(nomeDoRepositorio);
  let melhorNome = '';
  let melhorQuantidade = 0;

  for (const cliente of estado.clientes) {
    const palavrasDoCliente = palavrasDoNome(cliente.nome);
    const combinaPorPalavras =
      palavrasDoCliente.length > 0 &&
      palavrasDoCliente.every((palavra, indice) => palavrasDoRepositorio[indice] === palavra);
    const combinaColado =
      palavrasDoCliente.length >= QUANTIDADE_MINIMA_DE_PALAVRAS_PARA_CASAMENTO_COLADO &&
      chaveDoRepositorio.startsWith(chaveAchatadaDeNome(cliente.nome));

    if ((combinaPorPalavras || combinaColado) && palavrasDoCliente.length > melhorQuantidade) {
      melhorNome = cliente.nome;
      melhorQuantidade = palavrasDoCliente.length;
    }
  }

  return melhorNome;
}

/** Palpite inicial do campo de cliente, um por repositório encontrado. */
function sugerirClientesDosRepositorios(repositorios) {
  return new Map(
    repositorios.map((repositorio) => [
      repositorio.caminho,
      { modo: MODO_DE_CLIENTE_EXISTENTE, nome: clienteSugeridoParaRepositorio(repositorio.nome) },
    ]),
  );
}

/*
 * Repositório sem remoto http/https não pode ser cadastrado: o HUB SNK guarda a
 * URL da página do repositório, e não há como deduzi-la de um clone sem remoto.
 */
function repositoriosImportaveis() {
  return estado.importacao.repositoriosLocais.encontrados.filter(
    (repositorio) => repositorio.url !== '',
  );
}

function renderizarPastasDaVarredura() {
  const { pastasVarridas } = estado.importacao.repositoriosLocais;

  elementos.pastasVarridas.replaceChildren(
    ...pastasVarridas.map((pasta) => criarLinhaDePastaVarrida(pasta)),
  );

  const plural = pastasVarridas.length > 1 ? 's' : '';
  elementos.resumoDasPastasVarridas.textContent =
    pastasVarridas.length === 0
      ? 'Nenhuma pasta adicionada.'
      : `${pastasVarridas.length} pasta${plural} adicionada${plural}.`;
  atualizarBotaoAvancarDaImportacao();
}

function criarLinhaDePastaVarrida(pasta) {
  const linha = criarElemento('div', 'pasta-varrida');

  const texto = criarElemento('span', 'pasta-varrida-caminho', pasta);
  texto.title = pasta;

  const remover = criarBotao('btn tiny ghost', 'Remover', () => removerPastaDaVarredura(pasta));

  linha.append(criarIcone(ICONES.pasta), texto, remover);
  return linha;
}

function removerPastaDaVarredura(pasta) {
  const local = estado.importacao.repositoriosLocais;
  local.pastasVarridas = local.pastasVarridas.filter((candidata) => candidata !== pasta);
  renderizarPastasDaVarredura();
}

/** Uma pasta por vez: o diálogo do sistema não faz seleção múltipla. */
async function adicionarPastaDaVarredura() {
  limparErro(elementos.erroImportacao);
  elementos.botaoAdicionarPastaVarrida.disabled = true;

  try {
    const escolha = await api.selecionarPasta();
    // Sem resposta o usuário cancelou o diálogo: nada a acrescentar.
    if (!escolha?.caminho) {
      return;
    }

    const { pastasVarridas } = estado.importacao.repositoriosLocais;
    if (pastasVarridas.includes(escolha.caminho)) {
      exibirAviso('Esta pasta já está na lista.');
      return;
    }

    estado.importacao.repositoriosLocais.pastasVarridas = [...pastasVarridas, escolha.caminho];
    renderizarPastasDaVarredura();
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
  } finally {
    elementos.botaoAdicionarPastaVarrida.disabled = false;
  }
}

/**
 * Varre as pastas escolhidas e leva para a etapa da seleção.
 *
 * A varredura percorre disco e pode demorar em pasta grande, por isso o botão
 * fica desabilitado enquanto a resposta não chega.
 */
async function varrerPastasEscolhidas() {
  limparErro(elementos.erroImportacao);
  elementos.botaoAvancarImportacao.disabled = true;

  let repositorios;
  try {
    const resposta = await api.varrerRepositoriosLocais(
      estado.importacao.repositoriosLocais.pastasVarridas,
    );
    repositorios = resposta.repositorios;
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
    return;
  } finally {
    atualizarBotaoAvancarDaImportacao();
  }

  if (repositorios.length === 0) {
    exibirErro(elementos.erroImportacao, 'Nenhum repositório Git foi encontrado nessas pastas.');
    return;
  }

  estado.importacao.repositoriosLocais.encontrados = repositorios;
  estado.importacao.repositoriosLocais.selecionados = new Set();
  estado.importacao.repositoriosLocais.clientesPorCaminho =
    sugerirClientesDosRepositorios(repositorios);

  definirEtapaDaImportacao('repositorios');
  renderizarRepositoriosEncontrados();

  const semRemoto = repositorios.length - repositoriosImportaveis().length;
  if (semRemoto > 0) {
    exibirAviso(`${semRemoto} repositório(s) sem remoto http/https não podem ser importados.`);
  }
}

function definirSelecaoDeRepositorios(repositorios, marcado) {
  const { selecionados } = estado.importacao.repositoriosLocais;

  for (const repositorio of repositorios) {
    if (marcado) {
      selecionados.add(repositorio.caminho);
    } else {
      selecionados.delete(repositorio.caminho);
    }
  }

  renderizarRepositoriosEncontrados();
}

/**
 * Cliente escolhido para um repositório.
 *
 * `modo` separa "escolhi um cadastro da lista" de "vou digitar um nome novo":
 * sem isso, o campo em branco de um cliente novo seria confundido com nenhuma
 * escolha feita.
 */
function clienteDoRepositorio(caminho) {
  return (
    estado.importacao.repositoriosLocais.clientesPorCaminho.get(caminho) ?? {
      modo: MODO_DE_CLIENTE_EXISTENTE,
      nome: '',
    }
  );
}

function definirClienteDoRepositorio(caminho, escolha) {
  estado.importacao.repositoriosLocais.clientesPorCaminho.set(caminho, escolha);
  atualizarValidacaoDosRepositorios();
}

function criarSeletorDeClienteDoRepositorio(repositorio, aoTrocarDeModo) {
  const escolha = clienteDoRepositorio(repositorio.caminho);
  const seletor = document.createElement('select');
  seletor.id = `repositorio-cliente-${repositorio.caminho}`;

  const opcaoVazia = criarElemento('option', null, 'Selecione…');
  opcaoVazia.value = '';
  seletor.append(opcaoVazia);

  for (const cliente of estado.clientes) {
    const opcao = criarElemento('option', null, cliente.nome);
    opcao.value = cliente.nome;
    seletor.append(opcao);
  }

  const opcaoDeNovo = criarElemento('option', null, 'Novo cliente…');
  opcaoDeNovo.value = VALOR_DE_CLIENTE_NOVO;
  seletor.append(opcaoDeNovo);

  seletor.value = escolha.modo === MODO_DE_CLIENTE_NOVO ? VALOR_DE_CLIENTE_NOVO : escolha.nome;
  seletor.addEventListener('change', () => {
    const ehNovo = seletor.value === VALOR_DE_CLIENTE_NOVO;
    definirClienteDoRepositorio(repositorio.caminho, {
      modo: ehNovo ? MODO_DE_CLIENTE_NOVO : MODO_DE_CLIENTE_EXISTENTE,
      nome: ehNovo ? '' : seletor.value,
    });
    aoTrocarDeModo(ehNovo);
  });

  return seletor;
}

function criarEntradaDeClienteNovo(repositorio) {
  const entrada = document.createElement('input');
  entrada.type = 'text';
  entrada.maxLength = 120;
  entrada.autocomplete = 'off';
  entrada.spellcheck = false;
  entrada.placeholder = 'Nome do novo cliente';
  entrada.value = clienteDoRepositorio(repositorio.caminho).nome;
  entrada.addEventListener('input', () => {
    definirClienteDoRepositorio(repositorio.caminho, {
      modo: MODO_DE_CLIENTE_NOVO,
      nome: entrada.value,
    });
  });

  return entrada;
}

function criarCampoDeClienteDoRepositorio(repositorio) {
  const campo = criarElemento('div', 'campo campo-de-cliente-do-repositorio');

  const etiqueta = criarElemento('label', null, 'Cliente');
  etiqueta.htmlFor = `repositorio-cliente-${repositorio.caminho}`;

  const entradaDeNovo = criarEntradaDeClienteNovo(repositorio);
  /* Trocar a visibilidade aqui, e não redesenhando a lista, preserva o foco. */
  const exibirEntradaDeNovo = (visivel) => {
    entradaDeNovo.hidden = !visivel;
    /* O seletor zera o nome ao trocar de modo; o campo acompanha. */
    entradaDeNovo.value = '';
    if (visivel) {
      entradaDeNovo.focus();
    }
  };

  const seletor = criarSeletorDeClienteDoRepositorio(repositorio, exibirEntradaDeNovo);
  entradaDeNovo.hidden = clienteDoRepositorio(repositorio.caminho).modo !== MODO_DE_CLIENTE_NOVO;

  campo.append(etiqueta, seletor, entradaDeNovo);
  return campo;
}

function criarLinhaDeRepositorioEncontrado(repositorio) {
  const cartao = criarElemento('div', 'repositorio-encontrado');
  const importavel = repositorio.url !== '';

  const caixa = document.createElement('input');
  caixa.type = 'checkbox';
  caixa.checked = estado.importacao.repositoriosLocais.selecionados.has(repositorio.caminho);
  caixa.disabled = !importavel;
  caixa.addEventListener('change', () =>
    definirSelecaoDeRepositorios([repositorio], caixa.checked),
  );

  const identificacao = criarElemento('div', 'repositorio-encontrado-identificacao');
  identificacao.append(
    criarElemento('strong', null, repositorio.nome),
    criarElemento('span', 'repositorio-encontrado-caminho', repositorio.caminho),
    criarElemento(
      'span',
      'repositorio-encontrado-detalhe',
      importavel ? repositorio.url : 'Sem remoto http ou https — não é possível importar.',
    ),
    criarElemento(
      'span',
      'repositorio-encontrado-detalhe',
      repositorio.branch ? `Branch: ${repositorio.branch}` : 'Sem commits',
    ),
  );

  const cabecalho = criarElemento('label', 'repositorio-encontrado-cabecalho');
  cabecalho.append(caixa, identificacao);

  if (!importavel) {
    cartao.classList.add('desabilitado');
  }

  const erro = criarElemento('p', 'erro-formulario');
  erro.hidden = true;
  estado.importacao.repositoriosLocais.errosPorCaminho.set(repositorio.caminho, erro);

  cartao.append(cabecalho);
  if (importavel) {
    cartao.append(criarCampoDeClienteDoRepositorio(repositorio));
  }
  cartao.append(erro);
  return cartao;
}

function renderizarRepositoriosEncontrados() {
  const rolagem = elementos.repositoriosEncontrados.scrollTop;
  estado.importacao.repositoriosLocais.errosPorCaminho.clear();
  elementos.repositoriosEncontrados.replaceChildren(
    ...estado.importacao.repositoriosLocais.encontrados.map((repositorio) =>
      criarLinhaDeRepositorioEncontrado(repositorio),
    ),
  );
  elementos.repositoriosEncontrados.scrollTop = rolagem;

  const quantidade = estado.importacao.repositoriosLocais.selecionados.size;
  const plural = quantidade > 1 ? 's' : '';
  elementos.resumoDosRepositorios.textContent =
    quantidade === 0
      ? 'Nenhum repositório selecionado.'
      : `${quantidade} repositório${plural} selecionado${plural}.`;
  atualizarValidacaoDosRepositorios();
}

/* O mesmo par que o servidor usa para recusar a importação. */
function chaveDeRepositorio(nomeDoCliente, url) {
  return [nomeDoCliente, url].map((valor) => valor.trim().toLocaleLowerCase('pt-BR')).join('|');
}

function chavesDeRepositoriosCadastrados() {
  const chaves = new Set();

  for (const cliente of estado.clientes) {
    for (const repositorio of cliente.repositorios) {
      chaves.add(chaveDeRepositorio(cliente.nome, repositorio.url));
    }
  }

  return chaves;
}

/** Os repositórios marcados, com o cliente digitado em cada um. */
function repositoriosSelecionadosParaImportacao() {
  const { selecionados } = estado.importacao.repositoriosLocais;

  return repositoriosImportaveis()
    .filter((repositorio) => selecionados.has(repositorio.caminho))
    .map((repositorio) => ({
      ...repositorio,
      nomeDoCliente: clienteDoRepositorio(repositorio.caminho).nome,
    }));
}

function validarRepositorioSelecionado(selecionado, chavesCadastradas, contagemPorChave) {
  if (!selecionado.nomeDoCliente.trim()) {
    return 'Informe o cliente deste repositório.';
  }

  const chave = chaveDeRepositorio(selecionado.nomeDoCliente, selecionado.url);

  if (chavesCadastradas.has(chave)) {
    return 'Este cliente já tem um repositório com esta URL.';
  }

  if (contagemPorChave.get(chave) > 1) {
    return 'Outro repositório desta importação repete o mesmo cliente e a mesma URL.';
  }

  return '';
}

/** Revalida o lote inteiro: duplicidade só aparece olhando as linhas em conjunto. */
function atualizarValidacaoDosRepositorios() {
  const selecionados = repositoriosSelecionadosParaImportacao();
  const chavesCadastradas = chavesDeRepositoriosCadastrados();
  const contagemPorChave = new Map();

  for (const selecionado of selecionados) {
    const chave = chaveDeRepositorio(selecionado.nomeDoCliente, selecionado.url);
    contagemPorChave.set(chave, (contagemPorChave.get(chave) ?? 0) + 1);
  }

  let tudoValido = selecionados.length > 0;

  for (const elementoDeErro of estado.importacao.repositoriosLocais.errosPorCaminho.values()) {
    elementoDeErro.textContent = '';
    elementoDeErro.hidden = true;
  }

  for (const selecionado of selecionados) {
    const mensagem = validarRepositorioSelecionado(
      selecionado,
      chavesCadastradas,
      contagemPorChave,
    );
    const elementoDeErro = estado.importacao.repositoriosLocais.errosPorCaminho.get(
      selecionado.caminho,
    );

    if (elementoDeErro) {
      elementoDeErro.textContent = mensagem;
      elementoDeErro.hidden = mensagem === '';
    }

    if (mensagem) {
      tudoValido = false;
    }
  }

  elementos.botaoConcluirImportacao.disabled = !tudoValido;
  return tudoValido;
}

async function concluirImportacaoDeRepositorios() {
  if (!atualizarValidacaoDosRepositorios()) {
    exibirErro(
      elementos.erroImportacao,
      'Marque ao menos um repositório e corrija os destacados antes de concluir.',
    );
    return;
  }

  limparErro(elementos.erroImportacao);
  elementos.botaoConcluirImportacao.disabled = true;

  const repositorios = repositoriosSelecionadosParaImportacao().map((selecionado) => ({
    nomeDoCliente: selecionado.nomeDoCliente.trim(),
    nome: selecionado.nome,
    url: selecionado.url,
    caminhoLocal: selecionado.caminho,
  }));

  try {
    const resultado = await api.importarRepositorios(repositorios);
    await recarregarClientes();
    elementos.modalImportacao.close();
    exibirAviso(
      `${resultado.repositoriosImportados} repositório(s) importado(s), ${resultado.clientesCriados} cliente(s) criado(s).`,
    );
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
  } finally {
    elementos.botaoConcluirImportacao.disabled = false;
  }
}

function criarNoDeFavorito(favorito) {
  const linha = criarElemento('label', 'no-de-favorito');
  const importavel = ehEnderecoNavegavel(favorito.url);

  const caixa = document.createElement('input');
  caixa.type = 'checkbox';
  caixa.checked = estado.importacao.selecionados.has(favorito.chave);
  caixa.disabled = !importavel;
  caixa.addEventListener('change', () => definirSelecaoDeFavoritos([favorito], caixa.checked));

  const texto = criarElemento('span', 'no-de-favorito-texto');
  texto.append(
    criarElemento('strong', null, favorito.nome),
    criarElemento('span', null, favorito.url),
  );

  if (!importavel) {
    linha.classList.add('desabilitado');
    linha.title = 'Só é possível importar endereços http ou https.';
  }

  linha.append(caixa, texto);
  return linha;
}

function criarNoDePasta(pasta) {
  const selecionaveis = favoritosImportaveis(pasta.filhos);
  const marcados = selecionaveis.filter((favorito) =>
    estado.importacao.selecionados.has(favorito.chave),
  ).length;

  const caixa = document.createElement('input');
  caixa.type = 'checkbox';
  caixa.disabled = selecionaveis.length === 0;
  caixa.checked = selecionaveis.length > 0 && marcados === selecionaveis.length;
  caixa.indeterminate = marcados > 0 && marcados < selecionaveis.length;
  caixa.addEventListener('change', () => definirSelecaoDeFavoritos(selecionaveis, caixa.checked));

  const cabecalho = criarElemento('label', 'no-de-pasta-cabecalho');
  cabecalho.append(caixa, criarIcone(ICONES.pasta), criarElemento('span', null, pasta.nome));

  const filhos = criarElemento('div', 'no-de-pasta-filhos');
  filhos.append(...pasta.filhos.map((no) => criarNoDaArvore(no)));

  const bloco = criarElemento('div', 'no-de-pasta');
  bloco.append(cabecalho, filhos);
  return bloco;
}

function criarNoDaArvore(no) {
  return no.pasta ? criarNoDePasta(no) : criarNoDeFavorito(no);
}

/*
 * Marcar uma pasta mexe em todos os favoritos abaixo dela, então a árvore
 * inteira é redesenhada — é o que mantém as caixas das pastas coerentes com o
 * que está marcado. O scroll é preservado para a lista não pular sob o cursor.
 */
function definirSelecaoDeFavoritos(favoritos, marcado) {
  for (const favorito of favoritos) {
    if (marcado) {
      estado.importacao.selecionados.add(favorito.chave);
    } else {
      estado.importacao.selecionados.delete(favorito.chave);
    }
  }

  renderizarArvoreDeFavoritos();
}

function renderizarArvoreDeFavoritos() {
  const rolagem = elementos.arvoreDeFavoritos.scrollTop;
  elementos.arvoreDeFavoritos.replaceChildren(
    ...estado.importacao.pastas.map((no) => criarNoDaArvore(no)),
  );
  elementos.arvoreDeFavoritos.scrollTop = rolagem;

  const quantidade = estado.importacao.selecionados.size;
  const plural = quantidade > 1 ? 's' : '';
  elementos.resumoDaSelecao.textContent =
    quantidade === 0
      ? 'Nenhum favorito selecionado.'
      : `${quantidade} favorito${plural} selecionado${plural}.`;
  atualizarBotaoAvancarDaImportacao();
}

function atualizarBotaoAvancarDaImportacao() {
  const condicao = CONDICOES_PARA_AVANCAR[estado.importacao.etapa];
  elementos.botaoAvancarImportacao.hidden = condicao === undefined;
  elementos.botaoAvancarImportacao.disabled = condicao !== undefined && !condicao();
}

function definirEtapaDaImportacao(etapa) {
  estado.importacao.etapa = etapa;
  limparErro(elementos.erroImportacao);

  elementos.modalImportacaoSubtitulo.textContent = ETAPAS_DA_IMPORTACAO[etapa].subtitulo;
  elementos.etapaImportacaoOrigem.hidden = etapa !== 'origem';
  elementos.etapaImportacaoArquivo.hidden = etapa !== 'arquivo';
  elementos.etapaImportacaoArvore.hidden = etapa !== 'arvore';
  elementos.etapaImportacaoFormulario.hidden = etapa !== 'formulario';
  elementos.etapaImportacaoPastas.hidden = etapa !== 'pastas';
  elementos.etapaImportacaoRepositorios.hidden = etapa !== 'repositorios';
  elementos.etapaImportacaoArquivoDeCadastros.hidden = etapa !== 'arquivoDeCadastros';
  elementos.etapaImportacaoCadastros.hidden = etapa !== 'cadastros';

  elementos.botaoVoltarImportacao.hidden = ETAPAS_DA_IMPORTACAO[etapa].anterior === null;
  elementos.botaoConcluirImportacao.hidden = !ETAPAS_FINAIS_DA_IMPORTACAO.has(etapa);
  atualizarBotaoAvancarDaImportacao();
}

function abrirModalDeImportacao() {
  estado.importacao.origem = '';
  estado.importacao.nomeDoArquivo = '';
  estado.importacao.pastas = [];
  estado.importacao.selecionados = new Set();
  estado.importacao.linhas = [];
  estado.importacao.errosPorChave.clear();

  elementos.campoArquivoDeFavoritos.value = '';
  elementos.nomeDoArquivoDeFavoritos.textContent = '';
  elementos.nomeDoArquivoDeFavoritos.hidden = true;
  estado.importacao.repositoriosLocais = {
    pastasVarridas: [],
    encontrados: [],
    selecionados: new Set(),
    clientesPorCaminho: new Map(),
    errosPorCaminho: new Map(),
  };

  estado.importacao.cadastros = {
    nomeDoArquivo: '',
    clientes: [],
    avisos: [],
    clientesNovos: [],
    basesNovas: [],
    conflitos: [],
    decisoes: new Map(),
  };
  elementos.campoArquivoDeCadastros.value = '';
  elementos.nomeDoArquivoDeCadastros.textContent = '';
  elementos.nomeDoArquivoDeCadastros.hidden = true;

  elementos.arvoreDeFavoritos.replaceChildren();
  elementos.linhasDeImportacao.replaceChildren();
  elementos.linhasDeCadastros.replaceChildren();
  elementos.pastasVarridas.replaceChildren();
  elementos.repositoriosEncontrados.replaceChildren();
  elementos.resumoDasPastasVarridas.textContent = 'Nenhuma pasta adicionada.';
  elementos.resumoDosRepositorios.textContent = 'Nenhum repositório selecionado.';
  elementos.resumoDosCadastros.textContent = 'Nada para importar.';
  elementos.acoesDosConflitos.hidden = true;
  for (const opcao of elementos.formularioImportacao.querySelectorAll('input[type="radio"]')) {
    opcao.checked = false;
  }

  definirEtapaDaImportacao('origem');
  elementos.modalImportacao.showModal();
}

/** Lê o arquivo no próprio navegador e já avança para a árvore de favoritos. */
async function carregarArquivoDeFavoritos(arquivo) {
  if (!arquivo) {
    return;
  }

  let pastas;
  try {
    pastas = lerArvoreDeFavoritos(await arquivo.text());
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
    return;
  }

  estado.importacao.pastas = pastas;
  estado.importacao.nomeDoArquivo = arquivo.name;
  estado.importacao.selecionados = new Set();

  elementos.nomeDoArquivoDeFavoritos.textContent = `Arquivo: ${arquivo.name}`;
  elementos.nomeDoArquivoDeFavoritos.hidden = false;

  definirEtapaDaImportacao('arvore');
  renderizarArvoreDeFavoritos();
}

function avancarImportacao() {
  if (estado.importacao.etapa === 'origem') {
    definirEtapaDaImportacao(PRIMEIRA_ETAPA_POR_ORIGEM[estado.importacao.origem]);
    return;
  }

  if (estado.importacao.etapa === 'pastas') {
    varrerPastasEscolhidas();
    return;
  }

  avancarParaAsLinhasDosFavoritos();
}

function avancarParaAsLinhasDosFavoritos() {
  if (estado.importacao.selecionados.size === 0) {
    exibirErro(elementos.erroImportacao, 'Selecione ao menos um favorito.');
    return;
  }

  const linhas = montarLinhasDaImportacao();
  const unificados = estado.importacao.selecionados.size - linhas.length;

  estado.importacao.linhas = linhas;
  definirEtapaDaImportacao('formulario');
  renderizarLinhasDaImportacao();

  if (unificados > 0) {
    exibirAviso(`${unificados} favorito(s) repetido(s) viraram uma linha só.`);
  }
}

function voltarImportacao() {
  const anterior = ETAPAS_DA_IMPORTACAO[estado.importacao.etapa].anterior;
  if (!anterior) {
    return;
  }

  definirEtapaDaImportacao(anterior);
  if (anterior === 'arvore') {
    renderizarArvoreDeFavoritos();
  }
  if (anterior === 'pastas') {
    renderizarPastasDaVarredura();
  }
}

async function concluirImportacao(evento) {
  evento.preventDefault();

  /* Enter em qualquer etapa dispara o submit do formulário; só a última conclui. */
  if (!ETAPAS_FINAIS_DA_IMPORTACAO.has(estado.importacao.etapa)) {
    return;
  }

  if (estado.importacao.etapa === 'repositorios') {
    await concluirImportacaoDeRepositorios();
    return;
  }

  if (estado.importacao.etapa === 'cadastros') {
    await concluirImportacaoDeCadastros();
    return;
  }

  if (!atualizarValidacaoDaImportacao()) {
    exibirErro(elementos.erroImportacao, 'Corrija as linhas destacadas antes de concluir.');
    return;
  }

  limparErro(elementos.erroImportacao);
  elementos.botaoConcluirImportacao.disabled = true;

  const bases = estado.importacao.linhas.map((linha) => ({
    nomeDoCliente: linha.nome.trim(),
    url: linha.url.trim(),
    tipo: linha.tipo,
    usuario: linha.usuario.trim(),
    senha: linha.senha,
  }));

  try {
    const resultado = await api.importarFavoritos(bases);
    await recarregarClientes();
    elementos.modalImportacao.close();
    exibirAviso(
      `${resultado.basesImportadas} base(s) importada(s), ${resultado.clientesCriados} cliente(s) criado(s).`,
    );
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
  } finally {
    elementos.botaoConcluirImportacao.disabled = false;
  }
}

/* ------------------ importação do arquivo de cadastros -------------------- */

/**
 * Cliente cadastrado equivalente ao nome que veio no arquivo, ou `undefined`.
 *
 * É a mesma regra do servidor: igualdade exata primeiro e, só depois, a chave
 * achatada — e apenas quando um único cadastro cai nela, porque com dois
 * candidatos a escolha seria arbitrária.
 */
function clienteCadastradoDoArquivo(nome) {
  const alvo = nome.trim().toLocaleLowerCase('pt-BR');
  const exato = estado.clientes.find(
    (cliente) => cliente.nome.trim().toLocaleLowerCase('pt-BR') === alvo,
  );
  if (exato) {
    return exato;
  }

  const chave = chaveAchatadaDeNome(nome);
  if (!chave) {
    return undefined;
  }

  const equivalentes = estado.clientes.filter(
    (cliente) => chaveAchatadaDeNome(cliente.nome) === chave,
  );
  return equivalentes.length === 1 ? equivalentes[0] : undefined;
}

/* A URL é o que identifica a base do cliente na importação, como no servidor. */
function baseCadastradaNaMesmaUrl(cliente, url) {
  const alvo = url.trim().toLocaleLowerCase('pt-BR');
  return cliente.bases.find((base) => base.url.trim().toLocaleLowerCase('pt-BR') === alvo);
}

/* Identifica a decisão de um conflito, e é a mesma chave dos dois lados. */
function chaveDoConflito(nomeDoCliente, url) {
  return `${chaveAchatadaDeNome(nomeDoCliente)}|${url.trim().toLocaleLowerCase('pt-BR')}`;
}

/**
 * O que a base vira se a substituição for escolhida.
 *
 * Espelha a regra do servidor: o que o arquivo não trouxe — o banco inteiro, ou o
 * par usuário/senha em branco — preserva o que já está gravado, porque não
 * exportar um campo não é a mesma coisa que apagá-lo.
 */
function baseResultanteDaSubstituicao(atual, importada) {
  const semCredencialNoArquivo = importada.usuario === '' && importada.senha === '';

  return {
    tipo: importada.tipo,
    usuario: semCredencialNoArquivo ? atual.usuario : importada.usuario,
    senha: semCredencialNoArquivo ? atual.senha : importada.senha,
    bancoDeDados: importada.bancoDeDados ?? atual.bancoDeDados,
  };
}

/**
 * Separa o que veio do arquivo em três: cliente novo, base nova e conflito.
 *
 * Conflito é base cuja URL já está cadastrada no cliente — só ela precisa de
 * decisão, e toda decisão nasce em "manter o atual" para que concluir sem mexer
 * em nada nunca sobrescreva cadastro.
 */
function montarPlanoDaImportacaoDeCadastros(clientesDoArquivo) {
  const clientesNovos = [];
  const basesNovas = [];
  const conflitos = [];

  for (const clienteDoArquivo of clientesDoArquivo) {
    const cadastrado = clienteCadastradoDoArquivo(clienteDoArquivo.nome);
    if (!cadastrado) {
      clientesNovos.push(clienteDoArquivo.nome);
    }

    for (const base of clienteDoArquivo.bases) {
      const atual = cadastrado ? baseCadastradaNaMesmaUrl(cadastrado, base.url) : undefined;

      if (!atual) {
        basesNovas.push({ nomeDoCliente: clienteDoArquivo.nome, base });
        continue;
      }

      conflitos.push({
        chave: chaveDoConflito(clienteDoArquivo.nome, base.url),
        nomeDoCliente: cadastrado.nome,
        url: base.url,
        atual,
        importada: baseResultanteDaSubstituicao(atual, base),
      });
    }
  }

  return { clientesNovos, basesNovas, conflitos };
}

/* Resumo do banco numa linha só, para caber na comparação lado a lado. */
function resumoDoBancoDaBase(base) {
  const banco = base.bancoDeDados;
  return banco ? `${banco.host}:${banco.porta}/${banco.nomeDoServico}` : SEM_VALOR;
}

/**
 * Os campos comparados, com o valor mostrado e o valor cru.
 *
 * A senha aparece mascarada: para decidir basta saber que ela mudou, e a tela de
 * conferência não é lugar de expor segredo já gravado. A comparação usa o valor
 * cru, então o "(diferente)" continua correto por trás da máscara.
 */
function camposComparaveisDaBase(base) {
  return [
    ['Tipo', ROTULOS_DE_TIPO_DE_BASE[base.tipo] ?? base.tipo, base.tipo],
    ['Usuário', base.usuario || SEM_VALOR, base.usuario],
    ['Senha', base.senha ? SENHA_MASCARADA : SEM_VALOR, base.senha],
    [
      'Banco',
      resumoDoBancoDaBase(base),
      base.bancoDeDados ? JSON.stringify(base.bancoDeDados) : '',
    ],
  ];
}

/** Um lado da comparação: o cadastro atual ou o que o arquivo quer no lugar. */
function criarLadoDoConflito(conflito, ehImportada) {
  const base = ehImportada ? conflito.importada : conflito.atual;
  const outra = ehImportada ? conflito.atual : conflito.importada;
  const camposDaOutra = camposComparaveisDaBase(outra);

  const entrada = criarElemento('input');
  entrada.type = 'radio';
  entrada.name = conflito.chave;
  entrada.checked = estado.importacao.cadastros.decisoes.get(conflito.chave) === ehImportada;
  entrada.addEventListener('change', () => {
    estado.importacao.cadastros.decisoes.set(conflito.chave, ehImportada);
  });

  const escolha = criarElemento('label', 'campo-checkbox');
  escolha.append(
    entrada,
    criarElemento('span', null, ehImportada ? 'Usar o importado' : 'Manter o atual'),
  );

  const lado = criarElemento('div', 'lado-do-conflito');
  lado.append(escolha);

  for (const [indice, [rotulo, exibido, cru]] of camposComparaveisDaBase(base).entries()) {
    const campo = criarElemento('p', 'campo-do-conflito');
    campo.append(
      criarElemento('span', 'campo-do-conflito-rotulo', rotulo),
      criarElemento('span', 'campo-do-conflito-valor', exibido),
    );

    /* A marca fica só no lado importado: é ele que muda o que já está gravado. */
    if (ehImportada && cru !== camposDaOutra[indice][2]) {
      campo.append(criarElemento('span', 'marca-de-diferenca', 'diferente'));
    }

    lado.append(campo);
  }

  return lado;
}

function criarCartaoDeConflito(conflito) {
  const cabecalho = criarElemento('div', 'cabecalho-do-conflito');
  cabecalho.append(
    criarElemento('strong', null, conflito.nomeDoCliente),
    criarElemento('span', 'linha-de-exportacao-url', conflito.url),
  );

  const colunas = criarElemento('div', 'colunas-do-conflito');
  colunas.append(criarLadoDoConflito(conflito, false), criarLadoDoConflito(conflito, true));

  const cartao = criarElemento('div', 'conflito-de-importacao');
  cartao.append(cabecalho, colunas);
  return cartao;
}

/** O que entra sem perguntar: cliente inédito e base de URL que ninguém tem. */
function criarResumoDoQueEntra(clientesNovos, basesNovas) {
  const bloco = criarElemento('div', 'resumo-da-importacao');
  bloco.append(criarElemento('h3', null, 'Entra direto'));

  const itens = criarElemento('ul', 'resumo-da-importacao-itens');
  for (const nome of clientesNovos) {
    itens.append(criarElemento('li', null, `Cliente novo: ${nome}`));
  }
  for (const { nomeDoCliente, base } of basesNovas) {
    const tipo = ROTULOS_DE_TIPO_DE_BASE[base.tipo] ?? base.tipo;
    itens.append(criarElemento('li', null, `${nomeDoCliente} — base de ${tipo}: ${base.url}`));
  }

  bloco.append(itens);
  return bloco;
}

/** O que o leitor não conseguiu aproveitar fica na tela para não passar batido. */
function criarAvisosDoArquivo(avisos) {
  const bloco = criarElemento('div', 'avisos-do-arquivo');
  bloco.append(criarElemento('h3', null, 'O arquivo tem coisas que ficaram de fora'));

  const itens = criarElemento('ul', 'resumo-da-importacao-itens');
  for (const aviso of avisos) {
    itens.append(criarElemento('li', null, aviso));
  }

  bloco.append(itens);
  return bloco;
}

function resumoDaImportacaoDeCadastros(clientesNovos, basesNovas, conflitos) {
  const partes = [];

  if (clientesNovos.length > 0) {
    partes.push(`${clientesNovos.length} cliente(s) novo(s)`);
  }
  if (basesNovas.length > 0) {
    partes.push(`${basesNovas.length} base(s) nova(s)`);
  }
  if (conflitos.length > 0) {
    partes.push(`${conflitos.length} base(s) já cadastrada(s)`);
  }

  return partes.length === 0 ? 'Nada para importar deste arquivo.' : `${partes.join(', ')}.`;
}

function renderizarCadastrosDaImportacao() {
  const { clientesNovos, basesNovas, conflitos, avisos } = estado.importacao.cadastros;

  elementos.resumoDosCadastros.textContent = resumoDaImportacaoDeCadastros(
    clientesNovos,
    basesNovas,
    conflitos,
  );
  /* Com um conflito só, os botões de todos seriam outro jeito de clicar no mesmo. */
  elementos.acoesDosConflitos.hidden = conflitos.length < 2;

  const blocos = [];
  if (avisos.length > 0) {
    blocos.push(criarAvisosDoArquivo(avisos));
  }
  if (clientesNovos.length > 0 || basesNovas.length > 0) {
    blocos.push(criarResumoDoQueEntra(clientesNovos, basesNovas));
  }
  blocos.push(...conflitos.map((conflito) => criarCartaoDeConflito(conflito)));

  elementos.linhasDeCadastros.replaceChildren(...blocos);
  elementos.botaoConcluirImportacao.disabled =
    clientesNovos.length === 0 && basesNovas.length === 0 && conflitos.length === 0;
}

function definirDecisaoDeTodosOsConflitos(substituir) {
  const { conflitos, decisoes } = estado.importacao.cadastros;
  for (const conflito of conflitos) {
    decisoes.set(conflito.chave, substituir);
  }

  renderizarCadastrosDaImportacao();
}

/** Lê o arquivo no próprio navegador e já avança para a conferência. */
async function carregarArquivoDeCadastros(arquivo) {
  if (!arquivo) {
    return;
  }

  let leitura;
  try {
    leitura = lerCadastrosDoTexto(await arquivo.text());
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
    return;
  }

  const plano = montarPlanoDaImportacaoDeCadastros(leitura.clientes);
  estado.importacao.cadastros = {
    nomeDoArquivo: arquivo.name,
    clientes: leitura.clientes,
    avisos: leitura.avisos,
    ...plano,
    decisoes: new Map(plano.conflitos.map((conflito) => [conflito.chave, false])),
  };

  elementos.nomeDoArquivoDeCadastros.textContent = `Arquivo: ${arquivo.name}`;
  elementos.nomeDoArquivoDeCadastros.hidden = false;

  definirEtapaDaImportacao('cadastros');
  renderizarCadastrosDaImportacao();
}

/** Só o que aconteceu entra no aviso; zero em tudo vira "nada mudou". */
function mensagemDaImportacaoDeCadastros(resultado) {
  const partes = [];

  if (resultado.clientesCriados > 0) {
    partes.push(`${resultado.clientesCriados} cliente(s) criado(s)`);
  }
  if (resultado.basesCriadas > 0) {
    partes.push(`${resultado.basesCriadas} base(s) importada(s)`);
  }
  if (resultado.basesSubstituidas > 0) {
    partes.push(`${resultado.basesSubstituidas} base(s) substituída(s)`);
  }
  if (resultado.basesIgnoradas > 0) {
    partes.push(`${resultado.basesIgnoradas} base(s) mantida(s) como estavam`);
  }

  return partes.length === 0 ? 'Nada mudou no cadastro.' : `${partes.join(', ')}.`;
}

async function concluirImportacaoDeCadastros() {
  const { clientes, decisoes } = estado.importacao.cadastros;

  const paraImportar = clientes.map((cliente) => ({
    nome: cliente.nome,
    bases: cliente.bases.map((base) => ({
      ...base,
      substituir: decisoes.get(chaveDoConflito(cliente.nome, base.url)) ?? false,
    })),
  }));

  limparErro(elementos.erroImportacao);
  elementos.botaoConcluirImportacao.disabled = true;

  try {
    const resultado = await api.importarCadastros(paraImportar);
    await recarregarClientes();
    elementos.modalImportacao.close();
    exibirAviso(mensagemDaImportacaoDeCadastros(resultado));
  } catch (erro) {
    exibirErro(elementos.erroImportacao, erro.message);
  } finally {
    elementos.botaoConcluirImportacao.disabled = false;
  }
}

/* ------------------------- exportação de bases ---------------------------- */

const SEPARADOR_DE_EXPORTACAO = '-'.repeat(60);

/**
 * Seleção inicial: o acesso ao SankhyaOm já vem marcado, que é o caso comum.
 * O banco fica desmarcado — credencial de banco só sai quando pedida de propósito.
 */
function selecaoInicialDeExportacao(bases) {
  return new Map(bases.map((base) => [base.id, { sankhyaOm: true, bancoDeDados: false }]));
}

function algumaOpcaoDeExportacaoMarcada() {
  for (const selecao of estado.exportacao.selecoes.values()) {
    if (selecao.sankhyaOm || selecao.bancoDeDados) {
      return true;
    }
  }

  return false;
}

function atualizarBotoesDaExportacao() {
  const habilitado = algumaOpcaoDeExportacaoMarcada();
  elementos.botaoCopiarExportacao.disabled = !habilitado;
  elementos.botaoBaixarExportacao.disabled = !habilitado;
}

const COLUNAS_DA_EXPORTACAO = [
  { chave: 'sankhyaOm', rotulo: 'SankhyaOm' },
  { chave: 'bancoDeDados', rotulo: 'Banco de Dados' },
];

/**
 * Grade de checkboxes por coluna, com o mestre que marca a coluna inteira.
 *
 * Serve às duas exportações — as bases de um cliente e os cadastros de vários.
 * As referências dos checkboxes ficam guardadas aqui e é só nelas que os cliques
 * mexem: redesenhar a lista a cada marcação roubaria o foco de quem está usando
 * o teclado.
 *
 * `selecoes` é o mapa `id da linha -> { chave da coluna: marcado }`, e é ele que
 * a montagem do texto lê depois. `aoMudar` é chamado a cada marcação.
 */
function criarGradeDeMarcacao(colunas, selecoes, aoMudar = () => {}) {
  const porColuna = new Map(colunas.map((coluna) => [coluna.chave, { mestre: null, linhas: [] }]));

  /* Linha bloqueada não conta: nunca pode ser marcada nessa coluna. */
  const marcaveis = (chave) => porColuna.get(chave).linhas.filter((entrada) => !entrada.disabled);

  /* Mestre marcado só com todas as linhas marcadas; parcial vira o traço do indeterminado. */
  function atualizarMestre(chave) {
    const { mestre } = porColuna.get(chave);
    if (!mestre) {
      return;
    }

    const linhas = marcaveis(chave);
    const marcadas = linhas.filter((entrada) => entrada.checked).length;

    mestre.disabled = linhas.length === 0;
    mestre.checked = linhas.length > 0 && marcadas === linhas.length;
    mestre.indeterminate = marcadas > 0 && marcadas < linhas.length;
  }

  function criarCampo(entrada, rotulo, titulo) {
    const campo = criarElemento('label', 'campo-checkbox');
    campo.append(entrada, criarElemento('span', null, rotulo));
    if (titulo) {
      campo.title = titulo;
    }
    return campo;
  }

  return {
    criarCheckbox(idDaLinha, coluna, { desabilitado = false, tituloDesabilitado = '' } = {}) {
      const entrada = criarElemento('input');
      entrada.type = 'checkbox';
      entrada.dataset.idDaLinha = idDaLinha;
      entrada.checked = selecoes.get(idDaLinha)[coluna.chave];
      entrada.disabled = desabilitado;
      entrada.addEventListener('change', () => {
        selecoes.get(idDaLinha)[coluna.chave] = entrada.checked;
        atualizarMestre(coluna.chave);
        aoMudar();
      });

      porColuna.get(coluna.chave).linhas.push(entrada);
      return criarCampo(entrada, coluna.rotulo, desabilitado ? tituloDesabilitado : '');
    },

    criarMestre(coluna) {
      const entrada = criarElemento('input');
      entrada.type = 'checkbox';
      entrada.addEventListener('change', () => {
        for (const linha of marcaveis(coluna.chave)) {
          linha.checked = entrada.checked;
          selecoes.get(linha.dataset.idDaLinha)[coluna.chave] = entrada.checked;
        }
        atualizarMestre(coluna.chave);
        aoMudar();
      });

      porColuna.get(coluna.chave).mestre = entrada;
      return criarCampo(
        entrada,
        coluna.rotulo,
        `Marcar ou desmarcar ${coluna.rotulo} em todas as linhas`,
      );
    },

    atualizarMestres() {
      for (const coluna of colunas) {
        atualizarMestre(coluna.chave);
      }
    },
  };
}

/* Refeita a cada desenho do modal: as referências morrem com a lista antiga. */
let gradeDaExportacao = null;

function criarLinhaDeExportacao(base) {
  const identificacao = criarElemento('div', 'linha-de-exportacao-info');
  identificacao.append(
    criarElemento(
      'span',
      `selo-tipo ${base.tipo}`,
      ROTULOS_DE_TIPO_DE_BASE[base.tipo] ?? base.tipo,
    ),
    criarElemento('span', 'linha-de-exportacao-url', base.url),
  );

  const opcoes = criarElemento('div', 'linha-de-exportacao-opcoes');
  opcoes.append(
    gradeDaExportacao.criarCheckbox(base.id, COLUNAS_DA_EXPORTACAO[0]),
    gradeDaExportacao.criarCheckbox(base.id, COLUNAS_DA_EXPORTACAO[1], {
      desabilitado: !base.bancoDeDados,
      tituloDesabilitado: 'Esta base não tem banco de dados cadastrado.',
    }),
  );

  const linha = criarElemento('div', 'linha-de-exportacao');
  linha.append(identificacao, opcoes);
  return linha;
}

function renderizarLinhasDeExportacao() {
  gradeDaExportacao = criarGradeDeMarcacao(
    COLUNAS_DA_EXPORTACAO,
    estado.exportacao.selecoes,
    atualizarBotoesDaExportacao,
  );

  const bases = basesOrdenadasPorTipo(estado.exportacao.cliente.bases);
  elementos.linhasDeExportacao.replaceChildren(
    ...bases.map((base) => criarLinhaDeExportacao(base)),
  );

  /* Com uma única base os mestres seriam um segundo jeito de clicar na mesma coisa. */
  const comMestres = bases.length > 1;
  elementos.barraDeExportacao.hidden = !comMestres;
  elementos.mestresDeExportacao.replaceChildren(
    ...(comMestres
      ? COLUNAS_DA_EXPORTACAO.map((coluna) => gradeDaExportacao.criarMestre(coluna))
      : []),
  );

  gradeDaExportacao.atualizarMestres();
}

function abrirModalDeExportacao(cliente) {
  estado.exportacao.cliente = cliente;
  estado.exportacao.selecoes = selecaoInicialDeExportacao(cliente.bases);

  elementos.modalExportacaoSubtitulo.textContent = `Escolha o que compartilhar de cada base de ${cliente.nome}.`;
  renderizarLinhasDeExportacao();
  atualizarBotoesDaExportacao();
  elementos.modalExportacao.showModal();
}

/** Campo opcional em branco vira traço, como no restante da tela. */
function linhasDeCamposExportados(campos) {
  return campos.map(([rotulo, valor]) => `${rotulo}: ${valor || SEM_VALOR}`);
}

/**
 * O trecho da base no arquivo: tipo e URL sempre, credencial só quando pedida.
 *
 * É o mesmo formato nas duas exportações, porque é ele que a importação lê de
 * volta — o que sai do "Compartilhar" de um cliente entra pelo assistente igual
 * ao arquivo de vários.
 */
function trechoDaBaseExportada(base, comCredenciais) {
  const campos = [
    ['Tipo de base', ROTULOS_DE_TIPO_DE_BASE[base.tipo] ?? base.tipo],
    ['URL', base.url],
  ];

  if (comCredenciais) {
    campos.push(['Usuário', base.usuario], ['Senha', base.senha]);
  }

  return linhasDeCamposExportados(campos).join('\n');
}

function trechoDoBancoDeDados(banco) {
  return [
    'Banco de dados',
    ...linhasDeCamposExportados([
      ['Host', banco.host],
      ['Porta', String(banco.porta)],
      ['Serviço', banco.nomeDoServico],
      ['Usuário', banco.usuario],
      ['Senha', banco.senha],
    ]),
  ].join('\n');
}

/** Base sem nenhuma opção marcada fica de fora; sem nenhuma marcação, o texto é vazio. */
function montarTextoDaExportacao() {
  const cliente = estado.exportacao.cliente;
  const blocos = [];

  for (const base of basesOrdenadasPorTipo(cliente.bases)) {
    const selecao = estado.exportacao.selecoes.get(base.id);
    const trechos = [];

    if (selecao.sankhyaOm) {
      trechos.push(trechoDaBaseExportada(base, true));
    }

    if (selecao.bancoDeDados && base.bancoDeDados) {
      trechos.push(trechoDoBancoDeDados(base.bancoDeDados));
    }

    if (trechos.length === 0) {
      continue;
    }

    /* O nome do cliente encabeça o bloco: sem ele, quem recebe só o trecho do
       banco não tem como saber de quem é a base. */
    blocos.push([`Cliente: ${cliente.nome}`, ...trechos].join('\n\n'));
  }

  return blocos.join(`\n\n${SEPARADOR_DE_EXPORTACAO}\n\n`);
}

/*
 * Só os caracteres proibidos em nome de arquivo no Windows viram espaço —
 * acento e maiúscula ficam como estão, porque o nome é para ser lido.
 */
const CARACTERES_INVALIDOS_EM_NOME_DE_ARQUIVO = /[\\/:*?"<>|]+/g;

function nomeDoArquivoDeExportacao(nomeDoCliente) {
  const nomeLimpo = nomeDoCliente
    .replace(CARACTERES_INVALIDOS_EM_NOME_DE_ARQUIVO, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return `Acessos - ${nomeLimpo || 'cliente'}.txt`;
}

/** Baixa o texto como arquivo, sem passar pelo servidor. */
function baixarTexto(texto, nomeDoArquivo) {
  const endereco = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
  const link = criarElemento('a');
  link.href = endereco;
  link.download = nomeDoArquivo;
  link.click();
  URL.revokeObjectURL(endereco);

  exibirAviso('Arquivo de exportação gerado.');
}

function baixarExportacao() {
  const texto = montarTextoDaExportacao();
  if (!texto) {
    return;
  }

  baixarTexto(texto, nomeDoArquivoDeExportacao(estado.exportacao.cliente.nome));
}

function copiarExportacao() {
  const texto = montarTextoDaExportacao();
  if (!texto) {
    return;
  }

  copiarParaAreaDeTransferencia(texto, 'Informações das bases copiadas.');
}

/* ---------------- exportação de cadastros para arquivo -------------------- */

const ETAPAS_DA_EXPORTACAO_DE_CADASTROS = {
  clientes: {
    subtitulo: 'Marque os clientes que devem entrar no arquivo.',
    anterior: null,
  },
  opcoes: {
    subtitulo:
      'Nome do cliente, URL e tipo de cada base sempre saem. Marque o que mais deve ir junto.',
    anterior: 'clientes',
  },
};

const COLUNAS_DA_EXPORTACAO_DE_CADASTROS = [
  { chave: 'credenciais', rotulo: 'Credenciais' },
  { chave: 'banco', rotulo: 'Banco' },
];

const NOME_DO_ARQUIVO_DE_CADASTROS = 'Cadastros HUB SNK.txt';

/* Refeita a cada desenho da etapa, como a da exportação de bases. */
let gradeDaExportacaoDeCadastros = null;

/* Nada marcado por padrão: senha de base e de banco só saem quando pedidas. */
function selecaoInicialDeExportacaoDeCadastros(clientes) {
  return new Map(clientes.map((cliente) => [cliente.id, { credenciais: false, banco: false }]));
}

function clientesSelecionadosParaExportacao() {
  return estado.clientes.filter((cliente) =>
    estado.exportacaoDeCadastros.selecionados.has(cliente.id),
  );
}

/** Sem nenhuma base com usuário ou senha anotados não há credencial a exportar. */
function clienteTemCredencial(cliente) {
  return cliente.bases.some((base) => base.usuario !== '' || base.senha !== '');
}

function clienteTemBanco(cliente) {
  return cliente.bases.some((base) => Boolean(base.bancoDeDados));
}

/** "3 base(s) · 2 com banco": o que o cliente tem para levar para o arquivo. */
function resumoDasBasesDoCliente(cliente) {
  if (cliente.bases.length === 0) {
    return 'Nenhuma base';
  }

  const comBanco = cliente.bases.filter((base) => base.bancoDeDados).length;
  const bases = `${cliente.bases.length} base(s)`;
  return comBanco === 0 ? bases : `${bases} · ${comBanco} com banco`;
}

function atualizarResumoDosClientesAExportar() {
  const quantidade = estado.exportacaoDeCadastros.selecionados.size;

  elementos.resumoDosClientesAExportar.textContent =
    quantidade === 0 ? 'Nenhum cliente selecionado.' : `${quantidade} cliente(s) selecionado(s).`;
  elementos.botaoAvancarExportacaoDeCadastros.disabled = quantidade === 0;
}

function criarLinhaDeClienteAExportar(cliente) {
  const entrada = criarElemento('input');
  entrada.type = 'checkbox';
  entrada.checked = estado.exportacaoDeCadastros.selecionados.has(cliente.id);
  entrada.addEventListener('change', () => {
    if (entrada.checked) {
      estado.exportacaoDeCadastros.selecionados.add(cliente.id);
    } else {
      estado.exportacaoDeCadastros.selecionados.delete(cliente.id);
    }
    atualizarResumoDosClientesAExportar();
  });

  const marcacao = criarElemento('label', 'campo-checkbox');
  marcacao.append(entrada, criarElemento('span', null, cliente.nome));

  const identificacao = criarElemento('div', 'linha-de-exportacao-info');
  identificacao.append(marcacao);

  const linha = criarElemento('div', 'linha-de-exportacao');
  linha.append(
    identificacao,
    criarElemento('span', 'linha-de-exportacao-resumo', resumoDasBasesDoCliente(cliente)),
  );
  return linha;
}

function renderizarClientesAExportar() {
  elementos.linhasDeClientesAExportar.replaceChildren(
    ...estado.clientes.map((cliente) => criarLinhaDeClienteAExportar(cliente)),
  );
  atualizarResumoDosClientesAExportar();
}

function definirSelecaoDeClientesAExportar(marcado) {
  estado.exportacaoDeCadastros.selecionados = marcado
    ? new Set(estado.clientes.map((cliente) => cliente.id))
    : new Set();
  renderizarClientesAExportar();
}

function criarLinhaDeExportacaoDeCadastro(cliente) {
  const identificacao = criarElemento('div', 'linha-de-exportacao-info');
  identificacao.append(criarElemento('span', 'linha-de-exportacao-nome', cliente.nome));

  const opcoes = criarElemento('div', 'linha-de-exportacao-opcoes');
  opcoes.append(
    gradeDaExportacaoDeCadastros.criarCheckbox(cliente.id, COLUNAS_DA_EXPORTACAO_DE_CADASTROS[0], {
      desabilitado: !clienteTemCredencial(cliente),
      tituloDesabilitado: 'Nenhuma base deste cliente tem usuário ou senha anotados.',
    }),
    gradeDaExportacaoDeCadastros.criarCheckbox(cliente.id, COLUNAS_DA_EXPORTACAO_DE_CADASTROS[1], {
      desabilitado: !clienteTemBanco(cliente),
      tituloDesabilitado: 'Nenhuma base deste cliente tem banco de dados cadastrado.',
    }),
  );

  const linha = criarElemento('div', 'linha-de-exportacao');
  linha.append(identificacao, opcoes);
  return linha;
}

function renderizarOpcoesDaExportacaoDeCadastros() {
  gradeDaExportacaoDeCadastros = criarGradeDeMarcacao(
    COLUNAS_DA_EXPORTACAO_DE_CADASTROS,
    estado.exportacaoDeCadastros.selecoes,
  );

  const clientes = clientesSelecionadosParaExportacao();
  elementos.linhasDeExportacaoDeCadastros.replaceChildren(
    ...clientes.map((cliente) => criarLinhaDeExportacaoDeCadastro(cliente)),
  );

  /* Com um único cliente os mestres seriam um segundo jeito de clicar no mesmo. */
  const comMestres = clientes.length > 1;
  elementos.barraDeExportacaoDeCadastros.hidden = !comMestres;
  elementos.mestresDeExportacaoDeCadastros.replaceChildren(
    ...(comMestres
      ? COLUNAS_DA_EXPORTACAO_DE_CADASTROS.map((coluna) =>
          gradeDaExportacaoDeCadastros.criarMestre(coluna),
        )
      : []),
  );

  gradeDaExportacaoDeCadastros.atualizarMestres();
}

function definirEtapaDaExportacaoDeCadastros(etapa) {
  estado.exportacaoDeCadastros.etapa = etapa;
  limparErro(elementos.erroExportacaoDeCadastros);

  elementos.modalExportacaoDeCadastrosSubtitulo.textContent =
    ETAPAS_DA_EXPORTACAO_DE_CADASTROS[etapa].subtitulo;
  elementos.etapaExportacaoClientes.hidden = etapa !== 'clientes';
  elementos.etapaExportacaoOpcoes.hidden = etapa !== 'opcoes';

  const naEscolhaDosClientes = etapa === 'clientes';
  elementos.botaoVoltarExportacaoDeCadastros.hidden = naEscolhaDosClientes;
  elementos.botaoAvancarExportacaoDeCadastros.hidden = !naEscolhaDosClientes;
  elementos.botaoCopiarExportacaoDeCadastros.hidden = naEscolhaDosClientes;
  elementos.botaoBaixarExportacaoDeCadastros.hidden = naEscolhaDosClientes;
}

/* Todos já vêm marcados: exportar a base inteira é o caso comum. */
function abrirModalDeExportacaoDeCadastros() {
  estado.exportacaoDeCadastros.selecionados = new Set(estado.clientes.map((cliente) => cliente.id));
  estado.exportacaoDeCadastros.selecoes = selecaoInicialDeExportacaoDeCadastros(estado.clientes);

  renderizarClientesAExportar();
  definirEtapaDaExportacaoDeCadastros('clientes');
  elementos.modalExportacaoDeCadastros.showModal();
}

function avancarExportacaoDeCadastros() {
  if (estado.exportacaoDeCadastros.selecionados.size === 0) {
    exibirErro(elementos.erroExportacaoDeCadastros, 'Selecione ao menos um cliente.');
    return;
  }

  definirEtapaDaExportacaoDeCadastros('opcoes');
  renderizarOpcoesDaExportacaoDeCadastros();
}

function voltarExportacaoDeCadastros() {
  definirEtapaDaExportacaoDeCadastros('clientes');
  renderizarClientesAExportar();
}

/**
 * Um bloco por base, como no compartilhamento de um cliente só.
 *
 * Cliente sem base entra com o nome sozinho: é o que permite a importação
 * recriar o cadastro do outro lado mesmo sem base nenhuma.
 */
function montarTextoDaExportacaoDeCadastros() {
  const blocos = [];

  for (const cliente of clientesSelecionadosParaExportacao()) {
    const selecao = estado.exportacaoDeCadastros.selecoes.get(cliente.id);
    const cabecalho = `Cliente: ${cliente.nome}`;

    if (cliente.bases.length === 0) {
      blocos.push(cabecalho);
      continue;
    }

    for (const base of basesOrdenadasPorTipo(cliente.bases)) {
      const trechos = [trechoDaBaseExportada(base, selecao.credenciais)];
      if (selecao.banco && base.bancoDeDados) {
        trechos.push(trechoDoBancoDeDados(base.bancoDeDados));
      }

      blocos.push([cabecalho, ...trechos].join('\n\n'));
    }
  }

  return blocos.join(`\n\n${SEPARADOR_DE_EXPORTACAO}\n\n`);
}

/* Um cliente só sai com o nome dele no arquivo, como no "Compartilhar". */
function nomeDoArquivoDaExportacaoDeCadastros() {
  const clientes = clientesSelecionadosParaExportacao();
  return clientes.length === 1
    ? nomeDoArquivoDeExportacao(clientes[0].nome)
    : NOME_DO_ARQUIVO_DE_CADASTROS;
}

function baixarExportacaoDeCadastros() {
  const texto = montarTextoDaExportacaoDeCadastros();
  if (!texto) {
    return;
  }

  baixarTexto(texto, nomeDoArquivoDaExportacaoDeCadastros());
}

function copiarExportacaoDeCadastros() {
  const texto = montarTextoDaExportacaoDeCadastros();
  if (!texto) {
    return;
  }

  copiarParaAreaDeTransferencia(texto, 'Cadastros copiados.');
}

/* -------------------------------- exclusões ------------------------------- */

/**
 * `recarregar` é `recarregarClientes` por padrão: a maioria das exclusões é de
 * cliente, base ou repositório. Base e banco locais recarregam a visão local.
 */
function pedirExclusao(
  titulo,
  texto,
  executar,
  mensagemDeSucesso,
  recarregar = recarregarClientes,
) {
  estado.exclusaoPendente = { executar, mensagemDeSucesso, recarregar };
  elementos.tituloExclusao.textContent = titulo;
  elementos.textoExclusao.textContent = texto;
  elementos.modalExclusao.showModal();
}

function pedirExclusaoDeCliente(cliente) {
  const quantidade = cliente.bases.length;
  const complemento =
    quantidade === 0
      ? ''
      : ` As ${quantidade} base${quantidade > 1 ? 's' : ''} cadastrada${quantidade > 1 ? 's' : ''} também ${quantidade > 1 ? 'serão excluídas' : 'será excluída'}.`;

  pedirExclusao(
    'Excluir cliente',
    `Excluir "${cliente.nome}"?${complemento} Esta ação não pode ser desfeita.`,
    async () => {
      await api.remover(cliente.id);
      if (estado.idSelecionado === cliente.id) {
        estado.idSelecionado = null;
      }
    },
    'Cliente excluído.',
  );
}

function pedirExclusaoDeBase(cliente, base) {
  pedirExclusao(
    'Excluir base',
    `Excluir a base "${base.url}" de ${cliente.nome}? Esta ação não pode ser desfeita.`,
    () => api.removerBase(cliente.id, base.id),
    'Base excluída.',
  );
}

function pedirExclusaoDeRepositorio(cliente, repositorio) {
  pedirExclusao(
    'Excluir repositório',
    `Excluir o repositório "${repositorio.url}" de ${cliente.nome}? Esta ação não pode ser desfeita.`,
    () => api.removerRepositorio(cliente.id, repositorio.id),
    'Repositório excluído.',
  );
}

function pedirExclusaoDeLink(cliente, link) {
  pedirExclusao(
    'Excluir link',
    `Excluir o link "${link.nome}" de ${cliente.nome}? Esta ação não pode ser desfeita.`,
    () => api.removerLink(cliente.id, link.id),
    'Link excluído.',
  );
}

async function confirmarExclusao() {
  const pendente = estado.exclusaoPendente;
  if (!pendente) {
    return;
  }

  elementos.botaoConfirmarExclusao.disabled = true;

  try {
    await pendente.executar();
    await pendente.recarregar();
    elementos.modalExclusao.close();
    exibirAviso(pendente.mensagemDeSucesso);
  } catch (erro) {
    exibirAviso(erro.message, 'erro');
  } finally {
    elementos.botaoConfirmarExclusao.disabled = false;
    estado.exclusaoPendente = null;
  }
}

/* ----------------------------------- tema --------------------------------- */

function aplicarTema(tema) {
  document.documentElement.dataset.theme = tema;
  localStorage.setItem(CHAVE_DO_TEMA, tema);
  atualizarIconeDoTema();
}

/* O ícone mostra o tema de destino: sol no escuro, lua no claro. */
function atualizarIconeDoTema() {
  const estaNoTemaClaro = document.documentElement.dataset.theme === 'light';
  const rotulo = estaNoTemaClaro ? 'Ativar tema escuro' : 'Ativar tema claro';

  elementos.botaoTema.replaceChildren(
    criarIcone(estaNoTemaClaro ? ICONES.temaEscuro : ICONES.temaClaro),
  );
  elementos.botaoTema.title = rotulo;
  elementos.botaoTema.setAttribute('aria-label', rotulo);
}

function alternarTema() {
  aplicarTema(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
}

function restaurarTema() {
  const salvo = localStorage.getItem(CHAVE_DO_TEMA);
  if (salvo === 'light' || salvo === 'dark') {
    document.documentElement.dataset.theme = salvo;
  }
}

/* ------------------------------- inicialização ---------------------------- */

async function recarregarClientes() {
  estado.clientes = await api.listar();

  // O HUB SNK abre sem seleção; aqui só se descarta um cliente que deixou de existir.
  const aindaExiste = estado.clientes.some((cliente) => cliente.id === estado.idSelecionado);
  if (!aindaExiste) {
    estado.idSelecionado = null;
  }

  renderizar();
  await carregarSituacoesGit();
}

/**
 * Verificação dos repositórios locais, feita depois do desenho da tela.
 *
 * São vários processos `git` por repositório: se isso entrasse na carga do
 * cadastro, o HUB SNK só apareceria quando o último terminasse. Falha aqui não
 * interrompe nada — o cadastro continua utilizável sem os indicadores.
 */
async function carregarSituacoesGit(forcar = false, silencioso = false) {
  try {
    estado.situacoesGit = await api.lerSituacaoGit(forcar);
  } catch (erro) {
    // Silencioso: o tique automático não deve encher a tela de avisos a cada minuto sem rede.
    if (!silencioso) {
      exibirAviso(`Não foi possível verificar os repositórios: ${erro.message}`, 'erro');
    }
    return;
  }

  renderizar();
}

/* ------------------------- execução automática ---------------------------- */

let cronometroDeExecucaoAutomatica = null;

/**
 * Cronômetro único de tudo que a tela refaz sozinha, no intervalo configurado:
 * diagnóstico Git dos repositórios, situação de cada base e de cada banco
 * local e situação das bases do cliente selecionado. Cada tique também
 * alimenta o gráfico de uptime — é o polling do front que gera as amostras
 * guardadas no servidor.
 *
 * Só dispara com a aba visível: em segundo plano o navegador atrasa timers de
 * qualquer forma, mas checar evita disparar um lote de processos `git` e de
 * comandos `docker` que ninguém vai ver.
 */
function definirExecucaoAutomatica(intervaloSegundos) {
  if (cronometroDeExecucaoAutomatica !== null) {
    clearInterval(cronometroDeExecucaoAutomatica);
    cronometroDeExecucaoAutomatica = null;
  }

  if (!intervaloSegundos || intervaloSegundos <= 0) {
    return;
  }

  cronometroDeExecucaoAutomatica = setInterval(() => {
    if (document.visibilityState === 'visible') {
      carregarSituacoesGit(false, true);
      carregarSituacoesDasBasesLocais();
      carregarSituacoesDosBancosLocais();
      carregarSituacoesDasBasesDoClienteSelecionado();
    }
  }, intervaloSegundos * MILISSEGUNDOS_POR_SEGUNDO);
}

/**
 * Relê um cliente do servidor e o substitui no estado.
 *
 * Parte do que a tela mostra vem do disco e não do cadastro — a cor do botão do
 * MCP depende do `.sankhya-mcp.env`, que pode ter sido criado ou apagado fora do
 * HUB SNK. Por isso o cliente é relido, e não apenas redesenhado do que já
 * está em memória.
 */
async function recarregarCliente(id) {
  const cliente = await api.buscar(id);
  const posicao = estado.clientes.findIndex((candidato) => candidato.id === id);

  if (posicao === -1) {
    estado.clientes.push(cliente);
    return;
  }

  estado.clientes[posicao] = cliente;
}

/**
 * Seleciona e relê o cliente.
 *
 * A tela é desenhada duas vezes de propósito: a primeira responde ao clique na
 * hora, com o que já está em memória; a segunda entra quando a releitura chega.
 * Se o usuário trocar de cliente nesse meio-tempo, o resultado atrasado é
 * descartado para não redesenhar por cima da nova seleção.
 */
async function selecionarCliente(id) {
  estado.idSelecionado = id;
  renderizar();

  try {
    await recarregarCliente(id);
  } catch (erro) {
    exibirAviso(`Não foi possível carregar o cliente: ${erro.message}`, 'erro');
    return;
  }

  if (estado.idSelecionado === id) {
    renderizar();
    carregarSituacoesDasBasesDoClienteSelecionado();
  }
}

/**
 * Botão de recarregar: mesma releitura, com retorno visível de que rodou.
 *
 * A situação Git é refeita ignorando o cache do servidor — é justamente aqui
 * que o usuário pede o dado do momento, depois de commitar ou dar push.
 */
async function recarregarDetalhe(id) {
  try {
    await recarregarCliente(id);
  } catch (erro) {
    exibirAviso(`Não foi possível recarregar o cliente: ${erro.message}`, 'erro');
    return;
  }

  renderizar();
  carregarSituacoesDasBasesDoClienteSelecionado();
  await carregarSituacoesGit(true);
  exibirAviso('Informações recarregadas.');
}

function registrarEventos() {
  elementos.botaoNovoCliente.append(criarIcone(ICONES.mais));
  elementos.botaoNovoCliente.addEventListener('click', abrirModalDeCadastro);
  atualizarIconeDoTema();
  elementos.botaoTema.addEventListener('click', alternarTema);

  elementos.botaoVisualizacaoClientes.addEventListener('click', () =>
    alternarVisualizacao('clientes'),
  );
  elementos.botaoVisualizacaoLocal.addEventListener('click', () => alternarVisualizacao('local'));

  elementos.botaoAtalhos.append(criarIcone(ICONES.raio));
  elementos.botaoAtalhos.addEventListener('click', alternarListaDeAtalhos);

  /*
   * A lista só fecha por ação: clique em qualquer ponto fora dela ou `Esc`.
   * Passar o mouse por fora não fecha — a lista fica no ar até o usuário
   * decidir.
   */
  document.addEventListener('click', (evento) => {
    if (listaDeAtalhosEstaAberta() && !elementos.menuDeAtalhos.contains(evento.target)) {
      fecharListaDeAtalhos();
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && listaDeAtalhosEstaAberta()) {
      fecharListaDeAtalhos();
    }
  });

  elementos.botaoConfiguracao.append(criarIcone(ICONES.engrenagem));
  elementos.botaoConfiguracao.addEventListener('click', abrirModalDeConfiguracao);
  elementos.formularioConfiguracao.addEventListener('submit', salvarConfiguracao);
  elementos.abaConfiguracaoGeral.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoGeral),
  );
  elementos.abaConfiguracaoMcp.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoMcp),
  );
  elementos.abaConfiguracaoAtalhos.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoAtalhos),
  );
  elementos.botaoAdicionarAtalho.addEventListener('click', () => {
    const linha = adicionarLinhaDeAtalho({ id: '', nome: '', caminhoDoExecutavel: '' });
    linha.querySelector('input').focus();
  });
  elementos.botaoCancelarConfiguracao.addEventListener('click', () =>
    elementos.modalConfiguracao.close(),
  );
  elementos.botaoVerSenhaConfigMcp.addEventListener('click', () =>
    definirVisibilidadeDoCampo(
      elementos.campoConfigMcpSenha,
      elementos.botaoVerSenhaConfigMcp,
      elementos.campoConfigMcpSenha.type === 'password',
    ),
  );

  elementos.formularioCliente.addEventListener('submit', salvarCliente);
  elementos.botaoCancelarCliente.addEventListener('click', () => elementos.modalCliente.close());

  elementos.formularioBase.addEventListener('submit', salvarBase);
  elementos.botaoCancelarBase.addEventListener('click', () => elementos.modalBase.close());
  elementos.botaoVerSenha.addEventListener('click', () => {
    definirVisibilidadeDaSenha(elementos.campoSenha.type === 'password');
  });

  elementos.formularioBanco.addEventListener('submit', salvarBanco);
  elementos.botaoCancelarBanco.addEventListener('click', () => elementos.modalBanco.close());
  elementos.botaoDesvincularBanco.addEventListener('click', desvincularBanco);
  elementos.botaoVerSenhaBanco.addEventListener('click', () => {
    definirVisibilidadeDaSenhaDoBanco(elementos.campoSenhaBanco.type === 'password');
  });

  elementos.formularioMcp.addEventListener('submit', salvarConfiguracaoMcp);
  elementos.botaoCancelarMcp.addEventListener('click', () => elementos.modalMcp.close());
  elementos.botaoImportarBase.addEventListener('click', importarDadosDaBase);
  elementos.botaoVerSenhaMcp.addEventListener('click', () => {
    definirVisibilidadeDaSenhaDoMcp(elementos.campoMcpSenha.type === 'password');
  });

  elementos.formularioRepositorio.addEventListener('submit', salvarRepositorio);
  elementos.botaoEscolherCaminhoLocal.append(criarIcone(ICONES.pasta));
  elementos.botaoEscolherCaminhoLocal.title = 'Escolher a pasta';
  elementos.botaoEscolherCaminhoLocal.setAttribute('aria-label', 'Escolher a pasta');
  elementos.botaoEscolherCaminhoLocal.addEventListener('click', escolherCaminhoLocalDoRepositorio);
  elementos.botaoCancelarRepositorio.addEventListener('click', () =>
    elementos.modalRepositorio.close(),
  );

  elementos.formularioLink.addEventListener('submit', salvarLink);
  elementos.botaoCancelarLink.addEventListener('click', () => elementos.modalLink.close());

  elementos.formularioBaseLocal.addEventListener('submit', salvarBaseLocal);
  elementos.botaoEscolherCaminhoWildfly.append(criarIcone(ICONES.pasta));
  elementos.botaoEscolherCaminhoWildfly.title = 'Escolher a pasta';
  elementos.botaoEscolherCaminhoWildfly.setAttribute('aria-label', 'Escolher a pasta');
  elementos.botaoEscolherCaminhoWildfly.addEventListener('click', escolherCaminhoDoWildfly);
  elementos.botaoCancelarBaseLocal.addEventListener('click', () =>
    elementos.modalBaseLocal.close(),
  );

  elementos.formularioBancoLocal.addEventListener('submit', salvarBancoLocal);
  elementos.botaoCancelarBancoLocal.addEventListener('click', () =>
    elementos.modalBancoLocal.close(),
  );
  elementos.botaoVerSenhaBancoLocal.addEventListener('click', () => {
    definirVisibilidadeDaSenhaDoBancoLocal(elementos.campoSenhaBancoLocal.type === 'password');
  });

  registrarEventosDaImportacao();

  elementos.botaoConfirmarExclusao.addEventListener('click', confirmarExclusao);
  elementos.botaoCancelarExclusao.addEventListener('click', () => elementos.modalExclusao.close());

  elementos.busca.addEventListener('input', (evento) => {
    estado.filtro = evento.target.value;
    renderizarLista();
  });

  elementos.botaoFiltros.append(criarIcone(ICONES.funil));
  elementos.botaoFiltros.addEventListener('click', () =>
    definirPainelDeFiltros(elementos.painelDeFiltros.hidden),
  );
  elementos.botaoLimparFiltros.addEventListener('click', () => {
    estado.situacoesFiltradas.clear();
    renderizarLista();
  });
  registrarFechamentoDoPainelDeFiltros();
}

function registrarOpcaoDaImportacao(etapa, propriedade) {
  for (const opcao of etapa.querySelectorAll('input[type="radio"]')) {
    opcao.addEventListener('change', () => {
      estado.importacao[propriedade] = opcao.value;
      atualizarBotaoAvancarDaImportacao();
    });
  }
}

/** A área de arquivo aceita as duas entradas: arrastar o arquivo ou clicar e escolher. */
function registrarAreaDeArquivo(area, campo, aoEscolher) {
  const abrirSeletorDeArquivo = () => campo.click();

  area.addEventListener('click', abrirSeletorDeArquivo);
  area.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter' || evento.key === ' ') {
      evento.preventDefault();
      abrirSeletorDeArquivo();
    }
  });

  area.addEventListener('dragover', (evento) => {
    evento.preventDefault();
    area.classList.add('recebendo');
  });
  area.addEventListener('dragleave', () => {
    area.classList.remove('recebendo');
  });
  area.addEventListener('drop', (evento) => {
    evento.preventDefault();
    area.classList.remove('recebendo');
    aoEscolher(evento.dataTransfer?.files?.[0]);
  });

  campo.addEventListener('change', () => {
    const arquivo = campo.files?.[0];
    /* Zerar o campo permite reescolher o mesmo arquivo depois de um erro. */
    campo.value = '';
    aoEscolher(arquivo);
  });
}

function registrarEventosDaImportacao() {
  /* A origem escolhida decide para qual etapa o "Avançar" leva. */
  registrarOpcaoDaImportacao(elementos.etapaImportacaoOrigem, 'origem');

  elementos.botaoAdicionarPastaVarrida.addEventListener('click', adicionarPastaDaVarredura);
  elementos.botaoMarcarRepositorios.addEventListener('click', () =>
    definirSelecaoDeRepositorios(repositoriosImportaveis(), true),
  );
  elementos.botaoDesmarcarRepositorios.addEventListener('click', () =>
    definirSelecaoDeRepositorios(repositoriosImportaveis(), false),
  );

  registrarAreaDeArquivo(
    elementos.areaDeArquivo,
    elementos.campoArquivoDeFavoritos,
    carregarArquivoDeFavoritos,
  );
  registrarAreaDeArquivo(
    elementos.areaDeArquivoDeCadastros,
    elementos.campoArquivoDeCadastros,
    carregarArquivoDeCadastros,
  );

  elementos.botaoManterAtuais.addEventListener('click', () =>
    definirDecisaoDeTodosOsConflitos(false),
  );
  elementos.botaoSubstituirTodos.addEventListener('click', () =>
    definirDecisaoDeTodosOsConflitos(true),
  );

  elementos.botaoMarcarFavoritos.addEventListener('click', () =>
    definirSelecaoDeFavoritos(favoritosImportaveis(estado.importacao.pastas), true),
  );
  elementos.botaoDesmarcarFavoritos.addEventListener('click', () =>
    definirSelecaoDeFavoritos(favoritosImportaveis(estado.importacao.pastas), false),
  );

  elementos.botaoAvancarImportacao.addEventListener('click', avancarImportacao);
  elementos.botaoVoltarImportacao.addEventListener('click', voltarImportacao);
  elementos.botaoCancelarImportacao.addEventListener('click', () =>
    elementos.modalImportacao.close(),
  );
  elementos.formularioImportacao.addEventListener('submit', concluirImportacao);

  elementos.botaoFecharExportacao.addEventListener('click', () =>
    elementos.modalExportacao.close(),
  );
  elementos.botaoCopiarExportacao.addEventListener('click', copiarExportacao);
  elementos.botaoBaixarExportacao.addEventListener('click', baixarExportacao);

  elementos.botaoMarcarClientesAExportar.addEventListener('click', () =>
    definirSelecaoDeClientesAExportar(true),
  );
  elementos.botaoDesmarcarClientesAExportar.addEventListener('click', () =>
    definirSelecaoDeClientesAExportar(false),
  );
  elementos.botaoAvancarExportacaoDeCadastros.addEventListener(
    'click',
    avancarExportacaoDeCadastros,
  );
  elementos.botaoVoltarExportacaoDeCadastros.addEventListener('click', voltarExportacaoDeCadastros);
  elementos.botaoCancelarExportacaoDeCadastros.addEventListener('click', () =>
    elementos.modalExportacaoDeCadastros.close(),
  );
  elementos.botaoCopiarExportacaoDeCadastros.addEventListener('click', copiarExportacaoDeCadastros);
  elementos.botaoBaixarExportacaoDeCadastros.addEventListener('click', baixarExportacaoDeCadastros);
}

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.register('/sw.js').catch((erro) => {
    console.error('Falha ao registrar o service worker:', erro);
  });
}

/*
 * A versão só aparece se o servidor responder: rodapé com "vX.Y.Z" errado ou com
 * um traço no lugar seria pior do que rodapé sem versão nenhuma.
 */
async function exibirVersaoNoRodape() {
  try {
    const { versao } = await api.lerVersao();
    elementos.rodapeVersao.textContent = `v${versao}`;
  } catch {
    // Sem versão na tela; o resto do HUB SNK continua funcionando.
  }
}

/*
 * O aviso de versão nova entra depois, sozinho: a consulta passa pelo GitHub e
 * pode demorar ou não responder, e nada na tela depende dela. Enquanto isso o
 * rodapé fica como sempre foi.
 */
async function exibirAvisoDeVersaoNova() {
  try {
    const { atualizacaoDisponivel, ultimaVersao, url } = await api.lerAtualizacao();
    if (!atualizacaoDisponivel) {
      return;
    }

    elementos.rodapeAtualizacao.textContent = `${ultimaVersao} disponível`;
    elementos.rodapeAtualizacao.href = url;
    elementos.rodapeAtualizacao.hidden = false;
  } catch {
    // Sem internet ou sem release publicada: o rodapé segue sem o aviso.
  }
}

async function iniciar() {
  restaurarTema();
  registrarEventos();
  registrarServiceWorker();
  void exibirVersaoNoRodape();
  void exibirAvisoDeVersaoNova();

  try {
    await recarregarClientes();
  } catch (erro) {
    exibirAviso(`Não foi possível carregar os clientes: ${erro.message}`, 'erro');
  }

  try {
    const configuracao = await api.lerConfiguracao();
    definirExecucaoAutomatica(
      configuracao.intervaloDeExecucaoAutomaticaSegundos ??
        INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
    );
    estado.atalhos = configuracao.atalhos ?? [];
  } catch {
    // Sem a configuração, vale o padrão — não é motivo para outro aviso na tela.
    definirExecucaoAutomatica(INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S);
  }

  renderizarListaDeAtalhos();
}

iniciar();
