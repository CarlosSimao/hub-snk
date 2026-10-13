; Personalizacoes do instalador NSIS do HUB SNK desktop:
;
;  1. Remocao da instalacao PWA antiga, sempre (resources\instalador\remover-versao-pwa.ps1).
;  2. Na desinstalacao, a pergunta se o Git AutoSync sai junto.
;
; Perfil, Terceiro e os dados de quem usa o aplicativo (nome, empresa, time e e-mail) nao
; sao perguntados aqui: o assistente de boas-vindas do HUB SNK pergunta no primeiro uso,
; igual nos tres sistemas (public/js/boasVindas.js).
;
; O Git AutoSync nao faz parte deste instalador: tem licenca propria, e a aba Git do
; HUB SNK o instala baixando da Release do repositorio dele. Instalado por ela, ele
; deixa em %LOCALAPPDATA%\HubSnk a marca e uma copia do `install-standalone.ps1`
; (src/autosync/desinstalacaoJuntoDoHub.ts), e e' com elas que a desinstalacao o remove.
;
; Sem acentos de proposito: o compilador NSIS trata este arquivo como ANSI.

!include LogicLib.nsh

; --- Git AutoSync instalado pelo HUB SNK ---------------------------------------------
;
; Relativos ao %LOCALAPPDATA%, lido do ambiente: numa instalacao para todos os usuarios o
; NSIS troca o contexto e $LOCALAPPDATA passaria a apontar para o ProgramData. Os nomes
; sao os de src/autosync/desinstalacaoJuntoDoHub.ts: mudou la', muda aqui.
!define GAS_MARCA "HubSnk\git-autosync-instalado-pelo-hub.txt"
!define GAS_SCRIPT "HubSnk\git-autosync\install-standalone.ps1"

; So na desinstalacao de verdade: a atualizacao roda este desinstalador antes de instalar
; a versao nova (em silencio), e nem o inicio automatico nem o Git AutoSync podem sair
; a cada versao.
!macro customUnInstall
  ${IfNot} ${isUpdated}
    ; Entrada do "Iniciar HUB SNK automaticamente" (desktop/src/inicioAutomatico.ts).
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "br.dev.hubsnk.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "br.dev.hubsnk.desktop"

    ; So' o Git AutoSync que o HUB SNK instalou, e so' se ainda estiver na maquina: nunca
    ; uma instalacao que a pessoa fez por fora.
    ReadEnvStr $R3 LOCALAPPDATA
    ${IfNot} ${Silent}
    ${AndIf} ${FileExists} "$R3\${GAS_MARCA}"
    ${AndIf} ${FileExists} "$R3\${GAS_SCRIPT}"
    ${AndIf} ${FileExists} "$PROFILE\.git-autosync\bin\*.*"
      MessageBox MB_YESNO|MB_ICONQUESTION "Remover tambem o Git AutoSync (tarefa agendada, bandeja, atalhos e skills)?$\r$\n$\r$\nSeus repositorios cadastrados, o historico e os logs serao preservados." IDNO gas_manter
        DetailPrint "Removendo o Git AutoSync..."
        nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$R3\${GAS_SCRIPT}" -Uninstall'
        Pop $R1
        ${If} $R1 == 0
          Delete "$R3\${GAS_MARCA}"
          RMDir /r "$R3\HubSnk\git-autosync"
        ${Else}
          MessageBox MB_ICONEXCLAMATION "O HUB SNK foi removido, mas o Git AutoSync nao.$\r$\n$\r$\nPara tentar de novo, rode:$\r$\n$R3\${GAS_SCRIPT} -Uninstall"
        ${EndIf}
      gas_manter:
    ${EndIf}
  ${EndIf}
!macroend

; --- remocao da versao PWA ----------------------------------------------------------
;
; O script so' remove o que reconhece como a instalacao PWA (launcher + backend na pasta), preserva
; o cadastro e e' idempotente — numa maquina sem a versao antiga, nao faz nada.

!ifndef BUILD_UNINSTALLER

!macro customInstall
  DetailPrint "Removendo a versao PWA antiga do HUB SNK, se houver..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\instalador\remover-versao-pwa.ps1"'
  Pop $R1
  ${If} $R1 != 0
    ; Nao aborta: o aplicativo novo funciona mesmo com restos da versao antiga. O detalhe
    ; da falha fica em %LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log.
    MessageBox MB_ICONEXCLAMATION "O HUB SNK foi instalado, mas a versao antiga (PWA) nao foi removida por completo.$\r$\n$\r$\nVeja o motivo em:$\r$\n$LOCALAPPDATA\HubSnk\remocao-da-versao-pwa.log"
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER
