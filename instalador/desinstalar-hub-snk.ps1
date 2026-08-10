# Remove o HUB SNK instalado para o usuário atual.
#
# O cadastro não é apagado: perder o cadastro por engano é irreversível, e
# reinstalar logo em seguida é o caso mais comum. O caminho dele é mostrado no
# fim, para quem quiser apagá-lo à mão.
#
# Uso: desinstalar-hub-snk.bat (ou pwsh -File desinstalar-hub-snk.ps1)

$ErrorActionPreference = 'Stop'

$pastaDoScript = Split-Path -Parent $MyInvocation.MyCommand.Path
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

function ValorGravado([string]$chave, [string]$padrao) {
    if (-not (Test-Path -LiteralPath $arquivoDeConfiguracao)) { return $padrao }

    foreach ($linha in Get-Content -LiteralPath $arquivoDeConfiguracao) {
        $texto = $linha.Trim()
        if ($texto.StartsWith("$chave=")) {
            $valor = $texto.Substring($chave.Length + 1).Trim()
            if ($valor -ne '') { return $valor }
        }
    }

    return $padrao
}

# O servidor no ar segura os arquivos que está usando — inclusive o log, aberto
# pelo `>>` do cmd.exe que o launcher usa. Sem encerrar antes, a remoção falha
# pela metade.
function EncerrarServidor([string]$destino) {
    $encerrar = Join-Path $destino 'encerrar-hub-snk.vbs'
    if (-not (Test-Path -LiteralPath $encerrar)) { return }

    & "$env:SystemRoot\System32\wscript.exe" $encerrar
    Start-Sleep -Milliseconds 500
}

# Arquivo que outro processo ainda segura não justifica abortar a remoção pela
# metade: o que importa é sair o programa, e o log é rastro.
function RemoverSePossivel([string]$caminho) {
    if (-not (Test-Path -LiteralPath $caminho)) { return $true }

    try {
        Remove-Item -LiteralPath $caminho -Recurse -Force -ErrorAction Stop
        return $true
    } catch {
        Write-Host "  Não foi possível remover $caminho — está em uso." -ForegroundColor Yellow
        return $false
    }
}

# --------------------------------------------------------------------------

$pastaInstalada = ValorGravado 'HUB_PROGRAMA_DIR' (Join-Path $env:LOCALAPPDATA 'Programs\HubSnk')

# A pasta baixada e a instalada têm quase o mesmo conteúdo; o que as separa é o
# instalador, que a instalação não copia. Sem esta conferência, rodar o script
# de dentro do pacote recém-descompactado apagaria o pacote e deixaria a
# instalação de pé — com o servidor rodando e o log preso.
if (Test-Path -LiteralPath (Join-Path $pastaDoScript 'instalar-hub-snk.ps1')) {
    Write-Host 'Esta é a pasta do pacote baixado, não a da instalação.' -ForegroundColor Red

    if (Test-Path -LiteralPath $pastaInstalada) {
        Write-Host 'Rode o desinstalar-hub-snk.bat que está em:' -ForegroundColor Red
        Write-Host "  $pastaInstalada" -ForegroundColor Red
    } else {
        Write-Host 'Não encontrei nenhuma instalação do HUB SNK nesta máquina.' -ForegroundColor Red
    }

    exit 1
}

if (-not (Test-Path -LiteralPath (Join-Path $pastaDoScript 'abrir-hub-snk.vbs'))) {
    Write-Host 'Este script precisa rodar de dentro da pasta em que o HUB SNK foi instalado.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '  HUB SNK — desinstalação' -ForegroundColor Cyan
Write-Host "  Programa: $pastaDoScript"
Write-Host ''

if (-not (PerguntarSimOuNao 'Remover o HUB SNK desta máquina?' $false)) {
    Write-Host 'Nada foi removido.'
    exit 0
}

$pastaDoCadastro = ValorGravado 'HUB_DADOS_DIR' (Join-Path $pastaDoHubSnk 'dados')

EncerrarServidor $pastaDoScript

foreach ($atalho in $atalhos) {
    RemoverSePossivel $atalho | Out-Null
}

RemoverSePossivel $arquivoDeConfiguracao | Out-Null
RemoverSePossivel (Join-Path $pastaDoHubSnk 'hub-snk.log') | Out-Null
RemoverSePossivel (Join-Path $pastaDoHubSnk 'navegador.txt') | Out-Null

# A pasta do programa é apagada de fora dela: o próprio script está lá dentro, e
# o PowerShell não remove o diretório de trabalho corrente.
Set-Location $env:LOCALAPPDATA
$programaRemovido = RemoverSePossivel $pastaDoScript

Write-Host ''

if ($programaRemovido) {
    Write-Host '  HUB SNK removido.' -ForegroundColor Green
} else {
    Write-Host '  O HUB SNK foi desconfigurado, mas a pasta do programa continua ali.' -ForegroundColor Yellow
    Write-Host '  Feche o que estiver usando esses arquivos e apague a pasta à mão:' -ForegroundColor Yellow
    Write-Host "  $pastaDoScript" -ForegroundColor Yellow
}

if (Test-Path -LiteralPath $pastaDoCadastro) {
    Write-Host ''
    Write-Host '  Seu cadastro continua em:'
    Write-Host "  $pastaDoCadastro"
    Write-Host '  Apague essa pasta à mão se não quiser mais guardá-lo.'
}

Write-Host ''
