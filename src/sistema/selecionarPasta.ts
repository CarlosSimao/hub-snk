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
 * O diálogo do Windows exige apartamento STA, daí o `-STA`.
 *
 * O "Procurar Pasta" é um diálogo Win32 (`SHBrowseForFolder`), não um `Form`:
 * ele não herda `TopMost` da janela dona, e a dona só o impede de cair atrás
 * dela mesma — não atrás do navegador. Pior, o processo nasce a partir do
 * servidor, que não detém o primeiro plano, então o Windows nega a promoção
 * normal de foco e o diálogo aparece escondido atrás da janela do HUB SNK.
 *
 * A saída é marcar o próprio diálogo como `HWND_TOPMOST` assim que ele abre —
 * `SetWindowPos` não exige direito de primeiro plano. Como `ShowDialog` bloqueia
 * a thread, quem faz isso é um timer, que roda no laço de mensagens do modal e
 * pega o diálogo por `GetWindow(..., GW_ENABLEDPOPUP)` a partir da dona. A
 * janela dona existe só para dar esse ponto de partida, por isso nasce
 * transparente e com 1x1 pixel.
 */
const SCRIPT_DO_WINDOWS = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace HubSnk -Name Janela -MemberDefinition @'
[DllImport("user32.dll")]
public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
[DllImport("user32.dll")]
public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);
[DllImport("user32.dll")]
public static extern bool SetForegroundWindow(IntPtr hWnd);
'@

$POPUP_HABILITADO = 6
$SEMPRE_NO_TOPO = [IntPtr](-1)
$MANTER_POSICAO_E_TAMANHO = 0x0013

$dialogo = New-Object System.Windows.Forms.FolderBrowserDialog
$dialogo.Description = 'Selecione a pasta do repositório'
$dialogo.ShowNewFolderButton = $false

$janelaDona = New-Object System.Windows.Forms.Form -Property @{
  TopMost = $true
  ShowInTaskbar = $false
  FormBorderStyle = 'None'
  Opacity = 0
  Size = New-Object System.Drawing.Size(1, 1)
  StartPosition = 'CenterScreen'
}
$janelaDona.Show()
$janelaDona.Activate()

$vigia = New-Object System.Windows.Forms.Timer
$vigia.Interval = 100
$vigia.add_Tick({
  $popup = [HubSnk.Janela]::GetWindow($janelaDona.Handle, $POPUP_HABILITADO)
  if ($popup -ne [IntPtr]::Zero) {
    $vigia.Stop()
    [void][HubSnk.Janela]::SetWindowPos($popup, $SEMPRE_NO_TOPO, 0, 0, 0, 0, $MANTER_POSICAO_E_TAMANHO)
    [void][HubSnk.Janela]::SetForegroundWindow($popup)
  }
})
$vigia.Start()

try {
  if ($dialogo.ShowDialog($janelaDona) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write($dialogo.SelectedPath)
  }
} finally {
  $vigia.Stop()
  $vigia.Dispose()
  $janelaDona.Close()
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
