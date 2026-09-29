import { spawn } from 'node:child_process';

/**
 * Seletor de arquivo nativo da máquina.
 *
 * O navegador não entrega o caminho real do arquivo escolhido — `input[type=file]`
 * só devolve o nome —, e o HUB SNK precisa do caminho absoluto para executar o
 * programa ou regravar o arquivo depois. Como servidor e usuário são a mesma
 * máquina, o diálogo é aberto aqui e só o caminho volta para a tela.
 */

/** O que cada sistema precisa para restringir o diálogo a um tipo de arquivo. */
export interface TipoDeArquivo {
  titulo: string;
  /** Formato do `OpenFileDialog.Filter`: pares `Descrição|padrões` separados por `|`. */
  filtroDoWindows: string;
  /** Complemento do `choose file` do AppleScript. */
  complementoDoMacos: string;
  /** Padrão do `--file-filter` do zenity e do filtro do kdialog. */
  filtroDoLinux: string;
}

/*
 * O `of type` não é filtro de conveniência aqui: sem ele o diálogo do macOS trata
 * o pacote `.app` como pasta navegável e não deixa escolher o aplicativo em si.
 * Os demais tipos cobrem binário Unix, script de shell e `.command`.
 */
export const TIPO_EXECUTAVEL: TipoDeArquivo = {
  titulo: 'Selecione o executável',
  filtroDoWindows:
    'Programas (*.exe;*.bat;*.cmd;*.lnk)|*.exe;*.bat;*.cmd;*.lnk|Todos os arquivos (*.*)|*.*',
  complementoDoMacos:
    'of type {"com.apple.application-bundle", "public.unix-executable", "public.shell-script"}',
  filtroDoLinux: '*',
};

/* No macOS o `.env` começa com ponto e fica invisível no diálogo sem `invisibles true`. */
export const TIPO_ENV: TipoDeArquivo = {
  titulo: 'Selecione o arquivo .env',
  filtroDoWindows: 'Arquivo .env (*.env)|*.env|Todos os arquivos (*.*)|*.*',
  complementoDoMacos: 'invisibles true',
  filtroDoLinux: '*.env',
};

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
 * HUB SNK e parece que nada aconteceu. A codificação da saída é fixada pelo
 * mesmo motivo do seletor de pasta: o PowerShell 5.1 escreve em cp850.
 */
function montarScriptDoWindows({ titulo, filtroDoWindows }: TipoDeArquivo): string {
  return `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Windows.Forms
$dialogo = New-Object System.Windows.Forms.OpenFileDialog
$dialogo.Title = '${titulo}'
$dialogo.Filter = '${filtroDoWindows}'
$janelaDeTopo = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($dialogo.ShowDialog($janelaDeTopo) -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::Out.Write($dialogo.FileName)
}
`;
}

function montarLancamentos(tipo: TipoDeArquivo): Lancamento[] {
  if (process.platform === 'win32') {
    return [
      {
        comando: 'powershell.exe',
        argumentos: ['-NoProfile', '-STA', '-Command', montarScriptDoWindows(tipo)],
      },
    ];
  }

  if (process.platform === 'darwin') {
    const script = `try\nPOSIX path of (choose file with prompt "${tipo.titulo}" ${tipo.complementoDoMacos})\nend try`;
    return [{ comando: 'osascript', argumentos: ['-e', script] }];
  }

  return [
    {
      comando: 'zenity',
      argumentos: [
        '--file-selection',
        `--title=${tipo.titulo}`,
        `--file-filter=${tipo.filtroDoLinux}`,
      ],
    },
    { comando: 'kdialog', argumentos: ['--getopenfilename', '.', tipo.filtroDoLinux] },
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

    // Decodifica o fluxo inteiro, não pedaço a pedaço: um caractere acentuado pode cair na divisa.
    processo.stdout.setEncoding('utf8');
    let saida = '';
    processo.stdout.on('data', (pedaco: string) => {
      saida += pedaco;
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
export async function selecionarArquivoNoSistema(
  tipo: TipoDeArquivo = TIPO_EXECUTAVEL,
): Promise<string | null> {
  for (const lancamento of montarLancamentos(tipo)) {
    const caminho = await executarSeletor(lancamento);
    if (caminho !== null) {
      return caminho === '' ? null : caminho;
    }
  }

  throw new SeletorDeArquivoIndisponivelError();
}
