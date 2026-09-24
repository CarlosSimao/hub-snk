# Distribuição

Como o aplicativo desktop do HUB SNK é montado e o que o instalador faz na
máquina. Para instalar e usar, veja o [README](../README.md). As decisões por trás
de cada escolha, e o que foi validado, estão no
[plano de migração para o Electron](plano-migracao-electron.md).

Até a versão 1, o HUB SNK era distribuído como zip e tar.gz, com scripts de
instalação e uma janela `--app` do Edge ou do Chrome. Isso acabou: a versão 2 é
um aplicativo Electron com instalador NSIS, e o instalador remove a versão antiga.

## As três peças

| Peça           | Onde mora                                                      | O que é                                                                        |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Shell**      | `desktop/`                                                     | O Electron: janela, guias, cofre das credenciais e a ponte que o backend chama |
| **Backend**    | `src/`                                                         | O mesmo Fastify de sempre, rodando direto do TypeScript, servindo o `public/`  |
| **Instalador** | `desktop/electron-builder.yml`, `desktop/assets/installer.nsh` | NSIS por usuário, com a remoção da versão PWA e a página do Git AutoSync       |

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
cria ao abrir, e o backend o lê a cada chamada. A mesma pasta guardava o
`token.txt` do antigo `hub-helper.ps1`, que o shell ainda lê uma única vez, para
trazer as credenciais que estavam no cofre dele.

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
   `package.json`, o `package-lock.json` e a `LICENSE` para `desktop/build/hub`, e
   roda `npm ci --omit=dev` ali — o backend do pacote só com as dependências de
   produção (cerca de 28 MB).
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
chama. O `preparar-autosync.mjs` o procura em `C:\Workspace\scripts\git-autosync`,
ou onde o `GIT_AUTOSYNC_DIR` apontar. Os binários são gerados lá, pelo
`python\build_windows.ps1` (PyInstaller), e o PyInstaller não faz cross-compile.

Para um pacote sem ele: `npm --prefix desktop run empacotar:sem-autosync`. A página
de componentes simplesmente não aparece.

## O que o instalador faz

- Instala por usuário, sem pedir administrador. É o que permite instalar numa
  máquina corporativa sem acionar o time de infra.
- Cria os atalhos "HUB SNK" no menu Iniciar e na área de trabalho.
- Roda o `resources\instalador\remover-versao-pwa.ps1` (a seguir).
- Mostra a página do Git AutoSync e, se marcado, chama o `install-standalone.ps1`
  com as opções escolhidas. Falha do Git AutoSync (o motivo mais comum é não haver
  Git na máquina) não aborta a instalação do HUB SNK. Instalado por ele, o Git
  AutoSync recebe a marca `instalado-pelo-hub.txt`, e só nesse caso a
  desinstalação pergunta se ele sai junto.

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

## Linux e macOS

O `electron-builder.yml` já declara AppImage e `.deb`, e o shell trata os caminhos
do Linux, mas o pacote Linux ainda não foi gerado nem validado. Ele precisa ser
montado numa máquina Linux (os binários do Git AutoSync saem do
`python/build_linux.sh` de lá), e o `.deb` depende de `libsecret`: sem chaveiro do
sistema, o `safeStorage` cairia numa cifra de chave fixa, e o shell recusa gravar
credencial nesse estado.

O macOS não tem distribuição a partir da versão 2.
