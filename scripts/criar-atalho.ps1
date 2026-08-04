<#
.SYNOPSIS
    Cria o atalho "Monitor Hub" no Desktop.

.DESCRIPTION
    Roda uma vez. O atalho aponta para `iniciar-monitor.ps1` neste mesmo diretorio,
    entao mover o repositorio quebra o atalho — e so rodar este script de novo.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\criar-atalho.ps1
#>

[CmdletBinding()]
param(
    [string] $Nome = 'Monitor Hub'
)

$ErrorActionPreference = 'Stop'

$ScriptDeInicio = Join-Path $PSScriptRoot 'iniciar-monitor.ps1'
if (-not (Test-Path -LiteralPath $ScriptDeInicio)) {
    throw "nao encontrei $ScriptDeInicio"
}

# GetFolderPath resolve o Desktop de verdade — com OneDrive ativo ele NAO fica em
# %USERPROFILE%\Desktop, e montar o caminho na mao criaria o atalho num diretorio
# que o usuario nao ve.
$Desktop = [Environment]::GetFolderPath('Desktop')
$CaminhoAtalho = Join-Path $Desktop "$Nome.lnk"

<#
    O icone do Docker Desktop, quando instalado. Um atalho sem icone proprio herda o
    do PowerShell e some no meio dos outros no Desktop.
#>
function Get-IconeDocker {
    $candidatos = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    )
    foreach ($caminho in $candidatos) {
        if ($caminho -and (Test-Path -LiteralPath $caminho)) { return "$caminho,0" }
    }
    return $null
}

$shell = New-Object -ComObject WScript.Shell
$atalho = $shell.CreateShortcut($CaminhoAtalho)

# `powershell.exe` em vez de `pwsh.exe`: o 5.1 esta em todo Windows e num caminho
# estavel, enquanto o 7 instalado pela Store vive num diretorio que muda a cada
# atualizacao de versao. O script roda igual nos dois.
$atalho.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

# -NoProfile: o perfil do usuario pode levar segundos e nada aqui depende dele.
# -ExecutionPolicy Bypass: vale so para este processo, nao muda a politica da maquina.
$atalho.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$ScriptDeInicio`""

$atalho.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$atalho.Description = 'Sobe o Docker, o sankhya-hub e abre o painel no navegador'
$atalho.WindowStyle = 1   # janela normal: e nela que o progresso aparece

$icone = Get-IconeDocker
if ($icone) { $atalho.IconLocation = $icone }

$atalho.Save()

Write-Host ''
Write-Host "  Atalho criado: $CaminhoAtalho" -ForegroundColor Green
Write-Host '  Duplo clique sobe o Docker, o hub e abre o painel.' -ForegroundColor DarkGray
Write-Host ''
