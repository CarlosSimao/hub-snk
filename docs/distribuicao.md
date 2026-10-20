# Distribuição

Como o aplicativo desktop do HUB SNK é montado e o que o instalador faz na
máquina. Para instalar e usar, veja o [README](../README.md). O que testar à mão
antes de publicar está no
[roteiro de teste de release](manutencao.md#roteiro-de-teste-de-release).

Até a versão 1, o HUB SNK era distribuído como zip e tar.gz, com scripts de
instalação e uma janela `--app` do Edge ou do Chrome. Isso acabou: a versão 2 é
um aplicativo Electron com instalador NSIS, e o instalador remove a versão antiga.

## As três peças

| Peça           | Onde mora                                                      | O que é                                                                        |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Shell**      | `desktop/`                                                     | O Electron: janela, guias, cofre das credenciais e a ponte que o backend chama |
| **Backend**    | `src/`                                                         | O mesmo Fastify de sempre, rodando direto do TypeScript, servindo o `public/`  |
| **Instalador** | `desktop/electron-builder.yml`, `desktop/assets/installer.nsh` | NSIS por usuário, com a remoção da versão PWA                                  |

O shell sobe o backend como processo filho com o próprio executável do Electron
(`ELECTRON_RUN_AS_NODE=1`), espera o `GET /api/healthz` e só então abre a janela.
Os dois rodam com a pasta do usuário como pasta de trabalho, nunca a da instalação:
o que eles abrem (WildFly, atalhos, IDE, navegador) herda essa pasta e continua vivo
depois do HUB SNK, e uma pasta de trabalho dentro da instalação impedia a atualização
de movê-la — o erro "Falha ao desinstalar os arquivos do aplicativo antigo: 2".
Ao fechar, pede `POST /api/sistema/encerrar`, para o backend fechar o SQLite e as
conexões, e só recorre ao `kill()` se ele não sair em 5 segundos. No Windows o
`kill()` não entrega sinal nenhum: sem a rota, o backend morreria no meio de uma
gravação.

## Por que o Node vai junto agora

Na versão 1, o Node ficava de fora do pacote e era pré-requisito. No aplicativo
desktop ele vem de graça: o Electron 44 traz o Node 24, que roda os `.ts` direto
(type stripping) e tem o `node:sqlite`. O backend não precisa de etapa de build, e
a máquina de quem instala não precisa de Node nenhum.

## Portas

| Porta  | Quem escuta                                     | Quem chama                 |
| ------ | ----------------------------------------------- | -------------------------- |
| `4100` | Backend (`127.0.0.1`)                           | A guia do Painel e o shell |
| `4103` | Ponte do shell (`127.0.0.1`, com `x-hub-token`) | O backend                  |

O token da ponte fica em `%APPDATA%\sankhya-hub\ipc\desktop-token.txt`. O shell o
cria ao abrir, e o backend o lê a cada chamada.

## Onde fica cada coisa na máquina

| O quê                      | Onde                                                            |
| -------------------------- | --------------------------------------------------------------- |
| Programa                   | `%LOCALAPPDATA%\Programs\HUB SNK`                               |
| Backend e painel           | `…\HUB SNK\resources\hub` (`src/`, `public/`, `node_modules/`)  |
| Cadastro                   | `%LOCALAPPDATA%\HubSnk\dados` — a mesma pasta da versão 1       |
| Perfil do Electron e logs  | `%APPDATA%\HUB SNK` (`log\desktop.log`, `log\backend.log`)      |
| Cofre das credenciais      | `%APPDATA%\HUB SNK\credenciais.json`, cifrado com `safeStorage` |
| Git AutoSync, se instalado | `%USERPROFILE%\.git-autosync`                                   |

A pasta de instalação é substituída a cada atualização, e por isso nada do
usuário mora nela. A desinstalação não apaga nem o cadastro nem o perfil do
Electron (`deleteAppDataOnUninstall: false`): apagar dados de quem só está
reinstalando seria irreversível.

## Como gerar

```bash
npm run empacotar-desktop
```

É o `npm run empacotar` do `desktop/`, que faz, em ordem:

1. `tsc` do shell, para `desktop/dist/`.
2. `scripts/preparar-hub.mjs`: copia `src/` e `public/` sem os testes, o
   `package.json`, o `package-lock.json`, a `LICENSE` e o `CHANGELOG.md` (fonte das
   novidades mostradas ao abrir atualizado) para `desktop/build/hub`, grava
   ali o `credencial-google.json` com a credencial OAuth do Google Drive (dos secrets
   `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`, ou do arquivo local ignorado pelo Git) e
   roda `npm ci --omit=dev` — o backend do pacote só com as dependências de
   produção (cerca de 31 MB, 30 MB deles de `node_modules`). Sem a credencial o
   instalador sai sem o Drive; na tag de versão do CI isso é erro. Veja
   [Credencial do Google Drive](manutencao.md#credencial-do-google-drive).
3. `electron-builder`: monta o `app.asar` com o shell, põe `build/hub` e
   `instalador/*.ps1` em `resources/`, fora do asar, e gera
   `release/HUB-SNK-Setup-<versão>.exe`.

O backend e os scripts ficam fora do `app.asar` de propósito. O backend é
executado como processo, e o PowerShell que o instalador chama não enxerga
dentro do asar.

### O Git AutoSync

**Não vem no instalador.** O Git AutoSync tem licença própria e mora em outro
repositório, `https://github.com/FlavianoRS/git-autosync`. Quem o quer instala pela
aba **Git AutoSync** do Painel: enquanto ele não está na máquina, a aba aparece acinzentada,
com o botão **Instalar o Git AutoSync** e o ícone de informação (descrição e link do
repositório) no cabeçalho.

O botão primeiro confere o Git (`GET /api/autosync/git`, que roda `git --version`).
Sem ele, mostra o endereço `https://git-scm.com/` e não segue; com ele, abre o diálogo
de opções, e a instalação (`src/autosync/pacoteDoGithub.ts`) baixa o pacote da
**Release mais recente** do repositório do Git AutoSync numa pasta temporária, apagada
no fim. A Release pode trazer o pacote de dois jeitos:

1. um asset `git-autosync-windows.zip` com os cinco arquivos da tabela abaixo, na
   raiz ou numa pasta só;
2. só os dois `.exe` anexados. O `install-standalone.ps1`, a `SKILL.md` e o `VERSION`
   vêm então do próprio repositório, **na mesma tag da Release** (`installer/`,
   `skill/` e `python/`).

| Arquivo                  | Função                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| `git-autosync.exe`       | Interface, bandeja e CLI, no mesmo binário. É o que o HUB SNK chama |
| `git-autosync-sync.exe`  | O que a tarefa agendada executa. O HUB SNK nunca o chama            |
| `install-standalone.ps1` | Instalação silenciosa e idempotente: é o que o botão Instalar chama |
| `SKILL.md`               | Skill para Claude Code e Codex, copiada só com a opção marcada      |
| `VERSION`                | A versão, gravada em `~\.git-autosync\bin\VERSION` na instalação    |

Para testar um build do Git AutoSync antes de publicar a Release, aponte
`HUB_AUTOSYNC_PACOTE` para uma pasta com esses arquivos: ela vence o download.

Instalado pela aba Git do app instalado, o Git AutoSync deixa em `%LOCALAPPDATA%\HubSnk`
a marca `git-autosync-instalado-pelo-hub.txt` e uma cópia do `install-standalone.ps1`
em `git-autosync\` (`src/autosync/desinstalacaoJuntoDoHub.ts`): a pasta temporária do
download some, e o `-Uninstall` apaga o `bin`. Com as duas, e com o `bin` ainda lá, a
desinstalação do HUB SNK pergunta se o Git AutoSync sai junto e roda o script com
`-Uninstall`, que preserva repositórios cadastrados, histórico e logs. Nunca remove um
Git AutoSync instalado por fora do HUB SNK, nem na desinstalação silenciosa da
atualização. Na atualização de uma versão que trazia o autosync no pacote (até a
2.2.1), o `customInit` guarda o script dela antes de a pasta antiga ser apagada.

Instalado, o Git AutoSync vive em `%USERPROFILE%\.git-autosync` (ou no que
`GIT_AUTOSYNC_HOME` apontar, e o backend do HUB SNK respeita a mesma variável):

| Caminho                          | Quem escreve             | Conteúdo                                                            |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| `bin\git-autosync.exe` e `-sync` | `install-standalone.ps1` | Cópia dos binários; é este `git-autosync.exe` que o HUB SNK executa |
| `bin\VERSION`                    | `install-standalone.ps1` | Versão instalada, lida como arquivo pelo HUB SNK                    |
| `config.json`                    | o CLI                    | Horários, alvos, IA e políticas. O HUB SNK só lê                    |
| `status.json`                    | o CLI                    | Último resultado de cada repositório                                |
| `autosync.log`                   | o CLI                    | Log em texto, que gira em 5 MB e guarda três anteriores             |
| `state.lock`, `log.lock`         | o CLI                    | Travas de arquivo                                                   |

Sem o `.exe` em `bin`, o backend aceita a instalação antiga com Python: lê o
`git-autosync.bat` só para achar o `python.exe` e o `app.py` e chama os dois direto.
O `.bat` nunca é executado, porque o `cmd.exe` reinterpretaria `&`, `|`, `^` e `%` no
caminho do repositório, que vem da tela.

### O `install-standalone.ps1`

O botão **Instalar o Git AutoSync** da aba Git do Painel o chama na pasta do pacote
baixado:

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File "<pacote>\install-standalone.ps1"
  -Source "<pacote>"
  [-TaskTime HH:mm[,HH:mm]] [-EnableTray] [-Shortcut] [-Skills] [-AddToPath]
```

| Opção         | Efeito                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------- |
| (sempre)      | Copia os dois binários para `bin` e grava o `bin\VERSION`                                |
| `-TaskTime`   | Cria ou atualiza a tarefa agendada, pelo `git-autosync set-schedule`                     |
| `-EnableTray` | Bandeja no login, pelo `git-autosync enable-tray`                                        |
| `-Shortcut`   | Atalhos na área de trabalho e no menu Iniciar                                            |
| `-Skills`     | Copia a `SKILL.md` para `~\.claude\skills` e, se existir, `~\.codex\skills`              |
| `-AddToPath`  | Põe `bin` no PATH do usuário, nunca no da máquina                                        |
| `-Uninstall`  | Remove binários, tarefa, bandeja, atalhos e skills; preserva `config.json`, status e log |
| `-PurgeData`  | Só com `-Uninstall`: apaga também a pasta `.git-autosync`                                |

Regras que não se quebram:

- O script fica em ASCII puro: o `powershell.exe` 5.1, que é o que o backend chama,
  lê arquivo sem BOM como ANSI.
- O único pré-requisito da máquina é o `git` no PATH, conferido antes do download.
  Git instalado com o HUB SNK aberto só é enxergado depois de reabri-lo: o backend
  herda o PATH de quando subiu.

## O que o instalador faz

- Instala por usuário, sem pedir administrador. É o que permite instalar numa
  máquina corporativa sem acionar o time de infra.
- Cria os atalhos "HUB SNK" no menu Iniciar e na área de trabalho.
- Roda o `resources\instalador\remover-versao-pwa.ps1` (a seguir).

### Perfil e dados de quem usa

O instalador não pergunta mais nada além da pasta: perfil, Terceiro, nome, empresa,
time e e-mail são perguntados pelo assistente de boas-vindas do próprio HUB SNK, no
primeiro uso, igual nos três sistemas (ver `docs/funcionalidades.md`). Os arquivos
`perfil-inicial.txt`, `terceiro-inicial.txt`, `funcionalidades-ocultas-inicial.txt` e
`*-inicial.txt` que versões anteriores deixaram em `%LOCALAPPDATA%\HubSnk` não são mais
lidos.

### A remoção da versão PWA

`desktop/instalador/remover-versao-pwa.ps1` roda em toda instalação e é
idempotente: numa máquina sem a versão antiga, não faz nada. Roda no Windows
PowerShell 5.1, que é o que o NSIS chama, e por isso está em UTF-8 com BOM.

1. Lê o `%LOCALAPPDATA%\HubSnk\hub-snk.env` da versão antiga, se existir.
2. Só reconhece a instalação se a pasta tiver `abrir-hub-snk.vbs` **e**
   `src\index.ts`. Um `HUB_PROGRAMA_DIR` apontando para outra pasta não apaga nada.
3. Encerra o `node.exe`, o `cmd.exe` e o `wscript.exe` da instalação antiga.
4. Remove só os atalhos que apontam para o `abrir-hub-snk.vbs` antigo. O atalho
   novo tem o mesmo nome, e na prática o NSIS já o escreveu por cima do antigo
   quando o script roda.
5. Se o cadastro estava numa pasta escolhida à mão, grava o caminho em
   `%LOCALAPPDATA%\HubSnk\pasta-de-dados.txt`, que o shell lê.
6. Apaga o `hub-snk.env`, o `hub-snk.log` e o `navegador.txt`.
7. Da pasta do programa, apaga só o que o pacote PWA instalou. O resto — os logs
   do WildFly que caíam ali, por exemplo — vai para
   `%LOCALAPPDATA%\HubSnk\restos-da-versao-pwa-<data>`.

**Nunca toca a pasta de dados.** Tudo fica registrado em
`%LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log`, e uma falha não aborta a
instalação: o instalador avisa e aponta o log.

## Assinatura

O instalador e o executável saem sem assinatura digital, porque não há
certificado. O SmartScreen avisa na primeira execução. Assinar exige um
certificado de assinatura de código; com ele, basta configurar o
`electron-builder` (`win.certificateFile` ou a assinatura na nuvem).

## Linux

O pacote do Linux é só o `.deb` (`hub-snk-<versão>-amd64.deb`), testado no Ubuntu 24.04.
O AppImage foi testado e descartado: o AppArmor do 24.04 bloqueia a sandbox do Chromium,
e o AppImage sobe com `--no-sandbox`. O `.deb` instala em `/opt/HUB SNK`, põe um perfil
do AppArmor que libera a sandbox, o `.desktop` (o `desktopName` do `desktop/package.json`
liga a janela a ele, e é isso que dá o ícone certo na barra do GNOME) e declara as
dependências de chaveiro (`libsecret-1-0`, recomendando o `gnome-keyring`).

O workflow `Distribuição` gera o `.deb` no job `linux` e anexa à release com a cópia
`hub-snk-amd64.deb`, que o botão do site baixa. Instalação: `sudo apt install ./hub-snk-<versão>-amd64.deb`. Gerar o pacote exige
Linux (o electron-builder não gera `.deb` no Windows) e o `binutils` na máquina.

O que muda em relação ao Windows:

- O Git AutoSync não aparece: ele só publica executáveis para Windows.
- O atalho global depende do portal de atalhos do Wayland; sem ele, o atalho é
  cadastrado no sistema com `hub-snk-desktop --busca-rapida` (ver
  `docs/funcionalidades.md`).
- O shell lê o PATH do shell de login da pessoa na abertura (`desktop/src/pathDoShell.ts`):
  aberto pelo menu, ele herdaria o PATH da sessão gráfica, sem nvm nem `~/.local/bin`.

## Mac

O pacote do Mac é o `HUB-SNK-<versão>-arm64.dmg`, só Apple Silicon: é a arquitetura do
runner `macos-latest`, onde ele é gerado e testado. Mac Intel entra quando houver quem
teste. O ícone (`assets/hub-snk-mac.png`, 1024 px) é o `hub-snk.png` ampliado: o
electron-builder exige pelo menos 512 px.

Sem conta paga da Apple não há Developer ID nem notarização. O app sai com assinatura
ad-hoc (`identity: '-'`, com `hardenedRuntime: false`), sem a qual o Apple Silicon diz que
ele "está danificado". Consequências:

- O Gatekeeper bloqueia a primeira abertura (liberação na wiki, `primeiros-passos.html#instalar-no-mac`).
- Sem atualização automática: o Squirrel.Mac confere a assinatura da versão nova contra a
  da instalada, e a ad-hoc muda a cada build. `ATUALIZACAO_AUTOMATICA_SUPORTADA` desliga o
  `electron-updater` e a caixa do menu; fica o aviso de versão nova do Painel.
- A chave do `safeStorage` (item _HUB SNK Safe Storage_ do Keychain) fica presa à
  assinatura: a cada versão nova o macOS pede permissão de novo. Recusada, a decriptação
  falha e as guias não fazem login sozinhas, mas o cofre não é apagado.

O que muda no shell:

- Menu **Editar** (só no Mac): sem os `role` de copiar e colar, Cmd+C e Cmd+V não chegam
  aos campos de texto. Voltar e Avançar usam Cmd+[ e Cmd+], porque Option+seta é pular
  palavra; Recarregar sem cache usa Cmd+Shift+R, porque Cmd+F5 liga o VoiceOver.
- Bandeja na barra de menus com ícone de 16 px (`hub-snk-bandeja.png` e `@2x`) e menu
  fixado, como no Linux. O clique no Dock traz a janela escondida pelo X.
- Início automático por LaunchAgent (`~/Library/LaunchAgents/<appId>.plist`): o item de
  login do Electron não repassa o argumento que faz o app subir escondido.
- Cadastro em `~/Library/Application Support/HUB SNK/dados`.

O job `mac` da `Distribuição` confere a assinatura (`codesign --verify`), registra o que o
Gatekeeper diz de uma cópia em quarentena, abre o app empacotado, espera o `/api/healthz` e
guarda print e logs no artefato `teste-mac`. Ele não prova o Gatekeeper com clique, o
pedido do Keychain (o do runner está desbloqueado), a bandeja nem o atalho global: isso só
com um Mac de verdade, numa versão beta (tag com hífen, que sai como pre-release).
Roteiro desse teste: [teste-mac.md](teste-mac.md).
