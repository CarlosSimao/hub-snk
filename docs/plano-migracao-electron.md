# Plano de migração: HUB SNK (branch `dev`) para shell Electron

Objetivo: o HUB SNK da `dev` deixa de rodar como PWA (Node + janela `--app=` do Edge/Chrome) e passa a
rodar dentro de um shell Electron, no mesmo modelo da branch `flaviano-sankhya-hub` (`desktop/`).

Referência: `flaviano-sankhya-hub` @ `da69e32` (worktree em `C:\Workspace\hub-snk-flaviano`).

## Escopo

**Entra:** o shell `desktop/` do Flaviano, adaptado ao backend da `dev`: `node src/index.ts`, porta 4100,
`public/` em JS puro, dados em JSON + `sankhya.db`.

**Não entra:** o backend do Flaviano (React/Vite, `dist/`, `services.yaml`, Oracle, e-mail, escopo,
`serverlog`, skills), o Docker e a `poc-desktop/`. O backend da `dev` continua sendo o canônico. A
branch do Flaviano serve só de fonte do shell e de alguns módulos pontuais (`desktopBridge.ts`,
`sessaoDesktop.ts`).

## Como o shell funciona (resumo do que será portado)

- `main.ts` abre uma `BrowserWindow` com uma barra local (`index.html` + `renderer.js` + `preload.ts`) e
  três `WebContentsView`: **Painel** (`HUB_URL?desktop=1`), **ERP** e **Experience**. Todas usam a
  partição `persist:sankhya-hub-desktop`. Cada base cadastrada ganha uma aba isolada, com autofill.
- `backendProcess.ts` sobe o backend como processo filho. Usa o Node do PATH ou, na falta dele, o próprio
  Electron com `ELECTRON_RUN_AS_NODE=1`. Espera `GET /api/healthz` por até 45 s e grava o log em
  `userData/log/backend.log`.
- `bridgeServer.ts` expõe `127.0.0.1:4103`, autenticado por `x-hub-token` (lido de
  `%APPDATA%\sankhya-hub\ipc\desktop-token.txt`), com as rotas `/credentials/*` (cofre `safeStorage`),
  `/secret/*`, `/browser/*`, `/agenda/fetch`, `/navegacao/*` e `/serverlog/*`. Na prática, **substitui o
  `hub-helper.ps1`**.
- O empacotamento usa o `electron-builder`: NSIS per-user no Windows, AppImage + deb no Linux. O backend
  vai em `resources/hub` (`extraResources`), fora do `app.asar`.

## Pontos de incompatibilidade já identificados

| #   | Shell do Flaviano espera                                                                               | `dev` tem hoje                                                                                                                  | Onde                                                            |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | `dist/index.js` (fixo)                                                                                 | `src/index.ts` rodado direto, sem build                                                                                         | `desktop/src/config.ts:65`, `backendProcess.ts:211-237`         |
| 2   | `PORT`, `HOST`, `DATA_DIR`, `CONFIG_PATH`                                                              | `HUB_PORTA`, `HUB_HOST`, `HUB_DADOS_DIR`                                                                                        | `src/configuracao.ts`                                           |
| 3   | Porta 4000                                                                                             | Porta 4100                                                                                                                      | `desktop/src/config.ts:10`                                      |
| 4   | `GET /api/healthz`                                                                                     | Não existe (o CI sonda `/api/sistema/versao`)                                                                                   | `src/rotas/rotasSistema.ts`                                     |
| 5   | Backend não abre janela                                                                                | Abre o Edge/Chrome sozinho se `HUB_ABRIR_JANELA` não for `0`                                                                    | `src/configuracao.ts:101-103`                                   |
| 6   | `GET /api/clientes` retorna `{clientes:[{id,nome}]}` e `GET /api/clientes/:id/cartao` retorna as bases | `GET /api/clientes` retorna um **array**, com as bases dentro de cada cliente                                                   | `desktop/src/tabs.ts:513-540`, `src/rotas/rotasClientes.ts:404` |
| 7   | Senha via `POST /api/clientes/:id/bases/:baseId/revelar`                                               | A senha já vem na base (texto puro em `clientes.json`)                                                                          | `desktop/src/autofill.ts:25`                                    |
| 8   | `POST`/`DELETE /api/sankhya/desktop/sessao/sankhya-experience`                                         | Não existe                                                                                                                      | `desktop/src/backendClient.ts`                                  |
| 9   | `/api/email/lembretes`, `/api/serverlog/pendencias`                                                    | Não existem                                                                                                                     | `desktop/src/lembretes.ts`                                      |
| 10  | Bridge sem `/browser/agenda` e sem `/browser/agenda-negociacoes`                                       | O backend chama os dois no helper                                                                                               | `src/sankhya/credenciais.ts:108-114`                            |
| 11  | Pop-up só para base cadastrada, localhost diferente do hub ou SSO                                      | `window.open` do `log.html` aponta para o próprio hub                                                                           | `desktop/src/tabs.ts:202-261`, `public/app.js:2023`             |
| 12  | Nenhum service worker                                                                                  | `sw.js` registrado; o cache persiste na partição do Electron                                                                    | `public/app.js:7211-7219`                                       |
| 13  | `preparar-hub.mjs` roda `npm run build` e copia `dist/` e `config/`                                    | Sem script `build`, sem `dist/`, sem `config/`                                                                                  | `desktop/scripts/preparar-hub.mjs:53-85`                        |
| 14  | —                                                                                                      | **O `hub-helper.ps1` não existe na `dev`**: só está no worktree do Flaviano, com alteração não commitada (`agenda-negociacoes`) | `scripts/hub-helper.ps1` (Flaviano)                             |

O item 14 é o risco mais sério da situação atual: a integração com o Sankhya da `dev` depende de um
script que não está versionado neste repositório. A migração para o bridge do Electron resolve isso.

## Decisões

Decididas em 2026-09-24.

| #   | Tema                                             | Decisão                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Nome e identidade                                | Manter **"HUB SNK"** (título, `productName`, ícone atual), com `appId` próprio: `br.dev.hubsnk.desktop`.                                                                                                                                                                  |
| D2  | Runtime do backend                               | **Node embutido no Electron** (`ELECTRON_RUN_AS_NODE=1`), sem exigir Node instalado. Confirmada pelo spike da Fase 1 (Electron 44.4.5 / Node 24.21.0).                                                                                                                    |
| D3  | Navegador Sankhya (credenciais, captura, agenda) | **Bridge do Electron.** Como a PWA sai na mesma release (D5), sempre haverá shell: o fallback para o `hub-helper.ps1` só serve durante o desenvolvimento e **sai antes da release**. Do helper fica apenas a migração do cofre (`migracaoCofre.ts`) na primeira execução. |
| D4  | Pasta de dados                                   | Manter **`%LOCALAPPDATA%\HubSnk\dados`** via `HUB_DADOS_DIR`, sem migração.                                                                                                                                                                                               |
| D5  | PWA e instalador antigo                          | **Remover na mesma release** do Electron.                                                                                                                                                                                                                                 |
| D6  | macOS                                            | **Fora desta migração.** O Electron sai para Windows + Linux.                                                                                                                                                                                                             |
| D7  | Git AutoSync no instalador                       | **Fora desta migração.** Empacotar sempre com `--sem-autosync`.                                                                                                                                                                                                           |

Consequências da combinação D5 + D6 que o plano precisa cobrir:

- **Quem usa macOS fica sem distribuição a partir desta release.** Hoje o `instalar-hub-snk.sh` e o `.tar.gz` atendem macOS. Registrar no `CHANGELOG` e no README.
- **Sem período de convivência, a instalação PWA antiga precisa ser tratada pelo instalador novo.** O atalho da pasta Inicializar (`/servidor`) sobe um `node` na 4100 no login, e esse processo não responde `/api/healthz`. O shell tentaria subir outro backend e bateria na porta ocupada. Ver Fase 6.
- **As opções do `hub-snk.env` (porta, host, rede, navegador) deixam de valer.** A porta fica fixa em 4100 e o host em `127.0.0.1`; `HUB_PERMITIR_REDE` e `HUB_NAVEGADOR` saem.
- **O frontend passa a rodar só dentro do shell** (ou pelo item de menu "Abrir o painel no navegador"). Não é preciso manter dois comportamentos no `app.js`.

---

## Fase 0 — Preparação

- [ ] Criar a branch `feat/desktop-electron` a partir da `dev`.
- [x] Registrar neste arquivo as decisões D1 a D7.
- [ ] Anotar o commit de referência do Flaviano (`da69e32`) e pedir a ele que commite a alteração pendente do `scripts/hub-helper.ps1` (`agenda-negociacoes`), porque o código de `Get-NegociacoesDoParceiro` é a base do item 10.
- [ ] Ler `docs/specs/sankhya-hub-desktop-especificacao.md` na branch do Flaviano (arquitetura e decisões de segurança do shell).

## Fase 1 — Spike de viabilidade (antes de portar qualquer coisa)

A meta é provar que o backend da `dev` roda do jeito que o shell vai executá-lo.

- [x] Instalar temporariamente o `electron@^44` numa pasta de rascunho.
- [x] Rodar `ELECTRON_RUN_AS_NODE=1 electron src/index.ts` na raiz da `dev` e confirmar:
  - [x] O type stripping funciona no Node embutido, sem flag.
  - [x] O `node:sqlite` (`DatabaseSync`) está disponível e o `sankhya.db` abre.
  - [x] O Fastify sobe (testado na 4199, para não colidir com o hub em uso na 4100) e `/api/sistema/versao` responde.
- [x] Node do sistema: não se aplica, porque D2 usa o Node do Electron. O plano B não foi exercitado.
- [x] Nenhuma falha, então não há plano B nem build `tsc`. D2 está confirmada.

### Resultado do spike (2026-09-24, Windows 11)

- **Versões:** Electron **44.4.5** com Node embutido **24.21.0**; `process.features.typescript = "strip"`.
- **Execução:** `ELECTRON_RUN_AS_NODE=1 electron.exe src/index.ts` subiu o backend em ~1,5 s, sem flags e sem nenhum warning no log.
- **Rotas testadas:** `GET /` (200), `GET /app.js` (200), `GET /api/sistema/versao` (200), `GET /api/clientes` (200), `GET /api/agenda/estado` (200) e `POST /api/clientes` (201, gravou `clientes.json`). O `sankhya.db` foi criado em modo WAL.
- **Diretório de trabalho:** subiu com o caminho absoluto do entrypoint e o `cwd` fora do repositório, servindo `public/` normalmente. Os caminhos não dependem do `cwd`.
- **`HUB_ABRIR_JANELA=0`:** respeitado, nenhuma janela foi aberta.
- **Encerramento:** `kill` no processo não deixou `electron.exe` órfão. Sobraram `sankhya.db-wal`/`-shm`, que o SQLite recupera na próxima abertura; o encerramento limpo segue na Fase 2.
- **Testes:** `ELECTRON_RUN_AS_NODE=1 electron.exe --test` rodou os 95 testes da `dev`, todos passando. Dá para usar o mesmo runtime no CI.
- **Confirmado para a Fase 2:** o `pino-pretty` grava códigos de cor ANSI no arquivo de log.
- **Não validado:** Linux (AppImage/deb). Fica para a Fase 6.

## Fase 2 — Ajustes no backend da `dev` para ser hospedado

- [ ] Adicionar `GET /api/healthz` (resposta `200 {ok:true}`, sem I/O) em `rotasSistema.ts`, com teste.
- [ ] Confirmar que `protecaoDeOrigem` aceita:
  - [ ] a aba do painel carregada como `http://127.0.0.1:4100` (Host e Origin loopback);
  - [ ] as chamadas do shell sem `Origin` (fetch do processo principal).
- [ ] Tratar `SIGTERM`/`SIGINT`: `servidor.close()` e fechar o SQLite da agenda.
  - [ ] Avaliar uma rota `POST /api/sistema/encerrar` só para loopback e token, porque no Windows o `kill()` não entrega sinal. Decidir se entra.
- [ ] Log do backend legível em arquivo: desligar as cores do `pino-pretty` quando não houver TTY.
- [ ] Portar do Flaviano, adaptando para zod v4 e as convenções da `dev`:
  - [ ] `src/sankhya/desktopBridge.ts`, o cliente do bridge (`SANKHYA_DESKTOP_BRIDGE_URL` + `DESKTOP_BRIDGE_TOKEN_FILE`).
  - [ ] `src/sankhya/sessaoDesktop.ts` e as rotas `POST`/`DELETE /api/sankhya/desktop/sessao/:sistema` (token do bridge; só `sankhya-experience`).
  - [ ] Em `src/sankhya/credenciais.ts`: usar o bridge e dar prioridade à sessão empurrada na Experience. O fallback para o helper é tolerado só enquanto a Fase 4 não termina (D3).
  - [ ] Os testes `desktopBridge.test.ts` e `sessaoDesktop.test.ts`, movidos para ficar ao lado do código, no padrão da `dev`.
- [ ] `npm run typecheck` e `npm test` verdes.

## Fase 3 — Trazer o shell `desktop/`

- [ ] `git checkout da69e32 -- desktop/`. Não trazer `poc-desktop/`.
- [ ] Incluir no `.gitignore`: `desktop/node_modules/`, `desktop/dist/`, `desktop/build/`, `desktop/.perfil/`, `release/`.
- [ ] `desktop/src/config.ts`:
  - [ ] `HUB_URL` padrão `http://127.0.0.1:4100`.
  - [ ] Entrypoint `src/index.ts`, configurável por env; `cwd` = raiz do projeto, não `dirname(entrypoint)`.
  - [ ] Remover `SERVICES_YAML`, `CONFIG_PATH`, `DOCKER_SOCKET`, `WILDFLY_URL` e `ORACLE_HOST`.
  - [ ] Pasta de dados: `%LOCALAPPDATA%\HubSnk\dados` empacotado e `<raiz>/dados-hub-snk` em desenvolvimento (D4).
- [ ] `desktop/src/backendProcess.ts`:
  - [ ] Passar `HUB_PORTA=4100`, `HUB_HOST=127.0.0.1`, `HUB_DADOS_DIR`, `SANKHYA_DESKTOP_BRIDGE_URL`, `DESKTOP_BRIDGE_TOKEN_FILE` e `TZ`. Não passar `HUB_HELPER_*` (D3).
  - [ ] Runtime: sempre `process.execPath` com `ELECTRON_RUN_AS_NODE=1` (D2). Remover a busca por `node` no PATH, a menos que a Fase 1 obrigue ao plano B.
  - [ ] Trocar a mensagem "Rode `npm run build`".
  - [ ] Encerramento limpo (rota de encerrar, se aprovada na Fase 2, antes do `kill`).
- [ ] Remover o que depende de backend inexistente na `dev`:
  - [ ] `primeiroBoot.ts` (`services.yaml`).
  - [ ] `lembretes.ts` e a chamada `avisarAnotacoes`/`avisarServerLog` no `main.ts`.
  - [ ] `serverLog.ts` e as rotas `/serverlog/*` do bridge.
  - [ ] `navegacaoSkill.ts` e as rotas `/navegacao/*` do bridge (skills não existem na `dev`).
  - [ ] Itens de menu "Skills" em `menu.ts`.
- [ ] `migracaoNome.ts`: remover. Não existe instalação Electron anterior do HUB SNK.
- [ ] Identidade (D1): título "HUB SNK" em `main.ts:44`, rótulos de `tabs.ts:94-98`, `productName` "HUB SNK", `appId` `br.dev.hubsnk.desktop`, ícones em `desktop/assets` (mover `instalador/hub-snk.ico` e gerar o `.png`).
- [ ] Em `desktop/package.json`, trocar `build:hub`/`start` para não chamar `npm run build` na raiz.
- [ ] `npm --prefix desktop install` e `npm --prefix desktop run build` compilam sem erro.

## Fase 4 — Adaptar o contrato shell ↔ backend

- [ ] `tabs.ts` (carga das abas por base): ler o array de `GET /api/clientes` e as bases de cada cliente (`id`, `url`, `tipo`, `usuario`), no lugar de `{clientes}` + `/cartao`.
- [ ] `autofill.ts`: obter a senha via `GET /api/clientes/:id` (a base já traz `senha`), ou criar uma rota dedicada que devolva só a senha de uma base. **Decidir** — a rota dedicada evita que o shell trafegue o cadastro inteiro.
- [ ] Recarregar as abas de base quando o cadastro muda (o shell do Flaviano carrega só no boot? confirmar e, se for o caso, acionar pelo `observadorDaPastaDeDados`/SSE ou por IPC).
- [ ] `backendClient.ts`: apontar para as rotas de sessão portadas na Fase 2.
- [ ] Bridge (D3):
  - [ ] Implementar `/browser/agenda` no bridge, reaproveitando `AgendaFetcher` (`agenda.ts`).
  - [ ] Implementar `/browser/agenda-negociacoes` no bridge, portando `Get-NegociacoesDoParceiro` do `hub-helper.ps1` para `fetch` dentro da aba ERP.
  - [ ] Conferir que `/credentials/*`, `/browser/status|abrir|capturar|fechar` respondem no formato que `src/sankhya/credenciais.ts` da `dev` espera (erros `{mensagem}` × `{error}`).
  - [ ] `migracaoCofre.ts`: manter, para importar as credenciais que já estão no helper DPAPI.
- [ ] Remover do backend o caminho do helper: `src/sankhya/helper.ts`, o fallback em `credenciais.ts`, `HUB_HELPER_URL`/`HUB_HELPER_TOKEN_FILE` em `configuracao.ts` e a resposta `helperIndisponivel` (D3).
- [ ] Política de pop-up (`tabs.ts:202-261`): liberar o `log.html` e as demais janelas abertas pelo próprio painel, ou abri-las como aba interna.

## Fase 5 — Frontend `public/` dentro do shell

O frontend passa a rodar só dentro do shell (D5), então não há modo condicional por `?desktop=1`.

- [ ] Remover o registro do `sw.js` no `app.js` (`:7211-7219`) e incluir um desregistro único de SW remanescente, para quem abrir pelo menu "Abrir o painel no navegador" com cache antigo do Edge/Chrome.
- [ ] Trocar as ações de login/captura pelo navegador externo do helper por "abrir na aba ERP/Experience".
- [ ] Trocar as mensagens de `helperIndisponivel` (`index.html:176,803`) pelo estado do bridge.
- [ ] Links de base (`app.js:850,1585`) continuam `target=_blank`: o shell os converte em aba com autofill. Validar.
- [ ] Remover do `index.html` o link do `manifest.webmanifest` e as metas de PWA.

## Fase 6 — Empacotamento

- [ ] Reescrever `desktop/scripts/preparar-hub.mjs`:
  - [ ] Sem `npm run build`; copiar `src/` (sem `*.test.ts`), `public/` (sem testes), `package.json` e `package-lock.json`.
  - [ ] `npm ci --omit=dev` em `build/hub`.
  - [ ] Validar a existência de `build/hub/src/index.ts` e de `node_modules`.
  - [ ] Reaproveitar a lógica de exclusão de `scripts/empacotar-comum.mjs` em vez de duplicá-la.
- [ ] `electron-builder.yml`:
  - [ ] `appId` `br.dev.hubsnk.desktop`, `productName`/`shortcutName` "HUB SNK", `artifactName` `HUB-SNK-Setup-${version}.${ext}` (D1).
  - [ ] Manter as duas entradas de `extraResources` (`build/hub` e `build/hub/node_modules`), que são obrigatórias.
  - [ ] Retirar `build/git-autosync`, `preparar-autosync.mjs`, os scripts `empacotar:sem-autosync` e o `installer.nsh` do autosync (D7).
  - [ ] Alvos: NSIS (Windows x64), AppImage + deb (Linux x64). Sem `dmg` (D6).
- [ ] Remoção da instalação PWA antiga, porque não há convivência (D5). Fazer no `installer.nsh` ou na primeira execução do shell:
  - [ ] Detectar `%LOCALAPPDATA%\Programs\HubSnk`.
  - [ ] Encerrar o `node.exe` antigo (mesma regra do `encerrar-hub-snk.vbs`: linha de comando com `src\index.ts` dentro da instalação).
  - [ ] Apagar os atalhos do Menu Iniciar, da Área de Trabalho e da pasta Inicializar.
  - [ ] Apagar `%LOCALAPPDATA%\Programs\HubSnk` e o `hub-snk.env`, **preservando `%LOCALAPPDATA%\HubSnk\dados`**.
  - [ ] Registrar em log o que foi removido.
  - [ ] Se o `hub-snk.env` tinha uma porta diferente de 4100, avisar o usuário, porque ela deixa de valer.
- [ ] Instalação limpa no Windows: o NSIS per-user instala sem UAC, o atalho abre o app, o backend sobe, o painel carrega.
- [ ] Instalação por cima de uma PWA antiga: os dados aparecem e não sobra `node.exe` nem atalho antigo.
- [ ] Desinstalação preserva os dados (`deleteAppDataOnUninstall: false` + `%LOCALAPPDATA%\HubSnk\dados`).
- [ ] Linux: gerar AppImage + deb e validar o `safeStorage` com o `libsecret`. Remover a instalação antiga do `instalar-hub-snk.sh` (`.desktop` e autostart) na primeira execução.

## Fase 7 — Scripts, CI e documentação

- [ ] `package.json` raiz: scripts `app` (`npm --prefix desktop run start`) e `empacotar-desktop`. Remover `empacotar-windows`, `empacotar-unix`, `gerar-icones` e o hook `version`.
- [ ] `ci.yml`:
  - [ ] Job de typecheck e build do `desktop/`, e teste de fumaça do backend via `/api/healthz`.
  - [ ] Remover os jobs de empacotamento e instalação real da PWA (Linux e macOS).
  - [ ] A matriz de testes do backend pode continuar com macOS (o backend roda lá), mas sem job de distribuição.
- [ ] `distribuicao.yml`: substituir os jobs de zip e tar.gz pelo instalador NSIS (Windows) e AppImage/deb (Linux) na tag `v*`, e publicar na release.
- [ ] Atualizar `README.md` (instalação e uso; aviso de fim do suporte ao macOS), `docs/distribuicao.md`, `docs/estrutura-do-codigo.md`, `docs/api.md` (`/api/healthz` e rotas de sessão), `docs/manutencao.md`, `docs/correcoes-multiplataforma.md` e `CHANGELOG.md` (quebra de compatibilidade: PWA removida, macOS sem distribuição, porta fixa).
- [ ] Atualizar ou remover o `docs/port-sankhya-credenciais-agenda.md`, que está desatualizado (cita a porta 4200 e rotas que não existem mais).

## Fase 8 — Validação funcional (Windows)

- [ ] O app abre em instância única; uma segunda execução foca a janela existente.
- [ ] O painel carrega, com CRUD de clientes, bases, repositórios, links e projetos.
- [ ] Os dados existentes aparecem (`%LOCALAPPDATA%\HubSnk\dados`).
- [ ] Login no ERP e na Experience pelas abas internas; a sessão persiste depois de reiniciar o app.
- [ ] As credenciais são salvas no cofre `safeStorage`; a migração do helper funciona na primeira execução.
- [ ] A agenda de recursos é consultada pelo bridge, e as negociações (FAP) também.
- [ ] Os dados da Experience aparecem (JWT empurrado pelo shell).
- [ ] A aba de base de cliente faz o autofill do login.
- [ ] Bases e bancos locais (WildFly/Docker) iniciam, param e mostram o log em SSE.
- [ ] Abrir pasta, IntelliJ, shell e atalhos cadastrados.
- [ ] Ao fechar o app o backend encerra, sem `node.exe` órfão.
- [ ] O aviso de atualização via GitHub continua funcionando.

## Fase 9 — Remoção da PWA e do instalador antigo (mesma release, D5)

Esta fase faz parte da mesma release e precisa estar concluída antes da tag. A remoção automática da
instalação antiga (Fase 6) usa as regras do `encerrar-hub-snk.vbs` e do `desinstalar-hub-snk.ps1`:
extraia o que for preciso antes de apagá-los.

- [ ] Remover o `public/sw.js`, o `public/manifest.webmanifest`, os ícones de PWA sem uso e o `scripts/sincronizar-versao-do-cache.mjs`.
- [ ] Remover `src/sistema/abrirJanelaDoAplicativo.ts`, `HUB_ABRIR_JANELA`, `HUB_NAVEGADOR`, `HUB_PERMITIR_REDE` e a abertura automática de janela no `src/index.ts`.
- [ ] Remover `instalador/*`, `scripts/empacotar-comum.mjs`, `scripts/empacotar-windows.mjs`, `scripts/empacotar-unix.mjs` e `scripts/gerar-icones.mjs` (os ícones já estão em `desktop/assets`).
- [ ] Remover `iniciar.vbs` e `iniciar.sh`. O modo desenvolvimento passa a ser `npm run dev` (só o backend) + `npm run app` (shell).
- [ ] Remover o `cache-control` específico do `sw.js` em `src/index.ts:35-39`.
- [ ] Confirmar que não sobrou referência: `grep -rn "sw.js\|manifest.webmanifest\|HUB_ABRIR_JANELA\|HUB_NAVEGADOR\|HUB_PERMITIR_REDE\|hub-helper\|abrir-hub-snk" src public docs scripts .github`.
- [ ] Publicar nas notas da release o passo a passo para quem usa a PWA: instalar o `.exe`, que remove a versão antiga e preserva os dados. Para macOS, avisar que não há distribuição nesta versão.

## Riscos

- **Type stripping ou `node:sqlite` no Node embutido no Electron 44:** não verificado. Bloqueia D2 até a Fase 1.
- **Dependência do `hub-helper.ps1` sem versionamento na `dev`:** hoje a integração com o Sankhya depende de um arquivo que está fora do repositório.
- **Senha em texto puro no `clientes.json`:** o shell passa a lê-la para o autofill. Não piora o cenário atual, mas o cofre `safeStorage` do bridge abre caminho para cifrar essas senhas depois (fora do escopo).
- **Encerramento no Windows:** o `kill()` não entrega `SIGTERM`, e o backend pode morrer no meio de uma escrita. A escrita atômica do repositório mitiga no JSON; o SQLite exige validação.
- **Sem rollback fácil (D5):** a PWA some na mesma release. Se o Electron der problema em campo, a saída é reinstalar a versão anterior pelo zip antigo da release. Manter os artefatos da última release PWA publicados no GitHub.
- **macOS sem distribuição (D5 + D6):** quem usa macOS não recebe esta versão. Se houver usuários ativos em macOS, reavaliar D6 antes da release.
- **Remoção automática da instalação antiga:** um erro nessa rotina apaga a pasta errada. Testar com uma instalação PWA real e nunca apagar nada fora de `%LOCALAPPDATA%\Programs\HubSnk`.
- **Portas fixas** (4100, 4102, 4103, 9222): conflito com outro processo impede o boot. O shell precisa mostrar um erro claro.
- **Divergência com a branch do Flaviano:** correções futuras no `desktop/` de lá não chegam aqui sozinhas. Combinar se o `desktop/` da `dev` vira a fonte oficial ou se as duas mantêm cópias.
