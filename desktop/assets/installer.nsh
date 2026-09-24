; Personalizacoes do instalador NSIS do HUB SNK desktop:
;
;  1. Remocao da instalacao PWA antiga, sempre (resources\instalador\remover-versao-pwa.ps1).
;  2. Pagina de componentes do Git AutoSync, quando o pacote foi montado com ele.
;
; Os binarios do Git AutoSync viajam SEMPRE dentro do pacote (resources\git-autosync).
; Sao inertes ate alguem os instalar. O que esta pagina decide e' so' o que tem efeito
; colateral na maquina: copia para o perfil do usuario, tarefa agendada, bandeja no
; login, atalhos, skills em ~\.claude e entrada no PATH.
;
; Quem executa a instalacao nao e' este script: e' o `install-standalone.ps1` que vem
; junto dos binarios, o mesmo usado fora do instalador. Repetir a logica aqui em NSIS
; seria uma segunda implementacao para manter — e foi assim que apareceu a tarefa
; agendada duplicada que esta fase corrigiu.
;
; Sem acentos de proposito: o compilador NSIS trata este arquivo como ANSI.

!include LogicLib.nsh
!include nsDialogs.nsh

; Gerado por `scripts/preparar-autosync.mjs` junto com os binarios. Quando o pacote e'
; montado sem o Git AutoSync (`npm run empacotar:sem-autosync`), o arquivo nao existe,
; `GAS_PRESENTE` fica indefinido e nada deste script entra no instalador — nem a pagina,
; nem a chamada da instalacao, nem a pergunta da desinstalacao.
!include /NONFATAL "${PROJECT_DIR}\build\gas-version.nsh"

!ifdef GAS_PRESENTE

; O instalador e o desinstalador sao COMPILADOS SEPARADAMENTE, e o segundo define
; `BUILD_UNINSTALLER`. A pagina de componentes nao existe la': o electron-builder so'
; insere `customPageAfterChangeDir` no passe do instalador, e uma funcao de pagina sem
; referencia vira o warning 6010, que o NSIS do electron-builder trata como erro.
!ifndef BUILD_UNINSTALLER

Var DialogoGas
Var CheckInstalar
Var CheckTarefa
Var CheckBandeja
Var CheckAtalhos
Var CheckSkills
Var CheckPath
Var TextoHorario
Var LabelHorario

Var GasInstalar
Var GasTarefa
Var GasBandeja
Var GasAtalhos
Var GasSkills
Var GasPath
Var GasHorario

; Liga e desliga as opcoes filhas junto da caixa principal: opcao marcada que nao teria
; efeito e' pior do que opcao ausente.
Function GasAtualizarEstado
  ${NSD_GetState} $CheckInstalar $GasInstalar
  ${If} $GasInstalar == ${BST_CHECKED}
    EnableWindow $CheckTarefa 1
    EnableWindow $TextoHorario 1
    EnableWindow $LabelHorario 1
    EnableWindow $CheckBandeja 1
    EnableWindow $CheckAtalhos 1
    EnableWindow $CheckSkills 1
    EnableWindow $CheckPath 1
  ${Else}
    EnableWindow $CheckTarefa 0
    EnableWindow $TextoHorario 0
    EnableWindow $LabelHorario 0
    EnableWindow $CheckBandeja 0
    EnableWindow $CheckAtalhos 0
    EnableWindow $CheckSkills 0
    EnableWindow $CheckPath 0
  ${EndIf}
FunctionEnd

Function GasPaginaCriar
  ; Sem MUI_HEADER_TEXT: este arquivo e' incluido antes do MUI2 do electron-builder, e a
  ; macro ainda nao existe aqui. O titulo da pagina fica o padrao; o texto que importa
  ; esta' nos proprios controles.
  nsDialogs::Create 1018
  Pop $DialogoGas
  ${If} $DialogoGas == error
    Abort
  ${EndIf}

  ${NSD_CreateCheckbox} 0 0 100% 12u "Instalar o Git AutoSync (versao ${GAS_VERSION})"
  Pop $CheckInstalar
  ${NSD_SetState} $CheckInstalar ${BST_CHECKED}
  ${NSD_OnClick} $CheckInstalar GasAtualizarEstado

  ${NSD_CreateLabel} 12u 15u 90% 18u "Os arquivos vao para %USERPROFILE%\.git-autosync. Requer o Git instalado; sem ele a instalacao do Git AutoSync e' recusada e o HUB SNK e' instalado do mesmo jeito."
  Pop $0

  ${NSD_CreateCheckbox} 12u 36u 60% 12u "Sincronizar todo dia as"
  Pop $CheckTarefa
  ${NSD_SetState} $CheckTarefa ${BST_CHECKED}

  ${NSD_CreateText} 120u 35u 30u 12u "17:30"
  Pop $TextoHorario

  ${NSD_CreateLabel} 155u 37u 60% 12u "(HH:mm)"
  Pop $LabelHorario

  ${NSD_CreateCheckbox} 12u 51u 90% 12u "Abrir o icone da bandeja junto com o login do Windows"
  Pop $CheckBandeja
  ${NSD_SetState} $CheckBandeja ${BST_CHECKED}

  ${NSD_CreateCheckbox} 12u 66u 90% 12u "Criar atalhos do Git AutoSync (area de trabalho e menu Iniciar)"
  Pop $CheckAtalhos

  ${NSD_CreateCheckbox} 12u 81u 90% 12u "Instalar a skill para os agentes de IA (~\.claude, ~\.codex)"
  Pop $CheckSkills
  ${NSD_SetState} $CheckSkills ${BST_CHECKED}

  ${NSD_CreateCheckbox} 12u 96u 90% 12u "Chamar 'git-autosync' de qualquer terminal (adiciona ao PATH do usuario)"
  Pop $CheckPath

  Call GasAtualizarEstado
  nsDialogs::Show
FunctionEnd

Function GasPaginaSair
  ${NSD_GetState} $CheckInstalar $GasInstalar
  ${NSD_GetState} $CheckTarefa $GasTarefa
  ${NSD_GetState} $CheckBandeja $GasBandeja
  ${NSD_GetState} $CheckAtalhos $GasAtalhos
  ${NSD_GetState} $CheckSkills $GasSkills
  ${NSD_GetState} $CheckPath $GasPath
  ${NSD_GetText} $TextoHorario $GasHorario

  ${If} $GasInstalar == ${BST_CHECKED}
  ${AndIf} $GasTarefa == ${BST_CHECKED}
    ; Validado aqui e nao so' no PowerShell: recusar depois de copiar arquivo deixaria a
    ; instalacao pela metade, e a mensagem apareceria numa janela que ja' passou.
    ${If} $GasHorario == ""
      MessageBox MB_ICONEXCLAMATION "Informe o horario no formato HH:mm (exemplo: 17:30)."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro customPageAfterChangeDir
  Page custom GasPaginaCriar GasPaginaSair
!macroend

; Roda depois de os arquivos estarem no lugar — `resources\git-autosync` ja' existe aqui.
!macro GasInstalar
  ${If} $GasInstalar == ${BST_CHECKED}
    StrCpy $R0 ""
    ${If} $GasTarefa == ${BST_CHECKED}
      StrCpy $R0 "$R0 -TaskTime $GasHorario"
    ${EndIf}
    ${If} $GasBandeja == ${BST_CHECKED}
      StrCpy $R0 "$R0 -EnableTray"
    ${EndIf}
    ${If} $GasAtalhos == ${BST_CHECKED}
      StrCpy $R0 "$R0 -Shortcut"
    ${EndIf}
    ${If} $GasSkills == ${BST_CHECKED}
      StrCpy $R0 "$R0 -Skills"
    ${EndIf}
    ${If} $GasPath == ${BST_CHECKED}
      StrCpy $R0 "$R0 -AddToPath"
    ${EndIf}

    DetailPrint "Instalando o Git AutoSync..."
    nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\git-autosync\install-standalone.ps1" -Source "$INSTDIR\resources\git-autosync"$R0'
    Pop $R1
    ${If} $R1 != 0
      ; Nao aborta a instalacao do HUB SNK: o painel funciona sem o autosync, e desfazer
      ; tudo por causa de um componente opcional seria pior para quem so' queria o Hub.
      MessageBox MB_ICONEXCLAMATION "O HUB SNK foi instalado, mas o Git AutoSync nao.$\r$\n$\r$\nMotivo mais comum: o Git nao esta instalado nesta maquina.$\r$\nDepois de instalar o Git, rode:$\r$\n$INSTDIR\resources\git-autosync\install-standalone.ps1"
    ${Else}
      ; Marca de quem instalou: a desinstalacao so' remove o que ELA instalou, nunca uma
      ; instalacao que o usuario ja' tinha antes.
      FileOpen $R2 "$INSTDIR\resources\git-autosync\instalado-pelo-hub.txt" w
      FileWrite $R2 "${GAS_VERSION}"
      FileClose $R2
    ${EndIf}
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER

!macro customUnInstall
  ${IfNot} ${Silent}
  ${AndIf} ${FileExists} "$INSTDIR\resources\git-autosync\instalado-pelo-hub.txt"
    MessageBox MB_YESNO|MB_ICONQUESTION "Remover tambem o Git AutoSync (tarefa agendada, bandeja e atalhos)?$\r$\n$\r$\nSeus repositorios cadastrados, o historico e os logs serao preservados." IDNO gas_manter
      DetailPrint "Removendo o Git AutoSync..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\git-autosync\install-standalone.ps1" -Uninstall'
      Pop $R1
    gas_manter:
  ${EndIf}
!macroend

!endif ; GAS_PRESENTE

; --- remocao da versao PWA ----------------------------------------------------------
;
; Fora do `GAS_PRESENTE`: roda em todo pacote, com ou sem o Git AutoSync. O script so'
; remove o que reconhece como a instalacao PWA (launcher + backend na pasta), preserva
; o cadastro e e' idempotente — numa maquina sem a versao antiga, nao faz nada.

!ifndef BUILD_UNINSTALLER

!macro HubSnkRemoverVersaoPwa
  DetailPrint "Removendo a versao PWA antiga do HUB SNK, se houver..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\instalador\remover-versao-pwa.ps1"'
  Pop $R1
  ${If} $R1 != 0
    ; Nao aborta: o aplicativo novo funciona mesmo com restos da versao antiga. O detalhe
    ; da falha fica em %LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log.
    MessageBox MB_ICONEXCLAMATION "O HUB SNK foi instalado, mas a versao antiga (PWA) nao foi removida por completo.$\r$\n$\r$\nVeja o motivo em:$\r$\n$LOCALAPPDATA\HubSnk\remocao-da-versao-pwa.log"
  ${EndIf}
!macroend

!macro customInstall
  !insertmacro HubSnkRemoverVersaoPwa
  !ifdef GAS_PRESENTE
    !insertmacro GasInstalar
  !endif
!macroend

!endif ; BUILD_UNINSTALLER
