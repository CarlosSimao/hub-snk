' Encerra o servidor do HUB SNK instalado.
'
' Usado pela desinstalação antes de apagar os arquivos, e útil também para
' parar o programa sem reiniciar a máquina.
'
' Só encerra o processo que roda o `src\index.ts` desta pasta: o Node agora é o
' da máquina, compartilhado com qualquer outro projeto seu, então o executável
' não distingue mais um do outro — o que distingue é o que ele está rodando.

Option Explicit

Dim fso, pastaDoAplicativo, programaDaInstalacao, wmi, processos, processo

Set fso = CreateObject("Scripting.FileSystemObject")

pastaDoAplicativo = fso.GetParentFolderName(WScript.ScriptFullName)
programaDaInstalacao = pastaDoAplicativo & "\src\index.ts"

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processos = wmi.ExecQuery( _
    "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'")

For Each processo In processos
    If Not IsNull(processo.CommandLine) Then
        If InStr(1, processo.CommandLine, programaDaInstalacao, vbTextCompare) > 0 Then
            processo.Terminate()
        End If
    End If
Next
