# Instala o HUB SNK para o usuário atual, a partir do pacote descompactado.
#
# Instalação por usuário, sem UAC: tudo vai para dentro do perfil, e nada é
# escrito em Program Files nem no registro da máquina.
#
# Cada pergunta já vem com o valor padrão entre colchetes — Enter aceita.
#
# Uso: instalar-hub-snk.bat (ou pwsh -File instalar-hub-snk.ps1)

$ErrorActionPreference = 'Stop'

$PORTA_PADRAO = '4100'
$HOST_PADRAO = '127.0.0.1'
$REDE_BLOQUEADA = '0'
$REDE_LIBERADA = '1'
$NAVEGADOR_EDGE = 'edge'
$NAVEGADOR_CHROME = 'chrome'
$NAVEGADOR_PADRAO = 'padrao'
$NAVEGADOR_AUTOMATICO = 'auto'
$PORTA_MINIMA = 1
$PORTA_MAXIMA = 65535
$VERSAO_MINIMA_DO_NODE = '22.18'
$NODE_MAIOR_MINIMO = 22
$NODE_MENOR_MINIMO = 18

$HOSTS_DE_LOOPBACK = @('127.0.0.1', '::1', 'localhost')

$pastaDoPacote = Split-Path -Parent $MyInvocation.MyCommand.Path
$pastaDoHubSnk = Join-Path $env:LOCALAPPDATA 'HubSnk'
$arquivoDeConfiguracao = Join-Path $pastaDoHubSnk 'hub-snk.env'
$destinoPadrao = Join-Path $env:LOCALAPPDATA 'Programs\HubSnk'
$dadosPadrao = Join-Path $pastaDoHubSnk 'dados'

# --------------------------------------------------------------------------
# Perguntas

function Perguntar([string]$rotulo, [string]$padrao) {
    $resposta = Read-Host "$rotulo [$padrao]"
    if ([string]::IsNullOrWhiteSpace($resposta)) { return $padrao }
    return $resposta.Trim()
}

# O padrão vai escrito por extenso, e não pela caixa da letra: quem lê [S/n]
# rápido não percebe que a maiúscula é a resposta de quem aperta Enter.
function PerguntarSimOuNao([string]$rotulo, [bool]$padraoSim) {
    $padrao = if ($padraoSim) { 'S' } else { 'N' }
    $resposta = (Read-Host "$rotulo [S/N] (padrão: $padrao)").Trim().ToLowerInvariant()

    if ($resposta -eq '') { return $padraoSim }
    return $resposta.StartsWith('s')
}

# --------------------------------------------------------------------------
# Configuração já gravada
#
# Reinstalar não deve apagar o que foi escolhido antes: os valores gravados
# viram o padrão das perguntas, e Enter mantém tudo como estava.

function LerConfiguracaoGravada {
    $configuracao = @{}

    if (-not (Test-Path -LiteralPath $arquivoDeConfiguracao)) { return $configuracao }

    foreach ($linha in Get-Content -LiteralPath $arquivoDeConfiguracao) {
        $texto = $linha.Trim()
        if ($texto -eq '' -or $texto.StartsWith('#')) { continue }

        $separador = $texto.IndexOf('=')
        if ($separador -lt 1) { continue }

        $configuracao[$texto.Substring(0, $separador).Trim()] = $texto.Substring($separador + 1).Trim()
    }

    return $configuracao
}

# A escolha de navegador das versões anteriores morava num arquivo só dela.
function LerNavegadorDoArquivoAntigo {
    $caminho = Join-Path $pastaDoHubSnk 'navegador.txt'
    if (-not (Test-Path -LiteralPath $caminho)) { return '' }

    return (Get-Content -LiteralPath $caminho -First 1).Trim().ToLowerInvariant()
}

function ValorGravado($configuracao, [string]$chave, [string]$padrao) {
    if ($configuracao.ContainsKey($chave) -and $configuracao[$chave] -ne '') {
        return $configuracao[$chave]
    }
    return $padrao
}

# --------------------------------------------------------------------------
# Os cinco parâmetros

function PerguntarPorta([string]$padrao) {
    while ($true) {
        $resposta = Perguntar 'Porta do servidor (HUB_PORTA)' $padrao
        $porta = 0

        if ([int]::TryParse($resposta, [ref]$porta) -and
            $porta -ge $PORTA_MINIMA -and $porta -le $PORTA_MAXIMA) {
            return "$porta"
        }

        Write-Host "  Informe um inteiro entre $PORTA_MINIMA e $PORTA_MAXIMA." -ForegroundColor Yellow
    }
}

# Escutar fora do loopback abre a API para a rede. Ela não tem autenticação,
# devolve as senhas do cadastro e abre programas da máquina — a liberação é
# pedida de propósito, na cara do usuário, nunca deduzida da resposta anterior.
function PerguntarHost([string]$padrao) {
    $endereco = Perguntar 'Endereço em que o servidor escuta (HUB_HOST)' $padrao

    if ($HOSTS_DE_LOOPBACK -contains $endereco) {
        return @{ Host = $endereco; PermitirRede = $REDE_BLOQUEADA }
    }

    Write-Host ''
    Write-Host "  ATENÇÃO: $endereco expõe o HUB SNK para outras máquinas da rede." -ForegroundColor Red
    Write-Host '  O servidor não tem autenticação, devolve as senhas do cadastro pela API' -ForegroundColor Red
    Write-Host '  e abre programas do seu computador. Quem alcançar a porta faz tudo isso.' -ForegroundColor Red
    Write-Host ''

    if (PerguntarSimOuNao '  Liberar mesmo assim (HUB_PERMITIR_REDE=1)?' $false) {
        return @{ Host = $endereco; PermitirRede = $REDE_LIBERADA }
    }

    Write-Host '  Mantido no loopback.' -ForegroundColor Yellow
    return @{ Host = $HOST_PADRAO; PermitirRede = $REDE_BLOQUEADA }
}

function PerguntarDiretorioDeDados([string]$padrao) {
    $caminho = Perguntar 'Pasta do cadastro (HUB_DADOS_DIR)' $padrao
    return [System.Environment]::ExpandEnvironmentVariables($caminho)
}

function CaminhoDoEdge {
    $candidatos = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    return PrimeiroCaminhoExistente $candidatos
}

function CaminhoDoChrome {
    $candidatos = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    return PrimeiroCaminhoExistente $candidatos
}

function PrimeiroCaminhoExistente($candidatos) {
    foreach ($caminho in $candidatos) {
        if ($caminho -and (Test-Path -LiteralPath $caminho)) { return $caminho }
    }
    return ''
}

# `padrao` abre em aba comum do navegador do sistema; `auto` deixa o launcher
# procurar um Chromium; um nome fixa o navegador da janela. As três formas, e
# esta pergunta, são as mesmas do instalador do Linux e do macOS — só muda a
# lista de navegadores, que sai do que existe em cada sistema.
#
# O padrão da primeira instalação é `padrao`: é a escolha que respeita o que a
# pessoa já usa. Quem prefere a janela sem abas escolhe na hora, e a escolha
# volta como padrão na próxima.
function PerguntarNavegador([string]$padrao) {
    $disponiveis = @($NAVEGADOR_PADRAO, $NAVEGADOR_AUTOMATICO)
    if ((CaminhoDoEdge) -ne '') { $disponiveis += $NAVEGADOR_EDGE }
    if ((CaminhoDoChrome) -ne '') { $disponiveis += $NAVEGADOR_CHROME }

    if ($disponiveis -notcontains $padrao) { $padrao = $NAVEGADOR_PADRAO }

    Write-Host ''
    Write-Host '  A janela do HUB SNK abre sem barra de endereço e sem abas nos navegadores'
    Write-Host "  Chromium. Com '$NAVEGADOR_PADRAO', abre em aba comum do navegador do sistema;"
    Write-Host "  com '$NAVEGADOR_AUTOMATICO', no primeiro Chromium encontrado na máquina."
    Write-Host "  Opções: $($disponiveis -join ', ')"

    while ($true) {
        $resposta = (Perguntar 'Navegador do HUB SNK (HUB_NAVEGADOR)' $padrao).ToLowerInvariant()
        if ($disponiveis -contains $resposta) { return $resposta }

        Write-Host "  Escolha uma das opções: $($disponiveis -join ', ')." -ForegroundColor Yellow
    }
}

# --------------------------------------------------------------------------
# Pré-requisito
#
# O Node não vem mais no pacote. Sem esta conferência, a falta dele só
# apareceria depois de tudo copiado, no primeiro clique do atalho, como uma
# janela que não abre.

function ConferirNode {
    $versao = $null
    try {
        $versao = (& node -v 2>$null)
    } catch {
        $versao = $null
    }

    if (-not $versao) {
        Write-Host 'O Node.js não está instalado, ou não está no PATH.' -ForegroundColor Red
        Write-Host "O HUB SNK precisa da versão $VERSAO_MINIMA_DO_NODE ou mais nova: https://nodejs.org" -ForegroundColor Red
        exit 1
    }

    $numeros = $versao.TrimStart('v').Split('.')
    $maior = [int]$numeros[0]
    $menor = [int]$numeros[1]

    if ($maior -lt $NODE_MAIOR_MINIMO -or ($maior -eq $NODE_MAIOR_MINIMO -and $menor -lt $NODE_MENOR_MINIMO)) {
        Write-Host "Node $($versao.TrimStart('v')) é antigo demais: o HUB SNK precisa da $VERSAO_MINIMA_DO_NODE ou mais nova." -ForegroundColor Red
        Write-Host 'A partir dela o Node roda arquivos .ts direto, sem etapa de build.' -ForegroundColor Red
        exit 1
    }

    Write-Host "Node $($versao.TrimStart('v')) encontrado." -ForegroundColor Green
}

# --------------------------------------------------------------------------
# Instalação

# O servidor no ar segura os arquivos que está usando: copiar por cima de uma
# instalação em execução falha com "arquivo em uso".
function EncerrarServidorInstalado([string]$destino) {
    $encerrar = Join-Path $destino 'encerrar-hub-snk.vbs'
    if (-not (Test-Path -LiteralPath $encerrar)) { return }

    Write-Host 'Encerrando o HUB SNK que já estava rodando ...'
    & "$env:SystemRoot\System32\wscript.exe" $encerrar
    Start-Sleep -Milliseconds 500
}

function CopiarPrograma([string]$destino) {
    New-Item -ItemType Directory -Path $destino -Force | Out-Null

    # O que veio no pacote é a lista inteira, menos os próprios instaladores.
    Get-ChildItem -LiteralPath $pastaDoPacote -Force |
        Where-Object { $_.Name -notlike 'instalar-hub-snk.*' } |
        ForEach-Object {
            Copy-Item -LiteralPath $_.FullName -Destination $destino -Recurse -Force
        }
}

function GravarConfiguracao($valores) {
    New-Item -ItemType Directory -Path $pastaDoHubSnk -Force | Out-Null

    $linhas = @(
        '# Configuração do HUB SNK, gravada pelo instalador.',
        '# Editar à mão funciona: o launcher lê este arquivo a cada abertura.',
        '# Uma variável de ambiente com o mesmo nome tem precedência sobre o valor daqui.',
        '',
        "HUB_PORTA=$($valores.Porta)",
        "HUB_HOST=$($valores.Host)",
        "HUB_PERMITIR_REDE=$($valores.PermitirRede)",
        "HUB_DADOS_DIR=$($valores.DiretorioDeDados)",
        "HUB_NAVEGADOR=$($valores.Navegador)"
    )

    Set-Content -LiteralPath $arquivoDeConfiguracao -Value $linhas -Encoding UTF8
}

function CriarAtalho([string]$caminhoDoAtalho, [string]$destino, [string]$argumentos, [string]$descricao) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $caminhoDoAtalho) -Force | Out-Null

    # O wscript.exe roda o VBS sem piscar janela de console.
    $shell = New-Object -ComObject WScript.Shell
    $atalho = $shell.CreateShortcut($caminhoDoAtalho)
    $atalho.TargetPath = "$env:SystemRoot\System32\wscript.exe"
    $atalho.Arguments = "`"$(Join-Path $destino 'abrir-hub-snk.vbs')`"$argumentos"
    $atalho.WorkingDirectory = $destino
    $atalho.IconLocation = Join-Path $destino 'hub-snk.ico'
    $atalho.Description = $descricao
    $atalho.Save()
}

function CriarAtalhos([string]$destino, [bool]$naAreaDeTrabalho, [bool]$noLogon) {
    $menuIniciar = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\HUB SNK.lnk'
    CriarAtalho $menuIniciar $destino '' 'Abre o HUB SNK em janela própria'

    $areaDeTrabalho = Join-Path ([System.Environment]::GetFolderPath('Desktop')) 'HUB SNK.lnk'
    if ($naAreaDeTrabalho) {
        CriarAtalho $areaDeTrabalho $destino '' 'Abre o HUB SNK em janela própria'
    }
    elseif (Test-Path -LiteralPath $areaDeTrabalho) {
        Remove-Item -LiteralPath $areaDeTrabalho -Force
    }

    # Início pela pasta Inicializar, e não por serviço do Windows: o HUB SNK
    # precisa da sessão do usuário para abrir o Explorer, o terminal, a IDE e os
    # diálogos de seleção de arquivo. O /servidor sobe o servidor sem janela.
    $inicializar = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\HUB SNK.lnk'
    if ($noLogon) {
        CriarAtalho $inicializar $destino ' /servidor' 'Sobe o servidor do HUB SNK no logon'
    }
    elseif (Test-Path -LiteralPath $inicializar) {
        Remove-Item -LiteralPath $inicializar -Force
    }
}

# --------------------------------------------------------------------------

if (-not (Test-Path -LiteralPath (Join-Path $pastaDoPacote 'src\index.ts'))) {
    Write-Host 'Este script precisa rodar de dentro do pacote descompactado do HUB SNK.' -ForegroundColor Red
    Write-Host "Não encontrei o src\index.ts em $pastaDoPacote." -ForegroundColor Red
    exit 1
}

ConferirNode

Write-Host ''
Write-Host '  HUB SNK — instalação' -ForegroundColor Cyan
Write-Host '  Enter aceita o valor entre colchetes.'
Write-Host ''

$gravada = LerConfiguracaoGravada
$navegadorAnterior = ValorGravado $gravada 'HUB_NAVEGADOR' (LerNavegadorDoArquivoAntigo)

$destino = Perguntar 'Pasta de instalação' $destinoPadrao
$destino = [System.Environment]::ExpandEnvironmentVariables($destino)

$porta = PerguntarPorta (ValorGravado $gravada 'HUB_PORTA' $PORTA_PADRAO)
$enderecoEscolhido = PerguntarHost (ValorGravado $gravada 'HUB_HOST' $HOST_PADRAO)
$diretorioDeDados = PerguntarDiretorioDeDados (ValorGravado $gravada 'HUB_DADOS_DIR' $dadosPadrao)
$navegador = PerguntarNavegador $navegadorAnterior

Write-Host ''
$naAreaDeTrabalho = PerguntarSimOuNao 'Criar atalho na área de trabalho?' $true
$noLogon = PerguntarSimOuNao 'Iniciar o HUB SNK junto com a sessão?' $false

Write-Host ''
EncerrarServidorInstalado $destino
Write-Host "Copiando o programa para $destino ..."
CopiarPrograma $destino

GravarConfiguracao @{
    Porta            = $porta
    Host             = $enderecoEscolhido.Host
    PermitirRede     = $enderecoEscolhido.PermitirRede
    DiretorioDeDados = $diretorioDeDados
    Navegador        = $navegador
}

New-Item -ItemType Directory -Path $diretorioDeDados -Force | Out-Null
CriarAtalhos $destino $naAreaDeTrabalho $noLogon

Write-Host ''
Write-Host '  HUB SNK instalado.' -ForegroundColor Green
Write-Host "  Programa:      $destino"
Write-Host "  Cadastro:      $diretorioDeDados"
Write-Host "  Configuração:  $arquivoDeConfiguracao"
Write-Host "  Endereço:      http://$($enderecoEscolhido.Host):$porta"
Write-Host ''

if (PerguntarSimOuNao 'Abrir o HUB SNK agora?' $true) {
    Start-Process -FilePath "$env:SystemRoot\System32\wscript.exe" `
        -ArgumentList "`"$(Join-Path $destino 'abrir-hub-snk.vbs')`"" `
        -WorkingDirectory $destino
}
