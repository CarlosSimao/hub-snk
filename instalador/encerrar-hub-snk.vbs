' Encerra o servidor do HUB SNK instalado.
'
' Usado pela desinstalação antes de apagar os arquivos, e útil também para
' parar o programa sem reiniciar a máquina.
'
' Só encerra o processo que roda o `src\index.ts` desta pasta: o Node agora é o
' da máquina, compartilhado com qualquer outro projeto seu, então o executável
' não distingue mais um do outro — o que distingue é o que ele está rodando.

Option Explicit

Const ESPERA_APOS_ENCERRAR_MS = 500

Dim fso, pastaDoAplicativo, programaDaInstalacao, wmi

Set fso = CreateObject("Scripting.FileSystemObject")

pastaDoAplicativo = fso.GetParentFolderName(WScript.ScriptFullName)
programaDaInstalacao = pastaDoAplicativo & "\src\index.ts"

Set wmi = GetObject("winmgmts:\\.\root\cimv2")

' O cmd.exe vem primeiro porque é ele quem mantém aberto o hub-snk.log: o
' launcher redireciona a saída pelo `>>` do próprio cmd. Encerrar só o node
' deixaria o log preso, e a desinstalação falharia ao apagá-lo.
EncerrarProcessosDaInstalacao "cmd.exe"
EncerrarProcessosDaInstalacao "node.exe"

' O processo não some no mesmo instante em que o Terminate volta, e quem chamou
' este script costuma apagar arquivos logo em seguida.
WScript.Sleep ESPERA_APOS_ENCERRAR_MS

' Só encerra o que está rodando o programa desta pasta: o Node é o da máquina,
' compartilhado com qualquer outro projeto, e o cmd.exe ainda mais.
Sub EncerrarProcessosDaInstalacao(nomeDoExecutavel)
    Dim processos, processo

    Set processos = wmi.ExecQuery( _
        "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = '" & nomeDoExecutavel & "'")

    For Each processo In processos
        If Not IsNull(processo.CommandLine) Then
            If InStr(1, processo.CommandLine, programaDaInstalacao, vbTextCompare) > 0 Then
                processo.Terminate()
            End If
        End If
    Next
End Sub
