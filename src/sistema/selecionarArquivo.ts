import { spawn } from 'node:child_process';

/**
 * Seletor de arquivo nativo da máquina.
 *
 * O navegador não entrega o caminho real do arquivo escolhido — `input[type=file]`
 * só devolve o nome —, e o HUB SNK precisa do caminho absoluto para executar o
 * programa depois. Como servidor e usuário são a mesma máquina, o diálogo é
 * aberto aqui e só o caminho volta para a tela.
 */

export class SeletorDeArquivoIndisponivelError extends Error {
  constructor() {
    super(
      'Não foi possível abrir o seletor de arquivos. No Linux, instale o "zenity" ou o "kdialog", ou digite o caminho à mão.',
    );
    this.name = 'SeletorDeArquivoIndisponivelError';
  }
}

interface Lancamento {
  comando: string;
  argumentos: string[];
}

/*
 * O diálogo do Windows exige apartamento STA, daí o `-STA`. A janela dona é
 * criada só para levar `TopMost`: sem ela o diálogo nasce atrás da janela do
 * HUB SNK e parece que nada aconteceu.
 */
const SCRIPT_DO_WINDOWS = `
Add-Type -AssemblyName System.Windows.Forms
$dialogo = New-Object System.Windows.Forms.OpenFileDialog
$dialogo.Title = 'Selecione o executável'
$dialogo.Filter = 'Programas (*.exe;*.bat;*.cmd;*.lnk)|*.exe;*.bat;*.cmd;*.lnk|Todos os arquivos (*.*)|*.*'
$janelaDeTopo = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($dialogo.ShowDialog($janelaDeTopo) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialogo.FileName)
}
`;

/*
 * O `of type` não é filtro de conveniência aqui: sem ele o diálogo trata o
 * pacote `.app` como pasta navegável e não deixa escolher o aplicativo em si.
 * Os demais tipos cobrem binário Unix, script de shell e `.command`.
 */
const TIPOS_DE_EXECUTAVEL_DO_MACOS =
  '{"com.apple.application-bundle", "public.unix-executable", "public.shell-script"}';

const SCRIPT_DO_MACOS = `try\nPOSIX path of (choose file with prompt "Selecione o executável" of type ${TIPOS_DE_EXECUTAVEL_DO_MACOS})\nend try`;

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
    { comando: 'zenity', argumentos: ['--file-selection', '--title=Selecione o executável'] },
    { comando: 'kdialog', argumentos: ['--getopenfilename', '.'] },
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
 * Abre o seletor e devolve o caminho escolhido, ou `null` quando o usuário
 * cancela.
 */
export async function selecionarArquivoNoSistema(): Promise<string | null> {
  for (const lancamento of montarLancamentos()) {
    const caminho = await executarSeletor(lancamento);
    if (caminho !== null) {
      return caminho === '' ? null : caminho;
    }
  }

  throw new SeletorDeArquivoIndisponivelError();
}
