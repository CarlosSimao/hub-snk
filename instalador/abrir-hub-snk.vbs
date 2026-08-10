' Launcher do HUB SNK instalado no Windows.
'
' Sem argumento: garante o servidor no ar e abre a janela do aplicativo.
' Com /servidor: só sobe o servidor, sem abrir janela — é como a tarefa
' agendada do logon o chama.
'
' O servidor roda com o node.exe que veio no instalador, na sessão do usuário.
' Não é serviço do Windows de propósito: serviço vive na sessão 0, e de lá o
' HUB SNK não conseguiria abrir o Explorer, o terminal, a IDE nem os diálogos
' de seleção de arquivo.

Option Explicit

Const PORTA_PADRAO = "4100"
Const HOST_PADRAO = "127.0.0.1"
Const ARQUIVO_DE_CONFIGURACAO = "hub-snk.env"
Const JANELA_OCULTA = 0
Const ESPERAR_TERMINAR = True
Const NAO_ESPERAR = False
Const TENTATIVAS_ATE_DESISTIR = 40
Const ESPERA_ENTRE_TENTATIVAS_MS = 250
Const PARA_LEITURA = 1
Const NAVEGADOR_EDGE = "edge"
Const NAVEGADOR_CHROME = "chrome"
Const NAVEGADOR_PADRAO = "padrao"

Dim fso, shell, pastaDoAplicativo, porta, endereco, somenteServidor

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

pastaDoAplicativo = fso.GetParentFolderName(WScript.ScriptFullName)
somenteServidor = TemArgumento("/servidor")

CarregarConfiguracao
PrepararAmbiente
porta = PortaConfigurada()
endereco = "http://" & HostConfigurado() & ":" & porta

If Not PortaEstaOcupada(porta) Then
    IniciarServidor
End If

If Not somenteServidor Then
    If EsperarServidorResponder(porta) Then
        AbrirJanelaDoAplicativo endereco
    Else
        shell.Popup _
            "O HUB SNK não respondeu a tempo." & vbCrLf & vbCrLf & _
            "O que aconteceu está registrado em:" & vbCrLf & CaminhoDoLog(), _
            0, "HUB SNK", 48
    End If
End If

' ---------------------------------------------------------------------------

Function TemArgumento(nome)
    Dim indice

    TemArgumento = False
    For indice = 0 To WScript.Arguments.Count - 1
        If LCase(WScript.Arguments(indice)) = LCase(nome) Then
            TemArgumento = True
        End If
    Next
End Function

' Lê o hub-snk.env gravado pelo instalador e leva cada valor para o ambiente
' deste processo — que o servidor herda. Variável já definida no ambiente vence
' o arquivo: dá para testar outra porta ou outro navegador sem reinstalar.
Sub CarregarConfiguracao()
    Dim caminho, arquivo, linha, separador, chave, valor

    caminho = PastaDoHubSnk() & "\" & ARQUIVO_DE_CONFIGURACAO
    If Not fso.FileExists(caminho) Then
        Exit Sub
    End If

    Set arquivo = fso.OpenTextFile(caminho, PARA_LEITURA)
    Do Until arquivo.AtEndOfStream
        linha = Trim(arquivo.ReadLine())
        separador = InStr(linha, "=")

        If separador > 1 And Left(linha, 1) <> "#" Then
            chave = Trim(Left(linha, separador - 1))
            valor = Trim(Mid(linha, separador + 1))

            If shell.Environment("PROCESS").Item(chave) = "" Then
                shell.Environment("PROCESS").Item(chave) = valor
            End If
        End If
    Loop
    arquivo.Close
End Sub

' Os dados ficam fora da pasta do programa: desinstalar não pode levar o
' cadastro junto, e atualizar reinstala a pasta do programa inteira.
Sub PrepararAmbiente()
    Dim pastaDeDados

    ' O log mora aqui mesmo quando os dados foram apontados para outro lugar —
    ' sem esta pasta, o redirecionamento da saída falharia e o servidor não subiria.
    GarantirPasta PastaDoHubSnk()

    pastaDeDados = shell.Environment("PROCESS").Item("HUB_DADOS_DIR")
    If pastaDeDados = "" Then
        pastaDeDados = PastaDoHubSnk() & "\dados"
        shell.Environment("PROCESS").Item("HUB_DADOS_DIR") = pastaDeDados
    End If

    GarantirPasta pastaDeDados
End Sub

Function PastaDoHubSnk()
    PastaDoHubSnk = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\HubSnk"
End Function

' Cria também os níveis intermediários: HUB_DADOS_DIR pode apontar para uma
' pasta aninhada que ainda não existe.
Sub GarantirPasta(caminho)
    Dim pai

    If fso.FolderExists(caminho) Then
        Exit Sub
    End If

    pai = fso.GetParentFolderName(caminho)
    If pai <> "" And Not fso.FolderExists(pai) Then
        GarantirPasta pai
    End If

    fso.CreateFolder caminho
End Sub

Function CaminhoDoLog()
    CaminhoDoLog = PastaDoHubSnk() & "\hub-snk.log"
End Function

Function PortaConfigurada()
    PortaConfigurada = shell.Environment("PROCESS").Item("HUB_PORTA")
    If PortaConfigurada = "" Then
        PortaConfigurada = PORTA_PADRAO
    End If
End Function

' O endereço da janela acompanha o que o servidor escuta: com HUB_HOST apontado
' para a rede, o 127.0.0.1 fixo abriria uma janela que não responde.
Function HostConfigurado()
    HostConfigurado = shell.Environment("PROCESS").Item("HUB_HOST")
    If HostConfigurado = "" Then
        HostConfigurado = HOST_PADRAO
    End If
End Function

' O `cmd /c` existe para redirecionar a saída ao log e fixar a pasta de
' trabalho — o Run sozinho não faz nenhum dos dois.
'
' A janela é aberta por este script, depois de a porta responder: sem o
' HUB_ABRIR_JANELA=0, o servidor abriria a dele e o usuário veria duas.
Sub IniciarServidor()
    Dim comando

    shell.Environment("PROCESS").Item("HUB_ABRIR_JANELA") = "0"

    comando = "cmd /c cd /d """ & pastaDoAplicativo & """ && """ & _
        pastaDoAplicativo & "\node.exe"" ""src\index.ts"" >> """ & CaminhoDoLog() & """ 2>&1"

    shell.Run comando, JANELA_OCULTA, NAO_ESPERAR
End Sub

Function EsperarServidorResponder(porta)
    Dim tentativa

    EsperarServidorResponder = False
    For tentativa = 1 To TENTATIVAS_ATE_DESISTIR
        If PortaEstaOcupada(porta) Then
            EsperarServidorResponder = True
            Exit Function
        End If
        WScript.Sleep ESPERA_ENTRE_TENTATIVAS_MS
    Next
End Function

' A saída do netstat vai para um arquivo temporário em vez de passar pelo Exec
' porque o Exec pisca uma janela de console — e este script existe justamente
' para não abrir janela nenhuma.
Function PortaEstaOcupada(porta)
    Dim arquivoTemporario, arquivo, linha, partes, espacos, sufixoDaPorta

    PortaEstaOcupada = False
    sufixoDaPorta = ":" & porta

    Set espacos = New RegExp
    espacos.Pattern = "\s+"
    espacos.Global = True

    arquivoTemporario = fso.GetSpecialFolder(2).Path & "\hub-snk-netstat.txt"
    shell.Run "cmd /c netstat -ano -p tcp > """ & arquivoTemporario & """", _
        JANELA_OCULTA, ESPERAR_TERMINAR

    If Not fso.FileExists(arquivoTemporario) Then
        Exit Function
    End If

    Set arquivo = fso.OpenTextFile(arquivoTemporario, PARA_LEITURA)
    Do Until arquivo.AtEndOfStream
        linha = Trim(espacos.Replace(Trim(arquivo.ReadLine()), " "))
        partes = Split(linha, " ")
        If UBound(partes) >= 3 Then
            If UCase(partes(3)) = "LISTENING" And _
               Right(partes(1), Len(sufixoDaPorta)) = sufixoDaPorta Then
                PortaEstaOcupada = True
            End If
        End If
    Loop
    arquivo.Close
    fso.DeleteFile arquivoTemporario, True
End Function

' Janela sem barra de endereço e sem abas, como a PWA instalada. O `--app` do
' Chromium dá isso sem depender de o usuário ter instalado a PWA pelo botão do
' navegador. Sem Edge nem Chrome, resta o navegador padrão, em aba comum.
Sub AbrirJanelaDoAplicativo(endereco)
    Dim navegador

    navegador = NavegadorDaJanela()
    If navegador = "" Then
        shell.Run endereco, 1, NAO_ESPERAR
    Else
        shell.Run """" & navegador & """ --app=" & endereco, 1, NAO_ESPERAR
    End If
End Sub

' Manda o navegador escolhido no instalador — é nele que os links dos clientes
' vão abrir. Se esse navegador saiu da máquina depois da instalação, cai na
' detecção automática em vez de deixar de abrir.
Function NavegadorDaJanela()
    Dim preferencia

    preferencia = PreferenciaDeNavegador()
    If preferencia = NAVEGADOR_PADRAO Then
        NavegadorDaJanela = ""
        Exit Function
    End If

    NavegadorDaJanela = ""
    If preferencia = NAVEGADOR_EDGE Then
        NavegadorDaJanela = PrimeiroCaminhoExistente(CaminhosDoEdge())
    ElseIf preferencia = NAVEGADOR_CHROME Then
        NavegadorDaJanela = PrimeiroCaminhoExistente(CaminhosDoChrome())
    End If

    If NavegadorDaJanela = "" Then
        NavegadorDaJanela = NavegadorChromium()
    End If
End Function

' A variável de ambiente vem antes do arquivo para permitir testar outro
' navegador sem reinstalar. Vazio significa "nunca foi escolhido" — instalação
' antiga, anterior à pergunta do instalador.
Function PreferenciaDeNavegador()
    PreferenciaDeNavegador = LCase(Trim( _
        shell.Environment("PROCESS").Item("HUB_NAVEGADOR")))

    If PreferenciaDeNavegador = "" Then
        PreferenciaDeNavegador = PreferenciaGravada()
    End If
End Function

Function PreferenciaGravada()
    Dim caminho, arquivo

    PreferenciaGravada = ""
    caminho = PastaDoHubSnk() & "\navegador.txt"
    If Not fso.FileExists(caminho) Then
        Exit Function
    End If

    Set arquivo = fso.OpenTextFile(caminho, PARA_LEITURA)
    If Not arquivo.AtEndOfStream Then
        PreferenciaGravada = LCase(Trim(arquivo.ReadLine()))
    End If
    arquivo.Close
End Function

' Ordem de preferência quando não há escolha gravada: o Edge vem com o Windows.
Function NavegadorChromium()
    NavegadorChromium = PrimeiroCaminhoExistente(CaminhosDoEdge())
    If NavegadorChromium = "" Then
        NavegadorChromium = PrimeiroCaminhoExistente(CaminhosDoChrome())
    End If
End Function

Function CaminhosDoEdge()
    CaminhosDoEdge = Array( _
        "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", _
        "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe")
End Function

Function CaminhosDoChrome()
    CaminhosDoChrome = Array( _
        "%ProgramFiles%\Google\Chrome\Application\chrome.exe", _
        "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe", _
        "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
End Function

Function PrimeiroCaminhoExistente(candidatos)
    Dim caminho, indice

    PrimeiroCaminhoExistente = ""
    For indice = 0 To UBound(candidatos)
        caminho = shell.ExpandEnvironmentStrings(candidatos(indice))
        If fso.FileExists(caminho) Then
            PrimeiroCaminhoExistente = caminho
            Exit Function
        End If
    Next
End Function
