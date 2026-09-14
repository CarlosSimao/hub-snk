<#
.SYNOPSIS
    Cria o atalho "Sankhya Hub" no Desktop.

.DESCRIPTION
    Roda uma vez. O atalho aponta para `bin\SankhyaHub.exe` (compilado aqui se ainda
    nao existir), que por sua vez chama `abrir-hub.ps1`. Mover o repositorio quebra o
    atalho — e so rodar este script de novo.

    O alvo e o .exe, e nao o .ps1, por causa do console: um atalho para powershell.exe
    pisca uma janela preta em toda abertura, inclusive quando o hub ja esta no ar e a
    unica coisa a fazer e trazer a aba existente para a frente. Numa maquina sem o csc
    do .NET Framework o .exe nao e gerado e o atalho cai para o powershell.exe direto.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\criar-atalho.ps1
#>

[CmdletBinding()]
param(
    [string] $Nome = 'Sankhya Hub'
)

$ErrorActionPreference = 'Stop'

$RaizRepo = Split-Path -Parent $PSScriptRoot
$ScriptDeInicio = Join-Path $PSScriptRoot 'abrir-hub.ps1'
if (-not (Test-Path -LiteralPath $ScriptDeInicio)) {
    throw "nao encontrei $ScriptDeInicio"
}

# Best-effort: numa maquina sem o csc a falha aqui nao impede o atalho de existir, so
# faz ele apontar para o powershell.exe e voltar a piscar o console.
$Launcher = Join-Path $RaizRepo 'bin\SankhyaHub.exe'
$ScriptDoLauncher = Join-Path $PSScriptRoot 'compilar-launcher.ps1'
if ((-not (Test-Path -LiteralPath $Launcher)) -and (Test-Path -LiteralPath $ScriptDoLauncher)) {
    try {
        & $ScriptDoLauncher
    }
    catch {
        Write-Host "  Não consegui compilar o launcher: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# GetFolderPath resolve o Desktop de verdade — com OneDrive ativo ele NAO fica em
# %USERPROFILE%\Desktop, e montar o caminho na mao criaria o atalho num diretorio
# que o usuario nao ve.
$Desktop = [Environment]::GetFolderPath('Desktop')
$CaminhoAtalho = Join-Path $Desktop "$Nome.lnk"

# Marca Sankhya + semaforo, gerado por scripts\gerar-icone-atalho.ps1. Um atalho
# sem icone proprio herda o do PowerShell e some no meio dos outros no Desktop.
$IconeAtalho = Join-Path $RaizRepo 'public\img\sankhya-hub.ico'
if (-not (Test-Path -LiteralPath $IconeAtalho)) {
    throw "nao encontrei $IconeAtalho — rode scripts\gerar-icone-atalho.ps1 primeiro"
}

$shell = New-Object -ComObject WScript.Shell
$atalho = $shell.CreateShortcut($CaminhoAtalho)

if (Test-Path -LiteralPath $Launcher) {
    $atalho.TargetPath = $Launcher
    $atalho.Arguments = ''
}
else {
    # `powershell.exe` em vez de `pwsh.exe`: o 5.1 esta em todo Windows e num caminho
    # estavel, enquanto o 7 instalado pela Store vive num diretorio que muda a cada
    # atualizacao de versao. O script roda igual nos dois.
    $atalho.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

    # -NoProfile: o perfil do usuario pode levar segundos e nada aqui depende dele.
    # -ExecutionPolicy Bypass: vale so para este processo, nao muda a politica da maquina.
    $atalho.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptDeInicio`""
}

$atalho.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$atalho.Description = 'Abre o painel do Sankhya Hub numa aba do navegador padrao'
$atalho.WindowStyle = 1   # janela normal: e nela que o progresso da primeira subida aparece

$atalho.IconLocation = "$IconeAtalho,0"

$atalho.Save()

Write-Host ''
Write-Host "  Atalho criado: $CaminhoAtalho" -ForegroundColor Green
if (Test-Path -LiteralPath $Launcher) {
    Write-Host "  Alvo: $Launcher" -ForegroundColor DarkGray
}
else {
    Write-Host '  Sem o launcher: o atalho vai piscar um console a cada abertura.' -ForegroundColor Yellow
}
Write-Host '  Duplo clique abre o painel numa aba do navegador que já está aberto.' -ForegroundColor DarkGray
Write-Host '  Com o hub parado, ele sobe antes — com janela, mostrando o progresso.' -ForegroundColor DarkGray
Write-Host ''
