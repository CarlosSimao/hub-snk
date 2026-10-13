/**
 * PATH do shell de login, para o app aberto pelo menu do sistema.
 *
 * Aberto pelo menu de aplicativos do Linux (ou pelo Finder, no Mac), o app herda o PATH
 * mínimo da sessão gráfica, sem o que o `.bashrc` ou o `.zshrc` acrescentam (nvm,
 * Homebrew, `~/.local/bin`): o backend, que herda o PATH daqui, daria `git`, `docker`,
 * `claude` e `codex` como ausentes. A pergunta vai ao shell da pessoa uma vez, na abertura.
 *
 * No Windows o PATH vem do registro e já chega completo.
 */
import { execFileSync } from 'node:child_process';
import { logEvento } from './log';

/** Separa o PATH do que o `.bashrc` imprimir na abertura do shell interativo. */
const MARCA = '__HUB_SNK_PATH__';
/** Um `.bashrc` que espera entrada não pode segurar a abertura do app. */
const TEMPO_LIMITE_MS = 5_000;

export function completarPathComOShellDeLogin(): void {
  if (process.platform === 'win32') return;

  const shell = process.env['SHELL'] || '/bin/bash';
  try {
    const saida = execFileSync(shell, ['-ilc', `printf '${MARCA}%s${MARCA}' "$PATH"`], {
      encoding: 'utf8',
      timeout: TEMPO_LIMITE_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const path = saida.split(MARCA)[1];
    if (path) process.env['PATH'] = path;
  } catch (erro) {
    // Segue com o PATH herdado: o que faltar aparece como "não instalado" na tela.
    logEvento('path-do-shell-nao-lido', { shell, erro: (erro as Error).message });
  }
}
