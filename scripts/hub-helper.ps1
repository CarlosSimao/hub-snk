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
                # Capturados do navegador do hub. Valem tanto quanto a senha enquanto
                # nao expiram, entao sao cifrados do mesmo jeito. `expira` fica em
                # claro: e data, nao credencial.
                sessao  = [string] $propriedade.Value.sessao
                token   = [string] $propriedade.Value.token
                expira  = [string] $propriedade.Value.expira
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

# --- navegador controlado (captura de sessão) --------------------------------

<#
    Porta do DevTools Protocol. Fica em 127.0.0.1 e NAO e publicada para o container:
    quem fala CDP e este helper, e o hub so recebe o resultado pela 4102, que exige
    token. Abrir o CDP para a rede daria controle total de um navegador logado no
    Sankhya para qualquer aparelho que alcancasse a porta.
#>
$PortaCdp = 9222

# Perfil proprio do hub, separado do seu Chrome do dia a dia. E o que torna a leitura
# de cookies legitima: e a sessao que o hub abriu, nao a sua.
$PastaPerfil = Join-Path $PastaDados 'navegador'

$UrlLogin = @{
    'sankhya-erp'        = 'https://skw.sankhya.com.br/mge/'
    'sankhya-experience' = 'https://experience.sankhya.com.br/'
}

# Dominios cujos cookies interessam a cada sistema.
$DominiosSistema = @{
    'sankhya-erp'        = @('sankhya.com.br')
    'sankhya-experience' = @('sankhya.com.br')
}

<#
    Onde mora o que REALMENTE autentica cada sistema.

    Medido: a API da Experience (API Gateway da AWS) responde 403 com o cookie e 200 com
    `Authorization: Bearer <localStorage.token>`. O cookie de sessao nao serve para ela —
    e nao existe cookie no dominio amazonaws.com. Por isso a captura da Experience busca
    o JWT, e considerar a captura bem-sucedida sem ele daria uma sessao que nao funciona.

    O ERP legado e o contrario: `service.sbr` vai por cookie, e nao ha token nenhum.
#>
$TokenSistema = @{
    'sankhya-experience' = @{ url = 'experience.sankhya.com.br'; chave = 'token' }
}

<#
    Navegadores que o helper sabe abrir, na ordem de preferencia dentro de cada marca.
    O usuario escolhe a marca; sem escolha, vale o primeiro que existir na maquina.
#>
$CaminhosNavegador = [ordered]@{
    chrome = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    edge   = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
}

function Resolver-Navegador {
    param([string] $Marca = '')

    $marcas = if ($Marca -and $CaminhosNavegador.Contains($Marca)) { @($Marca) } else { $CaminhosNavegador.Keys }
    foreach ($m in $marcas) {
        foreach ($caminho in $CaminhosNavegador[$m]) {
            if ($caminho -and (Test-Path -LiteralPath $caminho)) { return $caminho }
        }
    }
    return $null
}

<# Quais marcas existem nesta maquina, para a tela oferecer so o que da para abrir. #>
function Get-NavegadoresDisponiveis {
    $achados = @()
    foreach ($m in $CaminhosNavegador.Keys) {
        if (Resolver-Navegador -Marca $m) { $achados += $m }
    }
    return $achados
}

function Test-CdpNoAr {
    try {
        $null = Invoke-RestMethod -Uri "http://127.0.0.1:$PortaCdp/json/version" -TimeoutSec 2
        return $true
    }
    catch { return $false }
}

<#
    Abre a URL no navegador do hub.

    Chamar o executavel de novo com o mesmo `--user-data-dir` NAO sobe um segundo
    navegador: o Chrome entrega a URL para a instancia que ja roda e abre uma guia. E
    por isso que nao ha controle de PID aqui.
#>
function Abrir-NoNavegador {
    param([string] $Url, [string] $Marca = '')

    $navegador = Resolver-Navegador -Marca $Marca
    if (-not $navegador) {
        $qual = if ($Marca) { "o navegador '$Marca'" } else { 'nenhum Chrome ou Edge' }
        return @{ ok = $false; erro = "$qual não foi encontrado nesta máquina" }
    }

    if (-not (Test-Path -LiteralPath $PastaPerfil)) {
        New-Item -ItemType Directory -Path $PastaPerfil -Force | Out-Null
    }

    Start-Process -FilePath $navegador -ArgumentList @(
        "--user-data-dir=$PastaPerfil",
        "--remote-debugging-port=$PortaCdp",
        '--no-first-run',
        '--no-default-browser-check',
        $Url
    )

    # O CDP so responde depois que o navegador termina de subir; sem esperar, a captura
    # logo em seguida falharia num navegador que estava fechado.
    $limite = (Get-Date).AddSeconds(20)
    while (-not (Test-CdpNoAr) -and (Get-Date) -lt $limite) {
        Start-Sleep -Milliseconds 500
    }

    if (-not (Test-CdpNoAr)) {
        return @{ ok = $false; erro = "o navegador subiu mas o DevTools não respondeu na porta $PortaCdp" }
    }
    return @{ ok = $true; navegador = $navegador }
}

<#
    Uma chamada CDP no alvo do NAVEGADOR (nao de uma guia): `Storage.getCookies` ali
    devolve os cookies do perfil inteiro, sem precisar descobrir em qual guia o login
    aconteceu.
#>
function Invoke-Cdp {
    param(
        [string] $Metodo,
        [hashtable] $Parametros = @{},
        # Vazio = alvo do navegador. Preenchido = uma guia, necessario para avaliar JS.
        [string] $UrlWs = ''
    )

    if (-not $UrlWs) {
        $versao = Invoke-RestMethod -Uri "http://127.0.0.1:$PortaCdp/json/version" -TimeoutSec 5
        $UrlWs = $versao.webSocketDebuggerUrl
    }
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()

    try {
        if (-not $ws.ConnectAsync([Uri] $UrlWs, [Threading.CancellationToken]::None).Wait(10000)) {
            throw 'timeout conectando ao DevTools'
        }

        $corpo = @{ id = 1; method = $Metodo; params = $Parametros } | ConvertTo-Json -Depth 6 -Compress
        $bytes = [Text.Encoding]::UTF8.GetBytes($corpo)
        $null = $ws.SendAsync(
            [ArraySegment[byte]]::new($bytes),
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [Threading.CancellationToken]::None).Wait(10000)

        $buffer = [byte[]]::new(65536)
        # O alvo do navegador emite eventos por conta propria; ler a primeira mensagem
        # que chegar pegaria um evento no lugar da resposta. A resposta e a que traz o
        # mesmo `id` que enviamos.
        $limite = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $limite) {
            $texto = [Text.StringBuilder]::new()
            do {
                $tarefa = $ws.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None)
                if (-not $tarefa.Wait(30000)) { throw 'timeout lendo resposta do DevTools' }
                $null = $texto.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $tarefa.Result.Count))
            } while (-not $tarefa.Result.EndOfMessage)

            $mensagem = $texto.ToString() | ConvertFrom-Json
            if ($mensagem.id -eq 1) { return $mensagem }
        }
        throw 'o DevTools não respondeu à chamada'
    }
    finally {
        $ws.Dispose()
    }
}

<#
    Le uma chave do localStorage da guia onde o sistema esta aberto.

    Precisa do alvo da GUIA, nao do navegador: `Runtime.evaluate` so existe num contexto
    de execucao de pagina.
#>
function Obter-TokenDaPagina {
    param([string] $UrlContem, [string] $Chave)

    $lista = Invoke-RestMethod -Uri "http://127.0.0.1:$PortaCdp/json/list" -TimeoutSec 5
    $alvo = $lista | Where-Object { $_.type -eq 'page' -and $_.url -like "*$UrlContem*" } | Select-Object -First 1
    if (-not $alvo) { return '' }

    $resposta = Invoke-Cdp -UrlWs $alvo.webSocketDebuggerUrl -Metodo 'Runtime.evaluate' -Parametros @{
        expression    = "localStorage.getItem('$Chave')"
        returnByValue = $true
    }
    return [string] $resposta.result.result.value
}

<#
    Quando o token e um JWT, o `exp` do payload diz ate quando a sessao vale — e o que
    permite a tela avisar que expirou em vez de so falhar na proxima chamada.

    O payload e base64url: `-` e `_` no lugar de `+` e `/`, e sem o `=` do final.
#>
function Obter-ExpiracaoJwt {
    param([string] $Token)

    $partes = $Token -split '\.'
    if ($partes.Length -ne 3) { return '' }

    try {
        $texto = $partes[1].Replace('-', '+').Replace('_', '/')
        switch ($texto.Length % 4) {
            2 { $texto += '==' }
            3 { $texto += '=' }
        }
        $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($texto)) | ConvertFrom-Json
        if (-not $payload.exp) { return '' }
        return ([DateTimeOffset]::FromUnixTimeSeconds([long] $payload.exp)).UtcDateTime.ToString('o')
    }
    catch { return '' }
}

function Obter-Cookies {
    param([string[]] $Dominios)

    $resposta = Invoke-Cdp -Metodo 'Storage.getCookies'
    $todos = @($resposta.result.cookies)

    return @($todos | Where-Object {
        $dominio = $_.domain
        ($Dominios | Where-Object { $dominio -like "*$_" }).Count -gt 0
    })
}

<#
    Busca a Agenda de Recursos chamando `service.sbr` de DENTRO da guia autenticada.

    Medido em 2026-09-11: a ACL nega essa chamada quando ela vem de fora, mas de dentro
    da pagina, com a sessao de tela, ela passa e devolve status 1 — e o mesmo motivo
    pelo qual a automacao de UI funciona. Isso dispensa a captura manual pelo DevTools.

    Uma requisicao por vez: o Sankhya cancela chamadas simultaneas da mesma sessao HTTP
    com "situacao de concorrencia", entao nada de paralelizar aqui.
#>
function Get-AgendaRecursos {
    param([string] $De, [string] $Ate)

    $lista = Invoke-RestMethod -Uri "http://127.0.0.1:$PortaCdp/json/list" -TimeoutSec 5
    $alvo = $lista | Where-Object { $_.type -eq 'page' -and $_.url -like '*skw.sankhya.com.br*' } | Select-Object -First 1
    if (-not $alvo) {
        return @{ ok = $false; erro = 'nenhuma guia do Sankhya ERP aberta no navegador do hub' }
    }

    $corpo = @{
        serviceName = 'AgendaRecursosSP.carregarAgendas'
        requestBody = @{
            params = @{
                filter                  = @{}
                start                   = $De
                end                     = $Ate
                filtroRapido            = @{}
                mostraUsuarioLogado     = $false
                resourceId              = 'br.com.sankhya.os.mov.agenda.recursos'
                resourceIdListaUsuarios = 'br.com.sankhya.os.mov.agenda.recursos.list.Executante'
            }
            clientEventList = @{ clientEvent = @(@{ '$' = 'br.com.sankhya.mgeserv.event.envio.email' }) }
        }
    } | ConvertTo-Json -Depth 10 -Compress

    # `/mgeos/`, nao `/mge/`: a tela de agenda fica noutro contexto da aplicacao.
    $url = '/mgeos/service.sbr?serviceName=AgendaRecursosSP.carregarAgendas&counter=1&application=AgendaRecursos&outputType=json&preventTransform='

    # ConvertTo-Json de uma string devolve ela ja entre aspas e escapada — e o jeito de
    # embutir o corpo com seguranca dentro da expressao JavaScript.
    $expressao = "fetch($($url | ConvertTo-Json), { method: 'POST', headers: { 'content-type': 'application/json' }, body: $($corpo | ConvertTo-Json), credentials: 'same-origin' }).then(function (r) { return r.text(); })"

    try {
        $resposta = Invoke-Cdp -UrlWs $alvo.webSocketDebuggerUrl -Metodo 'Runtime.evaluate' -Parametros @{
            expression    = $expressao
            returnByValue = $true
            awaitPromise  = $true
        }
    }
    catch {
        return @{ ok = $false; erro = "falha chamando o Sankhya pela guia: $($_.Exception.Message)" }
    }

    $texto = [string] $resposta.result.result.value
    if (-not $texto) {
        return @{ ok = $false; erro = 'a guia nao devolveu nada — a sessao do ERP pode ter expirado' }
    }
    # Sessao morta devolve o HTML do login, nao JSON.
    if ($texto.TrimStart().StartsWith('<')) {
        return @{ ok = $false; erro = 'o Sankhya respondeu HTML e nao JSON — faca login de novo na janela do hub' }
    }

    return @{ ok = $true; conteudo = $texto }
}

<#
    Onde cada navegador guarda os perfis do usuario.

    O hub NAO usa esses perfis: desde o Chrome 136, o navegador recusa
    `--remote-debugging-port` quando o perfil e o padrao — protecao deliberada contra
    malware que se conecta ao navegador ja logado. Sem DevTools o hub nao le a sessao,
    entao o perfil proprio nao e escolha, e a unica opcao.

    O que da para trazer de la e o arquivo de FAVORITOS. So ele: senha, cookie e
    historico ficam onde estao.
#>
$PerfisNavegador = @{
    chrome = (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data')
    edge   = (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')
}

<# Perfis que existem e tem favoritos, com o nome que o usuario ve no navegador. #>
function Get-PerfisComFavoritos {
    $saida = @()

    foreach ($marca in $PerfisNavegador.Keys) {
        $base = $PerfisNavegador[$marca]
        if (-not (Test-Path -LiteralPath $base)) { continue }

        # O nome de exibicao mora no `Local State`; a pasta e so `Default`/`Profile N`.
        $apelidos = @{}
        $localState = Join-Path $base 'Local State'
        if (Test-Path -LiteralPath $localState) {
            try {
                $json = Get-Content -LiteralPath $localState -Raw -Encoding UTF8 | ConvertFrom-Json
                foreach ($p in $json.profile.info_cache.PSObject.Properties) {
                    $apelidos[$p.Name] = [string] $p.Value.name
                }
            }
            catch { }
        }

        foreach ($pasta in Get-ChildItem -LiteralPath $base -Directory -ErrorAction SilentlyContinue) {
            if ($pasta.Name -ne 'Default' -and $pasta.Name -notlike 'Profile*') { continue }
            if (-not (Test-Path -LiteralPath (Join-Path $pasta.FullName 'Bookmarks'))) { continue }

            $saida += @{
                navegador = $marca
                pasta     = $pasta.Name
                nome      = if ($apelidos.ContainsKey($pasta.Name)) { $apelidos[$pasta.Name] } else { $pasta.Name }
            }
        }
    }

    return $saida
}

<#
    Le os favoritos de um perfil pessoal e devolve a lista achatada.

    Diferente de `Importar-Favoritos`, que copia o arquivo para o perfil do hub, aqui o
    arquivo so e LIDO: serve para a tela oferecer os parceiros ja salvos no navegador
    como ponto de partida de um cadastro. Nada e escrito, e o navegador pode estar
    aberto.

    So links http(s) entram. Um favorito `javascript:` viraria clique armado assim que a
    tela abrisse a URL do cliente, e `file:` nao e endereco de parceiro.
#>
function Get-ListaFavoritos {
    param([string] $Marca, [string] $Pasta)

    if (-not $PerfisNavegador.ContainsKey($Marca)) {
        return @{ ok = $false; erro = "navegador desconhecido: $Marca" }
    }
    # `Pasta` vem da tela; sem esta checagem viraria caminho arbitrario.
    if ($Pasta -notmatch '^(Default|Profile \d+)$') {
        return @{ ok = $false; erro = "perfil inválido: $Pasta" }
    }

    $arquivo = Join-Path (Join-Path $PerfisNavegador[$Marca] $Pasta) 'Bookmarks'
    if (-not (Test-Path -LiteralPath $arquivo)) {
        return @{ ok = $false; erro = "esse perfil não tem favoritos: $arquivo" }
    }

    try {
        $json = Get-Content -LiteralPath $arquivo -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        return @{ ok = $false; erro = "favoritos ilegíveis: $($_.Exception.Message)" }
    }

    $itens = [System.Collections.Generic.List[hashtable]]::new()

    <#
        A arvore de favoritos do Chromium aninha pastas sem limite. A recursao carrega o
        caminho da pasta porque e ele que diz de onde veio cada link — quem organiza os
        clientes numa pasta reconhece a lista inteira por ela.
    #>
    function Percorrer {
        param($No, [string] $Caminho)

        foreach ($filho in @($No.children)) {
            if ($null -eq $filho) { continue }

            if ($filho.type -eq 'folder') {
                $adiante = if ($Caminho) { "$Caminho/$($filho.name)" } else { [string] $filho.name }
                Percorrer -No $filho -Caminho $adiante
                continue
            }

            $url = [string] $filho.url
            if ($url -notmatch '^https?://') { continue }

            $itens.Add(@{
                titulo = [string] $filho.name
                url    = $url
                pasta  = $Caminho
            })
        }
    }

    foreach ($raiz in @('bookmark_bar', 'other', 'synced')) {
        $no = $json.roots.$raiz
        if ($no) { Percorrer -No $no -Caminho '' }
    }

    return @{ ok = $true; favoritos = @($itens) }
}

<#
    Copia os favoritos de um perfil do usuario para o perfil do hub.

    Precisa do navegador do hub FECHADO: o Chrome mantem os favoritos em memoria e
    regrava o arquivo ao sair, desfazendo a copia sem avisar.
#>
function Importar-Favoritos {
    param([string] $Marca, [string] $Pasta)

    if (-not $PerfisNavegador.ContainsKey($Marca)) {
        return @{ ok = $false; erro = "navegador desconhecido: $Marca" }
    }
    # `Pasta` vem da tela; sem esta checagem viraria caminho arbitrario.
    if ($Pasta -notmatch '^(Default|Profile \d+)$') {
        return @{ ok = $false; erro = "perfil inválido: $Pasta" }
    }
    if (Test-CdpNoAr) {
        return @{ ok = $false; erro = 'feche a janela do hub antes de importar — o navegador regrava os favoritos ao sair e desfaz a cópia' }
    }

    $origem = Join-Path (Join-Path $PerfisNavegador[$Marca] $Pasta) 'Bookmarks'
    if (-not (Test-Path -LiteralPath $origem)) {
        return @{ ok = $false; erro = "esse perfil não tem favoritos: $origem" }
    }

    $destinoPasta = Join-Path $PastaPerfil 'Default'
    if (-not (Test-Path -LiteralPath $destinoPasta)) {
        New-Item -ItemType Directory -Path $destinoPasta -Force | Out-Null
    }

    try {
        Copy-Item -LiteralPath $origem -Destination (Join-Path $destinoPasta 'Bookmarks') -Force
        # O `.bak` antigo faria o Chrome preferir a versao anterior em alguns casos.
        $bak = Join-Path $destinoPasta 'Bookmarks.bak'
        if (Test-Path -LiteralPath $bak) { Remove-Item -LiteralPath $bak -Force }
    }
    catch {
        return @{ ok = $false; erro = "falha copiando: $($_.Exception.Message)" }
    }

    return @{ ok = $true }
}

<#
    Fecha a janela do hub — e SO ela.

    Casa pelo `--user-data-dir` na linha de comando: o navegador pessoal do usuario roda
    com outro perfil e nao pode ser derrubado junto.
#>
function Fechar-NavegadorDoHub {
    $processos = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe' OR Name = 'msedge.exe'" |
        Where-Object { $_.CommandLine -like "*--user-data-dir=$PastaPerfil*" }

    if (-not $processos) { return @{ ok = $true; mensagem = 'já estava fechada' } }

    foreach ($p in $processos) {
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    # O CDP some junto com o processo; esperar evita dizer "fechada" cedo demais.
    $limite = (Get-Date).AddSeconds(10)
    while ((Test-CdpNoAr) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 300 }

    return @{ ok = $true; mensagem = "encerrada ($($processos.Count) processo(s))" }
}

<#
    As telas do Sankhya que o hub sabe abrir, por apelido.

    O `resourceID` vai em base64 depois do `#` porque a aplicacao e uma SPA: o trecho
    apos o `#` nunca chega ao servidor, quem le e o JavaScript dela.
#>
$TelasSankhya = @{
    'agenda-recursos' = @{ sistema = 'sankhya-erp'; resource = 'br.com.sankhya.os.mov.agenda.recursos' }
}

function Resolver-UrlTela {
    param([string] $Tela)

    if (-not $TelasSankhya.ContainsKey($Tela)) { return '' }
    $info = $TelasSankhya[$Tela]
    $base64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($info.resource))
    return "https://skw.sankhya.com.br/mge/system.jsp#app/$base64"
}

<#
    O que esta aberto na janela do hub.

    So as guias de PAGINA e so a URL — o usuario pode usar o navegador normalmente, com
    quantas guias quiser, e o hub nao se mete nelas. Isto existe para a tela do hub
    poder dizer "o Sankhya esta aberto ali" em vez de adivinhar.
#>
function Get-AbasNavegador {
    if (-not (Test-CdpNoAr)) { return @() }

    try {
        $lista = Invoke-RestMethod -Uri "http://127.0.0.1:$PortaCdp/json/list" -TimeoutSec 5
    }
    catch { return @() }

    return @($lista | Where-Object { $_.type -eq 'page' } | ForEach-Object {
        $url = [string] $_.url
        @{
            id      = [string] $_.id
            url     = $url
            titulo  = [string] $_.title
            sistema = if ($url -like '*skw.sankhya.com.br*') { 'sankhya-erp' }
                      elseif ($url -like '*experience.sankhya.com.br*' -or $url -like '*login.sankhya.com.br*') { 'sankhya-experience' }
                      else { '' }
            # Sessao morta redireciona para a tela de login; e o sinal honesto que o
            # cookie do ERP nao da, porque ele nao carrega validade nenhuma.
            logado  = -not ($url -like '*login.jsp*' -or $url -like '*login.sankhya.com.br*')
        }
    })
}

function Invoke-RotaNavegador {
    param([string] $Metodo, [string[]] $Segmentos, [hashtable] $Query, [string] $Corpo)

    try { $dados = if ($Corpo) { $Corpo | ConvertFrom-Json } else { $null } } catch { $dados = $null }

    $acao = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { '' }
    $sistema = if ($Segmentos.Length -ge 3) { $Segmentos[2] } elseif ($dados) { [string] $dados.sistema } else { '' }

    # A busca da agenda nao e por sistema: ela e sempre no ERP.
    if ($Metodo -eq 'POST' -and $acao -eq 'agenda') {
        $de = [string] $dados.de
        $ate = [string] $dados.ate
        if ($de -notmatch '^\d{2}/\d{2}/\d{4}$' -or $ate -notmatch '^\d{2}/\d{2}/\d{4}$') {
            return @{ status = 400; corpo = @{ ok = $false; erro = 'envie { de, ate } em DD/MM/AAAA' } }
        }

        $resultado = Get-AgendaRecursos -De $de -Ate $ate
        if (-not $resultado.ok) {
            return @{ status = 409; corpo = @{ ok = $false; erro = $resultado.erro } }
        }
        return @{ status = 200; corpo = @{ ok = $true; conteudo = $resultado.conteudo } }
    }

    # Estas acoes sao da JANELA, nao de um sistema: nao tem `:sistema` para validar.
    $semSistema = @('status', 'fechar', 'favoritos')
    if ($semSistema -notcontains $acao -and $SistemasPermitidos -notcontains $sistema) {
        return @{ status = 404; corpo = @{ ok = $false; erro = "sistema desconhecido: $sistema" } }
    }

    if ($Metodo -eq 'GET' -and $acao -eq 'status') {
        $abas = Get-AbasNavegador
        return @{ status = 200; corpo = @{
            ok           = $true
            navegador    = [bool] (Resolver-Navegador)
            disponiveis  = (Get-NavegadoresDisponiveis)
            aberto       = (Test-CdpNoAr)
            abas         = $abas
            telas        = @($TelasSankhya.Keys)
            perfis       = (Get-PerfisComFavoritos)
        } }
    }

    if ($Metodo -eq 'POST' -and $acao -eq 'fechar') {
        return @{ status = 200; corpo = (Fechar-NavegadorDoHub) }
    }

    if ($Metodo -eq 'GET' -and $acao -eq 'favoritos') {
        $resultado = Get-ListaFavoritos -Marca ([string] $Query['navegador']) -Pasta ([string] $Query['perfil'])
        return @{ status = $(if ($resultado.ok) { 200 } else { 400 }); corpo = $resultado }
    }

    if ($Metodo -eq 'POST' -and $acao -eq 'favoritos') {
        $resultado = Importar-Favoritos -Marca ([string] $dados.navegador) -Pasta ([string] $dados.perfil)
        if (-not $resultado.ok) {
            return @{ status = 409; corpo = $resultado }
        }
        return @{ status = 200; corpo = @{ ok = $true } }
    }

    <#
        Abre uma tela na janela do hub.

        `tela` leva direto para a tela pedida; sem ela, cai no login do sistema. Chamar
        o executavel de novo com o mesmo perfil abre uma GUIA, nao outra janela — o
        usuario segue usando o navegador normalmente, com as guias que quiser.
    #>
    if ($Metodo -eq 'POST' -and $acao -eq 'abrir') {
        $tela = if ($dados) { [string] $dados.tela } else { '' }
        $url = if ($tela) { Resolver-UrlTela -Tela $tela } else { $UrlLogin[$sistema] }
        if (-not $url) {
            return @{ status = 400; corpo = @{ ok = $false; erro = "tela desconhecida: $tela" } }
        }

        $marca = if ($dados) { [string] $dados.navegador } else { '' }
        $resultado = Abrir-NoNavegador -Url $url -Marca $marca
        if (-not $resultado.ok) {
            return @{ status = 502; corpo = @{ ok = $false; erro = $resultado.erro } }
        }
        return @{ status = 200; corpo = @{ ok = $true; url = $url } }
    }

    if ($Metodo -eq 'POST' -and $acao -eq 'capturar') {
        if (-not (Test-CdpNoAr)) {
            return @{ status = 409; corpo = @{ ok = $false; erro = 'o navegador do hub não está aberto — use "Entrar pelo navegador" primeiro' } }
        }

        try {
            $cookies = Obter-Cookies -Dominios $DominiosSistema[$sistema]
            $token = ''
            $expira = ''
            if ($TokenSistema.ContainsKey($sistema)) {
                $onde = $TokenSistema[$sistema]
                $token = Obter-TokenDaPagina -UrlContem $onde.url -Chave $onde.chave
                if ($token) { $expira = Obter-ExpiracaoJwt -Token $token }
            }
        }
        catch {
            return @{ status = 502; corpo = @{ ok = $false; erro = "falha lendo a sessão: $($_.Exception.Message)" } }
        }

        # Ausencia do token e o unico teste honesto de "esta logado": cookie anonimo
        # existe antes do login e daria um falso positivo.
        if ($TokenSistema.ContainsKey($sistema) -and -not $token) {
            return @{ status = 200; corpo = @{
                ok  = $false
                erro = 'a janela não está logada nesse sistema — faça o login nela e capture de novo'
            } }
        }

        if (-not $TokenSistema.ContainsKey($sistema) -and -not $cookies.Count) {
            return @{ status = 200; corpo = @{ ok = $false; erro = 'nenhum cookie desse domínio no navegador — faça o login na janela aberta antes de capturar' } }
        }

        # Cifrados com DPAPI no mesmo cofre da senha: enquanto nao expiram, valem tanto
        # quanto ela. A expiracao fica em claro — e data, nao credencial, e a tela mostra.
        $cofre = Ler-Cofre
        $entrada = $cofre[$sistema]
        $cabecalho = (($cookies | ForEach-Object { "$($_.name)=$($_.value)" }) -join '; ')

        $cofre[$sistema] = @{
            usuario = if ($entrada) { $entrada.usuario } else { '' }
            senha   = if ($entrada) { $entrada.senha } else { '' }
            sessao  = if ($cookies.Count) { Proteger-Texto $cabecalho } else { '' }
            token   = if ($token) { Proteger-Texto $token } else { '' }
            expira  = $expira
        }
        Gravar-Cofre $cofre

        return @{ status = 200; corpo = @{ ok = $true; cookies = $cookies.Count; token = [bool] $token; expira = $expira } }
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = "rota desconhecida: $Metodo /$($Segmentos -join '/')" } }
}

# --- navegacao de pastas -----------------------------------------------------

<#
    Lista PASTAS de um caminho, para a tela de cadastro escolher o repositorio local.

    Existe porque o hub roda num container Linux e nao enxerga o disco do Windows —
    quem ve e este helper. So diretorios, nunca arquivos: a tela precisa escolher uma
    pasta, e listar conteudo de arquivo nao ajudaria em nada e exporia mais.
#>
function Get-Pastas {
    param([string] $Caminho)

    # Sem caminho, as unidades: e por onde a navegacao comeca.
    if (-not $Caminho) {
        $unidades = Get-PSDrive -PSProvider FileSystem -ErrorAction SilentlyContinue |
            ForEach-Object { @{ nome = "$($_.Name):"; caminho = "$($_.Name):\"; git = $false } }
        return @{ ok = $true; atual = ''; pai = ''; pastas = @($unidades) }
    }

    if (-not (Test-Path -LiteralPath $Caminho -PathType Container)) {
        return @{ ok = $false; erro = "pasta não encontrada: $Caminho" }
    }

    $filhas = @()
    try {
        # `-Force` mostra pasta oculta; sem ele um repositorio dentro de pasta oculta
        # ficaria invisivel e o usuario acharia que sumiu.
        foreach ($p in Get-ChildItem -LiteralPath $Caminho -Directory -Force -ErrorAction SilentlyContinue) {
            $filhas += @{
                nome    = $p.Name
                caminho = $p.FullName
                # Marcar o que e repositorio poupa o usuario de entrar para descobrir.
                git     = (Test-Path -LiteralPath (Join-Path $p.FullName '.git'))
            }
        }
    }
    catch {
        return @{ ok = $false; erro = "não consegui ler a pasta: $($_.Exception.Message)" }
    }

    $pai = Split-Path -Parent $Caminho
    return @{
        ok     = $true
        atual  = $Caminho
        # Vazio no topo de uma unidade: dali o "voltar" leva para a lista de unidades.
        pai    = if ($pai) { $pai } else { '' }
        git    = (Test-Path -LiteralPath (Join-Path $Caminho '.git'))
        pastas = @($filhas)
    }
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

<#
    Empacota o resultado de uma acao de escrita (commit/push/sync/mr) pra resposta HTTP.

    `Invoke-GitAutosync` devolve `{ok, codigo, saida}`, sem campo `erro` — o helper.ts do
    lado do container so mostra `corpo.erro` quando a chamada falha, entao sem isto o
    motivo do push (branch protegida, remoto inacessivel, etc.) ficava preso em `saida`
    e a tela caia no generico "helper respondeu HTTP 502".
#>
function Enviar-ResultadoAcao {
    param([hashtable] $Resultado)

    if ($Resultado.ok) {
        return @{ status = 200; corpo = $Resultado }
    }
    return @{ status = 502; corpo = ($Resultado + @{ erro = $Resultado.saida }) }
}

<#
    Qual terminal abrir na pasta do repositorio.

    Com `-Preferido` ('cmd' ou 'git-bash'), resolve só aquele — é a escolha explícita
    feita na tela (dois ícones, CMD e Git Bash), sem cascata escondida. Sem preferência,
    mantém o comportamento antigo (Windows Terminal > Git Bash > PowerShell), preservado
    só para quem ainda chamar esta função sem dizer qual quer.
#>
<#
    Caminho do git-bash.exe, ou vazio se não achar.

    Cobre instalação por máquina (`Program Files`) e por usuário (`%LOCALAPPDATA%` —
    o instalador do Git for Windows oferece as duas opções, e a segunda é o padrão de
    quem instala sem ser administrador).
#>
function Resolver-GitBash {
    return @(
        (Join-Path $env:ProgramFiles 'Git\git-bash.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Git\git-bash.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\git-bash.exe')
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

function Resolver-Terminal {
    param([string] $Preferido = '')

    if ($Preferido -eq 'cmd') {
        return @{ exe = (Join-Path $env:WINDIR 'System32\cmd.exe'); tipo = 'cmd' }
    }
    if ($Preferido -eq 'git-bash') {
        $gitBash = Resolver-GitBash
        return $(if ($gitBash) { @{ exe = $gitBash; tipo = 'git-bash' } } else { $null })
    }

    $wt = Get-Command 'wt.exe' -ErrorAction SilentlyContinue
    if ($wt) { return @{ exe = $wt.Source; tipo = 'wt' } }

    $gitBash = Resolver-GitBash
    if ($gitBash) { return @{ exe = $gitBash; tipo = 'git-bash' } }

    return @{ exe = 'powershell.exe'; tipo = 'powershell' }
}

function Abrir-Terminal {
    param([string] $Caminho, [string] $Tipo = '')

    if (-not (Test-Path -LiteralPath $Caminho -PathType Container)) {
        return @{ ok = $false; erro = "pasta não encontrada: $Caminho" }
    }

    $terminal = Resolver-Terminal -Preferido $Tipo
    if (-not $terminal) {
        return @{ ok = $false; erro = 'Git Bash não encontrado nesta máquina' }
    }
    try {
        if ($terminal.tipo -eq 'wt') {
            Start-Process -FilePath $terminal.exe -ArgumentList @('-d', $Caminho)
        }
        else {
            Start-Process -FilePath $terminal.exe -WorkingDirectory $Caminho
        }
        return @{ ok = $true; saida = "terminal ($($terminal.tipo)) aberto em $Caminho" }
    }
    catch {
        return @{ ok = $false; erro = "não consegui abrir o terminal: $($_.Exception.Message)" }
    }
}

function Invoke-RotaGitAutosync {
    param([string] $Metodo, [string[]] $Segmentos, [hashtable] $Query, [string] $Corpo)

    $acao = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { '' }

    try { $dados = if ($Corpo) { $Corpo | ConvertFrom-Json } else { $null } } catch { $dados = $null }
    $caminho = if ($dados) { [string] $dados.caminho } else { '' }

    # Toda acao que mexe num repositorio exige o caminho: sem `--repo`, o CLI opera
    # sobre o diretorio atual (que aqui e a pasta do helper), commitando o repo errado.
    $exigeCaminho = @('repos', 'commit', 'push', 'sync', 'mr', 'include', 'exclude', 'terminal')
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
            return Enviar-ResultadoAcao $resultado
        }

        'POST push' {
            $resultado = Invoke-GitAutosync -Argumentos @('push', '--repo', $caminho)
            return Enviar-ResultadoAcao $resultado
        }

        'POST sync' {
            $argumentos = @('sync', '--repo', $caminho)
            if ($dados.mensagem) { $argumentos += @('--message', [string] $dados.mensagem) }
            $resultado = Invoke-GitAutosync -Argumentos $argumentos
            return Enviar-ResultadoAcao $resultado
        }

        'POST mr' {
            $argumentos = @('mr', '--repo', $caminho)
            if ($dados.titulo) { $argumentos += @('--title', [string] $dados.titulo) }
            if ($dados.target) { $argumentos += @('--target', [string] $dados.target) }
            if ($dados.source) { $argumentos += @('--source', [string] $dados.source) }
            $resultado = Invoke-GitAutosync -Argumentos $argumentos
            return Enviar-ResultadoAcao $resultado
        }

        <#
            Abre um terminal na pasta do repositorio, pronto pra resolver o que o hub nao
            resolve sozinho (conflito, remoto trocado, credencial expirada). Nao passa
            pelo `Invoke-GitAutosync`: nao chama o CLI, so abre um processo na pasta.
        #>
        'POST terminal' {
            $tipo = if ($dados -and $dados.tipo) { [string] $dados.tipo } else { '' }
            $resultado = Abrir-Terminal -Caminho $caminho -Tipo $tipo
            return @{ status = $(if ($resultado.ok) { 200 } else { 400 }); corpo = $resultado }
        }

        <#
            Ultimas linhas do `autosync.log`, que o CLI vai gravando a cada rodada
            agendada (`write_log` em `autosync_core.py`) — texto simples, uma linha por
            evento, sem relacao com o `git log` de `historico()`.
        #>
        'GET log' {
            $arquivo = Join-Path $env:USERPROFILE '.git-autosync\autosync.log'
            if (-not (Test-Path -LiteralPath $arquivo)) {
                return @{ status = 200; corpo = @{ ok = $true; dados = @() } }
            }

            $limite = 200
            if ($Query['limite']) { [void][int]::TryParse($Query['limite'], [ref] $limite) }

            <#
                `Get-Content -Tail` sem console anexado (o helper roda `-WindowStyle
                Hidden`) travava aqui indefinidamente — o processo vivo, mas preso, sem
                nunca voltar ao `AcceptTcpClient()` do loop principal. `File.ReadAllLines`
                nao depende de host de console nenhum.
            #>
            try {
                $todas = [System.IO.File]::ReadAllLines($arquivo, [System.Text.Encoding]::UTF8)
                # `0..-1` (arquivo vazio) contaria pra tras em PowerShell e indexaria o
                # array errado — caso especial em vez de deixar o range decidir sozinho.
                if ($todas.Length -eq 0) {
                    return @{ status = 200; corpo = @{ ok = $true; dados = @() } }
                }
                $inicio = [Math]::Max(0, $todas.Length - $limite)
                $linhas = @($todas[$inicio..($todas.Length - 1)])
                return @{ status = 200; corpo = @{ ok = $true; dados = $linhas } }
            }
            catch {
                return @{ status = 502; corpo = @{ ok = $false; erro = "autosync.log ilegível: $($_.Exception.Message)" } }
            }
        }

        <#
            Quem escreve a mensagem do commit automatico.

            Com a IA desligada o CLI nao chega a gerar nada: cai direto no texto fixo
            `chore: auto-commit <data hora>`. Ligar manda o diff staged para o agente
            escolhido, que roda na maquina do usuario — e e por isso que e uma escolha
            explicita, feita na tela, e nao um padrao.
        #>
        <#
            As tarefas do Agendador do Windows criadas pelo `install`.

            Lidas do proprio Agendador, e nao do `doctor`: o doctor percorre todos os
            repositorios configurados (git remote, branch) e leva segundos, enquanto a
            tela so precisa saber se a tarefa existe e quando ela roda de novo. Prefixo
            `GitAutoSync` porque e o que o CLI usa ao criar.
        #>
        'GET tarefas' {
            try {
                $tarefas = @(
                    Get-ScheduledTask -ErrorAction Stop |
                        Where-Object { $_.TaskName -like 'GitAutoSync*' } |
                        ForEach-Object {
                            $info = $null
                            try { $info = $_ | Get-ScheduledTaskInfo -ErrorAction Stop } catch { }
                            @{
                                nome = [string] $_.TaskName
                                estado = [string] $_.State
                                proximaExecucao = if ($info -and $info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
                                ultimaExecucao = if ($info -and $info.LastRunTime) { $info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
                                # [long] e nao [int]: o Agendador devolve HRESULT como 32 bits SEM
                                # sinal (2147946720, por exemplo), que estoura Int32 e derruba a rota.
                                ultimoResultado = if ($info) { [long] $info.LastTaskResult } else { $null }
                            }
                        }
                )
                return @{ status = 200; corpo = @{ ok = $true; dados = $tarefas } }
            }
            catch {
                return @{ status = 502; corpo = @{ ok = $false; erro = "não consegui ler o Agendador: $($_.Exception.Message)" } }
            }
        }

        <#
            Horarios do agendamento. O CLI recebe uma lista separada por virgula e
            reescreve `schedules` na config; `set-schedule` ja reinstala a tarefa do
            Windows com o gatilho novo (verificado em autosync_core.install_schedule),
            entao o botao de instalar so serve para quando nao ha tarefa nenhuma ou para
            recriar uma removida por fora.
        #>
        'POST agendamento' {
            $horarios = @($dados.horarios | ForEach-Object { [string] $_ })
            # O CLI nao tem "sem horario": `set-schedule ""` sai com erro de argumento
            # obrigatorio. Quem quer parar o automatico desinstala a tarefa.
            if ($horarios.Count -eq 0) {
                return @{ status = 400; corpo = @{ ok = $false; erro = 'informe ao menos um horário — para parar o automático, remova a tarefa do Agendador' } }
            }
            foreach ($horario in $horarios) {
                if ($horario -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') {
                    return @{ status = 400; corpo = @{ ok = $false; erro = "horário inválido: $horario — use HH:MM" } }
                }
            }

            $resultado = Invoke-GitAutosync -Argumentos @('set-schedule', ($horarios -join ','))
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        <# Cria (ou recria) a tarefa no Agendador a partir dos horarios da config. #>
        'POST instalar' {
            $resultado = Invoke-GitAutosync -Argumentos @('install')
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        <# Remove a tarefa do Agendador. A config e os repositorios ficam como estao. #>
        'POST desinstalar' {
            $resultado = Invoke-GitAutosync -Argumentos @('uninstall')
            return @{ status = $(if ($resultado.ok) { 200 } else { 502 }); corpo = $resultado }
        }

        'POST ia' {
            $ligada = [bool] $dados.ligada
            $agente = if ($dados.agente) { [string] $dados.agente } else { '' }

            if ($agente -and $agente -notin @('auto', 'claude', 'codex', 'opencode')) {
                return @{ status = 400; corpo = @{ ok = $false; erro = "agente inválido: $agente" } }
            }

            $resultado = Invoke-GitAutosync -Argumentos @('set-ai', $(if ($ligada) { 'on' } else { 'off' }))
            if (-not $resultado.ok) {
                return @{ status = 502; corpo = $resultado }
            }
            if ($agente) {
                $resultado = Invoke-GitAutosync -Argumentos @('set-agent', $agente)
                if (-not $resultado.ok) {
                    return @{ status = 502; corpo = $resultado }
                }
            }

            return @{ status = 200; corpo = @{ ok = $true; ligada = $ligada; agente = $agente } }
        }
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = "rota desconhecida: $Metodo /$($Segmentos -join '/')" } }
}

# --- HTTP --------------------------------------------------------------------

<#
    Decodifica um pedaco de query string.

    O `+` vira espaco ANTES do unescape, e nao depois: em query string ele significa
    espaco (o `URLSearchParams` do navegador codifica assim), e `UnescapeDataString`
    sozinho o deixaria literal — "Profile 1" chegaria como "Profile+1" e nenhum perfil
    casaria. A ordem importa: desfazer o unescape primeiro faria um `%2B`, que e um mais
    de verdade, virar espaco por engano.
#>
function Expandir-ValorDeQuery {
    param([string] $Bruto)
    return [System.Uri]::UnescapeDataString($Bruto.Replace('+', ' '))
}

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
                $nome = Expandir-ValorDeQuery $par.Substring(0, $igual)
                $query[$nome] = Expandir-ValorDeQuery $par.Substring($igual + 1)
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
            return @{ status = 200; corpo = @{
                ok      = $true
                usuario = $entrada.usuario
                senha   = if ($entrada.senha) { Desproteger-Texto $entrada.senha } else { '' }
                sessao  = if ($entrada.sessao) { Desproteger-Texto $entrada.sessao } else { '' }
                token   = if ($entrada.token) { Desproteger-Texto $entrada.token } else { '' }
                expira  = [string] $entrada.expira
            } }
        }
        catch {
            # Blob de outro usuario/maquina ou perfil recriado: o DPAPI nao volta atras.
            return @{ status = 500; corpo = @{ ok = $false; erro = 'não consegui decriptar — regrave a credencial neste usuário do Windows' } }
        }
    }

    if ($Metodo -eq 'GET' -and -not $acao) {
        return @{ status = 200; corpo = @{
            ok              = $true
            usuario         = if ($entrada) { $entrada.usuario } else { '' }
            definido        = [bool] ($entrada -and $entrada.senha)
            # Para a Experience o que vale e o token; para o ERP legado, o cookie.
            sessaoCapturada = [bool] ($entrada -and ($entrada.token -or $entrada.sessao))
            sessaoExpiraEm  = if ($entrada) { [string] $entrada.expira } else { '' }
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

        # A sessao ja capturada sobrevive a uma troca de senha: sao credenciais
        # independentes, e invalidar a sessao aqui desconectaria o hub sem motivo.
        $cofre[$sistema] = @{
            usuario = $usuario
            senha   = (Proteger-Texto $senha)
            sessao  = if ($entrada) { $entrada.sessao } else { '' }
            token   = if ($entrada) { $entrada.token } else { '' }
            expira  = if ($entrada) { $entrada.expira } else { '' }
        }
        Gravar-Cofre $cofre
        return @{ status = 200; corpo = @{
            ok              = $true
            usuario         = $usuario
            definido        = $true
            sessaoCapturada = [bool] ($entrada -and ($entrada.token -or $entrada.sessao))
            sessaoExpiraEm  = if ($entrada) { [string] $entrada.expira } else { '' }
        } }
    }

    if ($Metodo -eq 'DELETE' -and -not $acao) {
        $cofre.Remove($sistema)
        Gravar-Cofre $cofre
        return @{ status = 200; corpo = @{ ok = $true; usuario = ''; definido = $false } }
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = "rota desconhecida: $Metodo /$($Segmentos -join '/')" } }
}

<#
.SYNOPSIS
    Caminhos do WildFly local, compartilhados entre o hub e os helpers do WildFly.

.DESCRIPTION
    A pasta do WildFly e o server.log eram parametro com valor fixo nos scripts, entao
    trocar de instalacao exigia editar arquivo. Agora moram num JSON que o hub escreve
    pela tela e que os helpers releem a cada chamada — mudar o caminho nao pede reinicio
    de nada.

    Mora ao lado do cofre, em %APPDATA%\sankhya-hub, e nao no repositorio: e config
    DESTA maquina, e o repositorio e o mesmo em varias.
#>
$ArquivoWildfly = Join-Path $env:APPDATA 'sankhya-hub\wildfly.json'

function Ler-ConfigWildfly {
    if (-not (Test-Path -LiteralPath $ArquivoWildfly)) {
        return @{ pasta = ''; arquivoLog = '' }
    }
    try {
        $dados = Get-Content -LiteralPath $ArquivoWildfly -Raw -Encoding UTF8 | ConvertFrom-Json
        return @{
            pasta      = [string] $dados.pasta
            arquivoLog = [string] $dados.arquivoLog
        }
    }
    catch {
        # Arquivo corrompido nao pode derrubar o helper: some com a config e segue com
        # os padroes, que e o mesmo estado de quem nunca configurou.
        return @{ pasta = ''; arquivoLog = '' }
    }
}

<#
.SYNOPSIS
    Procura instalacoes do WildFly no disco.

.DESCRIPTION
    Uma pasta e um WildFly quando tem `bin\standalone.bat`. A varredura fica nos lugares
    onde essas instalacoes costumam estar e desce poucos niveis: varrer o disco inteiro
    levaria minutos e a tela espera resposta.
#>
function Find-Wildfly {
    $raizes = @('C:\', 'C:\Sankhya', 'D:\', 'D:\Sankhya') |
        Where-Object { Test-Path -LiteralPath $_ }

    $achados = @()
    foreach ($raiz in $raizes) {
        foreach ($pasta in Get-ChildItem -LiteralPath $raiz -Directory -Force -ErrorAction SilentlyContinue) {
            $bin = Join-Path $pasta.FullName 'bin\standalone.bat'
            if (-not (Test-Path -LiteralPath $bin)) { continue }

            $log = Join-Path $pasta.FullName 'standalone\log\server.log'
            $achados += @{
                pasta      = $pasta.FullName
                arquivoLog = $(if (Test-Path -LiteralPath $log) { $log } else { '' })
            }
        }
    }

    # Mesma instalacao alcancavel por dois caminhos (C:\ e C:\Sankhya) apareceria duas
    # vezes; a tela mostraria duas opcoes que fazem a mesma coisa.
    $unicos = @()
    $vistos = @{}
    foreach ($a in $achados) {
        $chave = $a.pasta.ToLowerInvariant()
        if (-not $vistos.ContainsKey($chave)) {
            $vistos[$chave] = $true
            $unicos += $a
        }
    }
    return $unicos
}

function Invoke-RotaWildfly {
    param([string] $Metodo, [string[]] $Segmentos, [string] $Corpo)

    $acao = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { 'config' }

    if ($Metodo -eq 'GET' -and $acao -eq 'detectar') {
        return @{ status = 200; corpo = @{ ok = $true; instalacoes = @(Find-Wildfly) } }
    }

    if ($Metodo -eq 'GET' -and $acao -eq 'config') {
        $config = Ler-ConfigWildfly
        return @{ status = 200; corpo = @{
            ok            = $true
            pasta         = $config.pasta
            arquivoLog    = $config.arquivoLog
            # A tela avisa ANTES de salvar um caminho que nao existe: descobrir isso
            # so quando o Iniciar falha manda procurar defeito no lugar errado.
            pastaExiste   = [bool] ($config.pasta -and (Test-Path -LiteralPath (Join-Path $config.pasta 'bin\standalone.bat')))
            logExiste     = [bool] ($config.arquivoLog -and (Test-Path -LiteralPath $config.arquivoLog))
        } }
    }

    if ($Metodo -eq 'POST' -and $acao -eq 'config') {
        try { $dados = $Corpo | ConvertFrom-Json } catch { $dados = $null }
        $pasta = ([string] $dados.pasta).Trim()
        $log = ([string] $dados.arquivoLog).Trim()

        if ($pasta -and -not (Test-Path -LiteralPath (Join-Path $pasta 'bin\standalone.bat'))) {
            return @{ status = 400; corpo = @{ ok = $false; erro = "não achei bin\standalone.bat em $pasta — essa pasta não é uma instalação do WildFly" } }
        }

        # Log em branco com pasta preenchida: o caminho padrao da instalacao e o palpite
        # certo em 100% dos casos vistos, e poupa o usuario de digitar duas vezes.
        if ($pasta -and -not $log) {
            $log = Join-Path $pasta 'standalone\log\server.log'
        }

        $destino = Split-Path -Parent $ArquivoWildfly
        if (-not (Test-Path -LiteralPath $destino)) {
            New-Item -ItemType Directory -Path $destino -Force | Out-Null
        }
        @{ pasta = $pasta; arquivoLog = $log } | ConvertTo-Json |
            Set-Content -LiteralPath $ArquivoWildfly -Encoding UTF8

        return Invoke-RotaWildfly -Metodo 'GET' -Segmentos @('wildfly', 'config') -Corpo ''
    }

    return @{ status = 404; corpo = @{ ok = $false; erro = 'use GET/POST /wildfly/config ou GET /wildfly/detectar' } }
}

<#
.SYNOPSIS
    Cifra e decifra um texto qualquer com DPAPI, para o hub guardar segredo que nao e
    credencial de sistema.

.DESCRIPTION
    As senhas das bases dos clientes nao cabem no cofre por sistema: sao N por cliente e
    o hub e quem sabe a qual base cada uma pertence. Aqui o helper so empresta o DPAPI —
    o blob volta para o hub, que guarda no SQLite dele.

    O blob so abre neste usuario do Windows, e a rota exige o mesmo token das demais.
    Quem conseguisse chamar isto ja conseguiria ler o cofre inteiro pelo /credentials.
#>
function Invoke-RotaSegredo {
    param([string] $Metodo, [string[]] $Segmentos, [string] $Corpo)

    $acao = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { '' }
    if ($Metodo -ne 'POST' -or ($acao -ne 'encrypt' -and $acao -ne 'decrypt')) {
        return @{ status = 404; corpo = @{ ok = $false; erro = 'use POST /secret/encrypt ou /secret/decrypt' } }
    }

    try { $dados = $Corpo | ConvertFrom-Json } catch { $dados = $null }
    $valor = [string] $dados.valor
    if (-not $valor) {
        return @{ status = 400; corpo = @{ ok = $false; erro = 'envie { valor }' } }
    }

    try {
        $resultado = if ($acao -eq 'encrypt') { Proteger-Texto $valor } else { Desproteger-Texto $valor }
        return @{ status = 200; corpo = @{ ok = $true; valor = $resultado } }
    }
    catch {
        # Blob de outro usuario/maquina ou perfil recriado: o DPAPI nao volta atras.
        return @{ status = 500; corpo = @{ ok = $false; erro = 'não consegui decriptar — regrave a senha neste usuário do Windows' } }
    }
}

# --- ia (resumo de commits/diff por agente local, para o e-mail de evidencia) -----
#
# Nao faz parte do git-autosync (CLI externo, outro projeto/release) — e um uso direto
# dos CLIs de IA que ja rodam nesta maquina (claude/codex/opencode), no MESMO desenho de
# seguranca que o git-autosync ja usa para a mensagem de commit: o diff vai embutido no
# prompt (nunca "va ler o repo sozinho") e o agente roda com cwd num diretorio temporario
# VAZIO, nunca no repositorio de verdade. Ver
# scripts\git-autosync\python\autosync_core.py:324-438 no repo irmao, que e o desenho
# original sendo replicado aqui.

$script:AgentesIA = @('claude', 'codex', 'opencode')
$script:OpencodeAgenteSeguro = 'hub-somente-leitura'

<#
    Roda um processo com entrada por stdin e timeout de verdade (mata se estourar).

    Usa arquivos, nao pipes ao vivo, para stdin/stdout/stderr: escrever no stdin e ler o
    stdout ao mesmo tempo por pipe .NET tem risco conhecido de deadlock quando a saida e
    grande, e um job em segundo plano (a outra alternativa) roda sem console nenhum
    associado — testado na pratica: o Node do codex recusa com "stdin is not a
    terminal" nesse cenario. Arquivo evita os dois problemas.

    `$Executavel` deve ser um EXE de verdade, nunca um shim `.cmd`/`.ps1` do npm:
    `Start-Process` so sabe iniciar EXE (o erro e "%1 nao e um aplicativo Win32
    valido" nos outros dois) — por isso os `Invoke-Prompt*` abaixo resolvem o
    interpretador/entry point real antes de chamar isto, mesmo principio de
    `Resolver-GitAutosync` (chamar python.exe + app.py, nao o .bat).
#>
function Invoke-ProcessoComEntrada {
    param(
        [string] $Executavel,
        [string[]] $Argumentos,
        [string] $Entrada,
        [string] $DiretorioTrabalho,
        [int] $TimeoutSegundos = 120
    )

    $arquivoEntrada = [System.IO.Path]::GetTempFileName()
    $arquivoSaida = [System.IO.Path]::GetTempFileName()
    $arquivoErro = [System.IO.Path]::GetTempFileName()
    try {
        [System.IO.File]::WriteAllText($arquivoEntrada, $Entrada, (New-Object System.Text.UTF8Encoding($false)))

        $processo = Start-Process -FilePath $Executavel -ArgumentList $Argumentos `
            -WorkingDirectory $DiretorioTrabalho `
            -RedirectStandardInput $arquivoEntrada `
            -RedirectStandardOutput $arquivoSaida `
            -RedirectStandardError $arquivoErro `
            -NoNewWindow -PassThru

        $terminou = $processo.WaitForExit($TimeoutSegundos * 1000)
        if (-not $terminou) {
            try { Stop-Process -Id $processo.Id -Force -ErrorAction SilentlyContinue } catch {}
            return @{ ok = $false; saida = '' }
        }

        $saida = Get-Content -LiteralPath $arquivoSaida -Raw -ErrorAction SilentlyContinue
        return @{ ok = ($processo.ExitCode -eq 0); saida = $saida }
    }
    finally {
        Remove-Item -LiteralPath $arquivoEntrada, $arquivoSaida, $arquivoErro -ErrorAction SilentlyContinue
    }
}

function Invoke-PromptClaude {
    param([string] $Prompt, [string] $Cwd)
    $cmd = Get-Command 'claude' -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    $resultado = Invoke-ProcessoComEntrada -Executavel $cmd.Source -DiretorioTrabalho $Cwd -Entrada $Prompt `
        -Argumentos @('-p', '--output-format', 'text', '--disallowedTools',
            'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch')
    if (-not $resultado.ok) { return $null }
    $texto = ([string] $resultado.saida).Trim()
    return $(if ($texto) { $texto } else { $null })
}

function Resolver-NodeExe {
    $node = Get-Command 'node' -ErrorAction SilentlyContinue
    return $(if ($node) { $node.Source } else { $null })
}

<#
    `codex` no Windows e instalado via npm como shim (`.cmd`/`.ps1`), nunca EXE —
    confirmado lendo `codex.cmd`: ele so encaminha para
    `<pasta-do-shim>\node_modules\@openai\codex\bin\codex.js`, rodado com `node.exe`.
    Chamar isso direto evita reproduzir cmd.exe/powershell.exe por cima do shim (que na
    pratica devolveu erro de binding de argumento tentando `-File`), mesmo principio de
    `Resolver-GitAutosync`. A saida vem de arquivo (`-o`), nao do stdout.
#>
function Invoke-PromptCodex {
    param([string] $Prompt, [string] $Cwd)
    $cmd = Get-Command 'codex' -ErrorAction SilentlyContinue
    $node = Resolver-NodeExe
    if (-not $cmd -or -not $node) { return $null }

    $entryJs = Join-Path (Split-Path -Parent $cmd.Source) 'node_modules\@openai\codex\bin\codex.js'
    if (-not (Test-Path -LiteralPath $entryJs)) { return $null }

    $arquivoSaida = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString('N') + '.txt')
    try {
        Invoke-ProcessoComEntrada -Executavel $node -DiretorioTrabalho $Cwd -Entrada $Prompt `
            -Argumentos @($entryJs, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', $Cwd, '-o', $arquivoSaida, '-') `
        | Out-Null
        if (-not (Test-Path -LiteralPath $arquivoSaida)) { return $null }
        $texto = Get-Content -LiteralPath $arquivoSaida -Raw -ErrorAction SilentlyContinue
        return $(if ($texto -and $texto.Trim()) { $texto.Trim() } else { $null })
    }
    finally {
        Remove-Item -LiteralPath $arquivoSaida -ErrorAction SilentlyContinue
    }
}

<#
    Garante, so por complemento (merge, nunca sobrescreve o resto do arquivo), um agente
    OpenCode sem write/edit/bash/webfetch — mesmo motivo do git-autosync: gerar texto a
    partir de um prompt nao deveria nunca poder mexer em arquivo ou rodar comando.

    Sem `-AsHashtable`: este helper roda em Windows PowerShell 5.1 (exigido pelo DPAPI —
    ver `Proteger-Texto`), onde `ConvertFrom-Json` so devolve PSCustomObject.
#>
function Garantir-AgenteOpencodeSeguro {
    $caminhoCfg = Join-Path $env:USERPROFILE '.config\opencode\opencode.json'
    try {
        New-Item -ItemType Directory -Path (Split-Path -Parent $caminhoCfg) -Force -ErrorAction SilentlyContinue |
            Out-Null

        $dados = $null
        if (Test-Path -LiteralPath $caminhoCfg) {
            try { $dados = Get-Content -LiteralPath $caminhoCfg -Raw | ConvertFrom-Json -ErrorAction Stop }
            catch { $dados = $null }
        }
        if (-not $dados) { $dados = [PSCustomObject]@{} }

        if (-not ($dados.PSObject.Properties.Name -contains 'agent')) {
            $dados | Add-Member -NotePropertyName 'agent' -NotePropertyValue ([PSCustomObject]@{})
        }
        if (-not ($dados.agent.PSObject.Properties.Name -contains $script:OpencodeAgenteSeguro)) {
            $agenteSeguro = [PSCustomObject]@{
                description = 'Gera texto a partir de um prompt, sem tocar em arquivos nem rodar comandos (usado pelo sankhya-hub).'
                permission  = [PSCustomObject]@{ write = 'deny'; edit = 'deny'; bash = 'deny'; webfetch = 'deny' }
            }
            $dados.agent | Add-Member -NotePropertyName $script:OpencodeAgenteSeguro -NotePropertyValue $agenteSeguro
            ($dados | ConvertTo-Json -Depth 10) | Set-Content -LiteralPath $caminhoCfg -Encoding utf8
        }
    }
    catch {}
}

function Invoke-PromptOpencode {
    param([string] $Prompt, [string] $Cwd)
    $cmd = Get-Command 'opencode' -ErrorAction SilentlyContinue
    if (-not $cmd) { return $null }
    Garantir-AgenteOpencodeSeguro

    # `opencode` tambem instala como shim (`.cmd`/`.ps1`) — mas o binario real e um EXE
    # proprio, `node_modules\opencode-ai\bin\opencode.exe` (confirmado lendo o shim),
    # sem precisar de `node.exe` por cima.
    $exeReal = Join-Path (Split-Path -Parent $cmd.Source) 'node_modules\opencode-ai\bin\opencode.exe'
    if (-not (Test-Path -LiteralPath $exeReal)) { $exeReal = $cmd.Source }

    $resultado = Invoke-ProcessoComEntrada -Executavel $exeReal -DiretorioTrabalho $Cwd -Entrada $Prompt `
        -Argumentos @('run', '--dir', $Cwd, '--agent', $script:OpencodeAgenteSeguro, '--format', 'json')
    if (-not $resultado.ok) { return $null }

    $texto = $null
    foreach ($linha in (([string] $resultado.saida) -split "`r?`n")) {
        $linha = $linha.Trim()
        if (-not $linha) { continue }
        try {
            $evento = $linha | ConvertFrom-Json -ErrorAction Stop
            if ($evento.type -eq 'text' -and $evento.part -and $evento.part.text) { $texto = $evento.part.text }
        }
        catch {}
    }
    return $(if ($texto -and $texto.Trim()) { $texto.Trim() } else { $null })
}

function Invoke-PromptAgente {
    param([string] $Agente, [string] $Prompt, [string] $Cwd)
    switch ($Agente) {
        'claude' { return Invoke-PromptClaude -Prompt $Prompt -Cwd $Cwd }
        'codex' { return Invoke-PromptCodex -Prompt $Prompt -Cwd $Cwd }
        'opencode' { return Invoke-PromptOpencode -Prompt $Prompt -Cwd $Cwd }
        default { return $null }
    }
}

<# Explicito (se instalado) ou o primeiro disponivel, mesma ordem do git-autosync. #>
function Resolver-AgenteIA {
    param([string] $Preferido)

    if ($Preferido -and $Preferido -ne 'auto') {
        if (Get-Command $Preferido -ErrorAction SilentlyContinue) { return $Preferido }
        return $null
    }
    foreach ($nome in $script:AgentesIA) {
        if (Get-Command $nome -ErrorAction SilentlyContinue) { return $nome }
    }
    return $null
}

function Construir-PromptEvidencia {
    param([string] $Log, [string] $Diff)

    return (
        "Voce e uma agente deterministica e impessoal, especialista em analisar historico " +
        "de codigo, responsavel por resumir para um CLIENTE NAO TECNICO o que foi entregue " +
        "num periodo, a partir do log de commits e do diff abaixo. Nunca se refere a si " +
        "mesma nem ao usuario, nunca opina sobre arquitetura ou qualidade de codigo fora " +
        "do escopo. Responda somente em portugues do Brasil, em texto plano puro (sem " +
        "markdown, sem crases, sem titulos, sem lista com marcadores).`n`n" +
        "Escreva de 1 a 3 paragrafos corridos descrevendo o que foi entregue, em " +
        "linguagem de negocio (o que mudou para quem usa o sistema), sem jargao tecnico " +
        "de git — nao mencione nome de arquivo, hash de commit nem termos como " +
        "'refactor'/'diff'/'commit'. Nao inclua nada alem do resumo (sem preambulo, sem " +
        "saudacao, sem assinatura).`n`ncommits:`n$Log`n`ndiff:`n$Diff"
    )
}

function Invoke-RotaIA {
    param([string] $Metodo, [string[]] $Segmentos, [string] $Corpo)

    $acao = if ($Segmentos.Length -ge 2) { $Segmentos[1] } else { '' }
    if ("$Metodo $acao" -ne 'POST evidencia') {
        return @{ status = 404; corpo = @{ ok = $false; erro = 'use POST /ia/evidencia' } }
    }

    try { $dados = $Corpo | ConvertFrom-Json } catch { $dados = $null }
    $caminho = if ($dados) { [string] $dados.caminho } else { '' }
    $desde = if ($dados) { [string] $dados.desde } else { '' }
    $ate = if ($dados) { [string] $dados.ate } else { '' }
    $agentePreferido = if ($dados -and $dados.agente) { [string] $dados.agente } else { 'auto' }

    if (-not $caminho -or -not (Test-Path -LiteralPath (Join-Path $caminho '.git'))) {
        return @{ status = 400; corpo = @{ ok = $false; erro = 'caminho inválido — não é um repositório git' } }
    }
    if ($desde -notmatch '^\d{4}-\d{2}-\d{2}$' -or $ate -notmatch '^\d{4}-\d{2}-\d{2}$') {
        return @{ status = 400; corpo = @{ ok = $false; erro = 'envie { desde, ate } em YYYY-MM-DD' } }
    }

    $gitCmd = Get-Command 'git' -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        return @{ status = 500; corpo = @{ ok = $false; erro = 'git não encontrado nesta máquina' } }
    }

    $desdeArg = "--since=$desde 00:00:00"
    $ateArg = "--until=$ate 23:59:59"

    $logBruto = & $gitCmd.Source -C $caminho log $desdeArg $ateArg '--format=%h %ad %s' '--date=short' 2>$null
    $log = ((@($logBruto) | ForEach-Object { [string] $_ }) -join "`n").Trim()
    if (-not $log) {
        return @{ status = 404; corpo = @{ ok = $false; erro = 'nenhum commit no período informado' } }
    }

    # Mesmo limite de `_generate_commit_message` no git-autosync: diff maior que isso
    # estoura o que os agentes locais aceitam bem de entrada.
    $diffBruto = & $gitCmd.Source -C $caminho log $desdeArg $ateArg '-p' '--no-color' '--no-ext-diff' '--no-textconv' 2>$null
    $diff = (@($diffBruto) | ForEach-Object { [string] $_ }) -join "`n"
    if ($diff.Length -gt 12000) { $diff = $diff.Substring(0, 12000) + "`n...(diff truncado)..." }

    $agente = Resolver-AgenteIA -Preferido $agentePreferido
    if (-not $agente) {
        return @{ status = 500; corpo = @{ ok = $false; erro = 'nenhum agente de IA (claude/codex/opencode) disponível nesta máquina' } }
    }

    $prompt = Construir-PromptEvidencia -Log $log -Diff $diff

    # Diretorio isolado e vazio: o prompt ja tem o diff embutido, o agente nunca precisa
    # (nem deveria poder) olhar o repositorio de verdade.
    $isolado = Join-Path ([System.IO.Path]::GetTempPath()) ('hub-ia-' + [System.Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $isolado -Force | Out-Null
    try {
        $texto = Invoke-PromptAgente -Agente $agente -Prompt $prompt -Cwd $isolado
    }
    finally {
        Remove-Item -LiteralPath $isolado -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (-not $texto) {
        return @{ status = 502; corpo = @{ ok = $false; erro = "agente '$agente' não retornou texto" } }
    }
    return @{ status = 200; corpo = @{ ok = $true; texto = $texto } }
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
    if ($segmentos[0] -eq 'secret') {
        return Invoke-RotaSegredo -Metodo $Requisicao.metodo -Segmentos $segmentos -Corpo $Requisicao.corpo
    }
    if ($segmentos[0] -eq 'wildfly') {
        return Invoke-RotaWildfly -Metodo $Requisicao.metodo -Segmentos $segmentos -Corpo $Requisicao.corpo
    }
    if ($segmentos[0] -eq 'pastas') {
        if ($Requisicao.metodo -ne 'GET') {
            return @{ status = 404; corpo = @{ ok = $false; erro = 'use GET' } }
        }
        $caminho = if ($Requisicao.query.ContainsKey('caminho')) { [string] $Requisicao.query['caminho'] } else { '' }
        $resultado = Get-Pastas -Caminho $caminho
        return @{ status = $(if ($resultado.ok) { 200 } else { 404 }); corpo = $resultado }
    }
    if ($segmentos[0] -eq 'browser') {
        return Invoke-RotaNavegador -Metodo $Requisicao.metodo -Segmentos $segmentos `
            -Query $Requisicao.query -Corpo $Requisicao.corpo
    }
    if ($segmentos[0] -eq 'git-autosync') {
        return Invoke-RotaGitAutosync -Metodo $Requisicao.metodo -Segmentos $segmentos `
            -Query $Requisicao.query -Corpo $Requisicao.corpo
    }
    if ($segmentos[0] -eq 'ia') {
        return Invoke-RotaIA -Metodo $Requisicao.metodo -Segmentos $segmentos -Corpo $Requisicao.corpo
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

        # Senha e cookie de sessao nunca entram no log — a janela do helper fica visivel
        # e pode acabar numa captura de tela.
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
