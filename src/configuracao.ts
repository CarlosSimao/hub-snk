import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA_PADRAO = 4100;
const HOST_PADRAO = '127.0.0.1';
const HOSTS_DE_LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const PONTE_DO_DESKTOP_URL_PADRAO = 'http://127.0.0.1:4103';

const raizDoProjeto = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function lerPorta(): number {
  const bruto = process.env.HUB_PORTA;
  if (!bruto) {
    return PORTA_PADRAO;
  }

  const porta = Number(bruto);
  if (!Number.isInteger(porta) || porta < 1 || porta > 65535) {
    throw new Error(`HUB_PORTA inválida: "${bruto}". Informe um inteiro entre 1 e 65535.`);
  }

  return porta;
}

/**
 * O HUB SNK não tem autenticação: quem alcança a porta lê o cadastro inteiro,
 * senhas incluídas, e dispara a abertura de executáveis da máquina. Escutar fora
 * do loopback transformaria isso em execução de comando remota, e o aplicativo
 * desktop não tem uso para isso: só o loopback é aceito.
 */
function lerHost(): string {
  const bruto = process.env.HUB_HOST;
  if (!bruto) {
    return HOST_PADRAO;
  }

  if (!HOSTS_DE_LOOPBACK.has(bruto)) {
    throw new Error(
      `HUB_HOST="${bruto}" exporia o HUB SNK para outras máquinas da rede. ` +
        'O servidor não tem autenticação, devolve as senhas do cadastro pela API e ' +
        `abre programas do sistema operacional. Use ${[...HOSTS_DE_LOOPBACK].join(', ')}.`,
    );
  }

  return bruto;
}

/**
 * O diretório de dados é configurável para permitir apontá-lo para uma pasta
 * sincronizada com a nuvem sem alterar código.
 *
 * O nome padrão carrega o do projeto porque a pasta costuma acabar dentro do
 * Drive ou do OneDrive do usuário, ao lado de outras: `dados` sozinho não diria
 * de quem é.
 */
function lerDiretorioDeDados(): string {
  const bruto = process.env.HUB_DADOS_DIR;
  return bruto ? resolve(bruto) : join(raizDoProjeto, 'dados-hub-snk');
}

/**
 * O shell desktop passa o caminho explicitamente. O padrão repete o dele
 * (`app.getPath('appData')`: `%APPDATA%` no Windows, `~/.config` no Linux) para
 * quem sobe o backend sozinho com `npm run dev` enquanto o shell está aberto.
 */
function lerArquivoDeTokenDoDesktop(): string {
  const bruto = process.env.DESKTOP_BRIDGE_TOKEN_FILE;
  if (bruto) {
    return bruto;
  }

  const pastaDeDadosDeAplicativos = process.env.APPDATA ?? join(homedir(), '.config');
  return join(pastaDeDadosDeAplicativos, 'sankhya-hub', 'ipc', 'desktop-token.txt');
}

export const configuracao = {
  porta: lerPorta(),
  host: lerHost(),
  diretorioPublico: join(raizDoProjeto, 'public'),
  diretorioDeDados: lerDiretorioDeDados(),
  ponteDoDesktopUrl: process.env.SANKHYA_DESKTOP_BRIDGE_URL ?? PONTE_DO_DESKTOP_URL_PADRAO,
  ponteDoDesktopTokenFile: lerArquivoDeTokenDoDesktop(),
} as const;
