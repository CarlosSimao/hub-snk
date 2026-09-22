import { garantirQueEhPasta } from './pasta.ts';
import { lancarPrimeiroDisponivel, montarLancamentosDoWindows } from './lancadorJetBrains.ts';
import type { Candidato } from './lancarProcesso.ts';

/**
 * Abertura do IntelliJ IDEA já com a pasta do repositório carregada como
 * projeto.
 */

export class IntelliJIndisponivelError extends Error {
  constructor() {
    super(
      'O IntelliJ IDEA não foi encontrado. Adicione a pasta "bin" da IDE ao PATH ou gere o launcher de linha de comando pelo JetBrains Toolbox.',
    );
    this.name = 'IntelliJIndisponivelError';
  }
}

/**
 * O nome do launcher do Windows muda conforme a instalação: os executáveis
 * nativos vêm no `bin` da IDE, enquanto o JetBrains Toolbox gera um `idea.cmd`.
 * Os nativos vêm primeiro porque rodam sem interpretador no meio.
 */
const LAUNCHERS_DO_WINDOWS = ['idea64.exe', 'idea.exe', 'idea.cmd', 'idea.bat'];

/**
 * No macOS o `open -n -a` localiza o aplicativo pelo nome, sem depender de
 * launcher instalado no PATH; `--args` repassa a pasta para a IDE.
 */
function montarLancamentosDoMac(pasta: string): Candidato[] {
  return [
    { comando: 'open', argumentos: ['-n', '-a', 'IntelliJ IDEA', '--args', pasta] },
    { comando: 'open', argumentos: ['-n', '-a', 'IntelliJ IDEA CE', '--args', pasta] },
    { comando: 'idea', argumentos: [pasta] },
  ];
}

/** No Linux o nome do launcher varia com a forma de instalação (pacote, snap ou tarball). */
function montarLancamentosDoLinux(pasta: string): Candidato[] {
  return ['intellij-idea-ultimate', 'intellij-idea-community', 'idea', 'idea.sh'].map(
    (comando) => ({ comando, argumentos: [pasta] }),
  );
}

export async function abrirIntelliJNaPasta(pasta: string): Promise<void> {
  await garantirQueEhPasta(pasta);

  const lancamentos =
    process.platform === 'win32'
      ? await montarLancamentosDoWindows(LAUNCHERS_DO_WINDOWS, [pasta])
      : process.platform === 'darwin'
        ? montarLancamentosDoMac(pasta)
        : montarLancamentosDoLinux(pasta);

  if (!(await lancarPrimeiroDisponivel(lancamentos))) {
    throw new IntelliJIndisponivelError();
  }
}
