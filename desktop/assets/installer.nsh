; Personalizacoes do instalador NSIS do HUB SNK desktop:
;
;  1. Remocao da instalacao PWA antiga, sempre (resources\instalador\remover-versao-pwa.ps1).
;  2. Pagina do perfil profissional, sempre: perfil e funcionalidades de Configuracoes > Acessos.
;  3. Pagina "Seus dados", sempre, com nome, empresa, time e e-mail opcionais.
;
;  4. Na desinstalacao, a pergunta se o Git AutoSync sai junto.
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
  ${NSD_CreateCheckbox} 6u 116u 40% 10u "Git AutoSync"
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

; --- seus dados ---------------------------------------------------------------------
;
; Nome, empresa, time e e-mail de quem usa o aplicativo, todos opcionais: seguem nos
; relatos de problema ao suporte e no remetente dos e-mails do HUB SNK. Mesmo caminho do
; perfil: um arquivo por campo em %LOCALAPPDATA%\HubSnk, que o aplicativo
; (desktop/src/config.ts) repassa ao backend, e o backend so' usa para preencher o campo
; ainda vazio em Configuracoes. Reinstalar nunca desfaz o que foi editado la'.
;
; Os arquivos sao UTF-16LE: o FileWrite comum grava na pagina de codigo do Windows, e o
; acento do nome chegaria trocado ao aplicativo.

; Mesmo limite da tela de Configuracoes (src/rotas/rotasConfiguracao.ts).
!define TAMANHO_MAXIMO_DOS_DADOS 120

Var DialogoDados
Var CampoNome
Var CampoEmpresa
Var CampoTime
Var CampoEmail
Var NomeDigitado
Var EmpresaDigitada
Var TimeDigitado
Var EmailDigitado
; "1" depois que a pagina foi mostrada; a instalacao silenciosa nao grava nada.
Var DadosMostrados

; Entrada: $R0 = nome do arquivo. Saida: $R7 = conteudo, vazio sem o arquivo.
Function DadosLerArquivo
  StrCpy $R7 ""
  Call PerfilArquivo
  ${If} ${FileExists} "$R9\$R0"
    FileOpen $R8 "$R9\$R0" r
    FileReadUTF16LE $R8 $R7
    FileClose $R8
  ${EndIf}
FunctionEnd

; Reinstalacao abre com o digitado na instalacao anterior.
Function DadosLerAnteriores
  StrCpy $R0 "nome-inicial.txt"
  Call DadosLerArquivo
  StrCpy $NomeDigitado $R7
  StrCpy $R0 "empresa-inicial.txt"
  Call DadosLerArquivo
  StrCpy $EmpresaDigitada $R7
  StrCpy $R0 "time-inicial.txt"
  Call DadosLerArquivo
  StrCpy $TimeDigitado $R7
  StrCpy $R0 "email-inicial.txt"
  Call DadosLerArquivo
  StrCpy $EmailDigitado $R7
FunctionEnd

!macro DadosCriarCampo ROTULO TOPO VALOR CONTROLE
  ${NSD_CreateLabel} 0 ${TOPO} 40u 10u "${ROTULO}"
  Pop $0
  ${NSD_CreateText} 45u ${TOPO} 200u 12u "${VALOR}"
  Pop ${CONTROLE}
  ${NSD_SetTextLimit} ${CONTROLE} ${TAMANHO_MAXIMO_DOS_DADOS}
!macroend

Function DadosPaginaCriar
  nsDialogs::Create 1018
  Pop $DialogoDados
  ${If} $DialogoDados == error
    Abort
  ${EndIf}

  ${If} $DadosMostrados != "1"
    Call DadosLerAnteriores
    StrCpy $DadosMostrados "1"
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 18u "Opcional: seus dados seguem nos relatos de problema ao suporte e nos e-mails do HUB SNK. Depois da instalacao, mude em Configuracoes."
  Pop $0

  !insertmacro DadosCriarCampo "Nome" 24u "$NomeDigitado" $CampoNome
  !insertmacro DadosCriarCampo "Empresa" 42u "$EmpresaDigitada" $CampoEmpresa
  !insertmacro DadosCriarCampo "Time" 60u "$TimeDigitado" $CampoTime
  !insertmacro DadosCriarCampo "E-mail" 78u "$EmailDigitado" $CampoEmail

  nsDialogs::Show
FunctionEnd

; O backend descarta e-mail invalido; aqui so' se pega o erro de digitacao mais comum,
; enquanto ainda da' para corrigir.
Function DadosPaginaSair
  ${NSD_GetText} $CampoNome $NomeDigitado
  ${NSD_GetText} $CampoEmpresa $EmpresaDigitada
  ${NSD_GetText} $CampoTime $TimeDigitado
  ${NSD_GetText} $CampoEmail $EmailDigitado

  ${If} $EmailDigitado != ""
    StrCpy $R0 $EmailDigitado
    StrCpy $R1 "@"
    Call AcessosListaContem
    ${If} $R2 == 0
      MessageBox MB_ICONEXCLAMATION "O e-mail informado nao parece valido. Corrija ou deixe em branco."
      Abort
    ${EndIf}
  ${EndIf}
FunctionEnd

!macro DadosGravarArquivo ARQUIVO VALOR
  FileOpen $R8 "$R9\${ARQUIVO}" w
  FileWriteUTF16LE $R8 "${VALOR}"
  FileClose $R8
!macroend

; Campo apagado na pagina grava vazio: o backend so' nao preenche nada com ele.
!macro HubSnkGravarDados
  ${If} $DadosMostrados == "1"
    Call PerfilArquivo
    CreateDirectory "$R9"
    !insertmacro DadosGravarArquivo "nome-inicial.txt" "$NomeDigitado"
    !insertmacro DadosGravarArquivo "empresa-inicial.txt" "$EmpresaDigitada"
    !insertmacro DadosGravarArquivo "time-inicial.txt" "$TimeDigitado"
    !insertmacro DadosGravarArquivo "email-inicial.txt" "$EmailDigitado"
  ${EndIf}
!macroend

!macro customPageAfterChangeDir
  Page custom DadosPaginaCriar DadosPaginaSair
  Page custom PerfilPaginaCriar PerfilPaginaSair
!macroend

!macro customInstall
  !insertmacro HubSnkRemoverVersaoPwa
  !insertmacro HubSnkGravarPerfil
  !insertmacro HubSnkGravarDados
!macroend

!endif ; BUILD_UNINSTALLER
