import { comandoInterativoDoAssistente } from '../../kanban/ia/assistentesDeIa.ts';
import type { ConfiguracaoDoAssistenteDoRepositorio } from '../../tipos.ts';
import { abrirShellNaPasta } from './abrirShell.ts';

/**
 * Abertura do assistente de IA do repositório num terminal novo, na pasta do repositório.
 * O assistente roda dentro do shell, e não no lugar dele: quando a sessão termina, o
 * terminal continua aberto na pasta.
 */

/**
 * As opções digitadas nas configurações, uma por palavra; aspas duplas juntam um valor com
 * espaço (`--append-system-prompt "seja breve"`). Cada uma vira um argumento citado: o shell
 * não as interpreta, então `;` ou `&` chegam ao assistente como texto, nunca como comando.
 */
export function argumentosDasOpcoes(opcoes: string): string[] {
  return [...opcoes.matchAll(/"([^"]*)"|(\S+)/g)].map(([, entreAspas, palavra]) =>
    entreAspas !== undefined ? entreAspas : (palavra as string),
  );
}

/**
 * Linha que o shell executa para chamar o assistente. Cada parte vai como literal: o
 * caminho do executável vem do disco e pode ter espaço, aspas ou `;`. No Windows o shell
 * é o PowerShell, que só executa um caminho citado com o operador `&`.
 */
export function linhaDoAssistente(partes: string[], plataforma: NodeJS.Platform): string {
  if (plataforma === 'win32') {
    return `& ${partes.map((parte) => `'${parte.replaceAll("'", "''")}'`).join(' ')}`;
  }
  return partes.map((parte) => `'${parte.replaceAll("'", "'\\''")}'`).join(' ');
}

export async function abrirAssistenteNaPasta(
  configuracao: ConfiguracaoDoAssistenteDoRepositorio,
  pasta: string,
): Promise<void> {
  const partes = [
    ...comandoInterativoDoAssistente(configuracao),
    ...argumentosDasOpcoes(configuracao.opcoes),
  ];
  await abrirShellNaPasta(pasta, linhaDoAssistente(partes, process.platform), {
    janelaNova: true,
  });
}
