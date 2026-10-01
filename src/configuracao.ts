import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ehPerfilProfissional, PERFIL_PADRAO } from './acessos.ts';
import { PERFIS_PROFISSIONAIS, type PerfilProfissional } from './tipos.ts';

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
 * A única autenticação do HUB SNK é o token do shell, um arquivo local, trafegando
 * em HTTP puro. Escutar fora do loopback exporia o token, o cadastro com as senhas e
 * a abertura de executáveis da máquina à rede, e o aplicativo desktop não tem uso
 * para isso: só o loopback é aceito.
 */
function lerHost(): string {
  const bruto = process.env.HUB_HOST;
  if (!bruto) {
    return HOST_PADRAO;
  }

  if (!HOSTS_DE_LOOPBACK.has(bruto)) {
    throw new Error(
      `HUB_HOST="${bruto}" exporia o HUB SNK para outras máquinas da rede. ` +
        'O servidor fala HTTP puro, devolve as senhas do cadastro pela API e ' +
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

/**
 * Perfil escolhido no instalador, repassado pelo shell desktop. Só é aplicado enquanto
 * a configuração gravada não tem acessos — ver `RepositorioConfiguracaoArquivo`.
 */
function lerPerfilInicial(): PerfilProfissional {
  const bruto = process.env.HUB_PERFIL_INICIAL?.trim();
  if (!bruto) {
    return PERFIL_PADRAO;
  }

  if (!ehPerfilProfissional(bruto)) {
    throw new Error(
      `HUB_PERFIL_INICIAL inválido: "${bruto}". Use ${PERFIS_PROFISSIONAIS.join(', ')}.`,
    );
  }

  return bruto;
}

/**
 * Desliga a exigência do token do shell na API, para desenvolver o painel no
 * navegador com `npm run dev` sem o shell aberto. Precisa ser explícito: com o
 * shell aberto (`SANKHYA_HUB_BACKEND=externo`) o token já chega por cookie.
 */
function lerAutenticacaoDoPainelDesligada(): boolean {
  return process.env.HUB_SEM_TOKEN?.trim() === '1';
}

/** Valor que o shell desktop grava quando a caixa Terceiro do instalador vem marcada. */
const TERCEIRO_MARCADO = 'S';

/** Caixa Terceiro do instalador, repassada pelo shell. Mesma regra do perfil inicial. */
function lerTerceiroInicial(): boolean {
  return process.env.HUB_TERCEIRO_INICIAL?.trim().toUpperCase() === TERCEIRO_MARCADO;
}

/** Separador da lista de funcionalidades ocultas gravada pelo instalador. */
const SEPARADOR_DE_FUNCIONALIDADES = ',';

/**
 * Caixas desmarcadas no instalador, repassadas pelo shell. Sem a variável (instalação
 * anterior à página, `npm run dev`) volta `undefined` e vale o preset do perfil; vazia
 * é "nenhuma oculta". Quem descarta chave desconhecida é `RepositorioConfiguracaoArquivo`.
 */
function lerFuncionalidadesOcultasIniciais(): string[] | undefined {
  const bruto = process.env.HUB_FUNCIONALIDADES_OCULTAS_INICIAIS;
  if (bruto === undefined) {
    return undefined;
  }

  return bruto
    .split(SEPARADOR_DE_FUNCIONALIDADES)
    .map((chave) => chave.trim())
    .filter(Boolean);
}

/** Valor que o shell desktop grava quando a caixa do Git AutoSync do instalador vem desmarcada. */
const AUTOSYNC_DESMARCADO = 'N';

/**
 * Caixa do Git AutoSync do instalador, repassada pelo shell. Só o `N` explícito conta
 * como não instalado: fora do instalador (`npm run dev`, pacote sem o Git AutoSync,
 * instalação silenciosa) não há escolha, e nada fica oculto.
 */
function lerAutosyncInstaladoInicial(): boolean {
  return process.env.HUB_AUTOSYNC_INICIAL?.trim().toUpperCase() !== AUTOSYNC_DESMARCADO;
}

/**
 * Pasta do Git AutoSync: `config.json`, `status.json`, log e `bin/`. A mesma variável
 * que o próprio autosync respeita, para os dois olharem o mesmo lugar.
 */
function lerPastaDoAutosync(): string {
  const bruto = process.env.GIT_AUTOSYNC_HOME?.trim();
  return bruto ? resolve(bruto) : join(homedir(), '.git-autosync');
}

/**
 * Pacote do autosync que veio com o instalador, repassado pelo shell desktop. Ausente
 * em desenvolvimento: a instalação pela tela responde que o build não tem o pacote.
 */
function lerPacoteDoAutosync(): string | null {
  const bruto = process.env.HUB_AUTOSYNC_PACOTE?.trim();
  return bruto ? resolve(bruto) : null;
}

export const configuracao = {
  porta: lerPorta(),
  host: lerHost(),
  diretorioPublico: join(raizDoProjeto, 'public'),
  diretorioDeDados: lerDiretorioDeDados(),
  ponteDoDesktopUrl: process.env.SANKHYA_DESKTOP_BRIDGE_URL ?? PONTE_DO_DESKTOP_URL_PADRAO,
  ponteDoDesktopTokenFile: lerArquivoDeTokenDoDesktop(),
  autenticacaoDoPainelDesligada: lerAutenticacaoDoPainelDesligada(),
  acessosIniciais: {
    perfil: lerPerfilInicial(),
    terceiro: lerTerceiroInicial(),
    autosyncInstalado: lerAutosyncInstaladoInicial(),
    funcionalidadesOcultas: lerFuncionalidadesOcultasIniciais(),
  },
  pastaDoAutosync: lerPastaDoAutosync(),
  pacoteDoAutosync: lerPacoteDoAutosync(),
} as const;
