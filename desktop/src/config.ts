/**
 * Constantes e caminhos do shell desktop. Tudo sobrescrevível por variável de
 * ambiente — os defaults são os mesmos endereços que o backend do HUB SNK e o
 * `hub-helper.ps1` já usam, para não haver um segundo conjunto de URLs "corretas".
 */
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
export const EXPERIENCE_API =
  process.env['SANKHYA_EXPERIENCE_API'] ??
  'https://d83n39pk6d.execute-api.sa-east-1.amazonaws.com/prod';

/** Domínios cujos cookies interessam ao diagnóstico local do ERP — nunca saem do processo. */
export const DOMINIOS_ERP = ['sankhya.com.br'];

/** Domínios autorizados a abrir pop-up de dentro das abas remotas (SSO). */
export const DOMINIOS_POPUP_PERMITIDOS = [
  'sankhya.com.br',
  'login.microsoftonline.com',
  'accounts.google.com',
  'amazonaws.com',
];

/** Partição isolada e persistente do shell — nunca o perfil pessoal do usuário. */
export const PARTICAO = 'persist:sankhya-hub-desktop';

export const BRIDGE_PORT = Number(process.env['SANKHYA_DESKTOP_BRIDGE_PORT'] ?? 4103);
export const BRIDGE_HOST = '127.0.0.1';

/**
 * Mesma pasta que `hub-helper.ps1` usa para `token.txt`: o shell grava o próprio token
 * ao lado, e o backend acha os dois pelo mesmo padrão (`src/configuracao.ts`).
 */
export const PASTA_IPC =
  process.env['SANKHYA_HUB_IPC_DIR'] ?? join(app.getPath('appData'), 'sankhya-hub', 'ipc');
export const ARQUIVO_TOKEN_BRIDGE = join(PASTA_IPC, 'desktop-token.txt');
/** Gerado por `scripts/hub-helper.ps1` no primeiro boot; o shell só lê. */
export const ARQUIVO_TOKEN_HELPER = join(PASTA_IPC, 'token.txt');

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
 * type stripping sozinho (validado na Fase 1 do plano de migração).
 */
export const ENTRYPOINT_BACKEND = join(RAIZ_PROJETO, 'src', 'index.ts');

/**
 * Pasta de dados empacotada: a mesma que a instalação PWA antiga usava, para quem
 * atualiza não perder o cadastro nem precisar de migração.
 */
function pastaDeDadosInstalada(): string {
  if (process.platform === 'win32') {
    return join(process.env['LOCALAPPDATA'] ?? app.getPath('appData'), 'HubSnk', 'dados');
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

/** Só a migração do cofre ainda fala com o helper — ver `migracaoCofre.ts`. */
export const HELPER_URL = process.env['HUB_HELPER_URL'] ?? 'http://127.0.0.1:4102';

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
