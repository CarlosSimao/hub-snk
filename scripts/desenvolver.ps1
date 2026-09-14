<#
.SYNOPSIS
    Sobe o sankhya-hub em modo DESENVOLVIMENTO, para acompanhar as alteracoes ao vivo.

.DESCRIPTION
    Diferente de `iniciar-monitor.ps1`, que sobe a imagem Docker com o front ja
    compilado: aqui o backend roda com `node --watch` e o front pelo Vite, entao toda
    mudanca em `src/` reinicia o hub e toda mudanca em `web/` aparece na hora, sem
    rebuild e sem Docker.

    Sobe, nesta ordem:
      1. os tres helpers do Windows (4100, 4101, 4102), se ainda nao estiverem no ar
      2. o backend em http://localhost:4000
      3. o Vite em http://localhost:4001  <- e este que voce deixa aberto

    Fecha tudo com Ctrl+C nesta janela. Os helpers ficam de pe (sao janelas proprias);
    use -PararHelpers para derruba-los junto.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\desenvolver.ps1
#>

[CmdletBinding()]
param(
    # Porta do backend. Precisa bater com o `target` do proxy em web/vite.config.ts.
    [int] $PortaBackend = 4000,
    # Porta do Vite, que e a que voce abre no navegador.
    [int] $PortaWeb = 4001,
    [switch] $SemNavegador,
    # Derruba os helpers ao sair, em vez de deixa-los rodando.
    [switch] $PararHelpers
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$RaizProjeto = Split-Path -Parent $PSScriptRoot

# O hub roda FORA do container aqui, entao os padroes de `src/index.ts` nao servem:
# eles apontam para `host.docker.internal` e para o caminho do token dentro da imagem.
# Sem isto o helper fica inalcancavel e toda a aba Sankhya responde erro.
$env:HUB_HELPER_URL = 'http://127.0.0.1:4102'
$env:HUB_HELPER_TOKEN_FILE = Join-Path $env:APPDATA 'sankhya-hub\ipc\token.txt'
# Vazio desliga as acoes de container em vez de tentar um socket que nao existe no
# Windows — o painel mostra o aviso no topo e o resto continua funcionando.
$env:DOCKER_SOCKET = ''

$Helpers = @(
    @{ Nome = 'helper do hub';            Script = 'hub-helper.ps1';            Porta = 4102 }
    @{ Nome = 'helper do WildFly';        Script = 'wildfly-helper.ps1';        Porta = 4100 }
    @{ Nome = 'helper de log do WildFly'; Script = 'wildfly-log-helper.ps1';    Porta = 4101 }
)

function Escrever-Etapa { param([string] $Texto) Write-Host "  > $Texto" -ForegroundColor Cyan }
function Escrever-Ok    { param([string] $Texto) Write-Host "  ok $Texto" -ForegroundColor Green }
function Escrever-Aviso { param([string] $Texto) Write-Host "  !  $Texto" -ForegroundColor Yellow }

<#
.SYNOPSIS
    A porta esta aceitando conexao?

.DESCRIPTION
    Conexao TCP crua e nao uma requisicao HTTP: o hub-helper responde 401 sem token e o
    Vite demora a servir a primeira pagina — os dois estao "no ar" nesses estados, e um
    teste por status HTTP diria que nao.
#>
function Test-Porta {
    param([int] $Porta)
    try {
        $cliente = [System.Net.Sockets.TcpClient]::new()
        $tarefa = $cliente.ConnectAsync('127.0.0.1', $Porta)
        $conectou = $tarefa.Wait(600)
        $cliente.Close()
        return $conectou -and -not $tarefa.IsFaulted
    }
    catch { return $false }
}

function Start-Helper {
    param([string] $Nome, [string] $Script, [int] $Porta)

    if (Test-Porta -Porta $Porta) {
        Escrever-Ok "$Nome ja estava no ar (porta $Porta)"
        return
    }

    $caminho = Join-Path $PSScriptRoot $Script
    if (-not (Test-Path -LiteralPath $caminho)) {
        Escrever-Aviso "$Script nao encontrado — $Nome nao vai subir"
        return
    }

    Escrever-Etapa "Iniciando o $Nome"
    $processo = Start-Process -FilePath 'powershell.exe' `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $caminho) `
        -WorkingDirectory $RaizProjeto -WindowStyle Minimized -PassThru

    foreach ($tentativa in 1..20) {
        Start-Sleep -Milliseconds 400
        if (Test-Porta -Porta $Porta) {
            Escrever-Ok "$Nome no ar (porta $Porta)"
            return $processo
        }
    }
    Escrever-Aviso "$Nome nao respondeu na porta $Porta"
    return $processo
}

Write-Host ''
Write-Host '  sankhya-hub - modo desenvolvimento' -ForegroundColor White
Write-Host '  ----------------------------------' -ForegroundColor DarkGray

$abertos = @()
foreach ($h in $Helpers) {
    $p = Start-Helper -Nome $h.Nome -Script $h.Script -Porta $h.Porta
    if ($p) { $abertos += $p }
}

if (-not (Test-Path -LiteralPath (Join-Path $RaizProjeto 'node_modules'))) {
    Escrever-Etapa 'Instalando dependencias (primeira vez)'
    & npm install --prefix $RaizProjeto
}

Escrever-Etapa "Subindo o backend em http://localhost:$PortaBackend"
$env:PORT = "$PortaBackend"
$backend = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev') `
    -WorkingDirectory $RaizProjeto -WindowStyle Minimized -PassThru

foreach ($tentativa in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-Porta -Porta $PortaBackend) { break }
}
if (Test-Porta -Porta $PortaBackend) { Escrever-Ok 'backend no ar' }
else { Escrever-Aviso 'o backend nao respondeu — veja a janela dele' }

Escrever-Etapa "Subindo o Vite em http://localhost:$PortaWeb"
$vite = Start-Process -FilePath 'npm.cmd' -ArgumentList @('run', 'dev:web') `
    -WorkingDirectory $RaizProjeto -WindowStyle Minimized -PassThru

foreach ($tentativa in 1..30) {
    Start-Sleep -Milliseconds 500
    if (Test-Porta -Porta $PortaWeb) { break }
}

# `localhost` e nao `127.0.0.1`: o Vite escuta so em IPv6 por padrao, e o endereco
# numerico devolve conexao recusada.
$url = "http://localhost:$PortaWeb"
if (Test-Porta -Porta $PortaWeb) {
    Escrever-Ok 'Vite no ar'
    if (-not $SemNavegador) { Start-Process $url }
}
else {
    Escrever-Aviso 'o Vite nao respondeu — veja a janela dele'
}

Write-Host ''
Write-Host "  Painel em $url" -ForegroundColor Green
Write-Host '  Alteracoes em web/ aparecem na hora; em src/ o backend reinicia sozinho.' -ForegroundColor DarkGray
Write-Host '  Ctrl+C aqui encerra o backend e o Vite.' -ForegroundColor DarkGray
Write-Host ''

try {
    # Segura a janela: enquanto ela estiver aberta, o Ctrl+C chega aqui e o `finally`
    # derruba os filhos. Sem isto o script terminaria e deixaria tudo orfao.
    while ($true) { Start-Sleep -Seconds 1 }
}
finally {
    Write-Host ''
    Escrever-Etapa 'Encerrando'
    foreach ($p in @($backend, $vite)) {
        if ($p -and -not $p.HasExited) {
            Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        }
    }
    if ($PararHelpers) {
        foreach ($p in $abertos) {
            if ($p -and -not $p.HasExited) {
                Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Escrever-Ok 'helpers encerrados'
    }
    else {
        Write-Host '  Os helpers continuam rodando. Use -PararHelpers para derruba-los junto.' -ForegroundColor DarkGray
    }
}
