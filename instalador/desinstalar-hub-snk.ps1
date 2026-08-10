# Remove o HUB SNK instalado para o usuário atual.
#
# O cadastro não é apagado: perder o cadastro por engano é irreversível, e
# reinstalar logo em seguida é o caso mais comum. O caminho dele é mostrado no
# fim, para quem quiser apagá-lo à mão.
#
# Uso: desinstalar-hub-snk.bat (ou pwsh -File desinstalar-hub-snk.ps1)

$ErrorActionPreference = 'Stop'

$pastaDoPrograma = Split-Path -Parent $MyInvocation.MyCommand.Path
$pastaDoHubSnk = Join-Path $env:LOCALAPPDATA 'HubSnk'
$arquivoDeConfiguracao = Join-Path $pastaDoHubSnk 'hub-snk.env'

$atalhos = @(
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\HUB SNK.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\HUB SNK.lnk'),
    (Join-Path ([System.Environment]::GetFolderPath('Desktop')) 'HUB SNK.lnk')
)

# O padrão vai escrito por extenso, e não pela caixa da letra: quem lê [s/N]
# rápido não percebe que a maiúscula é a resposta de quem aperta Enter.
function PerguntarSimOuNao([string]$rotulo, [bool]$padraoSim) {
    $padrao = if ($padraoSim) { 'S' } else { 'N' }
    $resposta = (Read-Host "$rotulo [S/N] (padrão: $padrao)").Trim().ToLowerInvariant()

    if ($resposta -eq '') { return $padraoSim }
    return $resposta.StartsWith('s')
}

function LerPastaDoCadastro {
    if (-not (Test-Path -LiteralPath $arquivoDeConfiguracao)) {
        return (Join-Path $pastaDoHubSnk 'dados')
    }

    foreach ($linha in Get-Content -LiteralPath $arquivoDeConfiguracao) {
        if ($linha.Trim().StartsWith('HUB_DADOS_DIR=')) {
            return $linha.Trim().Substring('HUB_DADOS_DIR='.Length).Trim()
        }
    }

    return (Join-Path $pastaDoHubSnk 'dados')
}

# O node.exe em uso segura os arquivos da pasta: sem encerrar antes, a remoção
# falha pela metade.
function EncerrarServidor {
    $encerrar = Join-Path $pastaDoPrograma 'encerrar-hub-snk.vbs'
    if (-not (Test-Path -LiteralPath $encerrar)) { return }

    & "$env:SystemRoot\System32\wscript.exe" $encerrar
    Start-Sleep -Milliseconds 500
}

# --------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath (Join-Path $pastaDoPrograma 'abrir-hub-snk.vbs'))) {
    Write-Host 'Este script precisa rodar de dentro da pasta em que o HUB SNK foi instalado.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '  HUB SNK — desinstalação' -ForegroundColor Cyan
Write-Host "  Programa: $pastaDoPrograma"
Write-Host ''

if (-not (PerguntarSimOuNao 'Remover o HUB SNK desta máquina?' $false)) {
    Write-Host 'Nada foi removido.'
    exit 0
}

$pastaDoCadastro = LerPastaDoCadastro

EncerrarServidor

foreach ($atalho in $atalhos) {
    if (Test-Path -LiteralPath $atalho) { Remove-Item -LiteralPath $atalho -Force }
}

if (Test-Path -LiteralPath $arquivoDeConfiguracao) {
    Remove-Item -LiteralPath $arquivoDeConfiguracao -Force
}

$log = Join-Path $pastaDoHubSnk 'hub-snk.log'
if (Test-Path -LiteralPath $log) { Remove-Item -LiteralPath $log -Force }

$navegadorAntigo = Join-Path $pastaDoHubSnk 'navegador.txt'
if (Test-Path -LiteralPath $navegadorAntigo) { Remove-Item -LiteralPath $navegadorAntigo -Force }

# A pasta do programa é apagada de fora dela: o próprio script está lá dentro, e
# o PowerShell não remove o diretório de trabalho corrente.
Set-Location $env:LOCALAPPDATA
Remove-Item -LiteralPath $pastaDoPrograma -Recurse -Force

Write-Host ''
Write-Host '  HUB SNK removido.' -ForegroundColor Green

if (Test-Path -LiteralPath $pastaDoCadastro) {
    Write-Host ''
    Write-Host '  Seu cadastro continua em:'
    Write-Host "  $pastaDoCadastro"
    Write-Host '  Apague essa pasta à mão se não quiser mais guardá-lo.'
}

Write-Host ''
