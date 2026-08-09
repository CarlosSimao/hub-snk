import { spawn } from 'node:child_process';

/**
 * Seletor de pasta nativo da máquina.
 *
 * O navegador não entrega o caminho real da pasta escolhida — `webkitdirectory`
 * só devolve os nomes relativos dos arquivos —, e o HUB SNK precisa do caminho
 * absoluto para rodar git, shell e IDE ali dentro. Como servidor e usuário são a
 * mesma máquina, o diálogo é aberto aqui e só o caminho volta para a tela.
 */

export class SeletorDePastaIndisponivelError extends Error {
  constructor() {
    super(
      'Não foi possível abrir o seletor de pastas. No Linux, instale o "zenity" ou o "kdialog", ou digite o caminho à mão.',
    );
    this.name = 'SeletorDePastaIndisponivelError';
  }
}

interface Lancamento {
  comando: string;
  argumentos: string[];
}

/*
 * O diálogo do Windows exige apartamento STA, daí o `-STA`. O
 * `FolderBrowserDialog` não aceita janela dona com `TopMost`, então o topo vem
 * do próprio diálogo: sem isso ele nasce atrás da janela do HUB SNK e parece que
 * nada aconteceu.
 */
const SCRIPT_DO_WINDOWS = `
Add-Type -AssemblyName System.Windows.Forms
$dialogo = New-Object System.Windows.Forms.FolderBrowserDialog
$dialogo.Description = 'Selecione a pasta do repositório'
$dialogo.ShowNewFolderButton = $false
$janelaDeTopo = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($dialogo.ShowDialog($janelaDeTopo) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialogo.SelectedPath)
}
`;

const SCRIPT_DO_MACOS =
  'try\nPOSIX path of (choose folder with prompt "Selecione a pasta do repositório")\nend try';

function montarLancamentos(): Lancamento[] {
  if (process.platform === 'win32') {
    return [
      {
        comando: 'powershell.exe',
        argumentos: ['-NoProfile', '-STA', '-Command', SCRIPT_DO_WINDOWS],
      },
    ];
  }

  if (process.platform === 'darwin') {
    return [{ comando: 'osascript', argumentos: ['-e', SCRIPT_DO_MACOS] }];
  }

  return [
    {
      comando: 'zenity',
      argumentos: ['--file-selection', '--directory', '--title=Selecione a pasta do repositório'],
    },
    { comando: 'kdialog', argumentos: ['--getexistingdirectory', '.'] },
  ];
}

/**
 * Resolve com o que o seletor escreveu na saída padrão, `null` quando o
 * executável do diálogo não existe na máquina.
 *
 * Cancelar é caso normal, não erro: os três seletores saem com código diferente
 * de zero e sem escrever nada, e isso vira string vazia.
 */
function executarSeletor({ comando, argumentos }: Lancamento): Promise<string | null> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn(comando, argumentos, { stdio: ['ignore', 'pipe', 'ignore'] });

    let saida = '';
    processo.stdout.on('data', (pedaco: Buffer) => {
      saida += pedaco.toString('utf8');
    });

    processo.once('error', (erro) => {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        resolver(null);
        return;
      }
      rejeitar(erro);
    });

    processo.once('close', () => resolver(saida.trim()));
  });
}

/**
 * Abre o seletor e devolve a pasta escolhida, ou `null` quando o usuário
 * cancela.
 */
export async function selecionarPastaNoSistema(): Promise<string | null> {
  for (const lancamento of montarLancamentos()) {
    const caminho = await executarSeletor(lancamento);
    if (caminho !== null) {
      return caminho === '' ? null : caminho;
    }
  }

  throw new SeletorDePastaIndisponivelError();
}
