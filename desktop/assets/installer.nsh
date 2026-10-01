; Personalizacoes do instalador NSIS do HUB SNK desktop:
;
;  1. Remocao da instalacao PWA antiga, sempre (resources\instalador\remover-versao-pwa.ps1).
;  2. Pagina do perfil profissional, sempre: perfil e funcionalidades de Configuracoes > Acessos.
;  3. Pagina de componentes do Git AutoSync, quando o pacote foi montado com ele.
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

; Marca de quem instalou o Git AutoSync, relativa ao %LOCALAPPDATA%. Fica fora da pasta
; do programa porque toda atualizacao apaga aquela pasta, e com ela a marca: depois de
; atualizar, a desinstalacao deixava de oferecer a remocao do Git AutoSync.
!define GAS_MARCA "HubSnk\git-autosync-instalado-pelo-hub.txt"
!define GAS_MARCA_ANTIGA "resources\git-autosync\instalado-pelo-hub.txt"

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
  ; Desmarcada por padrao: o Git AutoSync so' interessa a quem versiona os repositorios
  ; dos clientes, e poe tarefa agendada e bandeja no login.
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

; A escolha vai para %LOCALAPPDATA%\HubSnk\autosync-inicial.txt ("S" ou "N"). Com "N", o
; backend oculta em Configuracoes > Acessos a aba Git do menu e a secao AutoSync do
; cliente, com a mesma regra do perfil: so' enquanto o configuracao.json nao tem acessos.
; Instalacao silenciosa nao mostra a pagina, deixa $GasInstalar vazio e preserva o arquivo.
!macro GasGravarEscolha
  ${If} $GasInstalar != ""
    ReadEnvStr $R3 LOCALAPPDATA
    CreateDirectory "$R3\HubSnk"
    FileOpen $R2 "$R3\HubSnk\autosync-inicial.txt" w
    ${If} $GasInstalar == ${BST_CHECKED}
      FileWrite $R2 "S"
    ${Else}
      FileWrite $R2 "N"
    ${EndIf}
    FileClose $R2
  ${EndIf}
!macroend

; Roda depois de os arquivos estarem no lugar — `resources\git-autosync` ja' existe aqui.
!macro GasInstalar
  !insertmacro GasGravarEscolha
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
      ReadEnvStr $R3 LOCALAPPDATA
      CreateDirectory "$R3\HubSnk"
      FileOpen $R2 "$R3\${GAS_MARCA}" w
      FileWrite $R2 "${GAS_VERSION}"
      FileClose $R2
    ${EndIf}
  ${EndIf}
!macroend

; Instalacoes ate a 2.0.0 gravavam a marca dentro da pasta do programa. Aqui o $INSTDIR
; ja' aponta para a instalacao existente e a versao antiga ainda nao foi removida: e' a
; ultima chance de levar a marca para o lugar novo.
!macro customInit
  ReadEnvStr $R3 LOCALAPPDATA
  ${If} ${FileExists} "$INSTDIR\${GAS_MARCA_ANTIGA}"
  ${AndIfNot} ${FileExists} "$R3\${GAS_MARCA}"
    CreateDirectory "$R3\HubSnk"
    CopyFiles /SILENT "$INSTDIR\${GAS_MARCA_ANTIGA}" "$R3\${GAS_MARCA}"
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER

!macro customUnInstall
  ; Entrada do "Iniciar HUB SNK automaticamente" (desktop/src/inicioAutomatico.ts). So na
  ; desinstalacao de verdade: a atualizacao roda este desinstalador antes de instalar a
  ; versao nova, e apagar aqui desligaria o inicio automatico a cada versao.
  ${IfNot} ${isUpdated}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "br.dev.hubsnk.desktop"
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "br.dev.hubsnk.desktop"
  ${EndIf}
  ReadEnvStr $R3 LOCALAPPDATA
  ${IfNot} ${Silent}
  ${AndIf} ${FileExists} "$R3\${GAS_MARCA}"
    MessageBox MB_YESNO|MB_ICONQUESTION "Remover tambem o Git AutoSync (tarefa agendada, bandeja e atalhos)?$\r$\n$\r$\nSeus repositorios cadastrados, o historico e os logs serao preservados." IDNO gas_manter
      DetailPrint "Removendo o Git AutoSync..."
      nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\git-autosync\install-standalone.ps1" -Uninstall'
      Pop $R1
      ${If} $R1 == 0
        Delete "$R3\${GAS_MARCA}"
      ${EndIf}
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

; --- perfil profissional ------------------------------------------------------------
;
; Mesmo desenho da aba Configuracoes > Acessos: o perfil numa lista, a caixa Terceiro e
; uma caixa por funcionalidade. Trocar o perfil marca o preset dele; depois o usuario
; ajusta as caixas como quiser.
;
; A escolha vai para %LOCALAPPDATA%\HubSnk, ao lado do pasta-de-dados.txt:
;   perfil-inicial.txt                  valor interno do perfil (ex.: gerente-de-projeto)
;   terceiro-inicial.txt                "S" ou "N"
;   funcionalidades-ocultas-inicial.txt as desmarcadas, separadas por virgula; vazio e'
;                                       "nenhuma oculta", e nao "sem escolha"
; O aplicativo (desktop/src/config.ts) repassa os valores ao backend, que so' os aplica
; enquanto o configuracao.json ainda nao tem acessos: reinstalar ou atualizar nunca
; desfaz o que o usuario ajustou na aba Acessos.
;
; LOCALAPPDATA vem do ambiente, e nao de $LOCALAPPDATA: numa instalacao para todos os
; usuarios o NSIS troca o contexto e $LOCALAPPDATA passaria a apontar para o ProgramData,
; que o aplicativo nao le.

; Copia de FUNCIONALIDADES_OCULTAS_POR_PERFIL (src/acessos.ts): o NSIS nao le o TS.
; Mudou la', muda aqui.
!define OCULTAS_CONSULTOR "cliente.repositorios,autosync,cliente.autosync"
!define OCULTAS_ANALISTA "cliente.repositorios,autosync,cliente.autosync"
!define OCULTAS_GERENTE "cliente.repositorios,local,autosync,cliente.autosync"
!define OCULTAS_DESENVOLVEDOR ""

!define ARQUIVO_OCULTAS_INICIAIS "funcionalidades-ocultas-inicial.txt"

; Posicao de cada perfil na lista da pagina, na ordem em que aparecem.
!define INDICE_CONSULTOR 0
!define INDICE_ANALISTA 1
!define INDICE_GERENTE 2
!define INDICE_DESENVOLVEDOR 3

Var DialogoPerfil
Var ListaPerfil
Var PerfilEscolhido
Var CheckTerceiro
; "S" ou "N"; vazio enquanto a pagina nao foi mostrada (instalacao silenciosa).
Var TerceiroEscolhido
Var OcultasEscolhidas

; Caixas do menu principal.
Var CheckLocal
Var CheckAgenda
Var CheckOs
Var CheckLembretes
Var CheckContatos
Var CheckGit
; Caixas do cadastro do cliente.
Var CheckClienteBases
Var CheckClienteGit
Var CheckClienteProjetos
Var CheckClienteAgenda
Var CheckClienteOs
Var CheckClienteContatos
Var CheckClienteAutosync

Function PerfilArquivo
  ReadEnvStr $R9 LOCALAPPDATA
  StrCpy $R9 "$R9\HubSnk"
FunctionEnd

; Entrada: $R0 = lista entre virgulas (",a,b,"), $R1 = chave entre virgulas (",a,").
; Saida: $R2 = 1 quando a lista contem a chave, 0 quando nao.
Function AcessosListaContem
  StrLen $R3 $R1
  StrLen $R4 $R0
  StrCpy $R5 0
  StrCpy $R2 0
  ${DoWhile} $R5 < $R4
    StrCpy $R6 $R0 $R3 $R5
    ${If} $R6 == $R1
      StrCpy $R2 1
      ${Break}
    ${EndIf}
    IntOp $R5 $R5 + 1
  ${Loop}
FunctionEnd

Function PerfilPresetDoEscolhido
  ${If} $PerfilEscolhido == "consultor"
    StrCpy $OcultasEscolhidas "${OCULTAS_CONSULTOR}"
  ${ElseIf} $PerfilEscolhido == "analista"
    StrCpy $OcultasEscolhidas "${OCULTAS_ANALISTA}"
  ${ElseIf} $PerfilEscolhido == "gerente-de-projeto"
    StrCpy $OcultasEscolhidas "${OCULTAS_GERENTE}"
  ${Else}
    StrCpy $OcultasEscolhidas "${OCULTAS_DESENVOLVEDOR}"
  ${EndIf}
FunctionEnd

; Reinstalacao abre com o perfil, o Terceiro e as caixas da instalacao anterior.
Function PerfilLerAnterior
  StrCpy $PerfilEscolhido "consultor"
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

  ; Instalacao anterior a esta pagina nao tem o arquivo: vale o preset do perfil.
  Call PerfilPresetDoEscolhido
  ${If} ${FileExists} "$R9\${ARQUIVO_OCULTAS_INICIAIS}"
    StrCpy $R7 ""
    FileOpen $R8 "$R9\${ARQUIVO_OCULTAS_INICIAIS}" r
    FileRead $R8 $R7
    FileClose $R8
    StrCpy $OcultasEscolhidas $R7
  ${EndIf}
FunctionEnd

!macro PerfilMarcarCaixa CONTROLE CHAVE
  StrCpy $R1 ",${CHAVE},"
  Call AcessosListaContem
  ${If} $R2 == 1
    ${NSD_Uncheck} ${CONTROLE}
  ${Else}
    ${NSD_Check} ${CONTROLE}
  ${EndIf}
!macroend

; Caixa marcada e' funcionalidade visivel, como na aba Acessos.
Function PerfilMarcarCaixas
  StrCpy $R0 ",$OcultasEscolhidas,"
  !insertmacro PerfilMarcarCaixa $CheckLocal "local"
  !insertmacro PerfilMarcarCaixa $CheckAgenda "agenda"
  !insertmacro PerfilMarcarCaixa $CheckOs "os"
  !insertmacro PerfilMarcarCaixa $CheckLembretes "lembretes"
  !insertmacro PerfilMarcarCaixa $CheckContatos "contatos"
  !insertmacro PerfilMarcarCaixa $CheckGit "autosync"
  !insertmacro PerfilMarcarCaixa $CheckClienteBases "cliente.bases"
  !insertmacro PerfilMarcarCaixa $CheckClienteGit "cliente.repositorios"
  !insertmacro PerfilMarcarCaixa $CheckClienteProjetos "cliente.projetos"
  !insertmacro PerfilMarcarCaixa $CheckClienteAgenda "cliente.agenda"
  !insertmacro PerfilMarcarCaixa $CheckClienteOs "cliente.os"
  !insertmacro PerfilMarcarCaixa $CheckClienteContatos "cliente.contatos"
  !insertmacro PerfilMarcarCaixa $CheckClienteAutosync "cliente.autosync"
FunctionEnd

Function PerfilLerDaLista
  ${NSD_CB_GetSelectionIndex} $ListaPerfil $R0
  ${If} $R0 == ${INDICE_ANALISTA}
    StrCpy $PerfilEscolhido "analista"
  ${ElseIf} $R0 == ${INDICE_GERENTE}
    StrCpy $PerfilEscolhido "gerente-de-projeto"
  ${ElseIf} $R0 == ${INDICE_DESENVOLVEDOR}
    StrCpy $PerfilEscolhido "desenvolvedor"
  ${Else}
    StrCpy $PerfilEscolhido "consultor"
  ${EndIf}
FunctionEnd

Function PerfilSelecionarNaLista
  ${If} $PerfilEscolhido == "analista"
    ${NSD_CB_SetSelectionIndex} $ListaPerfil ${INDICE_ANALISTA}
  ${ElseIf} $PerfilEscolhido == "gerente-de-projeto"
    ${NSD_CB_SetSelectionIndex} $ListaPerfil ${INDICE_GERENTE}
  ${ElseIf} $PerfilEscolhido == "desenvolvedor"
    ${NSD_CB_SetSelectionIndex} $ListaPerfil ${INDICE_DESENVOLVEDOR}
  ${Else}
    ${NSD_CB_SetSelectionIndex} $ListaPerfil ${INDICE_CONSULTOR}
  ${EndIf}
FunctionEnd

Function PerfilAoTrocar
  Pop $0
  Call PerfilLerDaLista
  Call PerfilPresetDoEscolhido
  Call PerfilMarcarCaixas
FunctionEnd

; Desabilitada, a caixa mantem a marcacao: desmarcar Terceiro devolve o que era.
Function PerfilBloquearCaixasDoSankhya
  ${NSD_GetState} $CheckTerceiro $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $R1 0
  ${Else}
    StrCpy $R1 1
  ${EndIf}
  EnableWindow $CheckAgenda $R1
  EnableWindow $CheckOs $R1
  EnableWindow $CheckClienteAgenda $R1
  EnableWindow $CheckClienteOs $R1
FunctionEnd

Function PerfilAoClicarTerceiro
  Pop $0
  Call PerfilBloquearCaixasDoSankhya
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

  ${NSD_CreateLabel} 0 0 100% 18u "Escolha o seu perfil e ajuste as funcionalidades visiveis no HUB SNK. Depois da instalacao, mude em Configuracoes > Acessos."
  Pop $0

  ${NSD_CreateLabel} 0 23u 28u 10u "Perfil"
  Pop $0
  ${NSD_CreateDropList} 30u 21u 110u 60u ""
  Pop $ListaPerfil
  ; Mesma ordem dos INDICE_*.
  ${NSD_CB_AddString} $ListaPerfil "Consultor"
  ${NSD_CB_AddString} $ListaPerfil "Analista"
  ${NSD_CB_AddString} $ListaPerfil "Gerente de Projetos"
  ${NSD_CB_AddString} $ListaPerfil "Desenvolvedor"
  Call PerfilSelecionarNaLista
  ${NSD_OnChange} $ListaPerfil PerfilAoTrocar

  ${NSD_CreateCheckbox} 0 37u 100% 10u "Terceiro: sem acesso ao SankhyaOm e a Experience"
  Pop $CheckTerceiro
  ${If} $TerceiroEscolhido == "S"
    ${NSD_Check} $CheckTerceiro
  ${EndIf}
  ${NSD_OnClick} $CheckTerceiro PerfilAoClicarTerceiro

  ${NSD_CreateGroupBox} 0 50u 48% 90u "Menu principal"
  Pop $0
  ${NSD_CreateCheckbox} 6u 61u 40% 10u "Local"
  Pop $CheckLocal
  ${NSD_CreateCheckbox} 6u 72u 40% 10u "Agenda"
  Pop $CheckAgenda
  ${NSD_CreateCheckbox} 6u 83u 40% 10u "OS"
  Pop $CheckOs
  ${NSD_CreateCheckbox} 6u 94u 40% 10u "Lembretes (no sino)"
  Pop $CheckLembretes
  ${NSD_CreateCheckbox} 6u 105u 40% 10u "Contatos"
  Pop $CheckContatos
  ${NSD_CreateCheckbox} 6u 116u 40% 10u "Git"
  Pop $CheckGit

  ${NSD_CreateGroupBox} 52% 50u 48% 90u "Cadastro do cliente"
  Pop $0
  ${NSD_CreateCheckbox} 55% 61u 40% 10u "Bases"
  Pop $CheckClienteBases
  ${NSD_CreateCheckbox} 55% 72u 40% 10u "Git"
  Pop $CheckClienteGit
  ${NSD_CreateCheckbox} 55% 83u 40% 10u "Projetos"
  Pop $CheckClienteProjetos
  ${NSD_CreateCheckbox} 55% 94u 40% 10u "Agenda"
  Pop $CheckClienteAgenda
  ${NSD_CreateCheckbox} 55% 105u 40% 10u "OS"
  Pop $CheckClienteOs
  ${NSD_CreateCheckbox} 55% 116u 40% 10u "Contatos"
  Pop $CheckClienteContatos
  ${NSD_CreateCheckbox} 55% 127u 40% 10u "AutoSync (na aba Git)"
  Pop $CheckClienteAutosync

  Call PerfilMarcarCaixas
  Call PerfilBloquearCaixasDoSankhya

  nsDialogs::Show
FunctionEnd

!macro PerfilLerCaixa CONTROLE CHAVE
  ${NSD_GetState} ${CONTROLE} $R0
  ${If} $R0 != ${BST_CHECKED}
    ${If} $OcultasEscolhidas == ""
      StrCpy $OcultasEscolhidas "${CHAVE}"
    ${Else}
      StrCpy $OcultasEscolhidas "$OcultasEscolhidas,${CHAVE}"
    ${EndIf}
  ${EndIf}
!macroend

Function PerfilPaginaSair
  Call PerfilLerDaLista

  ${NSD_GetState} $CheckTerceiro $R0
  ${If} $R0 == ${BST_CHECKED}
    StrCpy $TerceiroEscolhido "S"
  ${Else}
    StrCpy $TerceiroEscolhido "N"
  ${EndIf}

  StrCpy $OcultasEscolhidas ""
  !insertmacro PerfilLerCaixa $CheckLocal "local"
  !insertmacro PerfilLerCaixa $CheckAgenda "agenda"
  !insertmacro PerfilLerCaixa $CheckOs "os"
  !insertmacro PerfilLerCaixa $CheckLembretes "lembretes"
  !insertmacro PerfilLerCaixa $CheckContatos "contatos"
  !insertmacro PerfilLerCaixa $CheckGit "autosync"
  !insertmacro PerfilLerCaixa $CheckClienteBases "cliente.bases"
  !insertmacro PerfilLerCaixa $CheckClienteGit "cliente.repositorios"
  !insertmacro PerfilLerCaixa $CheckClienteProjetos "cliente.projetos"
  !insertmacro PerfilLerCaixa $CheckClienteAgenda "cliente.agenda"
  !insertmacro PerfilLerCaixa $CheckClienteOs "cliente.os"
  !insertmacro PerfilLerCaixa $CheckClienteContatos "cliente.contatos"
  !insertmacro PerfilLerCaixa $CheckClienteAutosync "cliente.autosync"
FunctionEnd

; Instalacao silenciosa nao mostra a pagina: $PerfilEscolhido fica vazio e os arquivos da
; instalacao anterior, se houver, sao preservados.
!macro HubSnkGravarPerfil
  ${If} $PerfilEscolhido != ""
    Call PerfilArquivo
    CreateDirectory "$R9"
    FileOpen $R8 "$R9\perfil-inicial.txt" w
    FileWrite $R8 "$PerfilEscolhido"
    FileClose $R8
    FileOpen $R8 "$R9\${ARQUIVO_OCULTAS_INICIAIS}" w
    FileWrite $R8 "$OcultasEscolhidas"
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
  !ifdef GAS_PRESENTE
    Page custom GasPaginaCriar GasPaginaSair
  !endif
!macroend

!macro customInstall
  !insertmacro HubSnkRemoverVersaoPwa
  !insertmacro HubSnkGravarPerfil
  !ifdef GAS_PRESENTE
    !insertmacro GasInstalar
  !endif
!macroend

!endif ; BUILD_UNINSTALLER
