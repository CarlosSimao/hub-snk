/**
 * Início do HUB SNK junto com o sistema, que a bandeja liga e desliga.
 *
 * No Windows quem guarda a escolha é o próprio Windows — a chave `Run` do usuário, sem
 * administrador —, e é dele que o estado é lido: desligar pelo Gerenciador de Tarefas ›
 * Inicializar aparece aqui também. A entrada leva o id do app como nome, então a versão
 * instalada e a de desenvolvimento não se sobrescrevem. A desinstalação apaga a entrada
 * (`assets/installer.nsh`).
 *
 * No Linux o Electron não tem início automático: é um `.desktop` na pasta de autostart do
 * freedesktop, que o GNOME e o KDE leem no login. Ligado é o arquivo existir.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { ID_DO_APP_WINDOWS } from './config';
import { logEvento } from './log';

/**
 * Marca a abertura feita pelo sistema no login: o app sobe escondido na bandeja. O nome
 * ficou do Windows; mudar desligaria o "escondido" de quem já tem a entrada gravada.
 */
const ARGUMENTO_DE_INICIO_AUTOMATICO = '--iniciado-com-o-windows';

/** Em desenvolvimento o executável é o do Electron, que precisa da pasta do projeto. */
function opcoesDaEntrada(): { path: string; args: string[] } {
  const pastaDoApp = app.isPackaged ? [] : [app.getAppPath()];
  return { path: process.execPath, args: [...pastaDoApp, ARGUMENTO_DE_INICIO_AUTOMATICO] };
}

function arquivoDeAutostartDoLinux(): string {
  const pastaDeConfiguracao = process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config');
  return join(pastaDeConfiguracao, 'autostart', `${ID_DO_APP_WINDOWS}.desktop`);
}

/**
 * O `Exec` do `.desktop` separa por espaço: cada parte vai entre aspas (`/opt/HUB SNK/...`),
 * com `"`, `` ` ``, `$` e `\` escapados, e a barra dobrada de novo pela regra de texto do
 * formato.
 */
function parteDoExec(parte: string): string {
  const citada = parte.replace(/(["`$\\])/g, '\\$1');
  return `"${citada.replace(/\\/g, '\\\\')}"`;
}

function conteudoDoAutostart(): string {
  const { path, args } = opcoesDaEntrada();
  const exec = [path, ...args].map(parteDoExec);
  return [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${app.getName()}`,
    `Exec=${exec.join(' ')}`,
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

function definirAutostartDoLinux(ligado: boolean): void {
  const arquivo = arquivoDeAutostartDoLinux();
  if (!ligado) {
    rmSync(arquivo, { force: true });
    return;
  }
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, conteudoDoAutostart(), 'utf8');
}

/** No Windows, ligado é ter a entrada com o nome do app e aprovada — não desligada no Gerenciador. */
export function inicioAutomaticoLigado(): boolean {
  if (process.platform === 'linux') return existsSync(arquivoDeAutostartDoLinux());

  const { launchItems, openAtLogin } = app.getLoginItemSettings(opcoesDaEntrada());
  if (process.platform !== 'win32') return openAtLogin;
  return launchItems.some((entrada) => entrada.name === ID_DO_APP_WINDOWS && entrada.enabled);
}

export function definirInicioAutomatico(ligado: boolean): void {
  try {
    if (process.platform === 'linux') {
      definirAutostartDoLinux(ligado);
    } else {
      app.setLoginItemSettings({
        ...opcoesDaEntrada(),
        name: ID_DO_APP_WINDOWS,
        openAtLogin: ligado,
        // Religa também a entrada que foi desligada no Gerenciador de Tarefas.
        enabled: ligado,
      });
    }
    logEvento('inicio-automatico-alterado', { ligado });
  } catch (erro) {
    // A caixa da bandeja volta a mostrar o estado real, que é lido de novo ao refazer o menu.
    logEvento('inicio-automatico-nao-alterado', { ligado, erro: (erro as Error).message });
  }
}

export function foiIniciadoPeloWindows(): boolean {
  return process.argv.includes(ARGUMENTO_DE_INICIO_AUTOMATICO);
}
