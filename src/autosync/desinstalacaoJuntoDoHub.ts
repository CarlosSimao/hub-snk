/**
 * Deixa o Git AutoSync instalado pela aba Git removível junto com o HUB SNK.
 *
 * O pacote baixado da Release mora numa pasta temporária, apagada logo depois da
 * instalação, e o `install-standalone.ps1 -Uninstall` apaga o `~/.git-autosync/bin`.
 * Por isso o script vai para `%LOCALAPPDATA%\HubSnk\git-autosync`, fora dos dois, ao
 * lado da marca de que foi o HUB SNK quem instalou. A desinstalação do HUB SNK
 * (`desktop/assets/installer.nsh`) só pergunta se o Git AutoSync sai junto quando acha
 * as duas coisas: nunca remove uma instalação que a pessoa fez por fora.
 */
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Os mesmos nomes que o `installer.nsh` procura. Mudou aqui, muda lá. */
export const MARCA_DE_INSTALADO_PELO_HUB = 'git-autosync-instalado-pelo-hub.txt';
export const PASTA_DO_DESINSTALADOR = 'git-autosync';
const ARQUIVO_DO_INSTALADOR = 'install-standalone.ps1';

export async function registrarDesinstalacaoJuntoDoHub(
  pastaDoInstalador: string,
  pastaDoPacote: string,
  versao: string | null,
): Promise<void> {
  const destino = join(pastaDoInstalador, PASTA_DO_DESINSTALADOR);
  await mkdir(destino, { recursive: true });
  await copyFile(join(pastaDoPacote, ARQUIVO_DO_INSTALADOR), join(destino, ARQUIVO_DO_INSTALADOR));
  /* A marca por último: sem o script ao lado, ela faria o desinstalador perguntar à toa. */
  await writeFile(join(pastaDoInstalador, MARCA_DE_INSTALADO_PELO_HUB), versao ?? '', 'utf8');
}
