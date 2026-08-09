' Inicia o HUB SNK em segundo plano (sem janela). Duplo clique.
' Saída do servidor vai para iniciar.log.
' Antes de subir, encerra a instância anterior que ainda estiver escutando na porta.

Const PORTA_PADRAO = "4100"
Const JANELA_OCULTA = 0
Const ESPERAR_TERMINAR = True
Const ESPERA_APOS_ENCERRAR_MS = 500

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
pasta = fso.GetParentFolderName(WScript.ScriptFullName)

EncerrarInstanciaAnterior PortaConfigurada()

If Not fso.FolderExists(pasta & "\node_modules") Then
    shell.Run "cmd /c cd /d """ & pasta & """ && npm install", JANELA_OCULTA, ESPERAR_TERMINAR
End If

shell.Run "cmd /c cd /d """ & pasta & """ && npm start > iniciar.log 2>&1", JANELA_OCULTA, False

Function PortaConfigurada()
    PortaConfigurada = shell.Environment("PROCESS").Item("HUB_PORTA")
    If PortaConfigurada = "" Then
        PortaConfigurada = PORTA_PADRAO
    End If
End Function

' Encerra apenas processos node escutando na porta — é o HUB SNK esquecido em
' segundo plano. Qualquer outro programa na porta é deixado em paz: nesse caso o
' npm start falha e o motivo fica registrado no iniciar.log.
Sub EncerrarInstanciaAnterior(porta)
    Dim wmi, pids, pid, processos, processo, encerrou

    Set wmi = GetObject("winmgmts:\\.\root\cimv2")
    pids = PidsEscutandoNaPorta(porta)
    encerrou = False

    For Each pid In pids
        Set processos = wmi.ExecQuery( _
            "SELECT * FROM Win32_Process WHERE ProcessId = " & pid & " AND Name = 'node.exe'")
        For Each processo In processos
            processo.Terminate()
            encerrou = True
        Next
    Next

    ' A porta não fica livre no mesmo instante em que o processo morre.
    If encerrou Then
        WScript.Sleep ESPERA_APOS_ENCERRAR_MS
    End If
End Sub

' PIDs em LISTENING na porta, lidos do netstat. A saída vai para um arquivo
' temporário em vez de WScript.Shell.Exec porque o Exec pisca uma janela de
' console — e este script existe justamente para não abrir janela nenhuma.
Function PidsEscutandoNaPorta(porta)
    Dim arquivoTemporario, arquivo, linha, partes, espacos, pids, sufixoDaPorta

    Set pids = CreateObject("Scripting.Dictionary")
    sufixoDaPorta = ":" & porta

    Set espacos = New RegExp
    espacos.Pattern = "\s+"
    espacos.Global = True

    arquivoTemporario = fso.GetSpecialFolder(2).Path & "\hub-snk-netstat.txt"
    shell.Run "cmd /c netstat -ano -p tcp > """ & arquivoTemporario & """", _
        JANELA_OCULTA, ESPERAR_TERMINAR

    If fso.FileExists(arquivoTemporario) Then
        Set arquivo = fso.OpenTextFile(arquivoTemporario, 1)
        Do Until arquivo.AtEndOfStream
            linha = Trim(espacos.Replace(Trim(arquivo.ReadLine()), " "))
            partes = Split(linha, " ")
            If UBound(partes) >= 4 Then
                If UCase(partes(3)) = "LISTENING" And _
                   Right(partes(1), Len(sufixoDaPorta)) = sufixoDaPorta Then
                    pids(partes(4)) = True
                End If
            End If
        Loop
        arquivo.Close
        fso.DeleteFile arquivoTemporario, True
    End If

    PidsEscutandoNaPorta = pids.Keys
End Function
