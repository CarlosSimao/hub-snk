<#
.SYNOPSIS
    Helper HTTP nativo do Windows para iniciar/parar/reiniciar o WildFly do Sankhya.

.DESCRIPTION
    O monitor-hub roda dentro de um container Docker Linux e nao tem como enxergar nem
    controlar um processo Windows diretamente — SO e espaco de processo diferentes, nao
    e limitacao de codigo. Este script preenche essa lacuna: escuta HTTP em todas as
    interfaces e o hub chama via `host.docker.internal`, usando o tipo de acao `http`
    que ja existe (nenhuma mudanca em src/).

    A rota /iniciar reproduz o que C:\Sankhya\wildfly_producao\bin\start_wildfly.vbs faz
    (Start-Process oculto e destacado) sem depender do arquivo — o .vbs nem sempre existe
    (outro host, outro checkout), a logica mora aqui.

    TcpListener puro, nao HttpListener: HttpListener exige `netsh http add urlacl` ou
    elevacao para escutar em interface diferente de loopback, o que quebraria o fluxo de
    duplo clique sem admin. TcpListener nao passa pelo HTTP.sys e nao tem essa exigencia.

.NOTES
    SEM AUTENTICACAO, de proposito (decisao explicita, nao descuido): qualquer
    dispositivo que alcance esta porta na rede local consegue iniciar/parar/reiniciar o
    WildFly. Nao exponha esta porta alem da rede confiavel — sem VPN/tunel para fora dela.
#>

[CmdletBinding()]
param(
    [int] $Porta = 4100,
    [string] $PastaWildfly = 'C:\Sankhya\wildfly_producao\bin',
    # Casa a linha de comando do java.exe do WildFly entre outras JVMs da maquina —
    # o nome do processo sozinho ("java.exe") nao distingue uma da outra.
    [string] $FiltroProcesso = 'jboss-modules.jar'
)

$ErrorActionPreference = 'Stop'

function Escrever-Log {
    param([string] $Texto)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Texto"
}

function Get-ProcessoWildfly {
    Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" |
        Where-Object { $_.CommandLine -like "*$FiltroProcesso*" -and $_.CommandLine -like '*wildfly_producao*' }
}

function Iniciar-Wildfly {
    $existente = Get-ProcessoWildfly
    if ($existente) {
        return @{ ok = $true; mensagem = "já estava rodando (PID $($existente.ProcessId -join ', '))" }
    }

    $standalone = Join-Path $PastaWildfly 'standalone.bat'
    if (-not (Test-Path -LiteralPath $standalone)) {
        return @{ ok = $false; mensagem = "standalone.bat não encontrado em $PastaWildfly" }
    }

    # Mesma coisa que o start_wildfly.vbs: CurrentDirectory na pasta do bin, janela
    # oculta, sem esperar o processo terminar — o WildFly fica rodando em segundo plano.
    Start-Process -FilePath $standalone -WorkingDirectory $PastaWildfly -WindowStyle Hidden

    return @{ ok = $true; mensagem = 'disparado' }
}

function Parar-Wildfly {
    $processos = Get-ProcessoWildfly
    if (-not $processos) {
        return @{ ok = $true; mensagem = 'já estava parado' }
    }

    foreach ($p in $processos) {
        Stop-Process -Id $p.ProcessId -Force
    }
    return @{ ok = $true; mensagem = "encerrado (PID $($processos.ProcessId -join ', '))" }
}

function Reiniciar-Wildfly {
    Parar-Wildfly | Out-Null

    # Stop-Process -Force devolve antes do SO liberar a porta de verdade — sem esperar,
    # o novo standalone.bat poderia subir contra uma 8080 ainda ocupada pelo antigo.
    $limite = (Get-Date).AddSeconds(20)
    while ((Get-ProcessoWildfly) -and (Get-Date) -lt $limite) {
        Start-Sleep -Milliseconds 500
    }

    return Iniciar-Wildfly
}

function Tratar-Requisicao {
    param([System.Net.Sockets.TcpClient] $Cliente)

    try {
        $stream = $Cliente.GetStream()
        $reader = [System.IO.StreamReader]::new($stream)

        # So a request-line importa pra rotear. Headers e corpo (quando houver) ficam
        # sem ler no socket — nenhuma rota precisa deles, e a conexao fecha em seguida.
        $linhaRequisicao = $reader.ReadLine()
        if (-not $linhaRequisicao) { return }

        $partes = $linhaRequisicao -split ' '
        $caminho = if ($partes.Length -ge 2) { $partes[1] } else { '' }

        $resultado = switch ($caminho) {
            '/iniciar' { Iniciar-Wildfly }
            '/parar' { Parar-Wildfly }
            '/reiniciar' { Reiniciar-Wildfly }
            default { @{ ok = $false; mensagem = "rota desconhecida: $caminho" } }
        }

        Escrever-Log "$caminho -> $($resultado.mensagem)"

        $corpo = $resultado | ConvertTo-Json -Compress
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($corpo)
        $status = if ($resultado.ok) { '200 OK' } else { '500 Internal Server Error' }

        $cabecalho = "HTTP/1.1 $status`r`nContent-Type: application/json`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
        $bytesCabecalho = [System.Text.Encoding]::ASCII.GetBytes($cabecalho)

        $stream.Write($bytesCabecalho, 0, $bytesCabecalho.Length)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
    }
    catch {
        Escrever-Log "erro tratando requisição: $($_.Exception.Message)"
    }
    finally {
        $Cliente.Close()
    }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Porta)
$listener.Start()
Escrever-Log "Helper do WildFly escutando na porta $Porta (todas as interfaces — sem autenticação)"

try {
    while ($true) {
        $cliente = $listener.AcceptTcpClient()
        Tratar-Requisicao -Cliente $cliente
    }
}
finally {
    $listener.Stop()
}
