; Personalizacoes do instalador NSIS do HUB SNK desktop:
;
;  1. Remocao da instalacao PWA antiga, sempre (resources\instalador\remover-versao-pwa.ps1).
;  2. Pagina do perfil profissional, sempre: define o preset de Configuracoes > Acessos.
;
;  3. Na desinstalacao, a pergunta se o Git AutoSync sai junto.
;
; O Git AutoSync nao faz mais parte deste instalador: tem licenca propria, e a aba Git
; do HUB SNK o instala baixando da Release do repositorio dele. Instalado por ela, ele
; deixa em %LOCALAPPDATA%\HubSnk a marca e uma copia do `install-standalone.ps1`
; (src/autosync/desinstalacaoJuntoDoHub.ts), e e' com elas que a desinstalacao o remove.
;
; Sem acentos de proposito: o compilador NSIS trata este arquivo como ANSI.

!include LogicLib.nsh
!include nsDialogs.nsh

; --- Git AutoSync instalado pelo HUB SNK ---------------------------------------------
;
; Relativos ao %LOCALAPPDATA% (lido do ambiente, como no perfil). Os nomes sao os de
; src/autosync/desinstalacaoJuntoDoHub.ts: mudou la', muda aqui.
!define GAS_MARCA "HubSnk\git-autosync-instalado-pelo-hub.txt"
!define GAS_SCRIPT "HubSnk\git-autosync\install-standalone.ps1"
; Onde as versoes ate a 2.2.1, que traziam o autosync no pacote, deixavam o script; e a
; marca das versoes ate a 2.0.0, dentro da pasta do programa.
!define GAS_SCRIPT_ANTIGO "resources\git-autosync\install-standalone.ps1"
!define GAS_MARCA_ANTIGA "resources\git-autosync\instalado-pelo-hub.txt"

!ifndef BUILD_UNINSTALLER
; Atualizacao de uma versao que trazia o autosync no pacote: o $INSTDIR ainda e' o da
; versao antiga, e e' a ultima chance de guardar o script dela antes de a pasta sumir.
; Sem isso, quem instalou o autosync pelo instalador antigo perderia a remocao junto.
!macro customInit
  ReadEnvStr $R3 LOCALAPPDATA
  ${If} ${FileExists} "$INSTDIR\${GAS_MARCA_ANTIGA}"
  ${AndIfNot} ${FileExists} "$R3\${GAS_MARCA}"
    CreateDirectory "$R3\HubSnk"
    CopyFiles /SILENT "$INSTDIR\${GAS_MARCA_ANTIGA}" "$R3\${GAS_MARCA}"
  ${EndIf}
  ${If} ${FileExists} "$R3\${GAS_MARCA}"
  ${AndIf} ${FileExists} "$INSTDIR\${GAS_SCRIPT_ANTIGO}"
  ${AndIfNot} ${FileExists} "$R3\${GAS_SCRIPT}"
    CreateDirectory "$R3\HubSnk\git-autosync"
    CopyFiles /SILENT "$INSTDIR\${GAS_SCRIPT_ANTIGO}" "$R3\${GAS_SCRIPT}"
  ${EndIf}
!macroend
!endif

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

; --- perfil profissional ------------------------------------------------------------
;
; A escolha vai para %LOCALAPPDATA%\HubSnk\perfil-inicial.txt, ao lado do
; pasta-de-dados.txt. O aplicativo (desktop/src/config.ts) repassa o valor ao backend,
; que so' aplica o preset enquanto o configuracao.json ainda nao tem acessos: reinstalar
; ou atualizar nunca desfaz o que o usuario ajustou na aba Acessos.
;
; A caixa Terceiro vai para terceiro-inicial.txt ("S" ou "N"), com a mesma regra: so'
; vale enquanto o configuracao.json nao tem o campo `terceiro`.
;
; LOCALAPPDATA vem do ambiente, e nao de $LOCALAPPDATA: numa instalacao para todos os
; usuarios o NSIS troca o contexto e $LOCALAPPDATA passaria a apontar para o ProgramData,
; que o aplicativo nao le.

Var DialogoPerfil
Var RadioDesenvolvedor
Var RadioConsultor
Var RadioAnalista
Var RadioGerente
Var PerfilEscolhido
Var CheckTerceiro
; "S" ou "N"; vazio enquanto a pagina nao foi mostrada (instalacao silenciosa).
Var TerceiroEscolhido

Function PerfilArquivo
  ReadEnvStr $R9 LOCALAPPDATA
  StrCpy $R9 "$R9\HubSnk"
FunctionEnd

; Reinstalacao abre com o perfil da instalacao anterior marcado.
Function PerfilLerAnterior
  StrCpy $PerfilEscolhido "desenvolvedor"
  Call PerfilArquivo
  ${If} ${FileExists} "$R9\perfil-inicial.txt"
    FileOpen $R8 "$R9\perfil-inicial.txt" r
    FileRead $R8 $R7
    FileClose $R8
    ${If} $R7 != ""
      StrCpy $PerfilEscolhido $R7
    ${EndIf}
  ${EndIf}

  StrCpy $TerceiroEscolhido "N"
  ${If} ${FileExists} "$R9\terceiro-inicial.txt"
    FileOpen $R8 "$R9\terceiro-inicial.txt" r
    FileRead $R8 $R7
    FileClose $R8
    ${If} $R7 == "S"
      StrCpy $TerceiroEscolhido "S"
    ${EndIf}
  ${EndIf}
FunctionEnd

Function PerfilPaginaCriar
  nsDialogs::Create 1018
  Pop $DialogoPerfil
  ${If} $DialogoPerfil == error
    Abort
  ${EndIf}

  ${If} $PerfilEscolhido == ""
    Call PerfilLerAnterior
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Qual o seu perfil? Ele define as funcionalidades visiveis no HUB SNK. Depois da instalacao, ajuste em Configuracoes > Acessos."
  Pop $0

  ${NSD_CreateRadioButton} 0 30u 100% 12u "Desenvolvedor: acesso a tudo"
  Pop $RadioDesenvolvedor
  ; Abre o grupo: os botoes seguintes sao mutuamente exclusivos com este.
  ${NSD_AddStyle} $RadioDesenvolvedor ${WS_GROUP}
  ${NSD_CreateRadioButton} 0 46u 100% 12u "Consultor: tudo, menos Repositorios do cliente"
  Pop $RadioConsultor
  ${NSD_CreateRadioButton} 0 62u 100% 12u "Analista: tudo, menos Repositorios do cliente"
  Pop $RadioAnalista
  ${NSD_CreateRadioButton} 0 78u 100% 12u "Gerente de projeto: tudo, menos Repositorios do cliente e a aba Local"
  Pop $RadioGerente

  ${If} $PerfilEscolhido == "consultor"
    ${NSD_Check} $RadioConsultor
  ${ElseIf} $PerfilEscolhido == "analista"
    ${NSD_Check} $RadioAnalista
  ${ElseIf} $PerfilEscolhido == "gerente-de-projeto"
    ${NSD_Check} $RadioGerente
  ${Else}
    ${NSD_Check} $RadioDesenvolvedor
  ${EndIf}

  ; Independente do perfil: qualquer um deles pode ser de um terceiro.
  ${NSD_CreateCheckbox} 0 100u 100% 12u "Terceiro: sem acesso ao SankhyaOm e a Experience"
  Pop $CheckTerceiro
  ${NSD_CreateLabel} 12u 114u 90% 18u "Oculta Credenciais Sankhya, Agenda, OS e as guias SankhyaOm e Experience."
  Pop $0
  ${If} $TerceiroEscolhido == "S"
    ${NSD_Check} $CheckTerceiro
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function PerfilPaginaSair
  ${NSD_GetState} $RadioConsultor $0
  ${NSD_GetState} $RadioAnalista $1
  ${NSD_GetState} $RadioGerente $2
  ${If} $0 == ${BST_CHECKED}
    StrCpy $PerfilEscolhido "consultor"
  ${ElseIf} $1 == ${BST_CHECKED}
    StrCpy $PerfilEscolhido "analista"
  ${ElseIf} $2 == ${BST_CHECKED}
    StrCpy $PerfilEscolhido "gerente-de-projeto"
  ${Else}
    StrCpy $PerfilEscolhido "desenvolvedor"
  ${EndIf}

  ${NSD_GetState} $CheckTerceiro $3
  ${If} $3 == ${BST_CHECKED}
    StrCpy $TerceiroEscolhido "S"
  ${Else}
    StrCpy $TerceiroEscolhido "N"
  ${EndIf}
FunctionEnd

; Instalacao silenciosa nao mostra a pagina: $PerfilEscolhido fica vazio e o arquivo da
; instalacao anterior, se houver, e' preservado.
!macro HubSnkGravarPerfil
  ${If} $PerfilEscolhido != ""
    Call PerfilArquivo
    CreateDirectory "$R9"
    FileOpen $R8 "$R9\perfil-inicial.txt" w
    FileWrite $R8 "$PerfilEscolhido"
    FileClose $R8
  ${EndIf}
  ${If} $TerceiroEscolhido != ""
    Call PerfilArquivo
    CreateDirectory "$R9"
    FileOpen $R8 "$R9\terceiro-inicial.txt" w
    FileWrite $R8 "$TerceiroEscolhido"
    FileClose $R8
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom PerfilPaginaCriar PerfilPaginaSair
!macroend

!macro customInstall
  !insertmacro HubSnkRemoverVersaoPwa
  !insertmacro HubSnkGravarPerfil
!macroend

!endif ; BUILD_UNINSTALLER
