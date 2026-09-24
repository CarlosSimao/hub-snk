# Remove a instalação PWA antiga do HUB SNK (a do instalar-hub-snk.ps1), chamado pelo
# instalador NSIS do aplicativo desktop logo depois de copiar os arquivos.
#
# O cadastro NUNCA é tocado: a pasta de dados é a mesma que o aplicativo desktop usa.
# Do programa antigo só sai o que o pacote dele instalou; qualquer outra coisa que
# esteja na pasta (logs do WildFly, por exemplo) é movida para junto dos dados em vez
# de apagada.
#
# Idempotente: sem instalação antiga, não faz nada. Roda de novo a cada atualização.
#
# Compatível com o Windows PowerShell 5.1, que é o que o NSIS chama.
#
# Os parâmetros existem para o teste com uma cópia simulada; o instalador não os passa.

param(
    [string]$PastaLocal = $env:LOCALAPPDATA,
    [string]$PastaRoaming = $env:APPDATA,
    [string]$AreaDeTrabalho = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

$PORTA_DO_APP_DESKTOP = '4100'
$SEGUNDOS_PARA_OS_PROCESSOS_SAIREM = 5

# O que o pacote PWA instalava na pasta do programa (empacotar-comum.mjs +
# empacotar-windows.mjs). Só isto é apagado.
$ITENS_DO_PACOTE_PWA = @(
    'src', 'public', 'node_modules',
    'abrir-hub-snk.vbs', 'encerrar-hub-snk.vbs',
    'desinstalar-hub-snk.bat', 'desinstalar-hub-snk.ps1',
    'hub-snk.ico', 'LICENSE.txt', 'LICENSE', 'README.md',
    'package.json', 'package-lock.json'
)

# Arquivos de estado do launcher antigo, ao lado da pasta de dados.
$ARQUIVOS_DE_ESTADO_PWA = @('hub-snk.env', 'hub-snk.log', 'navegador.txt')

$pastaDeEstado = Join-Path $PastaLocal 'HubSnk'
$arquivoDeConfiguracao = Join-Path $pastaDeEstado 'hub-snk.env'
$arquivoDeLog = Join-Path $pastaDeEstado 'remocao-da-versao-pwa.log'

function Registrar([string]$mensagem) {
    $linha = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $mensagem
    Write-Output $linha
    try {
        Add-Content -LiteralPath $arquivoDeLog -Value $linha -Encoding UTF8
    } catch {
        # O log em arquivo é conveniência; a saída acima já vai para o detalhe do NSIS.
    }
}

function LerConfiguracao() {
    $valores = @{}
    if (-not (Test-Path -LiteralPath $arquivoDeConfiguracao)) { return $valores }

    foreach ($linha in Get-Content -LiteralPath $arquivoDeConfiguracao -Encoding UTF8) {
        $texto = $linha.Trim()
        if ($texto -eq '' -or $texto.StartsWith('#')) { continue }
        $separador = $texto.IndexOf('=')
        if ($separador -lt 1) { continue }
        $valores[$texto.Substring(0, $separador).Trim()] = $texto.Substring($separador + 1).Trim()
    }
    return $valores
}

function ValorOuPadrao($configuracao, [string]$chave, [string]$padrao) {
    if ($configuracao.ContainsKey($chave) -and $configuracao[$chave] -ne '') { return $configuracao[$chave] }
    return $padrao
}

function CaminhoNormalizado([string]$caminho) {
    return [System.IO.Path]::GetFullPath($caminho).TrimEnd('\').ToLowerInvariant()
}

# Só é a instalação PWA se tiver o launcher E o backend: é o que impede apagar uma
# pasta qualquer que o hub-snk.env tenha apontado por engano.
function EhInstalacaoPwa([string]$pasta) {
    return (Test-Path -LiteralPath (Join-Path $pasta 'abrir-hub-snk.vbs')) -and
        (Test-Path -LiteralPath (Join-Path $pasta 'src\index.ts'))
}

# O backend antigo, o cmd.exe que o launcher usa para redirecionar o log e o próprio
# launcher, que fica esperando a porta abrir.
function EncerrarProcessosDaInstalacao([string]$pasta) {
    $backend = (Join-Path $pasta 'src\index.ts').ToLowerInvariant()
    $launcher = (Join-Path $pasta 'abrir-hub-snk.vbs').ToLowerInvariant()

    $processos = Get-CimInstance Win32_Process | Where-Object {
        $linha = [string]$_.CommandLine
        $linha = $linha.ToLowerInvariant()
        ($_.Name -in @('node.exe', 'cmd.exe') -and $linha.Contains($backend)) -or
            ($_.Name -eq 'wscript.exe' -and $linha.Contains($launcher))
    }

    foreach ($processo in $processos) {
        Registrar "Encerrando $($processo.Name) (PID $($processo.ProcessId)) da versão PWA."
        Stop-Process -Id $processo.ProcessId -Force -ErrorAction SilentlyContinue
    }

    $limite = (Get-Date).AddSeconds($SEGUNDOS_PARA_OS_PROCESSOS_SAIREM)
    while ((Get-Date) -lt $limite) {
        $vivos = $processos | Where-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
        if (-not $vivos) { return }
        Start-Sleep -Milliseconds 250
    }
}

# O atalho do aplicativo desktop tem o MESMO nome ("HUB SNK.lnk"). Apagar pelo nome
# levaria o atalho novo junto; só sai o que aponta para o launcher antigo.
function RemoverAtalhosDaInstalacao([string]$pasta) {
    $launcher = (Join-Path $pasta 'abrir-hub-snk.vbs').ToLowerInvariant()
    $atalhos = @(
        (Join-Path $PastaRoaming 'Microsoft\Windows\Start Menu\Programs\HUB SNK.lnk'),
        (Join-Path $PastaRoaming 'Microsoft\Windows\Start Menu\Programs\Startup\HUB SNK.lnk'),
        (Join-Path $AreaDeTrabalho 'HUB SNK.lnk')
    )
    $shell = New-Object -ComObject WScript.Shell

    foreach ($atalho in $atalhos) {
        if (-not (Test-Path -LiteralPath $atalho)) { continue }

        $destino = $shell.CreateShortcut($atalho)
        $alvo = ('{0} {1}' -f $destino.TargetPath, $destino.Arguments).ToLowerInvariant()
        if (-not $alvo.Contains($launcher)) {
            Registrar "Mantido (não é da versão PWA): $atalho"
            continue
        }

        Remove-Item -LiteralPath $atalho -Force
        Registrar "Atalho removido: $atalho"
    }
}

# O aplicativo desktop procura o cadastro em HubSnk\dados. Quem tinha escolhido outra
# pasta na instalação PWA ficaria com o app vazio; o caminho é deixado num arquivo que
# o shell lê (desktop/src/config.ts).
function PreservarPastaDeDadosPersonalizada($configuracao) {
    $padrao = Join-Path $pastaDeEstado 'dados'
    $escolhida = ValorOuPadrao $configuracao 'HUB_DADOS_DIR' $padrao
    if ((CaminhoNormalizado $escolhida) -eq (CaminhoNormalizado $padrao)) { return }

    Set-Content -LiteralPath (Join-Path $pastaDeEstado 'pasta-de-dados.txt') -Value $escolhida -Encoding UTF8
    Registrar "Cadastro em pasta personalizada, preservada para o app desktop: $escolhida"
}

function AvisarPortaDiferente($configuracao) {
    $porta = ValorOuPadrao $configuracao 'HUB_PORTA' $PORTA_DO_APP_DESKTOP
    if ($porta -eq $PORTA_DO_APP_DESKTOP) { return }
    Registrar "Aviso: a versão PWA usava a porta $porta; o app desktop usa sempre a $PORTA_DO_APP_DESKTOP."
}

function RemoverArquivosDeEstado() {
    foreach ($nome in $ARQUIVOS_DE_ESTADO_PWA) {
        $caminho = Join-Path $pastaDeEstado $nome
        if (-not (Test-Path -LiteralPath $caminho)) { continue }
        Remove-Item -LiteralPath $caminho -Force
        Registrar "Removido: $caminho"
    }
}

function RemoverPrograma([string]$pasta) {
    foreach ($nome in $ITENS_DO_PACOTE_PWA) {
        $caminho = Join-Path $pasta $nome
        if (-not (Test-Path -LiteralPath $caminho)) { continue }
        Remove-Item -LiteralPath $caminho -Recurse -Force
    }
    Registrar "Arquivos do programa PWA removidos de $pasta"

    $restantes = @(Get-ChildItem -LiteralPath $pasta -Force)
    if ($restantes.Count -eq 0) {
        Remove-Item -LiteralPath $pasta -Force
        Registrar "Pasta removida: $pasta"
        return
    }

    $destino = Join-Path $pastaDeEstado ('restos-da-versao-pwa-{0}' -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Move-Item -LiteralPath $pasta -Destination $destino
    Registrar "Itens que não eram do pacote ($($restantes.Name -join ', ')) movidos para $destino"
}

# --------------------------------------------------------------------------

try {
    $configuracao = LerConfiguracao
    $pastaDoPrograma = ValorOuPadrao $configuracao 'HUB_PROGRAMA_DIR' (Join-Path $PastaLocal 'Programs\HubSnk')

    if (-not (EhInstalacaoPwa $pastaDoPrograma)) {
        if (Test-Path -LiteralPath $arquivoDeConfiguracao) {
            Registrar "hub-snk.env encontrado, mas sem instalação PWA em $pastaDoPrograma; só a configuração sai."
            PreservarPastaDeDadosPersonalizada $configuracao
            RemoverArquivosDeEstado
        }
        exit 0
    }

    Registrar "Instalação PWA encontrada em $pastaDoPrograma"
    EncerrarProcessosDaInstalacao $pastaDoPrograma
    RemoverAtalhosDaInstalacao $pastaDoPrograma
    PreservarPastaDeDadosPersonalizada $configuracao
    AvisarPortaDiferente $configuracao
    RemoverArquivosDeEstado
    RemoverPrograma $pastaDoPrograma
    Registrar 'Versão PWA removida. O cadastro não foi alterado.'
    exit 0
} catch {
    Registrar "Falha ao remover a versão PWA: $($_.Exception.Message)"
    exit 1
}
