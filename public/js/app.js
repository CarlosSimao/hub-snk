/*
 * HUB SNK — camada de interface.
 *
 * Sem framework: o estado vive em um objeto único e a tela é redesenhada a
 * partir dele. O DOM é montado com `createElement`/`textContent`, nunca com
 * concatenação de HTML, para que dado digitado pelo usuário não vire injeção
 * de markup.
 */

import { lerCadastrosDoTexto } from './leitorDeArquivoDeCadastros.js';
import {
  buscarItens,
  montarItensDaBusca,
  registrarUsoRecente,
  ROTULOS_DOS_TIPOS,
} from './buscaRapida.js';
import { iniciarKanban } from './kanban.js';
import { lerArvoreDeFavoritos } from './leitorDeFavoritos.js';
import { separarTipoDoNome } from './tipoDeBaseNoNome.js';

const CAMINHO_DA_API = '/api/clientes';
const CAMINHO_DA_CONFIGURACAO = '/api/configuracao';
const CAMINHO_DA_SITUACAO_GIT = '/api/situacao-git';
const CAMINHO_DOS_ATALHOS = '/api/atalhos';
const CAMINHO_DO_SISTEMA = '/api/sistema';
const CAMINHO_DAS_BASES_LOCAIS = '/api/local/bases';
const CAMINHO_DOS_BANCOS_LOCAIS = '/api/local/bancos';
const CAMINHO_DAS_NOTIFICACOES = '/api/notificacoes';
const CAMINHO_DOS_LEMBRETES = '/api/lembretes';
const CAMINHO_DOS_CONTATOS = '/api/contatos';
const CAMINHO_DO_AUTOSYNC = '/api/autosync';
/* O WhatsApp Web abre a conversa pelo número completo, com o código do país. */
const ENDERECO_DE_CONVERSA_DO_WHATSAPP = 'https://web.whatsapp.com/send';
const CODIGO_DO_BRASIL = '55';
/* DDD e número, fixo ou celular: o que o cadastro costuma ter, sem o código do país. */
const DIGITOS_DO_TELEFONE_NACIONAL = new Set([10, 11]);
const MENOR_TELEFONE_COM_DDD = 10;
/* Tela de e-mail novo do Gmail, que no desktop abre no painel de comunicação. */
const ENDERECO_DE_EMAIL_NOVO_DO_GMAIL = 'https://mail.google.com/mail/?view=cm&fs=1';
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
const PORTAS_PADRAO_POR_SGBD = { oracle: 1521, sqlserver: 1433 };
const ROTULOS_DE_SGBD = { oracle: 'Oracle', sqlserver: 'SQL Server' };
const ROTULOS_DE_IDENTIFICADOR_ORACLE = { 'service-name': 'Service Name', sid: 'SID' };
const ROTULO_DO_DATABASE = 'Database';
/* O id fixo é o que permite reencontrar o campo depois de o detalhe ser redesenhado. */
const ID_DO_CAMPO_DE_ANOTACOES = 'campo-anotacoes';
const LINHAS_DO_CAMPO_DE_ANOTACOES = 5;
/* Mesmo limite validado no servidor. */
const TAMANHO_MAXIMO_DAS_ANOTACOES = 5000;
/* O mesmo limite de `src/rotas/rotasClientes.ts`: cobrado aqui antes de gravar qualquer coisa. */
const MAXIMO_DE_NOMES_COMPLETOS = 20;

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
  /* Chevron para baixo: alterna entre exibir e ocultar o corpo de um card. */
  chevronBaixo: 'M6 9l6 6 6-6',
  mais: 'M12 5v14 M5 12h14',
  pasta: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  terminal: 'M4 17l6-6-6-6 M12 19h8',
  /* Chaves de bloco de código: o botão que abre o projeto na IDE. */
  ide: 'M10 4h-.5a2 2 0 0 0-2 2v3.2a2 2 0 0 1-2 2 2 2 0 0 1 2 2V17a2 2 0 0 0 2 2h.5 M14 4h.5a2 2 0 0 1 2 2v3.2a2 2 0 0 0 2 2 2 2 0 0 0-2 2V17a2 2 0 0 1-2 2H14',
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
  /* Cadeado: o botão que abre as credenciais do Sankhya. */
  cadeado: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
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
  /* Elos de corrente: o botão que vincula o parceiro do evento a um cliente do HUB. */
  link: 'M15 7h3a5 5 0 0 1 0 10h-3 M9 17H6a5 5 0 0 1 0-10h3 M8 12h8',
  /* Círculo com "i": o botão que explica o que é o Git AutoSync. */
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  /* Sino: o botão que abre o painel de notificações. */
  sino: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  /* Lupa: o botão que abre a busca rápida. */
  lupa: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.35-4.35',
  /* Mesmo desenho do botão do WhatsApp na barra lateral do aplicativo. */
  conversa:
    'M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.3z M9.2 8.6c0 3.4 2.8 6.2 6.2 6.2l1.2-1.4-2-1-1 .8a4.6 4.6 0 0 1-2.8-2.8l.8-1-1-2z',
  /* Mesmo desenho do botão do Gmail na barra lateral do aplicativo. */
  envelope:
    'M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z M3.5 6.5 12 13l8.5-6.5',
};

const estado = {
  clientes: [],
  idSelecionado: null,
  /** Aba ativa no detalhe do cliente; reiniciada em 'geral' ao trocar de cliente. */
  abaDetalheAtiva: 'geral',
  filtro: '',
  /*
   * Situações do Git marcadas nos chips da coluna lateral. Vazio significa
   * "todas": é o mesmo resultado de marcar as cinco, com um clique só.
   */
  situacoesFiltradas: new Set(),
  /* Funcionalidades desmarcadas em Configurações › Acessos: só somem da tela. */
  funcionalidadesOcultas: new Set(),
  /* Perfil em vigor na tela; `null` enquanto a configuração não foi lida. */
  perfil: null,
  /* Acesso de terceiro: sem SankhyaOm nem Experience, o que depende deles some. */
  terceiro: false,
  clienteEmEdicao: null,
  clienteDaBaseEmEdicao: null,
  baseEmEdicao: null,
  clienteDoRepositorioEmEdicao: null,
  repositorioEmEdicao: null,
  clienteDoLinkEmEdicao: null,
  linkEmEdicao: null,
  /** Projeto dono do link em edição no modal de link; `null` quando o link é do cliente. */
  projetoDoLinkEmEdicao: null,
  clienteDoProjetoEmEdicao: null,
  projetoEmEdicao: null,
  clienteDoBancoEmEdicao: null,
  baseDoBancoEmEdicao: null,
  /* Alvo do modal do MCP: repositório de cliente ou base local. */
  alvoDoMcp: null,
  /* 'clientes' ou 'local': qual das duas telas está visível. */
  /* O painel abre no Resumo do dia. */
  visualizacao: 'resumo',
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
  /** Mesma ideia de `anotacoesEmEdicao`, mas para anotações de projeto: `{ idDoCliente, idDoProjeto, texto }`. */
  anotacoesDoProjetoEmEdicao: null,
  senhasReveladas: new Set(),
  /* Situação Git por id de repositório, preenchida depois do primeiro desenho. */
  situacoesGit: {},
  pendenciasExpandidas: new Set(),
  /** Ids de projeto com o corpo do card exibido; ausente aqui = recolhido (estado inicial). */
  projetosComInformacoesVisiveis: new Set(),
  /* Situação (container + banco) por id de banco local, preenchida depois do primeiro desenho. */
  situacoesDeBancosLocais: {},
  /* Situação (serviço + HTTP) por id de base local, preenchida depois do primeiro desenho. */
  situacoesDeBasesLocais: {},
  /* Situação (HTTP na URL cadastrada) por id de base de cliente. */
  situacoesDeBasesDeClientes: {},
  /* Atalhos da barra da direita, relidos a cada gravação da configuração. */
  atalhos: [],
  /* Com IDE configurada, Enter num repositório da busca rápida abre a IDE; sem ela, a pasta. */
  ideConfigurada: false,
  /*
   * Busca rápida. `itens` é o índice montado ao abrir, `resultados` o que casa
   * com o texto digitado e `indiceSelecionado` a linha destacada nos resultados.
   */
  buscaRapida: { itens: [], resultados: [], indiceSelecionado: 0 },
  /* Painel de notificações: a lista vem do servidor e cresce pelo fluxo SSE. */
  notificacoes: [],
  lembretes: [],
  /* Lembrete aberto no modal; `null` quando é um novo. */
  lembreteEmEdicao: null,
  /* Ids dos contatos em cópia no lembrete aberto no modal. */
  contatosDoLembrete: [],
  contatos: [],
  /* Contato aberto no modal; `null` quando é um novo. */
  contatoEmEdicao: null,
  /* Cliente de quem o modal foi aberto, pela aba Contatos do cliente; `null` fora dela. */
  clienteFixoDoContato: null,
  /* Contato novo aberto pelo lembrete: nasce com e-mail e já entra na cópia ao salvar. */
  contatoParaOLembrete: false,
  /* Filtros da aba Contatos do menu principal. */
  filtroDeContatos: { nome: '', clienteId: '' },
  /*
   * Git AutoSync. `visao` e `clientes` vêm do servidor; `emAndamento` e
   * `errosPorCaminho` são indexados pela chave normalizada do caminho e guardam a
   * ação que está rodando e o último erro do CLI de cada repositório.
   */
  autosync: {
    visao: null,
    clientes: null,
    erroDeCarga: null,
    erroGeral: null,
    atualizadoEm: null,
    emAndamento: new Map(),
    errosPorCaminho: new Map(),
    /* Horários editados nos chips e ainda não salvos; `null` mostra os gravados. */
    horariosEmEdicao: null,
    alvoDoCommit: null,
    alvoDoMr: null,
    alvoDaPolitica: null,
    confirmacaoPendente: null,
    /* Redesenho da seção AutoSync do cliente aberto, quando montada. */
    redesenharDoCliente: null,
  },
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

  botaoVisualizacaoResumo: document.getElementById('btn-visualizacao-resumo'),
  visualizacaoResumo: document.getElementById('visualizacao-resumo'),
  mountResumo: document.getElementById('mount-resumo'),
  dataDoResumo: document.getElementById('data-do-resumo'),
  botaoVisualizacaoClientes: document.getElementById('btn-visualizacao-clientes'),
  botaoVisualizacaoLocal: document.getElementById('btn-visualizacao-local'),
  botaoVisualizacaoAgenda: document.getElementById('btn-visualizacao-agenda'),
  botaoVisualizacaoOs: document.getElementById('btn-visualizacao-os'),
  visualizacaoClientes: document.getElementById('visualizacao-clientes'),
  visualizacaoLocal: document.getElementById('visualizacao-local'),
  visualizacaoAgenda: document.getElementById('visualizacao-agenda'),
  visualizacaoOs: document.getElementById('visualizacao-os'),
  mountLembretes: document.getElementById('mount-lembretes'),
  botaoVisualizacaoContatos: document.getElementById('btn-visualizacao-contatos'),
  visualizacaoContatos: document.getElementById('visualizacao-contatos'),
  mountContatos: document.getElementById('mount-contatos'),
  botaoVisualizacaoLembretes: document.getElementById('btn-visualizacao-lembretes'),
  visualizacaoLembretes: document.getElementById('visualizacao-lembretes'),
  botaoVisualizacaoAutosync: document.getElementById('btn-visualizacao-autosync'),
  visualizacaoAutosync: document.getElementById('visualizacao-autosync'),
  mountAutosync: document.getElementById('mount-autosync'),
  ultimaAtualizacaoAutosync: document.getElementById('ultima-atualizacao-autosync'),
  botaoAtualizarAutosync: document.getElementById('btn-atualizar-autosync'),
  botaoInstalarAutosync: document.getElementById('btn-instalar-autosync'),
  botaoSobreAutosync: document.getElementById('btn-sobre-autosync'),
  botaoConfiguracaoAutosync: document.getElementById('btn-configuracao-autosync'),
  modalConfiguracaoAutosync: document.getElementById('modal-autosync-configuracao'),
  formularioConfiguracaoAutosync: document.getElementById('formulario-autosync-configuracao'),
  erroConfiguracaoAutosync: document.getElementById('erro-autosync-configuracao'),
  botaoSalvarConfiguracaoAutosync: document.getElementById('btn-salvar-autosync-configuracao'),
  botaoCancelarConfiguracaoAutosync: document.getElementById('btn-cancelar-autosync-configuracao'),
  modalSobreAutosync: document.getElementById('modal-autosync-sobre'),
  botaoFecharSobreAutosync: document.getElementById('btn-fechar-autosync-sobre'),
  modalSemGitAutosync: document.getElementById('modal-autosync-sem-git'),
  erroSemGitAutosync: document.getElementById('erro-autosync-sem-git'),
  botaoFecharSemGitAutosync: document.getElementById('btn-fechar-autosync-sem-git'),
  botaoVerificarGitAutosync: document.getElementById('btn-verificar-git-autosync'),
  modalCommitAutosync: document.getElementById('modal-autosync-commit'),
  formularioCommitAutosync: document.getElementById('formulario-autosync-commit'),
  tituloModalCommitAutosync: document.getElementById('modal-autosync-commit-titulo'),
  subtituloModalCommitAutosync: document.getElementById('modal-autosync-commit-subtitulo'),
  campoMensagemAutosync: document.getElementById('campo-autosync-mensagem'),
  botaoPreviaAutosync: document.getElementById('btn-autosync-previa'),
  erroCommitAutosync: document.getElementById('erro-autosync-commit'),
  botaoCancelarCommitAutosync: document.getElementById('btn-cancelar-autosync-commit'),
  botaoConfirmarCommitAutosync: document.getElementById('btn-confirmar-autosync-commit'),
  modalMrAutosync: document.getElementById('modal-autosync-mr'),
  formularioMrAutosync: document.getElementById('formulario-autosync-mr'),
  subtituloModalMrAutosync: document.getElementById('modal-autosync-mr-subtitulo'),
  campoTituloMrAutosync: document.getElementById('campo-autosync-mr-titulo'),
  campoDestinoMrAutosync: document.getElementById('campo-autosync-mr-destino'),
  campoOrigemMrAutosync: document.getElementById('campo-autosync-mr-origem'),
  erroMrAutosync: document.getElementById('erro-autosync-mr'),
  botaoCancelarMrAutosync: document.getElementById('btn-cancelar-autosync-mr'),
  modalPoliticaAutosync: document.getElementById('modal-autosync-politica'),
  formularioPoliticaAutosync: document.getElementById('formulario-autosync-politica'),
  subtituloModalPoliticaAutosync: document.getElementById('modal-autosync-politica-subtitulo'),
  campoIncludeAutosync: document.getElementById('campo-autosync-include'),
  campoExcludeAutosync: document.getElementById('campo-autosync-exclude'),
  campoRamosAutosync: document.getElementById('campo-autosync-ramos'),
  campoMaxBytesAutosync: document.getElementById('campo-autosync-max-bytes'),
  campoIaRepositorioAutosync: document.getElementById('campo-autosync-ia-repositorio'),
  erroPoliticaAutosync: document.getElementById('erro-autosync-politica'),
  botaoCancelarPoliticaAutosync: document.getElementById('btn-cancelar-autosync-politica'),
  botaoSalvarPoliticaAutosync: document.getElementById('btn-salvar-autosync-politica'),
  modalHistoricoAutosync: document.getElementById('modal-autosync-historico'),
  subtituloModalHistoricoAutosync: document.getElementById('modal-autosync-historico-subtitulo'),
  mountHistoricoAutosync: document.getElementById('mount-autosync-historico'),
  botaoFecharHistoricoAutosync: document.getElementById('btn-fechar-autosync-historico'),
  modalInstalacaoAutosync: document.getElementById('modal-autosync-instalacao'),
  formularioInstalacaoAutosync: document.getElementById('formulario-autosync-instalacao'),
  campoHorarioInstalacaoAutosync: document.getElementById('campo-autosync-horario-instalacao'),
  campoBandejaInstalacaoAutosync: document.getElementById('campo-autosync-bandeja-instalacao'),
  campoAtalhosInstalacaoAutosync: document.getElementById('campo-autosync-atalhos-instalacao'),
  campoSkillsInstalacaoAutosync: document.getElementById('campo-autosync-skills-instalacao'),
  campoPathInstalacaoAutosync: document.getElementById('campo-autosync-path-instalacao'),
  erroInstalacaoAutosync: document.getElementById('erro-autosync-instalacao'),
  botaoCancelarInstalacaoAutosync: document.getElementById('btn-cancelar-autosync-instalacao'),
  botaoConfirmarInstalacaoAutosync: document.getElementById('btn-confirmar-autosync-instalacao'),
  modalConfirmacaoAutosync: document.getElementById('modal-autosync-confirmacao'),
  tituloConfirmacaoAutosync: document.getElementById('titulo-autosync-confirmacao'),
  textoConfirmacaoAutosync: document.getElementById('texto-autosync-confirmacao'),
  botaoCancelarConfirmacaoAutosync: document.getElementById('btn-cancelar-autosync-confirmacao'),
  botaoConfirmarConfirmacaoAutosync: document.getElementById('btn-confirmar-autosync-confirmacao'),
  campoFiltroNomeContato: document.getElementById('campo-filtro-nome-contato'),
  campoFiltroClienteContato: document.getElementById('campo-filtro-cliente-contato'),
  modalContato: document.getElementById('modal-contato'),
  formularioContato: document.getElementById('formulario-contato'),
  tituloModalContato: document.getElementById('modal-contato-titulo'),
  campoNomeContato: document.getElementById('campo-nome-contato'),
  campoCargoContato: document.getElementById('campo-cargo-contato'),
  campoTelefoneContato: document.getElementById('campo-telefone-contato'),
  campoEmailContato: document.getElementById('campo-email-contato'),
  opcionalEmailContato: document.getElementById('opcional-email-contato'),
  grupoClienteContato: document.getElementById('grupo-cliente-contato'),
  campoClienteContato: document.getElementById('campo-cliente-contato'),
  erroContato: document.getElementById('erro-contato'),
  botaoSalvarContato: document.getElementById('btn-salvar-contato'),
  botaoCancelarContato: document.getElementById('btn-cancelar-contato'),

  botaoBuscaRapida: document.getElementById('btn-busca-rapida'),
  modalBuscaRapida: document.getElementById('modal-busca-rapida'),
  campoBuscaRapida: document.getElementById('campo-busca-rapida'),
  listaBuscaRapida: document.getElementById('lista-busca-rapida'),

  botaoNotificacoes: document.getElementById('btn-notificacoes'),
  contadorNotificacoes: document.getElementById('contador-notificacoes'),
  painelNotificacoes: document.getElementById('painel-notificacoes'),
  listaNotificacoes: document.getElementById('lista-notificacoes'),
  botaoMarcarNotificacoesLidas: document.getElementById('btn-marcar-notificacoes-lidas'),
  botaoLimparNotificacoes: document.getElementById('btn-limpar-notificacoes'),
  botaoFecharNotificacoes: document.getElementById('btn-fechar-notificacoes'),

  modalLembrete: document.getElementById('modal-lembrete'),
  formularioLembrete: document.getElementById('formulario-lembrete'),
  tituloModalLembrete: document.getElementById('modal-lembrete-titulo'),
  campoResumoLembrete: document.getElementById('campo-resumo-lembrete'),
  campoTextoLembrete: document.getElementById('campo-texto-lembrete'),
  opcoesTipoLembrete: document.querySelectorAll('input[name="tipo-lembrete"]'),
  grupoDataHoraLembrete: document.getElementById('grupo-data-hora-lembrete'),
  campoDataHoraLembrete: document.getElementById('campo-data-hora-lembrete'),
  grupoRecorrenciaLembrete: document.getElementById('grupo-recorrencia-lembrete'),
  campoModeloRecorrencia: document.getElementById('campo-modelo-recorrencia'),
  campoExpressaoCron: document.getElementById('campo-expressao-cron'),
  previaCron: document.getElementById('previa-cron'),
  campoClienteLembrete: document.getElementById('campo-cliente-lembrete'),
  campoProjetoLembrete: document.getElementById('campo-projeto-lembrete'),
  campoEmailLembrete: document.getElementById('campo-email-lembrete'),
  avisoSmtpLembrete: document.getElementById('aviso-smtp-lembrete'),
  campoAtivoLembrete: document.getElementById('campo-ativo-lembrete'),
  grupoContatosLembrete: document.getElementById('grupo-contatos-lembrete'),
  listaContatosLembrete: document.getElementById('lista-contatos-lembrete'),
  botaoAdicionarContatoLembrete: document.getElementById('btn-adicionar-contato-lembrete'),
  opcoesContatosLembrete: document.getElementById('opcoes-contatos-lembrete'),
  erroLembrete: document.getElementById('erro-lembrete'),
  botaoSalvarLembrete: document.getElementById('btn-salvar-lembrete'),
  botaoCancelarLembrete: document.getElementById('btn-cancelar-lembrete'),
  avisoShellAgenda: document.getElementById('aviso-shell-agenda'),
  botaoAtualizarAgenda: document.getElementById('btn-atualizar-agenda'),
  ultimaAtualizacaoAgenda: document.getElementById('ultima-atualizacao-agenda'),
  botaoLancarOcorrencia: document.getElementById('btn-lancar-ocorrencia'),
  modalOcorrencia: document.getElementById('modal-ocorrencia'),
  formularioOcorrencia: document.getElementById('formulario-ocorrencia'),
  usuarioOcorrencia: document.getElementById('usuario-ocorrencia'),
  campoInicioOcorrencia: document.getElementById('campo-inicio-ocorrencia'),
  campoFimOcorrencia: document.getElementById('campo-fim-ocorrencia'),
  campoMotivoOcorrencia: document.getElementById('campo-motivo-ocorrencia'),
  erroOcorrencia: document.getElementById('erro-ocorrencia'),
  botaoCancelarOcorrencia: document.getElementById('btn-cancelar-ocorrencia'),
  botaoSalvarOcorrencia: document.getElementById('btn-salvar-ocorrencia'),
  mountAgendaGeral: document.getElementById('mount-agenda-geral'),
  avisoShellOs: document.getElementById('aviso-shell-os'),
  botaoAtualizarOs: document.getElementById('btn-atualizar-os'),
  ultimaAtualizacaoOs: document.getElementById('ultima-atualizacao-os'),
  mountOsGeral: document.getElementById('mount-os-geral'),
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

  botaoCredenciaisSankhya: document.getElementById('btn-credenciais-sankhya'),
  modalCredenciaisSankhya: document.getElementById('modal-credenciais-sankhya'),
  avisoShellSankhya: document.getElementById('aviso-shell-sankhya'),
  botaoFecharCredenciaisSankhya: document.getElementById('btn-fechar-credenciais-sankhya'),

  modalConfiguracao: document.getElementById('modal-configuracao'),
  formularioConfiguracao: document.getElementById('formulario-configuracao'),
  abaConfiguracaoGeral: document.getElementById('aba-configuracao-geral'),
  abaConfiguracaoMcp: document.getElementById('aba-configuracao-mcp'),
  abaConfiguracaoAtalhos: document.getElementById('aba-configuracao-atalhos'),
  abaConfiguracaoSmtp: document.getElementById('aba-configuracao-smtp'),
  abaConfiguracaoAvisos: document.getElementById('aba-configuracao-avisos'),
  abaConfiguracaoAcessos: document.getElementById('aba-configuracao-acessos'),
  abaConfiguracaoIa: document.getElementById('aba-configuracao-ia'),
  painelConfiguracaoIa: document.getElementById('painel-configuracao-ia'),
  campoAssistenteIa: document.getElementById('campo-assistente-ia'),
  campoModeloIa: document.getElementById('campo-modelo-ia'),
  campoModeloIaOutro: document.getElementById('campo-modelo-ia-outro'),
  blocoModeloIaOutro: document.getElementById('bloco-modelo-ia-outro'),
  campoRaciocinioIa: document.getElementById('campo-raciocinio-ia'),
  blocoRaciocinioIa: document.getElementById('bloco-raciocinio-ia'),
  situacaoAssistenteIa: document.getElementById('situacao-assistente-ia'),
  botaoAtualizarAssistentesIa: document.getElementById('btn-atualizar-assistentes-ia'),
  campoGitlabHost: document.getElementById('campo-gitlab-host'),
  campoGitlabToken: document.getElementById('campo-gitlab-token'),
  botaoVerTokenGitlab: document.getElementById('btn-ver-token-gitlab'),
  situacaoTokenGitlab: document.getElementById('situacao-token-gitlab'),
  botaoRemoverTokenGitlab: document.getElementById('btn-remover-token-gitlab'),
  abaConfiguracaoSobre: document.getElementById('aba-configuracao-sobre'),
  painelConfiguracaoGeral: document.getElementById('painel-configuracao-geral'),
  painelConfiguracaoMcp: document.getElementById('painel-configuracao-mcp'),
  painelConfiguracaoAtalhos: document.getElementById('painel-configuracao-atalhos'),
  painelConfiguracaoSmtp: document.getElementById('painel-configuracao-smtp'),
  painelConfiguracaoAvisos: document.getElementById('painel-configuracao-avisos'),
  painelConfiguracaoAcessos: document.getElementById('painel-configuracao-acessos'),
  campoSmtpHost: document.getElementById('campo-smtp-host'),
  campoSmtpPorta: document.getElementById('campo-smtp-porta'),
  campoSmtpSeguranca: document.getElementById('campo-smtp-seguranca'),
  campoSmtpUsuario: document.getElementById('campo-smtp-usuario'),
  campoSmtpSenha: document.getElementById('campo-smtp-senha'),
  botaoVerSenhaSmtp: document.getElementById('btn-ver-senha-smtp'),
  campoSmtpRemetente: document.getElementById('campo-smtp-remetente'),
  campoSmtpDestinatario: document.getElementById('campo-smtp-destinatario'),
  botaoTestarSmtp: document.getElementById('btn-testar-smtp'),
  resultadoTesteSmtp: document.getElementById('resultado-teste-smtp'),
  campoAlertaAgendaAtivo: document.getElementById('campo-alerta-agenda-ativo'),
  campoAlertaAgendaIntervalo: document.getElementById('campo-alerta-agenda-intervalo'),
  campoAlertaAgendaProximoDiaUtil: document.getElementById('campo-alerta-agenda-proximo-dia-util'),
  campoAlertaAgendaRepetir: document.getElementById('campo-alerta-agenda-repetir'),
  campoAlertaAgendaEmail: document.getElementById('campo-alerta-agenda-email'),
  painelConfiguracaoSobre: document.getElementById('painel-configuracao-sobre'),
  campoPerfil: document.getElementById('campo-perfil'),
  campoTerceiro: document.getElementById('campo-terceiro'),
  grupoAlertaAgenda: document.getElementById('grupo-alerta-agenda'),
  campoNomesCompletosCliente: document.getElementById('campo-nomes-completos'),
  caixasDeFuncionalidade: document.querySelectorAll(
    '#painel-configuracao-acessos [data-funcionalidade]',
  ),
  listaDeAtalhosDaConfiguracao: document.getElementById('lista-atalhos-config'),
  botaoAdicionarAtalho: document.getElementById('btn-adicionar-atalho'),
  campoScriptPadrao: document.getElementById('campo-script-padrao'),
  campoIntervaloDeExecucaoAutomatica: document.getElementById(
    'campo-intervalo-execucao-automatica',
  ),
  campoTempoLimite: document.getElementById('campo-tempo-limite'),
  campoDestinoDosLinks: document.getElementById('campo-destino-dos-links'),
  campoConfigSankhyaOmCodUsu: document.getElementById('campo-sankhya-om-codusu'),
  botaoSalvarCodusu: document.getElementById('btn-salvar-codusu'),
  erroCodusu: document.getElementById('erro-codusu'),
  campoCaminhoExecutavelDaIde: document.getElementById('campo-caminho-executavel-ide'),
  campoNomeDoUsuario: document.getElementById('campo-nome-do-usuario'),
  campoEmpresaDoUsuario: document.getElementById('campo-empresa-do-usuario'),
  campoTimeDoUsuario: document.getElementById('campo-time-do-usuario'),
  campoEmailDoUsuario: document.getElementById('campo-email-do-usuario'),
  botaoSelecionarExecutavelDaIde: document.getElementById('btn-selecionar-executavel-ide'),
  campoCaminhoSchemaMcp: document.getElementById('campo-caminho-schema-mcp'),
  campoConfigMcpHost: document.getElementById('campo-config-mcp-host'),
  campoConfigMcpPorta: document.getElementById('campo-config-mcp-port'),
  campoConfigMcpServico: document.getElementById('campo-config-mcp-service'),
  campoConfigMcpUsuario: document.getElementById('campo-config-mcp-user'),
  campoConfigMcpSenha: document.getElementById('campo-config-mcp-password'),
  botaoVerSenhaConfigMcp: document.getElementById('btn-ver-senha-config-mcp'),
  botaoImportarEnvMcp: document.getElementById('btn-importar-env-mcp'),
  grupoSankhyaSchema: document.getElementById('grupo-sankhya-schema'),
  grupoKanbanMcp: document.getElementById('grupo-kanban-mcp'),
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
  listaNomesCompletosCliente: document.getElementById('lista-nomes-completos'),
  botaoAdicionarNomeCompleto: document.getElementById('btn-adicionar-nome-completo'),
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
  campoSgbd: document.getElementById('campo-sgbd'),
  grupoIdentificadorOracle: document.getElementById('grupo-identificador-oracle'),
  campoIdentificadorOracle: document.getElementById('campo-identificador-oracle'),
  campoHost: document.getElementById('campo-host'),
  campoPorta: document.getElementById('campo-porta'),
  rotuloCampoServico: document.getElementById('rotulo-campo-servico'),
  campoServico: document.getElementById('campo-servico'),
  campoUsuarioBanco: document.getElementById('campo-usuario-banco'),
  campoSenhaBanco: document.getElementById('campo-senha-banco'),
  botaoVerSenhaBanco: document.getElementById('btn-ver-senha-banco'),
  botoesDeCopiarDoBanco: document.querySelectorAll('#formulario-banco [data-copiar-campo]'),
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

  modalProjeto: document.getElementById('modal-projeto'),
  formularioProjeto: document.getElementById('formulario-projeto'),
  modalProjetoTitulo: document.getElementById('modal-projeto-titulo'),
  modalProjetoSubtitulo: document.getElementById('modal-projeto-subtitulo'),
  campoNomeProjeto: document.getElementById('campo-nome-projeto'),
  erroProjeto: document.getElementById('erro-projeto'),
  botaoSalvarProjeto: document.getElementById('btn-salvar-projeto'),
  botaoCancelarProjeto: document.getElementById('btn-cancelar-projeto'),

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
    const erro = new Error(conteudo?.mensagem ?? `Falha na requisição (HTTP ${resposta.status}).`);
    // Repassado pra quem chama decidir, ex.: mostrar "app desktop fora do ar" em vez do erro genérico.
    erro.shellIndisponivel = Boolean(conteudo?.shellIndisponivel);
    // O Git AutoSync manda junto o que fazer quando o commit ou o push falha.
    erro.sugestoes = Array.isArray(conteudo?.sugestoes) ? conteudo.sugestoes : [];
    // Chave de DESTINOS_DE_CONFIGURACAO_PENDENTE: o erro ganha o link para a configuração.
    erro.configuracaoPendente = conteudo?.configuracaoPendente ?? null;
    // A instalação do Git AutoSync recusa sem o Git: a tela manda baixá-lo.
    erro.gitAusente = Boolean(conteudo?.gitAusente);
    throw erro;
  }

  return conteudo;
}

const api = {
  shellSankhya: () => requisitar('/api/sankhya/shell'),
  credenciaisSankhya: () => requisitar('/api/sankhya/credenciais'),
  salvarCredencialSankhya: (sistema, usuario, senha) =>
    requisitar(`/api/sankhya/credenciais/${sistema}`, {
      metodo: 'POST',
      corpo: { usuario, senha },
    }),
  senhaCredencialSankhya: (sistema) => requisitar(`/api/sankhya/credenciais/${sistema}/senha`),
  removerCredencialSankhya: (sistema) =>
    requisitar(`/api/sankhya/credenciais/${sistema}`, { metodo: 'DELETE' }),
  abrirNavegadorSankhya: (sistema) =>
    requisitar(`/api/sankhya/navegador/abrir/${sistema}`, { metodo: 'POST' }),
  capturarSessaoSankhya: (sistema) =>
    requisitar(`/api/sankhya/navegador/capturar/${sistema}`, { metodo: 'POST' }),
  autoLoginSankhya: (sistema) =>
    requisitar(`/api/sankhya/navegador/autologin/${sistema}`, { metodo: 'POST' }),
  estadoAgenda: () => requisitar('/api/agenda/estado'),
  salvarNomesCompletos: (id, nomesCompletos) =>
    requisitar(`${CAMINHO_DA_API}/${id}/nomes-completos`, {
      metodo: 'PUT',
      corpo: { nomesCompletos },
    }),
  consultarAgenda: (de, ate) =>
    requisitar('/api/agenda/consultar', { metodo: 'POST', corpo: { de, ate } }),
  motivosDeOcorrencia: () => requisitar('/api/agenda/ocorrencias/motivos'),
  usuarioDaOcorrencia: () => requisitar('/api/agenda/ocorrencias/usuario'),
  lancarOcorrencia: (dados) =>
    requisitar('/api/agenda/ocorrencias', { metodo: 'POST', corpo: dados }),
  eventosDaAgenda: (de, ate) =>
    requisitar(`/api/agenda/eventos?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`),
  eventosDoClienteNaAgenda: (id, de, ate) =>
    requisitar(
      `${CAMINHO_DA_API}/${id}/agenda-eventos?de=${encodeURIComponent(de)}&ate=${encodeURIComponent(ate)}`,
    ),
  situacaoDoDiaNoExperience: (codparc, dia) =>
    requisitar(
      `/api/agenda/situacao-do-dia?codparc=${encodeURIComponent(codparc)}&dia=${encodeURIComponent(dia)}`,
    ),
  consultarOsGeral: (de, ate) =>
    requisitar('/api/os/consultar', { metodo: 'POST', corpo: { de, ate } }),
  consultarOsDoCliente: (id, de, ate) =>
    requisitar(`${CAMINHO_DA_API}/${id}/os-consultar`, { metodo: 'POST', corpo: { de, ate } }),

  salvarSankhyaOmCodUsu: (sankhyaOmCodUsu) =>
    requisitar(`${CAMINHO_DA_CONFIGURACAO}/sankhya-om-codusu`, {
      metodo: 'PUT',
      corpo: { sankhyaOmCodUsu },
    }),
  listarNotificacoes: () => requisitar(CAMINHO_DAS_NOTIFICACOES),
  marcarNotificacoesComoLidas: (ids) =>
    requisitar(`${CAMINHO_DAS_NOTIFICACOES}/lidas`, { metodo: 'POST', corpo: { ids } }),
  limparNotificacoes: () => requisitar(CAMINHO_DAS_NOTIFICACOES, { metodo: 'DELETE' }),
  enviarEmailDeTeste: (smtp) =>
    requisitar(`${CAMINHO_DAS_NOTIFICACOES}/email-de-teste`, { metodo: 'POST', corpo: { smtp } }),

  listarLembretes: () => requisitar(CAMINHO_DOS_LEMBRETES),
  criarLembrete: (lembrete) =>
    requisitar(CAMINHO_DOS_LEMBRETES, { metodo: 'POST', corpo: lembrete }),
  atualizarLembrete: (id, lembrete) =>
    requisitar(`${CAMINHO_DOS_LEMBRETES}/${id}`, { metodo: 'PUT', corpo: lembrete }),
  removerLembrete: (id) => requisitar(`${CAMINHO_DOS_LEMBRETES}/${id}`, { metodo: 'DELETE' }),
  previaDoCron: (expressao) =>
    requisitar(`${CAMINHO_DOS_LEMBRETES}/previa?expressao=${encodeURIComponent(expressao)}`),

  listarContatos: () => requisitar(CAMINHO_DOS_CONTATOS),
  criarContato: (contato) => requisitar(CAMINHO_DOS_CONTATOS, { metodo: 'POST', corpo: contato }),
  atualizarContato: (id, contato) =>
    requisitar(`${CAMINHO_DOS_CONTATOS}/${id}`, { metodo: 'PUT', corpo: contato }),
  removerContato: (id) => requisitar(`${CAMINHO_DOS_CONTATOS}/${id}`, { metodo: 'DELETE' }),

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

  adicionarProjeto: (idDoCliente, projeto) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos`, { metodo: 'POST', corpo: projeto }),
  atualizarProjeto: (idDoCliente, idDoProjeto, projeto) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos/${idDoProjeto}`, {
      metodo: 'PUT',
      corpo: projeto,
    }),
  removerProjeto: (idDoCliente, idDoProjeto) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos/${idDoProjeto}`, { metodo: 'DELETE' }),
  salvarAnotacoesDoProjeto: (idDoCliente, idDoProjeto, anotacoes) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos/${idDoProjeto}/anotacoes`, {
      metodo: 'PUT',
      corpo: { anotacoes },
    }),
  adicionarLinkDoProjeto: (idDoCliente, idDoProjeto, link) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos/${idDoProjeto}/links`, {
      metodo: 'POST',
      corpo: link,
    }),
  atualizarLinkDoProjeto: (idDoCliente, idDoProjeto, idDoLink, link) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos/${idDoProjeto}/links/${idDoLink}`, {
      metodo: 'PUT',
      corpo: link,
    }),
  removerLinkDoProjeto: (idDoCliente, idDoProjeto, idDoLink) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/projetos/${idDoProjeto}/links/${idDoLink}`, {
      metodo: 'DELETE',
    }),

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

  abrirIdeDoRepositorio: (idDoCliente, idDoRepositorio) =>
    requisitar(`${CAMINHO_DA_API}/${idDoCliente}/repositorios/${idDoRepositorio}/abrir-ide`, {
      metodo: 'POST',
    }),

  /* `forcar` ignora o cache do servidor: é o que o botão de recarregar usa. */
  lerSituacaoGit: (forcar) =>
    requisitar(forcar ? `${CAMINHO_DA_SITUACAO_GIT}?forcar=true` : CAMINHO_DA_SITUACAO_GIT),

  lerConfiguracao: () => requisitar(CAMINHO_DA_CONFIGURACAO),
  assistentesDeIa: () => requisitar(`${CAMINHO_DA_CONFIGURACAO}/assistentes-de-ia`),
  salvarConfiguracao: (configuracao) =>
    requisitar(CAMINHO_DA_CONFIGURACAO, { metodo: 'PUT', corpo: configuracao }),
  lerConfiguracaoMcpGlobal: () => requisitar(`${CAMINHO_DA_CONFIGURACAO}/mcp`),
  importarEnvDoMcpGlobal: () =>
    requisitar(`${CAMINHO_DA_CONFIGURACAO}/mcp/importar`, { metodo: 'POST' }),
  lerPresetsDosPerfis: () => requisitar(`${CAMINHO_DA_CONFIGURACAO}/perfis`),

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

  visaoDoAutosync: () => requisitar(`${CAMINHO_DO_AUTOSYNC}?clientes=true`),
  repositoriosDosClientesNoAutosync: () => requisitar(`${CAMINHO_DO_AUTOSYNC}/clientes`),
  gitDaMaquina: () => requisitar(`${CAMINHO_DO_AUTOSYNC}/git`),
  instalarAutosync: (opcoes) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/instalar`, { metodo: 'POST', corpo: opcoes }),
  adicionarAoAutosync: (caminho, tipo) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/repositorios`, {
      metodo: 'POST',
      corpo: { caminho, tipo },
    }),
  adicionarRepositoriosDosClientesNoAutosync: () =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/repositorios/lote`, {
      metodo: 'POST',
      corpo: { origem: 'clientes' },
    }),
  tirarDoAutosync: (caminho) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/repositorios`, { metodo: 'DELETE', corpo: { caminho } }),
  definirHorariosDoAutosync: (horarios) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/agendamento`, { metodo: 'PUT', corpo: { horarios } }),
  instalarTarefaDoAutosync: () =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/agendamento/instalar`, { metodo: 'POST' }),
  desinstalarTarefaDoAutosync: () =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/agendamento/desinstalar`, { metodo: 'POST' }),
  definirBandejaDoAutosync: (ligada) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/bandeja`, { metodo: 'PUT', corpo: { ligada } }),
  definirIaDoAutosync: (ligada, agente) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/ia`, { metodo: 'PUT', corpo: { ligada, agente } }),
  definirPoliticaNoAutosync: (dados) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/politica`, { metodo: 'PUT', corpo: dados }),
  previaNoAutosync: (caminho) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/previa?caminho=${encodeURIComponent(caminho)}`),
  commitNoAutosync: (caminho, mensagem) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/commit`, { metodo: 'POST', corpo: { caminho, mensagem } }),
  pushNoAutosync: (caminho) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/push`, { metodo: 'POST', corpo: { caminho } }),
  /* Sem caminho: todos os repositórios ativos (`sync --all`), que não aceita mensagem. */
  sincronizarNoAutosync: (caminho, mensagem) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/sincronizar`, {
      metodo: 'POST',
      corpo: caminho ? { caminho, mensagem } : {},
    }),
  mergeRequestNoAutosync: (caminho, dados) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/merge-request`, {
      metodo: 'POST',
      corpo: { caminho, ...dados },
    }),
  historicoNoAutosync: (caminho) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/historico?caminho=${encodeURIComponent(caminho)}`),
  logDoAutosync: (limite) => requisitar(`${CAMINHO_DO_AUTOSYNC}/log?limite=${limite}`),
  abrirTerminalNoAutosync: (caminho) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/terminal`, { metodo: 'POST', corpo: { caminho } }),
  lerGitlab: () => requisitar(`${CAMINHO_DO_AUTOSYNC}/gitlab`),
  definirGitlab: (host, token) =>
    requisitar(`${CAMINHO_DO_AUTOSYNC}/gitlab`, { metodo: 'PUT', corpo: { host, token } }),
  removerTokenDoGitlab: () => requisitar(`${CAMINHO_DO_AUTOSYNC}/gitlab`, { metodo: 'DELETE' }),
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

/*
 * O modal aberto fica na camada superior (top layer), com o fundo escurecido por cima do
 * resto da página — inclusive dos avisos, que o usuário não via. Como popover, o
 * contêiner também vai para essa camada, e mostrá-lo de novo a cada aviso o põe acima do
 * modal que abriu depois dele.
 */
function trazerAvisosParaFrente() {
  if (elementos.avisos.matches(':popover-open')) {
    elementos.avisos.hidePopover();
  }
  elementos.avisos.showPopover();
}

/** `acao`, quando vem, entra depois da mensagem — ex.: o link para a configuração que falta. */
function exibirAviso(mensagem, tipo = 'sucesso', acao = null) {
  const aviso = criarElemento('div', `aviso ${tipo}`, mensagem);
  if (acao) {
    aviso.append(' ', acao);
  }
  elementos.avisos.append(aviso);
  trazerAvisosParaFrente();
  setTimeout(() => {
    aviso.remove();
    if (!elementos.avisos.hasChildNodes()) {
      elementos.avisos.hidePopover();
    }
  }, DURACAO_DO_AVISO_MS);
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

    const severidade = funcionalidadeVisivel(FUNCIONALIDADE_REPOSITORIOS)
      ? severidadeDoCliente(cliente)
      : null;
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
    exibirAviso(erro.message, 'erro', criarLinkDaConfiguracaoDoErro(erro));
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

  const botaoDeIde = criarBotaoDeIcone(
    'btn tiny',
    ICONES.ide,
    `Abrir IDE em ${repositorio.caminhoLocal}`,
    () =>
      executarAcaoDoSistema(
        () => api.abrirIdeDoRepositorio(cliente.id, repositorio.id),
        botaoDeIde,
      ),
  );

  const situacao = situacaoDoMcp(repositorio);
  const botaoDeMcp = criarBotaoDeIcone(
    situacao.classe ? `btn tiny ${situacao.classe}` : 'btn tiny',
    ICONES.plugue,
    situacao.rotulo,
    () => abrirModalDeMcp(alvoDoMcpDoRepositorio(cliente, repositorio)),
  );

  return [botaoDeArquivos, botaoDeShell, botaoDeIde, botaoDeMcp];
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
  const severidade = funcionalidadeVisivel(FUNCIONALIDADE_REPOSITORIOS)
    ? severidadeGlobalDoGit()
    : null;
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
    criarElemento('p', 'recurso-nome', nomeDeExibicaoDoRepositorio(repositorio)),
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

/**
 * Bloco de "Bases" ou "Repositórios": cabeçalho, botão de adicionar e as linhas.
 * `titulo` nulo omite o `h3`: usado quando o título repetiria o rótulo da aba
 * ativa (Projetos, Bases), redundante logo abaixo dela.
 */
function criarSecaoDeRecursos({ titulo, rotuloDoBotao, aoAdicionar, linhas, mensagemVazia }) {
  const cabecalho = criarElemento('div', 'secao-cabecalho');
  if (titulo) {
    cabecalho.append(criarElemento('h3', null, titulo));
  }
  cabecalho.append(criarBotaoDeIcone('btn tiny primario', ICONES.mais, rotuloDoBotao, aoAdicionar));

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
    titulo: null,
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

/** Nome do link como hiperlink, quando a URL é navegável; texto simples caso contrário. */
function criarNomeDeLink(link) {
  if (!ehEnderecoNavegavel(link.url)) {
    return criarElemento('p', 'recurso-nome', link.nome);
  }

  const nome = criarElemento('a', 'recurso-nome', link.nome);
  nome.href = link.url;
  nome.target = '_blank';
  nome.rel = 'noopener noreferrer';
  return nome;
}

function criarBotaoDeCopiarLink(link) {
  return criarBotaoDeIcone('btn tiny ghost', ICONES.copiar, 'Copiar link', () =>
    copiarParaAreaDeTransferencia(link.url, 'Link copiado.'),
  );
}

function criarLinhaDeLink(cliente, link) {
  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(criarNomeDeLink(link));

  const acoes = criarAcoesDeRecurso({
    antesDeEditar: [criarBotaoDeCopiarLink(link)],
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
    titulo: 'Links gerais',
    rotuloDoBotao: 'Adicionar link',
    aoAdicionar: () => abrirModalDeCadastroDeLink(cliente),
    linhas: cliente.links.map((link) => criarLinhaDeLink(cliente, link)),
    mensagemVazia: 'Nenhum link cadastrado para este cliente.',
  });
}

/* -------------------------------- projetos --------------------------------- */

function criarLinhaDeLinkDeProjeto(cliente, projeto, link) {
  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(criarNomeDeLink(link));

  const acoes = criarAcoesDeRecurso({
    antesDeEditar: [criarBotaoDeCopiarLink(link)],
    rotuloDeEdicao: 'Editar link',
    aoEditar: () => abrirModalDeEdicaoDeLinkDeProjeto(cliente, projeto, link),
    rotuloDeExclusao: 'Excluir link',
    aoExcluir: () => pedirExclusaoDeLinkDeProjeto(cliente, projeto, link),
  });

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, acoes);
  return linha;
}

function criarSecaoDeLinksDoProjeto(cliente, projeto) {
  return criarSecaoDeRecursos({
    titulo: 'Links do projeto',
    rotuloDoBotao: 'Adicionar link',
    aoAdicionar: () => abrirModalDeCadastroDeLinkDeProjeto(cliente, projeto),
    linhas: projeto.links.map((link) => criarLinhaDeLinkDeProjeto(cliente, projeto, link)),
    mensagemVazia: 'Nenhum link cadastrado para este projeto.',
  });
}

/** O rascunho tem precedência sobre o gravado, igual `anotacoesEmExibicao`. */
function anotacoesDoProjetoEmExibicao(projeto) {
  const rascunho = estado.anotacoesDoProjetoEmEdicao;
  return rascunho?.idDoProjeto === projeto.id ? rascunho.texto : (projeto.anotacoes ?? '');
}

function criarCampoDeAnotacoesDoProjeto(cliente, projeto) {
  const campo = criarElemento('textarea', 'campo-anotacoes');
  campo.rows = LINHAS_DO_CAMPO_DE_ANOTACOES;
  campo.maxLength = TAMANHO_MAXIMO_DAS_ANOTACOES;
  campo.placeholder = 'Anotações deste projeto.';
  campo.value = anotacoesDoProjetoEmExibicao(projeto);

  campo.addEventListener('input', () => {
    estado.anotacoesDoProjetoEmEdicao = {
      idDoCliente: cliente.id,
      idDoProjeto: projeto.id,
      texto: campo.value,
    };
  });
  campo.addEventListener('blur', () => salvarAnotacoesDoProjeto(cliente.id, projeto.id));

  return campo;
}

function alternarInformacoesDoProjeto(idDoProjeto) {
  if (estado.projetosComInformacoesVisiveis.has(idDoProjeto)) {
    estado.projetosComInformacoesVisiveis.delete(idDoProjeto);
  } else {
    estado.projetosComInformacoesVisiveis.add(idDoProjeto);
  }

  renderizarDetalhe();
}

function criarCardDeProjeto(cliente, projeto) {
  const visivel = estado.projetosComInformacoesVisiveis.has(projeto.id);

  const botaoAlternar = criarBotaoDeIcone(
    'btn tiny ghost botao-alternar-projeto',
    ICONES.chevronBaixo,
    visivel ? 'Ocultar informações do projeto' : 'Exibir informações do projeto',
    () => alternarInformacoesDoProjeto(projeto.id),
  );
  botaoAlternar.setAttribute('aria-expanded', String(visivel));

  const cabecalho = criarElemento('div', 'card-projeto-cabecalho');
  cabecalho.append(botaoAlternar, criarElemento('h3', 'card-projeto-titulo', projeto.nome));
  cabecalho.append(
    criarAcoesDeRecurso({
      rotuloDeEdicao: 'Editar projeto',
      aoEditar: () => abrirModalDeEdicaoDeProjeto(cliente, projeto),
      rotuloDeExclusao: 'Excluir projeto',
      aoExcluir: () => pedirExclusaoDeProjeto(cliente, projeto),
    }),
  );

  const corpo = criarElemento('div', 'card-projeto-corpo');
  corpo.hidden = !visivel;
  corpo.append(
    criarCampoDeAnotacoesDoProjeto(cliente, projeto),
    criarSecaoDeLinksDoProjeto(cliente, projeto),
    kanban.criarSecaoDoProjeto(cliente, projeto),
  );

  const card = criarElemento('div', 'card card-projeto');
  card.append(cabecalho, corpo);
  return card;
}

/* Os kanbans cujo projeto foi excluído ficam no fim da aba, até serem vinculados a outro. */
function criarSecaoDeProjetos(cliente) {
  const secao = criarSecaoDeRecursos({
    titulo: null,
    rotuloDoBotao: 'Adicionar projeto',
    aoAdicionar: () => abrirModalDeCadastroDeProjeto(cliente),
    linhas: cliente.projetos.map((projeto) => criarCardDeProjeto(cliente, projeto)),
    mensagemVazia: 'Nenhum projeto cadastrado para este cliente.',
  });
  secao.append(kanban.criarSecaoDeOrfaos(cliente));
  return secao;
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
/* ---- calendário mensal: só leitura, sem geração de OS nem envio de e-mail ---- */

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function mesAtualIso() {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function deslocarMes(mes, passo) {
  const [ano, numero] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, numero - 1 + passo, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nomeDoMes(mes) {
  const [ano, numero] = mes.split('-').map(Number);
  const data = new Date(Date.UTC(ano, numero - 1, 1));
  const nome = data.toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return nome.charAt(0).toUpperCase() + nome.slice(1);
}

/** Monta a grade de 42 células (6 semanas): cabeçalho de dias da semana + uma célula por dia. */
function criarGradeDoCalendario(grade, criarCelula) {
  const container = criarElemento('div', 'calendario-sankhya');

  const cabecalhoSemana = criarElemento('div', 'calendario-cabecalho-semana');
  for (const rotulo of DIAS_SEMANA) {
    cabecalhoSemana.append(criarElemento('span', null, rotulo));
  }
  container.append(cabecalhoSemana);

  const dias = criarElemento('div', 'calendario-dias');
  for (const dia of grade) {
    dias.append(criarCelula(dia));
  }
  container.append(dias);

  return container;
}

/**
 * Vínculo do cliente com a Agenda de Recursos do ERP (`codparc`) e a agenda
 * mensal — igual à aba Agenda do topo, só que recortada pra este cliente. A
 * situação de cada evento no Experience (sem tarefa/tarefa aberta/OS
 * lançada) sai sozinha do `codparc`, sem campo nenhum pra preencher à mão.
 */
/**
 * Aba Agenda do cadastro do cliente: eventos recortados pelo(s) `codparc` vinculado(s) —
 * o vínculo em si é editado no cadastro/edição do cliente (modal), não aqui.
 */
function criarSecaoDeAgenda(cliente) {
  const widgetDeAgendaDoCliente = criarWidgetDeAgenda({
    buscarEventos: (de, ate) =>
      api.eventosDoClienteNaAgenda(cliente.id, de, ate).then((resposta) => resposta.eventos),
    aoMudarMes: async () => {
      await widgetDeAgendaDoCliente.carregar();
      void refrescarAgendaDoClienteEmSegundoPlano(widgetDeAgendaDoCliente);
    },
  });

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(widgetDeAgendaDoCliente.elemento);
  // Mostra o snapshot local na hora e, em segundo plano, consulta o mês para preencher o
  // que ainda não foi baixado — a mesma consulta da aba Agenda do topo, que traz a agenda
  // inteira do usuário e da qual este cadastro só exibe a fatia do parceiro vinculado.
  void widgetDeAgendaDoCliente
    .carregar()
    .then(() => refrescarAgendaDoClienteEmSegundoPlano(widgetDeAgendaDoCliente));
  return secao;
}

/** Consulta o mês do widget em segundo plano e recarrega; erro não apaga o cache exibido. */
async function refrescarAgendaDoClienteEmSegundoPlano(widget) {
  const { de, ate } = limitesDoMesCliente(widget.mes);
  try {
    await comCarregamentoNaArea(widget.elemento, async () => {
      await api.consultarAgenda(de, ate);
      await widget.carregar();
    });
  } catch (erro) {
    exibirErroComConfiguracao(widget.elementoErro, erro);
  }
}

/**
 * Aba OS do cadastro do cliente: mesmas OS "minhas" da aba OS do topo, recortadas pelo
 * backend comparando o nome da empresa (Experience) com o nome deste cliente — sem nada
 * pra configurar aqui, só a sessão da Experience capturada em Credenciais Sankhya.
 */
function criarSecaoDeOs(cliente) {
  const widgetDeOsDoCliente = criarWidgetDeOs({
    buscarOs: (de, ate) =>
      api.consultarOsDoCliente(cliente.id, de, ate).then((resposta) => resposta.itens),
  });

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(widgetDeOsDoCliente.elemento);
  void widgetDeOsDoCliente.carregar();
  return secao;
}

function criarSecaoDeAnotacoes(cliente) {
  const cabecalho = criarElemento('div', 'secao-cabecalho');
  cabecalho.append(criarElemento('h3', null, 'Anotações gerais'));

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

/** Grava o rascunho pendente das anotações do projeto, igual `salvarAnotacoes`. */
async function salvarAnotacoesDoProjeto(idDoCliente, idDoProjeto) {
  const rascunho = estado.anotacoesDoProjetoEmEdicao;
  if (!rascunho || rascunho.idDoCliente !== idDoCliente || rascunho.idDoProjeto !== idDoProjeto) {
    return;
  }

  const cliente = estado.clientes.find((candidato) => candidato.id === idDoCliente);
  const projeto = cliente?.projetos.find((candidato) => candidato.id === idDoProjeto);
  const texto = rascunho.texto.trim();
  estado.anotacoesDoProjetoEmEdicao = null;

  if (!projeto || texto === projeto.anotacoes) {
    return;
  }

  try {
    const atualizado = await api.salvarAnotacoesDoProjeto(idDoCliente, idDoProjeto, texto);
    projeto.anotacoes = atualizado.anotacoes;
    projeto.atualizadoEm = atualizado.atualizadoEm;
    exibirAviso('Anotações do projeto salvas.');
  } catch (erro) {
    estado.anotacoesDoProjetoEmEdicao = { idDoCliente, idDoProjeto, texto };
    exibirAviso(`Não foi possível salvar as anotações do projeto: ${erro.message}`, 'erro');
  }
}

/* ------------------------- recursos locais (visão "Local") ---------------- */

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
/* ------------------------- aba Agenda (visão geral) ------------------------ */

/** Primeiro e último dia do mês `YYYY-MM`, em `YYYY-MM-DD`. */
function limitesDoMesCliente(mes) {
  const [ano, numero] = mes.split('-').map(Number);
  const ultimo = new Date(Date.UTC(ano, numero, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ultimo).padStart(2, '0')}` };
}

/** Maior período (em dias) que um evento pode cobrir na grade — trava contra data absurda/malformada. */
const LIMITE_DE_DIAS_DE_UM_EVENTO = 366;

/** A grade de 42 células do mês, cada uma com os eventos que cobrem aquele dia. */
function criarGradeMensalDeEventos(mes, eventos) {
  const [ano, numero] = mes.split('-').map(Number);
  const primeiro = new Date(Date.UTC(ano, numero - 1, 1));
  const inicio = new Date(primeiro);
  inicio.setUTCDate(inicio.getUTCDate() - primeiro.getUTCDay());
  const hoje = dataIsoDeHoje();

  // Evento pode durar vários dias (férias, projeto de semana inteira): entra em
  // TODO dia que ele cobre, não só no dia em que começa — senão o resto do
  // período some da grade.
  const porDia = new Map();
  for (const evento of eventos) {
    const cursor = new Date(`${evento.inicio.slice(0, 10)}T00:00:00Z`);
    const limite = new Date(`${evento.fim.slice(0, 10)}T00:00:00Z`);
    for (let dias = 0; cursor <= limite && dias < LIMITE_DE_DIAS_DE_UM_EVENTO; dias += 1) {
      const dia = cursor.toISOString().slice(0, 10);
      porDia.set(dia, [...(porDia.get(dia) ?? []), evento]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  const grade = [];
  for (let i = 0; i < 42; i += 1) {
    const data = new Date(inicio);
    data.setUTCDate(inicio.getUTCDate() + i);
    const dia = data.toISOString().slice(0, 10);

    grade.push({
      dia,
      numero: data.getUTCDate(),
      doMes: dia.slice(0, 7) === mes,
      hoje: dia === hoje,
      eventos: porDia.get(dia) ?? [],
    });

    if (i % 7 === 6 && dia.slice(0, 7) > mes) break;
  }
  return grade;
}

/** Pela data local, como o `mesAtualIso`: o `toISOString` é UTC e virava o dia depois das 21h. */
function dataIsoDeHoje(deslocamentoEmDias = 0) {
  const data = new Date();
  data.setDate(data.getDate() + deslocamentoEmDias);
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Cache da situação do dia (cliente + data) no Experience — cada consulta
 * dispara automação real no navegador do ERP (lenta, e pede pra tela da
 * Agenda de Recursos estar aberta lá). Sem cache, reabrir o mesmo dia
 * repetiria a mesma consulta à toa.
 */
const cacheSituacaoDoDia = new Map();

/**
 * Consulta (com cache) a situação de um cliente num dia no Experience.
 * `forcar` descarta o valor em cache e consulta de novo — usado no botão de
 * atualizar do card e sempre que o dia selecionado no calendário muda.
 */
function consultarSituacaoDoDia(codparc, dia, forcar = false) {
  const chave = `${codparc}|${dia}`;
  if (forcar) {
    cacheSituacaoDoDia.delete(chave);
  }
  if (!cacheSituacaoDoDia.has(chave)) {
    cacheSituacaoDoDia.set(
      chave,
      api
        .situacaoDoDiaNoExperience(codparc, dia)
        .catch((erro) => ({ falhou: true, mensagem: erro.message })),
    );
  }
  return cacheSituacaoDoDia.get(chave);
}

/**
 * Selo + sub-bloco de situação de um evento no Experience, com botão de
 * atualizar ao lado. Três estados: sem tarefa aberta (vermelho), tarefa
 * aberta (amarelo) e OS já lançada (verde, com o número, horários e
 * "Tarefas Realizadas"). Começa neutro ("verificando…") pra não travar a
 * lista inteira esperando o Experience responder.
 */
function anexarSituacaoDoEvento(linhaHorario, informacoes, codparc, dia, forcarNaAbertura) {
  const selo = criarElemento('span', 'selo-situacao', 'Verificando situação no Experience…');
  const botaoAtualizar = criarBotaoDeIcone(
    'btn tiny ghost',
    ICONES.recarregar,
    'Atualizar situação no Experience',
    () => executarAcaoDoSistema(() => carregar(true), botaoAtualizar),
  );
  linhaHorario.append(selo, botaoAtualizar);

  let subbloco = null;
  let seloStatus = null;

  async function carregar(forcar) {
    selo.className = 'selo-situacao';
    selo.textContent = 'Verificando situação no Experience…';
    selo.title = '';
    if (subbloco) {
      subbloco.remove();
      subbloco = null;
    }
    if (seloStatus) {
      seloStatus.remove();
      seloStatus = null;
    }

    const resultado = await consultarSituacaoDoDia(codparc, dia, forcar);

    if (resultado.falhou) {
      selo.classList.add('erro');
      selo.textContent = 'Não verifiquei a situação no Experience';
      selo.title = resultado.mensagem;
      return;
    }

    const faps = resultado.faps.join(', ');
    const situacao = resultado.situacao;
    if (situacao.tipo === 'os-lancada') {
      selo.classList.add('ok');
      selo.textContent = `OS nº ${situacao.numeroOs}`;
      selo.title = `FAP ${faps}`;
      if (situacao.status) {
        const classeDeCor = atribuirCoresAosStatus([situacao.status]).get(situacao.status);
        seloStatus = criarElemento(
          'span',
          `selo-situacao selo-status-os ${classeDeCor}`,
          situacao.status,
        );
        selo.after(seloStatus);
      }

      const detalhes = [
        situacao.horaInicio && `Início ${situacao.horaInicio}`,
        situacao.horaFim && `Fim ${situacao.horaFim}`,
        situacao.intervalo && `Intervalo ${situacao.intervalo}`,
        situacao.tempoRealizado && `Realizado ${situacao.tempoRealizado}`,
        situacao.pedido && `Pedido ${situacao.pedido}`,
      ]
        .filter(Boolean)
        .join(' · ');
      if (detalhes || situacao.tarefasRealizadas) {
        subbloco = criarElemento('div', 'subbloco-os-lancada');
        if (detalhes) {
          subbloco.append(criarElemento('p', 'texto-auxiliar', detalhes));
        }
        if (situacao.tarefasRealizadas) {
          subbloco.append(
            criarElemento(
              'p',
              'texto-auxiliar texto-tarefas-realizadas',
              situacao.tarefasRealizadas,
            ),
          );
        }
        informacoes.append(subbloco);
      }
    } else if (situacao.tipo === 'tarefa-aberta') {
      selo.classList.add('atencao');
      selo.textContent = 'Tarefa aberta no Experience';
      selo.title = `FAP ${faps}`;
    } else {
      selo.classList.add('erro');
      selo.textContent = 'Sem tarefa aberta no Experience';
      selo.title = resultado.faps.length ? `FAP ${faps}` : 'Cliente sem FAP de implantação.';
    }
  }

  void carregar(forcarNaAbertura);
}

/**
 * Normaliza um nome para comparação frouxa (acento, caixa, sufixo societário) — espelha o
 * `chaveNome` do backend, para o "já vinculado" bater com o mesmo critério do recorte.
 */
function normalizarNomeParaVinculo(nome) {
  return (nome || '')
    .normalize('NFD')
    .toUpperCase()
    .replace(/\b(LTDA|S\.?A|ME|EPP|EIRELI|COMERCIAL|IMPORTADORA|E OUTRO\(S\))\b/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** Cliente do HUB cujo nome (ou algum Nome Completo) corresponde a este nome do Sankhya. */
function clientePorNomeSankhya(nomeSankhya) {
  const alvo = normalizarNomeParaVinculo(nomeSankhya);
  if (!alvo) return null;
  return (
    estado.clientes.find((cliente) =>
      [cliente.nome, ...cliente.nomesCompletos].some((nome) => {
        const chave = normalizarNomeParaVinculo(nome);
        return chave && (chave === alvo || chave.startsWith(alvo) || alvo.startsWith(chave));
      }),
    ) ?? null
  );
}

/** Adiciona o nome do Sankhya aos Nomes Completos de um cliente existente (sem duplicar). */
async function vincularNomeSankhyaAoCliente(nomeSankhya, clienteId) {
  const cliente = estado.clientes.find((c) => c.id === clienteId);
  if (!cliente) return;

  const alvo = normalizarNomeParaVinculo(nomeSankhya);
  const jaTem = cliente.nomesCompletos.some((nome) => normalizarNomeParaVinculo(nome) === alvo);
  if (jaTem) return;

  await api.salvarNomesCompletos(clienteId, [...cliente.nomesCompletos, nomeSankhya]);
  await recarregarClientes();
}

/** Cria um cliente novo já com o nome do Sankhya vinculado nos Nomes Completos. */
async function criarClienteComNomeSankhya(nomeDoCadastro, nomeSankhya) {
  const cliente = await api.criar(nomeDoCadastro);
  await api.salvarNomesCompletos(cliente.id, [nomeSankhya]);
  await recarregarClientes();
}

/**
 * Painel para vincular o parceiro do evento a um cliente do HUB: busca entre os existentes
 * ou cadastra um novo já vinculado (nome pré-preenchido com o do Sankhya).
 */
function criarSeletorDeVinculoDeCliente(nomeSankhya, aoConcluir) {
  const painel = criarElemento('div', 'painel-vinculo');

  const busca = criarElemento('input', 'painel-vinculo-busca');
  busca.type = 'search';
  busca.placeholder = 'Buscar cliente do HUB…';
  busca.setAttribute('aria-label', 'Buscar cliente do HUB');

  const lista = criarElemento('ul', 'painel-vinculo-lista');

  const novo = criarElemento('div', 'painel-vinculo-novo');
  const campoNovo = criarElemento('input', 'painel-vinculo-busca');
  campoNovo.type = 'text';
  campoNovo.value = nomeSankhya;
  campoNovo.placeholder = 'Nome do novo cliente';
  campoNovo.setAttribute('aria-label', 'Nome do novo cliente');
  const botaoNovo = criarBotao('btn tiny', 'Cadastrar e vincular', () => void criarNovo());
  novo.append(campoNovo, botaoNovo);

  painel.append(busca, lista, novo);

  const jaVinculado = clientePorNomeSankhya(nomeSankhya);

  async function escolher(cliente) {
    painel.classList.add('ocupado');
    try {
      await vincularNomeSankhyaAoCliente(nomeSankhya, cliente.id);
      exibirAviso(`"${nomeSankhya}" vinculado a "${cliente.nome}".`);
    } catch (erro) {
      exibirAviso(`Não consegui vincular: ${erro.message}`, 'erro');
    }
    aoConcluir();
  }

  async function criarNovo() {
    const nome = campoNovo.value.trim();
    if (!nome) {
      campoNovo.focus();
      return;
    }
    painel.classList.add('ocupado');
    try {
      await criarClienteComNomeSankhya(nome, nomeSankhya);
      exibirAviso(`Cliente "${nome}" criado e vinculado a "${nomeSankhya}".`);
    } catch (erro) {
      exibirAviso(`Não consegui cadastrar: ${erro.message}`, 'erro');
    }
    aoConcluir();
  }

  function renderizarLista() {
    const termo = busca.value.trim().toLowerCase();
    const clientes = estado.clientes.filter((cliente) =>
      cliente.nome.toLowerCase().includes(termo),
    );
    lista.replaceChildren();

    if (!clientes.length) {
      lista.append(criarElemento('li', 'painel-vinculo-vazio', 'Nenhum cliente encontrado.'));
      return;
    }

    for (const cliente of clientes) {
      const item = criarElemento('li');
      const opcao = criarElemento('button', 'painel-vinculo-opcao', cliente.nome);
      opcao.type = 'button';
      if (cliente === jaVinculado) {
        opcao.classList.add('atual');
        opcao.append(criarElemento('span', 'painel-vinculo-marca', 'vinculado'));
      }
      opcao.addEventListener('click', () => void escolher(cliente));
      item.append(opcao);
      lista.append(item);
    }
  }

  busca.addEventListener('input', renderizarLista);
  busca.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape') aoConcluir();
  });
  campoNovo.addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') {
      evento.preventDefault();
      void criarNovo();
    } else if (evento.key === 'Escape') {
      aoConcluir();
    }
  });

  renderizarLista();
  requestAnimationFrame(() => busca.focus());

  return painel;
}

/**
 * Botão ao lado do nome do parceiro no card de evento: vincula esse nome do Sankhya a um
 * cliente do HUB (existente ou novo). Fica "vinculado" (verde) quando já há um cliente com
 * esse nome. Clicar abre o seletor ao lado; clicar de novo fecha.
 */
function criarBotaoDeVinculoDeCliente(evento) {
  let seletor = null;
  let fecharForaDoPainel = null;

  function fechar() {
    if (fecharForaDoPainel) {
      document.removeEventListener('pointerdown', fecharForaDoPainel, true);
      fecharForaDoPainel = null;
    }
    seletor?.remove();
    seletor = null;
    atualizarBotao();
  }

  /** Ancora o popover abaixo do botão; se não couber, joga pra cima. Preso à viewport. */
  function posicionar() {
    if (!seletor) return;
    const alvo = botao.getBoundingClientRect();
    const largura = seletor.offsetWidth;
    const altura = seletor.offsetHeight;
    const margem = 8;
    const esquerda = Math.min(Math.max(alvo.left, margem), window.innerWidth - largura - margem);
    const cabeAbaixo = alvo.bottom + altura + margem <= window.innerHeight;
    const topo = cabeAbaixo ? alvo.bottom + 4 : Math.max(alvo.top - altura - 4, margem);
    seletor.style.left = `${esquerda}px`;
    seletor.style.top = `${topo}px`;
  }

  const botao = criarBotaoDeIcone('btn tiny ghost', ICONES.link, '', () => {
    if (seletor) {
      fechar();
      return;
    }
    seletor = criarSeletorDeVinculoDeCliente(evento.nomeparc, fechar);
    document.body.append(seletor);
    posicionar();

    fecharForaDoPainel = (evt) => {
      if (!seletor?.contains(evt.target) && evt.target !== botao && !botao.contains(evt.target)) {
        fechar();
      }
    };
    document.addEventListener('pointerdown', fecharForaDoPainel, true);
  });

  function atualizarBotao() {
    const dono = clientePorNomeSankhya(evento.nomeparc);
    botao.classList.toggle('vinculado', Boolean(dono));
    const rotulo = dono
      ? `Vinculado a "${dono.nome}" — clique pra trocar`
      : 'Vincular a um cliente do HUB (ou cadastrar novo)';
    botao.title = rotulo;
    botao.setAttribute('aria-label', rotulo);
  }
  atualizarBotao();

  return botao;
}

/**
 * Widget de calendário mensal da Agenda de Recursos: navegação de mês, grade
 * clicável e detalhe do dia selecionado, com a situação de cada evento no
 * Experience (selo + sub-bloco de OS lançada). Cria os próprios elementos —
 * quem usa só pluga `elemento` num container.
 *
 * Reusado em dois lugares: a aba Agenda do topo (todos os eventos do
 * snapshot) e a aba Agenda do cadastro do cliente (só os eventos do
 * `codparc` amarrado a ele) — a diferença é de onde vêm os eventos
 * (`buscarEventos`) e o que fazer ao trocar de mês (`aoMudarMes`; sem ele,
 * troca de mês só recarrega local — é o que a aba do cliente quer; a aba do
 * topo passa isso pra disparar a consulta ao vivo na Sankhya).
 */
/* ------------------------ carregamento da consulta ----------------------- */

/* Camada de cada área coberta e quantas consultas ainda a seguram. */
const carregamentosEmAndamento = new WeakMap();

function criarCamadaDeCarregamento() {
  const camada = criarElemento('div', 'camada-carregando');
  camada.append(
    criarElemento('span', 'indicador-carregando'),
    criarElemento('strong', null, 'Atualizando da Sankhya…'),
  );
  return camada;
}

function cobrirAreaComCarregamento(area) {
  const emAndamento = carregamentosEmAndamento.get(area) ?? { quantidade: 0, camada: null };
  if (emAndamento.quantidade === 0) {
    emAndamento.camada = criarCamadaDeCarregamento();
    area.append(emAndamento.camada);
    area.inert = true;
    area.setAttribute('aria-busy', 'true');
  }
  emAndamento.quantidade += 1;
  carregamentosEmAndamento.set(area, emAndamento);
}

function descobrirArea(area) {
  const emAndamento = carregamentosEmAndamento.get(area);
  emAndamento.quantidade -= 1;
  if (emAndamento.quantidade > 0) {
    return;
  }
  emAndamento.camada.remove();
  area.inert = false;
  area.removeAttribute('aria-busy');
}

/**
 * Cobre `area` enquanto a consulta ao Sankhya roda: indicador grande por cima e o
 * conteúdo inerte, para ninguém clicar num dia nem trocar o mês com dados prestes a
 * mudar. Consultas sobrepostas na mesma área dividem a camada até a última terminar.
 */
async function comCarregamentoNaArea(area, tarefa) {
  cobrirAreaComCarregamento(area);
  try {
    return await tarefa();
  } finally {
    descobrirArea(area);
  }
}

function criarWidgetDeAgenda({ buscarEventos, aoMudarMes, mesInicial = mesAtualIso() }) {
  const estadoWidget = {
    mes: mesInicial,
    diaSelecionado: dataIsoDeHoje(),
  };

  const rotuloMes = criarElemento('span', 'rotulo-mes-calendario');
  const navegacao = criarElemento('div', 'navegacao-calendario');
  navegacao.append(
    criarBotao('btn tiny ghost', '‹', () => mudarMes(-1)),
    rotuloMes,
    criarBotao('btn tiny ghost', '›', () => mudarMes(1)),
  );

  const status = criarElemento('p', 'texto-auxiliar texto-centralizado');
  const erro = criarElemento('p', 'erro-formulario');
  erro.hidden = true;
  const areaCalendario = criarElemento('div');
  const areaDetalhe = criarElemento('div', 'detalhe-dia-agenda');

  const elemento = criarElemento('div', 'secao-agenda-geral');
  elemento.append(erro, navegacao, status, areaCalendario, areaDetalhe);

  /**
   * Uma célula da grade: número do dia + bolinha quando há evento. A borda
   * verde marca o dia SELECIONADO neste widget, não fixo em "hoje" — clicar
   * noutro dia move a borda pra ele.
   */
  function celula(dia) {
    const selecionado = dia.dia === estadoWidget.diaSelecionado;
    const botaoCelula = criarElemento(
      'button',
      `celula-calendario celula-calendario-clicavel${dia.doMes ? '' : ' fora-do-mes'}${selecionado ? ' selecionado' : ''}`,
    );
    botaoCelula.type = 'button';
    botaoCelula.dataset.dia = dia.dia;
    botaoCelula.append(criarElemento('span', 'celula-calendario-numero', String(dia.numero)));

    if (dia.eventos.length) {
      const selo = criarElemento('span', 'selo-situacao ok', String(dia.eventos.length));
      selo.title = `${dia.eventos.length} evento(s)`;
      botaoCelula.append(selo);
    }

    botaoCelula.addEventListener('click', () => {
      estadoWidget.diaSelecionado = dia.dia;
      for (const outra of areaCalendario.querySelectorAll('.celula-calendario')) {
        outra.classList.toggle('selecionado', outra.dataset.dia === dia.dia);
      }
      renderizarDetalhe(dia, true);
    });
    return botaoCelula;
  }

  /**
   * Detalhe do dia selecionado: lista de eventos, abaixo da grade.
   *
   * `forcarAtualizacaoDaSituacao` ignora o cache de situação do Experience de
   * cada evento — usado quando o clique é numa troca de dia de verdade, não
   * na reabertura do mesmo dia que já estava selecionado.
   */
  function renderizarDetalhe(dia, forcarAtualizacaoDaSituacao = false) {
    areaDetalhe.replaceChildren();
    if (!dia) return;

    const titulo = new Date(`${dia.dia}T00:00:00`).toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    });
    areaDetalhe.append(criarElemento('h3', null, titulo));

    if (!dia.eventos.length) {
      areaDetalhe.append(criarElemento('p', 'texto-auxiliar', 'Nenhum evento neste dia.'));
      return;
    }

    for (const evento of dia.eventos) {
      const linha = criarElemento('div', 'linha-recurso');
      const informacoes = criarElemento('div', 'recurso-info');
      const horario =
        evento.allday === 'S'
          ? 'Dia todo'
          : `${evento.inicio.slice(11, 16)}–${evento.fim.slice(11, 16)}`;
      const tituloDoEvento = evento.nomeparc
        ? `${evento.codparc ?? ''} - ${evento.nomeparc}`
        : evento.descrlonga || evento.descrabrev || '(sem título)';
      const descricaoCompleta = evento.descrlonga || evento.descrabrev;

      if (evento.nomeparc) {
        const linhaNome = criarElemento('div', 'linha-horario-situacao');
        linhaNome.append(criarElemento('p', 'recurso-nome', tituloDoEvento));
        linhaNome.append(criarBotaoDeVinculoDeCliente(evento));
        informacoes.append(linhaNome);
      } else {
        informacoes.append(criarElemento('p', 'recurso-nome', tituloDoEvento));
      }
      if (descricaoCompleta && descricaoCompleta !== tituloDoEvento) {
        informacoes.append(criarElemento('p', 'texto-auxiliar', descricaoCompleta));
      }

      const linhaHorario = criarElemento('div', 'linha-horario-situacao');
      linhaHorario.append(criarElemento('span', 'texto-auxiliar', horario));
      informacoes.append(linhaHorario);

      if (evento.codparc) {
        // O dia certo pra checar é o dia sendo VISTO no calendário, não o de
        // início do evento — um evento de período (férias, semana inteira)
        // aparece em todo dia que cobre, e cada um tem sua própria situação.
        anexarSituacaoDoEvento(
          linhaHorario,
          informacoes,
          evento.codparc,
          dia.dia,
          forcarAtualizacaoDaSituacao,
        );
      }

      linha.append(informacoes);
      areaDetalhe.append(linha);
    }
  }

  /** Busca os eventos do mês em exibição e redesenha a grade — sem consulta ao vivo. */
  async function carregar() {
    limparErro(erro);
    rotuloMes.textContent = nomeDoMes(estadoWidget.mes);
    areaCalendario.replaceChildren(criarElemento('p', 'texto-auxiliar', 'Carregando…'));
    areaDetalhe.replaceChildren();

    const { de, ate } = limitesDoMesCliente(estadoWidget.mes);
    try {
      const eventos = await buscarEventos(de, ate);
      const grade = criarGradeMensalDeEventos(estadoWidget.mes, eventos);
      areaCalendario.replaceChildren(criarGradeDoCalendario(grade, celula));
      status.textContent = eventos.length
        ? `${eventos.length} evento(s) neste mês.`
        : 'Nenhum evento neste mês.';

      // Reabre no dia selecionado antes (ou hoje, na primeira vez) — a borda
      // verde da célula já sai marcada nele, via `celula`.
      const diaSelecionado =
        grade.find((dia) => dia.dia === estadoWidget.diaSelecionado) ??
        grade.find((dia) => dia.hoje);
      if (diaSelecionado) {
        renderizarDetalhe(diaSelecionado);
      }
    } catch (erroDeCarga) {
      areaCalendario.replaceChildren();
      status.textContent = '';
      exibirErro(erro, erroDeCarga.message);
    }
  }

  async function mudarMes(passo) {
    estadoWidget.mes = deslocarMes(estadoWidget.mes, passo);
    if (aoMudarMes) {
      await aoMudarMes(estadoWidget.mes);
    } else {
      await carregar();
    }
  }

  return {
    elemento,
    carregar,
    elementoErro: erro,
    elementoStatus: status,
    get mes() {
      return estadoWidget.mes;
    },
    get diaSelecionado() {
      return estadoWidget.diaSelecionado;
    },
    /** Leva a grade ao dia (`YYYY-MM-DD`), já selecionado, sem recarregar. */
    selecionarDia(dia) {
      estadoWidget.mes = dia.slice(0, 7);
      estadoWidget.diaSelecionado = dia;
    },
  };
}

/** Discreto, ao lado do botão de atualizar — sem hora nunca importado ainda. */
function renderizarUltimaAtualizacaoDaAgenda(importadoEm) {
  elementos.ultimaAtualizacaoAgenda.textContent = importadoEm
    ? `Atualizado em ${new Date(importadoEm).toLocaleString('pt-BR')}`
    : '';
}

/**
 * O widget da aba Agenda do topo: todos os eventos do snapshot, sem recorte de cliente.
 * Ao trocar de mês a grade mostra na hora o que já está no snapshot local e a consulta ao
 * vivo roda em segundo plano — sem tela de espera bloqueando a navegação entre meses.
 */
const widgetAgendaGeral = criarWidgetDeAgenda({
  buscarEventos: async (de, ate) => {
    const [{ eventos }, estadoDoSnapshot] = await Promise.all([
      api.eventosDaAgenda(de, ate),
      api.estadoAgenda(),
    ]);
    renderizarUltimaAtualizacaoDaAgenda(estadoDoSnapshot.importadoEm);
    return eventos;
  },
  aoMudarMes: async () => {
    await widgetAgendaGeral.carregar();
    void atualizarAgendaGeral();
  },
});

/**
 * Consulta ao vivo o mês em exibição e recarrega a grade. Não apaga o que já estava em
 * cache: a grade continua visível enquanto atualiza, e um erro deixa o cache no lugar em
 * vez de esvaziar a tela.
 */
async function atualizarAgendaGeral() {
  limparErro(widgetAgendaGeral.elementoErro);
  elementos.avisoShellAgenda.hidden = true;
  elementos.botaoAtualizarAgenda.disabled = true;
  const statusAntes = widgetAgendaGeral.elementoStatus.textContent;
  widgetAgendaGeral.elementoStatus.textContent = 'Atualizando…';

  const { de, ate } = limitesDoMesCliente(widgetAgendaGeral.mes);
  try {
    await comCarregamentoNaArea(widgetAgendaGeral.elemento, async () => {
      await api.consultarAgenda(de, ate);
      await widgetAgendaGeral.carregar();
    });
  } catch (erro) {
    if (erro.shellIndisponivel) {
      elementos.avisoShellAgenda.hidden = false;
    }
    exibirErroComConfiguracao(widgetAgendaGeral.elementoErro, erro);
    widgetAgendaGeral.elementoStatus.textContent = statusAntes ?? '';
  } finally {
    elementos.botaoAtualizarAgenda.disabled = false;
  }
}

/**
 * Lançar ocorrência de agenda (férias, folga, atestado...) direto no ERP, pela janela
 * oculta do aplicativo. Sempre para o usuário logado no SankhyaOm: o modal mostra quem é,
 * e sem identificá-lo o botão Lançar fica travado com o motivo à vista.
 */
async function abrirModalDeOcorrencia() {
  limparErro(elementos.erroOcorrencia);
  elementos.botaoSalvarOcorrencia.disabled = true;
  const dia = widgetAgendaGeral.diaSelecionado ?? dataIsoDeHoje();
  elementos.campoInicioOcorrencia.value = `${dia}T08:00`;
  elementos.campoFimOcorrencia.value = `${dia}T18:00`;
  elementos.usuarioOcorrencia.textContent = 'Identificando o usuário logado no SankhyaOm…';
  elementos.modalOcorrencia.showModal();

  try {
    if (!elementos.campoMotivoOcorrencia.options.length) {
      const { motivos } = await api.motivosDeOcorrencia();
      elementos.campoMotivoOcorrencia.replaceChildren(
        ...motivos.map((m) => new Option(m.rotulo, m.valor)),
      );
      elementos.campoMotivoOcorrencia.value = '15';
    }
    const usuario = await api.usuarioDaOcorrencia();
    if (usuario.codusuConfigurado && usuario.codusuConfigurado !== usuario.codusu) {
      elementos.usuarioOcorrencia.textContent = 'Lançamento bloqueado.';
      exibirErro(
        elementos.erroOcorrencia,
        `O login salvo do SankhyaOm é de ${usuario.nomeusu} (${usuario.codusu}), mas o seu código ` +
          `de usuário configurado é ${usuario.codusuConfigurado}. A ocorrência só pode ser lançada ` +
          'para você mesmo — confira as Credenciais Sankhya.',
      );
      return;
    }
    elementos.usuarioOcorrencia.textContent = `Para ${usuario.nomeusu} (${usuario.codusu}), direto no SankhyaOm.`;
    elementos.botaoSalvarOcorrencia.disabled = false;
  } catch (erro) {
    elementos.usuarioOcorrencia.textContent =
      'Não foi possível identificar o usuário do SankhyaOm.';
    exibirErro(
      elementos.erroOcorrencia,
      erro.shellIndisponivel
        ? 'Lançar ocorrência precisa do aplicativo HUB SNK aberto, com o login do SankhyaOm salvo.'
        : erro.message,
    );
  }
}

async function salvarOcorrencia(evento) {
  evento.preventDefault();
  limparErro(elementos.erroOcorrencia);
  const inicio = elementos.campoInicioOcorrencia.value;
  const fim = elementos.campoFimOcorrencia.value;
  if (!inicio || !fim) {
    exibirErro(elementos.erroOcorrencia, 'Informe a data inicial e a final.');
    return;
  }
  if (fim <= inicio) {
    exibirErro(elementos.erroOcorrencia, 'A data final tem que ser depois da inicial.');
    return;
  }

  elementos.botaoSalvarOcorrencia.disabled = true;
  elementos.botaoSalvarOcorrencia.textContent = 'Lançando…';
  try {
    const { mensagem } = await api.lancarOcorrencia({
      inicio,
      fim,
      motivo: elementos.campoMotivoOcorrencia.value,
    });
    elementos.modalOcorrencia.close();
    exibirAviso(mensagem);
    // Leva a grade ao início da ocorrência e busca o mês ao vivo, para ela aparecer.
    widgetAgendaGeral.selecionarDia(inicio.slice(0, 10));
    await atualizarAgendaGeral();
  } catch (erro) {
    exibirErro(elementos.erroOcorrencia, erro.message);
    elementos.botaoSalvarOcorrencia.disabled = false;
  } finally {
    elementos.botaoSalvarOcorrencia.textContent = 'Lançar';
  }
}

/* ---------------------------------- OS ------------------------------------ */

/** `YYYY-MM-DD` -> `DD/MM/YYYY`. Vazio (OS sem data de conclusão) vira travessão. */
function formatarDiaDeOs(dia) {
  if (!dia) return '—';
  const [ano, mes, diaDoMes] = dia.split('-');
  return `${diaDoMes}/${mes}/${ano}`;
}

const MINUTOS_POR_HORA = 60;

/* `diff_time` da Experience: `HH:MM`, com as horas podendo passar de 24 e segundos opcionais. */
const FORMATO_DE_HORAS_DA_OS = /^(\d+):(\d{2})(?::\d{2})?$/;

/** `'08:30'` -> 510. Vazio ou fora do formato vale 0: a OS fica fora da soma, sem inventar horas. */
function minutosDasHoras(horas) {
  const partes = FORMATO_DE_HORAS_DA_OS.exec(horas?.trim() ?? '');
  if (!partes) return 0;
  return Number(partes[1]) * MINUTOS_POR_HORA + Number(partes[2]);
}

/** 8400 -> `'140:00'`: total do mês, sem virar dias. */
function formatarMinutosComoHoras(minutos) {
  const horas = Math.floor(minutos / MINUTOS_POR_HORA);
  const resto = String(minutos % MINUTOS_POR_HORA).padStart(2, '0');
  return `${String(horas).padStart(2, '0')}:${resto}`;
}

/* OS sem status na Experience: agrupada à parte, com um nome legível no agrupador. */
const STATUS_DE_OS_VAZIO = 'Sem status';

/* Posição na paleta `.cor-status-N` do styles.css. Os status conhecidos têm cor fixa. */
const CORES_FIXAS_DOS_STATUS_DE_OS = new Map([
  ['Concluído', 0],
  ['Gerado', 1],
]);
const QUANTIDADE_DE_CORES_DE_STATUS = 7;

function statusDaOs(item) {
  return item.statusAceite || STATUS_DE_OS_VAZIO;
}

/** Mais recente primeiro: dia de conclusão e, no mesmo dia, horário de início. Sem data vai para o fim. */
function ordenarOsDaMaisRecente(itens) {
  const chaveDeOrdem = (item) => `${item.dia || '0000-00-00'} ${item.horaInicio}`;
  return [...itens].sort((a, b) => chaveDeOrdem(b).localeCompare(chaveDeOrdem(a)));
}

/** Quantidade de OS de cada status, com os status em ordem alfabética. */
function contarOsPorStatus(itens) {
  const contagens = new Map();
  for (const item of itens) {
    const status = statusDaOs(item);
    contagens.set(status, (contagens.get(status) ?? 0) + 1);
  }
  return new Map([...contagens].sort(([a], [b]) => a.localeCompare(b, 'pt-BR')));
}

/**
 * Classe de cor de cada status. Os conhecidos têm cor fixa; os demais pegam as cores
 * livres na ordem recebida, para dois status do mesmo mês não saírem com a mesma cor.
 */
function atribuirCoresAosStatus(statuses) {
  const fixas = new Set(CORES_FIXAS_DOS_STATUS_DE_OS.values());
  const livres = [...Array(QUANTIDADE_DE_CORES_DE_STATUS).keys()].filter((i) => !fixas.has(i));
  let proximaLivre = 0;

  const cores = new Map();
  for (const status of statuses) {
    const indice =
      CORES_FIXAS_DOS_STATUS_DE_OS.get(status) ?? livres[proximaLivre++ % livres.length];
    cores.set(status, `cor-status-${indice}`);
  }
  return cores;
}

/** Botão de um status: marcado, filtra a lista por ele; vários podem estar marcados. */
function criarAgrupadorDeStatus({ status, quantidade, classeDeCor, marcado, aoAlternar }) {
  const classes = `agrupador-status ${classeDeCor}${marcado ? ' ativo' : ''}`;
  const botao = criarBotao(classes, undefined, aoAlternar);
  botao.setAttribute('aria-pressed', String(marcado));
  botao.title = marcado ? `Parar de filtrar por ${status}` : `Mostrar as OS ${status}`;
  botao.append(
    criarElemento('span', 'ponto-status'),
    criarElemento('span', null, status),
    criarElemento('span', 'opcao-contagem', String(quantidade)),
  );
  return botao;
}

/** Uma OS na lista: número + tipo, empresa/descrição, e uma linha de detalhes. */
function criarLinhaDeOs(item, classeDeCor) {
  const linha = criarElemento('div', 'linha-recurso');
  const informacoes = criarElemento('div', 'recurso-info');

  const linhaTitulo = criarElemento('div', 'linha-horario-situacao');
  linhaTitulo.append(
    criarElemento('p', 'recurso-nome', `OS ${item.numeroSankhya || '(sem número)'} · ${item.tipo}`),
  );
  if (item.statusAceite) {
    linhaTitulo.append(
      criarElemento('span', `selo-situacao selo-status-os ${classeDeCor}`, item.statusAceite),
    );
  }
  informacoes.append(linhaTitulo);

  if (item.empresa) {
    informacoes.append(criarElemento('p', 'texto-auxiliar', item.empresa));
  }
  if (item.erro) {
    informacoes.append(criarElemento('p', 'erro-formulario', item.erro));
  }
  if (item.observacoes) {
    informacoes.append(
      criarElemento('p', 'texto-auxiliar', `Tarefas realizadas: ${item.observacoes}`),
    );
  }

  const detalhes = [
    `Concluída em: ${formatarDiaDeOs(item.dia)}`,
    item.horaInicio && item.horaFim && `Horário: ${item.horaInicio}–${item.horaFim}`,
    item.intervalo && `Intervalo: ${item.intervalo}`,
    item.horasFeitas && `Horas: ${item.horasFeitas}`,
    item.horasExcedidas && 'Horas excedidas',
    item.etapa && `Etapa: ${item.etapa}`,
    item.processos && `Processos: ${item.processos}`,
    item.pedido && `Pedido: ${item.pedido}`,
    item.coordenador && `Coordenador: ${item.coordenador}`,
    item.statusNumeroSankhya && `Status Sankhya: ${item.statusNumeroSankhya}`,
  ].filter(Boolean);
  informacoes.append(criarElemento('p', 'texto-auxiliar', detalhes.join(' • ')));

  linha.append(informacoes);
  return linha;
}

/**
 * Widget da aba OS: navegação de mês (sem calendário — só a lista) e busca ao vivo no
 * Sankhya Experience a cada mês trocado ou "atualizar". Reusado na aba OS do topo (todas
 * as OS do usuário) e na aba OS do cadastro do cliente (recortadas pro cliente) — a
 * diferença é de onde vêm os itens (`buscarOs`).
 */
function criarWidgetDeOs({ buscarOs, aoErro, mesInicial = mesAtualIso() }) {
  /* `statusFiltrados` vazio mostra tudo; a seleção sobrevive à troca de mês. */
  const estadoWidget = { mes: mesInicial, itens: [], statusFiltrados: new Set() };

  const rotuloMes = criarElemento('span', 'rotulo-mes-calendario');
  const navegacao = criarElemento('div', 'navegacao-calendario');
  navegacao.append(
    criarBotao('btn tiny ghost', '‹', () => mudarMes(-1)),
    rotuloMes,
    criarBotao('btn tiny ghost', '›', () => mudarMes(1)),
  );

  const agrupadores = criarElemento('div', 'agrupadores-status');
  agrupadores.setAttribute('role', 'group');
  agrupadores.setAttribute('aria-label', 'Filtrar as OS pelo status');
  const status = criarElemento('p', 'texto-auxiliar totais-os');
  const barra = criarElemento('div', 'barra-os');
  barra.append(agrupadores, status);

  const erro = criarElemento('p', 'erro-formulario');
  erro.hidden = true;
  const lista = criarElemento('div', 'lista-os');

  const elemento = criarElemento('div', 'secao-agenda-geral');
  elemento.append(erro, navegacao, barra, lista);

  function alternarStatus(statusDoAgrupador) {
    const filtrados = estadoWidget.statusFiltrados;
    if (!filtrados.delete(statusDoAgrupador)) {
      filtrados.add(statusDoAgrupador);
    }
    renderizarItens();
  }

  /* Contador e horas somam só as OS visíveis; os agrupadores contam o mês inteiro. */
  function renderizarItens() {
    const { itens, statusFiltrados } = estadoWidget;
    const contagens = contarOsPorStatus(itens);
    const cores = atribuirCoresAosStatus(contagens.keys());
    const visiveis = statusFiltrados.size
      ? itens.filter((item) => statusFiltrados.has(statusDaOs(item)))
      : itens;

    agrupadores.replaceChildren(
      ...[...contagens].map(([statusDoAgrupador, quantidade]) =>
        criarAgrupadorDeStatus({
          status: statusDoAgrupador,
          quantidade,
          classeDeCor: cores.get(statusDoAgrupador),
          marcado: statusFiltrados.has(statusDoAgrupador),
          aoAlternar: () => alternarStatus(statusDoAgrupador),
        }),
      ),
    );
    const minutosLancados = visiveis.reduce(
      (total, item) => total + minutosDasHoras(item.horasFeitas),
      0,
    );
    status.textContent = itens.length
      ? `${visiveis.length} OS neste mês · ${formatarMinutosComoHoras(minutosLancados)} horas lançadas.`
      : 'Nenhuma OS neste mês.';
    lista.replaceChildren(
      ...visiveis.map((item) => criarLinhaDeOs(item, cores.get(statusDaOs(item)))),
    );
  }

  /* Status marcado que não existe no mês novo sai da seleção: senão a lista viria vazia. */
  function descartarStatusAusentes() {
    const presentes = new Set(estadoWidget.itens.map(statusDaOs));
    for (const statusMarcado of estadoWidget.statusFiltrados) {
      if (!presentes.has(statusMarcado)) {
        estadoWidget.statusFiltrados.delete(statusMarcado);
      }
    }
  }

  async function carregar() {
    limparErro(erro);
    rotuloMes.textContent = nomeDoMes(estadoWidget.mes);
    lista.replaceChildren(criarElemento('p', 'texto-auxiliar', 'Carregando…'));

    const { de, ate } = limitesDoMesCliente(estadoWidget.mes);
    try {
      const itens = await comCarregamentoNaArea(elemento, () => buscarOs(de, ate));
      estadoWidget.itens = ordenarOsDaMaisRecente(itens);
      descartarStatusAusentes();
      renderizarItens();
    } catch (erroDeCarga) {
      estadoWidget.itens = [];
      agrupadores.replaceChildren();
      lista.replaceChildren();
      status.textContent = '';
      exibirErroComConfiguracao(erro, erroDeCarga);
      aoErro?.(erroDeCarga);
    }
  }

  async function mudarMes(passo) {
    estadoWidget.mes = deslocarMes(estadoWidget.mes, passo);
    await carregar();
  }

  return {
    elemento,
    carregar,
    elementoErro: erro,
    elementoStatus: status,
    get mes() {
      return estadoWidget.mes;
    },
  };
}

function renderizarUltimaAtualizacaoDeOs(buscadoEm) {
  elementos.ultimaAtualizacaoOs.textContent = buscadoEm
    ? `Atualizado em ${new Date(buscadoEm).toLocaleString('pt-BR')}`
    : '';
}

/** O widget da aba OS do topo: todas as OS do usuário, somando os clientes com parceiro vinculado. */
const widgetOsGeral = criarWidgetDeOs({
  buscarOs: async (de, ate) => {
    const { itens, buscadoEm } = await api.consultarOsGeral(de, ate);
    renderizarUltimaAtualizacaoDeOs(buscadoEm);
    return itens;
  },
  aoErro: (erro) => {
    elementos.avisoShellOs.hidden = !erro.shellIndisponivel;
  },
});

async function atualizarOsGeral() {
  elementos.avisoShellOs.hidden = true;
  elementos.botaoAtualizarOs.disabled = true;
  try {
    await widgetOsGeral.carregar();
  } finally {
    elementos.botaoAtualizarOs.disabled = false;
  }
}

/* ----------------------------- Resumo do dia ------------------------------ */

/*
 * O que pede atenção hoje, junto numa tela: agenda, lembretes, repositórios com pendência
 * grave e versão nova. Só lê o que o painel já tem ou consulta barato (snapshot local,
 * lembretes, situação Git em cache no servidor): nada aqui vai à Experience, ao ERP nem
 * às bases dos clientes.
 */

/*
 * Chave das notificações do alerta da agenda: `agenda:<dia>:<nuevento>`, mais `#<momento>`
 * quando o alerta repete o aviso (verificadorDaAgendaDoDia.ts).
 */
const PREFIXO_DAS_NOTIFICACOES_DA_AGENDA = 'agenda:';
const SEPARADOR_DA_REPETICAO_DO_ALERTA = '#';

/* Resumo mais recente pedido: um desenho que termina depois de outro mais novo é descartado. */
let geracaoDoResumo = 0;

function criarSecaoDoResumo(titulo, linhas, mensagemVazia) {
  const secao = criarElemento('div', 'secao-recursos');
  const cabecalho = criarElemento('div', 'secao-cabecalho');
  cabecalho.append(criarElemento('h3', null, titulo));
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

function criarLinhaDoResumo({ titulo, detalhes, selo, acao }) {
  const informacoes = criarElemento('div', 'recurso-info');
  const linhaTitulo = criarElemento('div', 'linha-horario-situacao');
  linhaTitulo.append(criarElemento('p', 'recurso-nome', titulo));
  if (selo) linhaTitulo.append(selo);
  informacoes.append(linhaTitulo);
  for (const detalhe of detalhes.filter(Boolean)) {
    informacoes.append(criarElemento('p', 'texto-auxiliar', detalhe));
  }
  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, acao);
  return linha;
}

/** Dia local (`YYYY-MM-DD`) de um instante ISO: `toISOString` daria o dia em UTC. */
function diaLocalDoInstante(iso) {
  const data = new Date(iso);
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

/**
 * Eventos de hoje que o alerta da agenda já apontou sem tarefa na Experience. Só com o
 * alerta ligado: sem ele, os eventos ficam sem selo, não "com tarefa".
 */
function eventosDeHojeSemTarefa(hoje) {
  const prefixo = `${PREFIXO_DAS_NOTIFICACOES_DA_AGENDA}${hoje}:`;
  return new Set(
    estado.notificacoes
      .filter((notificacao) => notificacao.origem === 'agenda')
      .filter((notificacao) => notificacao.chave.startsWith(prefixo))
      .map(
        (notificacao) =>
          notificacao.chave.slice(prefixo.length).split(SEPARADOR_DA_REPETICAO_DO_ALERTA)[0],
      ),
  );
}

/* Mesma identificação que o alerta usa na chave da notificação. */
function identificacaoDoEvento(evento) {
  return String(evento.nuevento ?? `${evento.codparc}-${evento.inicio}`);
}

function criarLinhaDeEventoDoResumo(evento, semTarefa) {
  const titulo = evento.nomeparc
    ? `${evento.codparc ?? ''} - ${evento.nomeparc}`
    : evento.descrlonga || evento.descrabrev || '(sem título)';
  const horario =
    evento.allday === 'S'
      ? 'Dia todo'
      : `${evento.inicio.slice(11, 16)}–${evento.fim.slice(11, 16)}`;
  const descricao = evento.descrlonga || evento.descrabrev;
  return criarLinhaDoResumo({
    titulo,
    detalhes: [horario, descricao !== titulo && descricao],
    selo: semTarefa
      ? criarElemento('span', 'selo-situacao erro', 'Sem tarefa na Experience')
      : null,
    acao: criarBotaoDeIcone('btn tiny', ICONES.seta, 'Abrir na Agenda', () =>
      alternarVisualizacao('agenda'),
    ),
  });
}

/* Evento de vários dias (férias, semana de projeto) também é de hoje enquanto durar. */
async function criarSecaoDaAgendaDoResumo(hoje) {
  const { eventos } = await api.eventosDaAgenda(hoje, hoje);
  const semTarefa = eventosDeHojeSemTarefa(hoje);
  const deHoje = eventos
    .filter((evento) => evento.inicio.slice(0, 10) <= hoje && hoje <= evento.fim.slice(0, 10))
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
  return criarSecaoDoResumo(
    'Agenda de hoje',
    deHoje.map((evento) =>
      criarLinhaDeEventoDoResumo(evento, semTarefa.has(identificacaoDoEvento(evento))),
    ),
    'Nenhum evento hoje na agenda.',
  );
}

/* Ainda vai disparar hoje, ou já disparou hoje. */
function lembreteEhDeHoje(lembrete, hoje) {
  const disparaHoje =
    lembrete.proximoDisparo && diaLocalDoInstante(lembrete.proximoDisparo) === hoje;
  const disparouHoje =
    lembrete.ultimoDisparoEm && diaLocalDoInstante(lembrete.ultimoDisparoEm) === hoje;
  return lembrete.ativo && Boolean(disparaHoje || disparouHoje);
}

async function criarSecaoDosLembretesDoResumo(hoje) {
  const { lembretes } = await api.listarLembretes();
  const deHoje = lembretesOrdenados(
    lembretes.filter((lembrete) => lembreteEhDeHoje(lembrete, hoje)),
  );
  return criarSecaoDoResumo(
    'Lembretes de hoje',
    deHoje.map((lembrete) =>
      criarLinhaDoResumo({
        titulo: resumoDoLembrete(lembrete),
        detalhes: [descreverSituacaoDoLembrete(lembrete), descreverVinculoDoLembrete(lembrete)],
        selo: null,
        acao: criarBotaoDeIcone('btn tiny', ICONES.lapis, 'Editar lembrete', () =>
          abrirModalDeLembrete(lembrete),
        ),
      }),
    ),
    'Nenhum lembrete para hoje.',
  );
}

/* As pendências já vêm do servidor da mais grave para a mais leve. */
function criarLinhaDeRepositorioDoResumo({ cliente, repositorio, situacao }) {
  return criarLinhaDoResumo({
    titulo: `${cliente.nome} › ${nomeDeExibicaoDoRepositorio(repositorio)}`,
    detalhes: situacao.pendencias.map((pendencia) => pendencia.mensagem),
    selo: criarElemento(
      'span',
      `selo-situacao ${situacao.severidade}`,
      ROTULOS_DE_SEVERIDADE[situacao.severidade],
    ),
    acao: criarBotaoDeIcone('btn tiny', ICONES.seta, 'Abrir no cliente', () =>
      abrirClienteDaBusca(cliente.id, 'repositorios'),
    ),
  });
}

/* Todo repositório com alguma pendência, os de gravidade `erro` primeiro. */
function criarSecaoDosRepositoriosDoResumo() {
  const comPendencia = estado.clientes
    .flatMap((cliente) =>
      cliente.repositorios.map((repositorio) => ({
        cliente,
        repositorio,
        situacao: estado.situacoesGit[repositorio.id],
      })),
    )
    .filter(({ situacao }) => situacao?.pendencias.length > 0)
    .sort(
      (a, b) =>
        ORDEM_DE_SEVERIDADE[a.situacao.severidade] - ORDEM_DE_SEVERIDADE[b.situacao.severidade] ||
        a.cliente.nome.localeCompare(b.cliente.nome, 'pt-BR'),
    );
  return criarSecaoDoResumo(
    'Repositórios com pendência',
    comPendencia.map(criarLinhaDeRepositorioDoResumo),
    'Nenhum repositório com pendência.',
  );
}

/* Sem versão nova, a seção nem aparece: não é algo a resolver hoje. */
async function criarSecaoDaVersaoDoResumo() {
  const { atualizacaoDisponivel, ultimaVersao, url } = await api.lerAtualizacao();
  if (!atualizacaoDisponivel) return null;
  return criarSecaoDoResumo(
    'HUB SNK',
    [
      criarLinhaDoResumo({
        titulo: `Versão ${ultimaVersao} disponível`,
        detalhes: ['No aplicativo, ela é baixada sozinha e instalada ao reiniciar.'],
        selo: null,
        acao: criarLinkDeIcone('btn tiny', ICONES.seta, 'Ver a versão nova', url),
      }),
    ],
    '',
  );
}

/* Status de aceite da OS terminada na Experience: as demais ainda pedem ação. */
const STATUS_DE_OS_CONCLUIDA = 'Concluído';

/*
 * OS do Resumo, consultadas na Experience. A consulta é lenta (uma chamada de detalhe por
 * OS), então o resultado vale para os redesenhos seguintes e só é buscado de novo quando
 * alguém abre o Resumo. Falha não fica guardada: a próxima vez tenta de novo.
 */
let osDoResumo = null;

function buscarOsDoResumo(renovar) {
  if (osDoResumo && !renovar) return osDoResumo;
  const mesAtual = mesAtualIso();
  const { de } = limitesDoMesCliente(deslocarMes(mesAtual, -1));
  const { ate } = limitesDoMesCliente(mesAtual);
  const consulta = api.consultarOsGeral(de, ate).then(({ itens }) => itens);
  consulta.catch(() => {
    if (osDoResumo === consulta) osDoResumo = null;
  });
  osDoResumo = consulta;
  return consulta;
}

function criarLinhaDeOsDoResumo(item, classeDeCor) {
  const dia = [
    `Dia: ${formatarDiaDeOs(item.dia)}`,
    item.horasFeitas && `Horas: ${item.horasFeitas}`,
  ];
  return criarLinhaDoResumo({
    titulo: `OS ${item.numeroSankhya || '(sem número)'} · ${item.tipo}`,
    detalhes: [item.empresa, dia.filter(Boolean).join(' • '), item.erro],
    selo: criarElemento('span', `selo-situacao selo-status-os ${classeDeCor}`, statusDaOs(item)),
    acao: criarBotaoDeIcone('btn tiny', ICONES.seta, 'Abrir na aba OS', () =>
      alternarVisualizacao('os'),
    ),
  });
}

async function criarSecaoDasOsDoResumo(renovar) {
  const itens = await buscarOsDoResumo(renovar);
  const naoConcluidas = ordenarOsDaMaisRecente(
    itens.filter((item) => item.statusAceite !== STATUS_DE_OS_CONCLUIDA),
  );
  // Mesmas cores da aba OS: elas saem dos status do período inteiro.
  const cores = atribuirCoresAosStatus(contarOsPorStatus(itens).keys());
  return criarSecaoDoResumo(
    'OS não concluídas (mês atual e anterior)',
    naoConcluidas.map((item) => criarLinhaDeOsDoResumo(item, cores.get(statusDaOs(item)))),
    'Nenhuma OS sem conclusão no mês atual e no anterior.',
  );
}

/* Uma seção que falha mostra o motivo no lugar dela, sem derrubar as outras. */
async function secaoOuErro(titulo, criarSecao) {
  try {
    return await criarSecao();
  } catch (erro) {
    const secao = criarSecaoDoResumo(titulo, [], `Não foi possível carregar: ${erro.message}`);
    const link = criarLinkDaConfiguracaoDoErro(erro);
    if (link) {
      secao.querySelector('.secao-vazia').append(' ', link);
    }
    return secao;
  }
}

/*
 * Seções na ordem da tela. Cada uma some junto com a funcionalidade dela em
 * Configurações › Acessos. `titulo` nulo: a seção só aparece quando tem o que mostrar.
 */
function secoesDoResumo(hoje, renovarOs) {
  return [
    funcionalidadeVisivel('agenda') && {
      chave: 'agenda',
      titulo: 'Agenda de hoje',
      carregar: () => criarSecaoDaAgendaDoResumo(hoje),
    },
    funcionalidadeVisivel('lembretes') && {
      chave: 'lembretes',
      titulo: 'Lembretes de hoje',
      carregar: () => criarSecaoDosLembretesDoResumo(hoje),
    },
    funcionalidadeVisivel('os') && {
      chave: 'os',
      titulo: 'OS não concluídas (mês atual e anterior)',
      carregar: () => criarSecaoDasOsDoResumo(renovarOs),
    },
    funcionalidadeVisivel(FUNCIONALIDADE_REPOSITORIOS) && {
      chave: 'repositorios',
      titulo: 'Repositórios com pendência',
      carregar: async () => criarSecaoDosRepositoriosDoResumo(),
    },
    // A versão nova não é essencial: falha dela (sem internet) não vira aviso.
    {
      chave: 'versao',
      titulo: null,
      carregar: () => criarSecaoDaVersaoDoResumo().catch(() => null),
    },
  ].filter(Boolean);
}

/* Seção de cada chave que está na tela: o redesenho troca uma por uma, sem piscar. */
const secoesMontadasDoResumo = new Map();

function lugarDaSecao({ chave, titulo }) {
  const montada = secoesMontadasDoResumo.get(chave);
  if (montada) return montada;
  const lugar = titulo ? criarSecaoDoResumo(titulo, [], 'Carregando…') : criarElemento('div', null);
  secoesMontadasDoResumo.set(chave, lugar);
  return lugar;
}

async function carregarSecaoDoResumo({ chave, titulo, carregar }, geracao) {
  const secao = (await secaoOuErro(titulo, carregar)) ?? criarElemento('div', null);
  if (geracao !== geracaoDoResumo) return;
  secoesMontadasDoResumo.get(chave)?.replaceWith(secao);
  secoesMontadasDoResumo.set(chave, secao);
}

/**
 * Cada seção aparece quando fica pronta: as OS, que vêm da Experience, não seguram o
 * resto. Enquanto a versão nova de uma seção carrega, a anterior continua na tela.
 *
 * `renovarOs`: busca as OS de novo em vez de reaproveitar a última consulta.
 */
function renderizarResumo({ renovarOs = false } = {}) {
  const geracao = ++geracaoDoResumo;
  const hoje = dataIsoDeHoje();
  elementos.dataDoResumo.textContent = new Date(`${hoje}T00:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });
  const secoes = secoesDoResumo(hoje, renovarOs);
  const chavesVisiveis = new Set(secoes.map(({ chave }) => chave));
  for (const chave of secoesMontadasDoResumo.keys()) {
    if (!chavesVisiveis.has(chave)) secoesMontadasDoResumo.delete(chave);
  }
  elementos.mountResumo.replaceChildren(...secoes.map(lugarDaSecao));
  for (const secao of secoes) void carregarSecaoDoResumo(secao, geracao);
}

function renderizarResumoSeVisivel() {
  if (estado.visualizacao === 'resumo') renderizarResumo();
}

function alternarVisualizacao(visualizacao) {
  estado.visualizacao = visualizacao;

  const opcoes = [
    {
      chave: 'resumo',
      botao: elementos.botaoVisualizacaoResumo,
      area: elementos.visualizacaoResumo,
    },
    {
      chave: 'clientes',
      botao: elementos.botaoVisualizacaoClientes,
      area: elementos.visualizacaoClientes,
    },
    { chave: 'local', botao: elementos.botaoVisualizacaoLocal, area: elementos.visualizacaoLocal },
    {
      chave: 'agenda',
      botao: elementos.botaoVisualizacaoAgenda,
      area: elementos.visualizacaoAgenda,
    },
    { chave: 'os', botao: elementos.botaoVisualizacaoOs, area: elementos.visualizacaoOs },
    {
      chave: 'contatos',
      botao: elementos.botaoVisualizacaoContatos,
      area: elementos.visualizacaoContatos,
    },
    {
      chave: 'lembretes',
      botao: elementos.botaoVisualizacaoLembretes,
      area: elementos.visualizacaoLembretes,
    },
    {
      chave: 'autosync',
      botao: elementos.botaoVisualizacaoAutosync,
      area: elementos.visualizacaoAutosync,
    },
  ];

  for (const { chave, botao, area } of opcoes) {
    const ativa = chave === visualizacao;
    area.hidden = !ativa;
    botao.classList.toggle('ativa', ativa);
    botao.setAttribute('aria-selected', String(ativa));
  }

  if (visualizacao === 'resumo') {
    renderizarResumo({ renovarOs: true });
  }
  if (visualizacao === 'local') {
    carregarLocal();
  }
  if (visualizacao === 'agenda') {
    // Mostra o snapshot local na hora e atualiza em segundo plano.
    void widgetAgendaGeral.carregar().then(() => atualizarAgendaGeral());
  }
  if (visualizacao === 'os') {
    void widgetOsGeral.carregar();
  }
  if (visualizacao === 'contatos') {
    void recarregarContatos();
  }
  if (visualizacao === 'lembretes') {
    void recarregarLembretes();
  }
  if (visualizacao === 'autosync') {
    void abrirVisualizacaoDoAutosync();
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

/*
 * Agenda e OS consultam o Sankhya e a Experience ao montar, e guardam o mês, o dia e o
 * filtro escolhidos. O detalhe é redesenhado a cada tique do Git e a cada base
 * verificada: remontá-las ali repetia as consultas ao vivo dezenas de vezes por minuto e
 * devolvia a tela ao mês corrente. Cada uma é montada uma vez por cliente e reaproveitada.
 *
 * A identidade inclui os nomes porque é por eles que a Agenda e as OS são recortadas:
 * editar o cliente precisa refazer a consulta.
 */
const secoesConsultadasDoDetalhe = { identidade: '', porChave: new Map() };

function identidadeDasConsultasDoCliente(cliente) {
  return [cliente.id, cliente.nome, ...cliente.nomesCompletos].join('\n');
}

function secaoConsultadaDoCliente(cliente, chave, criar) {
  const identidade = identidadeDasConsultasDoCliente(cliente);
  if (secoesConsultadasDoDetalhe.identidade !== identidade) {
    secoesConsultadasDoDetalhe.identidade = identidade;
    secoesConsultadasDoDetalhe.porChave.clear();
  }

  let secao = secoesConsultadasDoDetalhe.porChave.get(chave);
  if (!secao) {
    secao = criar(cliente);
    secoesConsultadasDoDetalhe.porChave.set(chave, secao);
  }
  return secao;
}

function descartarSecoesConsultadasDoDetalhe() {
  secoesConsultadasDoDetalhe.identidade = '';
  secoesConsultadasDoDetalhe.porChave.clear();
}

/**
 * Abas do detalhe do cliente. Trocar de aba só mostra/esconde o que já foi
 * montado — sem chamar `renderizarDetalhe()` de novo, que descartaria o
 * calendário aberto e qualquer outro estado local da aba.
 *
 * Aba oculta em Configurações › Acessos nem é montada, e a marcada `soAoAbrir` só é
 * montada quando aberta: Agenda e OS consultam o servidor ao montar.
 */
function criarAbasDeDetalhe(todasAsAbas) {
  const abas = todasAsAbas.filter((aba) => funcionalidadeVisivel(`cliente.${aba.chave}`));
  const ativaInicial = abas.some((aba) => aba.chave === estado.abaDetalheAtiva)
    ? estado.abaDetalheAtiva
    : abas[0].chave;

  const barra = criarElemento('div', 'abas-modal detalhe-abas');
  barra.setAttribute('role', 'tablist');
  const corpo = criarElemento('div', 'abas-empilhadas detalhe-abas-corpo');

  for (const aba of abas) {
    const painel = criarElemento('div', 'painel-aba');
    painel.dataset.chave = aba.chave;
    painel.hidden = aba.chave !== ativaInicial;
    const montar = () => {
      if (!painel.hasChildNodes()) {
        painel.append(aba.criarConteudo());
      }
    };
    if (!aba.soAoAbrir || aba.chave === ativaInicial) {
      montar();
    }

    const botao = criarBotao(aba.chave === ativaInicial ? 'aba ativa' : 'aba', aba.rotulo, () => {
      estado.abaDetalheAtiva = aba.chave;
      montar();
      for (const filho of barra.children) {
        filho.classList.toggle('ativa', filho.dataset.chave === aba.chave);
      }
      for (const outroPainel of corpo.children) {
        outroPainel.hidden = outroPainel.dataset.chave !== aba.chave;
      }
    });
    botao.setAttribute('role', 'tab');
    botao.dataset.chave = aba.chave;
    barra.append(botao);
    corpo.append(painel);
  }

  const container = criarElemento('div', 'detalhe-abas-container');
  container.append(barra, corpo);
  return container;
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

  const secaoGeral = criarElemento('div');
  secaoGeral.append(criarSecaoDeAnotacoes(cliente), criarSecaoDeLinks(cliente));

  const card = criarElemento('div', 'card');
  card.append(
    cabecalho,
    criarAbasDeDetalhe([
      { chave: 'geral', rotulo: 'Geral', criarConteudo: () => secaoGeral },
      { chave: 'bases', rotulo: 'Bases', criarConteudo: () => criarSecaoDeBases(cliente) },
      // Montada só ao abrir: a seção do AutoSync consulta o CLI assim que é criada.
      {
        chave: 'repositorios',
        rotulo: 'Git',
        soAoAbrir: true,
        criarConteudo: () => {
          const secoes = criarElemento('div');
          secoes.append(criarSecaoDeRepositorios(cliente));
          if (funcionalidadeVisivel('cliente.autosync')) {
            secoes.append(
              secaoConsultadaDoCliente(cliente, 'autosync', criarSecaoDoAutosyncDoCliente),
            );
          }
          return secoes;
        },
      },
      {
        chave: 'projetos',
        rotulo: 'Projetos',
        criarConteudo: () => criarSecaoDeProjetos(cliente),
      },
      {
        chave: 'agenda',
        rotulo: 'Agenda',
        soAoAbrir: true,
        criarConteudo: () => secaoConsultadaDoCliente(cliente, 'agenda', criarSecaoDeAgenda),
      },
      {
        chave: 'os',
        rotulo: 'OS',
        soAoAbrir: true,
        criarConteudo: () => secaoConsultadaDoCliente(cliente, 'os', criarSecaoDeOs),
      },
      {
        chave: 'contatos',
        rotulo: 'Contatos',
        criarConteudo: () => criarSecaoDeContatosDoCliente(cliente),
      },
    ]),
  );
  elementos.detalhe.replaceChildren(card);
  restaurarCursorNasAnotacoes(cursorNasAnotacoes);
}

function renderizar() {
  renderizarLista();
  renderizarDetalhe();
  renderizarIndicadorGitGlobal();
  // Situação Git nova ou cadastro mudado: a seção de repositórios do Resumo acompanha.
  renderizarResumoSeVisivel();
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
  preencherNomesCompletos([]);
  limparErro(elementos.erroCliente);
  elementos.modalCliente.showModal();
  elementos.campoNome.focus();
}

function abrirModalDeEdicao(cliente) {
  estado.clienteEmEdicao = cliente;
  elementos.modalTitulo.textContent = 'Editar cliente';
  elementos.modalSubtitulo.textContent = 'Altere o nome do cliente.';
  elementos.campoNome.value = cliente.nome;
  preencherNomesCompletos(cliente.nomesCompletos);
  limparErro(elementos.erroCliente);
  elementos.modalCliente.showModal();
  elementos.campoNome.select();
}

/** Uma linha do cadastro de "Nomes completos": um campo de texto e um botão de remover. */
function criarLinhaDeNomeCompleto(valor) {
  const linha = criarElemento('div', 'linha-nome-completo');

  const campo = criarElemento('input');
  campo.type = 'text';
  campo.value = valor;
  campo.maxLength = 120;
  campo.autocomplete = 'off';
  campo.spellcheck = false;
  campo.placeholder = 'Ex.: Indústria Alfa Ltda';
  campo.setAttribute('aria-label', 'Nome completo');

  const remover = criarBotaoDeIcone('btn tiny danger', ICONES.lixeira, 'Remover nome', () =>
    linha.remove(),
  );

  linha.append(campo, remover);
  return linha;
}

function adicionarLinhaDeNomeCompleto(valor) {
  const linha = criarLinhaDeNomeCompleto(valor);
  elementos.listaNomesCompletosCliente.append(linha);
  return linha;
}

function preencherNomesCompletos(nomes) {
  elementos.listaNomesCompletosCliente.replaceChildren();
  for (const nome of nomes) {
    adicionarLinhaDeNomeCompleto(nome);
  }
}

function buscarCampoDeNomeCompletoVazio() {
  return [...elementos.listaNomesCompletosCliente.querySelectorAll('input')].find(
    (campo) => !campo.value.trim(),
  );
}

/** Linha em branco é descartada: é o que sobra de um "Adicionar nome" desistido. */
function lerNomesCompletosDoFormulario() {
  const valores = [...elementos.listaNomesCompletosCliente.querySelectorAll('input')]
    .map((campo) => campo.value.trim())
    .filter(Boolean);
  return [...new Set(valores)];
}

async function salvarCliente(evento) {
  evento.preventDefault();

  const nome = elementos.campoNome.value.trim();
  if (!nome) {
    exibirErro(elementos.erroCliente, 'Informe o nome do cliente.');
    return;
  }

  const nomesCompletos = lerNomesCompletosDoFormulario();
  if (nomesCompletos.length > MAXIMO_DE_NOMES_COMPLETOS) {
    exibirErro(
      elementos.erroCliente,
      `No máximo ${MAXIMO_DE_NOMES_COMPLETOS} nomes completos por cliente.`,
    );
    return;
  }

  limparErro(elementos.erroCliente);
  elementos.botaoSalvarCliente.disabled = true;

  try {
    const emEdicao = estado.clienteEmEdicao;
    let cliente = emEdicao ? await api.atualizar(emEdicao.id, nome) : await api.criar(nome);
    // São duas gravações: se a dos nomes falhar, o cliente já existe, e salvar de novo
    // precisa atualizá-lo em vez de cadastrar um segundo.
    estado.clienteEmEdicao = cliente;

    cliente = await api.salvarNomesCompletos(cliente.id, nomesCompletos);

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

function abrirModalDeCadastroDeProjeto(cliente) {
  estado.clienteDoProjetoEmEdicao = cliente;
  estado.projetoEmEdicao = null;
  elementos.modalProjetoTitulo.textContent = 'Cadastrar projeto';
  elementos.modalProjetoSubtitulo.textContent = `Cliente: ${cliente.nome}`;
  elementos.campoNomeProjeto.value = '';
  limparErro(elementos.erroProjeto);
  elementos.modalProjeto.showModal();
  elementos.campoNomeProjeto.focus();
}

function abrirModalDeEdicaoDeProjeto(cliente, projeto) {
  estado.clienteDoProjetoEmEdicao = cliente;
  estado.projetoEmEdicao = projeto;
  elementos.modalProjetoTitulo.textContent = 'Editar projeto';
  elementos.modalProjetoSubtitulo.textContent = `Cliente: ${cliente.nome}`;
  elementos.campoNomeProjeto.value = projeto.nome;
  limparErro(elementos.erroProjeto);
  elementos.modalProjeto.showModal();
  elementos.campoNomeProjeto.select();
}

async function salvarProjeto(evento) {
  evento.preventDefault();

  const nome = elementos.campoNomeProjeto.value.trim();
  if (!nome) {
    exibirErro(elementos.erroProjeto, 'Informe o nome do projeto.');
    return;
  }

  limparErro(elementos.erroProjeto);
  elementos.botaoSalvarProjeto.disabled = true;

  try {
    const cliente = estado.clienteDoProjetoEmEdicao;
    const emEdicao = estado.projetoEmEdicao;

    if (emEdicao) {
      await api.atualizarProjeto(cliente.id, emEdicao.id, { nome });
    } else {
      await api.adicionarProjeto(cliente.id, { nome });
    }

    await recarregarClientes();
    elementos.modalProjeto.close();
    exibirAviso(emEdicao ? 'Projeto atualizado.' : 'Projeto cadastrado.');
  } catch (erro) {
    exibirErro(elementos.erroProjeto, erro.message);
  } finally {
    elementos.botaoSalvarProjeto.disabled = false;
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
  elementos.campoSgbd.value = banco?.sgbd ?? 'oracle';
  elementos.campoIdentificadorOracle.value = banco?.identificadorOracle ?? 'service-name';
  elementos.campoHost.value = banco?.host ?? '';
  elementos.campoPorta.value = banco?.porta ?? PORTA_PADRAO_DO_BANCO;
  elementos.campoServico.value = banco?.nomeDoServico ?? '';
  elementos.campoUsuarioBanco.value = banco?.usuario ?? '';
  elementos.campoSenhaBanco.value = banco?.senha ?? '';
  elementos.botaoDesvincularBanco.hidden = !banco;

  atualizarCamposDoSgbd();
  definirVisibilidadeDaSenhaDoBanco(false);
  limparErro(elementos.erroBanco);
  elementos.modalBanco.showModal();
  elementos.campoHost.focus();
}

function lerFormularioDeBanco() {
  return {
    sgbd: elementos.campoSgbd.value,
    identificadorOracle: elementos.campoIdentificadorOracle.value,
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
    return `Informe o ${rotuloDoCampoDeServico(dados)}.`;
  }

  if (!dados.usuario) {
    return 'Informe o usuário do banco.';
  }

  if (!dados.senha) {
    return 'Informe a senha do banco.';
  }

  return null;
}

/* O mesmo campo guarda service name ou SID no Oracle e o database no SQL Server. */
function rotuloDoCampoDeServico({ sgbd, identificadorOracle }) {
  return sgbd === 'oracle'
    ? ROTULOS_DE_IDENTIFICADOR_ORACLE[identificadorOracle]
    : ROTULO_DO_DATABASE;
}

function atualizarCamposDoSgbd() {
  const dados = lerFormularioDeBanco();

  elementos.grupoIdentificadorOracle.hidden = dados.sgbd !== 'oracle';
  elementos.rotuloCampoServico.textContent = rotuloDoCampoDeServico(dados);
  elementos.botoesDeCopiarDoBanco.forEach(rotularBotaoDeCopiarDoBanco);
}

/* O rótulo vem do `<label>` do campo porque o do serviço muda com o SGBD. */
function rotuloDoCampoCopiado(botao) {
  return document.querySelector(`label[for="${botao.dataset.copiarCampo}"]`).textContent;
}

function rotularBotaoDeCopiarDoBanco(botao) {
  const rotulo = `Copiar ${rotuloDoCampoCopiado(botao)}`;
  botao.title = rotulo;
  botao.setAttribute('aria-label', rotulo);
}

function copiarCampoDoBanco(botao) {
  const valor = document.getElementById(botao.dataset.copiarCampo).value;
  const rotulo = rotuloDoCampoCopiado(botao);

  if (valor === '') {
    exibirAviso(`${rotulo} está vazio: nada para copiar.`, 'erro');
    return;
  }

  copiarParaAreaDeTransferencia(valor, `${rotulo} copiado.`);
}

/* Só troca a porta padrão do outro SGBD: porta digitada pelo usuário é preservada. */
function aplicarPortaPadraoDoSgbd() {
  const portaAtual = Number(elementos.campoPorta.value);
  const ehPortaPadrao = Object.values(PORTAS_PADRAO_POR_SGBD).includes(portaAtual);

  if (elementos.campoPorta.value === '' || ehPortaPadrao) {
    elementos.campoPorta.value = PORTAS_PADRAO_POR_SGBD[elementos.campoSgbd.value];
  }
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
  elementos.campoUrlRepositorio.value = repositorio?.url ?? '';
  elementos.campoCaminhoLocal.value = repositorio?.caminhoLocal ?? '';

  limparErro(elementos.erroRepositorio);
  elementos.modalRepositorio.showModal();
  elementos.campoCaminhoLocal.focus();
}

/** Último componente do caminho, aceitando `\` e `/`. */
function nomeDaPasta(caminho) {
  return caminho.split(/[\\/]/).filter(Boolean).pop() ?? '';
}

/** Nome de exibição do repositório: a pasta do clone ou, sem clone, a URL. */
function nomeDeExibicaoDoRepositorio(repositorio) {
  return nomeDaPasta(repositorio.caminhoLocal ?? repositorio.url.replace(/\.git$/, ''));
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
    url: elementos.campoUrlRepositorio.value.trim(),
    caminhoLocal: elementos.campoCaminhoLocal.value.trim(),
  };

  if (!dados.caminhoLocal) {
    exibirErro(elementos.erroRepositorio, 'Informe o caminho local do repositório.');
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

/** `projeto` é `null` quando o link é geral do cliente, não de um projeto. */
function abrirModalDeLink(cliente, link, projeto = null) {
  estado.clienteDoLinkEmEdicao = cliente;
  estado.linkEmEdicao = link;
  estado.projetoDoLinkEmEdicao = projeto;

  elementos.modalLinkTitulo.textContent = link ? 'Editar link' : 'Cadastrar link';
  elementos.modalLinkSubtitulo.textContent = projeto
    ? `Cliente: ${cliente.nome} · Projeto: ${projeto.nome}`
    : `Cliente: ${cliente.nome}`;
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

function abrirModalDeCadastroDeLinkDeProjeto(cliente, projeto) {
  abrirModalDeLink(cliente, null, projeto);
}

function abrirModalDeEdicaoDeLinkDeProjeto(cliente, projeto, link) {
  abrirModalDeLink(cliente, link, projeto);
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
    const projeto = estado.projetoDoLinkEmEdicao;
    const emEdicao = estado.linkEmEdicao;

    if (projeto) {
      if (emEdicao) {
        await api.atualizarLinkDoProjeto(cliente.id, projeto.id, emEdicao.id, dados);
      } else {
        await api.adicionarLinkDoProjeto(cliente.id, projeto.id, dados);
      }
    } else if (emEdicao) {
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

/* --------------------------- credenciais do sankhya ------------------------ */

/** Os elementos de um cartão de credencial, lidos pelo atributo `data-papel`. */
function elementosDoCartaoDeCredencial(cartao) {
  return {
    sistema: cartao.dataset.sistema,
    status: cartao.querySelector('[data-papel="status"]'),
    campoUsuario: cartao.querySelector('[data-papel="usuario"]'),
    campoSenha: cartao.querySelector('[data-papel="senha"]'),
    botaoVerSenha: cartao.querySelector('[data-papel="ver-senha"]'),
    botaoSalvar: cartao.querySelector('[data-papel="salvar"]'),
    botaoRemover: cartao.querySelector('[data-papel="remover"]'),
    botaoAbrirAba: cartao.querySelector('[data-papel="abrir-aba"]'),
    botaoCapturarSessao: cartao.querySelector('[data-papel="capturar-sessao"]'),
    erro: cartao.querySelector('[data-papel="erro"]'),
  };
}

/* Só os cartões de login têm `data-sistema`; o do CODUSU usa o mesmo visual e fica de fora. */
function cartoesDeCredenciaisSankhya() {
  return [
    ...elementos.modalCredenciaisSankhya.querySelectorAll('.cartao-credencial[data-sistema]'),
  ].map(elementosDoCartaoDeCredencial);
}

/** Pinta o selo do cartão a partir do status devolvido pelo cofre do app desktop. */
function renderizarStatusCredencial(cartaoElementos, status) {
  const { campoUsuario, status: selo } = cartaoElementos;
  campoUsuario.value = status.usuario;

  if (status.sessaoCapturada) {
    const expira = status.sessaoExpiraEm
      ? ` até ${new Date(status.sessaoExpiraEm).toLocaleString('pt-BR')}`
      : '';
    selo.className = 'selo-situacao ok';
    selo.textContent = `Sessão ativa${expira}`;
    return;
  }

  if (status.definido) {
    selo.className = 'selo-situacao atencao';
    selo.textContent = 'Credencial salva, sem sessão capturada';
    return;
  }

  selo.className = 'selo-situacao';
  selo.textContent = 'Sem credencial';
}

/** Recarrega os dois cartões; app desktop fora do ar avisa uma vez só. */
async function atualizarCredenciaisSankhya() {
  const cartoes = cartoesDeCredenciaisSankhya();

  let shellDisponivel = true;
  try {
    ({ disponivel: shellDisponivel } = await api.shellSankhya());
  } catch {
    shellDisponivel = false;
  }
  elementos.avisoShellSankhya.hidden = shellDisponivel;

  for (const cartaoElementos of cartoes) {
    limparErro(cartaoElementos.erro);
  }

  try {
    const { credenciais } = await api.credenciaisSankhya();
    for (const status of credenciais) {
      const cartaoElementos = cartoes.find((c) => c.sistema === status.sistema);
      if (!cartaoElementos) continue;
      renderizarStatusCredencial(cartaoElementos, status);
      cartaoElementos.campoSenha.value = status.definido
        ? (await api.senhaCredencialSankhya(status.sistema)).senha
        : '';
    }
  } catch (erro) {
    for (const cartaoElementos of cartoes) {
      exibirErro(cartaoElementos.erro, erro.message);
    }
  }
}

function abrirModalDeCredenciaisSankhya() {
  elementos.modalCredenciaisSankhya.showModal();
  void atualizarCredenciaisSankhya();
  void carregarCodusuSankhyaOm();
}

async function carregarCodusuSankhyaOm() {
  limparErro(elementos.erroCodusu);
  elementos.campoConfigSankhyaOmCodUsu.value = '';
  try {
    const configuracao = await api.lerConfiguracao();
    elementos.campoConfigSankhyaOmCodUsu.value = configuracao.sankhyaOmCodUsu ?? '';
  } catch (erro) {
    exibirErro(elementos.erroCodusu, `Não foi possível ler o código de usuário: ${erro.message}`);
  }
}

/* Gravado sozinho, sem o formulário das configurações: é o único campo global daqui. */
async function salvarCodusuSankhyaOm() {
  limparErro(elementos.erroCodusu);
  elementos.botaoSalvarCodusu.disabled = true;
  try {
    await api.salvarSankhyaOmCodUsu(elementos.campoConfigSankhyaOmCodUsu.value.trim());
    exibirAviso('Código de usuário do SankhyaOm salvo.');
  } catch (erro) {
    exibirErro(elementos.erroCodusu, erro.message);
  } finally {
    elementos.botaoSalvarCodusu.disabled = false;
  }
}

async function salvarCredencialDoCartao(cartaoElementos) {
  const usuario = cartaoElementos.campoUsuario.value.trim();
  const senha = cartaoElementos.campoSenha.value;
  limparErro(cartaoElementos.erro);

  if (!usuario || !senha) {
    exibirErro(cartaoElementos.erro, 'Informe usuário e senha.');
    return;
  }

  cartaoElementos.botaoSalvar.disabled = true;
  try {
    const status = await api.salvarCredencialSankhya(cartaoElementos.sistema, usuario, senha);
    renderizarStatusCredencial(cartaoElementos, status);
    exibirAviso('Credencial salva. Logando automaticamente…');
  } catch (erro) {
    exibirErro(cartaoElementos.erro, erro.message);
    return;
  } finally {
    cartaoElementos.botaoSalvar.disabled = false;
  }

  await autoLoginDoCartao(cartaoElementos);
}

/**
 * Loga sozinho na guia do sistema (usuário/senha do cofre) e já captura a sessão —
 * substitui o "abrir aba > logar na mão > capturar sessão" manual. Chamado depois de
 * salvar a credencial; os botões manuais continuam à mão como reserva se isto falhar.
 */
async function autoLoginDoCartao(cartaoElementos) {
  limparErro(cartaoElementos.erro);
  try {
    await api.autoLoginSankhya(cartaoElementos.sistema);
    exibirAviso('Sessão capturada automaticamente.');
    await atualizarCredenciaisSankhya();
  } catch (erro) {
    exibirErro(
      cartaoElementos.erro,
      `${erro.message} — use "Abrir aba" e "Capturar sessão" manualmente.`,
    );
  }
}

async function removerCredencialDoCartao(cartaoElementos) {
  limparErro(cartaoElementos.erro);
  cartaoElementos.botaoRemover.disabled = true;
  try {
    const status = await api.removerCredencialSankhya(cartaoElementos.sistema);
    cartaoElementos.campoUsuario.value = '';
    cartaoElementos.campoSenha.value = '';
    renderizarStatusCredencial(cartaoElementos, status);
    exibirAviso('Credencial removida.');
  } catch (erro) {
    exibirErro(cartaoElementos.erro, erro.message);
  } finally {
    cartaoElementos.botaoRemover.disabled = false;
  }
}

/**
 * Troca para a guia do sistema no app desktop. O modal fica aberto por baixo:
 * ao voltar para o Painel depois do login, o "Capturar sessão" está à mão.
 */
async function abrirAbaDoCartao(cartaoElementos) {
  limparErro(cartaoElementos.erro);
  cartaoElementos.botaoAbrirAba.disabled = true;
  try {
    await api.abrirNavegadorSankhya(cartaoElementos.sistema);
    exibirAviso('Faça login na guia e volte ao Painel para clicar em "Capturar sessão".');
  } catch (erro) {
    exibirErro(cartaoElementos.erro, erro.message);
  } finally {
    cartaoElementos.botaoAbrirAba.disabled = false;
  }
}

async function capturarSessaoDoCartao(cartaoElementos) {
  limparErro(cartaoElementos.erro);
  cartaoElementos.botaoCapturarSessao.disabled = true;
  try {
    await api.capturarSessaoSankhya(cartaoElementos.sistema);
    exibirAviso('Sessão capturada.');
    await atualizarCredenciaisSankhya();
  } catch (erro) {
    exibirErro(cartaoElementos.erro, erro.message);
  } finally {
    cartaoElementos.botaoCapturarSessao.disabled = false;
  }
}

function registrarEventosDoCartaoDeCredencial(cartaoElementos) {
  cartaoElementos.botaoVerSenha.append(criarIcone(ICONES.olho));
  cartaoElementos.botaoVerSenha.addEventListener('click', () => {
    definirVisibilidadeDoCampo(
      cartaoElementos.campoSenha,
      cartaoElementos.botaoVerSenha,
      cartaoElementos.campoSenha.type === 'password',
    );
  });
  cartaoElementos.botaoSalvar.addEventListener('click', () =>
    salvarCredencialDoCartao(cartaoElementos),
  );
  cartaoElementos.botaoRemover.addEventListener('click', () =>
    removerCredencialDoCartao(cartaoElementos),
  );
  cartaoElementos.botaoAbrirAba.addEventListener('click', () => abrirAbaDoCartao(cartaoElementos));
  cartaoElementos.botaoCapturarSessao.addEventListener('click', () =>
    capturarSessaoDoCartao(cartaoElementos),
  );
}

/* ----------------------------- configuração global ------------------------ */

/** Alterna entre as abas do modal de configuração. */
function selecionarAbaDaConfiguracao(abaEscolhida) {
  const abas = [
    { aba: elementos.abaConfiguracaoGeral, painel: elementos.painelConfiguracaoGeral },
    { aba: elementos.abaConfiguracaoMcp, painel: elementos.painelConfiguracaoMcp },
    { aba: elementos.abaConfiguracaoAtalhos, painel: elementos.painelConfiguracaoAtalhos },
    { aba: elementos.abaConfiguracaoSmtp, painel: elementos.painelConfiguracaoSmtp },
    { aba: elementos.abaConfiguracaoAvisos, painel: elementos.painelConfiguracaoAvisos },
    { aba: elementos.abaConfiguracaoIa, painel: elementos.painelConfiguracaoIa },
    { aba: elementos.abaConfiguracaoAcessos, painel: elementos.painelConfiguracaoAcessos },
    { aba: elementos.abaConfiguracaoSobre, painel: elementos.painelConfiguracaoSobre },
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

/**
 * Preenche o caminho com a pasta do `.env` escolhido e as variáveis com o que ele
 * contém. A gravação continua no "Salvar" da janela.
 */
async function importarEnvDoMcpGlobal() {
  elementos.botaoImportarEnvMcp.disabled = true;

  try {
    const importado = await api.importarEnvDoMcpGlobal();
    // Sem resposta o usuário cancelou: o que já estava nos campos continua valendo.
    if (!importado) {
      return;
    }

    limparErro(elementos.erroConfiguracao);
    elementos.campoCaminhoSchemaMcp.value = importado.caminhoDoSchemaMcp;
    preencherCamposDoMcpGlobal(importado.configuracao);
  } catch (erro) {
    exibirErro(elementos.erroConfiguracao, erro.message);
  } finally {
    elementos.botaoImportarEnvMcp.disabled = false;
  }
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
    const vazia = criarElemento('p', 'lista-atalhos-vazia', 'Cadastre em Configurações › Atalhos.');
    const link = criarLinkDeConfiguracaoPendente('atalhos');
    link.addEventListener('click', fecharListaDeAtalhos);
    vazia.append(' ', link);
    elementos.listaDeAtalhos.append(vazia);
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
  elementos.campoDestinoDosLinks.value = DESTINO_DOS_LINKS_PADRAO;
  preencherAtalhosDaConfiguracao([]);
  elementos.campoCaminhoExecutavelDaIde.value = '';
  elementos.campoNomeDoUsuario.value = '';
  elementos.campoEmpresaDoUsuario.value = '';
  elementos.campoTimeDoUsuario.value = '';
  elementos.campoEmailDoUsuario.value = '';
  preencherAcessosDaConfiguracao(PERFIL_PADRAO, [], false);
  preencherNotificacoesDaConfiguracao(SMTP_PADRAO, ALERTA_DA_AGENDA_PADRAO);
  exibirResultadoDoTesteDoSmtp(null);
  definirVisibilidadeDoCampo(elementos.campoSmtpSenha, elementos.botaoVerSenhaSmtp, false);
  preencherAssistenteDeIaDaConfiguracao(ASSISTENTE_DE_IA_PADRAO);

  try {
    const configuracao = await api.lerConfiguracao();
    elementos.campoScriptPadrao.value = configuracao.scriptPadrao ?? '';
    elementos.campoIntervaloDeExecucaoAutomatica.value =
      configuracao.intervaloDeExecucaoAutomaticaSegundos ??
      INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S;
    elementos.campoTempoLimite.value = configuracao.tempoLimiteSegundos ?? TEMPO_LIMITE_PADRAO_S;
    elementos.campoCaminhoSchemaMcp.value = configuracao.caminhoDoSchemaMcp ?? '';
    elementos.campoDestinoDosLinks.value = configuracao.destinoDosLinks ?? DESTINO_DOS_LINKS_PADRAO;
    preencherAtalhosDaConfiguracao(configuracao.atalhos ?? []);
    elementos.campoCaminhoExecutavelDaIde.value = configuracao.caminhoDoExecutavelDaIde ?? '';
    elementos.campoNomeDoUsuario.value = configuracao.nomeDoUsuario ?? '';
    elementos.campoEmpresaDoUsuario.value = configuracao.empresaDoUsuario ?? '';
    elementos.campoTimeDoUsuario.value = configuracao.timeDoUsuario ?? '';
    elementos.campoEmailDoUsuario.value = configuracao.emailDoUsuario ?? '';
    preencherAcessosDaConfiguracao(
      configuracao.perfil ?? PERFIL_PADRAO,
      configuracao.funcionalidadesOcultas ?? [],
      configuracao.terceiro ?? false,
    );
    preencherNotificacoesDaConfiguracao(
      configuracao.smtp ?? SMTP_PADRAO,
      configuracao.alertaDaAgenda ?? ALERTA_DA_AGENDA_PADRAO,
    );
    preencherAssistenteDeIaDaConfiguracao(configuracao.assistenteDeIa ?? ASSISTENTE_DE_IA_PADRAO);
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

  // Recolhido a cada abertura: o que ficou expandido da última vez não conta.
  elementos.grupoSankhyaSchema.open = false;
  elementos.modalConfiguracao.showModal();
  elementos.campoScriptPadrao.focus();
}

/* ------------------------ configuração inicial pendente ------------------- */

/* Quanto o botão do topo pisca antes de a configuração abrir. */
const DURACAO_DO_DESTAQUE_DA_CONFIGURACAO_MS = 450;

/* `abrirModalDeConfiguracao` desiste sem abrir quando não consegue ler a configuração. */
async function abrirConfiguracaoNaAba(aba, campo) {
  await abrirModalDeConfiguracao();
  if (!elementos.modalConfiguracao.open) {
    return;
  }
  selecionarAbaDaConfiguracao(aba);
  campo.focus();
}

function abrirCredenciaisSankhyaNoCampo(campo) {
  abrirModalDeCredenciaisSankhya();
  campo?.focus();
}

function cartaoDeCredencialSankhya(sistema) {
  return cartoesDeCredenciaisSankhya().find((cartao) => cartao.sistema === sistema);
}

/**
 * Para onde leva cada configuração que falta: o botão do topo que a abre e o campo que
 * recebe o foco. As chaves `codusu`, `login-erp`, `sessao-experience` e `ide` são as do
 * `configuracaoPendente` que o backend manda junto do erro.
 */
const DESTINOS_DE_CONFIGURACAO_PENDENTE = {
  codusu: {
    botao: () => elementos.botaoCredenciaisSankhya,
    abrir: () => abrirCredenciaisSankhyaNoCampo(elementos.campoConfigSankhyaOmCodUsu),
  },
  'login-erp': {
    botao: () => elementos.botaoCredenciaisSankhya,
    abrir: () =>
      abrirCredenciaisSankhyaNoCampo(cartaoDeCredencialSankhya('sankhya-erp')?.campoUsuario),
  },
  'sessao-experience': {
    botao: () => elementos.botaoCredenciaisSankhya,
    abrir: () =>
      abrirCredenciaisSankhyaNoCampo(
        cartaoDeCredencialSankhya('sankhya-experience')?.botaoCapturarSessao,
      ),
  },
  ide: {
    botao: () => elementos.botaoConfiguracao,
    abrir: () =>
      abrirConfiguracaoNaAba(elementos.abaConfiguracaoGeral, elementos.campoCaminhoExecutavelDaIde),
  },
  atalhos: {
    botao: () => elementos.botaoConfiguracao,
    abrir: () =>
      abrirConfiguracaoNaAba(elementos.abaConfiguracaoAtalhos, elementos.botaoAdicionarAtalho),
  },
  smtp: {
    botao: () => elementos.botaoConfiguracao,
    abrir: () => abrirConfiguracaoNaAba(elementos.abaConfiguracaoSmtp, elementos.campoSmtpHost),
  },
  gitlab: {
    botao: () => elementos.botaoConfiguracaoAutosync,
    abrir: () => abrirConfiguracaoDoAutosync(),
  },
};

function destacarBotaoDoTopo(botao) {
  botao.classList.add('destaque-configuracao');
  return new Promise((resolver) => {
    setTimeout(() => {
      botao.classList.remove('destaque-configuracao');
      resolver();
    }, DURACAO_DO_DESTAQUE_DA_CONFIGURACAO_MS);
  });
}

/** O botão do topo pisca antes de abrir: é onde a pessoa acha a configuração da próxima vez. */
async function abrirConfiguracaoPendente(chave) {
  const destino = DESTINOS_DE_CONFIGURACAO_PENDENTE[chave];
  const botao = destino.botao();
  // Segundo clique durante a piscada não enfileira outra abertura.
  if (botao.classList.contains('destaque-configuracao')) {
    return;
  }
  await destacarBotaoDoTopo(botao);
  await destino.abrir();
}

function criarLinkDeConfiguracaoPendente(chave) {
  const link = criarElemento('button', 'link-configuracao', 'Abrir configuração');
  link.type = 'button';
  link.addEventListener('click', () => void abrirConfiguracaoPendente(chave));
  return link;
}

/** `null` quando o erro não é de configuração que falta. */
function criarLinkDaConfiguracaoDoErro(erro) {
  if (!Object.hasOwn(DESTINOS_DE_CONFIGURACAO_PENDENTE, erro.configuracaoPendente ?? '')) {
    return null;
  }
  return criarLinkDeConfiguracaoPendente(erro.configuracaoPendente);
}

function exibirErroComConfiguracao(elementoDeErro, erro) {
  exibirErro(elementoDeErro, erro.message);
  const link = criarLinkDaConfiguracaoDoErro(erro);
  if (link) {
    elementoDeErro.append(' ', link);
  }
}

/* Mesma regra do `smtpConfigurado` do backend (src/notificacoes/enviadorDeEmail.ts). */
function smtpConfigurado(smtp) {
  return Boolean(smtp?.host && smtp.remetente && smtp.destinatario);
}

/* Lembrete com e-mail e sem SMTP seria gravado sem nunca chegar a ninguém. */
async function avisarSmtpPendenteDoLembrete(enviaEmail) {
  const aviso = elementos.avisoSmtpLembrete;
  aviso.hidden = true;
  if (!enviaEmail) {
    return;
  }

  try {
    const configuracao = await api.lerConfiguracao();
    if (smtpConfigurado(configuracao.smtp)) {
      return;
    }
    aviso.replaceChildren(
      'Configure o SMTP (host, remetente e destinatário) para o e-mail sair.',
      ' ',
      criarLinkDeConfiguracaoPendente('smtp'),
    );
  } catch (erro) {
    aviso.replaceChildren(`Não foi possível conferir o SMTP: ${erro.message}`);
  }
  // A caixa pode ter sido desmarcada enquanto a configuração era lida.
  aviso.hidden = !elementos.campoEmailLembrete.checked;
}

/*
 * O mesmo padrão do servidor. Vale para todo link clicável do cadastro —
 * bases, repositório, links gerais e de projeto. Quem aplica a escolha é o
 * aplicativo desktop, na hora do clique.
 */
const DESTINO_DOS_LINKS_PADRAO = 'hub';

async function salvarConfiguracao(evento) {
  evento.preventDefault();

  /* Sem caminho não há `.env` a gravar, e as variáveis nem são enviadas. */
  const caminhoDoSchemaMcp = elementos.campoCaminhoSchemaMcp.value.trim();
  const mcp = caminhoDoSchemaMcp === '' ? undefined : lerCamposDoMcpGlobal();

  // Sem esta cobrança as variáveis digitadas seriam descartadas com "Configurações salvas.".
  if (!mcp && Object.values(lerCamposDoMcpGlobal()).some((valor) => valor !== '')) {
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoMcp);
    elementos.grupoSankhyaSchema.open = true;
    exibirErro(
      elementos.erroConfiguracao,
      'Informe o caminho do sankhya-schema-mcp ou importe o .env para gravar as variáveis.',
    );
    return;
  }

  if (mcp) {
    const mensagemDeErro = validarFormularioDoMcp(mcp);
    if (mensagemDeErro) {
      selecionarAbaDaConfiguracao(elementos.abaConfiguracaoMcp);
      elementos.grupoSankhyaSchema.open = true;
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
      destinoDosLinks: elementos.campoDestinoDosLinks.value,
      caminhoDoExecutavelDaIde: elementos.campoCaminhoExecutavelDaIde.value.trim(),
      perfil: elementos.campoPerfil.value,
      funcionalidadesOcultas: lerFuncionalidadesOcultasDaConfiguracao(),
      terceiro: elementos.campoTerceiro.checked,
      smtp: lerSmtpDaConfiguracao(),
      alertaDaAgenda: lerAlertaDaAgendaDaConfiguracao(),
      assistenteDeIa: lerAssistenteDeIaDaConfiguracao(),
      nomeDoUsuario: elementos.campoNomeDoUsuario.value.trim(),
      empresaDoUsuario: elementos.campoEmpresaDoUsuario.value.trim(),
      timeDoUsuario: elementos.campoTimeDoUsuario.value.trim(),
      emailDoUsuario: elementos.campoEmailDoUsuario.value.trim(),
    });
    elementos.modalConfiguracao.close();
    if (acessosMudaram(salva)) {
      recarregarPainelPorMudancaDeAcessos();
      return;
    }

    exibirAviso('Configurações salvas.');
    definirExecucaoAutomatica(Number(elementos.campoIntervaloDeExecucaoAutomatica.value));

    /* A resposta traz os ids gerados: é dela que a barra passa a viver. */
    estado.atalhos = salva.atalhos ?? [];
    estado.ideConfigurada = Boolean(salva.caminhoDoExecutavelDaIde);
    renderizarListaDeAtalhos();
  } catch (erro) {
    exibirErro(elementos.erroConfiguracao, erro.message);
  } finally {
    elementos.botaoSalvarConfiguracao.disabled = false;
  }
}

/* ------------------------- assistente de IA do kanban ---------------------- */

const ASSISTENTE_DE_IA_PADRAO = { assistente: 'auto', modelo: '' };

const NOMES_DOS_ASSISTENTES_DE_IA = {
  auto: 'Automático (o primeiro instalado)',
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
  gemini: 'Gemini CLI',
  cursor: 'Cursor Agent',
};

/*
 * Os assistentes da máquina, lidos ao abrir a aba IA: listar os modelos roda o CLI de
 * cada um e leva alguns segundos, o que não pode atrasar a abertura das configurações.
 */
let assistentesDeIaDaMaquina = null;
let consultaDosAssistentesDeIa = null;

function preencherOpcoesDosAssistentesDeIa(selecionado) {
  const opcoes = Object.entries(NOMES_DOS_ASSISTENTES_DE_IA).map(([id, nome]) => {
    const situacao = assistentesDeIaDaMaquina?.find((assistente) => assistente.id === id);
    const naoInstalado = situacao && !situacao.instalado;
    const opcao = new Option(naoInstalado ? `${nome} (não instalado)` : nome, id);
    // O gravado continua escolhível mesmo sumido da máquina: senão o Salvar o trocaria calado.
    opcao.disabled = Boolean(naoInstalado) && id !== selecionado;
    return opcao;
  });
  elementos.campoAssistenteIa.replaceChildren(...opcoes);
  elementos.campoAssistenteIa.value = selecionado;
}

/* Valor da opção que abre o campo para digitar um modelo fora da lista. */
const OUTRO_MODELO_DE_IA = '__outro__';

/*
 * O modelo escolhido, guardado à parte do campo: a lista de modelos só chega depois que
 * a aba IA abre, e redesenhar o `<select>` antes disso perderia o que estava gravado.
 */
let modeloDeIaEscolhido = '';
let raciocinioDeIaEscolhido = '';

const ROTULOS_DOS_NIVEIS_DE_RACIOCINIO = {
  minimal: 'Mínimo',
  low: 'Baixo',
  medium: 'Médio',
  high: 'Alto',
  xhigh: 'Muito alto',
  max: 'Máximo',
  ultra: 'Ultra',
};

function preencherAssistenteDeIaDaConfiguracao(configuracao) {
  preencherOpcoesDosAssistentesDeIa(configuracao.assistente);
  modeloDeIaEscolhido = configuracao.modelo;
  raciocinioDeIaEscolhido = configuracao.raciocinio ?? '';
  aplicarAssistenteEscolhido();
}

function lerAssistenteDeIaDaConfiguracao() {
  const assistente = elementos.campoAssistenteIa.value;
  const automatico = assistente === 'auto';
  return {
    assistente,
    modelo: automatico ? '' : modeloDeIaEscolhido.trim(),
    raciocinio: automatico || elementos.blocoRaciocinioIa.hidden ? '' : raciocinioDeIaEscolhido,
  };
}

/* Os apelidos do Claude Code apontam sempre para o mais novo da família: o rótulo diz isso. */
function rotuloDoModeloDeIa(modelo) {
  return /^(opus|sonnet|haiku|fable)$/.test(modelo)
    ? `${modelo} (sempre o ${modelo.charAt(0).toUpperCase()}${modelo.slice(1)} mais novo)`
    : modelo;
}

/* Lista do assistente, mais "Padrão" e "Outro modelo…"; o gravado fora da lista vai para o Outro. */
function desenharModelosDeIa(situacao, automatico) {
  const modelos = situacao?.modelos ?? [];
  const padrao = situacao?.modeloPadrao
    ? `Padrão do assistente (${situacao.modeloPadrao})`
    : 'Padrão do assistente';
  const opcoes = [new Option(automatico ? 'Padrão do assistente escolhido' : padrao, '')];
  for (const modelo of modelos) {
    opcoes.push(new Option(rotuloDoModeloDeIa(modelo), modelo));
  }
  if (!automatico) {
    opcoes.push(new Option('Outro modelo…', OUTRO_MODELO_DE_IA));
  }
  elementos.campoModeloIa.replaceChildren(...opcoes);

  const naLista = modeloDeIaEscolhido === '' || modelos.includes(modeloDeIaEscolhido);
  elementos.campoModeloIa.value = naLista ? modeloDeIaEscolhido : OUTRO_MODELO_DE_IA;
  elementos.campoModeloIaOutro.value = naLista ? '' : modeloDeIaEscolhido;
  elementos.blocoModeloIaOutro.hidden = naLista;
}

/*
 * Os níveis do modelo escolhido. Modelo digitado em "Outro" fica com os níveis gerais do
 * assistente, quando ele tem (o Claude Code aceita o `--effort` em qualquer modelo).
 */
function niveisDoModeloDeIa(situacao) {
  const porModelo = situacao?.raciocinio ?? {};
  const modelo = modeloDeIaEscolhido.trim();
  // Modelo da lista sem níveis (o Haiku) não tem a opção; só o digitado herda os gerais.
  const digitado = modelo !== '' && !(situacao?.modelos ?? []).includes(modelo);
  return porModelo[modelo] ?? (digitado && situacao?.id === 'claude' ? porModelo[''] : null);
}

function desenharRaciocinioDeIa(situacao, automatico) {
  const niveis = automatico ? null : niveisDoModeloDeIa(situacao);
  elementos.blocoRaciocinioIa.hidden = !niveis?.niveis.length;
  if (!niveis?.niveis.length) {
    return;
  }
  if (!niveis.niveis.includes(raciocinioDeIaEscolhido)) {
    raciocinioDeIaEscolhido = '';
  }
  const rotulo = (nivel) =>
    ROTULOS_DOS_NIVEIS_DE_RACIOCINIO[nivel]
      ? `${ROTULOS_DOS_NIVEIS_DE_RACIOCINIO[nivel]} (${nivel})`
      : nivel;
  const padrao = niveis.padrao ? `Padrão do modelo: ${rotulo(niveis.padrao)}` : 'Padrão do modelo';
  elementos.campoRaciocinioIa.replaceChildren(
    new Option(padrao, ''),
    ...niveis.niveis.map((nivel) => new Option(rotulo(nivel), nivel)),
  );
  elementos.campoRaciocinioIa.value = raciocinioDeIaEscolhido;
}

function situacaoDoAssistenteDeIaEscolhido() {
  const id = elementos.campoAssistenteIa.value;
  return assistentesDeIaDaMaquina?.find((assistente) => assistente.id === id);
}

/* Troca de assistente esvazia o modelo: o nome de um não vale para outro. */
function aplicarAssistenteEscolhido({ trocouDeAssistente = false } = {}) {
  const id = elementos.campoAssistenteIa.value;
  const automatico = id === 'auto';
  if (automatico || trocouDeAssistente) {
    modeloDeIaEscolhido = '';
    raciocinioDeIaEscolhido = '';
  }
  const situacao = assistentesDeIaDaMaquina?.find((assistente) => assistente.id === id);
  desenharModelosDeIa(situacao, automatico);
  desenharRaciocinioDeIa(situacao, automatico);
  elementos.campoModeloIa.disabled = automatico;
  elementos.situacaoAssistenteIa.textContent = assistentesDeIaDaMaquina
    ? descreverAssistenteDeIa(id)
    : 'Abrindo a lista de assistentes instalados…';
}

function aplicarModeloEscolhido() {
  const outro = elementos.campoModeloIa.value === OUTRO_MODELO_DE_IA;
  elementos.blocoModeloIaOutro.hidden = !outro;
  modeloDeIaEscolhido = outro ? elementos.campoModeloIaOutro.value : elementos.campoModeloIa.value;
  desenharRaciocinioDeIa(situacaoDoAssistenteDeIaEscolhido(), false);
  if (outro) {
    elementos.campoModeloIaOutro.focus();
  }
}

function descreverAssistenteDeIa(id) {
  if (!assistentesDeIaDaMaquina) {
    return '';
  }
  if (id === 'auto') {
    const primeiro = assistentesDeIaDaMaquina.find((assistente) => assistente.instalado);
    return primeiro
      ? `Usa o ${primeiro.nome}, o primeiro instalado, com o modelo padrão dele.`
      : 'Nenhum assistente encontrado nesta máquina.';
  }
  const assistente = assistentesDeIaDaMaquina.find((item) => item.id === id);
  if (!assistente?.instalado) {
    return 'Não encontrado nesta máquina: a análise vai falhar até ele ser instalado.';
  }
  const partes = [`Instalado em ${assistente.caminho}.`];
  if (assistente.modeloPadrao) {
    partes.push(`Modelo padrão: ${assistente.modeloPadrao}.`);
  }
  partes.push(
    assistente.lePdf
      ? 'Lê o PDF do escopo sozinho.'
      : 'Não lê PDF: o HUB SNK extrai o texto do PDF e manda junto.',
  );
  return partes.join(' ');
}

async function carregarAssistentesDeIa(forcar = false) {
  if (assistentesDeIaDaMaquina && !forcar) {
    aplicarAssistenteEscolhido();
    return;
  }
  if (!consultaDosAssistentesDeIa) {
    elementos.botaoAtualizarAssistentesIa.disabled = true;
    elementos.situacaoAssistenteIa.textContent = 'Procurando os assistentes instalados…';
    consultaDosAssistentesDeIa = api
      .assistentesDeIa()
      .then(({ assistentes }) => {
        assistentesDeIaDaMaquina = assistentes;
      })
      .catch((erro) => {
        elementos.situacaoAssistenteIa.textContent = `Não foi possível procurar os assistentes: ${erro.message}`;
      })
      .finally(() => {
        consultaDosAssistentesDeIa = null;
        elementos.botaoAtualizarAssistentesIa.disabled = false;
      });
  }
  await consultaDosAssistentesDeIa;
  if (assistentesDeIaDaMaquina) {
    preencherOpcoesDosAssistentesDeIa(elementos.campoAssistenteIa.value);
    aplicarAssistenteEscolhido();
  }
}

/* ----------------------------- token do GitLab ---------------------------- */

/* Host e token gravados quando o modal abriu: decide se o Salvar precisa regravá-los. */
let gitlabDaConfiguracao = { host: '', tokenDefinido: false };

/** Primeiro host GitLab entre os repositórios cadastrados: vira a sugestão do campo. */
function hostDoGitlabSugerido() {
  for (const cliente of estado.clientes) {
    for (const repositorio of cliente.repositorios) {
      try {
        const { hostname } = new URL(repositorio.url);
        if (hostname.includes('gitlab')) {
          return hostname;
        }
      } catch {
        // URL em outro formato (SSH curto): só não serve de sugestão.
      }
    }
  }
  return null;
}

function preencherGitlabDaConfiguracao(situacao) {
  gitlabDaConfiguracao = situacao;
  elementos.campoGitlabHost.value = situacao.host;
  const sugerido = hostDoGitlabSugerido();
  elementos.campoGitlabHost.placeholder = sugerido
    ? `Ex.: ${sugerido}`
    : 'Ex.: gitlab.empresa.com.br';
  elementos.campoGitlabToken.value = '';
  elementos.campoGitlabToken.placeholder = situacao.tokenDefinido
    ? 'Token gravado: digite outro para trocar'
    : 'Cole o Personal Access Token';
  definirVisibilidadeDoCampo(elementos.campoGitlabToken, elementos.botaoVerTokenGitlab, false);
  elementos.situacaoTokenGitlab.textContent = situacao.tokenDefinido
    ? 'Há um token gravado nas variáveis de ambiente do usuário.'
    : 'Nenhum token gravado.';
  elementos.botaoRemoverTokenGitlab.hidden = !situacao.tokenDefinido;
}

/** `null` quando nada mudou: sem token novo e com o mesmo host, não há o que gravar. */
function lerGitlabDaConfiguracao() {
  const host = elementos.campoGitlabHost.value.trim().toLowerCase();
  const token = elementos.campoGitlabToken.value.trim();
  if (token === '' && host === gitlabDaConfiguracao.host) {
    return null;
  }
  if (token === '' && !gitlabDaConfiguracao.tokenDefinido) {
    return host === '' ? null : { host, token: undefined };
  }
  return { host, token: token === '' ? undefined : token };
}

async function removerTokenDoGitlab() {
  elementos.botaoRemoverTokenGitlab.disabled = true;
  try {
    preencherGitlabDaConfiguracao(await api.removerTokenDoGitlab());
    exibirAviso('Token do GitLab removido.');
  } catch (erro) {
    exibirErro(elementos.erroConfiguracaoAutosync, erro.message);
  } finally {
    elementos.botaoRemoverTokenGitlab.disabled = false;
  }
}

/** A engrenagem da aba Git AutoSync: o host e o token do GitLab que o MR usa. */
async function abrirConfiguracaoDoAutosync() {
  limparErro(elementos.erroConfiguracaoAutosync);
  preencherGitlabDaConfiguracao({ host: '', tokenDefinido: false });
  try {
    preencherGitlabDaConfiguracao(await api.lerGitlab());
  } catch (erro) {
    exibirAviso(`Não foi possível ler o token do GitLab: ${erro.message}`, 'erro');
    return;
  }
  elementos.modalConfiguracaoAutosync.showModal();
  elementos.campoGitlabHost.focus();
}

async function salvarConfiguracaoDoAutosync(evento) {
  evento.preventDefault();
  const gitlab = lerGitlabDaConfiguracao();
  if (!gitlab) {
    elementos.modalConfiguracaoAutosync.close();
    return;
  }
  if (gitlab.host === '') {
    exibirErro(elementos.erroConfiguracaoAutosync, 'Informe o host do GitLab junto com o token.');
    return;
  }

  limparErro(elementos.erroConfiguracaoAutosync);
  elementos.botaoSalvarConfiguracaoAutosync.disabled = true;
  try {
    preencherGitlabDaConfiguracao(await api.definirGitlab(gitlab.host, gitlab.token));
    elementos.modalConfiguracaoAutosync.close();
    exibirAviso('Configurações do Git AutoSync salvas.');
  } catch (erro) {
    exibirErro(elementos.erroConfiguracaoAutosync, erro.message);
  } finally {
    elementos.botaoSalvarConfiguracaoAutosync.disabled = false;
  }
}

/* --------------------------------- acessos -------------------------------- */

/* Sem perfil gravado, o servidor responde desenvolvedor: nada oculto. */
const PERFIL_PADRAO = 'desenvolvedor';

/*
 * Ocultar a aba Git do cliente leva junto o que só existe por causa dos repositórios:
 * filtro e indicadores do Git, a aba MCP da configuração e a seção AutoSync.
 */
const FUNCIONALIDADE_REPOSITORIOS = 'cliente.repositorios';

/*
 * O que só funciona com as credenciais do SankhyaOm ou da Experience. Com Terceiro,
 * somem por cima das caixas, sem mexer no que está gravado nelas.
 */
const FUNCIONALIDADES_QUE_DEPENDEM_DO_SANKHYA = new Set([
  'agenda',
  'os',
  'cliente.agenda',
  'cliente.os',
]);

/* Clientes (menu) e Geral (cliente) nunca estão no conjunto: não são ocultáveis. */
function funcionalidadeVisivel(chave) {
  if (estado.terceiro && FUNCIONALIDADES_QUE_DEPENDEM_DO_SANKHYA.has(chave)) {
    return false;
  }
  return !estado.funcionalidadesOcultas.has(chave);
}

function preencherAcessosDaConfiguracao(perfil, funcionalidadesOcultas, terceiro) {
  elementos.campoPerfil.value = perfil;
  elementos.campoTerceiro.checked = terceiro;
  marcarFuncionalidadesVisiveis(funcionalidadesOcultas);
  bloquearCaixasQueDependemDoSankhya();
}

/* Desabilitada, a caixa mantém a marcação: desmarcar Terceiro devolve o que era. */
function bloquearCaixasQueDependemDoSankhya() {
  for (const caixa of elementos.caixasDeFuncionalidade) {
    if (FUNCIONALIDADES_QUE_DEPENDEM_DO_SANKHYA.has(caixa.dataset.funcionalidade)) {
      caixa.disabled = elementos.campoTerceiro.checked;
    }
  }
}

function marcarFuncionalidadesVisiveis(funcionalidadesOcultas) {
  for (const caixa of elementos.caixasDeFuncionalidade) {
    caixa.checked = !funcionalidadesOcultas.includes(caixa.dataset.funcionalidade);
  }
}

function lerFuncionalidadesOcultasDaConfiguracao() {
  return [...elementos.caixasDeFuncionalidade]
    .filter((caixa) => !caixa.checked)
    .map((caixa) => caixa.dataset.funcionalidade);
}

/* Trocar o perfil marca o preset dele; as caixas seguem editáveis depois. */
async function aplicarPresetDoPerfil() {
  try {
    const presets = await api.lerPresetsDosPerfis();
    marcarFuncionalidadesVisiveis(presets[elementos.campoPerfil.value] ?? []);
  } catch (erro) {
    exibirErro(
      elementos.erroConfiguracao,
      `Não foi possível ler o preset do perfil: ${erro.message}`,
    );
  }
}

/** Mostra ou esconde o menu principal e o que depende dos repositórios, e redesenha. */
function aplicarAcessos({ perfil, funcionalidadesOcultas = [], terceiro = false }) {
  estado.perfil = perfil;
  estado.funcionalidadesOcultas = new Set(funcionalidadesOcultas);
  estado.terceiro = terceiro;

  // O que usa as credenciais do Sankhya sem ser aba: some junto com Agenda e OS.
  elementos.botaoCredenciaisSankhya.hidden = terceiro;
  elementos.grupoAlertaAgenda.hidden = terceiro;
  elementos.campoNomesCompletosCliente.hidden = terceiro;

  elementos.botaoVisualizacaoLocal.hidden = !funcionalidadeVisivel('local');
  elementos.botaoVisualizacaoAgenda.hidden = !funcionalidadeVisivel('agenda');
  elementos.botaoVisualizacaoOs.hidden = !funcionalidadeVisivel('os');
  elementos.botaoVisualizacaoLembretes.hidden = !funcionalidadeVisivel('lembretes');
  elementos.botaoVisualizacaoContatos.hidden = !funcionalidadeVisivel('contatos');
  elementos.botaoVisualizacaoAutosync.hidden = !funcionalidadeVisivel('autosync');

  const repositoriosVisiveis = funcionalidadeVisivel(FUNCIONALIDADE_REPOSITORIOS);
  elementos.botaoFiltros.hidden = !repositoriosVisiveis;
  // A aba MCP também guarda o MCP do kanban, que mora em Projetos: some só sem os dois.
  const projetosVisiveis = funcionalidadeVisivel('cliente.projetos');
  elementos.abaConfiguracaoMcp.hidden = !repositoriosVisiveis && !projetosVisiveis;
  elementos.grupoSankhyaSchema.hidden = !repositoriosVisiveis;
  elementos.grupoKanbanMcp.hidden = !projetosVisiveis;
  if (!repositoriosVisiveis) {
    // Filtro marcado e escondido sumiria com clientes sem o usuário ter como desfazer.
    estado.situacoesFiltradas.clear();
    definirPainelDeFiltros(false);
  }

  if (!funcionalidadeVisivel(estado.visualizacao)) {
    alternarVisualizacao('clientes');
  }
  renderizar();
}

/* Compara com o que está em vigor na tela: só perfil, Terceiro ou caixas diferentes pedem recarga. */
function acessosMudaram({ perfil, funcionalidadesOcultas = [], terceiro = false }) {
  const emVigor = estado.funcionalidadesOcultas;
  return (
    perfil !== estado.perfil ||
    terceiro !== estado.terceiro ||
    funcionalidadesOcultas.length !== emVigor.size ||
    funcionalidadesOcultas.some((chave) => !emVigor.has(chave))
  );
}

/* Tempo para o aviso ser lido antes de a página sumir. */
const ESPERA_ANTES_DE_RECARREGAR_MS = 1500;

/** Recarregar monta o Painel do zero com os acessos novos, sem resto do estado anterior. */
function recarregarPainelPorMudancaDeAcessos() {
  exibirAviso('Acessos salvos. Recarregando o painel…');
  setTimeout(() => window.location.reload(), ESPERA_ANTES_DE_RECARREGAR_MS);
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
const VALOR_DE_CLIENTE_NOVO = '\u0000novo-cliente';

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
      ['SGBD', ROTULOS_DE_SGBD[banco.sgbd]],
      ...(banco.sgbd === 'oracle'
        ? [['Identificação', ROTULOS_DE_IDENTIFICADOR_ORACLE[banco.identificadorOracle]]]
        : []),
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

/* Com kanban, quem pergunta o que fazer com eles é o `kanban.js`. */
function pedirExclusaoDeProjeto(cliente, projeto) {
  void kanban.pedirExclusaoDeProjeto(cliente, projeto);
}

function pedirExclusaoDeProjetoSemKanban(cliente, projeto) {
  pedirExclusao(
    'Excluir projeto',
    `Excluir o projeto "${projeto.nome}" de ${cliente.nome}? Esta ação não pode ser desfeita.`,
    () => api.removerProjeto(cliente.id, projeto.id),
    'Projeto excluído.',
  );
}

function pedirExclusaoDeLinkDeProjeto(cliente, projeto, link) {
  pedirExclusao(
    'Excluir link',
    `Excluir o link "${link.nome}" do projeto "${projeto.nome}"? Esta ação não pode ser desfeita.`,
    () => api.removerLinkDoProjeto(cliente.id, projeto.id, link.id),
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

/* ------------------------------ notificações ------------------------------ */

/* O mesmo padrão do servidor: é o que a tela mostra enquanto a configuração não chega. */
const SMTP_PADRAO = {
  host: '',
  porta: 587,
  seguranca: 'starttls',
  usuario: '',
  senha: '',
  remetente: '',
  destinatario: '',
};
/* Mesmo padrão de fábrica do backend (repositorioConfiguracaoArquivo.ts). */
const ALERTA_DA_AGENDA_PADRAO = {
  ativo: false,
  intervaloMinutos: 120,
  incluirProximoDiaUtil: false,
  repetirAteResolver: false,
  enviarEmail: false,
};

const LIMITE_DO_CONTADOR_DE_NOTIFICACOES = 99;

/* Duas notas ascendentes e curtas: chama atenção sem ser alarme. */
const NOTAS_DO_SOM_HZ = [880, 1318.5];
const DURACAO_DE_CADA_NOTA_S = 0.22;
const INTERVALO_ENTRE_NOTAS_S = 0.16;
const VOLUME_DO_SOM = 0.18;
const VOLUME_SILENCIOSO = 0.0001;
const SUBIDA_DO_VOLUME_S = 0.02;

/* Gravadas antes da etiqueta chegam sem `tag`; o servidor as completa, e isto cobre o intervalo. */
const TAG_PADRAO_DA_NOTIFICACAO = 'padrão';

/* Classe do CSS por tag: sem acento nem maiúscula, que não valem em nome de classe. */
const CLASSES_DE_TAG_DA_NOTIFICACAO = {
  padrão: 'tag-padrao',
  OS: 'tag-os',
  atualização: 'tag-atualizacao',
};

const FORMATO_DE_DATA_E_HORA = { dateStyle: 'short', timeStyle: 'short' };

function formatarDataEHora(iso) {
  return new Date(iso).toLocaleString('pt-BR', FORMATO_DE_DATA_E_HORA);
}

/* Criado no primeiro som: o navegador pode recusar um contexto de áudio antes disso. */
let contextoDeAudio = null;

/** Sintetizado na hora com Web Audio: sem arquivo de som para empacotar. */
function tocarSomDeNotificacao() {
  try {
    contextoDeAudio ??= new AudioContext();
    void contextoDeAudio.resume();
    const inicio = contextoDeAudio.currentTime;

    NOTAS_DO_SOM_HZ.forEach((frequencia, indice) => {
      const comeco = inicio + indice * INTERVALO_ENTRE_NOTAS_S;
      const oscilador = contextoDeAudio.createOscillator();
      const volume = contextoDeAudio.createGain();

      oscilador.type = 'sine';
      oscilador.frequency.value = frequencia;
      volume.gain.setValueAtTime(VOLUME_SILENCIOSO, comeco);
      volume.gain.exponentialRampToValueAtTime(VOLUME_DO_SOM, comeco + SUBIDA_DO_VOLUME_S);
      volume.gain.exponentialRampToValueAtTime(VOLUME_SILENCIOSO, comeco + DURACAO_DE_CADA_NOTA_S);
      oscilador.connect(volume).connect(contextoDeAudio.destination);
      oscilador.start(comeco);
      oscilador.stop(comeco + DURACAO_DE_CADA_NOTA_S);
    });
  } catch (erro) {
    // Sem áudio (política do navegador, sem saída de som): a notificação aparece mesmo assim.
    console.warn('Som da notificação indisponível:', erro);
  }
}

function quantidadeDeNaoLidas() {
  return estado.notificacoes.filter((notificacao) => !notificacao.lida).length;
}

function renderizarContadorDeNotificacoes() {
  const naoLidas = quantidadeDeNaoLidas();
  elementos.contadorNotificacoes.hidden = naoLidas === 0;
  elementos.contadorNotificacoes.textContent =
    naoLidas > LIMITE_DO_CONTADOR_DE_NOTIFICACOES
      ? `${LIMITE_DO_CONTADOR_DE_NOTIFICACOES}+`
      : String(naoLidas);
  const rotulo = naoLidas === 0 ? 'Notificações' : `Notificações (${naoLidas} não lidas)`;
  elementos.botaoNotificacoes.title = rotulo;
  elementos.botaoNotificacoes.setAttribute('aria-label', rotulo);
  atualizarPiscarDoSino();
}

/* Como o botão do WhatsApp na barra do shell: pisca com não lidas, e não com o painel aberto. */
function atualizarPiscarDoSino() {
  elementos.botaoNotificacoes.classList.toggle(
    'piscando',
    quantidadeDeNaoLidas() > 0 && !painelDeNotificacoesAberto(),
  );
}

/*
 * O lembrete é quase tudo o que chega ao painel: dizer "Lembrete" seria ruído. Os
 * gravados antes do resumo têm esse título fixo, e o texto sobe para o destaque.
 */
const TITULO_DO_LEMBRETE_SEM_RESUMO = 'Lembrete';

function tituloEMensagemDaNotificacao(notificacao) {
  const semResumo =
    notificacao.origem === 'lembrete' && notificacao.titulo === TITULO_DO_LEMBRETE_SEM_RESUMO;
  return semResumo
    ? { titulo: notificacao.mensagem, mensagem: '' }
    : { titulo: notificacao.titulo, mensagem: notificacao.mensagem };
}

function criarCabecalhoDaNotificacao(notificacao) {
  const cabecalho = criarElemento('div', 'notificacao-cabecalho');
  const tag = notificacao.tag ?? TAG_PADRAO_DA_NOTIFICACAO;
  cabecalho.append(
    criarElemento(
      'span',
      `notificacao-tag ${CLASSES_DE_TAG_DA_NOTIFICACAO[tag] ?? 'tag-padrao'}`,
      tag,
    ),
  );
  cabecalho.append(
    criarElemento('time', 'notificacao-quando', formatarDataEHora(notificacao.criadaEm)),
  );
  return cabecalho;
}

function criarConteudoDaNotificacao(notificacao) {
  const conteudo = criarElemento('div', 'notificacao-conteudo');
  const { titulo, mensagem } = tituloEMensagemDaNotificacao(notificacao);
  conteudo.append(
    criarCabecalhoDaNotificacao(notificacao),
    criarElemento('strong', 'notificacao-titulo', titulo),
  );
  if (mensagem) {
    conteudo.append(criarElemento('p', 'notificacao-mensagem', mensagem));
  }
  if (notificacao.erroDoEmail) {
    const erroDoEmail = criarElemento(
      'p',
      'notificacao-erro-email',
      `O e-mail não foi enviado: ${notificacao.erroDoEmail}`,
    );
    erroDoEmail.append(' ', criarLinkDeConfiguracaoPendente('smtp'));
    conteudo.append(erroDoEmail);
  }
  return conteudo;
}

async function marcarNotificacaoComoLida(notificacao) {
  if (notificacao.lida) {
    return;
  }

  try {
    const resposta = await api.marcarNotificacoesComoLidas([notificacao.id]);
    estado.notificacoes = resposta.notificacoes;
    renderizarNotificacoes();
  } catch (erro) {
    exibirAviso(`Não foi possível marcar a notificação: ${erro.message}`, 'erro');
  }
}

function criarItemDeNotificacao(notificacao) {
  const item = criarElemento('button', `item-notificacao${notificacao.lida ? '' : ' nao-lida'}`);
  item.type = 'button';
  item.title = notificacao.lida ? '' : 'Marcar como lida';
  item.append(criarConteudoDaNotificacao(notificacao));
  item.addEventListener('click', () => marcarNotificacaoComoLida(notificacao));
  return item;
}

function renderizarNotificacoes() {
  renderizarContadorDeNotificacoes();

  if (estado.notificacoes.length === 0) {
    elementos.listaNotificacoes.replaceChildren(
      criarElemento('p', 'secao-vazia', 'Nenhuma notificação.'),
    );
    return;
  }
  elementos.listaNotificacoes.replaceChildren(...estado.notificacoes.map(criarItemDeNotificacao));
}

async function carregarNotificacoes() {
  try {
    const resposta = await api.listarNotificacoes();
    estado.notificacoes = resposta.notificacoes;
    renderizarNotificacoes();
  } catch (erro) {
    console.warn('Não foi possível carregar as notificações:', erro);
  }
}

function painelDeNotificacoesAberto() {
  return !elementos.painelNotificacoes.hidden;
}

function definirPainelDeNotificacoes(aberto) {
  elementos.painelNotificacoes.hidden = !aberto;
  elementos.botaoNotificacoes.setAttribute('aria-expanded', String(aberto));
  atualizarPiscarDoSino();
}

function receberNotificacao(notificacao) {
  if (estado.notificacoes.some((existente) => existente.id === notificacao.id)) {
    return;
  }

  /* A janela que aparece é o aviso do Windows, do shell (desktop/src/interface/avisosDoHub.ts). */
  estado.notificacoes = [notificacao, ...estado.notificacoes];
  renderizarNotificacoes();
  tocarSomDeNotificacao();

  // O disparo muda o "próximo" do lembrete: a lista aberta não pode ficar desatualizada.
  if (notificacao.origem === 'lembrete' && estado.visualizacao === 'lembretes') {
    void recarregarLembretes();
  }
  // Lembrete disparado ou evento sem OS: o Resumo aberto mostra na hora.
  if (notificacao.origem === 'lembrete' || notificacao.origem === 'agenda') {
    renderizarResumoSeVisivel();
  }
}

/**
 * O servidor empurra cada notificação nova pelo SSE. O `EventSource` reconecta sozinho
 * quando o backend reinicia; a cada conexão a lista é relida, porque o que chegou com a
 * conexão caída não passou por aqui.
 */
function conectarFluxoDeNotificacoes() {
  const fluxo = new EventSource(`${CAMINHO_DAS_NOTIFICACOES}/fluxo`);
  fluxo.addEventListener('open', () => void carregarNotificacoes());
  fluxo.addEventListener('notificacao', (evento) => {
    receberNotificacao(JSON.parse(evento.data));
  });
}

async function marcarTodasAsNotificacoesComoLidas() {
  try {
    const resposta = await api.marcarNotificacoesComoLidas();
    estado.notificacoes = resposta.notificacoes;
    renderizarNotificacoes();
  } catch (erro) {
    exibirAviso(`Não foi possível marcar as notificações: ${erro.message}`, 'erro');
  }
}

async function limparNotificacoes() {
  try {
    await api.limparNotificacoes();
    estado.notificacoes = [];
    renderizarNotificacoes();
  } catch (erro) {
    exibirAviso(`Não foi possível limpar as notificações: ${erro.message}`, 'erro');
  }
}

function registrarEventosDasNotificacoes() {
  elementos.botaoNotificacoes.prepend(criarIcone(ICONES.sino));
  elementos.botaoNotificacoes.addEventListener('click', () =>
    definirPainelDeNotificacoes(!painelDeNotificacoesAberto()),
  );
  elementos.botaoFecharNotificacoes.addEventListener('click', () =>
    definirPainelDeNotificacoes(false),
  );
  elementos.botaoMarcarNotificacoesLidas.addEventListener(
    'click',
    marcarTodasAsNotificacoesComoLidas,
  );
  elementos.botaoLimparNotificacoes.addEventListener('click', limparNotificacoes);

  /* Como a lista de atalhos: fecha com clique fora dele ou `Esc`. */
  document.addEventListener('click', (evento) => {
    const dentro =
      elementos.painelNotificacoes.contains(evento.target) ||
      elementos.botaoNotificacoes.contains(evento.target);
    if (painelDeNotificacoesAberto() && !dentro) {
      definirPainelDeNotificacoes(false);
    }
  });
  document.addEventListener('keydown', (evento) => {
    if (evento.key === 'Escape' && painelDeNotificacoesAberto()) {
      definirPainelDeNotificacoes(false);
    }
  });
  /* Clique no aviso do Windows: o shell traz o Painel e pede o sino aberto (avisosDoHub.ts). */
  window.addEventListener('hub-snk:abrir-notificacoes', () => definirPainelDeNotificacoes(true));
}

function preencherNotificacoesDaConfiguracao(smtp, alertaDaAgenda) {
  elementos.campoSmtpHost.value = smtp.host;
  elementos.campoSmtpPorta.value = smtp.porta;
  elementos.campoSmtpSeguranca.value = smtp.seguranca;
  elementos.campoSmtpUsuario.value = smtp.usuario;
  elementos.campoSmtpSenha.value = smtp.senha;
  elementos.campoSmtpRemetente.value = smtp.remetente;
  elementos.campoSmtpDestinatario.value = smtp.destinatario;
  elementos.campoAlertaAgendaAtivo.checked = alertaDaAgenda.ativo;
  elementos.campoAlertaAgendaIntervalo.value = alertaDaAgenda.intervaloMinutos;
  elementos.campoAlertaAgendaProximoDiaUtil.checked = alertaDaAgenda.incluirProximoDiaUtil;
  elementos.campoAlertaAgendaRepetir.checked = alertaDaAgenda.repetirAteResolver;
  elementos.campoAlertaAgendaEmail.checked = alertaDaAgenda.enviarEmail;
}

function lerSmtpDaConfiguracao() {
  return {
    host: elementos.campoSmtpHost.value.trim(),
    porta: Number(elementos.campoSmtpPorta.value),
    seguranca: elementos.campoSmtpSeguranca.value,
    usuario: elementos.campoSmtpUsuario.value.trim(),
    senha: elementos.campoSmtpSenha.value,
    remetente: elementos.campoSmtpRemetente.value.trim(),
    destinatario: elementos.campoSmtpDestinatario.value.trim(),
  };
}

function lerAlertaDaAgendaDaConfiguracao() {
  return {
    ativo: elementos.campoAlertaAgendaAtivo.checked,
    intervaloMinutos: Number(elementos.campoAlertaAgendaIntervalo.value),
    incluirProximoDiaUtil: elementos.campoAlertaAgendaProximoDiaUtil.checked,
    repetirAteResolver: elementos.campoAlertaAgendaRepetir.checked,
    enviarEmail: elementos.campoAlertaAgendaEmail.checked,
  };
}

/** `null` esconde; senão mostra a mensagem na própria aba, verde ou vermelha. */
function exibirResultadoDoTesteDoSmtp(resultado) {
  const elemento = elementos.resultadoTesteSmtp;
  elemento.hidden = resultado === null;
  elemento.textContent = resultado?.mensagem ?? '';
  elemento.classList.toggle('sucesso', resultado?.sucesso === true);
  elemento.classList.toggle('erro', resultado?.sucesso === false);
}

/*
 * Testa o que está no formulário, antes de salvar. O resultado fica na aba, e não num
 * aviso: o erro do SMTP é longo e precisa ficar na tela enquanto o usuário corrige o campo.
 */
async function testarSmtp() {
  exibirResultadoDoTesteDoSmtp({ sucesso: null, mensagem: 'Enviando o e-mail de teste…' });
  elementos.botaoTestarSmtp.disabled = true;
  try {
    const resposta = await api.enviarEmailDeTeste(lerSmtpDaConfiguracao());
    exibirResultadoDoTesteDoSmtp({ sucesso: true, mensagem: resposta.mensagem });
  } catch (erro) {
    exibirResultadoDoTesteDoSmtp({ sucesso: false, mensagem: erro.message });
  } finally {
    elementos.botaoTestarSmtp.disabled = false;
  }
}

/* -------------------------------- lembretes ------------------------------- */

const ESPERA_DA_PREVIA_DO_CRON_MS = 300;
const MILISSEGUNDOS_POR_MINUTO = 60_000;
const TAMANHO_DE_DATA_E_HORA_LOCAL = 16;
const SEM_CLIENTE = '';

/* Última prévia pedida: a resposta de uma digitação antiga não sobrescreve a atual. */
let temporizadorDaPreviaDoCron = null;
let ultimaExpressaoPrevista = '';

/** ISO 8601 -> `YYYY-MM-DDTHH:mm` local, o formato do `datetime-local`. */
function paraDataHoraLocal(iso) {
  const data = new Date(iso);
  const local = new Date(data.getTime() - data.getTimezoneOffset() * MILISSEGUNDOS_POR_MINUTO);
  return local.toISOString().slice(0, TAMANHO_DE_DATA_E_HORA_LOCAL);
}

/* Sugestão para o lembrete novo: a próxima hora cheia. */
function proximaHoraCheia() {
  const data = new Date();
  data.setHours(data.getHours() + 1, 0, 0, 0);
  return data.toISOString();
}

function tipoDoLembreteEscolhido() {
  return [...elementos.opcoesTipoLembrete].find((opcao) => opcao.checked)?.value ?? 'unico';
}

function resumoDoLembrete(lembrete) {
  return lembrete.resumo || lembrete.texto;
}

function clienteDoLembrete(lembrete) {
  return estado.clientes.find((cliente) => cliente.id === lembrete.clienteId) ?? null;
}

function descreverVinculoDoLembrete(lembrete) {
  const cliente = clienteDoLembrete(lembrete);
  if (!cliente) {
    return '';
  }
  const projeto = cliente.projetos.find((item) => item.id === lembrete.projetoId);
  return projeto ? `${cliente.nome} › ${projeto.nome}` : cliente.nome;
}

function descreverQuandoDoLembrete(lembrete) {
  if (lembrete.tipo === 'unico') {
    return `Uma vez, em ${formatarDataEHora(lembrete.dataHora)}`;
  }
  return `Recorrente: ${lembrete.expressaoCron}`;
}

function descreverSituacaoDoLembrete(lembrete) {
  if (!lembrete.ativo) {
    return 'Desligado';
  }
  if (lembrete.proximoDisparo) {
    return `Próximo: ${formatarDataEHora(lembrete.proximoDisparo)}`;
  }
  if (lembrete.ultimoDisparoEm) {
    return `Disparado em ${formatarDataEHora(lembrete.ultimoDisparoEm)}`;
  }
  return 'Sem próxima ocorrência';
}

/* Os que vão disparar primeiro no topo; desligados e concluídos no fim. */
function lembretesOrdenados(lembretes) {
  const momento = (lembrete) =>
    lembrete.proximoDisparo ? Date.parse(lembrete.proximoDisparo) : Number.POSITIVE_INFINITY;
  return [...lembretes].sort((a, b) => momento(a) - momento(b));
}

function criarLinhaDeLembrete(lembrete) {
  const linha = criarElemento('div', `linha-recurso${lembrete.ativo ? '' : ' lembrete-desligado'}`);
  const info = criarElemento('div', 'recurso-info');
  // Lembrete de antes do resumo não tem um: o texto fica no lugar dele.
  info.append(criarElemento('span', 'recurso-nome lembrete-texto', resumoDoLembrete(lembrete)));
  if (lembrete.resumo) {
    info.append(criarElemento('span', 'recurso-url secundaria lembrete-texto', lembrete.texto));
  }
  info.append(
    criarElemento('span', 'recurso-url secundaria', descreverQuandoDoLembrete(lembrete)),
    criarElemento('span', 'recurso-url', descreverSituacaoDoLembrete(lembrete)),
  );

  const vinculo = descreverVinculoDoLembrete(lembrete);
  if (vinculo) {
    info.append(criarElemento('span', 'recurso-url secundaria', vinculo));
  }
  if (lembrete.enviarEmail) {
    info.append(criarElemento('span', 'selo-tipo outro', 'E-mail'));
  }

  linha.append(
    info,
    criarAcoesDeRecurso({
      rotuloDeEdicao: 'Editar lembrete',
      aoEditar: () => abrirModalDeLembrete(lembrete),
      rotuloDeExclusao: 'Excluir lembrete',
      aoExcluir: () => pedirExclusaoDeLembrete(lembrete),
    }),
  );
  return linha;
}

function renderizarLembretes() {
  elementos.mountLembretes.replaceChildren(
    criarSecaoDeRecursos({
      titulo: 'Cadastrados',
      rotuloDoBotao: 'Novo lembrete',
      aoAdicionar: () => abrirModalDeLembrete(null),
      linhas: lembretesOrdenados(estado.lembretes).map(criarLinhaDeLembrete),
      mensagemVazia: 'Nenhum lembrete cadastrado.',
    }),
  );
}

async function recarregarLembretes() {
  try {
    const resposta = await api.listarLembretes();
    estado.lembretes = resposta.lembretes;
    renderizarLembretes();
  } catch (erro) {
    exibirAviso(`Não foi possível carregar os lembretes: ${erro.message}`, 'erro');
  }
}

function criarOpcao(valor, texto) {
  const opcao = criarElemento('option', null, texto);
  opcao.value = valor;
  return opcao;
}

function preencherClientesDoLembrete(clienteId) {
  const clientes = [...estado.clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  elementos.campoClienteLembrete.replaceChildren(
    criarOpcao(SEM_CLIENTE, 'Nenhum'),
    ...clientes.map((cliente) => criarOpcao(cliente.id, cliente.nome)),
  );
  elementos.campoClienteLembrete.value = clienteId ?? SEM_CLIENTE;
}

/* O projeto depende do cliente: sem cliente, ou cliente sem projeto, o campo fica travado. */
function preencherProjetosDoLembrete(projetoId) {
  const cliente = estado.clientes.find((item) => item.id === elementos.campoClienteLembrete.value);
  const projetos = cliente?.projetos ?? [];
  elementos.campoProjetoLembrete.replaceChildren(
    criarOpcao(SEM_CLIENTE, 'Nenhum'),
    ...projetos.map((projeto) => criarOpcao(projeto.id, projeto.nome)),
  );
  elementos.campoProjetoLembrete.disabled = projetos.length === 0;
  elementos.campoProjetoLembrete.value = projetos.some((projeto) => projeto.id === projetoId)
    ? projetoId
    : SEM_CLIENTE;
}

function aplicarTipoDoLembrete() {
  const recorrente = tipoDoLembreteEscolhido() === 'recorrente';
  elementos.grupoDataHoraLembrete.hidden = recorrente;
  elementos.grupoRecorrenciaLembrete.hidden = !recorrente;
  if (recorrente) {
    agendarPreviaDoCron();
  }
}

async function atualizarPreviaDoCron() {
  const expressao = elementos.campoExpressaoCron.value.trim();
  ultimaExpressaoPrevista = expressao;
  elementos.previaCron.classList.remove('erro-formulario');
  if (!expressao) {
    elementos.previaCron.textContent = '';
    return;
  }

  try {
    const { ocorrencias } = await api.previaDoCron(expressao);
    if (expressao !== ultimaExpressaoPrevista) return;
    elementos.previaCron.textContent = `Próximas: ${ocorrencias.map(formatarDataEHora).join(' · ')}`;
  } catch (erro) {
    if (expressao !== ultimaExpressaoPrevista) return;
    elementos.previaCron.classList.add('erro-formulario');
    elementos.previaCron.textContent = erro.message;
  }
}

function agendarPreviaDoCron() {
  clearTimeout(temporizadorDaPreviaDoCron);
  temporizadorDaPreviaDoCron = setTimeout(atualizarPreviaDoCron, ESPERA_DA_PREVIA_DO_CRON_MS);
}

function abrirModalDeLembrete(lembrete) {
  estado.lembreteEmEdicao = lembrete;
  limparErro(elementos.erroLembrete);
  elementos.tituloModalLembrete.textContent = lembrete ? 'Editar lembrete' : 'Novo lembrete';

  const tipo = lembrete?.tipo ?? 'unico';
  for (const opcao of elementos.opcoesTipoLembrete) {
    opcao.checked = opcao.value === tipo;
  }
  elementos.campoResumoLembrete.value = lembrete?.resumo ?? '';
  elementos.campoTextoLembrete.value = lembrete?.texto ?? '';
  elementos.campoDataHoraLembrete.value = paraDataHoraLocal(
    lembrete?.dataHora || proximaHoraCheia(),
  );
  elementos.campoModeloRecorrencia.value = '';
  elementos.campoExpressaoCron.value = lembrete?.expressaoCron ?? '';
  elementos.previaCron.textContent = '';
  elementos.campoEmailLembrete.checked = lembrete?.enviarEmail ?? false;
  elementos.campoAtivoLembrete.checked = lembrete?.ativo ?? true;
  preencherClientesDoLembrete(lembrete?.clienteId ?? null);
  preencherProjetosDoLembrete(lembrete?.projetoId ?? null);
  aplicarTipoDoLembrete();
  // Contato excluído depois do cadastro do lembrete some da lista em vez de travar o salvar.
  estado.contatosDoLembrete = (lembrete?.contatoIds ?? []).filter((id) =>
    estado.contatos.some((contato) => contato.id === id),
  );
  aplicarEnvioPorEmailDoLembrete();

  elementos.modalLembrete.showModal();
  elementos.campoResumoLembrete.focus();
  // A lista pode ter mudado noutro lugar desde a última leitura.
  void carregarContatos().then(() => {
    if (elementos.modalLembrete.open) renderizarContatosDoLembrete();
  });
}

function lerFormularioDeLembrete() {
  const tipo = tipoDoLembreteEscolhido();
  const dataHoraLocal = elementos.campoDataHoraLembrete.value;
  const clienteId = elementos.campoClienteLembrete.value || null;
  const enviarEmail = elementos.campoEmailLembrete.checked;
  return {
    resumo: elementos.campoResumoLembrete.value.trim(),
    texto: elementos.campoTextoLembrete.value.trim(),
    tipo,
    dataHora: tipo === 'unico' && dataHoraLocal ? new Date(dataHoraLocal).toISOString() : '',
    expressaoCron: tipo === 'recorrente' ? elementos.campoExpressaoCron.value.trim() : '',
    clienteId,
    projetoId: clienteId ? elementos.campoProjetoLembrete.value || null : null,
    enviarEmail,
    contatoIds: enviarEmail ? [...estado.contatosDoLembrete] : [],
    ativo: elementos.campoAtivoLembrete.checked,
  };
}

function validarFormularioDeLembrete(dados) {
  if (!dados.resumo) return 'Informe o resumo do lembrete.';
  if (!dados.texto) return 'Informe o texto do lembrete.';
  if (dados.tipo === 'unico' && !dados.dataHora) return 'Informe a data e a hora do lembrete.';
  if (dados.tipo === 'recorrente' && !dados.expressaoCron) {
    return 'Informe a expressão da recorrência ou escolha um modelo.';
  }
  return null;
}

async function salvarLembrete(evento) {
  evento.preventDefault();

  const dados = lerFormularioDeLembrete();
  const mensagemDeErro = validarFormularioDeLembrete(dados);
  if (mensagemDeErro) {
    exibirErro(elementos.erroLembrete, mensagemDeErro);
    return;
  }

  limparErro(elementos.erroLembrete);
  elementos.botaoSalvarLembrete.disabled = true;
  try {
    const emEdicao = estado.lembreteEmEdicao;
    if (emEdicao) {
      await api.atualizarLembrete(emEdicao.id, dados);
    } else {
      await api.criarLembrete(dados);
    }
    elementos.modalLembrete.close();
    exibirAviso(emEdicao ? 'Lembrete atualizado.' : 'Lembrete cadastrado.');
    await recarregarLembretes();
  } catch (erro) {
    exibirErro(elementos.erroLembrete, erro.message);
  } finally {
    elementos.botaoSalvarLembrete.disabled = false;
  }
}

function pedirExclusaoDeLembrete(lembrete) {
  pedirExclusao(
    'Excluir lembrete',
    `Excluir o lembrete "${resumoDoLembrete(lembrete)}"? Esta ação não pode ser desfeita.`,
    () => api.removerLembrete(lembrete.id),
    'Lembrete excluído.',
    recarregarLembretes,
  );
}

function registrarEventosDoLembrete() {
  elementos.formularioLembrete.addEventListener('submit', salvarLembrete);
  elementos.botaoCancelarLembrete.addEventListener('click', () => elementos.modalLembrete.close());
  for (const opcao of elementos.opcoesTipoLembrete) {
    opcao.addEventListener('change', aplicarTipoDoLembrete);
  }
  elementos.campoModeloRecorrencia.addEventListener('change', () => {
    if (!elementos.campoModeloRecorrencia.value) return;
    elementos.campoExpressaoCron.value = elementos.campoModeloRecorrencia.value;
    agendarPreviaDoCron();
  });
  elementos.campoExpressaoCron.addEventListener('input', () => {
    elementos.campoModeloRecorrencia.value = '';
    agendarPreviaDoCron();
  });
  elementos.campoClienteLembrete.addEventListener('change', () => {
    preencherProjetosDoLembrete(null);
    descartarContatosIncompativeisDoLembrete();
  });
  elementos.campoEmailLembrete.addEventListener('change', aplicarEnvioPorEmailDoLembrete);
  elementos.botaoAdicionarContatoLembrete.addEventListener('click', () =>
    definirOpcoesDeContatosDoLembrete(elementos.opcoesContatosLembrete.hidden),
  );
  // Clique fora da lista a fecha, como um menu.
  elementos.modalLembrete.addEventListener('click', (evento) => {
    if (!evento.target.closest('.seletor-de-contatos')) definirOpcoesDeContatosDoLembrete(false);
  });
}

/* Com cliente no lembrete, só os contatos sem cliente e os desse cliente; e só com e-mail. */
function contatoPodeIrNoLembrete(contato, clienteId) {
  if (!contato.email) {
    return false;
  }
  if (!clienteId) {
    return true;
  }
  const cliente = clienteDoContato(contato);
  return cliente === null || cliente.id === clienteId;
}

function contatosDisponiveisParaOLembrete() {
  const clienteId = elementos.campoClienteLembrete.value;
  return contatosOrdenados(
    estado.contatos.filter(
      (contato) =>
        !estado.contatosDoLembrete.includes(contato.id) &&
        contatoPodeIrNoLembrete(contato, clienteId),
    ),
  );
}

/* Sem e-mail não há a quem copiar: os contatos somem junto com a caixa. */
function aplicarEnvioPorEmailDoLembrete() {
  const enviaEmail = elementos.campoEmailLembrete.checked;
  elementos.grupoContatosLembrete.hidden = !enviaEmail;
  void avisarSmtpPendenteDoLembrete(enviaEmail);
  if (!enviaEmail) {
    estado.contatosDoLembrete = [];
  }
  definirOpcoesDeContatosDoLembrete(false);
  renderizarContatosDoLembrete();
}

/* Trocar o cliente tira da cópia quem é de outro cliente. */
function descartarContatosIncompativeisDoLembrete() {
  const clienteId = elementos.campoClienteLembrete.value;
  estado.contatosDoLembrete = estado.contatosDoLembrete.filter((id) => {
    const contato = estado.contatos.find((item) => item.id === id);
    return contato && contatoPodeIrNoLembrete(contato, clienteId);
  });
  definirOpcoesDeContatosDoLembrete(false);
  renderizarContatosDoLembrete();
}

function criarContatoEscolhidoDoLembrete(contato) {
  const item = criarElemento('div', 'contato-do-lembrete');
  const remover = criarBotao('btn tiny ghost', '✕', () => {
    estado.contatosDoLembrete = estado.contatosDoLembrete.filter((id) => id !== contato.id);
    renderizarContatosDoLembrete();
  });
  remover.setAttribute('aria-label', `Tirar ${contato.nome} da cópia`);
  remover.title = 'Tirar da cópia';
  item.append(
    criarElemento('span', 'contato-do-lembrete-nome', contato.nome),
    criarElemento('span', 'contato-do-lembrete-email', contato.email),
    remover,
  );
  return item;
}

function renderizarContatosDoLembrete() {
  const escolhidos = estado.contatosDoLembrete
    .map((id) => estado.contatos.find((contato) => contato.id === id))
    .filter(Boolean);
  elementos.listaContatosLembrete.replaceChildren(
    ...(escolhidos.length > 0
      ? escolhidos.map(criarContatoEscolhidoDoLembrete)
      : [criarElemento('p', 'texto-auxiliar', 'Nenhum contato em cópia.')]),
  );
}

function criarOpcaoDeContatoDoLembrete(contato) {
  const opcao = criarBotao('opcao-de-contato', '', () => {
    estado.contatosDoLembrete = [...estado.contatosDoLembrete, contato.id];
    definirOpcoesDeContatosDoLembrete(false);
    renderizarContatosDoLembrete();
  });
  const cliente = clienteDoContato(contato);
  opcao.append(
    criarElemento('span', 'opcao-de-contato-nome', contato.nome),
    criarElemento(
      'span',
      'opcao-de-contato-detalhe',
      cliente ? `${contato.email} · ${cliente.nome}` : contato.email,
    ),
  );
  return opcao;
}

/* Sem contato disponível a lista não fica vazia: sempre dá para cadastrar um ali mesmo. */
function definirOpcoesDeContatosDoLembrete(aberta) {
  elementos.opcoesContatosLembrete.hidden = !aberta;
  if (!aberta) {
    return;
  }

  const disponiveis = contatosDisponiveisParaOLembrete();
  const novo = criarBotao('btn tiny ghost opcao-de-contato-novo', 'Cadastrar contato novo', () => {
    definirOpcoesDeContatosDoLembrete(false);
    abrirModalDeContato(null, null, { paraOLembrete: true });
  });
  elementos.opcoesContatosLembrete.replaceChildren(
    ...(disponiveis.length > 0
      ? disponiveis.map(criarOpcaoDeContatoDoLembrete)
      : [criarElemento('p', 'texto-auxiliar', 'Nenhum contato com e-mail disponível.')]),
    novo,
  );
}

/* Nasce com o cliente do lembrete, ou sem cliente: sempre cabe na cópia. */
function incluirContatoNovoNoLembrete(contato) {
  estado.contatosDoLembrete = [...estado.contatosDoLembrete, contato.id];
  renderizarContatosDoLembrete();
}

/* -------------------------------- contatos -------------------------------- */

/* Valor do filtro de cliente que separa os contatos sem cliente; nunca é um id. */
const FILTRO_SEM_CLIENTE = '__sem-cliente__';

/* Cliente excluído fora do HUB SNK (pasta sincronizada) vale como sem cliente. */
function clienteDoContato(contato) {
  return estado.clientes.find((cliente) => cliente.id === contato.clienteId) ?? null;
}

function contatosOrdenados(contatos) {
  return [...contatos].sort((um, outro) => um.nome.localeCompare(outro.nome, 'pt-BR'));
}

function chaveDeBuscaDoContato(texto) {
  return semAcentos(texto).toLocaleLowerCase('pt-BR');
}

/** Lê do servidor sem redesenhar: quem chama decide o que atualizar. */
async function carregarContatos() {
  try {
    const resposta = await api.listarContatos();
    estado.contatos = resposta.contatos;
  } catch (erro) {
    exibirAviso(`Não foi possível carregar os contatos: ${erro.message}`, 'erro');
  }
}

async function recarregarContatos() {
  await carregarContatos();
  renderizarContatos();
}

/* Qualquer mudança de contato aparece nas duas abas: a do menu e a do cliente aberto. */
async function recarregarContatosNasTelas() {
  await recarregarContatos();
  renderizarDetalhe();
}

function contatoPassaNoFiltro(contato) {
  const { nome, clienteId } = estado.filtroDeContatos;
  if (nome && !chaveDeBuscaDoContato(contato.nome).includes(chaveDeBuscaDoContato(nome))) {
    return false;
  }
  if (clienteId === FILTRO_SEM_CLIENTE) {
    return clienteDoContato(contato) === null;
  }
  return !clienteId || clienteDoContato(contato)?.id === clienteId;
}

/**
 * `null` sem ao menos DDD e número: ramal ou texto solto não abre conversa. Com `+`, o
 * código do país já veio escrito; com 10 ou 11 dígitos, é um número brasileiro sem ele.
 */
function numeroParaWhatsApp(telefone) {
  const digitos = telefone.replace(/\D/g, '').replace(/^0+/, '');
  if (digitos.length < MENOR_TELEFONE_COM_DDD) return null;
  if (telefone.trim().startsWith('+')) return digitos;
  return DIGITOS_DO_TELEFONE_NACIONAL.has(digitos.length)
    ? `${CODIGO_DO_BRASIL}${digitos}`
    : digitos;
}

function criarLinhaDeContato(contato, { mostrarCliente }) {
  const info = criarElemento('div', 'recurso-info');
  info.append(criarElemento('span', 'recurso-nome', contato.nome));

  const cliente = mostrarCliente ? clienteDoContato(contato) : null;
  const detalhes = [contato.cargo, cliente?.nome].filter(Boolean).join(' · ');
  if (detalhes) {
    info.append(criarElemento('span', 'recurso-url secundaria', detalhes));
  }
  const meios = [contato.telefone, contato.email].filter(Boolean).join(' · ');
  if (meios) {
    info.append(criarElemento('span', 'recurso-url', meios));
  }

  const conversa = [];
  const numero = numeroParaWhatsApp(contato.telefone);
  if (numero) {
    const endereco = `${ENDERECO_DE_CONVERSA_DO_WHATSAPP}?phone=${numero}`;
    conversa.push(criarLinkDeIcone('btn tiny', ICONES.conversa, 'Conversar no WhatsApp', endereco));
  }
  if (contato.email) {
    const endereco = `${ENDERECO_DE_EMAIL_NOVO_DO_GMAIL}&to=${encodeURIComponent(contato.email)}`;
    conversa.push(criarLinkDeIcone('btn tiny', ICONES.envelope, 'Escrever e-mail', endereco));
  }

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(
    info,
    criarAcoesDeRecurso({
      rotuloDeEdicao: 'Editar contato',
      aoEditar: () => abrirModalDeContato(contato, mostrarCliente ? null : cliente),
      rotuloDeExclusao: 'Excluir contato',
      aoExcluir: () => pedirExclusaoDeContato(contato),
      extras: conversa,
    }),
  );
  return linha;
}

/* Mantém a escolha feita, a não ser que o cliente dela tenha deixado de existir. */
function preencherFiltroDeClienteDosContatos() {
  const campo = elementos.campoFiltroClienteContato;
  const clientes = [...estado.clientes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  campo.replaceChildren(
    criarOpcao('', 'Todos os clientes'),
    criarOpcao(FILTRO_SEM_CLIENTE, 'Sem cliente'),
    ...clientes.map((cliente) => criarOpcao(cliente.id, cliente.nome)),
  );
  const escolhido = estado.filtroDeContatos.clienteId;
  const aindaExiste =
    escolhido === FILTRO_SEM_CLIENTE || clientes.some((cliente) => cliente.id === escolhido);
  estado.filtroDeContatos.clienteId = aindaExiste ? escolhido : '';
  campo.value = estado.filtroDeContatos.clienteId;
}

function renderizarContatos() {
  preencherFiltroDeClienteDosContatos();
  const filtrados = contatosOrdenados(estado.contatos.filter(contatoPassaNoFiltro));
  elementos.mountContatos.replaceChildren(
    criarSecaoDeRecursos({
      titulo: 'Cadastrados',
      rotuloDoBotao: 'Novo contato',
      aoAdicionar: () => abrirModalDeContato(null, null),
      linhas: filtrados.map((contato) => criarLinhaDeContato(contato, { mostrarCliente: true })),
      mensagemVazia:
        estado.contatos.length === 0
          ? 'Nenhum contato cadastrado.'
          : 'Nenhum contato com estes filtros.',
    }),
  );
}

/** Aba Contatos do cliente: sem filtro, e o contato novo já nasce dele. */
function criarSecaoDeContatosDoCliente(cliente) {
  const doCliente = estado.contatos.filter((contato) => contato.clienteId === cliente.id);
  return criarSecaoDeRecursos({
    titulo: null,
    rotuloDoBotao: 'Novo contato',
    aoAdicionar: () => abrirModalDeContato(null, cliente),
    linhas: contatosOrdenados(doCliente).map((contato) =>
      criarLinhaDeContato(contato, { mostrarCliente: false }),
    ),
    mensagemVazia: 'Nenhum contato vinculado a este cliente.',
  });
}

/** `clientesPermitidos`: os que o campo oferece além de "Sem cliente"; padrão, todos. */
function preencherClientesDoContato(clienteId, clientesPermitidos = estado.clientes) {
  const clientes = [...clientesPermitidos].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  elementos.campoClienteContato.replaceChildren(
    criarOpcao(SEM_CLIENTE, 'Sem cliente'),
    ...clientes.map((cliente) => criarOpcao(cliente.id, cliente.nome)),
  );
  elementos.campoClienteContato.value = clientes.some((cliente) => cliente.id === clienteId)
    ? clienteId
    : SEM_CLIENTE;
}

/**
 * `clienteFixo`: aberto pela aba do cliente, o campo Cliente some e vale esse cliente.
 * `paraOLembrete`: aberto pelo modal do lembrete, o e-mail passa a ser exigido e o campo
 * segue a regra da cópia do lembrete (`contatoPodeIrNoLembrete`): lembrete do cliente Y
 * oferece só "Sem cliente" e Y, já marcado; lembrete sem cliente oferece todos.
 */
function abrirModalDeContato(contato, clienteFixo, { paraOLembrete = false } = {}) {
  const clienteDoLembrete = paraOLembrete
    ? (estado.clientes.find((cliente) => cliente.id === elementos.campoClienteLembrete.value) ??
      null)
    : null;
  estado.contatoEmEdicao = contato;
  estado.clienteFixoDoContato = clienteFixo;
  estado.contatoParaOLembrete = paraOLembrete;
  limparErro(elementos.erroContato);
  elementos.tituloModalContato.textContent = contato ? 'Editar contato' : 'Novo contato';
  elementos.campoNomeContato.value = contato?.nome ?? '';
  elementos.campoCargoContato.value = contato?.cargo ?? '';
  elementos.campoTelefoneContato.value = contato?.telefone ?? '';
  elementos.campoEmailContato.value = contato?.email ?? '';
  elementos.opcionalEmailContato.hidden = paraOLembrete;
  elementos.grupoClienteContato.hidden = clienteFixo !== null;
  preencherClientesDoContato(
    clienteFixo?.id ?? clienteDoLembrete?.id ?? contato?.clienteId ?? null,
    clienteDoLembrete ? [clienteDoLembrete] : estado.clientes,
  );

  elementos.modalContato.showModal();
  elementos.campoNomeContato.focus();
}

/* O campo Cliente só vale quando está na tela; escondido, manda o cliente fixado. */
function clienteDoFormularioDeContato() {
  if (!elementos.grupoClienteContato.hidden) {
    return elementos.campoClienteContato.value || null;
  }
  return estado.clienteFixoDoContato?.id ?? null;
}

function lerFormularioDeContato() {
  return {
    nome: elementos.campoNomeContato.value.trim(),
    cargo: elementos.campoCargoContato.value.trim(),
    telefone: elementos.campoTelefoneContato.value.trim(),
    email: elementos.campoEmailContato.value.trim(),
    clienteId: clienteDoFormularioDeContato(),
  };
}

function validarFormularioDeContato(dados) {
  if (!dados.nome) return 'Informe o nome do contato.';
  if (!dados.email && estado.contatoParaOLembrete) {
    return 'Informe o e-mail: é por ele que o contato recebe o lembrete.';
  }
  if (dados.email && !elementos.campoEmailContato.checkValidity()) return 'E-mail inválido.';
  return null;
}

async function salvarContato(evento) {
  evento.preventDefault();

  const dados = lerFormularioDeContato();
  const mensagemDeErro = validarFormularioDeContato(dados);
  if (mensagemDeErro) {
    exibirErro(elementos.erroContato, mensagemDeErro);
    return;
  }

  limparErro(elementos.erroContato);
  elementos.botaoSalvarContato.disabled = true;
  try {
    const emEdicao = estado.contatoEmEdicao;
    const salvo = emEdicao
      ? await api.atualizarContato(emEdicao.id, dados)
      : await api.criarContato(dados);
    elementos.modalContato.close();
    exibirAviso(emEdicao ? 'Contato atualizado.' : 'Contato cadastrado.');
    await recarregarContatosNasTelas();
    if (estado.contatoParaOLembrete && elementos.modalLembrete.open) {
      incluirContatoNovoNoLembrete(salvo);
    }
  } catch (erro) {
    exibirErro(elementos.erroContato, erro.message);
  } finally {
    elementos.botaoSalvarContato.disabled = false;
  }
}

function pedirExclusaoDeContato(contato) {
  pedirExclusao(
    'Excluir contato',
    `Excluir o contato "${contato.nome}"? Os lembretes deixam de copiá-lo. Esta ação não pode ser desfeita.`,
    () => api.removerContato(contato.id),
    'Contato excluído.',
    recarregarContatosNasTelas,
  );
}

function registrarEventosDosContatos() {
  elementos.formularioContato.addEventListener('submit', salvarContato);
  elementos.botaoCancelarContato.addEventListener('click', () => elementos.modalContato.close());
  elementos.campoFiltroNomeContato.addEventListener('input', () => {
    estado.filtroDeContatos.nome = elementos.campoFiltroNomeContato.value.trim();
    renderizarContatos();
  });
  elementos.campoFiltroClienteContato.addEventListener('change', () => {
    estado.filtroDeContatos.clienteId = elementos.campoFiltroClienteContato.value;
    renderizarContatos();
  });
}

/* ------------------------------ busca rápida ------------------------------ */

const CHAVE_DOS_RECENTES_DA_BUSCA = 'hub-snk:busca-rapida:recentes';

function lerRecentesDaBusca() {
  try {
    const salvos = JSON.parse(localStorage.getItem(CHAVE_DOS_RECENTES_DA_BUSCA) ?? '[]');
    return Array.isArray(salvos) ? salvos.filter((chave) => typeof chave === 'string') : [];
  } catch (erro) {
    // Sem o armazenamento do navegador, a busca só perde o histórico.
    console.warn('Histórico da busca rápida ilegível:', erro);
    return [];
  }
}

function gravarUsoNaBusca(chave) {
  try {
    const recentes = registrarUsoRecente(lerRecentesDaBusca(), chave);
    localStorage.setItem(CHAVE_DOS_RECENTES_DA_BUSCA, JSON.stringify(recentes));
  } catch (erro) {
    console.warn('Não foi possível gravar o histórico da busca rápida:', erro);
  }
}

function montarItensDaBuscaRapida() {
  return montarItensDaBusca({
    clientes: estado.clientes,
    contatos: estado.contatos,
    atalhos: estado.atalhos,
    basesLocais: estado.basesLocais,
    visivel: funcionalidadeVisivel,
    rotulosDeTipoDeBase: ROTULOS_DE_TIPO_DE_BASE,
    nomeDoRepositorio: nomeDeExibicaoDoRepositorio,
  });
}

/*
 * As bases locais só são lidas quando a visão Local abre. Sem isto, a busca não
 * as acharia antes da primeira visita a ela.
 */
async function carregarBasesLocaisParaABusca() {
  if (!funcionalidadeVisivel('local') || estado.basesLocais.length > 0) {
    return;
  }

  try {
    estado.basesLocais = await api.listarBasesLocais();
  } catch (erro) {
    console.warn('Bases locais fora da busca rápida:', erro);
    return;
  }

  if (elementos.modalBuscaRapida.open) {
    estado.buscaRapida.itens = montarItensDaBuscaRapida();
    atualizarResultadosDaBuscaRapida();
  }
}

function abrirBuscaRapida() {
  estado.buscaRapida.itens = montarItensDaBuscaRapida();

  if (!elementos.modalBuscaRapida.open) {
    if (listaDeAtalhosEstaAberta()) {
      fecharListaDeAtalhos();
    }
    elementos.campoBuscaRapida.value = '';
    elementos.modalBuscaRapida.showModal();
  }

  atualizarResultadosDaBuscaRapida();
  elementos.campoBuscaRapida.focus();
  elementos.campoBuscaRapida.select();
  void carregarBasesLocaisParaABusca();
}

function atualizarResultadosDaBuscaRapida() {
  const busca = estado.buscaRapida;
  busca.resultados = buscarItens(
    busca.itens,
    elementos.campoBuscaRapida.value,
    lerRecentesDaBusca(),
  );
  busca.indiceSelecionado = 0;
  renderizarResultadosDaBuscaRapida();
}

function criarAcoesDoRepositorioNaBusca({ cliente, repositorio }) {
  const acao = (executar) => (evento) => {
    evento.stopPropagation();
    elementos.modalBuscaRapida.close();
    executar().catch((erro) => exibirAviso(erro.message, 'erro'));
  };

  const acoes = criarElemento('span', 'busca-rapida-acoes');
  acoes.append(
    criarBotaoDeIcone(
      'btn tiny',
      ICONES.pasta,
      'Abrir a pasta',
      acao(() => api.abrirPastaDoRepositorio(cliente.id, repositorio.id)),
    ),
    criarBotaoDeIcone(
      'btn tiny',
      ICONES.terminal,
      'Abrir o terminal',
      acao(() => api.abrirShellDoRepositorio(cliente.id, repositorio.id)),
    ),
    criarBotaoDeIcone(
      'btn tiny',
      ICONES.ide,
      'Abrir a IDE',
      acao(() => api.abrirIdeDoRepositorio(cliente.id, repositorio.id)),
    ),
  );
  return acoes;
}

function criarLinhaDaBuscaRapida(item, indice, selecionado) {
  const classe = selecionado ? 'busca-rapida-item selecionado' : 'busca-rapida-item';
  const linha = criarElemento('li', classe);
  linha.id = `busca-rapida-item-${indice}`;
  linha.setAttribute('role', 'option');
  linha.setAttribute('aria-selected', String(selecionado));

  const texto = criarElemento('span', 'busca-rapida-texto');
  texto.append(criarElemento('span', 'busca-rapida-titulo', item.titulo));
  if (item.detalhe) {
    texto.append(criarElemento('span', 'busca-rapida-detalhe', item.detalhe));
  }

  linha.append(criarElemento('span', 'busca-rapida-tipo', ROTULOS_DOS_TIPOS[item.tipo]), texto);
  if (item.tipo === 'repositorio' && item.dados.repositorio.caminhoLocal) {
    linha.append(criarAcoesDoRepositorioNaBusca(item.dados));
  }

  linha.addEventListener('click', (evento) =>
    executarItemDaBuscaRapida(item, { abrirCliente: evento.ctrlKey }),
  );
  return linha;
}

function mensagemDaBuscaRapidaSemResultado() {
  return elementos.campoBuscaRapida.value.trim()
    ? 'Nada encontrado.'
    : 'Digite para buscar. O que você abrir por aqui passa a aparecer nesta lista.';
}

function renderizarResultadosDaBuscaRapida() {
  const { resultados, indiceSelecionado } = estado.buscaRapida;
  const lista = elementos.listaBuscaRapida;

  lista.replaceChildren(
    ...resultados.map((item, indice) =>
      criarLinhaDaBuscaRapida(item, indice, indice === indiceSelecionado),
    ),
  );

  if (resultados.length === 0) {
    lista.append(criarElemento('li', 'busca-rapida-vazia', mensagemDaBuscaRapidaSemResultado()));
    elementos.campoBuscaRapida.removeAttribute('aria-activedescendant');
    return;
  }

  const selecionada = lista.children[indiceSelecionado];
  elementos.campoBuscaRapida.setAttribute('aria-activedescendant', selecionada.id);
  selecionada.scrollIntoView({ block: 'nearest' });
}

function moverSelecaoDaBuscaRapida(passo) {
  const busca = estado.buscaRapida;
  const total = busca.resultados.length;
  if (total === 0) {
    return;
  }

  busca.indiceSelecionado = (busca.indiceSelecionado + passo + total) % total;
  renderizarResultadosDaBuscaRapida();
}

function abrirEnderecoDaBusca(endereco) {
  if (!ehEnderecoNavegavel(endereco)) {
    throw new Error(`O endereço não abre no navegador: ${endereco}`);
  }
  // No desktop, quem decide entre a guia do HUB e o navegador padrão é o shell.
  window.open(endereco, '_blank', 'noopener');
}

function abrirClienteDaBusca(idDoCliente, aba) {
  alternarVisualizacao('clientes');
  void selecionarCliente(idDoCliente, aba);
}

function abrirProjetoDaBusca({ cliente, projeto }) {
  estado.projetosComInformacoesVisiveis.add(projeto.id);
  abrirClienteDaBusca(cliente.id, 'projetos');
}

/* Contato sem cliente (ou com a aba do cliente oculta) abre no menu Contatos, já filtrado. */
function abrirContatoDaBusca({ contato, cliente }) {
  if (cliente) {
    abrirClienteDaBusca(cliente.id, 'contatos');
    return;
  }

  estado.filtroDeContatos = { nome: contato.nome, clienteId: '' };
  elementos.campoFiltroNomeContato.value = contato.nome;
  alternarVisualizacao('contatos');
}

/* Sem clone local não há pasta nem IDE: abre o remoto. Sem IDE configurada, a pasta. */
function abrirRepositorioDaBusca({ cliente, repositorio }) {
  if (!repositorio.caminhoLocal) {
    return abrirEnderecoDaBusca(repositorio.url);
  }
  if (estado.ideConfigurada) {
    return api.abrirIdeDoRepositorio(cliente.id, repositorio.id);
  }
  return api.abrirPastaDoRepositorio(cliente.id, repositorio.id);
}

async function abrirAtalhoDaBusca({ atalho }) {
  await api.abrirAtalho(atalho.id);
  exibirAviso(`${atalho.nome} iniciado.`);
}

/* Ação do Enter para cada tipo de item. */
const ACOES_PRINCIPAIS_DA_BUSCA = {
  cliente: ({ cliente }) => abrirClienteDaBusca(cliente.id, null),
  base: ({ base }) => abrirEnderecoDaBusca(base.url),
  repositorio: abrirRepositorioDaBusca,
  link: ({ link }) => abrirEnderecoDaBusca(link.url),
  linkDeProjeto: ({ link }) => abrirEnderecoDaBusca(link.url),
  projeto: abrirProjetoDaBusca,
  contato: abrirContatoDaBusca,
  atalho: abrirAtalhoDaBusca,
  baseLocal: ({ base }) => abrirEnderecoDaBusca(`http://localhost:${base.porta}/mge`),
};

/** `abrirCliente` (Ctrl+Enter) troca a ação do item por abrir o cliente dele no painel. */
async function executarItemDaBuscaRapida(item, { abrirCliente = false } = {}) {
  elementos.modalBuscaRapida.close();
  gravarUsoNaBusca(item.chave);

  try {
    if (abrirCliente && item.clienteId) {
      abrirClienteDaBusca(item.clienteId, item.abaDoCliente);
      return;
    }
    await ACOES_PRINCIPAIS_DA_BUSCA[item.tipo](item.dados);
  } catch (erro) {
    exibirAviso(erro.message, 'erro', criarLinkDaConfiguracaoDoErro(erro));
  }
}

function tratarTeclaDaBuscaRapida(evento) {
  if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
    evento.preventDefault();
    moverSelecaoDaBuscaRapida(evento.key === 'ArrowDown' ? 1 : -1);
    return;
  }

  if (evento.key !== 'Enter') {
    return;
  }

  evento.preventDefault();
  const busca = estado.buscaRapida;
  const item = busca.resultados[busca.indiceSelecionado];
  if (item) {
    void executarItemDaBuscaRapida(item, { abrirCliente: evento.ctrlKey });
  }
}

function ehAtalhoDaBuscaRapida(evento) {
  return (
    (evento.ctrlKey || evento.metaKey) &&
    !evento.shiftKey &&
    !evento.altKey &&
    evento.key.toLowerCase() === 'k'
  );
}

/*
 * O atalho global, o menu do aplicativo e a bandeja chegam aqui pelo
 * `executeJavaScript` do shell: o painel é página servida pelo backend e não
 * recebe o preload, então não há outro canal até ele.
 */
function exporBuscaRapidaAoShell() {
  window.buscaRapidaDoHub = { abrir: abrirBuscaRapida };
}

function registrarEventosDaBuscaRapida() {
  elementos.botaoBuscaRapida.append(criarIcone(ICONES.lupa));
  elementos.botaoBuscaRapida.addEventListener('click', abrirBuscaRapida);
  elementos.campoBuscaRapida.addEventListener('input', atualizarResultadosDaBuscaRapida);
  elementos.campoBuscaRapida.addEventListener('keydown', tratarTeclaDaBuscaRapida);

  // Clique no fundo escurecido cai no próprio `<dialog>`, fora do conteúdo.
  elementos.modalBuscaRapida.addEventListener('click', (evento) => {
    if (evento.target === elementos.modalBuscaRapida) {
      elementos.modalBuscaRapida.close();
    }
  });

  document.addEventListener('keydown', (evento) => {
    if (ehAtalhoDaBuscaRapida(evento)) {
      evento.preventDefault();
      abrirBuscaRapida();
    }
  });

  exporBuscaRapidaAoShell();
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

/** Geral vazia (sem anotações nem links gerais) não tem o que mostrar: abre em Bases. */
function abaInicialDoCliente(cliente) {
  const geralVazia = !cliente?.anotacoes?.trim() && !cliente?.links?.length;
  return geralVazia ? 'bases' : 'geral';
}

/**
 * Seleciona e relê o cliente.
 *
 * A tela é desenhada duas vezes de propósito: a primeira responde ao clique na
 * hora, com o que já está em memória; a segunda entra quando a releitura chega.
 * Se o usuário trocar de cliente nesse meio-tempo, o resultado atrasado é
 * descartado para não redesenhar por cima da nova seleção.
 */
async function selecionarCliente(id, abaInicial = null) {
  if (abaInicial) {
    estado.abaDetalheAtiva = abaInicial;
  } else if (estado.idSelecionado !== id) {
    estado.abaDetalheAtiva = abaInicialDoCliente(
      estado.clientes.find((cliente) => cliente.id === id),
    );
  }
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

  // Recarregar de propósito é o único redesenho que deve consultar Agenda e OS de novo.
  descartarSecoesConsultadasDoDetalhe();
  renderizar();
  carregarSituacoesDasBasesDoClienteSelecionado();
  await carregarSituacoesGit(true);
  exibirAviso('Informações recarregadas.');
}

/* ------------------------------ Git AutoSync ------------------------------ */

/*
 * A tela nunca escreve o `config.json` do autosync: toda mudança é um pedido ao
 * backend, que chama o CLI. Depois de qualquer ação as duas telas (a aba do menu e a
 * aba do cliente aberto) são relidas, porque o autosync pode ter mudado mais do que a
 * linha clicada — um `sync` grava o status de todos.
 */

const AGENTES_DO_AUTOSYNC = [
  { valor: 'auto', rotulo: 'Automático (o primeiro instalado)' },
  { valor: 'claude', rotulo: 'Claude' },
  { valor: 'codex', rotulo: 'Codex' },
  { valor: 'opencode', rotulo: 'OpenCode' },
];

const TEXTO_DA_CONFIRMACAO_DA_IA =
  'O diff das alterações será enviado ao agente escolhido (Claude, Codex ou OpenCode) para escrever a mensagem do commit.';

/* Selo da situação de um repositório de cliente, na seção AutoSync do cliente. */
const SITUACOES_DO_CLIENTE_NO_AUTOSYNC = {
  fora: { severidade: 'desconhecido', rotulo: 'Fora do Git AutoSync' },
  ativo: {
    severidade: 'ok',
    rotulo: 'No Git AutoSync',
    rotuloPelaRaiz: (pasta) => `No Git AutoSync pela pasta ${pasta}`,
  },
  excluido: {
    severidade: 'atencao',
    rotulo: 'Excluído da pasta-raiz',
    rotuloPelaRaiz: (pasta) => `Excluído da pasta ${pasta}`,
  },
  desligado: {
    severidade: 'atencao',
    rotulo: 'Desligado no Git AutoSync',
    rotuloPelaRaiz: (pasta) => `Pasta ${pasta} desligada no Git AutoSync`,
  },
  'pasta-ausente': { severidade: 'erro', rotulo: 'A pasta não existe' },
  'nao-e-repositorio': { severidade: 'erro', rotulo: 'A pasta não é um repositório Git' },
};

/* Até onde a saída do CLI cabe num aviso; o texto inteiro fica na linha, se for erro. */
const TAMANHO_MAXIMO_DO_RESUMO_DA_SAIDA = 220;
const LINHAS_DO_LOG_DO_AUTOSYNC = 200;

/** Mesma chave do backend: barras unificadas, sem barra final, minúsculas. */
function chaveDoCaminhoNoAutosync(caminho) {
  return caminho.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/** Última linha com texto da saída do CLI: é onde ele diz o resultado (`[OK] ...: ...`). */
function resumirSaidaDoAutosync(saida) {
  const linhas = (saida ?? '')
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
  const ultima = linhas.at(-1) ?? 'Concluído.';
  return ultima.length > TAMANHO_MAXIMO_DO_RESUMO_DA_SAIDA
    ? `${ultima.slice(0, TAMANHO_MAXIMO_DO_RESUMO_DA_SAIDA)}…`
    : ultima;
}

/** Carrega a visão e os repositórios dos clientes. Falha fica no estado, e a tela a mostra. */
async function carregarAutosync() {
  try {
    const [visao, clientes] = await Promise.all([
      api.visaoDoAutosync(),
      api.repositoriosDosClientesNoAutosync(),
    ]);
    estado.autosync.visao = visao;
    estado.autosync.clientes = clientes;
    estado.autosync.erroDeCarga = null;
    estado.autosync.atualizadoEm = new Date();
  } catch (erro) {
    estado.autosync.erroDeCarga = erro.message;
  }
}

/** Redesenha o que estiver montado, sem consultar o servidor de novo. */
function redesenharAutosync() {
  if (estado.visualizacao === 'autosync') {
    renderizarAutosync();
  }
  estado.autosync.redesenharDoCliente?.();
}

async function recarregarAutosync() {
  await carregarAutosync();
  redesenharAutosync();
}

/**
 * Roda uma ação num repositório. A linha fica bloqueada e diz o que está em andamento
 * (um `sync` pode levar minutos); o erro do CLI fica ao pé da linha, com o texto
 * original, até a próxima ação dar certo.
 */
async function executarNoRepositorioDoAutosync(caminho, rotulo, acao) {
  const chave = chaveDoCaminhoNoAutosync(caminho);
  if (estado.autosync.emAndamento.has(chave)) {
    return;
  }

  estado.autosync.emAndamento.set(chave, rotulo);
  redesenharAutosync();

  try {
    const resposta = await acao();
    estado.autosync.errosPorCaminho.delete(chave);
    exibirAviso(resposta?.saida ? resumirSaidaDoAutosync(resposta.saida) : `${rotulo}: concluído.`);
  } catch (erro) {
    estado.autosync.errosPorCaminho.set(chave, {
      mensagem: erro.message,
      sugestoes: erro.sugestoes ?? [],
    });
    exibirAviso(`${rotulo} falhou em ${nomeDaPasta(caminho)}.`, 'erro');
  } finally {
    estado.autosync.emAndamento.delete(chave);
    await recarregarAutosync();
  }
}

/** Ação que vale para o autosync inteiro: horários, bandeja, IA, rodar agora. */
async function executarNoAutosync(botao, rotulo, acao) {
  // O seletor de agente também passa por aqui, e trocar o texto dele apagaria as opções.
  const trocarTexto = botao.tagName === 'BUTTON' && !botao.classList.contains('botao-icone');
  const textoOriginal = botao.textContent;
  botao.disabled = true;
  if (trocarTexto) {
    botao.textContent = `${rotulo}…`;
  }

  try {
    const resposta = await acao();
    estado.autosync.erroGeral = null;
    estado.autosync.horariosEmEdicao = null;
    exibirAviso(resposta?.saida ? resumirSaidaDoAutosync(resposta.saida) : `${rotulo}: concluído.`);
  } catch (erro) {
    estado.autosync.erroGeral = erro.message;
    exibirAviso(`${rotulo} falhou.`, 'erro');
  } finally {
    botao.disabled = false;
    if (trocarTexto) {
      botao.textContent = textoOriginal;
    }
    await recarregarAutosync();
  }
}

function abrirConfirmacaoDoAutosync({ titulo, texto, rotulo, perigo = false, aoConfirmar }) {
  elementos.tituloConfirmacaoAutosync.textContent = titulo;
  elementos.textoConfirmacaoAutosync.textContent = texto;
  elementos.botaoConfirmarConfirmacaoAutosync.textContent = rotulo;
  elementos.botaoConfirmarConfirmacaoAutosync.className = perigo ? 'btn danger' : 'btn primario';
  estado.autosync.confirmacaoPendente = aoConfirmar;
  elementos.modalConfirmacaoAutosync.showModal();
}

function confirmarNoAutosync() {
  const aoConfirmar = estado.autosync.confirmacaoPendente;
  estado.autosync.confirmacaoPendente = null;
  elementos.modalConfirmacaoAutosync.close();
  aoConfirmar?.();
}

/* ---- linha de repositório, comum à aba do menu e à aba do cliente ---- */

function severidadeDoEstadoNoAutosync(estadoDoRepositorio) {
  if (!estadoDoRepositorio) {
    return 'desconhecido';
  }
  if (estadoDoRepositorio.state === 'pending_push') {
    return 'atencao';
  }
  if (estadoDoRepositorio.success === false || estadoDoRepositorio.state === 'failed') {
    return 'erro';
  }
  return 'ok';
}

/**
 * Último resultado do repositório, com o texto do autosync sem reescrever: é ali que
 * aparece o motivo de um commit recusado (arquivo sensível, branch fora da política).
 */
function criarSeloDoUltimoResultado(estadoDoRepositorio) {
  const severidade = severidadeDoEstadoNoAutosync(estadoDoRepositorio);
  const selo = criarElemento('div', `selo-situacao ${severidade}`);
  selo.append(criarPontoDeSituacao(severidade));

  if (!estadoDoRepositorio) {
    selo.append(criarElemento('span', 'situacao-resumo', 'Ainda não rodou no Git AutoSync'));
    return selo;
  }

  const quando = estadoDoRepositorio.lastRun ? `${estadoDoRepositorio.lastRun} · ` : '';
  selo.append(
    criarElemento('span', 'situacao-resumo', `${quando}${estadoDoRepositorio.message ?? ''}`),
  );
  selo.title = estadoDoRepositorio.lastPush
    ? `Último push: ${estadoDoRepositorio.lastPush}`
    : 'Nenhum push registrado';
  return selo;
}

function criarSeloDoAutosync(severidade, texto) {
  const selo = criarElemento('div', `selo-situacao ${severidade}`);
  selo.append(criarPontoDeSituacao(severidade), criarElemento('span', 'situacao-resumo', texto));
  return selo;
}

/**
 * Os quatro botões do dia a dia. Commit e Sincronizar abrem o modal da mensagem;
 * Push vai direto, porque não há nada a escrever; Merge Request abre o modal do MR.
 */
function criarBotoesDoRepositorioNoAutosync(caminho, habilitados) {
  const botoes = [
    criarBotao('btn tiny', 'Commit', () => abrirModalDoCommitDoAutosync(caminho, 'commit')),
    criarBotao('btn tiny', 'Push', () =>
      executarNoRepositorioDoAutosync(caminho, 'Push', () => api.pushNoAutosync(caminho)),
    ),
    criarBotao('btn tiny primario', 'Sincronizar', () =>
      abrirModalDoCommitDoAutosync(caminho, 'sincronizar'),
    ),
    criarBotao('btn tiny', 'Merge Request', () => abrirModalDoMrDoAutosync(caminho)),
  ];
  botoes[0].title = 'Commit sem push';
  botoes[1].title = 'Push do que já foi commitado';
  botoes[2].title = 'Commit e push';
  botoes[3].title = 'Criar Merge Request no GitLab';
  for (const botao of botoes) {
    botao.disabled = !habilitados;
  }
  return botoes;
}

/**
 * Uma linha de repositório no Git AutoSync.
 *
 * `selos` descrevem onde o repositório está no autosync; `extras` são as ações da
 * segunda linha (histórico, política, ativar/tirar), que variam por aba.
 */
function criarLinhaDoAutosync({
  caminho,
  titulo,
  detalhe,
  selos,
  estadoDoRepositorio,
  acoesHabilitadas,
  extras,
}) {
  const chave = chaveDoCaminhoNoAutosync(caminho);
  const emAndamento = estado.autosync.emAndamento.get(chave);
  const erro = estado.autosync.errosPorCaminho.get(chave);

  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', titulo),
    criarElemento('p', 'recurso-caminho', caminho),
  );
  if (detalhe) {
    informacoes.append(criarElemento('span', 'recurso-url secundaria', detalhe));
  }

  const linhaDeSelos = criarElemento('div', 'selos-do-autosync');
  linhaDeSelos.append(...selos, criarSeloDoUltimoResultado(estadoDoRepositorio));
  informacoes.append(linhaDeSelos);

  if (emAndamento) {
    const andamento = criarElemento('p', 'andamento-do-autosync', `${emAndamento} em andamento…`);
    andamento.setAttribute('role', 'status');
    informacoes.append(andamento);
  }
  if (erro) {
    informacoes.append(criarBlocoDeCorrecaoDoAutosync(caminho, erro));
  }

  const acoes = criarElemento('div', 'recurso-acoes');
  const principais = criarElemento('div', 'recurso-acoes-linha');
  principais.append(
    ...criarBotoesDoRepositorioNoAutosync(caminho, acoesHabilitadas && !emAndamento),
  );
  acoes.append(principais);

  if (extras.length > 0) {
    const secundarias = criarElemento('div', 'recurso-acoes-linha recurso-acoes-extras');
    for (const botao of extras) {
      botao.disabled = botao.disabled || Boolean(emAndamento);
    }
    secundarias.append(...extras);
    acoes.append(secundarias);
  }

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, acoes);
  return linha;
}

/** Política gravada do repositório, para abrir o modal a partir da sugestão. */
function politicaDoRepositorioNoAutosync(caminho) {
  const chave = chaveDoCaminhoNoAutosync(caminho);
  return (
    estado.autosync.visao?.repositorios.find(
      (repositorio) => chaveDoCaminhoNoAutosync(repositorio.caminho) === chave,
    )?.politica ?? null
  );
}

async function abrirTerminalDoAutosync(caminho, botao) {
  botao.disabled = true;
  try {
    await api.abrirTerminalNoAutosync(caminho);
  } catch (erro) {
    exibirAviso(erro.message, 'erro');
  } finally {
    botao.disabled = false;
  }
}

function criarComandoDeCorrecao(comando) {
  const linha = criarElemento('div', 'comando-de-correcao');
  linha.append(
    criarElemento('code', null, comando),
    criarBotaoDeIcone('btn tiny ghost', ICONES.copiar, 'Copiar comando', () =>
      copiarParaAreaDeTransferencia(comando, 'Comando copiado. Cole no terminal.'),
    ),
  );
  return linha;
}

/**
 * O que fazer depois de uma falha: a explicação, os comandos para copiar e o terminal
 * já na pasta. Nada é executado pela tela — `pull --rebase` reescreve commits locais e
 * pode parar em conflito, e quem decide é a pessoa, vendo o terminal. A saída do CLI
 * continua inteira, recolhida, para quando a sugestão não bastar.
 */
function criarBlocoDeCorrecaoDoAutosync(caminho, { mensagem, sugestoes }) {
  const bloco = criarElemento('div', 'correcao-do-autosync');
  bloco.append(criarElemento('p', 'correcao-titulo', 'Como resolver'));

  const acoesExtras = [];
  if (sugestoes.length === 0) {
    bloco.append(
      criarElemento(
        'p',
        'texto-auxiliar',
        'O HUB SNK não reconhece este erro. Veja a saída completa abaixo e resolva pelo terminal.',
      ),
    );
  }
  for (const sugestao of sugestoes) {
    const item = criarElemento('div', 'sugestao-de-correcao');
    const explicacao = criarElemento('p', 'sugestao-de-correcao-texto');
    explicacao.append(
      criarPontoDeSituacao('atencao'),
      criarElemento('span', null, sugestao.explicacao),
    );
    item.append(explicacao, ...sugestao.comandos.map(criarComandoDeCorrecao));
    bloco.append(item);

    if (sugestao.acao === 'configurar-gitlab') {
      acoesExtras.push(
        criarBotao('btn tiny', 'Configurar o GitLab', () => abrirConfiguracaoPendente('gitlab')),
      );
    }
    if (sugestao.acao === 'politica') {
      acoesExtras.push(
        criarBotao('btn tiny', 'Política do repositório', () =>
          abrirModalDaPoliticaDoAutosync(caminho, politicaDoRepositorioNoAutosync(caminho)),
        ),
      );
    }
  }

  const botaoTerminal = criarBotao('btn tiny botao-com-icone', undefined, () =>
    abrirTerminalDoAutosync(caminho, botaoTerminal),
  );
  botaoTerminal.append(
    criarIcone(ICONES.terminal),
    criarElemento('span', null, 'Abrir terminal na pasta'),
  );
  botaoTerminal.title = `Abrir o terminal em ${caminho}`;

  const botaoDispensar = criarBotao('btn tiny ghost', 'Dispensar', () => {
    estado.autosync.errosPorCaminho.delete(chaveDoCaminhoNoAutosync(caminho));
    redesenharAutosync();
  });

  const acoes = criarElemento('div', 'correcao-acoes');
  acoes.append(botaoTerminal, ...acoesExtras, botaoDispensar);
  bloco.append(acoes);

  const saida = criarElemento('details', 'saida-do-autosync');
  saida.append(
    criarElemento('summary', null, 'Saída completa do Git AutoSync'),
    criarElemento('pre', 'erro-do-autosync', mensagem),
  );
  bloco.append(saida);
  return bloco;
}

function criarBotaoDeHistoricoDoAutosync(caminho) {
  return criarBotaoDeIcone('btn tiny', ICONES.log, 'Histórico de commits', () =>
    abrirHistoricoDoAutosync(caminho),
  );
}

function criarBotaoDePoliticaDoAutosync(caminho, politica) {
  return criarBotaoDeIcone('btn tiny', ICONES.engrenagem, 'Política do repositório', () =>
    abrirModalDaPoliticaDoAutosync(caminho, politica),
  );
}

/* Adicionar resolve sozinho o caso: `add`, `include` ou tirar e pôr de novo o alvo desligado. */
function adicionarAoAutosync(caminho, tipo = 'repo') {
  return executarNoRepositorioDoAutosync(caminho, 'Adicionar ao Git AutoSync', () =>
    api.adicionarAoAutosync(caminho, tipo),
  );
}

/* Tirar também: alvo próprio sai com `remove`, repositório de pasta-raiz sai com `exclude`. */
function tirarDoAutosync(caminho) {
  return executarNoRepositorioDoAutosync(caminho, 'Tirar do Git AutoSync', () =>
    api.tirarDoAutosync(caminho),
  );
}

/* ---------------------------- aba do menu ---------------------------------- */

function criarAvisoDeAutosyncNaoInstalado() {
  const aviso = criarElemento('div', 'aviso-shell aviso-do-autosync');
  aviso.append(
    criarElemento(
      'p',
      null,
      'O Git AutoSync não está instalado nesta máquina. Instale pela aba Git AutoSync do menu principal.',
    ),
  );
  return aviso;
}

function severidadeDaTarefaDoAgendador(tarefa) {
  if (tarefa.estado === 'Disabled') {
    return 'atencao';
  }
  return tarefa.ultimoResultado && tarefa.ultimoResultado !== 0 ? 'atencao' : 'ok';
}

function descreverTarefaDoAgendador(tarefa) {
  const partes = [tarefa.nome, tarefa.estado === 'Disabled' ? 'desativada' : tarefa.estado];
  if (tarefa.proximaExecucao) {
    partes.push(`próxima ${tarefa.proximaExecucao}`);
  }
  if (tarefa.ultimoResultado) {
    partes.push(`último resultado ${tarefa.ultimoResultado}`);
  }
  return partes.join(' · ');
}

function criarCabecalhoDaSecaoDoAutosync(titulo, ...botoes) {
  const cabecalho = criarElemento('div', 'secao-cabecalho');
  cabecalho.append(criarElemento('h3', null, titulo));
  if (botoes.length > 0) {
    const acoes = criarElemento('div', 'acoes-da-secao-do-autosync');
    acoes.append(...botoes);
    cabecalho.append(acoes);
  }
  return cabecalho;
}

function criarSecaoDeEstadoDoAutosync(visao) {
  const secao = criarElemento('div', 'secao-recursos');
  secao.append(criarCabecalhoDaSecaoDoAutosync('Estado'));

  const linha = criarElemento('div', 'linha-recurso');
  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', `Git AutoSync ${visao.versao ?? ''}`.trim()),
    criarElemento(
      'span',
      'recurso-url secundaria',
      `Última rodada geral: ${visao.ultimaExecucao ?? 'nunca'}`,
    ),
  );

  const selos = criarElemento('div', 'selos-do-autosync');
  if (visao.horarios.length > 0 && visao.tarefas.length === 0) {
    selos.append(criarSeloDoAutosync('erro', 'Horário configurado, tarefa não instalada'));
  } else if (visao.tarefas.length === 0) {
    selos.append(criarSeloDoAutosync('desconhecido', 'Sem tarefa no Agendador'));
  }
  for (const tarefa of visao.tarefas) {
    selos.append(
      criarSeloDoAutosync(
        severidadeDaTarefaDoAgendador(tarefa),
        descreverTarefaDoAgendador(tarefa),
      ),
    );
  }
  informacoes.append(selos);

  if (estado.autosync.erroGeral) {
    informacoes.append(criarElemento('pre', 'erro-do-autosync', estado.autosync.erroGeral));
  }

  const acoes = criarElemento('div', 'recurso-acoes');
  const linhaDeAcoes = criarElemento('div', 'recurso-acoes-linha');
  if (visao.horarios.length > 0 && visao.tarefas.length === 0) {
    const botaoCriar = criarBotao('btn tiny primario', 'Criar tarefa', () =>
      executarNoAutosync(botaoCriar, 'Criar tarefa', () => api.instalarTarefaDoAutosync()),
    );
    linhaDeAcoes.append(botaoCriar);
  }
  const botaoBandeja = criarBotao(
    'btn tiny',
    visao.bandeja ? 'Desligar bandeja' : 'Ligar bandeja',
    () => {
      if (visao.bandeja) {
        executarNoAutosync(botaoBandeja, 'Desligar bandeja', () =>
          api.definirBandejaDoAutosync(false),
        );
        return;
      }
      abrirConfirmacaoDoAutosync({
        titulo: 'Ligar a bandeja',
        texto:
          'O ícone do Git AutoSync passa a abrir junto com o login. Se já houver um ícone aberto, o Git AutoSync abre outro: feche o antigo.',
        rotulo: 'Ligar',
        aoConfirmar: () =>
          executarNoAutosync(botaoBandeja, 'Ligar bandeja', () =>
            api.definirBandejaDoAutosync(true),
          ),
      });
    },
  );
  botaoBandeja.title = visao.bandeja
    ? 'A bandeja abre junto com o login'
    : 'A bandeja não abre no login';
  linhaDeAcoes.append(botaoBandeja);
  acoes.append(linhaDeAcoes);

  linha.append(informacoes, acoes);
  secao.append(linha);
  return secao;
}

function horariosDoAutosyncEmExibicao(visao) {
  return estado.autosync.horariosEmEdicao ?? visao.horarios;
}

function criarSecaoDeAgendamentoDoAutosync(visao) {
  const horarios = horariosDoAutosyncEmExibicao(visao);
  const alterados =
    estado.autosync.horariosEmEdicao !== null &&
    [...horarios].sort().join(',') !== [...visao.horarios].sort().join(',');

  const botaoRodar = criarBotao('btn tiny primario', 'Rodar agora', () =>
    abrirConfirmacaoDoAutosync({
      titulo: 'Rodar agora',
      texto:
        'Commit e push em todos os repositórios ativos do Git AutoSync, com a mensagem que ele escrever. Pode levar alguns minutos.',
      rotulo: 'Rodar agora',
      aoConfirmar: () =>
        executarNoAutosync(botaoRodar, 'Rodando', () => api.sincronizarNoAutosync()),
    }),
  );

  const temTarefa = visao.tarefas.length > 0;
  const botaoAgendamento = criarBotao(
    'btn tiny',
    temTarefa ? 'Desativar agendamento' : 'Ativar agendamento',
    () => {
      if (!temTarefa) {
        executarNoAutosync(botaoAgendamento, 'Ativar agendamento', () =>
          api.instalarTarefaDoAutosync(),
        );
        return;
      }
      abrirConfirmacaoDoAutosync({
        titulo: 'Desativar o agendamento',
        texto:
          'A tarefa sai do Agendador e a bandeja deixa de abrir no login. Os horários e os repositórios continuam gravados.',
        rotulo: 'Desativar',
        perigo: true,
        aoConfirmar: () =>
          executarNoAutosync(botaoAgendamento, 'Desativar agendamento', () =>
            api.desinstalarTarefaDoAutosync(),
          ),
      });
    },
  );
  botaoAgendamento.disabled = !temTarefa && visao.horarios.length === 0;

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(criarCabecalhoDaSecaoDoAutosync('Quando roda', botaoAgendamento, botaoRodar));

  const chips = criarElemento('div', 'horarios-do-autosync');
  for (const horario of horarios) {
    const chip = criarElemento('span', 'chip-do-autosync');
    chip.append(
      criarElemento('span', null, horario),
      criarBotao('btn tiny ghost', '✕', () => {
        estado.autosync.horariosEmEdicao = horarios.filter((outro) => outro !== horario);
        renderizarAutosync();
      }),
    );
    chip.lastChild.setAttribute('aria-label', `Tirar o horário ${horario}`);
    chips.append(chip);
  }
  if (horarios.length === 0) {
    chips.append(criarElemento('span', 'texto-auxiliar', 'Nenhum horário.'));
  }

  const campo = criarElemento('input', 'campo-horario-do-autosync');
  campo.type = 'time';
  campo.setAttribute('aria-label', 'Novo horário');
  const botaoIncluir = criarBotao('btn tiny', 'Incluir', () => {
    const valor = campo.value;
    if (!valor || horarios.includes(valor)) {
      return;
    }
    estado.autosync.horariosEmEdicao = [...horarios, valor].sort();
    renderizarAutosync();
  });

  const botaoSalvar = criarBotao('btn tiny primario', 'Salvar horários', () =>
    executarNoAutosync(botaoSalvar, 'Salvar horários', () =>
      api.definirHorariosDoAutosync(horarios),
    ),
  );
  botaoSalvar.disabled = !alterados || horarios.length === 0;

  const edicao = criarElemento('div', 'edicao-de-horarios-do-autosync');
  edicao.append(chips, campo, botaoIncluir, botaoSalvar);
  secao.append(
    edicao,
    criarElemento(
      'p',
      'texto-auxiliar',
      'Os horários valem para todo dia. Salvar reinstala a tarefa do Agendador junto. Para parar a rodada automática, desative o agendamento.',
    ),
  );
  return secao;
}

function criarSecaoDaMensagemDoAutosync(visao) {
  const secao = criarElemento('div', 'secao-recursos');
  secao.append(criarCabecalhoDaSecaoDoAutosync('Mensagem do commit'));

  const caixa = criarElemento('input');
  caixa.type = 'checkbox';
  caixa.checked = visao.ia.ligada;
  const rotuloDaCaixa = criarElemento('label', 'campo-checkbox');
  rotuloDaCaixa.append(caixa, ' Escrever a mensagem com IA');

  const agente = criarElemento('select', 'busca seletor-do-autosync');
  agente.setAttribute('aria-label', 'Agente de IA');
  agente.append(...AGENTES_DO_AUTOSYNC.map(({ valor, rotulo }) => criarOpcao(valor, rotulo)));
  agente.value = visao.ia.agente;
  agente.disabled = !visao.ia.ligada;

  const salvar = (ligada) =>
    executarNoAutosync(agente, 'Mensagem do commit', () =>
      api.definirIaDoAutosync(ligada, agente.value),
    );

  caixa.addEventListener('change', () => {
    if (!caixa.checked) {
      salvar(false);
      return;
    }
    // Ligar não é decisão do sistema: volta desmarcada até a pessoa confirmar.
    caixa.checked = false;
    abrirConfirmacaoDoAutosync({
      titulo: 'Escrever a mensagem com IA',
      texto: TEXTO_DA_CONFIRMACAO_DA_IA,
      rotulo: 'Ligar',
      aoConfirmar: () => salvar(true),
    });
  });
  agente.addEventListener('change', () => salvar(true));

  const linha = criarElemento('div', 'edicao-de-horarios-do-autosync');
  linha.append(rotuloDaCaixa, agente);
  secao.append(
    linha,
    criarElemento(
      'p',
      'texto-auxiliar',
      visao.ia.ligada
        ? 'O diff de cada commit vai para o agente escolhido. Se o agente falhar, o commit sai com a mensagem fixa.'
        : 'Desligada, o commit sai com a mensagem fixa "chore: auto-commit AAAA-MM-DD HH:MM" e nada sai da máquina.',
    ),
  );
  if (visao.agenteDaTarefa) {
    secao.append(
      criarElemento(
        'p',
        'texto-auxiliar',
        `A rodada agendada usa o agente ${visao.agenteDaTarefa}, fixado pelo próprio Git AutoSync.`,
      ),
    );
  }
  return secao;
}

function descreverOrigemNoAutosync(repositorio) {
  if (repositorio.alvoProprio) {
    return repositorio.ativo
      ? criarSeloDoAutosync('ok', 'Ativo')
      : criarSeloDoAutosync('atencao', 'Desligado');
  }
  if (repositorio.alvo) {
    return repositorio.ativo
      ? criarSeloDoAutosync('ok', `Ativo pela pasta ${nomeDaPasta(repositorio.alvo)}`)
      : criarSeloDoAutosync('atencao', `Excluído da pasta ${nomeDaPasta(repositorio.alvo)}`);
  }
  return criarSeloDoAutosync('desconhecido', 'Fora do Git AutoSync');
}

function criarLinhaDoAutosyncGeral(repositorio) {
  const botaoAtivo = repositorio.ativo
    ? criarBotao('btn tiny danger', 'Desativar', () => tirarDoAutosync(repositorio.caminho))
    : criarBotao('btn tiny', 'Ativar', () => adicionarAoAutosync(repositorio.caminho));
  botaoAtivo.title = repositorio.ativo
    ? 'Tirar da rodada automática (o histórico fica)'
    : 'Pôr de volta na rodada automática';

  return criarLinhaDoAutosync({
    caminho: repositorio.caminho,
    titulo: nomeDaPasta(repositorio.caminho),
    detalhe: repositorio.clienteNome ? `Cliente ${repositorio.clienteNome}` : null,
    selos: [descreverOrigemNoAutosync(repositorio)],
    estadoDoRepositorio: repositorio.estado,
    acoesHabilitadas: true,
    extras: [
      criarBotaoDeHistoricoDoAutosync(repositorio.caminho),
      criarBotaoDePoliticaDoAutosync(repositorio.caminho, repositorio.politica),
      botaoAtivo,
    ],
  });
}

function criarLinhaDePastaRaizDoAutosync(alvo, repositorios) {
  const chave = chaveDoCaminhoNoAutosync(alvo.path);
  const cobertos = repositorios.filter(
    (repositorio) => chaveDoCaminhoNoAutosync(repositorio.alvo) === chave,
  );
  const ativos = cobertos.filter((repositorio) => repositorio.ativo).length;

  const informacoes = criarElemento('div', 'recurso-info');
  informacoes.append(
    criarElemento('p', 'recurso-nome', `Pasta-raiz ${nomeDaPasta(alvo.path)}`),
    criarElemento('p', 'recurso-caminho', alvo.path),
    criarElemento(
      'span',
      'recurso-url secundaria',
      `${cobertos.length} repositório(s), ${ativos} ativo(s). Repositório novo nesta pasta entra sozinho.`,
    ),
  );

  const botaoTirar = criarBotao('btn tiny danger', 'Tirar a pasta', () =>
    abrirConfirmacaoDoAutosync({
      titulo: 'Tirar a pasta-raiz',
      texto: `Todos os ${cobertos.length} repositório(s) de ${alvo.path} saem da rodada automática. Os repositórios e o histórico ficam.`,
      rotulo: 'Tirar a pasta',
      perigo: true,
      aoConfirmar: () => tirarDoAutosync(alvo.path),
    }),
  );

  const acoes = criarElemento('div', 'recurso-acoes');
  const linhaDeAcoes = criarElemento('div', 'recurso-acoes-linha');
  linhaDeAcoes.append(botaoTirar);
  acoes.append(linhaDeAcoes);

  const linha = criarElemento('div', 'linha-recurso');
  linha.append(informacoes, acoes);
  return linha;
}

function criarSugestoesDeRaizDoAutosync() {
  const sugestoes = estado.autosync.clientes?.sugestoesDeRaiz ?? [];
  return sugestoes.map((sugestao) => {
    const aviso = criarElemento('div', 'sugestao-do-autosync');
    aviso.append(
      criarElemento(
        'p',
        null,
        `${sugestao.quantidade} repositórios de clientes estão em ${sugestao.pasta}. Cadastrar a pasta cobre todos e os futuros — inclusive os que você não quiser sincronizar, que dá para excluir depois.`,
      ),
      criarBotao('btn tiny', 'Cadastrar a pasta', () =>
        adicionarAoAutosync(sugestao.pasta, 'root'),
      ),
    );
    return aviso;
  });
}

async function adicionarTodosOsRepositoriosDosClientes(botao) {
  botao.disabled = true;
  botao.textContent = 'Adicionando…';

  try {
    const resultado = await api.adicionarRepositoriosDosClientesNoAutosync();
    for (const { caminho, erro } of resultado.falhas) {
      estado.autosync.errosPorCaminho.set(chaveDoCaminhoNoAutosync(caminho), {
        mensagem: erro,
        sugestoes: [],
      });
    }
    const partes = [
      `${resultado.adicionados.length} adicionado(s)`,
      `${resultado.jaEstavam.length} já estava(m)`,
      `${resultado.ignorados.length} ignorado(s)`,
      `${resultado.falhas.length} com falha`,
    ];
    exibirAviso(
      `${partes.join(', ')}. Revise a política de cada repositório: o Git AutoSync commita tudo o que não está no .gitignore.`,
      resultado.falhas.length > 0 ? 'erro' : 'sucesso',
    );
  } catch (erro) {
    estado.autosync.erroGeral = erro.message;
    exibirAviso('Não foi possível adicionar os repositórios dos clientes.', 'erro');
  } finally {
    await recarregarAutosync();
  }
}

function criarSecaoDeRepositoriosDoAutosync(visao) {
  const foraDoAutosync = (estado.autosync.clientes?.repositorios ?? []).filter(
    (repositorio) => repositorio.situacao === 'fora',
  ).length;

  const botaoLote = criarBotao(
    'btn tiny',
    `Adicionar todos os repositórios dos clientes (${foraDoAutosync})`,
    () => adicionarTodosOsRepositoriosDosClientes(botaoLote),
  );
  botaoLote.disabled = foraDoAutosync === 0;
  botaoLote.title =
    foraDoAutosync === 0
      ? 'Todo repositório de cliente com pasta local já está no Git AutoSync'
      : 'Adiciona, um a um, os repositórios de clientes com pasta local que estão fora';

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(criarCabecalhoDaSecaoDoAutosync('Repositórios', botaoLote));
  secao.append(...criarSugestoesDeRaizDoAutosync());

  const raizes = visao.alvos.filter((alvo) => alvo.type === 'root');
  const linhas = [
    ...raizes.map((alvo) => criarLinhaDePastaRaizDoAutosync(alvo, visao.repositorios)),
    ...visao.repositorios.map(criarLinhaDoAutosyncGeral),
  ];

  if (linhas.length === 0) {
    secao.append(
      criarElemento(
        'p',
        'secao-vazia',
        'Nenhum repositório no Git AutoSync. Adicione pela aba Git de cada cliente ou com o botão acima.',
      ),
    );
    return secao;
  }

  const lista = criarElemento('div', 'lista-recursos');
  lista.append(...linhas);
  secao.append(lista);
  return secao;
}

async function carregarLogDoAutosync(destino) {
  destino.textContent = 'Carregando…';
  try {
    const { linhas } = await api.logDoAutosync(LINHAS_DO_LOG_DO_AUTOSYNC);
    destino.textContent = linhas.length > 0 ? linhas.join('\n') : 'O log está vazio.';
    destino.scrollTop = destino.scrollHeight;
  } catch (erro) {
    destino.textContent = erro.message;
  }
}

function criarSecaoDoLogDoAutosync() {
  const grupo = criarElemento('details', 'grupo-recolhivel');
  grupo.append(
    criarElemento(
      'summary',
      null,
      `Log do Git AutoSync (últimas ${LINHAS_DO_LOG_DO_AUTOSYNC} linhas)`,
    ),
  );

  const corpo = criarElemento('div', 'grupo-recolhivel-corpo');
  const texto = criarElemento('pre', 'log-do-autosync');
  const botaoAtualizar = criarBotao('btn tiny', 'Atualizar o log', () =>
    carregarLogDoAutosync(texto),
  );
  const barra = criarElemento('div', 'linha-do-link-sobre');
  barra.append(botaoAtualizar);
  corpo.append(barra, texto);
  grupo.append(corpo);

  grupo.addEventListener('toggle', () => {
    if (grupo.open) {
      carregarLogDoAutosync(texto);
    }
  });

  const secao = criarElemento('div', 'secao-recursos');
  secao.append(grupo);
  return secao;
}

function renderizarUltimaAtualizacaoDoAutosync() {
  const quando = estado.autosync.atualizadoEm;
  elementos.ultimaAtualizacaoAutosync.textContent = quando
    ? `Atualizado às ${quando.toLocaleTimeString('pt-BR')}`
    : '';
}

/**
 * Sem o Git AutoSync, a aba mostra as mesmas seções acinzentadas e inertes: dá para ver
 * o que ele oferece, e só o cabeçalho (instalar e saber mais) responde ao clique.
 */
function criarPreviaDoAutosyncIndisponivel(visaoLida) {
  /* Tarefas do Agendador sobram de uma instalação antiga e dariam a prévia como ativa. */
  const visao = { ...visaoLida, tarefas: [] };
  const previa = criarElemento('div', 'autosync-indisponivel');
  previa.inert = true;
  previa.setAttribute('aria-hidden', 'true');
  previa.append(
    criarSecaoDeEstadoDoAutosync(visao),
    criarSecaoDeAgendamentoDoAutosync(visao),
    criarSecaoDaMensagemDoAutosync(visao),
    criarSecaoDeRepositoriosDoAutosync(visao),
    criarSecaoDoLogDoAutosync(),
  );
  return previa;
}

function renderizarAutosync() {
  renderizarUltimaAtualizacaoDoAutosync();
  const { visao, erroDeCarga } = estado.autosync;
  elementos.botaoInstalarAutosync.hidden = !visao || visao.instalado;

  if (!visao) {
    elementos.mountAutosync.replaceChildren(
      erroDeCarga
        ? criarElemento('p', 'aviso-shell', erroDeCarga)
        : criarElemento('p', 'secao-vazia', 'Carregando…'),
    );
    return;
  }

  const partes = [];
  if (erroDeCarga) {
    partes.push(criarElemento('p', 'aviso-shell', erroDeCarga));
  }

  if (!visao.instalado) {
    partes.push(criarPreviaDoAutosyncIndisponivel(visao));
    elementos.mountAutosync.replaceChildren(...partes);
    return;
  }

  partes.push(
    criarSecaoDeEstadoDoAutosync(visao),
    criarSecaoDeAgendamentoDoAutosync(visao),
    criarSecaoDaMensagemDoAutosync(visao),
    criarSecaoDeRepositoriosDoAutosync(visao),
    criarSecaoDoLogDoAutosync(),
  );
  elementos.mountAutosync.replaceChildren(...partes);
}

async function abrirVisualizacaoDoAutosync() {
  renderizarAutosync();
  await recarregarAutosync();
}

/* ---------------------------- aba do cliente ------------------------------- */

function criarLinhaDoAutosyncDoCliente(item) {
  const situacao = SITUACOES_DO_CLIENTE_NO_AUTOSYNC[item.situacao];
  const rotulo = item.raiz ? situacao.rotuloPelaRaiz(nomeDaPasta(item.raiz)) : situacao.rotulo;
  const pastaUtilizavel =
    item.situacao !== 'pasta-ausente' && item.situacao !== 'nao-e-repositorio';

  const extras = [];
  if (pastaUtilizavel) {
    extras.push(
      criarBotaoDeHistoricoDoAutosync(item.caminho),
      criarBotaoDePoliticaDoAutosync(item.caminho, item.repositorio?.politica ?? null),
    );
  }
  if (item.situacao === 'ativo') {
    extras.push(
      criarBotao('btn tiny danger', 'Tirar do Git AutoSync', () => tirarDoAutosync(item.caminho)),
    );
  } else if (pastaUtilizavel) {
    extras.push(
      criarBotao(
        'btn tiny primario',
        item.situacao === 'fora' ? 'Adicionar ao Git AutoSync' : 'Reativar no Git AutoSync',
        () => adicionarAoAutosync(item.caminho),
      ),
    );
  } else if (item.repositorio?.alvoProprio) {
    extras.push(
      criarBotao('btn tiny danger', 'Tirar do Git AutoSync', () => tirarDoAutosync(item.caminho)),
    );
  }

  return criarLinhaDoAutosync({
    caminho: item.caminho,
    titulo: nomeDaPasta(item.caminho),
    detalhe: item.url,
    selos: [criarSeloDoAutosync(situacao.severidade, rotulo)],
    estadoDoRepositorio: item.repositorio?.estado ?? null,
    acoesHabilitadas: pastaUtilizavel,
    extras,
  });
}

/**
 * Seção AutoSync da aba Git do cliente: só os repositórios dele com pasta local. É montada uma
 * vez por cliente (ver `secaoConsultadaDoCliente`) e se redesenha sozinha quando uma
 * ação termina, sem esperar o detalhe inteiro ser refeito.
 */
function criarSecaoDoAutosyncDoCliente(cliente) {
  const secao = criarElemento('div', 'secao-recursos');

  const desenhar = () => {
    const { visao, clientes, erroDeCarga } = estado.autosync;
    const cabecalho = criarElemento('div', 'secao-cabecalho');
    const botaoRecarregar = criarBotaoDeIcone(
      'btn tiny',
      ICONES.recarregar,
      'Atualizar o Git AutoSync',
      () => recarregarAutosync(),
    );
    const titulo = criarElemento('div', 'detalhe-titulo-com-subtitulo');
    titulo.append(
      criarElemento('h3', null, 'AutoSync'),
      criarElemento(
        'p',
        'texto-auxiliar',
        'Commit, push e sincronização dos repositórios deste cliente pelo Git AutoSync.',
      ),
    );
    cabecalho.append(titulo, botaoRecarregar);

    if (!visao || !clientes) {
      secao.replaceChildren(
        cabecalho,
        erroDeCarga
          ? criarElemento('p', 'aviso-shell', erroDeCarga)
          : criarElemento('p', 'secao-vazia', 'Carregando…'),
      );
      return;
    }

    if (!visao.instalado) {
      secao.replaceChildren(cabecalho, criarAvisoDeAutosyncNaoInstalado());
      return;
    }

    const doCliente = clientes.repositorios.filter((item) => item.clienteId === cliente.id);
    const semPasta = cliente.repositorios.filter((repositorio) => !repositorio.caminhoLocal);
    const partes = [cabecalho];

    if (doCliente.length === 0) {
      partes.push(
        criarElemento(
          'p',
          'secao-vazia',
          'Nenhum repositório deste cliente tem pasta local. Informe o caminho local na seção Repositórios, acima.',
        ),
      );
    } else {
      const lista = criarElemento('div', 'lista-recursos');
      lista.append(...doCliente.map(criarLinhaDoAutosyncDoCliente));
      partes.push(lista);
    }

    if (semPasta.length > 0 && doCliente.length > 0) {
      partes.push(
        criarElemento(
          'p',
          'texto-auxiliar',
          `${semPasta.length} repositório(s) sem pasta local ficam de fora.`,
        ),
      );
    }
    secao.replaceChildren(...partes);
  };

  estado.autosync.redesenharDoCliente = () => {
    // A seção de outro cliente fica guardada em memória, mas fora da tela.
    if (secao.isConnected) {
      desenhar();
    }
  };
  desenhar();
  void recarregarAutosync();
  return secao;
}

/* ----------------------------- modais ------------------------------------ */

function abrirModalDoCommitDoAutosync(caminho, modo) {
  estado.autosync.alvoDoCommit = { caminho, modo };
  const sincronizar = modo === 'sincronizar';
  elementos.tituloModalCommitAutosync.textContent = sincronizar ? 'Sincronizar' : 'Commit';
  elementos.subtituloModalCommitAutosync.textContent = sincronizar
    ? `Commit e push em ${caminho}.`
    : `Commit, sem push, em ${caminho}.`;
  elementos.botaoConfirmarCommitAutosync.textContent = sincronizar ? 'Sincronizar' : 'Commit';
  elementos.campoMensagemAutosync.value = '';
  limparErro(elementos.erroCommitAutosync);
  elementos.modalCommitAutosync.showModal();
  elementos.campoMensagemAutosync.focus();
}

async function gerarPreviaDoCommitDoAutosync() {
  const alvo = estado.autosync.alvoDoCommit;
  if (!alvo) {
    return;
  }

  limparErro(elementos.erroCommitAutosync);
  elementos.botaoPreviaAutosync.disabled = true;
  elementos.botaoPreviaAutosync.textContent = 'Gerando…';
  try {
    const previa = await api.previaNoAutosync(alvo.caminho);
    if (previa.semAlteracoes) {
      exibirErro(elementos.erroCommitAutosync, 'Não há alteração para commitar neste repositório.');
      return;
    }
    elementos.campoMensagemAutosync.value = previa.mensagem;
  } catch (erro) {
    exibirErro(elementos.erroCommitAutosync, erro.message);
  } finally {
    elementos.botaoPreviaAutosync.disabled = false;
    elementos.botaoPreviaAutosync.textContent = 'Gerar prévia';
  }
}

function confirmarCommitDoAutosync(evento) {
  evento.preventDefault();
  const alvo = estado.autosync.alvoDoCommit;
  if (!alvo) {
    return;
  }

  const mensagem = elementos.campoMensagemAutosync.value.trim();
  elementos.modalCommitAutosync.close();

  if (alvo.modo === 'sincronizar') {
    executarNoRepositorioDoAutosync(alvo.caminho, 'Sincronizar', () =>
      api.sincronizarNoAutosync(alvo.caminho, mensagem),
    );
  } else {
    executarNoRepositorioDoAutosync(alvo.caminho, 'Commit', () =>
      api.commitNoAutosync(alvo.caminho, mensagem),
    );
  }
}

function abrirModalDoMrDoAutosync(caminho) {
  estado.autosync.alvoDoMr = caminho;
  const ramoPadrao = estado.autosync.visao?.ramoDoMr ?? 'main';
  elementos.subtituloModalMrAutosync.textContent = caminho;
  elementos.campoTituloMrAutosync.value = '';
  elementos.campoDestinoMrAutosync.value = '';
  elementos.campoDestinoMrAutosync.placeholder = `Em branco: ${ramoPadrao}`;
  elementos.campoOrigemMrAutosync.value = '';
  limparErro(elementos.erroMrAutosync);
  elementos.modalMrAutosync.showModal();
}

function confirmarMrDoAutosync(evento) {
  evento.preventDefault();
  const caminho = estado.autosync.alvoDoMr;
  if (!caminho) {
    return;
  }

  const dados = {
    titulo: elementos.campoTituloMrAutosync.value.trim(),
    destino: elementos.campoDestinoMrAutosync.value.trim(),
    origem: elementos.campoOrigemMrAutosync.value.trim(),
  };
  elementos.modalMrAutosync.close();
  executarNoRepositorioDoAutosync(caminho, 'Merge Request', () =>
    api.mergeRequestNoAutosync(caminho, dados),
  );
}

function linhasDoCampo(campo) {
  return campo.value
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean);
}

function abrirModalDaPoliticaDoAutosync(caminho, politica) {
  estado.autosync.alvoDaPolitica = { caminho, politica: politica ?? {} };
  const atual = politica ?? {};
  elementos.subtituloModalPoliticaAutosync.textContent = caminho;
  elementos.campoIncludeAutosync.value = (atual.include ?? []).join('\n');
  elementos.campoExcludeAutosync.value = (atual.exclude ?? []).join('\n');
  elementos.campoRamosAutosync.value = (atual.allowedBranches ?? []).join('\n');
  elementos.campoMaxBytesAutosync.value = atual.maxFileBytes ?? '';
  elementos.campoIaRepositorioAutosync.value =
    atual.aiEnabled === undefined ? '' : atual.aiEnabled ? 'on' : 'off';
  limparErro(elementos.erroPoliticaAutosync);
  elementos.modalPoliticaAutosync.showModal();
}

/*
 * Só manda o que mudou: cada flag do `set-policy` substitui o campo inteiro, e uma
 * lista que ficou igual não precisa ser regravada.
 */
async function salvarPoliticaDoAutosync(evento) {
  evento.preventDefault();
  const alvo = estado.autosync.alvoDaPolitica;
  if (!alvo) {
    return;
  }

  const atual = alvo.politica;
  const iguais = (uma, outra) => (uma ?? []).join('\n') === (outra ?? []).join('\n');
  const dados = { caminho: alvo.caminho };

  const include = linhasDoCampo(elementos.campoIncludeAutosync);
  const exclude = linhasDoCampo(elementos.campoExcludeAutosync);
  const ramos = linhasDoCampo(elementos.campoRamosAutosync);
  if (!iguais(include, atual.include)) dados.include = include;
  if (!iguais(exclude, atual.exclude)) dados.exclude = exclude;
  if (!iguais(ramos, atual.allowedBranches)) dados.ramos = ramos;

  const maxBytes = elementos.campoMaxBytesAutosync.value.trim();
  if (maxBytes !== '' && Number(maxBytes) !== atual.maxFileBytes) {
    const numero = Number(maxBytes);
    if (!Number.isInteger(numero) || numero < 1) {
      exibirErro(elementos.erroPoliticaAutosync, 'O tamanho máximo deve ser um inteiro positivo.');
      return;
    }
    dados.maxBytes = numero;
  }

  const ia = elementos.campoIaRepositorioAutosync.value;
  const iaAtual = atual.aiEnabled === undefined ? '' : atual.aiEnabled ? 'on' : 'off';
  if (ia !== '' && ia !== iaAtual) dados.ia = ia;

  limparErro(elementos.erroPoliticaAutosync);
  elementos.botaoSalvarPoliticaAutosync.disabled = true;
  try {
    await api.definirPoliticaNoAutosync(dados);
    elementos.modalPoliticaAutosync.close();
    exibirAviso('Política gravada.');
    await recarregarAutosync();
  } catch (erro) {
    exibirErro(elementos.erroPoliticaAutosync, erro.message);
  } finally {
    elementos.botaoSalvarPoliticaAutosync.disabled = false;
  }
}

function formatarDataDoCommit(data) {
  const convertida = new Date(data);
  return Number.isNaN(convertida.getTime()) ? data : convertida.toLocaleString('pt-BR');
}

async function abrirHistoricoDoAutosync(caminho) {
  elementos.subtituloModalHistoricoAutosync.textContent = caminho;
  elementos.mountHistoricoAutosync.replaceChildren(
    criarElemento('p', 'secao-vazia', 'Carregando…'),
  );
  elementos.modalHistoricoAutosync.showModal();

  try {
    const { commits } = await api.historicoNoAutosync(caminho);
    if (commits.length === 0) {
      elementos.mountHistoricoAutosync.replaceChildren(
        criarElemento('p', 'secao-vazia', 'Nenhum commit neste repositório.'),
      );
      return;
    }

    const lista = criarElemento('ul', 'historico-do-autosync');
    for (const commit of commits) {
      const item = criarElemento('li');
      item.append(
        criarElemento('code', null, commit.hash.slice(0, 8)),
        criarElemento('span', 'texto-auxiliar', formatarDataDoCommit(commit.date)),
        criarElemento('span', null, commit.message),
      );
      lista.append(item);
    }
    elementos.mountHistoricoAutosync.replaceChildren(lista);
  } catch (erro) {
    elementos.mountHistoricoAutosync.replaceChildren(
      criarElemento('p', 'aviso-shell', erro.message),
    );
  }
}

/**
 * O botão Instalar pergunta pelo Git antes de abrir o diálogo: sem ele a instalação seria
 * recusada só depois de a pessoa escolher as opções.
 */
async function iniciarInstalacaoDoAutosync() {
  const botao = elementos.botaoInstalarAutosync;
  botao.disabled = true;
  try {
    const git = await api.gitDaMaquina();
    if (git.instalado) {
      abrirModalDeInstalacaoDoAutosync();
    } else {
      abrirModalSemGitDoAutosync();
    }
  } catch (erro) {
    exibirAviso(erro.message, 'erro');
  } finally {
    botao.disabled = false;
  }
}

function abrirModalSemGitDoAutosync() {
  limparErro(elementos.erroSemGitAutosync);
  if (!elementos.modalSemGitAutosync.open) {
    elementos.modalSemGitAutosync.showModal();
  }
}

async function verificarGitDeNovoParaOAutosync() {
  const botao = elementos.botaoVerificarGitAutosync;
  limparErro(elementos.erroSemGitAutosync);
  botao.disabled = true;
  botao.textContent = 'Verificando…';
  try {
    const git = await api.gitDaMaquina();
    if (git.instalado) {
      elementos.modalSemGitAutosync.close();
      abrirModalDeInstalacaoDoAutosync();
      return;
    }
    exibirErro(
      elementos.erroSemGitAutosync,
      'O Git ainda não foi encontrado. Se acabou de instalá-lo, reinicie o HUB SNK.',
    );
  } catch (erro) {
    exibirErro(elementos.erroSemGitAutosync, erro.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Verificar de novo';
  }
}

function abrirModalDeInstalacaoDoAutosync() {
  elementos.campoHorarioInstalacaoAutosync.value = '17:30';
  elementos.campoBandejaInstalacaoAutosync.checked = false;
  elementos.campoAtalhosInstalacaoAutosync.checked = true;
  elementos.campoSkillsInstalacaoAutosync.checked = false;
  elementos.campoPathInstalacaoAutosync.checked = false;
  limparErro(elementos.erroInstalacaoAutosync);
  elementos.modalInstalacaoAutosync.showModal();
}

async function instalarAutosync(evento) {
  evento.preventDefault();
  const horario = elementos.campoHorarioInstalacaoAutosync.value;
  const dados = {
    ...(horario ? { horario } : {}),
    bandeja: elementos.campoBandejaInstalacaoAutosync.checked,
    atalhos: elementos.campoAtalhosInstalacaoAutosync.checked,
    skills: elementos.campoSkillsInstalacaoAutosync.checked,
    path: elementos.campoPathInstalacaoAutosync.checked,
  };

  limparErro(elementos.erroInstalacaoAutosync);
  elementos.botaoConfirmarInstalacaoAutosync.disabled = true;
  elementos.botaoConfirmarInstalacaoAutosync.textContent = 'Instalando…';
  try {
    await api.instalarAutosync(dados);
    elementos.modalInstalacaoAutosync.close();
    exibirAviso('Git AutoSync instalado.');
    await recarregarAutosync();
  } catch (erro) {
    if (erro.gitAusente) {
      elementos.modalInstalacaoAutosync.close();
      abrirModalSemGitDoAutosync();
      return;
    }
    exibirErro(elementos.erroInstalacaoAutosync, erro.message);
  } finally {
    elementos.botaoConfirmarInstalacaoAutosync.disabled = false;
    elementos.botaoConfirmarInstalacaoAutosync.textContent = 'Instalar';
  }
}

function registrarEventosDoAutosync() {
  elementos.botaoVisualizacaoAutosync.addEventListener('click', () =>
    alternarVisualizacao('autosync'),
  );
  elementos.botaoAtualizarAutosync.append(criarIcone(ICONES.recarregar));
  elementos.botaoAtualizarAutosync.addEventListener('click', () => recarregarAutosync());
  elementos.botaoConfiguracaoAutosync.append(criarIcone(ICONES.engrenagem));
  elementos.botaoConfiguracaoAutosync.addEventListener('click', abrirConfiguracaoDoAutosync);
  elementos.formularioConfiguracaoAutosync.addEventListener('submit', salvarConfiguracaoDoAutosync);
  elementos.botaoCancelarConfiguracaoAutosync.addEventListener('click', () =>
    elementos.modalConfiguracaoAutosync.close(),
  );
  elementos.botaoSobreAutosync.append(criarIcone(ICONES.info));
  elementos.botaoSobreAutosync.addEventListener('click', () =>
    elementos.modalSobreAutosync.showModal(),
  );
  elementos.botaoFecharSobreAutosync.addEventListener('click', () =>
    elementos.modalSobreAutosync.close(),
  );
  elementos.botaoInstalarAutosync.addEventListener('click', iniciarInstalacaoDoAutosync);
  elementos.botaoVerificarGitAutosync.addEventListener('click', verificarGitDeNovoParaOAutosync);
  elementos.botaoFecharSemGitAutosync.addEventListener('click', () =>
    elementos.modalSemGitAutosync.close(),
  );

  elementos.formularioCommitAutosync.addEventListener('submit', confirmarCommitDoAutosync);
  elementos.botaoPreviaAutosync.addEventListener('click', gerarPreviaDoCommitDoAutosync);
  elementos.botaoCancelarCommitAutosync.addEventListener('click', () =>
    elementos.modalCommitAutosync.close(),
  );

  elementos.formularioMrAutosync.addEventListener('submit', confirmarMrDoAutosync);
  elementos.botaoCancelarMrAutosync.addEventListener('click', () =>
    elementos.modalMrAutosync.close(),
  );

  elementos.formularioPoliticaAutosync.addEventListener('submit', salvarPoliticaDoAutosync);
  elementos.botaoCancelarPoliticaAutosync.addEventListener('click', () =>
    elementos.modalPoliticaAutosync.close(),
  );

  elementos.botaoFecharHistoricoAutosync.addEventListener('click', () =>
    elementos.modalHistoricoAutosync.close(),
  );

  elementos.formularioInstalacaoAutosync.addEventListener('submit', instalarAutosync);
  elementos.botaoCancelarInstalacaoAutosync.addEventListener('click', () =>
    elementos.modalInstalacaoAutosync.close(),
  );

  elementos.botaoConfirmarConfirmacaoAutosync.addEventListener('click', confirmarNoAutosync);
  elementos.botaoCancelarConfirmacaoAutosync.addEventListener('click', () => {
    estado.autosync.confirmacaoPendente = null;
    elementos.modalConfirmacaoAutosync.close();
  });
}

function registrarEventos() {
  elementos.botaoNovoCliente.append(criarIcone(ICONES.mais));
  elementos.botaoNovoCliente.addEventListener('click', abrirModalDeCadastro);
  atualizarIconeDoTema();
  elementos.botaoTema.addEventListener('click', alternarTema);

  elementos.botaoVisualizacaoResumo.addEventListener('click', () => alternarVisualizacao('resumo'));
  elementos.botaoVisualizacaoClientes.addEventListener('click', () =>
    alternarVisualizacao('clientes'),
  );
  elementos.botaoVisualizacaoLocal.addEventListener('click', () => alternarVisualizacao('local'));
  elementos.botaoVisualizacaoAgenda.addEventListener('click', () => alternarVisualizacao('agenda'));
  elementos.botaoVisualizacaoOs.addEventListener('click', () => alternarVisualizacao('os'));
  elementos.botaoVisualizacaoContatos.addEventListener('click', () =>
    alternarVisualizacao('contatos'),
  );
  elementos.botaoVisualizacaoLembretes.addEventListener('click', () =>
    alternarVisualizacao('lembretes'),
  );
  registrarEventosDasNotificacoes();
  registrarEventosDoAutosync();
  registrarEventosDoLembrete();
  registrarEventosDosContatos();
  elementos.botaoAtualizarAgenda.append(criarIcone(ICONES.recarregar));
  elementos.botaoAtualizarAgenda.addEventListener('click', atualizarAgendaGeral);
  elementos.botaoLancarOcorrencia.addEventListener('click', abrirModalDeOcorrencia);
  elementos.formularioOcorrencia.addEventListener('submit', salvarOcorrencia);
  elementos.botaoCancelarOcorrencia.addEventListener('click', () =>
    elementos.modalOcorrencia.close(),
  );
  elementos.mountAgendaGeral.append(widgetAgendaGeral.elemento);
  elementos.botaoAtualizarOs.append(criarIcone(ICONES.recarregar));
  elementos.botaoAtualizarOs.addEventListener('click', atualizarOsGeral);
  elementos.mountOsGeral.append(widgetOsGeral.elemento);

  elementos.botaoAtalhos.append(criarIcone(ICONES.raio));
  elementos.botaoAtalhos.addEventListener('click', alternarListaDeAtalhos);
  registrarEventosDaBuscaRapida();

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

  elementos.botaoCredenciaisSankhya.append(criarIcone(ICONES.cadeado));
  elementos.botaoCredenciaisSankhya.addEventListener('click', abrirModalDeCredenciaisSankhya);
  elementos.botaoSalvarCodusu.addEventListener('click', salvarCodusuSankhyaOm);
  elementos.botaoFecharCredenciaisSankhya.addEventListener('click', () =>
    elementos.modalCredenciaisSankhya.close(),
  );
  for (const cartaoElementos of cartoesDeCredenciaisSankhya()) {
    registrarEventosDoCartaoDeCredencial(cartaoElementos);
  }

  elementos.botaoConfiguracao.append(criarIcone(ICONES.engrenagem));
  elementos.botaoConfiguracao.addEventListener('click', abrirModalDeConfiguracao);
  elementos.formularioConfiguracao.addEventListener('submit', salvarConfiguracao);
  elementos.abaConfiguracaoGeral.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoGeral),
  );
  elementos.abaConfiguracaoMcp.addEventListener('click', () => {
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoMcp);
    if (funcionalidadeVisivel('cliente.projetos')) {
      void kanban.carregarMcpDaConfiguracao();
    }
  });
  elementos.abaConfiguracaoAtalhos.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoAtalhos),
  );
  elementos.abaConfiguracaoSmtp.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoSmtp),
  );
  elementos.abaConfiguracaoAvisos.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoAvisos),
  );
  elementos.abaConfiguracaoAcessos.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoAcessos),
  );
  elementos.botaoVerSenhaSmtp.addEventListener('click', () =>
    definirVisibilidadeDoCampo(
      elementos.campoSmtpSenha,
      elementos.botaoVerSenhaSmtp,
      elementos.campoSmtpSenha.type === 'password',
    ),
  );
  elementos.botaoTestarSmtp.addEventListener('click', testarSmtp);
  elementos.abaConfiguracaoIa.addEventListener('click', () => {
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoIa);
    void carregarAssistentesDeIa();
  });
  elementos.campoAssistenteIa.addEventListener('change', () =>
    aplicarAssistenteEscolhido({ trocouDeAssistente: true }),
  );
  elementos.campoModeloIa.addEventListener('change', aplicarModeloEscolhido);
  elementos.campoModeloIaOutro.addEventListener('input', () => {
    modeloDeIaEscolhido = elementos.campoModeloIaOutro.value;
    desenharRaciocinioDeIa(situacaoDoAssistenteDeIaEscolhido(), false);
  });
  elementos.campoRaciocinioIa.addEventListener('change', () => {
    raciocinioDeIaEscolhido = elementos.campoRaciocinioIa.value;
  });
  elementos.botaoAtualizarAssistentesIa.addEventListener('click', () =>
    carregarAssistentesDeIa(true),
  );
  elementos.botaoVerTokenGitlab.addEventListener('click', () =>
    definirVisibilidadeDoCampo(
      elementos.campoGitlabToken,
      elementos.botaoVerTokenGitlab,
      elementos.campoGitlabToken.type === 'password',
    ),
  );
  elementos.botaoRemoverTokenGitlab.addEventListener('click', removerTokenDoGitlab);
  elementos.campoPerfil.addEventListener('change', aplicarPresetDoPerfil);
  elementos.campoTerceiro.addEventListener('change', bloquearCaixasQueDependemDoSankhya);
  elementos.abaConfiguracaoSobre.addEventListener('click', () =>
    selecionarAbaDaConfiguracao(elementos.abaConfiguracaoSobre),
  );
  elementos.botaoAdicionarAtalho.addEventListener('click', () => {
    const linha = adicionarLinhaDeAtalho({ id: '', nome: '', caminhoDoExecutavel: '' });
    linha.querySelector('input').focus();
  });
  elementos.botaoAdicionarNomeCompleto.addEventListener('click', () => {
    // Reaproveita a linha em branco: cliques repetidos não podem empilhar campos vazios.
    const campoVazio = buscarCampoDeNomeCompletoVazio();
    if (campoVazio) {
      campoVazio.focus();
      return;
    }

    if (elementos.listaNomesCompletosCliente.children.length >= MAXIMO_DE_NOMES_COMPLETOS) {
      exibirErro(
        elementos.erroCliente,
        `No máximo ${MAXIMO_DE_NOMES_COMPLETOS} nomes completos por cliente.`,
      );
      return;
    }

    const linha = adicionarLinhaDeNomeCompleto('');
    linha.querySelector('input').focus();
  });
  elementos.botaoSelecionarExecutavelDaIde.append(criarIcone(ICONES.pasta));
  elementos.botaoSelecionarExecutavelDaIde.addEventListener('click', () =>
    escolherExecutavelDoAtalho(
      elementos.campoCaminhoExecutavelDaIde,
      elementos.botaoSelecionarExecutavelDaIde,
    ),
  );
  elementos.botaoCancelarConfiguracao.addEventListener('click', () =>
    elementos.modalConfiguracao.close(),
  );
  elementos.botaoImportarEnvMcp.addEventListener('click', importarEnvDoMcpGlobal);
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
  elementos.botoesDeCopiarDoBanco.forEach((botao) => {
    botao.append(criarIcone(ICONES.copiar));
    botao.addEventListener('click', () => copiarCampoDoBanco(botao));
  });
  elementos.campoSgbd.addEventListener('change', aplicarPortaPadraoDoSgbd);
  elementos.formularioBanco.addEventListener('input', atualizarCamposDoSgbd);

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

  elementos.formularioProjeto.addEventListener('submit', salvarProjeto);
  elementos.botaoCancelarProjeto.addEventListener('click', () => elementos.modalProjeto.close());

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

/*
 * O HUB SNK deixou de ser PWA: roda dentro do app desktop. Quem abrir o painel
 * num navegador que ainda guarda o service worker da versão antiga ficaria
 * preso ao cache dela, então o registro remanescente é desfeito aqui.
 */
async function removerServiceWorkerDaVersaoPwa() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  try {
    const registros = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registros.map((registro) => registro.unregister()));
  } catch (erro) {
    console.error('Falha ao remover o service worker da versão PWA:', erro);
  }
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
  void removerServiceWorkerDaVersaoPwa();
  void exibirVersaoNoRodape();
  void exibirAvisoDeVersaoNova();

  let clientesCarregados = false;
  try {
    await recarregarClientes();
    clientesCarregados = true;
  } catch (erro) {
    exibirAviso(`Não foi possível carregar os clientes: ${erro.message}`, 'erro');
  }
  // A aba Contatos do cliente e o modal do lembrete leem daqui, sem consulta própria.
  void carregarContatos().then(renderizarDetalhe);

  try {
    const configuracao = await api.lerConfiguracao();
    definirExecucaoAutomatica(
      configuracao.intervaloDeExecucaoAutomaticaSegundos ??
        INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S,
    );
    estado.atalhos = configuracao.atalhos ?? [];
    estado.ideConfigurada = Boolean(configuracao.caminhoDoExecutavelDaIde);
    aplicarAcessos(configuracao);
  } catch {
    // Sem a configuração, vale o padrão — não é motivo para outro aviso na tela.
    definirExecucaoAutomatica(INTERVALO_DE_EXECUCAO_AUTOMATICA_PADRAO_S);
  }

  // Cadastro vazio é a primeira abertura: começa pelos clientes e, quem acessa o
  // Sankhya, pelas credenciais. Falha ao ler não conta como vazio.
  if (clientesCarregados && estado.clientes.length === 0) {
    alternarVisualizacao('clientes');
    if (!estado.terceiro) {
      abrirModalDeCredenciaisSankhya();
    }
  }

  renderizarListaDeAtalhos();
  // O selo "sem OS" da agenda do Resumo sai das notificações: redesenha quando elas chegam.
  void carregarNotificacoes().then(renderizarResumoSeVisivel);
  conectarFluxoDeNotificacoes();
}

const kanban = iniciarKanban({
  requisitar,
  criarElemento,
  criarBotao,
  criarBotaoDeIcone,
  ICONES,
  exibirAviso,
  exibirErro,
  limparErro,
  pedirExclusao,
  recarregarClientes,
  selecionarPasta: () => api.selecionarPasta(),
  clienteSelecionado,
  excluirProjetoSemKanban: pedirExclusaoDeProjetoSemKanban,
});

iniciar();
