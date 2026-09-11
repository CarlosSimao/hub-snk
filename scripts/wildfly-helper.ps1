<#
.SYNOPSIS
    Helper HTTP nativo do Windows para iniciar/parar/reiniciar o WildFly do Sankhya.

.DESCRIPTION
    O sankhya-hub roda dentro de um container Docker Linux e nao tem como enxergar nem
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
    # Tenta C:\Sankhya\wildfly_producao primeiro (instalacao padrao) e cai para
    # C:\wildfly_producao se a primeira nao existir (outro host, outro checkout).
    [string] $PastaWildfly = $(if (Test-Path -LiteralPath 'C:\Sankhya\wildfly_producao\bin') { 'C:\Sankhya\wildfly_producao\bin' } else { 'C:\wildfly_producao\bin' }),
    # Casa a linha de comando do java.exe do WildFly entre outras JVMs da maquina —
    # o nome do processo sozinho ("java.exe") nao distingue uma da outra.
    [string] $FiltroProcesso = 'jboss-modules.jar'
)

$ErrorActionPreference = 'Stop'

function Escrever-Log {
    param([string] $Texto)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Texto"
}

<#
.SYNOPSIS
    A pasta do WildFly em uso agora.

.DESCRIPTION
    Le %APPDATA%\sankhya-hub\wildfly.json a cada chamada, e nao so na subida: assim
    trocar a instalacao pela tela do hub vale na hora, sem reiniciar este helper.
    Sem arquivo (ou com caminho invalido), cai no parametro -PastaWildfly.
#>
function Get-PastaWildfly {
    $arquivo = Join-Path $env:APPDATA 'sankhya-hub\wildfly.json'
    if (Test-Path -LiteralPath $arquivo) {
        try {
            $config = Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8 | ConvertFrom-Json
            $pasta = [string] $config.pasta
            if ($pasta -and (Test-Path -LiteralPath (Join-Path $pasta 'bin\standalone.bat'))) {
                return (Join-Path $pasta 'bin')
            }
        }
        catch {
            # Config quebrada nao pode tirar o WildFly do ar: segue com o padrao.
        }
    }
    return $PastaWildfly
}

<#
.SYNOPSIS
    O processo java.exe DESTE WildFly, entre as outras JVMs da maquina.

.DESCRIPTION
    O nome do processo sozinho nao distingue uma JVM da outra, e o caminho da
    instalacao e o que separa um WildFly de outro na mesma maquina — quem tem
    `wildfly_producao` e `Wildfly_11.0_Sankhya_mod_06` lado a lado pararia o errado
    se o filtro fosse so `jboss-modules.jar`.

    O caminho sai da config, nao de um literal: era `*wildfly_producao*` fixo, o que
    fazia a deteccao falhar em silencio para qualquer outra instalacao — o Iniciar
    subia um segundo processo achando que nao havia nenhum.

    A comparacao exige que o caminho termine ali (barra, aspas, espaco ou fim da linha)
    em vez de `-like "*$raiz*"`: esta maquina tem `C:\wildfly_producao` E
    `C:\wildfly_producao2`, e um e prefixo do outro. Com `-like`, parar o primeiro
    mataria os dois — e o segundo cairia sem ninguem ter pedido.
#>
function Get-ProcessoWildfly {
    # Um nivel acima do `bin`: e a pasta da instalacao que identifica o WildFly.
    $raiz = Split-Path -Parent (Get-PastaWildfly)
    $padrao = [regex]::Escape($raiz) + '(\\|"|\s|$)'

    Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" |
        Where-Object { $_.CommandLine -like "*$FiltroProcesso*" -and $_.CommandLine -match $padrao }
}

function Iniciar-Wildfly {
    $existente = Get-ProcessoWildfly
    if ($existente) {
        return @{ ok = $true; mensagem = "já estava rodando (PID $($existente.ProcessId -join ', '))" }
    }

    $bin = Get-PastaWildfly
    $standalone = Join-Path $bin 'standalone.bat'
    if (-not (Test-Path -LiteralPath $standalone)) {
        return @{ ok = $false; mensagem = "standalone.bat não encontrado em $bin — informe a pasta do WildFly na aba Infra do hub" }
    }

    # Mesma coisa que o start_wildfly.vbs: CurrentDirectory na pasta do bin, janela
    # oculta, sem esperar o processo terminar — o WildFly fica rodando em segundo plano.
    Start-Process -FilePath $standalone -WorkingDirectory $bin -WindowStyle Hidden

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
            # Somente leitura: diz QUAL instalacao este helper esta usando agora e se ela
            # esta de pe. Sem isso, conferir se a troca de caminho pegou exigia iniciar ou
            # parar o WildFly de verdade — caro demais para uma conferencia.
            '/status' {
                $bin = Get-PastaWildfly
                $processos = @(Get-ProcessoWildfly)
                @{
                    ok       = $true
                    pasta    = Split-Path -Parent $bin
                    bin      = $bin
                    rodando  = [bool] $processos
                    pids     = @($processos | ForEach-Object { $_.ProcessId })
                    mensagem = $(if ($processos) { "rodando (PID $(($processos | ForEach-Object { $_.ProcessId }) -join ', '))" } else { 'parado' })
                }
            }
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
