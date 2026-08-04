<#
.SYNOPSIS
    Helper HTTP nativo do Windows para acompanhar ao vivo o server.log do WildFly.

.DESCRIPTION
    Serve duas rotas:
      GET /log         pagina HTML autonoma com um visualizador que rola sozinho.
      GET /log/stream  Server-Sent Events: manda as ultimas linhas do arquivo e
                        depois cada linha nova, assim que o WildFly grava — o
                        mesmo efeito do `tail -f`.

    Script SEPARADO do wildfly-helper.ps1 (porta diferente) de proposito: tailing
    e uma conexao de LONGA duracao, e o listener aqui e single-threaded, igual ao
    outro helper. Misturar as duas coisas faria um popup de log aberto travar
    qualquer acao de iniciar/parar/reiniciar o WildFly ate a aba fechar.

    Mesma limitacao vale aqui: enquanto UM cliente esta conectado no /log/stream,
    o listener nao aceita outra conexao nova. Para uso pessoal (um popup por vez)
    e o suficiente; um segundo popup so conecta depois do primeiro fechar.

.NOTES
    SEM AUTENTICACAO, mesma decisao do wildfly-helper.ps1 — nao exponha esta porta
    alem da rede confiavel.
#>

[CmdletBinding()]
param(
    [int] $Porta = 4101,
    # Mesmo fallback do wildfly-helper.ps1: C:\Sankhya\wildfly_producao primeiro,
    # senao C:\wildfly_producao.
    [string] $ArquivoLog = $(if (Test-Path -LiteralPath 'C:\Sankhya\wildfly_producao\standalone\log\server.log') { 'C:\Sankhya\wildfly_producao\standalone\log\server.log' } else { 'C:\wildfly_producao\standalone\log\server.log' }),
    # Quantas linhas mandar assim que o popup conecta, antes de comecar a seguir o arquivo.
    [int] $LinhasIniciais = 200,
    [int] $IntervaloPollMs = 500
)

$ErrorActionPreference = 'Stop'

function Escrever-Log {
    param([string] $Texto)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Texto"
}

function Pagina-Visualizador {
    @'
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>server.log — WildFly</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b1120; color: #cbd5e1; font: 12px/1.5 ui-monospace, monospace; }
  header { position: sticky; top: 0; padding: 8px 12px; background: #111827; border-bottom: 1px solid #1f2937; display: flex; align-items: center; gap: 10px; }
  header b { color: #e2e8f0; }
  #estado { font-size: 11px; color: #64748b; }
  #log { margin: 0; padding: 12px; white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
<header><b>server.log</b><span id="estado">conectando…</span></header>
<pre id="log"></pre>
<script>
  var logEl = document.getElementById('log');
  var estadoEl = document.getElementById('estado');
  var es = new EventSource('/log/stream');
  es.onopen = function () { estadoEl.textContent = 'ao vivo'; };
  es.onerror = function () { estadoEl.textContent = 'reconectando…'; };
  es.onmessage = function (event) {
    logEl.textContent += event.data + '\n';
    window.scrollTo(0, document.body.scrollHeight);
  };
</script>
</body>
</html>
'@
}

function Enviar-Cabecalho {
    param(
        [System.IO.Stream] $Stream,
        [string] $Status,
        [string] $ContentType,
        [System.Collections.IDictionary] $ExtraHeaders
    )

    $linhas = @("HTTP/1.1 $Status", "Content-Type: $ContentType")
    foreach ($chave in $ExtraHeaders.Keys) { $linhas += "${chave}: $($ExtraHeaders[$chave])" }
    $texto = ($linhas -join "`r`n") + "`r`n`r`n"
    $bytes = [System.Text.Encoding]::ASCII.GetBytes($texto)
    $Stream.Write($bytes, 0, $bytes.Length)
}

function Enviar-Evento {
    param([System.IO.Stream] $Stream, [string[]] $Linhas)

    $corpo = ($Linhas | ForEach-Object { "data: $_" }) -join "`r`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes("$corpo`r`n`r`n")
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush()
}

function Servir-Pagina {
    param([System.IO.Stream] $Stream)

    $corpo = [System.Text.Encoding]::UTF8.GetBytes((Pagina-Visualizador))
    Enviar-Cabecalho -Stream $Stream -Status '200 OK' -ContentType 'text/html; charset=utf-8' `
        -ExtraHeaders @{ 'Content-Length' = $corpo.Length; 'Connection' = 'close' }
    $Stream.Write($corpo, 0, $corpo.Length)
}

function Servir-Stream {
    param([System.Net.Sockets.TcpClient] $Cliente, [System.IO.Stream] $Stream)

    if (-not (Test-Path -LiteralPath $ArquivoLog)) {
        Enviar-Cabecalho -Stream $Stream -Status '404 Not Found' -ContentType 'text/plain' -ExtraHeaders @{ 'Connection' = 'close' }
        $msg = [System.Text.Encoding]::UTF8.GetBytes("arquivo nao encontrado: $ArquivoLog")
        $Stream.Write($msg, 0, $msg.Length)
        return
    }

    Enviar-Cabecalho -Stream $Stream -Status '200 OK' -ContentType 'text/event-stream; charset=utf-8' `
        -ExtraHeaders @{ 'Cache-Control' = 'no-cache'; 'Connection' = 'keep-alive' }

    # Ultimas linhas ao conectar: contexto de onde o log estava, sem mandar o arquivo inteiro.
    $iniciais = Get-Content -LiteralPath $ArquivoLog -Tail $LinhasIniciais -ErrorAction SilentlyContinue
    if ($iniciais) { Enviar-Evento -Stream $Stream -Linhas $iniciais }

    $posicao = (Get-Item -LiteralPath $ArquivoLog).Length

    while ($Cliente.Connected) {
        Start-Sleep -Milliseconds $IntervaloPollMs

        $item = Get-Item -LiteralPath $ArquivoLog -ErrorAction SilentlyContinue
        if (-not $item) { continue }

        # Log rotacionado/truncado: o arquivo encolheu, recomeca do inicio dele.
        if ($item.Length -lt $posicao) { $posicao = 0 }
        if ($item.Length -le $posicao) { continue }

        $leitor = [System.IO.FileStream]::new(
            $ArquivoLog, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite
        )
        try {
            $leitor.Seek($posicao, [System.IO.SeekOrigin]::Begin) | Out-Null
            $buffer = New-Object byte[] ($item.Length - $posicao)
            $lidos = $leitor.Read($buffer, 0, $buffer.Length)
            $posicao += $lidos
        }
        finally {
            $leitor.Close()
        }

        # `Default`, nao UTF8: o server.log do WildFly sai em ANSI/CP1252 (charset
        # padrao da JVM no Windows), e decodificar como UTF8 quebra acentuacao
        # ("Alíquotas" virava "Al?quotas") em toda linha nova. O `Get-Content -Tail`
        # do bloco inicial ja usa esse default sozinho; aqui precisa ser explicito.
        $texto = [System.Text.Encoding]::Default.GetString($buffer, 0, $lidos)
        $linhasNovas = $texto -split "`r?`n" | Where-Object { $_ -ne '' }
        if ($linhasNovas) { Enviar-Evento -Stream $Stream -Linhas $linhasNovas }
    }
}

function Tratar-Requisicao {
    param([System.Net.Sockets.TcpClient] $Cliente)

    try {
        $stream = $Cliente.GetStream()
        $reader = [System.IO.StreamReader]::new($stream)

        $linhaRequisicao = $reader.ReadLine()
        if (-not $linhaRequisicao) { return }

        $partes = $linhaRequisicao -split ' '
        $caminho = if ($partes.Length -ge 2) { $partes[1] } else { '' }

        Escrever-Log "conexao: $caminho"

        switch ($caminho) {
            '/log' { Servir-Pagina -Stream $stream }
            '/log/stream' { Servir-Stream -Cliente $Cliente -Stream $stream }
            default {
                Enviar-Cabecalho -Stream $stream -Status '404 Not Found' -ContentType 'text/plain' -ExtraHeaders @{ 'Connection' = 'close' }
            }
        }
    }
    catch {
        Escrever-Log "conexao encerrada: $($_.Exception.Message)"
    }
    finally {
        $Cliente.Close()
    }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Porta)
$listener.Start()
Escrever-Log "Helper de log do WildFly escutando na porta $Porta — arquivo: $ArquivoLog"

try {
    while ($true) {
        $cliente = $listener.AcceptTcpClient()
        Tratar-Requisicao -Cliente $cliente
    }
}
finally {
    $listener.Stop()
}
