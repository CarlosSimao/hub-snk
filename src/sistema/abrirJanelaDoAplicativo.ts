import { spawn } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { join } from 'node:path';

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

const COMANDOS_CHROMIUM_NO_UNIX = ['google-chrome', 'chromium', 'microsoft-edge', 'brave-browser'];

/** Despachante de cada sistema, para quando não há Chromium — abre em aba comum. */
const DESPACHANTES_POR_PLATAFORMA: Record<string, string> = {
  win32: 'explorer.exe',
  darwin: 'open',
};
const DESPACHANTE_PADRAO = 'xdg-open';

/**
 * O processo é solto (`detached` + `unref`) porque o navegador continua vivo
 * depois de o servidor terminar de subir e não deve prendê-lo.
 */
function lancar(comando: string, argumentos: string[]): void {
  const processo = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });

  processo.on('error', (erro) => {
    console.error(`Falha ao executar "${comando}" para abrir a janela:`, erro);
  });

  processo.unref();
}

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

/**
 * Fora do Windows não há caminho fixo para procurar: o navegador é um comando
 * no PATH, e o `spawn` falha se ele não existir. Um nome de comando dado pelo
 * usuário é tentado primeiro, na ordem em que ele pediu.
 */
function comandosDoUnix(preferencia: string): string[] {
  return preferencia === NAVEGADOR_AUTOMATICO
    ? COMANDOS_CHROMIUM_NO_UNIX
    : [preferencia, ...COMANDOS_CHROMIUM_NO_UNIX];
}

function abrirNoNavegadorPadrao(endereco: string): void {
  lancar(DESPACHANTES_POR_PLATAFORMA[process.platform] ?? DESPACHANTE_PADRAO, [endereco]);
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
    abrirNoNavegadorPadrao(endereco);
    return;
  }

  if (process.platform === 'win32') {
    const navegador = await navegadorDoWindows(preferencia);

    if (navegador) {
      lancar(navegador, [`${ARGUMENTO_DE_JANELA}${endereco}`]);
    } else {
      abrirNoNavegadorPadrao(endereco);
    }

    return;
  }

  for (const comando of comandosDoUnix(preferencia)) {
    if (await comandoExiste(comando)) {
      lancar(comando, [`${ARGUMENTO_DE_JANELA}${endereco}`]);
      return;
    }
  }

  abrirNoNavegadorPadrao(endereco);
}

/**
 * `command -v` sem shell: o `spawn` de um comando ausente falha com ENOENT, e
 * descobrir isso antes evita uma janela que nunca abre.
 */
async function comandoExiste(comando: string): Promise<boolean> {
  return new Promise((resolver) => {
    const processo = spawn('which', [comando], { stdio: 'ignore' });
    processo.on('error', () => resolver(false));
    processo.on('close', (codigo) => resolver(codigo === 0));
  });
}
