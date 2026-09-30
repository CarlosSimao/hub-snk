# Distribuição

Como o aplicativo desktop do HUB SNK é montado e o que o instalador faz na
máquina. Para instalar e usar, veja o [README](../README.md). O que testar à mão
antes de publicar está no
[roteiro de teste de release](manutencao.md#roteiro-de-teste-de-release).

Até a versão 1, o HUB SNK era distribuído como zip e tar.gz, com scripts de
instalação e uma janela `--app` do Edge ou do Chrome. Isso acabou: a versão 2 é
um aplicativo Electron com instalador NSIS, e o instalador remove a versão antiga.

## As três peças

| Peça           | Onde mora                                                      | O que é                                                                                |
| -------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Shell**      | `desktop/`                                                     | O Electron: janela, guias, cofre das credenciais e a ponte que o backend chama         |
| **Backend**    | `src/`                                                         | O mesmo Fastify de sempre, rodando direto do TypeScript, servindo o `public/`          |
| **Instalador** | `desktop/electron-builder.yml`, `desktop/assets/installer.nsh` | NSIS por usuário, com a remoção da versão PWA e as páginas de perfil e do Git AutoSync |

O shell sobe o backend como processo filho com o próprio executável do Electron
(`ELECTRON_RUN_AS_NODE=1`), espera o `GET /api/healthz` e só então abre a janela.
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
usuário mora nela — nem a marca de que foi o instalador do HUB SNK que instalou o
Git AutoSync, que fica em `%LOCALAPPDATA%\HubSnk\git-autosync-instalado-pelo-hub.txt`. A desinstalação não apaga nem o cadastro nem o perfil do
Electron (`deleteAppDataOnUninstall: false`): apagar dados de quem só está
reinstalando seria irreversível.

## Como gerar

```bash
npm run empacotar-desktop
```

É o `npm run empacotar` do `desktop/`, que faz, em ordem:

1. `tsc` do shell, para `desktop/dist/`.
2. `scripts/preparar-hub.mjs`: copia `src/` e `public/` sem os testes, o
   `package.json`, o `package-lock.json` e a `LICENSE` para `desktop/build/hub`, e
   roda `npm ci --omit=dev` ali — o backend do pacote só com as dependências de
   produção (cerca de 31 MB, 30 MB deles de `node_modules`).
3. `scripts/preparar-autosync.mjs`: copia os binários do Git AutoSync, o
   `install-standalone.ps1`, a `SKILL.md` e o `VERSION` para
   `desktop/build/git-autosync`, e gera o `build/gas-version.nsh` que liga a página
   dele no instalador. Recusa binário mais antigo que os fontes.
4. `electron-builder`: monta o `app.asar` com o shell, põe `build/hub`,
   `build/git-autosync` e `instalador/*.ps1` em `resources/`, fora do asar, e gera
   `release/HUB-SNK-Setup-<versão>.exe`.

O backend e os scripts ficam fora do `app.asar` de propósito. O backend é
executado como processo, e o PowerShell que o instalador chama não enxerga
dentro do asar.

### O Git AutoSync

Mora em outro repositório: `https://github.com/FlavianoRS/git-autosync`, **branch
`master`** — só ela tem o `installer/install-standalone.ps1` que o instalador
chama. O `preparar-autosync.mjs` o procura em `../scripts/git-autosync`, ao lado do
repositório do HUB SNK (`C:\Workspace\scripts\git-autosync` com o HUB SNK em
`C:\Workspace\hub-snk`), ou onde o `GIT_AUTOSYNC_DIR` apontar. Os binários são gerados
lá, pelo `python\build_windows.ps1` (PyInstaller), e o PyInstaller não faz
cross-compile.

Para um pacote sem ele: `npm --prefix desktop run empacotar:sem-autosync`. O
`build/gas-version.nsh` sai sem o `GAS_PRESENTE`, e nada do Git AutoSync entra no
instalador: nem a página, nem a instalação, nem a pergunta da desinstalação. O
arquivo é gravado assim, e não omitido, porque o `!include /NONFATAL` de um arquivo
ausente vira o aviso 7000, que o NSIS do `electron-builder` trata como erro.

O que vai no pacote, em `resources\git-autosync`:

| Arquivo                  | Função                                                                          |
| ------------------------ | ------------------------------------------------------------------------------- |
| `git-autosync.exe`       | Interface, bandeja e CLI, no mesmo binário. É o que o HUB SNK chama             |
| `git-autosync-sync.exe`  | O que a tarefa agendada executa. O HUB SNK nunca o chama                        |
| `install-standalone.ps1` | Instalação silenciosa e idempotente: é o que o NSIS chama, e serve para reparar |
| `SKILL.md`               | Skill para Claude Code e Codex, copiada só com a opção marcada                  |
| `VERSION`                | A versão, gravada em `~\.git-autosync\bin\VERSION` na instalação                |

Os binários entram sempre, mesmo que ninguém marque o Git AutoSync: são inertes até
alguém os instalar, e depender de download na hora da instalação falharia numa
máquina sem acesso. O `preparar-autosync.mjs` recusa binário mais antigo que qualquer
`python\*.py` do Git AutoSync — o pacote sairia com uma versão velha.

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

O NSIS o chama depois de copiar os arquivos, e o botão **Instalar** da aba Git do
Painel chama o mesmo script, pelo pacote que o shell aponta ao backend em
`HUB_AUTOSYNC_PACOTE` (vazio em desenvolvimento):

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File "<programa>\resources\git-autosync\install-standalone.ps1"
  -Source "<programa>\resources\git-autosync"
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

- O script fica em ASCII puro: o `powershell.exe` 5.1, que é o que o NSIS chama, lê
  arquivo sem BOM como ANSI.
- O único pré-requisito da máquina é o `git` no PATH. A mensagem do NSIS de que "o Git
  não está instalado" aparece para qualquer código de saída diferente de zero: para
  diagnosticar, rode o script à mão com os mesmos argumentos.
- Falha do Git AutoSync não aborta a instalação do HUB SNK.

## O que o instalador faz

- Instala por usuário, sem pedir administrador. É o que permite instalar numa
  máquina corporativa sem acionar o time de infra.
- Cria os atalhos "HUB SNK" no menu Iniciar e na área de trabalho.
- Roda o `resources\instalador\remover-versao-pwa.ps1` (a seguir).
- Mostra a página de perfil profissional (a seguir).
- Mostra a página do Git AutoSync e, se marcado, chama o `install-standalone.ps1`
  com as opções escolhidas. Falha do Git AutoSync (o motivo mais comum é não haver
  Git na máquina) não aborta a instalação do HUB SNK. Instalado por ele, o Git
  AutoSync ganha a marca `%LOCALAPPDATA%\HubSnk\git-autosync-instalado-pelo-hub.txt`,
  e só nesse caso a desinstalação pergunta se ele sai junto — nunca remove um Git
  AutoSync que a pessoa já tinha. Instalações até a 2.0.0 gravavam a marca dentro da
  pasta do programa; a atualização a leva para o lugar novo antes de apagar a antiga.

### A página de perfil

Aparece em toda instalação, antes da do Git AutoSync. O perfil (Desenvolvedor,
Consultor, Analista ou Gerente de projeto) define o preset de funcionalidades
ocultas, o mesmo de **Configurações › Acessos** (`src/acessos.ts`). A caixa
**Terceiro**, independente do perfil, oculta por cima do preset o que depende das
credenciais do SankhyaOm e da Experience: Credenciais Sankhya, as abas Agenda e
OS e as guias dos dois sistemas.

A escolha vai para `%LOCALAPPDATA%\HubSnk\perfil-inicial.txt` e
`terceiro-inicial.txt` (`S` ou `N`). O shell repassa os dois ao backend
(`HUB_PERFIL_INICIAL` e `HUB_TERCEIRO_INICIAL`), que só aplica cada um enquanto o
`configuracao.json` ainda não tem o campo correspondente: reinstalar ou atualizar nunca
desfaz o que o usuário ajustou. Uma reinstalação abre a página com a escolha
anterior marcada, e a instalação silenciosa, que não mostra a página, preserva os
arquivos que já existiam.

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

## Só Windows

A versão 2 é distribuída só para Windows: não há pacote para Linux nem para macOS,
e o workflow de distribuição só gera o instalador NSIS. O bloco `linux` do
`electron-builder.yml` e os caminhos do Linux no shell ficaram no código, mas estão
dormentes — nenhum pacote Linux foi gerado nem validado.
