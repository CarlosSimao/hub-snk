import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import {
  comandoInterativoDoAssistente,
  resolverAssistente,
} from '../../kanban/ia/assistentesDeIa.ts';
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
  const citadas = partes.map((parte) => citar(parte, plataforma));
  return plataforma === 'win32' ? `& ${citadas.join(' ')}` : citadas.join(' ');
}

function citar(valor: string, plataforma: NodeJS.Platform): string {
  return plataforma === 'win32'
    ? `'${valor.replaceAll("'", "''")}'`
    : `'${valor.replaceAll("'", "'\\''")}'`;
}

/** Arquivo na pasta do repositório que pede a conta secundária do Claude Code. */
const MARCADOR_DA_CONTA_SECUNDARIA = '.claude-secundario';
const PASTA_DA_CONTA_SECUNDARIA = '.claude-conta2';

/**
 * O HUB chama o executável pelo caminho completo, sem passar por função ou alias do perfil
 * do shell. Quem troca de conta por lá (`CLAUDE_CONFIG_DIR`) precisa do mesmo efeito aqui.
 */
export function prefixoDaContaSecundaria(plataforma: NodeJS.Platform, home: string): string {
  // O separador segue a plataforma pedida, não a de quem roda (o teste do Windows roda no CI Linux).
  const pastaDaConta = (plataforma === 'win32' ? win32 : posix).join(
    home,
    PASTA_DA_CONTA_SECUNDARIA,
  );
  return plataforma === 'win32'
    ? `$env:CLAUDE_CONFIG_DIR = ${citar(pastaDaConta, plataforma)}; `
    : `CLAUDE_CONFIG_DIR=${citar(pastaDaConta, plataforma)} `;
}

export async function abrirAssistenteNaPasta(
  configuracao: ConfiguracaoDoAssistenteDoRepositorio,
  pasta: string,
): Promise<void> {
  const partes = [
    ...comandoInterativoDoAssistente(configuracao),
    ...argumentosDasOpcoes(configuracao.opcoes),
  ];
  const usaContaSecundaria =
    resolverAssistente(configuracao.assistente) === 'claude' &&
    existsSync(join(pasta, MARCADOR_DA_CONTA_SECUNDARIA));
  const prefixo = usaContaSecundaria ? prefixoDaContaSecundaria(process.platform, homedir()) : '';
  await abrirShellNaPasta(pasta, prefixo + linhaDoAssistente(partes, process.platform), {
    janelaNova: true,
  });
}
