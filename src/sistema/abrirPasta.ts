import { spawn } from 'node:child_process';
import { garantirQueEhPasta } from './pasta.ts';

/**
 * Gerenciador de arquivos de cada sistema. O Linux e os demais Unix caem no
 * `xdg-open`, que é o despachante padrão do freedesktop.
 */
const COMANDOS_POR_PLATAFORMA: Record<string, string> = {
  win32: 'explorer.exe',
  darwin: 'open',
};
const COMANDO_PADRAO = 'xdg-open';

/**
 * Abre a pasta no gerenciador de arquivos do sistema.
 *
 * O caminho vai como argumento separado para o `spawn`, nunca interpolado numa
 * linha de comando: sem shell no meio, um caminho com aspas, `&&` ou `;` é
 * tratado como texto e não como comando.
 *
 * O processo é solto (`detached` + `unref`) porque o gerenciador de arquivos
 * continua vivo depois da resposta HTTP e não deve prender o servidor.
 */
export async function abrirPastaNoSistema(caminho: string): Promise<void> {
  await garantirQueEhPasta(caminho);

  const comando = COMANDOS_POR_PLATAFORMA[process.platform] ?? COMANDO_PADRAO;
  const processo = spawn(comando, [caminho], { detached: true, stdio: 'ignore' });

  // A falha só aparece depois que a resposta já foi enviada; resta registrar.
  processo.on('error', (erro) => {
    console.error(`Falha ao executar "${comando}" para abrir ${caminho}:`, erro);
  });

  processo.unref();
}
