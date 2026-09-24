/**
 * Constantes e caminhos do shell desktop. Tudo sobrescrevível por variável de
 * ambiente — os defaults são os mesmos endereços já usados por
 * `scripts/hub-helper.ps1` e pela PoC (`poc-desktop/src/main.js`), para não introduzir
 * um terceiro conjunto de URLs "corretas" no projeto.
 */
import { join } from 'node:path';
import { app } from 'electron';

export const HUB_URL = process.env['SANKHYA_HUB_URL'] ?? 'http://localhost:4000';
export const ERP_URL = process.env['SANKHYA_ERP_URL'] ?? 'https://skw.sankhya.com.br/mge/';
export const EXPERIENCE_URL = process.env['SANKHYA_EXPERIENCE_URL'] ?? 'https://experience.sankhya.com.br/';
export const EXPERIENCE_API =
  process.env['SANKHYA_EXPERIENCE_API'] ?? 'https://d83n39pk6d.execute-api.sa-east-1.amazonaws.com/prod';

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
 * Mesma pasta que `hub-helper.ps1` usa para `token.txt` (montada read-only no
 * container em `/app/helper-ipc`) — o shell desktop grava um arquivo próprio ali do
 * lado do Windows, sem exigir mudança de volume no `docker-compose.yml`.
 */
export const PASTA_IPC = process.env['SANKHYA_HUB_IPC_DIR'] ?? join(app.getPath('appData'), 'sankhya-hub', 'ipc');
export const ARQUIVO_TOKEN_BRIDGE = join(PASTA_IPC, 'desktop-token.txt');
/** Gerado por `scripts/hub-helper.ps1` no primeiro boot; o shell só lê. */
export const ARQUIVO_TOKEN_HELPER = join(PASTA_IPC, 'token.txt');

// --- backend hospedado pelo shell (Fase 1 da migração "sem Docker") ----------------

/**
 * `externo` desliga o gerenciamento: o shell não sobe backend nenhum e só espera alguém
 * atender em `HUB_URL`. É o que `scripts/desenvolver.ps1` e o container querem.
 */
export const MODO_BACKEND = (process.env['SANKHYA_HUB_BACKEND'] ?? 'gerenciado').toLowerCase();

/** Porta que o backend abre — derivada de `HUB_URL` para não haver dois valores a manter. */
export const PORTA_HUB = Number(new URL(HUB_URL).port || '4000');

/**
 * Raiz do checkout do hub (onde vivem `dist/`, `config/` e `node_modules/`).
 *
 * Em desenvolvimento `__dirname` é `desktop/dist`, então dois níveis acima é o repo.
 * Empacotado, o backend vai para `resources/hub` (ver a configuração do electron-builder
 * na Fase 4).
 */
export const RAIZ_PROJETO =
  process.env['SANKHYA_HUB_RAIZ'] ??
  (app.isPackaged ? join(process.resourcesPath, 'hub') : join(__dirname, '..', '..'));

export const ENTRYPOINT_BACKEND = join(RAIZ_PROJETO, 'dist', 'index.js');

/** `services.yaml` de fábrica, dentro do pacote. Só é lido para semear o do usuário. */
export const SERVICES_YAML_EMBUTIDO = join(RAIZ_PROJETO, 'config', 'services.yaml');

/**
 * `services.yaml` que o backend realmente lê.
 *
 * Empacotado, ele NÃO pode ser o de dentro do pacote: a pasta da instalação é
 * substituída a cada atualização, e a configuração de quem instalou iria junto. O
 * arquivo é copiado uma vez para `userData` (ver `src/primeiroBoot.ts`) e a partir daí é
 * do usuário. Em desenvolvimento continua sendo o do repo, que é o que se quer editar.
 */
export const SERVICES_YAML =
  process.env['CONFIG_PATH'] ??
  (app.isPackaged ? join(app.getPath('userData'), 'config', 'services.yaml') : SERVICES_YAML_EMBUTIDO);

/**
 * Histórico (SQLite) e cofre dos alvos monitorados. Em desenvolvimento aponta para o
 * `data/` do repo, que é onde o histórico já existe; empacotado vai para o `userData`,
 * porque `Program Files` não é gravável pelo usuário.
 */
export const DATA_DIR =
  process.env['SANKHYA_HUB_DATA_DIR'] ??
  (app.isPackaged ? join(app.getPath('userData'), 'data') : join(RAIZ_PROJETO, 'data'));

/**
 * No Windows a Docker Engine API atende por named pipe, não por unix socket. O Docker
 * deixa de ser o hospedeiro do hub e passa a ser só mais um alvo monitorado — os checks
 * `type: docker` continuam funcionando se o Docker Desktop estiver instalado, e apenas
 * ficam indisponíveis se não estiver.
 */
export const DOCKER_SOCKET =
  process.env['DOCKER_SOCKET'] ??
  (process.platform === 'win32' ? '\\\\.\\pipe\\docker_engine' : '/var/run/docker.sock');

/** Agora é a mesma máquina: `host.docker.internal` não tem mais razão de ser. */
export const HELPER_URL = process.env['HUB_HELPER_URL'] ?? 'http://127.0.0.1:4102';

export const TZ_PADRAO = 'America/Sao_Paulo';

/**
 * Ícone da janela e da barra de tarefas. Sem isto o Windows mostra o ícone padrão do
 * Electron, que é o que denuncia "isto é um app genérico" antes de qualquer outra coisa.
 * O mesmo arquivo vira o ícone do instalador na Fase 4.
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

