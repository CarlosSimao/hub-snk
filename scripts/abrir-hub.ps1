<#
.SYNOPSIS
    Abre o painel do sankhya-hub numa aba do navegador padrao que ja esta aberto.

.DESCRIPTION
    E o ponto de entrada do atalho. Tres cenarios, nesta ordem:

      1. Hub no ar e aba do painel ja aberta -> traz a aba existente para a frente.
      2. Hub no ar e nenhuma aba aberta      -> abre uma aba nova.
      3. Hub fora do ar                      -> sobe tudo com iniciar-monitor.ps1
                                                e so entao abre a aba.

    A abertura e sempre ShellExecute da URL (`Start-Process http://...`): quem recebe
    o endereco e o navegador padrao JA EM EXECUCAO, que responde criando uma ABA na
    janela existente — nao uma segunda instancia do navegador, nem uma janela de app.
    Com o navegador fechado, o proprio Windows sobe o padrao. E o mesmo caminho que o
    painel usa para abrir o Sankhya dos clientes, entao o login ja feito vale para os
    dois: mesma instancia, mesmo perfil, mesmos cookies.

    O passo 1 (reaproveitar a aba) usa UI Automation para achar a aba pelo titulo da
    pagina. Se o navegador nao expuser a arvore de acessibilidade, cai no passo 2 — o
    pior caso e uma aba duplicada, nunca uma falha.

.NOTES
    Compativel com Windows PowerShell 5.1 e PowerShell 7.
    Atalho: scripts/criar-atalho.ps1   Launcher sem console: scripts/compilar-launcher.ps1
#>

[CmdletBinding()]
param(
    # Porta publicada pelo docker-compose.yml.
    [int] $Porta = 4000,

    # Nao procura a aba existente: abre direto uma aba nova.
    [switch] $SemFoco,

    # So garante o hub no ar, sem mexer no navegador. Para o logon do Windows.
    [switch] $SemNavegador
)

$ErrorActionPreference = 'Stop'

$UrlPainel = "http://localhost:$Porta"

# `<title>` de web/index.html. E o texto que aparece na aba do navegador e o unico
# gancho que temos para reconhece-la — mudar o title sem mudar aqui faz o script
# abrir aba nova toda vez (degrada, nao quebra).
$MarcadorTitulo = 'sankhya-hub'

# A aba do Vite (scripts/desenvolver.ps1, porta 4001) serve a MESMA pagina e teria o
# mesmo titulo. Por isso web/src/main.tsx marca o titulo com este sufixo quando roda em
# desenvolvimento, e aqui a aba com ele e descartada: senao o atalho poderia trazer a
# aba do dev no lugar da do hub instalado.
$SufixoDesenvolvimento = '(dev)'

$ScriptIniciar = Join-Path $PSScriptRoot 'iniciar-monitor.ps1'

function Escrever-Etapa {
    param([string] $Texto)
    Write-Host "  > $Texto" -ForegroundColor Cyan
}

function Escrever-Ok {
    param([string] $Texto)
    Write-Host "  + $Texto" -ForegroundColor Green
}

function Escrever-Falha {
    param([string] $Texto)
    Write-Host "  ! $Texto" -ForegroundColor Red
}

<#
    Este texto e o titulo da aba (ou da janela) do painel?
#>
function Test-TituloDoPainel {
    param([string] $Titulo)

    if (-not $Titulo) { return $false }
    if ($Titulo -like "*$SufixoDesenvolvimento*") { return $false }
    return ($Titulo -like "*$MarcadorTitulo*")
}

<#
    Sondagem de TCP em vez de um GET em /api/healthz.

    Medido nesta maquina: 112 ms contra 2,2 s. A diferenca nao e a rede — e a primeira
    chamada do Invoke-WebRequest no Windows PowerShell 5.1, que carrega e compila a pilha
    de WebRequest inteira. Dois segundos entre o duplo clique e a aba aparecer arruinariam
    a sensacao que este atalho existe para dar.

    Porta aberta basta como resposta: o Fastify so escuta depois de registrar as rotas,
    entao "aceita conexao" ja significa "responde". O iniciar-monitor.ps1 continua fazendo
    a verificacao por HTTP, que e onde ela importa — esperar o hub terminar de subir.
#>
function Test-HubNoAr {
    try {
        $cliente = New-Object System.Net.Sockets.TcpClient
        try {
            $tentativa = $cliente.BeginConnect('127.0.0.1', $Porta, $null, $null)
            if (-not $tentativa.AsyncWaitHandle.WaitOne(500)) { return $false }
            $cliente.EndConnect($tentativa)
            return $true
        }
        finally {
            $cliente.Close()
        }
    }
    catch {
        return $false
    }
}

<#
    Traz uma janela para a frente, restaurando-a se estiver minimizada.

    Tudo por UI Automation, sem P/Invoke: um `Add-Type -MemberDefinition` com as
    assinaturas de user32 chamaria o compilador de C# em tempo de execucao e sozinho
    custaria mais de um segundo — mais do que todo o resto deste script junto.

    AppActivate fica de rede para o caso de o SetFocus ser recusado: quem nao detem o
    foco nao pode simplesmente toma-lo no Windows, e o caminho "subi o hub e so depois
    fui abrir a aba" deixa este processo minutos longe do duplo clique que o originou.
#>
function Set-JanelaEmFoco {
    param($Janela)

    try {
        $padraoJanela = $Janela.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
        if ($padraoJanela.Current.WindowVisualState -eq [System.Windows.Automation.WindowVisualState]::Minimized) {
            $padraoJanela.SetWindowVisualState([System.Windows.Automation.WindowVisualState]::Normal)
        }
    }
    catch {
        # Janela sem WindowPattern: segue para o SetFocus assim mesmo.
    }

    try {
        $Janela.SetFocus()
        return
    }
    catch {
        # Cai para o AppActivate.
    }

    try {
        $shell = New-Object -ComObject WScript.Shell
        $shell.AppActivate($Janela.Current.ProcessId) | Out-Null
    }
    catch {
        # Sem foco a aba ainda foi selecionada — o pior caso e o usuario clicar na
        # janela do navegador, nao uma aba duplicada.
    }
}

function Initialize-UIAutomation {
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

<#
    Procura a aba do painel dentro de UMA janela, por largura e com orcamento.

    A busca e em largura de proposito: no Chromium a barra de abas fica a poucos niveis
    do topo, enquanto o conteudo da pagina e uma arvore enorme. Descer em profundidade
    (ou um FindAll com TreeScope::Descendants) percorreria o DOM inteiro e levaria
    segundos por janela. Dois cortes garantem o custo: elementos Document sao a raiz da
    pagina renderizada e nunca contem abas, entao nao sao abertos; e a profundidade e o
    numero de elementos visitados tem teto.
#>
function Find-AbaDoHub {
    param(
        $Janela,
        # Medido no Edge e no Chrome de hoje: a barra de abas fica na profundidade 8 e a
        # varredura inteira visita menos de 50 elementos. Os tetos sao folgados de
        # proposito — uma versao do navegador que inclua mais um nivel nao pode quebrar
        # o atalho — sem deixar de limitar o pior caso.
        [int] $ProfundidadeMaxima = 12,
        [int] $OrcamentoElementos = 600
    )

    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    $tipoAba = [System.Windows.Automation.ControlType]::TabItem
    $tipoDocumento = [System.Windows.Automation.ControlType]::Document

    $fila = New-Object System.Collections.Queue
    $fila.Enqueue([pscustomobject]@{ Elemento = $Janela; Profundidade = 0 })
    $visitados = 0

    while ($fila.Count -gt 0 -and $visitados -lt $OrcamentoElementos) {
        $atual = $fila.Dequeue()
        $visitados++

        try { $tipo = $atual.Elemento.Current.ControlType }
        catch { continue }

        if ($tipo -eq $tipoAba) {
            try { $nome = $atual.Elemento.Current.Name } catch { $nome = '' }
            if (Test-TituloDoPainel $nome) { return $atual.Elemento }
            # Dentro de uma aba nao ha outra aba: nao vale descer.
            continue
        }

        if ($tipo -eq $tipoDocumento) { continue }
        if ($atual.Profundidade -ge $ProfundidadeMaxima) { continue }

        try { $filho = $walker.GetFirstChild($atual.Elemento) }
        catch { continue }

        while ($null -ne $filho) {
            $fila.Enqueue([pscustomobject]@{ Elemento = $filho; Profundidade = $atual.Profundidade + 1 })
            try { $filho = $walker.GetNextSibling($filho) }
            catch { break }
        }
    }

    return $null
}

<#
    Nome do processo do navegador padrao do Windows, sem extensao ('chrome', 'msedge'...).

    Serve para reconhecer as janelas do navegador. A lista fixa em Get-ProcessosDeNavegador
    ja cobre os conhecidos; isto aqui cobre o navegador que ninguem previu, e e o mesmo
    programa que vai receber a URL no final.
#>
function Get-NavegadorPadrao {
    try {
        $chaveEscolha = 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice'
        $progId = (Get-ItemProperty -LiteralPath $chaveEscolha -ErrorAction Stop).ProgId
        if (-not $progId) { return $null }

        $comando = (Get-ItemProperty -LiteralPath "Registry::HKEY_CLASSES_ROOT\$progId\shell\open\command" -ErrorAction Stop).'(default)'
        if (-not $comando) { return $null }

        # O comando vem como `"C:\...\app.exe" -- "%1"`; o executavel e o primeiro token,
        # com ou sem aspas.
        if ($comando -match '^\s*"([^"]+)"') { $executavel = $Matches[1] }
        elseif ($comando -match '^\s*(\S+)') { $executavel = $Matches[1] }
        else { return $null }

        return [IO.Path]::GetFileNameWithoutExtension($executavel).ToLowerInvariant()
    }
    catch {
        return $null
    }
}

<#
    Processos que contam como navegador.

    Filtrar pelo processo, e nao so pela classe da janela, e obrigatorio: a classe
    `Chrome_WidgetWin_1` e do Chromium, e todo aplicativo Electron (VS Code a frente)
    usa a mesma. Sem este filtro, uma janela do editor aberta neste repositorio bate
    pelo titulo — que contem o nome da pasta — e o atalho traria o editor para a frente
    em vez do painel.
#>
function Get-ProcessosDeNavegador {
    $conhecidos = @('chrome', 'msedge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium', 'iexplore', 'arc', 'thorium')
    $padrao = Get-NavegadorPadrao
    if ($padrao) { $conhecidos += $padrao }
    return ($conhecidos | Select-Object -Unique)
}

<#
    Ativa a aba do painel em algum navegador aberto. $true quando conseguiu.

    Antes da varredura de UI Automation tem um atalho barato: se o titulo da JANELA do
    navegador ja contem o marcador, a aba do painel e a ativa dessa janela — basta trazer
    a janela. So quando nenhuma bate e que vale pagar a arvore de acessibilidade (que, no
    Chromium, so e construida porque um cliente UIA a pediu).
#>
function Show-AbaDoHub {
    if (-not (Initialize-UIAutomation)) { return $false }

    try {
        $condicaoJanela = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Window)
        $janelas = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
            [System.Windows.Automation.TreeScope]::Children, $condicaoJanela)
    }
    catch {
        return $false
    }

    $processosDeNavegador = Get-ProcessosDeNavegador

    # Um Get-Process para a maquina toda, e nao um por janela: a lista inteira sai mais
    # barata que meia duzia de consultas por PID.
    $nomePorPid = @{}
    foreach ($processo in Get-Process) { $nomePorPid[$processo.Id] = $processo.ProcessName.ToLowerInvariant() }

    $candidatas = @()
    foreach ($janela in $janelas) {
        try { $nome = $janela.Current.Name; $processoDaJanela = $nomePorPid[$janela.Current.ProcessId] }
        catch { continue }
        if (-not $nome) { continue }
        if ($processosDeNavegador -notcontains $processoDaJanela) { continue }

        if (Test-TituloDoPainel $nome) {
            Set-JanelaEmFoco -Janela $janela
            return $true
        }
        $candidatas += $janela
    }

    foreach ($janela in $candidatas) {
        $aba = Find-AbaDoHub -Janela $janela
        if ($null -eq $aba) { continue }

        try {
            $selecao = $aba.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
            $selecao.Select()
        }
        catch {
            continue
        }

        Set-JanelaEmFoco -Janela $janela
        return $true
    }

    return $false
}

# --- fluxo -------------------------------------------------------------------

try {
    if (-not (Test-HubNoAr)) {
        Write-Host ''
        Write-Host '  sankhya-hub' -ForegroundColor White
        Write-Host '  -----------' -ForegroundColor DarkGray
        Escrever-Etapa 'Hub parado — iniciando'

        if (-not (Test-Path -LiteralPath $ScriptIniciar)) {
            throw "nao encontrei $ScriptIniciar"
        }

        # -SemNavegador: quem abre a aba e este script, no final, com o reaproveitamento
        # da aba existente. Deixar o iniciar-monitor abrir tambem daria duas abas.
        & $ScriptIniciar -Porta $Porta -SemNavegador
        if ($LASTEXITCODE -ne 0) {
            Escrever-Falha 'A inicialização falhou — veja as mensagens acima.'
            Start-Sleep -Seconds 10
            exit 1
        }
    }

    if ($SemNavegador) { exit 0 }

    if (-not $SemFoco) {
        if (Show-AbaDoHub) {
            Escrever-Ok 'Painel trazido para a frente na aba que já estava aberta.'
            exit 0
        }
    }

    # Aqui esta o ponto do recurso: ShellExecute da URL. O navegador padrao em execucao
    # recebe o endereco e cria uma aba; nenhuma segunda instancia e criada.
    Start-Process $UrlPainel
    Escrever-Ok "Painel aberto em $UrlPainel"
    exit 0
}
catch {
    Escrever-Falha $_.Exception.Message
    Start-Sleep -Seconds 10
    exit 1
}
