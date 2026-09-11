<#
.SYNOPSIS
    Sobe o sankhya-hub do zero: Docker, containers, navegador.

.DESCRIPTION
    Feito para ser disparado por um atalho no Desktop, com um duplo clique e nada mais.
    Cada etapa espera a anterior REALMENTE ficar pronta em vez de dormir um tempo fixo:
    "Docker Desktop abriu" nao e o mesmo que "o daemon aceita comandos", e "o container
    subiu" nao e o mesmo que "o hub responde HTTP".

    Compativel com Windows PowerShell 5.1 (o `powershell.exe` que o atalho chama) e com
    PowerShell 7.

.NOTES
    Criar o atalho: scripts/criar-atalho.ps1
#>

[CmdletBinding()]
param(
    # Porta publicada pelo docker-compose.yml.
    [int] $Porta = 4000,

    # Sobe sem abrir o navegador — util para rodar no logon do Windows.
    [switch] $SemNavegador
)

$ErrorActionPreference = 'Stop'

# No PowerShell 7.4+ um comando nativo com exit code != 0 vira excecao quando o
# ErrorActionPreference e 'Stop'. Aqui isso seria fatal: o script DEPENDE de rodar
# `docker info` e receber a falha como valor, para saber que precisa iniciar o Docker.
# Em 5.1 a variavel nao existe e a atribuicao e inofensiva.
$PSNativeCommandUseErrorActionPreference = $false

# Docker Desktop frio precisa iniciar a VM: dois minutos e folgado, mas nao infinito.
$TempoLimiteDockerSegundos = 180
# O hub sobe em segundos; o teto aqui pega o caso do build de imagem ainda rodando.
$TempoLimiteHubSegundos = 120
$IntervaloSondagemSegundos = 2

$RaizProjeto = Split-Path -Parent $PSScriptRoot
$UrlPainel = "http://localhost:$Porta"
$UrlSaude = "$UrlPainel/api/healthz"

# Porta do helper do WildFly (scripts/wildfly-helper.ps1) — precisa bater com o
# `url` das acoes wildfly-* em config/services.yaml.
$PortaWildflyHelper = 4100
$ScriptWildflyHelper = Join-Path $PSScriptRoot 'wildfly-helper.ps1'

# Porta do helper de log (scripts/wildfly-log-helper.ps1) — precisa bater com o
# `url` da acao wildfly-log em config/services.yaml.
$PortaWildflyLogHelper = 4101
$ScriptWildflyLogHelper = Join-Path $PSScriptRoot 'wildfly-log-helper.ps1'

# Helper do proprio hub (scripts/hub-helper.ps1): DPAPI das credenciais do Sankhya e
# execucao do git-autosync. Precisa bater com HUB_HELPER_URL no docker-compose.yml.
$PortaHubHelper = 4102
$ScriptHubHelper = Join-Path $PSScriptRoot 'hub-helper.ps1'

function Escrever-Etapa {
    param([string] $Texto)
    Write-Host ''
    Write-Host "  $Texto" -ForegroundColor Cyan
}

function Escrever-Ok {
    param([string] $Texto)
    Write-Host "  [ok] $Texto" -ForegroundColor Green
}

function Escrever-Falha {
    param([string] $Texto)
    Write-Host ''
    Write-Host "  [falhou] $Texto" -ForegroundColor Red
}

<#
    O daemon aceita comandos? `docker info` e o teste honesto: `docker ps` tambem
    serviria, mas info falha mais rapido quando o backend ainda esta subindo.
#>
function Test-DaemonPronto {
    try {
        docker info 2>&1 | Out-Null
        return $LASTEXITCODE -eq 0
    }
    catch {
        # Docker CLI ausente do PATH cai aqui. Do ponto de vista do script e o mesmo
        # que daemon fora: seguir para a etapa que inicia o Docker Desktop.
        return $false
    }
}

<#
    Onde o Docker Desktop foi instalado.

    Instalacao por usuario (o padrao nas versoes recentes) fica em %LOCALAPPDATA%;
    instalacao para toda a maquina vai em Program Files. Procurar nos dois evita o
    script quebrar em outro computador.
#>
function Get-CaminhoDockerDesktop {
    $candidatos = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Docker\Docker\Docker Desktop.exe')
    )

    foreach ($caminho in $candidatos) {
        if ($caminho -and (Test-Path -LiteralPath $caminho)) { return $caminho }
    }
    return $null
}

function Wait-Condicao {
    param(
        [scriptblock] $Condicao,
        [int] $TempoLimiteSegundos,
        [string] $Mensagem
    )

    $limite = (Get-Date).AddSeconds($TempoLimiteSegundos)
    $girador = @('|', '/', '-', '\')
    $quadro = 0

    while ((Get-Date) -lt $limite) {
        if (& $Condicao) {
            Write-Host "`r  $Mensagem... pronto      "
            return $true
        }
        Write-Host "`r  $Mensagem... $($girador[$quadro % 4])" -NoNewline
        $quadro++
        Start-Sleep -Seconds $IntervaloSondagemSegundos
    }

    Write-Host ''
    return $false
}

function Start-DockerDesktop {
    if (Test-DaemonPronto) {
        Escrever-Ok 'Docker ja esta rodando'
        return $true
    }

    $executavel = Get-CaminhoDockerDesktop
    if (-not $executavel) {
        Escrever-Falha 'Docker Desktop nao encontrado. Instale em https://docker.com/products/docker-desktop'
        return $false
    }

    Escrever-Etapa 'Iniciando o Docker Desktop'
    Start-Process -FilePath $executavel | Out-Null

    $pronto = Wait-Condicao `
        -Condicao { Test-DaemonPronto } `
        -TempoLimiteSegundos $TempoLimiteDockerSegundos `
        -Mensagem 'Esperando o daemon aceitar comandos'

    if (-not $pronto) {
        Escrever-Falha "O Docker nao ficou pronto em $TempoLimiteDockerSegundos s. Abra o Docker Desktop e veja se ele pede alguma acao (login, atualizacao do WSL)."
        return $false
    }

    Escrever-Ok 'Docker pronto'
    return $true
}

function Start-Containers {
    Escrever-Etapa 'Subindo o sankhya-hub'

    # `up -d` e idempotente: com o container ja no ar e a config igual, ele nao faz nada.
    Push-Location $RaizProjeto
    try {
        # O docker compose escreve o PROGRESSO em stderr, nao so os erros ("Container
        # sankhya-hub Running" chega por la). Com o ErrorActionPreference em 'Stop', o
        # `2>&1` transforma essas linhas normais em excecao e o script aborta com o
        # container no ar. Aqui a preferencia cai para 'Continue' e quem decide sucesso
        # e o exit code, que e o unico sinal confiavel.
        $preferenciaAnterior = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        docker compose up -d 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        $codigo = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $preferenciaAnterior
        Pop-Location
    }

    if ($codigo -ne 0) {
        Escrever-Falha "'docker compose up -d' falhou (codigo $codigo)."
        return $false
    }
    return $true
}

<#
    Container "Started" nao significa hub respondendo: o Node ainda vai abrir o SQLite,
    ler o YAML e comecar a escutar. Abrir o navegador antes disso mostra tela de erro,
    entao a espera e pelo HTTP, nao pelo docker.
#>
function Wait-Hub {
    $responde = {
        try {
            Invoke-WebRequest -Uri $UrlSaude -UseBasicParsing -TimeoutSec 3 | Out-Null
            return $true
        }
        catch {
            return $false
        }
    }

    $pronto = Wait-Condicao `
        -Condicao $responde `
        -TempoLimiteSegundos $TempoLimiteHubSegundos `
        -Mensagem 'Esperando o hub responder'

    if (-not $pronto) {
        Escrever-Falha "O hub nao respondeu em $TempoLimiteHubSegundos s. Logs:"
        # Mesma armadilha do compose: `docker logs` manda a saida da aplicacao por
        # stderr, e aqui abortar seria pior ainda — e justamente o log do erro.
        $preferenciaAnterior = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        docker logs --tail 30 sankhya-hub 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        $ErrorActionPreference = $preferenciaAnterior
        return $false
    }

    Escrever-Ok 'Hub no ar'
    return $true
}

<#
    Porta ja escutando: outro processo, de uma execucao anterior do atalho ou de um
    duplo clique repetido. Nao tem `-Force`/restart aqui de proposito — sao processos
    detached, sem PID guardado em lugar nenhum pra derrubar com seguranca.
#>
function Test-PortaEmUso {
    param([int] $Porta)
    try {
        return [bool] (Get-NetTCPConnection -LocalPort $Porta -State Listen -ErrorAction Stop)
    }
    catch {
        return $false
    }
}

<#
    Sobe um dos helpers nativos do Windows, se ele ainda nao estiver escutando.

    Best-effort: um host sem o WildFly do Sankhya (ou sem o script, caso o checkout
    seja de outro projeto) nao deve travar o resto do atalho por causa disso — por isso
    a ausencia do arquivo sai calada e a falha de subida so avisa.

    Todos rodam com `powershell.exe` explicito, nao `pwsh`: o hub-helper depende de
    DPAPI, que so existe no runtime do Windows PowerShell.
#>
function Start-Helper {
    param(
        [string] $Nome,
        [string] $Script,
        [int] $Porta,
        [string] $AvisoFalha
    )

    if (-not (Test-Path -LiteralPath $Script)) {
        return
    }

    if (Test-PortaEmUso -Porta $Porta) {
        Escrever-Ok "$Nome já está rodando"
        return
    }

    Escrever-Etapa "Iniciando o $Nome"
    Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $Script) `
        -WindowStyle Hidden

    Start-Sleep -Milliseconds 500
    if (Test-PortaEmUso -Porta $Porta) {
        Escrever-Ok "$Nome no ar"
    }
    else {
        Escrever-Falha "$Nome não respondeu — $AvisoFalha"
    }
}

# --- fluxo -------------------------------------------------------------------

Write-Host ''
Write-Host '  sankhya-hub' -ForegroundColor White
Write-Host '  -----------' -ForegroundColor DarkGray

try {
    if (-not (Start-DockerDesktop)) { exit 1 }
    if (-not (Start-Containers)) { exit 1 }
    if (-not (Wait-Hub)) { exit 1 }
    Start-Helper -Nome 'helper do WildFly' -Script $ScriptWildflyHelper -Porta $PortaWildflyHelper `
        -AvisoFalha 'ações de iniciar/parar/reiniciar não vão funcionar'
    Start-Helper -Nome 'helper de log do WildFly' -Script $ScriptWildflyLogHelper -Porta $PortaWildflyLogHelper `
        -AvisoFalha 'a ação "Log" não vai funcionar'
    Start-Helper -Nome 'helper do hub' -Script $ScriptHubHelper -Porta $PortaHubHelper `
        -AvisoFalha 'as credenciais do Sankhya e o git-autosync não vão funcionar'

    if (-not $SemNavegador) {
        Escrever-Etapa "Abrindo $UrlPainel"
        Start-Process $UrlPainel
    }

    Write-Host ''
    Write-Host "  Painel em $UrlPainel" -ForegroundColor Green
    Write-Host '  Para derrubar: docker compose down' -ForegroundColor DarkGray
    Write-Host ''

    # Fecha sozinho no caminho feliz — a janela ja cumpriu o papel de mostrar o progresso.
    Start-Sleep -Seconds 2
    exit 0
}
catch {
    Escrever-Falha $_.Exception.Message
}

# So chega aqui em caso de erro. Segurar a janela e o que permite ler a mensagem:
# sem isto o console fecha junto com o processo e o motivo da falha se perde.
Write-Host ''
Write-Host '  Pressione qualquer tecla para fechar...' -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
exit 1
