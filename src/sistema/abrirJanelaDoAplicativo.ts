import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { lancarProcesso } from './lancarProcesso.ts';

/**
 * Abre a tela do HUB SNK em janela própria assim que o servidor sobe.
 *
 * Existe para o pacote baixado funcionar sem etapa de instalação: no Windows, o
 * Controle Inteligente de Aplicativos bloqueia script sem assinatura, então o
 * launcher `.vbs` some do caminho de quem só descompactou o zip. O `node.exe`
 * embutido é assinado e passa — e é ele quem abre a janela daqui.
 *
 * Quem instalou continua usando o launcher; nesse caso a janela já é aberta por
 * ele, e o servidor sobe com `HUB_ABRIR_JANELA=0`.
 */

/** `--app` do Chromium: janela sem barra de endereço e sem abas, como a PWA. */
const ARGUMENTO_DE_JANELA = '--app=';

const NAVEGADOR_AUTOMATICO = 'auto';
const NAVEGADOR_PADRAO = 'padrao';

/** Ordem de procura: o Edge vem com o Windows; o Chrome é o mais comum no resto. */
const CAMINHOS_DO_EDGE_NO_WINDOWS = [
  ['ProgramFiles(x86)', 'Microsoft\\Edge\\Application\\msedge.exe'],
  ['ProgramFiles', 'Microsoft\\Edge\\Application\\msedge.exe'],
] as const;

const CAMINHOS_DO_CHROME_NO_WINDOWS = [
  ['ProgramFiles', 'Google\\Chrome\\Application\\chrome.exe'],
  ['ProgramFiles(x86)', 'Google\\Chrome\\Application\\chrome.exe'],
  ['LOCALAPPDATA', 'Google\\Chrome\\Application\\chrome.exe'],
] as const;

const COMANDOS_CHROMIUM_NO_LINUX = ['google-chrome', 'chromium', 'microsoft-edge', 'brave-browser'];

/**
 * No macOS o navegador é um pacote `.app`, não um comando no PATH: procurar por
 * nome de executável, como no Linux, nunca acha nada e a janela própria acaba
 * caindo sempre na aba comum.
 *
 * O nome do comando equivalente vem junto porque é ele que o instalador grava
 * no `HUB_NAVEGADOR` — a lista de opções é a mesma nos três sistemas.
 */
const APLICATIVOS_CHROMIUM_NO_MACOS = [
  { comando: 'google-chrome', aplicativo: 'Google Chrome' },
  { comando: 'chromium', aplicativo: 'Chromium' },
  { comando: 'microsoft-edge', aplicativo: 'Microsoft Edge' },
  { comando: 'brave-browser', aplicativo: 'Brave Browser' },
] as const;

/** Pastas em que o macOS guarda aplicativos: a do sistema e a do usuário. */
const PASTAS_DE_APLICATIVOS_DO_MACOS = ['/Applications', join(homedir(), 'Applications')];

/** Despachante de cada sistema, para quando não há Chromium — abre em aba comum. */
const DESPACHANTES_POR_PLATAFORMA: Record<string, string> = {
  win32: 'explorer.exe',
  darwin: 'open',
};
const DESPACHANTE_PADRAO = 'xdg-open';

async function existe(caminho: string): Promise<boolean> {
  try {
    await access(caminho, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function primeiroCaminhoExistenteNoWindows(
  candidatos: ReadonlyArray<readonly [string, string]>,
): Promise<string | null> {
  for (const [variavel, resto] of candidatos) {
    const base = process.env[variavel];
    if (!base) {
      continue;
    }

    const caminho = join(base, resto);
    if (await existe(caminho)) {
      return caminho;
    }
  }

  return null;
}

async function navegadorDoWindows(preferencia: string): Promise<string | null> {
  if (preferencia === 'edge') {
    return primeiroCaminhoExistenteNoWindows(CAMINHOS_DO_EDGE_NO_WINDOWS);
  }

  if (preferencia === 'chrome') {
    return primeiroCaminhoExistenteNoWindows(CAMINHOS_DO_CHROME_NO_WINDOWS);
  }

  return (
    (await primeiroCaminhoExistenteNoWindows(CAMINHOS_DO_EDGE_NO_WINDOWS)) ??
    (await primeiroCaminhoExistenteNoWindows(CAMINHOS_DO_CHROME_NO_WINDOWS))
  );
}

async function aplicativoInstaladoNoMacos(aplicativo: string): Promise<boolean> {
  for (const pasta of PASTAS_DE_APLICATIVOS_DO_MACOS) {
    if (await existe(join(pasta, `${aplicativo}.app`))) {
      return true;
    }
  }

  return false;
}

/**
 * `-n` abre uma instância nova, para a janela nascer separada do navegador que
 * já esteja aberto; `--args` repassa o `--app` para o Chromium.
 */
function abrirJanelaNoMacos(aplicativo: string, endereco: string): Promise<void> {
  return lancarProcesso('open', [
    '-n',
    '-a',
    aplicativo,
    '--args',
    `${ARGUMENTO_DE_JANELA}${endereco}`,
  ]);
}

/** O navegador pedido pelo usuário vem primeiro, na ordem em que ele pediu. */
function aplicativosDoMacos(preferencia: string): ReadonlyArray<{ aplicativo: string }> {
  if (preferencia === NAVEGADOR_AUTOMATICO) {
    return APLICATIVOS_CHROMIUM_NO_MACOS;
  }

  const pedido = APLICATIVOS_CHROMIUM_NO_MACOS.find(
    ({ comando, aplicativo }) => comando === preferencia || aplicativo === preferencia,
  );

  return pedido ? [pedido, ...APLICATIVOS_CHROMIUM_NO_MACOS] : APLICATIVOS_CHROMIUM_NO_MACOS;
}

/**
 * Fora do Windows e do macOS não há caminho fixo para procurar: o navegador é um
 * comando no PATH. Um nome dado pelo usuário é tentado primeiro.
 */
function comandosDoLinux(preferencia: string): string[] {
  return preferencia === NAVEGADOR_AUTOMATICO
    ? COMANDOS_CHROMIUM_NO_LINUX
    : [preferencia, ...COMANDOS_CHROMIUM_NO_LINUX];
}

/**
 * `command -v` sem shell: o `spawn` de um comando ausente falha com ENOENT, e
 * descobrir isso antes evita uma janela que nunca abre.
 */
function comandoExiste(comando: string): Promise<boolean> {
  return new Promise((resolver) => {
    const processo = spawn('which', [comando], { stdio: 'ignore' });
    processo.on('error', () => resolver(false));
    processo.on('close', (codigo) => resolver(codigo === 0));
  });
}

/**
 * Último recurso, em aba comum. Falhar aqui não impede o HUB SNK de funcionar —
 * o servidor está no ar e o endereço basta —, então o recado vai para o
 * terminal em vez de derrubar a inicialização.
 */
async function abrirNoNavegadorPadrao(endereco: string): Promise<void> {
  const despachante = DESPACHANTES_POR_PLATAFORMA[process.platform] ?? DESPACHANTE_PADRAO;

  try {
    await lancarProcesso(despachante, [endereco]);
  } catch {
    console.error(`Não foi possível abrir o navegador. Acesse ${endereco} para usar o HUB SNK.`);
  }
}

/** `true` quando a janela própria subiu; `false` deixa o navegador padrão assumir. */
async function abrirJanelaPropria(endereco: string, preferencia: string): Promise<boolean> {
  if (process.platform === 'win32') {
    const navegador = await navegadorDoWindows(preferencia);
    if (!navegador) {
      return false;
    }

    try {
      await lancarProcesso(navegador, [`${ARGUMENTO_DE_JANELA}${endereco}`]);
      return true;
    } catch {
      return false;
    }
  }

  if (process.platform === 'darwin') {
    for (const { aplicativo } of aplicativosDoMacos(preferencia)) {
      if (await aplicativoInstaladoNoMacos(aplicativo)) {
        try {
          await abrirJanelaNoMacos(aplicativo, endereco);
          return true;
        } catch {
          // Aplicativo presente mas recusado: tenta o próximo.
        }
      }
    }

    return false;
  }

  for (const comando of comandosDoLinux(preferencia)) {
    if (await comandoExiste(comando)) {
      try {
        await lancarProcesso(comando, [`${ARGUMENTO_DE_JANELA}${endereco}`]);
        return true;
      } catch {
        // Comando presente mas recusado: tenta o próximo.
      }
    }
  }

  return false;
}

/**
 * Abre `endereco` em janela própria.
 *
 * `preferencia` vem do `HUB_NAVEGADOR`: `padrao` manda direto para o navegador
 * do sistema, em aba comum; qualquer outro valor tenta o Chromium
 * correspondente e cai no navegador padrão quando ele não está na máquina —
 * deixar de abrir seria pior que abrir numa aba.
 */
export async function abrirJanelaDoAplicativo(
  endereco: string,
  preferencia: string,
): Promise<void> {
  if (preferencia === NAVEGADOR_PADRAO) {
    await abrirNoNavegadorPadrao(endereco);
    return;
  }

  if (!(await abrirJanelaPropria(endereco, preferencia))) {
    await abrirNoNavegadorPadrao(endereco);
  }
}
