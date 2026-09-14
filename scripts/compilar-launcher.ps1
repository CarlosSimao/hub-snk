<#
.SYNOPSIS
    Compila bin\SankhyaHub.exe — o launcher sem console que o atalho e o setup usam.

.DESCRIPTION
    O launcher abre o painel do hub numa aba do navegador padrao que ja esta em uso.
    Ele faz o trabalho inteiro em processo:

      1. sonda a porta do hub por TCP;
      2. porta aberta e aba do painel ja existente -> seleciona a aba e foca a janela,
         por UI Automation;
      3. porta aberta e nenhuma aba -> ShellExecute da URL, que o navegador em execucao
         atende criando uma ABA — nao uma segunda instancia dele;
      4. porta fechada -> ai sim chama scripts\abrir-hub.ps1 com janela, para o hub subir
         a vista do usuario, e sai.

    O passo 4 e o UNICO que dispara PowerShell, e so no caminho raro (o compose sobe o
    hub com `restart: unless-stopped`, entao ele costuma ja estar no ar). Isso e
    deliberado: um .exe sem assinatura cuja rotina normal e disparar
    `powershell -ExecutionPolicy Bypass` e exatamente o padrao que EDR corporativo
    (CrowdStrike Falcon, nesta maquina) trata como suspeito. Abrindo a URL por conta
    propria, o comportamento de todo dia vira "um programa abriu um link".

    De quebra some a partida do PowerShell do caminho quente: sao ~200 ms em vez dos
    ~800 ms da versao que delegava tudo ao script.

    Compila com o csc.exe do .NET Framework 4, presente em qualquer Windows: nao exige
    SDK, Visual Studio nem nada instalado.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\compilar-launcher.ps1
#>

[CmdletBinding()]
param(
    # Porta usada quando a variavel de ambiente SANKHYA_HUB_PORTA nao estiver definida.
    [int] $Porta = 4000,

    # Recompila mesmo que o .exe ja esteja atualizado.
    [switch] $Forcar
)

$ErrorActionPreference = 'Stop'

$RaizRepo = Split-Path -Parent $PSScriptRoot
$DiretorioSaida = Join-Path $RaizRepo 'bin'
$CaminhoExe = Join-Path $DiretorioSaida 'SankhyaHub.exe'
$CaminhoIcone = Join-Path $RaizRepo 'public\img\sankhya-hub.ico'
$ScriptAlvo = Join-Path $PSScriptRoot 'abrir-hub.ps1'

if (-not (Test-Path -LiteralPath $ScriptAlvo)) {
    throw "nao encontrei $ScriptAlvo"
}

# Framework64 e o padrao; o 32 bits fica como alternativa para instalacoes antigas.
$CandidatosCsc = @(
    (Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:SystemRoot 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
)
$Csc = $CandidatosCsc | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $Csc) {
    throw 'nao encontrei o csc.exe do .NET Framework 4 — o launcher precisa dele para ser compilado'
}

<#
    Caminho real das DLLs de UI Automation.

    Elas moram no GAC, e o csc nao resolve assembly do GAC por nome curto — ou existe um
    diretorio de Reference Assemblies (que so aparece com ferramentas de desenvolvimento
    instaladas) ou se passa o arquivo. Carregar cada uma aqui e perguntar o Location
    funciona em qualquer maquina.
#>
function Get-CaminhoAssembly {
    param([string] $Nome, [string] $TipoDeProva)

    Add-Type -AssemblyName $Nome -ErrorAction Stop
    $tipo = [type]$TipoDeProva
    return $tipo.Assembly.Location
}

$DllAutomationClient = Get-CaminhoAssembly -Nome 'UIAutomationClient' -TipoDeProva 'System.Windows.Automation.AutomationElement'
$DllAutomationTypes = Get-CaminhoAssembly -Nome 'UIAutomationTypes' -TipoDeProva 'System.Windows.Automation.ControlType'
$DllWindowsBase = Get-CaminhoAssembly -Nome 'WindowsBase' -TipoDeProva 'System.Windows.DependencyObject'

<#
    O codigo do launcher. E gerado, e nao versionado como .cs, porque a unica coisa que
    muda nele e a porta padrao, que vem do parametro deste script.
#>
$CodigoFonte = @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Windows.Automation;
using System.Windows.Forms;

internal static class Launcher
{
    private const int PortaPadrao = $Porta;

    // `<title>` de web/index.html — o texto que aparece na aba e o unico gancho para
    // reconhece-la. Precisa continuar igual ao \$MarcadorTitulo de abrir-hub.ps1.
    private const string MarcadorTitulo = "sankhya-hub";

    // A aba do Vite (scripts\desenvolver.ps1, porta 4001) serve a MESMA pagina. Por isso
    // web/src/main.tsx marca o titulo dela com este sufixo, e aqui ela e descartada.
    private const string SufixoDesenvolvimento = "(dev)";

    // Filtrar pelo processo, e nao pela classe da janela, e obrigatorio: `Chrome_WidgetWin_1`
    // e do Chromium, e todo aplicativo Electron usa a mesma — o VS Code aberto neste
    // repositorio tem "sankhya-hub" no titulo e seria confundido com o painel.
    private static readonly string[] NavegadoresConhecidos =
    {
        "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "chromium", "iexplore", "arc", "thorium"
    };

    [STAThread]
    private static int Main(string[] args)
    {
        // O .exe mora em <raiz>\bin\, entao a raiz do projeto e o diretorio de cima.
        // Mover o .exe para fora dessa pasta quebra o caminho de proposito: e o mesmo
        // contrato do atalho, que tambem aponta para dentro do repositorio.
        string caminhoExe = Assembly.GetExecutingAssembly().Location;
        string raiz = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(caminhoExe), ".."));
        string script = Path.Combine(raiz, "scripts", "abrir-hub.ps1");

        int porta = PortaPadrao;
        string portaDoAmbiente = Environment.GetEnvironmentVariable("SANKHYA_HUB_PORTA");
        int portaLida;
        if (!string.IsNullOrEmpty(portaDoAmbiente) && int.TryParse(portaDoAmbiente, out portaLida))
        {
            porta = portaLida;
        }

        if (!PortaEscutando(porta))
        {
            return SubirHub(raiz, script, porta, args);
        }

        // Aba ja aberta: trazer ela de volta e melhor do que empilhar uma duplicata.
        // Qualquer falha aqui e silenciosa — abrir uma aba nova resolve igual.
        try
        {
            if (MostrarAbaExistente())
            {
                return 0;
            }
        }
        catch
        {
        }

        return AbrirNoNavegador(porta);
    }

    // Sondagem de TCP e nao um GET em /api/healthz: aqui so interessa saber se ha algo
    // escutando, e o custo precisa ser desprezivel — este check roda antes de QUALQUER
    // pixel aparecer. O Fastify so escuta depois de registrar as rotas, entao "aceita
    // conexao" ja significa "responde".
    private static bool PortaEscutando(int porta)
    {
        try
        {
            using (TcpClient cliente = new TcpClient())
            {
                IAsyncResult tentativa = cliente.BeginConnect("127.0.0.1", porta, null, null);
                if (!tentativa.AsyncWaitHandle.WaitOne(500))
                {
                    return false;
                }
                cliente.EndConnect(tentativa);
                return true;
            }
        }
        catch
        {
            return false;
        }
    }

    // ShellExecute da URL. Quem recebe o endereco e o navegador padrao JA EM EXECUCAO,
    // que atende criando uma aba na janela existente — nao uma segunda instancia dele,
    // nem uma janela de app. Com o navegador fechado, o proprio Windows sobe o padrao.
    private static int AbrirNoNavegador(int porta)
    {
        try
        {
            ProcessStartInfo abertura = new ProcessStartInfo("http://localhost:" + porta);
            abertura.UseShellExecute = true;
            Process.Start(abertura);
            return 0;
        }
        catch (Exception erro)
        {
            MessageBox.Show(erro.Message, "Sankhya Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    // Hub parado: o script sobe o Docker, o container e os helpers, e abre a aba no fim.
    // E o unico caminho que dispara PowerShell, e aqui a janela aparece de proposito —
    // e nela que o progresso da subida e mostrado.
    private static int SubirHub(string raiz, string script, int porta, string[] args)
    {
        if (!File.Exists(script))
        {
            MessageBox.Show(
                "O hub nao esta no ar e eu nao encontrei:\n" + script +
                "\n\nO SankhyaHub.exe precisa ficar na pasta bin\\ do projeto.",
                "Sankhya Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }

        // -NoProfile: o perfil do usuario pode levar segundos e nada aqui depende dele.
        // -ExecutionPolicy Bypass: vale so para este processo, nao muda a politica da maquina.
        string argumentos = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Porta " + porta;
        foreach (string argumento in args)
        {
            argumentos += " " + argumento;
        }

        ProcessStartInfo inicio = new ProcessStartInfo();
        // powershell.exe (5.1) e nao pwsh.exe: o 5.1 esta em todo Windows e num caminho
        // estavel, enquanto o 7 da Store muda de diretorio a cada atualizacao.
        inicio.FileName = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.System),
            "WindowsPowerShell\\v1.0\\powershell.exe");
        inicio.Arguments = argumentos;
        inicio.WorkingDirectory = raiz;
        inicio.UseShellExecute = false;
        inicio.WindowStyle = ProcessWindowStyle.Normal;

        try
        {
            Process.Start(inicio);
            return 0;
        }
        catch (Exception erro)
        {
            MessageBox.Show(erro.Message, "Sankhya Hub", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    private static bool TituloDoPainel(string titulo)
    {
        if (string.IsNullOrEmpty(titulo)) { return false; }
        if (titulo.IndexOf(SufixoDesenvolvimento, StringComparison.OrdinalIgnoreCase) >= 0) { return false; }
        return titulo.IndexOf(MarcadorTitulo, StringComparison.OrdinalIgnoreCase) >= 0;
    }

    // Nome do processo do navegador padrao, lido do registro. Cobre o navegador que a
    // lista fixa nao previu — e e o mesmo programa que receberia a URL no final.
    private static string NavegadorPadrao()
    {
        try
        {
            object progId = Microsoft.Win32.Registry.GetValue(
                @"HKEY_CURRENT_USER\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
                "ProgId", null);
            if (progId == null) { return null; }

            object comando = Microsoft.Win32.Registry.GetValue(
                @"HKEY_CLASSES_ROOT\" + progId + @"\shell\open\command", null, null);
            if (comando == null) { return null; }

            // O comando vem como `"C:\...\app.exe" -- "%1"`; o executavel e o primeiro
            // token, com ou sem aspas.
            string texto = comando.ToString().Trim();
            string executavel;
            if (texto.StartsWith("\""))
            {
                int fecha = texto.IndexOf('"', 1);
                if (fecha < 0) { return null; }
                executavel = texto.Substring(1, fecha - 1);
            }
            else
            {
                int espaco = texto.IndexOf(' ');
                executavel = espaco < 0 ? texto : texto.Substring(0, espaco);
            }

            return Path.GetFileNameWithoutExtension(executavel).ToLowerInvariant();
        }
        catch
        {
            return null;
        }
    }

    private static bool EhNavegador(int processId, HashSet<string> navegadores)
    {
        try
        {
            return navegadores.Contains(Process.GetProcessById(processId).ProcessName.ToLowerInvariant());
        }
        catch
        {
            return false;
        }
    }

    // Seleciona a aba do painel em algum navegador aberto. true quando conseguiu.
    //
    // Antes da varredura tem um atalho barato: se o titulo da JANELA do navegador ja
    // contem o marcador, a aba do painel e a ativa dessa janela — basta trazer a janela.
    // So quando nenhuma bate e que vale pagar a arvore de acessibilidade (que, no
    // Chromium, so e construida porque um cliente UI Automation a pediu).
    private static bool MostrarAbaExistente()
    {
        HashSet<string> navegadores = new HashSet<string>(NavegadoresConhecidos);
        string padrao = NavegadorPadrao();
        if (!string.IsNullOrEmpty(padrao)) { navegadores.Add(padrao); }

        AutomationElementCollection janelas = AutomationElement.RootElement.FindAll(
            TreeScope.Children,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));

        List<AutomationElement> candidatas = new List<AutomationElement>();

        foreach (AutomationElement janela in janelas)
        {
            string nome;
            int processId;
            try
            {
                nome = janela.Current.Name;
                processId = janela.Current.ProcessId;
            }
            catch
            {
                continue;
            }

            if (!EhNavegador(processId, navegadores)) { continue; }

            if (TituloDoPainel(nome))
            {
                Focar(janela);
                return true;
            }

            candidatas.Add(janela);
        }

        foreach (AutomationElement janela in candidatas)
        {
            AutomationElement aba = AcharAba(janela);
            if (aba == null) { continue; }

            try
            {
                SelectionItemPattern selecao = (SelectionItemPattern) aba.GetCurrentPattern(SelectionItemPattern.Pattern);
                selecao.Select();
            }
            catch
            {
                continue;
            }

            Focar(janela);
            return true;
        }

        return false;
    }

    // Busca em LARGURA, com orcamento. No Chromium a barra de abas fica a poucos niveis
    // do topo (medido: profundidade 8, menos de 50 elementos visitados), enquanto o
    // conteudo da pagina e uma arvore enorme: descer em profundidade, ou usar um FindAll
    // com TreeScope.Descendants, percorreria o DOM inteiro e levaria segundos por janela.
    // Elementos Document sao a raiz da pagina renderizada e nunca contem abas, entao nao
    // sao abertos. Os tetos sao folgados — uma versao do navegador com mais um nivel nao
    // pode quebrar o atalho — sem deixar de limitar o pior caso.
    private static AutomationElement AcharAba(AutomationElement janela)
    {
        const int ProfundidadeMaxima = 12;
        const int OrcamentoElementos = 600;

        TreeWalker walker = TreeWalker.ControlViewWalker;
        Queue<KeyValuePair<AutomationElement, int>> fila = new Queue<KeyValuePair<AutomationElement, int>>();
        fila.Enqueue(new KeyValuePair<AutomationElement, int>(janela, 0));

        int visitados = 0;
        while (fila.Count > 0 && visitados < OrcamentoElementos)
        {
            KeyValuePair<AutomationElement, int> atual = fila.Dequeue();
            visitados++;

            ControlType tipo;
            try { tipo = atual.Key.Current.ControlType; }
            catch { continue; }

            if (tipo == ControlType.TabItem)
            {
                string nome;
                try { nome = atual.Key.Current.Name; }
                catch { continue; }

                if (TituloDoPainel(nome)) { return atual.Key; }
                // Dentro de uma aba nao ha outra aba: nao vale descer.
                continue;
            }

            if (tipo == ControlType.Document) { continue; }
            if (atual.Value >= ProfundidadeMaxima) { continue; }

            try
            {
                AutomationElement filho = walker.GetFirstChild(atual.Key);
                while (filho != null)
                {
                    fila.Enqueue(new KeyValuePair<AutomationElement, int>(filho, atual.Value + 1));
                    filho = walker.GetNextSibling(filho);
                }
            }
            catch
            {
            }
        }

        return null;
    }

    // Traz a janela para a frente, restaurando-a se estiver minimizada. Sem P/Invoke de
    // user32: UI Automation ja expoe as duas operacoes, e uma DllImport de
    // SetForegroundWindow num binario sem assinatura e ruido desnecessario para o EDR.
    private static void Focar(AutomationElement janela)
    {
        try
        {
            WindowPattern padraoJanela = (WindowPattern) janela.GetCurrentPattern(WindowPattern.Pattern);
            if (padraoJanela.Current.WindowVisualState == WindowVisualState.Minimized)
            {
                padraoJanela.SetWindowVisualState(WindowVisualState.Normal);
            }
        }
        catch
        {
            // Janela sem WindowPattern: segue para o SetFocus assim mesmo.
        }

        try
        {
            janela.SetFocus();
        }
        catch
        {
            // Sem foco a aba ainda foi selecionada — o pior caso e o usuario clicar na
            // janela do navegador, nao uma aba duplicada.
        }
    }
}
"@

if (-not (Test-Path -LiteralPath $DiretorioSaida)) {
    New-Item -ItemType Directory -Path $DiretorioSaida | Out-Null
}

# Recompilar a cada chamada e barato (menos de um segundo), mas pular quando nada mudou
# deixa o criar-atalho.ps1 chamar este script sem pensar duas vezes.
if ((Test-Path -LiteralPath $CaminhoExe) -and -not $Forcar) {
    $exe = Get-Item -LiteralPath $CaminhoExe
    $esteScript = Get-Item -LiteralPath $PSCommandPath
    if ($exe.LastWriteTime -gt $esteScript.LastWriteTime) {
        Write-Host "  Launcher já atualizado: $CaminhoExe" -ForegroundColor DarkGray
        return
    }
}

$ArquivoFonte = Join-Path ([IO.Path]::GetTempPath()) ('SankhyaHubLauncher-' + [guid]::NewGuid().ToString('N') + '.cs')
Set-Content -LiteralPath $ArquivoFonte -Value $CodigoFonte -Encoding UTF8

try {
    $argumentosCsc = @(
        '/nologo'
        # winexe: subsistema Windows, sem console. E o que impede o piscar do prompt.
        '/target:winexe'
        '/optimize+'
        '/r:System.dll'
        '/r:System.Windows.Forms.dll'
        "/r:$DllAutomationClient"
        "/r:$DllAutomationTypes"
        "/r:$DllWindowsBase"
        "/out:$CaminhoExe"
    )

    if (Test-Path -LiteralPath $CaminhoIcone) {
        $argumentosCsc += "/win32icon:$CaminhoIcone"
    }
    else {
        Write-Host "  Sem ícone ($CaminhoIcone) — rode scripts\gerar-icone-atalho.ps1 e compile de novo." -ForegroundColor Yellow
    }

    $argumentosCsc += $ArquivoFonte

    $saida = & $Csc @argumentosCsc 2>&1
    if ($LASTEXITCODE -ne 0) {
        $saida | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        throw "a compilação do launcher falhou (código $LASTEXITCODE)"
    }
}
finally {
    Remove-Item -LiteralPath $ArquivoFonte -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "  Launcher compilado: $CaminhoExe" -ForegroundColor Green
Write-Host '  Duplo clique abre o painel numa aba do navegador padrão.' -ForegroundColor DarkGray
Write-Host ''
