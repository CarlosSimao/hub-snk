/**
 * Início do HUB SNK junto com o Windows, que a bandeja liga e desliga.
 *
 * Quem guarda a escolha é o próprio Windows — a chave `Run` do usuário, sem administrador —,
 * e é dele que o estado é lido: desligar pelo Gerenciador de Tarefas › Inicializar aparece
 * aqui também. A entrada leva o id do app como nome, então a versão instalada e a de
 * desenvolvimento não se sobrescrevem. A desinstalação apaga a entrada
 * (`assets/installer.nsh`).
 */
import { app } from 'electron';
import { ID_DO_APP_WINDOWS } from './config';
import { logEvento } from './log';

/** Marca a abertura feita pelo Windows no login: o app sobe escondido na bandeja. */
const ARGUMENTO_DE_INICIO_AUTOMATICO = '--iniciado-com-o-windows';

/** Em desenvolvimento o executável é o `electron.exe`, que precisa da pasta do projeto. */
function opcoesDaEntrada(): { path: string; args: string[] } {
  const pastaDoApp = app.isPackaged ? [] : [app.getAppPath()];
  return { path: process.execPath, args: [...pastaDoApp, ARGUMENTO_DE_INICIO_AUTOMATICO] };
}

/** Ligado é ter a entrada com o nome do app e aprovada — não desligada no Gerenciador. */
export function inicioAutomaticoLigado(): boolean {
  const { launchItems } = app.getLoginItemSettings(opcoesDaEntrada());
  return launchItems.some((entrada) => entrada.name === ID_DO_APP_WINDOWS && entrada.enabled);
}

export function definirInicioAutomatico(ligado: boolean): void {
  app.setLoginItemSettings({
    ...opcoesDaEntrada(),
    name: ID_DO_APP_WINDOWS,
    openAtLogin: ligado,
    // Religa também a entrada que foi desligada no Gerenciador de Tarefas.
    enabled: ligado,
  });
  logEvento('inicio-automatico-alterado', { ligado });
}

export function foiIniciadoPeloWindows(): boolean {
  return process.argv.includes(ARGUMENTO_DE_INICIO_AUTOMATICO);
}
