' Encerra o servidor do HUB SNK instalado.
'
' Usado pelo desinstalador antes de apagar os arquivos, e útil também para
' parar o programa sem reiniciar a máquina.
'
' Só encerra o node.exe que veio na pasta da instalação: outro Node rodando na
' máquina — um projeto seu, um servidor de desenvolvimento — fica intacto.

Option Explicit

Dim fso, shell, pastaDoAplicativo, nodeDaInstalacao, wmi, processos, processo

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

pastaDoAplicativo = fso.GetParentFolderName(WScript.ScriptFullName)
nodeDaInstalacao = pastaDoAplicativo & "\node.exe"

Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set processos = wmi.ExecQuery("SELECT ProcessId, ExecutablePath FROM Win32_Process WHERE Name = 'node.exe'")

For Each processo In processos
    If StrComp(processo.ExecutablePath, nodeDaInstalacao, vbTextCompare) = 0 Then
        processo.Terminate()
    End If
Next
