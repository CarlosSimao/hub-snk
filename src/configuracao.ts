import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
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

/**
 * Nome, empresa, time e e-mail da página "Seus dados" do instalador, repassados pelo
 * shell. Só preenchem o campo ainda vazio — ver `RepositorioConfiguracaoArquivo`. O
 * instalador não valida o e-mail como a tela de Configurações: inválido, é descartado.
 */
function lerIdentificacaoInicial() {
  const email = process.env.HUB_EMAIL_INICIAL?.trim() ?? '';
  return {
    nomeDoUsuario: process.env.HUB_NOME_INICIAL?.trim() ?? '',
    empresaDoUsuario: process.env.HUB_EMPRESA_INICIAL?.trim() ?? '',
    timeDoUsuario: process.env.HUB_TIME_INICIAL?.trim() ?? '',
    emailDoUsuario: z.email().safeParse(email).success ? email : '',
  };
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

/**
 * Pasta do Git AutoSync: `config.json`, `status.json`, log e `bin/`. A mesma variável
 * que o próprio autosync respeita, para os dois olharem o mesmo lugar.
 */
function lerPastaDoAutosync(): string {
  const bruto = process.env.GIT_AUTOSYNC_HOME?.trim();
  return bruto ? resolve(bruto) : join(homedir(), '.git-autosync');
}

/**
 * Pasta com um pacote do autosync já extraído, para testar um build antes de publicar
 * a Release. Ausente, o normal: a instalação pela tela baixa da Release mais recente.
 */
function lerPacoteDoAutosync(): string | null {
  const bruto = process.env.HUB_AUTOSYNC_PACOTE?.trim();
  return bruto ? resolve(bruto) : null;
}

/**
 * `%LOCALAPPDATA%\HubSnk` do app instalado, repassado pelo shell desktop só quando
 * empacotado: é onde a instalação pela aba Git deixa o que a desinstalação do HUB SNK
 * usa para remover o Git AutoSync junto.
 */
function lerPastaDoInstalador(): string | null {
  const bruto = process.env.HUB_PASTA_DO_INSTALADOR?.trim();
  return bruto ? resolve(bruto) : null;
}

/**
 * Pasta em que o shell desktop grava `desktop.log` e `backend.log`, repassada por ele.
 * O relato de problema lê o final dos dois arquivos daqui. Sem o shell (`npm run dev`),
 * cai numa subpasta dos dados, que simplesmente não terá log para anexar.
 */
function lerPastaDeLog(): string {
  const bruto = process.env.HUB_PASTA_DE_LOG?.trim();
  return bruto ? resolve(bruto) : join(lerDiretorioDeDados(), 'log');
}

/**
 * Endereço que recebe os relatos de problema e sugestões. Fixo: é o destino que o
 * aviso de privacidade promete. A variável existe para os testes e para apontar um
 * ambiente de homologação.
 */
const ENDERECO_DO_SUPORTE_PADRAO = 'https://mano.simplifin.app/intake/v1/reports/hub-snk';

function lerEnderecoDoSuporte(): string {
  return process.env.HUB_ENDERECO_DO_SUPORTE?.trim() || ENDERECO_DO_SUPORTE_PADRAO;
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
    funcionalidadesOcultas: lerFuncionalidadesOcultasIniciais(),
  },
  identificacaoInicial: lerIdentificacaoInicial(),
  pastaDoAutosync: lerPastaDoAutosync(),
  pacoteDoAutosync: lerPacoteDoAutosync(),
  pastaDoInstalador: lerPastaDoInstalador(),
  pastaDeLog: lerPastaDeLog(),
  enderecoDoSuporte: lerEnderecoDoSuporte(),
} as const;
