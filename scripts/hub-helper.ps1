<#
.SYNOPSIS
    Helper HTTP nativo do Windows para o que o container Linux do sankhya-hub nao
    consegue fazer: criptografia DPAPI e execucao do git-autosync.exe.

.DESCRIPTION
    O hub roda num container Linux. Duas coisas de que ele precisa so existem no
    Windows e por isso moram aqui:

      1. DPAPI (`ProtectedData`) para guardar login/senha do Sankhya ERP e do Sankhya
         Experience. A API nao existe em Linux — "cofre DPAPI dentro do container" e
         impossivel, nao e escolha de projeto.
      2. `git-autosync.exe`, binario Windows que o container tambem nao executa.

    Mesmo padrao dos helpers do WildFly (portas 4100/4101): TcpListener puro, sem
    HttpListener — este ultimo exige `netsh http add urlacl` ou elevacao para escutar
    fora do loopback, o que quebraria o duplo clique sem admin.

    Diferente dos helpers do WildFly, este le e escreve CORPO de requisicao, entao o
    parser aqui e completo (request-line + headers + Content-Length bytes) em vez de
    so a primeira linha.

.NOTES
    AUTENTICACAO POR TOKEN, obrigatoria em todas as rotas — e a diferenca em relacao
    aos helpers do WildFly, que nao tem nenhuma.

    O motivo: derrubar o WildFly pela rede local e um estrago reversivel; ler a senha
    do Sankhya nao e. A rota /credentials/:sistema/reveal devolve senha em texto claro,
    e sem token bastaria um `curl` de qualquer aparelho da rede para levar a credencial.

    O token e gerado no primeiro boot em %APPDATA%\sankhya-hub\ipc\token.txt. O
    docker-compose monta essa pasta read-only no container, que le o arquivo e manda
    o valor no header `X-Hub-Token`. Nada disso aparece na UI nem trafega para o
    navegador.

    Escutar em todas as interfaces continua sendo necessario: o container alcanca o
    host por `host.docker.internal`, que nao chega pelo loopback.
#>

[CmdletBinding()]
param(
    [int] $Porta = 4102,

    # Onde ficam o cofre DPAPI e o token. %APPDATA% ja e um diretorio de usuario —
    # outro usuario da maquina nao le, e a senha ainda esta cifrada por cima disso.
    [string] $PastaDados = (Join-Path $env:APPDATA 'sankhya-hub'),

    # Launcher do git-autosync. E um .bat que so repassa os argumentos para o Python do
    # venv — este helper le os dois caminhos de dentro dele e chama o python direto.
    [string] $LauncherGitAutosync = (Join-Path $env:USERPROFILE '.git-autosync\bin\git-autosync.bat')
)

$ErrorActionPreference = 'Stop'

# Sistemas aceitos em :sistema. Allowlist, nao validacao de formato: o valor vem da URL
# e sem isso viraria nome de chave arbitrario no arquivo de credenciais.
$SistemasPermitidos = @('sankhya-erp', 'sankhya-experience')

$ArquivoCredenciais = Join-Path $PastaDados 'credentials.dat'
$PastaIpc = Join-Path $PastaDados 'ipc'
$ArquivoToken = Join-Path $PastaIpc 'token.txt'

# Entropia fixa da aplicacao: sem ela, qualquer processo rodando como o mesmo usuario
# desprotege o blob chamando Unprotect. Nao e segredo (esta aqui no fonte) — o que ela
# faz e amarrar o blob a este programa, nao esconder chave.
$EntropiaDpapi = [System.Text.Encoding]::UTF8.GetBytes('sankhya-hub/credenciais/v1')

function Escrever-Log {
    param([string] $Texto)
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Texto"
}

# --- DPAPI -------------------------------------------------------------------

<#
    ProtectedData vem com o Windows PowerShell 5.1. No PowerShell 7 ela nao faz parte
    do conjunto padrao de assemblies, entao o helper falha aqui em vez de subir e so
    quebrar quando alguem tentar salvar uma senha.
#>
function Inicializar-Dpapi {
    try {
        Add-Type -AssemblyName System.Security -ErrorAction Stop
        $null = [System.Security.Cryptography.ProtectedData]
    }
    catch {
        throw 'DPAPI indisponível neste runtime. Rode com o powershell.exe do Windows (5.1), não com pwsh.'
    }
}

function Proteger-Texto {
    param([string] $Texto)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Texto)
    $cifrado = [System.Security.Cryptography.ProtectedData]::Protect(
        $bytes, $EntropiaDpapi, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($cifrado)
}

function Desproteger-Texto {
    param([string] $Base64)
    $cifrado = [Convert]::FromBase64String($Base64)
    $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
        $cifrado, $EntropiaDpapi, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [System.Text.Encoding]::UTF8.GetString($bytes)
}

# --- cofre de credenciais ----------------------------------------------------

function Ler-Cofre {
    if (-not (Test-Path -LiteralPath $ArquivoCredenciais)) { return @{} }

    try {
        $bruto = Get-Content -LiteralPath $ArquivoCredenciais -Raw -Encoding UTF8
        if (-not $bruto) { return @{} }

        $objeto = $bruto | ConvertFrom-Json
        $mapa = @{}
        foreach ($propriedade in $objeto.PSObject.Properties) {
            $mapa[$propriedade.Name] = @{
                usuario = [string] $propriedade.Value.usuario
                senha   = [string] $propriedade.Value.senha
            }
        }
        return $mapa
    }
    catch {
        # Arquivo ilegivel vira cofre vazio: a tela volta a pedir a credencial, que e
        # recuperavel. Abortar o helper deixaria tambem o git-autosync fora do ar.
        Escrever-Log "cofre ilegível, tratando como vazio: $($_.Exception.Message)"
        return @{}
    }
}

<#
    Escrita atomica (temporario + move). Sem isso, um desligamento no meio do write
    deixaria um JSON truncado e TODAS as credenciais sumiriam de uma vez.
#>
function Gravar-Cofre {
    param([hashtable] $Cofre)

    if (-not (Test-Path -LiteralPath $PastaDados)) {
        New-Item -ItemType Directory -Path $PastaDados -Force | Out-Null
    }

    $temporario = "$ArquivoCredenciais.tmp"
    ($Cofre | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $temporario -Encoding UTF8
    Move-Item -LiteralPath $temporario -Destination $ArquivoCredenciais -Force
}

# --- token compartilhado -----------------------------------------------------

<#
    Gerado uma vez e reaproveitado: regerar a cada boot invalidaria o token que o
    container ja leu, e as rotas passariam a responder 401 ate o container reiniciar.
#>
function Obter-Token {
    if (Test-Path -LiteralPath $ArquivoToken) {
        $existente = (Get-Content -LiteralPath $ArquivoToken -Raw -Encoding UTF8).Trim()
        if ($existente) { return $existente }
    }

    if (-not (Test-Path -LiteralPath $PastaIpc)) {
        New-Item -ItemType Directory -Path $PastaIpc -Force | Out-Null
    }

    $bytes = [byte[]]::new(32)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $token = [Convert]::ToBase64String($bytes)

    # Sem BOM: o container le o arquivo cru e um BOM entraria no valor comparado.
    [System.IO.File]::WriteAllText($ArquivoToken, $token, [System.Text.UTF8Encoding]::new($false))
    Escrever-Log "token novo gerado em $ArquivoToken"
    return $token
}

<#
    Comparacao de tempo constante. Um `-eq` de string sai no primeiro byte diferente e
    vaza, pelo tempo de resposta, quantos caracteres do prefixo estao certos.
#>
function Test-TokenValido {
    param([string] $Recebido, [string] $Esperado)

    if (-not $Recebido -or -not $Esperado) { return $false }
    if ($Recebido.Length -ne $Esperado.Length) { return $false }

    $diferenca = 0
    for ($i = 0; $i -lt $Esperado.Length; $i++) {
        $diferenca = $diferenca -bor ([int] $Recebido[$i] -bxor [int] $Esperado[$i])
    }
    return $diferenca -eq 0
}

# --- git-autosync ------------------------------------------------------------

<#
    Descobre o Python e o app.py lendo o launcher .bat, que e so duas linhas:

        @echo off
        "<...>\venv\Scripts\python.exe" "<...>\python\app.py" %*

    Chamar o python direto, e nao o .bat, nao e preferencia de estilo: um .bat passa
    pelo cmd.exe, que reinterpreta `&`, `|`, `^` e `%` DENTRO dos argumentos ja
    entre aspas. Como o caminho do repositorio vem do painel, o .bat transformaria
    esse caminho num vetor de execucao de comando arbitrario (a familia BatBadBut).
    Invocar o .exe com array de argumentos nao abre shell nenhum.
#>
function Resolver-GitAutosync {
    if (-not (Test-Path -LiteralPath $LauncherGitAutosync)) { return $null }

    foreach ($linha in Get-Content -LiteralPath $LauncherGitAutosync) {
        if ($linha -match '^\s*"([^"]+\.exe)"\s+"([^"]+\.py)"') {
            $python = $Matches[1]
            $app = $Matches[2]
            if ((Test-Path -LiteralPath $python) -and (Test-Path -LiteralPath $app)) {
                return @{ python = $python; app = $app }
            }
        }
    }
    return $null
}

function Invoke-GitAutosync {
    param([string[]] $Argumentos)

    if (-not $script:GitAutosync) {
        return @{ ok = $false; codigo = -1; saida = 'git-autosync não encontrado nesta máquina' }
    }

    # Um comando nativo que escreve em stderr (o git escreve bastante) nao pode virar
    # excecao aqui: a saida de erro E o resultado que o painel precisa mostrar.
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $bruta = & $script:GitAutosync.python $script:GitAutosync.app @Argumentos 2>&1
        $codigo = $LASTEXITCODE
    }
    catch {
        return @{ ok = $false; codigo = -1; saida = $_.Exception.Message }
    }
    finally {
        $ErrorActionPreference = $anterior
    }

    $saida = (@($bruta) | ForEach-Object { [string] $_ }) -join "`n"
    return @{ ok = ($codigo -eq 0); codigo = $codigo; saida = $saida }
}

<# Rotas `--json`: devolve o objeto ja desserializado, nao o texto. #>
function Invoke-GitAutosyncJson {
    param([string[]] $Argumentos)

    $resultado = Invoke-GitAutosync -Argumentos $Argumentos
    if (-not $resultado.ok) {
        return @{ status = 502; corpo = @{ ok = $false; erro = $resultado.saida; codigo = $resultado.codigo } }
    }

    try {
        return @{ status = 200; corpo = @{ ok = $true; dados = ($resultado.saida | ConvertFrom-Json) } }
    }
    catch {
        return @{ status = 502; corpo = @{ ok = $false; erro = 'saída do git-autosync não é JSON'; saida = $resultado.saida } }
    }
}

function Invoke-RotaGitAutosync {
    param([string] $Metodo, [string[]] $Segmentos, [hashtable] $Query, [string] $Corpo)

    $acao = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { '' }

    try { $dados = if ($Corpo) { $Corpo | ConvertFrom-Json } else { $null } } catch { $dados = $null }
    $caminho = if ($dados) { [string] $dados.caminho } else { '' }

    # Toda acao que mexe num repositorio exige o caminho: sem `--repo`, o CLI opera
    # sobre o diretorio atual (que aqui e a pasta do helper), commitando o repo errado.
    $exigeCaminho = @('repos', 'commit', 'push', 'sync', 'mr', 'include', 'exclude')
    if ($exigeCaminho -contains $acao -and -not $caminho) {
        return @{ status = 400; corpo = @{ ok = $false; erro = 'envie { caminho }' } }
    }

    switch ("$Metodo $acao") {
        'GET status' { return Invoke-GitAutosyncJson -Argumentos @('status', '--json') }

        'GET config' {
            # `list` nao tem `--json` (so imprime texto), entao a lista de repositorios
            # configurados vem do proprio arquivo de config.
            $arquivo = Join-Path $env:USERPROFILE '.git-autosync\config.json'
            if (-not (Test-Path -LiteralPath $arquivo)) {
                return @{ status = 200; corpo = @{ ok = $true; dados = $null } }
            }
            try {
                $conteudo = Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8 | ConvertFrom-Json
                return @{ status = 200; corpo = @{ ok = $true; dados = $conteudo } }
            }
            catch {
                return @{ status = 502; corpo = @{ ok = $false; erro = "config.json ilegível: $($_.Exception.Message)" } }
            }
        }

        'GET history' {
            $argumentos = @('history', '--json')
            if ($Query['repo']) { $argumentos += @('--repo', $Query['repo']) }
            if ($Query['since']) { $argumentos += @('--since', $Query['since']) }
            if ($Query['limit']) { $argumentos += @('--limit', $Query['limit']) }
            return Invoke-GitAutosyncJson -Argumentos $argumentos
        }

        'GET preview' {
            $argumentos = @('preview', '--json')
            if ($Query['repo']) { $argumentos += @('--repo', $Query['repo']) }
            return Invoke-GitAutosyncJson -Argumentos $argumentos
        }

        'POST repos' {
            if (-not (Test-Path -LiteralPath $caminho -PathType Container)) {
                return @{ status = 400; corpo = @{ ok = $false; erro = "pasta não encontrada: $caminho" } }
            }
            $tipo = if ($dados.tipo -eq 'root') { 'root' } else { 'repo' }
            $resultado = Invoke-GitAutosync -Argumentos @('add', $caminho, '--type', $tipo)
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'DELETE repos' {
            # Sem Test-Path: descadastrar uma pasta que ja foi apagada tem que funcionar.
            $resultado = Invoke-GitAutosync -Argumentos @('remove', $caminho)
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        <#
            `exclude`/`include` nao sao o mesmo que `remove`/`add`: um alvo do tipo
            `root` varre a pasta inteira e cada repo dentro dela entra sozinho. Tirar um
            desses do agendamento e excluir, nao descadastrar — `remove` apagaria o alvo
            raiz e levaria junto todos os outros repos daquela pasta.
        #>
        'POST exclude' {
            $resultado = Invoke-GitAutosync -Argumentos @('exclude', $caminho)
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'POST include' {
            $resultado = Invoke-GitAutosync -Argumentos @('include', $caminho)
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'POST commit' {
            $argumentos = @('commit', '--repo', $caminho)
            if ($dados.mensagem) { $argumentos += @('--message', [string] $dados.mensagem) }
            $resultado = Invoke-GitAutosync -Argumentos $argumentos
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'POST push' {
            $resultado = Invoke-GitAutosync -Argumentos @('push', '--repo', $caminho)
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'POST sync' {
            $argumentos = @('sync', '--repo', $caminho)
            if ($dados.mensagem) { $argumentos += @('--message', [string] $dados.mensagem) }
            $resultado = Invoke-GitAutosync -Argumentos $argumentos
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'POST mr' {
            $argumentos = @('mr', '--repo', $caminho)
            if ($dados.titulo) { $argumentos += @('--title', [string] $dados.titulo) }
            if ($dados.target) { $argumentos += @('--target', [string] $dados.target) }
            if ($dados.source) { $argumentos += @('--source', [string] $dados.source) }
            $resultado = Invoke-GitAutosync -Argumentos $argumentos
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = "rota desconhecida: $Metodo /$($Segmentos -join '/')" } }
}

# --- HTTP --------------------------------------------------------------------

<#
    Le a requisicao inteira do socket: request-line, headers e, quando houver,
    Content-Length bytes de corpo.

    Byte a byte pelo NetworkStream, sem StreamReader, de proposito: o StreamReader
    bufferiza adiante e conta CARACTERES, enquanto Content-Length conta BYTES — com
    acento no corpo (e vai ter, e senha e nome de usuario) as duas contas divergem e o
    JSON chega truncado.
#>
function Ler-Requisicao {
    param([System.Net.Sockets.NetworkStream] $Stream)

    $buffer = [System.Collections.Generic.List[byte]]::new()
    $pedaco = [byte[]]::new(4096)
    $fimCabecalho = -1

    while ($fimCabecalho -lt 0) {
        $lidos = $Stream.Read($pedaco, 0, $pedaco.Length)
        if ($lidos -le 0) { return $null }
        for ($i = 0; $i -lt $lidos; $i++) { $buffer.Add($pedaco[$i]) }

        for ($i = 0; $i -le $buffer.Count - 4; $i++) {
            if ($buffer[$i] -eq 13 -and $buffer[$i + 1] -eq 10 -and
                $buffer[$i + 2] -eq 13 -and $buffer[$i + 3] -eq 10) {
                $fimCabecalho = $i
                break
            }
        }

        # Cabecalho absurdo e requisicao malformada ou hostil, nao trafego do hub.
        if ($fimCabecalho -lt 0 -and $buffer.Count -gt 65536) { return $null }
    }

    $textoCabecalho = [System.Text.Encoding]::UTF8.GetString($buffer.ToArray(), 0, $fimCabecalho)
    $linhas = $textoCabecalho -split "`r`n"

    $partes = $linhas[0] -split ' '
    if ($partes.Length -lt 2) { return $null }

    $headers = @{}
    # A partir de 1: a linha 0 e a request-line. Sem o guarda, uma requisicao sem header
    # nenhum vira o intervalo 1..0, que em PowerShell conta pra tras e le indice invalido.
    for ($i = 1; $i -lt $linhas.Length; $i++) {
        $separador = $linhas[$i].IndexOf(':')
        if ($separador -gt 0) {
            $nome = $linhas[$i].Substring(0, $separador).Trim().ToLowerInvariant()
            $headers[$nome] = $linhas[$i].Substring($separador + 1).Trim()
        }
    }

    $tamanhoCorpo = 0
    if ($headers.ContainsKey('content-length')) {
        [void][int]::TryParse($headers['content-length'], [ref] $tamanhoCorpo)
    }

    $inicioCorpo = $fimCabecalho + 4
    while (($buffer.Count - $inicioCorpo) -lt $tamanhoCorpo) {
        $lidos = $Stream.Read($pedaco, 0, $pedaco.Length)
        if ($lidos -le 0) { break }
        for ($i = 0; $i -lt $lidos; $i++) { $buffer.Add($pedaco[$i]) }
    }

    $corpo = ''
    if ($tamanhoCorpo -gt 0) {
        $disponivel = [Math]::Min($tamanhoCorpo, $buffer.Count - $inicioCorpo)
        if ($disponivel -gt 0) {
            $corpo = [System.Text.Encoding]::UTF8.GetString($buffer.ToArray(), $inicioCorpo, $disponivel)
        }
    }

    # Caminho e querystring separados: juntos, um `?` no fim da URL entraria no nome do
    # sistema e furaria a allowlist de /credentials por acidente.
    $pedacos = $partes[1] -split '\?', 2
    $query = @{}
    if ($pedacos.Length -gt 1 -and $pedacos[1]) {
        foreach ($par in $pedacos[1] -split '&') {
            $igual = $par.IndexOf('=')
            if ($igual -gt 0) {
                $nome = [System.Uri]::UnescapeDataString($par.Substring(0, $igual))
                $query[$nome] = [System.Uri]::UnescapeDataString($par.Substring($igual + 1))
            }
        }
    }

    return @{
        metodo  = $partes[0].ToUpperInvariant()
        caminho = $pedacos[0]
        query   = $query
        headers = $headers
        corpo   = $corpo
    }
}

function Responder {
    param(
        [System.Net.Sockets.NetworkStream] $Stream,
        [int] $Status,
        $Objeto
    )

    $texto = switch ($Status) {
        200 { '200 OK' }
        400 { '400 Bad Request' }
        401 { '401 Unauthorized' }
        404 { '404 Not Found' }
        default { '500 Internal Server Error' }
    }

    $corpo = $Objeto | ConvertTo-Json -Depth 6 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($corpo)
    $cabecalho = "HTTP/1.1 $texto`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
    $bytesCabecalho = [System.Text.Encoding]::ASCII.GetBytes($cabecalho)

    $Stream.Write($bytesCabecalho, 0, $bytesCabecalho.Length)
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush()
}

# --- rotas -------------------------------------------------------------------

function Invoke-RotaCredenciais {
    param([string] $Metodo, [string[]] $Segmentos, [string] $Corpo)

    # $Segmentos: 'credentials', <sistema>, [ 'reveal' ]
    $sistema = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { '' }
    if ($SistemasPermitidos -notcontains $sistema) {
        return @{ status = 404; corpo = @{ ok = $false; erro = "sistema desconhecido: $sistema" } }
    }

    $acao = if ($Segmentos.Length -ge 3) { $Segmentos[2] } else { '' }
    $cofre = Ler-Cofre
    $entrada = $cofre[$sistema]

    if ($Metodo -eq 'GET' -and $acao -eq 'reveal') {
        if (-not $entrada) {
            return @{ status = 404; corpo = @{ ok = $false; erro = "sem credencial guardada para $sistema" } }
        }
        try {
            return @{ status = 200; corpo = @{ ok = $true; usuario = $entrada.usuario; senha = (Desproteger-Texto $entrada.senha) } }
        }
        catch {
            # Blob de outro usuario/maquina ou perfil recriado: o DPAPI nao volta atras.
            return @{ status = 500; corpo = @{ ok = $false; erro = 'não consegui decriptar — regrave a credencial neste usuário do Windows' } }
        }
    }

    if ($Metodo -eq 'GET' -and -not $acao) {
        return @{ status = 200; corpo = @{
            ok       = $true
            usuario  = if ($entrada) { $entrada.usuario } else { '' }
            definido = [bool] $entrada
        } }
    }

    if ($Metodo -eq 'POST' -and -not $acao) {
        try { $dados = $Corpo | ConvertFrom-Json } catch { $dados = $null }

        $usuario = [string] $dados.usuario
        $senha = [string] $dados.senha
        # Espaco em volta e quase sempre acidente de copiar e colar, e uma senha com
        # espaco invisivel no fim falha a autenticacao sem dar pista nenhuma.
        if ($usuario) { $usuario = $usuario.Trim() }

        if (-not $usuario -or -not $senha) {
            return @{ status = 400; corpo = @{ ok = $false; erro = 'envie { usuario, senha }' } }
        }

        $cofre[$sistema] = @{ usuario = $usuario; senha = (Proteger-Texto $senha) }
        Gravar-Cofre $cofre
        return @{ status = 200; corpo = @{ ok = $true; usuario = $usuario; definido = $true } }
    }

    if ($Metodo -eq 'DELETE' -and -not $acao) {
        $cofre.Remove($sistema)
        Gravar-Cofre $cofre
        return @{ status = 200; corpo = @{ ok = $true; usuario = ''; definido = $false } }
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = "rota desconhecida: $Metodo /$($Segmentos -join '/')" } }
}

function Invoke-Rota {
    param([hashtable] $Requisicao)

    $segmentos = $Requisicao.caminho.Trim('/') -split '/'

    if ($segmentos[0] -eq 'health') {
        return @{ status = 200; corpo = @{
            ok         = $true
            helper     = 'sankhya-hub'
            porta      = $Porta
            gitAutosync = [bool] $script:GitAutosync
        } }
    }
    if ($segmentos[0] -eq 'credentials') {
        return Invoke-RotaCredenciais -Metodo $Requisicao.metodo -Segmentos $segmentos -Corpo $Requisicao.corpo
    }
    if ($segmentos[0] -eq 'git-autosync') {
        return Invoke-RotaGitAutosync -Metodo $Requisicao.metodo -Segmentos $segmentos `
            -Query $Requisicao.query -Corpo $Requisicao.corpo
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = "rota desconhecida: $($Requisicao.caminho)" } }
}

function Tratar-Requisicao {
    param([System.Net.Sockets.TcpClient] $Cliente, [string] $Token)

    $stream = $null
    try {
        $stream = $Cliente.GetStream()
        $requisicao = Ler-Requisicao -Stream $stream
        if (-not $requisicao) { return }

        $recebido = if ($requisicao.headers.ContainsKey('x-hub-token')) { $requisicao.headers['x-hub-token'] } else { '' }
        if (-not (Test-TokenValido -Recebido $recebido -Esperado $Token)) {
            Escrever-Log "401 $($requisicao.metodo) $($requisicao.caminho) (token ausente ou inválido)"
            Responder -Stream $stream -Status 401 -Objeto @{ ok = $false; erro = 'token inválido' }
            return
        }

        $resultado = Invoke-Rota -Requisicao $requisicao

        # A senha revelada nunca entra no log — ele fica visivel na janela do helper e
        # pode acabar em captura de tela.
        Escrever-Log "$($resultado.status) $($requisicao.metodo) $($requisicao.caminho)"
        Responder -Stream $stream -Status $resultado.status -Objeto $resultado.corpo
    }
    catch {
        Escrever-Log "erro tratando requisição: $($_.Exception.Message)"
        if ($stream) {
            try { Responder -Stream $stream -Status 500 -Objeto @{ ok = $false; erro = 'erro interno' } } catch { }
        }
    }
    finally {
        $Cliente.Close()
    }
}

# --- fluxo -------------------------------------------------------------------

Inicializar-Dpapi

<#
    UTF-8 nos dois sentidos da conversa com o git-autosync.

    Sem PYTHONIOENCODING, o Python do venv escreve a saida no code page do console
    (cp1252 nesta maquina) e ABORTA com `'charmap' codec can't encode character` quando
    uma mensagem de commit traz caractere fora dele — o `history` de qualquer repo com
    acento ou BOM numa mensagem simplesmente nao retorna.

    Sem OutputEncoding, o mesmo problema na volta: o PowerShell decodificaria os bytes
    UTF-8 do filho como cp1252 e os acentos chegariam corrompidos ao painel.
#>
$env:PYTHONIOENCODING = 'utf-8'
try {
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
}
catch {
    # Sem console anexado (iniciado oculto pelo atalho) nao ha o que configurar.
}

$token = Obter-Token

# Resolvido uma vez no boot: o launcher nao muda de lugar enquanto o helper roda, e
# reler o .bat a cada requisicao so trocaria I/O por nada.
$script:GitAutosync = Resolver-GitAutosync

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Porta)
$listener.Start()
Escrever-Log "Helper do hub escutando na porta $Porta (todas as interfaces, exigindo X-Hub-Token)"
Escrever-Log "Cofre DPAPI: $ArquivoCredenciais"
if ($script:GitAutosync) {
    Escrever-Log "git-autosync: $($script:GitAutosync.app)"
}
else {
    Escrever-Log "git-autosync nao encontrado em $LauncherGitAutosync — as rotas /git-autosync respondem erro"
}

try {
    while ($true) {
        $cliente = $listener.AcceptTcpClient()
        Tratar-Requisicao -Cliente $cliente -Token $token
    }
}
finally {
    $listener.Stop()
}
