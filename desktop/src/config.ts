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

// --- painel de comunicação ---------------------------------------------------------

export type ServicoComunicacao = 'whatsapp' | 'gmail' | 'chat';

interface DefinicaoServicoComunicacao {
  /** Nome no menu de escolha dos botões da barra lateral. */
  rotulo: string;
  url: string;
  particao: string;
  /**
   * Onde o título da página traz a quantidade de conversas não lidas — só o serviço que
   * tem este campo avisa mensagem nova (som, ícone piscando, contador).
   */
  padraoNaoLidas?: RegExp;
}

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
    padraoNaoLidas: /^\((\d+)\)/,
  },
  gmail: { rotulo: 'Gmail', url: 'https://mail.google.com/', particao: PARTICAO_GOOGLE },
  chat: { rotulo: 'Google Chat', url: 'https://chat.google.com/', particao: PARTICAO_GOOGLE },
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
  if (!app.isPackaged || process.platform !== 'win32') return '';
  try {
    return readFileSync(join(pastaDeEstadoDoInstalador(), nomeDoArquivo), 'utf8').trim();
  } catch {
    return '';
  }
}

export const PERFIL_INICIAL =
  process.env['HUB_PERFIL_INICIAL'] ?? escolhaDoInstalador('perfil-inicial.txt');

/** Caixa Terceiro do instalador: `S` marcada, `N` ou vazio desmarcada. */
export const TERCEIRO_INICIAL =
  process.env['HUB_TERCEIRO_INICIAL'] ?? escolhaDoInstalador('terceiro-inicial.txt');

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
