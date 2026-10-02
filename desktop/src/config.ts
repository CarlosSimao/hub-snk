/**
 * Constantes e caminhos do shell desktop. Tudo sobrescrevível por variável de
 * ambiente — os defaults são os mesmos endereços que o backend do HUB SNK usa, para
 * não haver um segundo conjunto de URLs "corretas".
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';

/*
 * `127.0.0.1`, não `localhost`: o backend escuta só no IPv4 de loopback, e
 * `localhost` pode resolver para `::1` primeiro e levar a conexão recusada.
 */
export const HUB_URL = process.env['SANKHYA_HUB_URL'] ?? 'http://127.0.0.1:4100';
export const ERP_URL = process.env['SANKHYA_ERP_URL'] ?? 'https://skw.sankhya.com.br/mge/';
export const EXPERIENCE_URL =
  process.env['SANKHYA_EXPERIENCE_URL'] ?? 'https://experience.sankhya.com.br/';

/**
 * Workspace do SankhyaOm: é para onde o login aceito leva. A senha é pedida na própria
 * `/mge/`, então sair da tela de login não aparece na URL de outro jeito.
 */
export const URL_WORKSPACE_ERP = new URL('system.jsp', ERP_URL).href;

/** Domínios cujos cookies confirmam o login no ERP — nunca saem do processo. */
export const DOMINIOS_ERP = ['sankhya.com.br'];

/**
 * Onde o login do SankhyaOm e da Experience acontece (skw, login e experience, todos sob
 * `sankhya.com.br`), mais os hosts de `ERP_URL` e `EXPERIENCE_URL` quando sobrescritos.
 * O preenchimento automático só entrega a credencial do cofre a uma página desses hosts.
 */
export const HOSTS_DE_LOGIN_SANKHYA = [
  'sankhya.com.br',
  new URL(ERP_URL).hostname,
  new URL(EXPERIENCE_URL).hostname,
];

/** Domínios autorizados a abrir pop-up de dentro das abas remotas (SSO). */
export const DOMINIOS_POPUP_PERMITIDOS = [
  'sankhya.com.br',
  'login.microsoftonline.com',
  'accounts.google.com',
  'amazonaws.com',
];

/** Partição isolada e persistente do shell — nunca o perfil pessoal do usuário. */
export const PARTICAO = 'persist:sankhya-hub-desktop';

/**
 * Partição das guias avulsas do `+`: persistente como a de um navegador, mas nunca a do
 * Sankhya — um site qualquer aberto ali não pode ver o cookie do ERP nem o token da
 * Experience.
 */
export const PARTICAO_AVULSA = 'persist:hub-navegacao-avulsa';

/** Página com que toda guia avulsa abre. */
export const URL_INICIAL_AVULSA = 'https://www.google.com/';

// --- painel de comunicação ---------------------------------------------------------

export type ServicoComunicacao = 'whatsapp' | 'gmail' | 'chat';

/**
 * De onde sai o aviso de mensagem nova (som, ícone piscando, contador). Cada serviço
 * expõe uma coisa diferente:
 * - `titulo`: a quantidade está no título da página (`padrao` captura o número);
 * - `favicon`: o ícone da aba muda quando há não lidas, sem dizer quantas;
 * - `feed`: um endereço que devolve a contagem, consultado de tempos em tempos com os
 *   cookies da sessão — funciona sem a página do serviço carregada.
 */
export type SinalDeMensagem =
  | { origem: 'titulo'; padrao: RegExp }
  | { origem: 'favicon'; padrao: RegExp }
  | { origem: 'feed'; url: string; padrao: RegExp; intervaloMs: number };

interface DefinicaoServicoComunicacao {
  /** Nome no menu de escolha dos botões da barra lateral. */
  rotulo: string;
  url: string;
  particao: string;
  sinal: SinalDeMensagem;
  /**
   * Se o HUB toca o próprio som na mensagem nova. Falso quando a página do serviço já
   * toca o dela — os dois juntos soam como duas mensagens.
   */
  tocarSom: boolean;
}

/** O feed do Gmail é leve (um XML pequeno), mas não precisa ser mais que por minuto. */
const INTERVALO_FEED_GMAIL_MS = 60_000;

/**
 * Gmail e Google Chat dividem a partição: é a mesma conta Google, então um login só serve
 * os dois. Nenhuma delas é a `PARTICAO` das guias — o cookie pessoal do Google não chega
 * ao Sankhya, e o do Sankhya não chega ao Google.
 */
const PARTICAO_GOOGLE = 'persist:hub-google';

export const SERVICOS_COMUNICACAO: Record<ServicoComunicacao, DefinicaoServicoComunicacao> = {
  whatsapp: {
    rotulo: 'WhatsApp',
    url: 'https://web.whatsapp.com/',
    particao: 'persist:hub-whatsapp',
    // O WhatsApp Web escreve `(3) WhatsApp` no título: 3 conversas, não 3 mensagens.
    sinal: { origem: 'titulo', padrao: /^\((\d+)\)/ },
    // O WhatsApp Web toca o som dele junto com a notificação do Windows.
    tocarSom: false,
  },
  gmail: {
    rotulo: 'Gmail',
    url: 'https://mail.google.com/',
    particao: PARTICAO_GOOGLE,
    // O título do Gmail perde a contagem ao abrir um e-mail; o feed Atom da caixa de
    // entrada sempre traz `<fullcount>`, com a página aberta ou não.
    sinal: {
      origem: 'feed',
      url: 'https://mail.google.com/mail/u/0/feed/atom',
      padrao: /<fullcount>(\d+)<\/fullcount>/,
      intervaloMs: INTERVALO_FEED_GMAIL_MS,
    },
    // A notificação do e-mail é do HUB e sai muda: o som é este.
    tocarSom: true,
  },
  chat: {
    rotulo: 'Google Chat',
    url: 'https://chat.google.com/',
    particao: PARTICAO_GOOGLE,
    // O título do Chat nunca tem contagem. O favicon sem não lidas é o
    // `..._favicon_no_dot_64px.png`; com não lidas, a variante com o ponto.
    sinal: { origem: 'favicon', padrao: /(?<!no)_dot_/ },
    tocarSom: true,
  },
};

/**
 * Hosts que abrem dentro do próprio painel quando a página pede uma janela nova: o login
 * do Google (o "Fazer login" da página de apresentação do Gmail abre em outra janela) e
 * os próprios serviços. O resto vai para o navegador padrão.
 */
export const HOSTS_INTERNOS_COMUNICACAO: ReadonlySet<string> = new Set([
  'accounts.google.com',
  'mail.google.com',
  'chat.google.com',
  'web.whatsapp.com',
]);

/** O painel ocupa a maior parte da janela, sem ficar estreito demais para o WhatsApp Web. */
export const FRACAO_LARGURA_PAINEL_COMUNICACAO = 0.8;
export const LARGURA_MINIMA_PAINEL_COMUNICACAO = 480;

/**
 * Sem handler, o Electron concede qualquer permissão pedida. Só o que os três serviços
 * usam: notificação de mensagem, microfone/câmera (áudio do WhatsApp, chamada do Chat),
 * cópia para a área de transferência e tela cheia de vídeo.
 */
export const PERMISSOES_COMUNICACAO: ReadonlySet<string> = new Set([
  'notifications',
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
]);

/**
 * Identidade do app no Windows (AppUserModelID): é ela que dá o nome e o ícone no topo
 * das notificações. Empacotado, precisa ser o `appId` de `electron-builder.yml`, que o
 * instalador grava no atalho. Em desenvolvimento não há atalho, então o id é outro e o
 * nome é registrado à parte — ver `definirIdentidadeNasNotificacoes` no `main.ts`.
 */
export const ID_DO_APP_WINDOWS = app.isPackaged
  ? 'br.dev.hubsnk.desktop'
  : 'br.dev.hubsnk.desktop.desenvolvimento';

export const BRIDGE_PORT = Number(process.env['SANKHYA_DESKTOP_BRIDGE_PORT'] ?? 4103);
export const BRIDGE_HOST = '127.0.0.1';

/**
 * Pasta do token da ponte: o shell o grava aqui, e o backend o acha pelo mesmo padrão
 * (`src/configuracao.ts`).
 */
export const PASTA_IPC =
  process.env['SANKHYA_HUB_IPC_DIR'] ?? join(app.getPath('appData'), 'sankhya-hub', 'ipc');
export const ARQUIVO_TOKEN_BRIDGE = join(PASTA_IPC, 'desktop-token.txt');

// --- backend hospedado pelo shell --------------------------------------------------

/**
 * `externo` desliga o gerenciamento: o shell não sobe backend nenhum e só espera alguém
 * atender em `HUB_URL`. É o modo de quem desenvolve o backend com `npm run dev` numa
 * janela e o shell noutra.
 */
export const MODO_BACKEND = (process.env['SANKHYA_HUB_BACKEND'] ?? 'gerenciado').toLowerCase();

/** Porta que o backend abre — derivada de `HUB_URL` para não haver dois valores a manter. */
export const PORTA_HUB = Number(new URL(HUB_URL).port || '4100');

/**
 * Raiz do checkout do hub (onde vivem `src/`, `public/` e `node_modules/`).
 *
 * Em desenvolvimento `__dirname` é `desktop/dist`, então dois níveis acima é o repo.
 * Empacotado, o backend vai para `resources/hub` (ver `electron-builder.yml`).
 */
export const RAIZ_PROJETO =
  process.env['SANKHYA_HUB_RAIZ'] ??
  (app.isPackaged ? join(process.resourcesPath, 'hub') : join(__dirname, '..', '..'));

/**
 * O backend roda direto do TypeScript, sem build: o Node embutido no Electron faz o
 * type stripping sozinho.
 */
export const ENTRYPOINT_BACKEND = join(RAIZ_PROJETO, 'src', 'index.ts');

/**
 * Caminho que o instalador deixa em `HubSnk\pasta-de-dados.txt` quando a instalação PWA
 * antiga guardava o cadastro fora do padrão (`desktop/instalador/remover-versao-pwa.ps1`).
 * O `trim()` também descarta o BOM que o PowerShell 5.1 grava no início do arquivo.
 */
function pastaDeDadosEscolhidaNaVersaoPwa(pastaDeEstado: string): string {
  try {
    return readFileSync(join(pastaDeEstado, 'pasta-de-dados.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

/** `%LOCALAPPDATA%\HubSnk`: onde o instalador NSIS deixa o que o aplicativo lê depois. */
function pastaDeEstadoDoInstalador(): string {
  return join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), 'HubSnk');
}

/**
 * Pasta de dados empacotada: a mesma que a instalação PWA antiga usava, para quem
 * atualiza não perder o cadastro nem precisar de migração.
 */
function pastaDeDadosInstalada(): string {
  if (process.platform === 'win32') {
    const pastaDeEstado = pastaDeEstadoDoInstalador();
    return pastaDeDadosEscolhidaNaVersaoPwa(pastaDeEstado) || join(pastaDeEstado, 'dados');
  }
  return join(
    process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'),
    'hub-snk',
    'dados',
  );
}

/**
 * Cadastro do HUB SNK (`clientes.json`, `sankhya.db` e companhia). Em desenvolvimento é o
 * `dados-hub-snk/` do repo, o mesmo padrão do `npm start`. Empacotado fica fora da pasta
 * de instalação, que é substituída a cada atualização.
 */
export const DIRETORIO_DE_DADOS =
  process.env['HUB_DADOS_DIR'] ??
  (app.isPackaged ? pastaDeDadosInstalada() : join(RAIZ_PROJETO, 'dados-hub-snk'));

/**
 * Escolha feita na página do perfil do instalador (`assets/installer.nsh`), num arquivo
 * de `HubSnk\`. Só o instalador do Windows pergunta; fora dele, e sem o arquivo, volta
 * vazio e o backend aplica o padrão. Quem valida o valor é o backend.
 */
function escolhaDoInstalador(nomeDoArquivo: string): string {
  return escolhaOpcionalDoInstalador(nomeDoArquivo) ?? '';
}

/** Como `escolhaDoInstalador`, mas sem o arquivo volta `undefined`: vazio também é escolha. */
function escolhaOpcionalDoInstalador(nomeDoArquivo: string): string | undefined {
  if (!app.isPackaged || process.platform !== 'win32') return undefined;
  try {
    return readFileSync(join(pastaDeEstadoDoInstalador(), nomeDoArquivo), 'utf8').trim();
  } catch {
    return undefined;
  }
}

/**
 * `HubSnk\` do app instalado, repassado ao backend: a instalação do Git AutoSync pela
 * aba Git deixa ali o script e a marca que a desinstalação do HUB SNK usa para removê-lo
 * junto. Vazio em desenvolvimento, para não oferecer remoção de instalação de teste.
 */
export const PASTA_DO_INSTALADOR =
  app.isPackaged && process.platform === 'win32' ? pastaDeEstadoDoInstalador() : '';

export const PERFIL_INICIAL =
  process.env['HUB_PERFIL_INICIAL'] ?? escolhaDoInstalador('perfil-inicial.txt');

/** Caixa Terceiro do instalador: `S` marcada, `N` ou vazio desmarcada. */
export const TERCEIRO_INICIAL =
  process.env['HUB_TERCEIRO_INICIAL'] ?? escolhaDoInstalador('terceiro-inicial.txt');

/**
 * Caixas desmarcadas na página do perfil do instalador, separadas por vírgula. Vazio
 * é "nenhuma oculta"; `undefined` (instalação anterior à página) deixa valer o preset.
 */
export const FUNCIONALIDADES_OCULTAS_INICIAIS =
  process.env['HUB_FUNCIONALIDADES_OCULTAS_INICIAIS'] ??
  escolhaOpcionalDoInstalador('funcionalidades-ocultas-inicial.txt');

export const TZ_PADRAO = 'America/Sao_Paulo';

/**
 * Ícone da janela e da barra de tarefas. Sem isto o Windows mostra o ícone padrão do
 * Electron, que é o que denuncia "isto é um app genérico" antes de qualquer outra coisa.
 * O mesmo arquivo é o ícone do instalador.
 */
export const ICONE = join(
  __dirname,
  '..',
  'assets',
  // O `.ico` é formato do Windows: no Linux ele não é reconhecido e a janela volta para o
  // ícone genérico do Electron. O `.png` é extraído do próprio `.ico` (256x256, a maior
  // imagem que ele carrega), então é o mesmo desenho nos dois sistemas.
  process.platform === 'win32' ? 'hub-snk.ico' : 'hub-snk.png',
);

/**
 * User agent das abas remotas, sem `Electron/x.y.z` nem o nome do app.
 *
 * O padrão do Electron anuncia os dois, e página que detecta Electron costuma tentar
 * `require(...)` para "integrar" — como `contextIsolation` está ligado (e deve estar),
 * `require` não existe e a página quebra com um alert. Anunciar-se como Chrome comum é
 * a correção padrão: nada aqui depende de a página saber que é Electron.
 */
export function userAgentLimpo(padrao: string): string {
  // O nome do app entra por `RegExp` porque é dinâmico; escapado para não virar padrão
  // por acidente se algum dia tiver ponto ou hífen com significado em regex.
  const nome = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return padrao
    .replace(/\s*Electron\/[\d.]+/i, '')
    .replace(new RegExp(`\\s*${nome}\\/[\\d.]+`, 'i'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
