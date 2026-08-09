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
Const JANELA_OCULTA = 0
Const ESPERAR_TERMINAR = True
Const NAO_ESPERAR = False
Const TENTATIVAS_ATE_DESISTIR = 40
Const ESPERA_ENTRE_TENTATIVAS_MS = 250
Const PARA_LEITURA = 1

Dim fso, shell, pastaDoAplicativo, porta, endereco, somenteServidor

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

pastaDoAplicativo = fso.GetParentFolderName(WScript.ScriptFullName)
somenteServidor = TemArgumento("/servidor")

PrepararAmbiente
porta = PortaConfigurada()
endereco = "http://127.0.0.1:" & porta

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

' O `cmd /c` existe para redirecionar a saída ao log e fixar a pasta de
' trabalho — o Run sozinho não faz nenhum dos dois.
Sub IniciarServidor()
    Dim comando

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

    navegador = NavegadorChromium()
    If navegador = "" Then
        shell.Run endereco, 1, NAO_ESPERAR
    Else
        shell.Run """" & navegador & """ --app=" & endereco, 1, NAO_ESPERAR
    End If
End Sub

Function NavegadorChromium()
    Dim candidatos, caminho, indice

    candidatos = Array( _
        "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe", _
        "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe", _
        "%ProgramFiles%\Google\Chrome\Application\chrome.exe", _
        "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe", _
        "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")

    NavegadorChromium = ""
    For indice = 0 To UBound(candidatos)
        caminho = shell.ExpandEnvironmentStrings(candidatos(indice))
        If fso.FileExists(caminho) Then
            NavegadorChromium = caminho
            Exit Function
        End If
    Next
End Function
