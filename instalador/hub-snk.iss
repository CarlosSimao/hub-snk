; Instalador do HUB SNK para Windows.
;
; Compilado com o Inno Setup 6. A pasta empacotada vem do
; `npm run empacotar-windows`, que também grava o dist\versao.iss lido abaixo.
;
; Instalação por usuário, sem UAC: o HUB SNK é um programa de uso pessoal, e
; instalar para a máquina inteira exigiria elevação sem nenhum ganho.

#include "..\dist\versao.iss"

#define NomeDoAplicativo "HUB SNK"
#define Autor "Carlos Nascimento"
#define Site "https://github.com/CarlosSimao/hub-snk"

[Setup]
AppId={{8C2F1A64-3D5E-4B9A-9E17-0F6C4A2B7D31}
AppName={#NomeDoAplicativo}
AppVersion={#VersaoDoHubSnk}
AppVerName={#NomeDoAplicativo} {#VersaoDoHubSnk}
AppPublisher={#Autor}
AppPublisherURL={#Site}
AppSupportURL={#Site}/issues
AppUpdatesURL={#Site}/releases
VersionInfoVersion={#VersaoDoHubSnk}

; Sem UAC: tudo vai para a pasta do próprio usuário.
PrivilegesRequired=lowest
DefaultDirName={autopf}\HubSnk
DefaultGroupName={#NomeDoAplicativo}
DisableProgramGroupPage=yes
DisableDirPage=auto

OutputDir=..\dist
OutputBaseFilename=hub-snk-{#VersaoDoHubSnk}-windows-x64
SetupIconFile=hub-snk.ico
UninstallDisplayIcon={app}\hub-snk.ico
UninstallDisplayName={#NomeDoAplicativo} {#VersaoDoHubSnk}

Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
LicenseFile=..\dist\windows\LICENSE.txt
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Tasks]
Name: "atalhonaareadetrabalho"; \
    Description: "Criar atalho na área de trabalho"; \
    GroupDescription: "Atalhos:"

Name: "iniciarnologon"; \
    Description: "Iniciar o HUB SNK junto com o Windows"; \
    GroupDescription: "Inicialização:"

[Files]
; A pasta empacotada já traz o node.exe e as dependências: a máquina de destino
; não precisa de Node nem de npm instalados.
Source: "..\dist\windows\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "hub-snk.ico"; DestDir: "{app}"; Flags: ignoreversion
Source: "encerrar-hub-snk.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; O wscript.exe roda o VBS sem abrir janela de console; o ícone é aplicado ao
; atalho para que a barra de tarefas e o menu mostrem a marca do HUB SNK.
Name: "{group}\{#NomeDoAplicativo}"; \
    Filename: "{sys}\wscript.exe"; \
    Parameters: """{app}\abrir-hub-snk.vbs"""; \
    WorkingDir: "{app}"; \
    IconFilename: "{app}\hub-snk.ico"; \
    Comment: "Abre o HUB SNK em janela própria"

Name: "{autodesktop}\{#NomeDoAplicativo}"; \
    Filename: "{sys}\wscript.exe"; \
    Parameters: """{app}\abrir-hub-snk.vbs"""; \
    WorkingDir: "{app}"; \
    IconFilename: "{app}\hub-snk.ico"; \
    Tasks: atalhonaareadetrabalho

; Início automático pela pasta Inicializar, e não por serviço do Windows: o
; HUB SNK precisa da sessão do usuário para abrir o Explorer, o terminal, a IDE
; e os diálogos de seleção de arquivo. O /servidor sobe o servidor sem abrir a
; janela — quem abre a janela é o usuário, pelo atalho.
Name: "{userstartup}\{#NomeDoAplicativo}"; \
    Filename: "{sys}\wscript.exe"; \
    Parameters: """{app}\abrir-hub-snk.vbs"" /servidor"; \
    WorkingDir: "{app}"; \
    IconFilename: "{app}\hub-snk.ico"; \
    Tasks: iniciarnologon

[Run]
Filename: "{sys}\wscript.exe"; \
    Parameters: """{app}\abrir-hub-snk.vbs"""; \
    WorkingDir: "{app}"; \
    Description: "Abrir o {#NomeDoAplicativo} agora"; \
    Flags: postinstall nowait skipifsilent

[UninstallRun]
; Roda antes de apagar os arquivos, senão o node.exe em uso trava a remoção.
Filename: "{sys}\wscript.exe"; \
    Parameters: """{app}\encerrar-hub-snk.vbs"""; \
    WorkingDir: "{app}"; \
    RunOnceId: "EncerrarServidor"; \
    Flags: waituntilterminated

[UninstallDelete]
; O log e a preferência de navegador são gerados fora da lista de arquivos
; instalados e não sairiam sozinhos. O cadastro, ao lado deles, fica onde está.
Type: files; Name: "{localappdata}\HubSnk\hub-snk.log"
Type: files; Name: "{localappdata}\HubSnk\navegador.txt"

[Code]
{ Página que pergunta em qual navegador o HUB SNK deve abrir. A janela do
  aplicativo é aberta com o `--app` do navegador escolhido, e é nele que os
  links dos clientes acabam abrindo. A escolha vai para um arquivo lido pelo
  abrir-hub-snk.vbs a cada abertura. }

const
  NavegadorEdge = 'edge';
  NavegadorChrome = 'chrome';
  NavegadorPadrao = 'padrao';

var
  PaginaDoNavegador: TInputOptionWizardPage;
  IndiceDoEdge: Integer;
  IndiceDoChrome: Integer;
  IndiceDoPadrao: Integer;

{ As pastas dos programas vêm do ambiente, e não das constantes commonpf: a
  instalação é por usuário (PrivilegesRequired=lowest) e os mesmos caminhos são
  procurados pelo abrir-hub-snk.vbs. }
function EdgeInstalado: Boolean;
begin
  Result :=
    FileExists(GetEnv('ProgramFiles(x86)') + '\Microsoft\Edge\Application\msedge.exe') or
    FileExists(GetEnv('ProgramFiles') + '\Microsoft\Edge\Application\msedge.exe');
end;

function ChromeInstalado: Boolean;
begin
  Result :=
    FileExists(GetEnv('ProgramFiles') + '\Google\Chrome\Application\chrome.exe') or
    FileExists(GetEnv('ProgramFiles(x86)') + '\Google\Chrome\Application\chrome.exe') or
    FileExists(ExpandConstant('{localappdata}\Google\Chrome\Application\chrome.exe'));
end;

function CaminhoDaPreferenciaDeNavegador: String;
begin
  Result := ExpandConstant('{localappdata}\HubSnk\navegador.txt');
end;

{ Vazio quando é a primeira instalação: aí a escolha inicial é o Edge, por vir
  com o Windows. }
function PreferenciaDeNavegadorGravada: String;
var
  Conteudo: AnsiString;
begin
  Result := '';
  if LoadStringFromFile(CaminhoDaPreferenciaDeNavegador, Conteudo) then
    Result := Lowercase(Trim(String(Conteudo)));
end;

function OpcaoInicialDoNavegador: Integer;
var
  Preferencia: String;
begin
  Preferencia := PreferenciaDeNavegadorGravada;

  if (Preferencia = NavegadorEdge) and (IndiceDoEdge >= 0) then
    Result := IndiceDoEdge
  else if (Preferencia = NavegadorChrome) and (IndiceDoChrome >= 0) then
    Result := IndiceDoChrome
  else if Preferencia = NavegadorPadrao then
    Result := IndiceDoPadrao
  else if IndiceDoEdge >= 0 then
    Result := IndiceDoEdge
  else if IndiceDoChrome >= 0 then
    Result := IndiceDoChrome
  else
    Result := IndiceDoPadrao;
end;

procedure InitializeWizard;
begin
  PaginaDoNavegador := CreateInputOptionPage(
    wpSelectTasks,
    'Navegador do HUB SNK',
    'Em qual navegador o HUB SNK deve abrir?',
    'O atalho abre o HUB SNK em janela própria, sem barra de endereço e sem ' +
    'abas. Os links dos clientes abrem no mesmo navegador dessa janela.',
    True, False);

  IndiceDoEdge := -1;
  IndiceDoChrome := -1;

  if EdgeInstalado then
    IndiceDoEdge := PaginaDoNavegador.Add('Microsoft Edge');
  if ChromeInstalado then
    IndiceDoChrome := PaginaDoNavegador.Add('Google Chrome');
  IndiceDoPadrao := PaginaDoNavegador.Add(
    'Navegador padrão do Windows (abre em aba comum)');

  PaginaDoNavegador.SelectedValueIndex := OpcaoInicialDoNavegador;
end;

{ Sem Edge nem Chrome não há o que escolher: só resta o navegador padrão. }
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = PaginaDoNavegador.ID) and
            (IndiceDoEdge < 0) and (IndiceDoChrome < 0);
end;

function NavegadorEscolhido: String;
begin
  if PaginaDoNavegador.SelectedValueIndex = IndiceDoEdge then
    Result := NavegadorEdge
  else if PaginaDoNavegador.SelectedValueIndex = IndiceDoChrome then
    Result := NavegadorChrome
  else
    Result := NavegadorPadrao;
end;

{ A pasta é a mesma do cadastro e do log, criada aqui porque a primeira
  instalação acontece antes de o servidor subir uma única vez. }
procedure GravarPreferenciaDeNavegador;
begin
  ForceDirectories(ExpandConstant('{localappdata}\HubSnk'));

  if not SaveStringToFile(CaminhoDaPreferenciaDeNavegador,
                          AnsiString(NavegadorEscolhido), False) then
    MsgBox(
      'Não foi possível gravar o navegador escolhido em:' + #13#10 +
      CaminhoDaPreferenciaDeNavegador + #13#10#13#10 +
      'O HUB SNK vai abrir no primeiro navegador que encontrar.',
      mbError, MB_OK);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    GravarPreferenciaDeNavegador;
end;

{ O desinstalador não toca no cadastro. Apagar dados por engano é irreversível,
  e uma reinstalação logo em seguida é o caso mais comum. }
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  PastaDeDados: String;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    PastaDeDados := ExpandConstant('{localappdata}\HubSnk\dados');
    if DirExists(PastaDeDados) then
      MsgBox(
        'O HUB SNK foi removido.' + #13#10#13#10 +
        'Seu cadastro continua em:' + #13#10 + PastaDeDados + #13#10#13#10 +
        'Apague essa pasta manualmente se não quiser mais guardá-lo.',
        mbInformation, MB_OK);
  end;
end;
