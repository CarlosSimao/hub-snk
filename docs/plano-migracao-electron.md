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
| D7  | Git AutoSync no instalador                       | **Mantido no instalador** (mudança de 2026-09-24; a decisão anterior era deixá-lo de fora). O `installer.nsh` do Flaviano e o `preparar-autosync.mjs` ficam; `empacotar:sem-autosync` segue disponível para gerar pacote sem ele.                                         |

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

- [x] Adicionar `GET /api/healthz` (resposta `200 {ok:true}`, sem I/O) em `rotasSistema.ts`, com teste (`rotasSistema.test.ts`).
- [x] Confirmar que `protecaoDeOrigem` aceita:
  - [x] a aba do painel carregada como `http://127.0.0.1:4100` (Host e Origin loopback; já coberto por `protecaoDeOrigem.test.ts`);
  - [x] as chamadas do shell sem `Origin` (validado com `curl`). Uma chamada com `Origin` estranho às rotas de sessão recebe 403 antes mesmo de o token ser conferido.
- [x] Tratar `SIGTERM`/`SIGINT`: fecha o observador da pasta de dados, depois `servidor.close()` com `forceCloseConnections` (uma conexão SSE aberta não segura o encerramento), depois o SQLite da agenda. **Só typecheck**: no Windows não há como mandar o sinal fora de um console interativo; validar com Ctrl+C no `npm start` e no Linux.
  - [x] Rota `POST /api/sistema/encerrar` (decidida em 2026-09-24): exige o token do shell (`src/rotas/autenticacaoDoShell.ts`, compartilhado com as rotas de sessão), responde 202 e só então dispara o mesmo encerramento dos sinais, que roda uma vez só. Testes em `rotasSistema.test.ts`.
- [x] Log do backend legível em arquivo: `pino-pretty` com `colorize: process.stdout.isTTY`. Validado: 0 códigos ANSI no log gravado.
- [x] Portar do Flaviano, adaptando para zod v4 e as convenções da `dev` (nomes em português):
  - [x] `src/sankhya/ponteDoDesktop.ts` (`desktopBridge.ts` do Flaviano), o cliente do bridge, com `SANKHYA_DESKTOP_BRIDGE_URL` (padrão `http://127.0.0.1:4103`) e `DESKTOP_BRIDGE_TOKEN_FILE` (padrão `%APPDATA%\sankhya-hub\ipc\desktop-token.txt`) em `configuracao.ts`. Mantém o mesmo contrato do helper (`requisitar(caminho, init, opcoes)`), sem os métodos de `serverlog`, `secret` e favoritos, que a `dev` não usa.
  - [x] `src/sankhya/sessaoDoDesktop.ts` (`sessaoDesktop.ts` do Flaviano) e as rotas `POST`/`DELETE /api/sankhya/desktop/sessao/:sistema` em `rotasSankhya.ts` (token do bridge; só `sankhya-experience`; corpo validado com zod).
  - [x] Em `src/sankhya/credenciais.ts`: shell primeiro, e o helper só quando o shell está indisponível (um erro de negócio do shell não é repetido no helper). A sessão empurrada tem prioridade em `status`/`revelar` da Experience. As consultas de agenda e negociações passaram a ter timeout de 120 s. `/api/sankhya/helper` passa a responder "shell ou helper no ar".
  - [x] Testes ao lado do código: `ponteDoDesktop.test.ts`, `sessaoDoDesktop.test.ts`, `credenciais.test.ts` (fallback e prioridade da sessão) e `rotasSankhya.test.ts` (autenticação das rotas de sessão).
- [x] `npm run typecheck`, `npm test` (120 testes, 0 falhas) e `prettier --check` verdes. O backend também foi validado rodando no Node do Electron: `/api/healthz` 200, sessão empurrada 200 e fallback para o helper com 503 `helperIndisponivel` quando nenhum dos dois está no ar.

## Fase 3 — Trazer o shell `desktop/`

- [x] `git checkout da69e32 -- desktop/`, commitado sem alterações para a adaptação aparecer como diff próprio. `poc-desktop/` não veio.
- [x] `.gitignore`: o `desktop/.gitignore` do Flaviano já cobre `node_modules/`, `dist/`, `build/` e `.perfil/`; `release/` entrou no da raiz.
- [x] `desktop/src/config.ts`:
  - [x] `HUB_URL` padrão `http://127.0.0.1:4100` (IPv4 explícito: o backend não escuta em `::1`).
  - [x] Entrypoint `src/index.ts`; `cwd` = raiz do projeto, onde estão o `package.json` com `"type": "module"` e o `node_modules`.
  - [x] Removidos `SERVICES_YAML`, `CONFIG_PATH`, `DOCKER_SOCKET`, `WILDFLY_URL` e `ORACLE_HOST`.
  - [x] `DIRETORIO_DE_DADOS`: `%LOCALAPPDATA%\HubSnk\dados` (Windows) ou `$XDG_DATA_HOME/hub-snk/dados` (Linux, o mesmo do `instalar-hub-snk.sh`) empacotado; `<raiz>/dados-hub-snk` em desenvolvimento; `HUB_DADOS_DIR` sobrescreve (D4).
- [x] `desktop/src/backendProcess.ts` reescrito:
  - [x] Passa `ELECTRON_RUN_AS_NODE=1`, `HUB_PORTA`, `HUB_HOST=127.0.0.1`, `HUB_DADOS_DIR`, `HUB_ABRIR_JANELA=0`, `TZ`, `SANKHYA_DESKTOP_BRIDGE_URL` e `DESKTOP_BRIDGE_TOKEN_FILE`. Não passa `HUB_HELPER_*` e remove `HUB_PERMITIR_REDE`/`HUB_NAVEGADOR` herdados (D3/D5).
  - [x] Runtime: sempre `process.execPath` (D2). Removidas a busca por `node` no PATH e a `SANKHYA_HUB_NODE`.
  - [x] Mensagens de erro sem `npm run build`, `desenvolver.ps1` ou Docker; o modo `externo` aponta para `npm run dev`.
  - [x] Encerramento limpo: `POST /api/sistema/encerrar` com o token do shell, espera de 5 s e só então `kill()`/`SIGKILL`. Removido o `reiniciarBackend`, que ninguém chamava.
- [x] Removido o que depende de backend inexistente na `dev`:
  - [x] `primeiroBoot.ts` (`services.yaml`).
  - [x] `lembretes.ts` e as chamadas `avisarAnotacoes`/`avisarServerLog` no `main.ts`.
  - [x] `serverLog.ts` e as rotas `/serverlog/*` do bridge.
  - [x] `navegacaoSkill.ts` e as rotas `/navegacao/*` do bridge.
  - [x] Menu "Skills" em `menu.ts`.
  - [x] ~~`scripts/preparar-autosync.mjs` e os scripts `empacotar:sem-autosync`/`preparar-autosync`~~ — removidos na Fase 3 e **restaurados** quando D7 mudou (mesmo conteúdo do commit de importação `a2e375a`).
- [x] `migracaoNome.ts` removido.
- [x] Identidade (D1): título "HUB SNK" na janela, no `index.html` e no diálogo de erro; `desktop/package.json` com `name` `hub-snk-desktop`, `productName` "HUB SNK" e versão 1.1.0 (a mesma da raiz). O ícone de `desktop/assets` já é idêntico ao `instalador/hub-snk.ico` (mesmo MD5). Rótulos das guias (`Painel`/`Sankhya Om`/`Experience`) mantidos. O `appId` fica no `electron-builder.yml`, na Fase 6.
- [x] `desktop/package.json`: `start` = `tsc` + `electron .`, sem `build` na raiz.
- [x] `npm install` e `npm run build` no `desktop/` compilam sem erro.
  - **Atenção:** o npm 11.16 bloqueia scripts de instalação por padrão, e o `postinstall` do `electron` (que baixa o binário) não roda. O `allowScripts` foi gravado no `desktop/package.json` com `npm approve-scripts electron`, mas mesmo assim foi preciso rodar `node node_modules/electron/install.js`. Documentar no README (Fase 7) e tratar no CI.
- [x] Validação real (Windows, porta 4199 e dados no scratchpad, para não colidir com o HUB SNK em uso):
  - [x] O shell subiu o backend pelo Node do Electron, e o painel carregou na guia Hub (captura de tela conferida).
  - [x] O bridge respondeu em 4103 (`/health` com `cofre: true`); `/api/sankhya/helper` = disponível e `/api/sankhya/credenciais`/`navegador` responderam **pelo shell**, sem helper no ar.
  - [x] Ao fechar a janela: `backend-parando` e depois `backend-encerrado`, sem `backend-kill-forcado`; o backend respondeu 202 ao encerrar; o `sankhya.db` ficou sem `-wal`/`-shm` (SQLite fechado direito); nenhum `electron.exe` sobrou.
- [x] Prettier aplicado ao `desktop/` num commit separado, só de formatação.

## Fase 4 — Adaptar o contrato shell ↔ backend

- [x] `tabs.ts` (carga das abas por base): lê o array de `GET /api/clientes` com as bases de cada cliente (`id`, `url`, `tipo`, `usuario`; da senha guarda só se existe) e monta um mapa novo a cada leitura, para uma base removida deixar de abrir aba. Os IDs passaram a ser `string` (UUID).
- [x] Autofill (decidido em 2026-09-24: rota dedicada): `POST /api/clientes/:id/bases/:idBase/senha`, exige o token do shell e devolve só `{ senha }`. O `autofill.ts` a chama só na hora de preencher. Testes em `rotasClientes.test.ts` (200 com token, 401 sem token e sem vazar a senha, 404 para base inexistente).
  - Observação: o `GET /api/clientes` continua devolvendo as senhas para a tela, como hoje. A rota dedicada evita que o shell as mantenha em memória, mas não fecha esse caminho. Cifrar as senhas do cadastro segue fora do escopo (ver Riscos).
- [x] Recarregar as bases quando o cadastro muda: o shell do Flaviano só lia no boot. Agora, um link do painel para uma origem desconhecida relê o cadastro antes de decidir, e uma base cadastrada depois do boot abre como aba (validado).
- [x] `backendClient.ts` já aponta para `POST`/`DELETE /api/sankhya/desktop/sessao/sankhya-experience` (Fase 2); só o comentário foi corrigido.
- [x] Bridge (D3):
  - [x] Agenda: o backend chama o `/agenda/fetch`, que já existia no bridge, em vez de `/browser/agenda`, e os tipos passaram a `{ conteudo }`.
  - [x] Negociações: nova rota `POST /agenda/negociacoes` (`{ codParceiro }` numérico). `AgendaFetcher.buscarNegociacoes` porta o `Get-NegociacoesDoParceiro` do `hub-helper.ps1` (o `ServiceProxy` do iframe `AgendaRecursos.xhtml5`, com `mgeos@AgendaRecursosSP.getNegociacoes`), na mesma fila serial da agenda.
  - [x] Contrato de `/credentials/*` e `/browser/status|abrir|capturar|fechar` conferido com o `credenciais.ts` da `dev`: os campos batem e os erros vêm em `{ erro }`, que é o que a `PonteDoDesktop` lê.
  - [x] `migracaoCofre.ts` mantido.
- [x] Caminho do helper removido do backend: `src/sankhya/helper.ts`, o fallback em `credenciais.ts`, `HUB_HELPER_URL`/`HUB_HELPER_TOKEN_FILE` e `normalizarLista` (que existia só por causa do PowerShell). O tratamento de erro duplicado em `rotasSankhya.ts`/`rotasAgenda.ts` virou `src/rotas/respostasDoShell.ts`. **O campo `helperIndisponivel` da resposta 503 foi mantido**, porque a tela ainda o lê (`app.js:587,3067`); troca na Fase 5.
- [x] Padrão do `DESKTOP_BRIDGE_TOKEN_FILE` no backend corrigido para Linux (`~/.config`, igual ao `app.getPath('appData')` do shell). Antes virava um caminho relativo sem `%APPDATA%`.
- [x] Política de pop-up e navegação da guia do painel (`tabs.ts`):
  - [x] Mesma origem do hub (`log.html`): janela filha na mesma partição, sem preload (validado).
  - [x] Base cadastrada: aba própria com autofill (já existia).
  - [x] `localhost` que não é o hub: aba local (já existia).
  - [x] Qualquer outro `http(s)` (links de cliente e de projeto, GitHub, release): abre no navegador do sistema (`shell.openExternal`). Antes era negado em silêncio. Outros esquemas (`mailto:`, `file:`…) são recusados e registrados no log (validado).
  - [x] `will-navigate` na guia do painel: um link sem `target` para fora do hub não tira mais o painel da guia; abre no navegador do sistema.
- [x] **Correção de segurança herdada do shell do Flaviano:** uma janela filha (ex.: `log.html`, pop-up de SSO) não tinha política própria, e o `window.open` dela abria qualquer endereço numa janela nova sem restrição (reproduzido via CDP). Agora a filha herda a política de quem a abriu: filha do painel segue a política do painel; filha de ERP/Experience só abre domínio da lista de SSO.
- [x] **Correção herdada:** fechar a janela principal com uma janela filha aberta não encerrava o app (o `window-all-closed` não dispara), e app e backend ficavam de pé. Agora `closed` da principal chama `app.quit()` (validado: backend saiu com código 0 depois do 202 do encerrar).
- [x] Validação real no app (porta 4199, dados no scratchpad): `/api/agenda/consultar` e `/api/agenda/situacao-do-dia` chegaram à aba ERP pelo bridge. Com a aba deslogada, o Sankhya respondeu status 3 e depois "tela da Agenda de Recursos não está aberta". Rota da senha: 200 com token e 401 sem. Typecheck, 125 testes e prettier verdes.
- [ ] **Não validado com sessão real:** agenda e negociações com login de verdade no ERP e a tela da Agenda de Recursos aberta; autofill numa base real. Entram na Fase 8.

## Fase 5 — Frontend `public/` dentro do shell

O frontend passa a rodar só dentro do shell (D5), então não há modo condicional por `?desktop=1`.

- [x] Registro do `sw.js` removido do `app.js`. No lugar, `removerServiceWorkerDaVersaoPwa()` desfaz qualquer registro que tenha sobrado, para quem abrir o painel num navegador com o cache da versão PWA. Validado no app: nenhum SW registrado.
- [x] Login e captura: o botão "Abrir navegador" virou **"Abrir guia"**, que troca para a guia Sankhya Om/Experience do app (validado). "Capturar sessão" continua. O botão "Fechar navegador" saiu, porque no shell era um no-op.
- [x] Aviso de indisponibilidade: `helperIndisponivel` virou `shellIndisponivel` (backend e tela), `/api/sankhya/helper` virou `/api/sankhya/shell`, e `aviso-helper-*`/`.aviso-helper` viraram `aviso-shell-*`/`.aviso-shell`. Os textos passaram a falar do aplicativo HUB SNK. Validado com o backend sozinho: 503 com `shellIndisponivel: true` e `disponivel: false`.
- [x] Linha "Navegador aberto (N guias)" removida do modal. A troca por um status por guia foi testada e descartada: a heurística do shell (URL sem "login" = logado) marcou o ERP como **logado com a tela de login aberta**. Sem sinal confiável, a linha mentiria. Saíram junto `GET /api/sankhya/navegador`, `Credenciais.statusNavegador` e os tipos `StatusNavegador`/`AbaNavegador`. No bridge sobra o `/browser/status`, sem uso pela `dev`.
- [x] Rotas do bridge sem uso removidas: `POST /browser/fechar` e `POST /browser/favoritos` (no-ops). `GET /browser/favoritos` fica; a `dev` lê os favoritos pelo arquivo escolhido na tela.
- [x] Links de base (`app.js:850,1585`) continuam `target=_blank`, e o shell os converte em aba com autofill (validado na Fase 4).
- [x] Removidos do `index.html`: o link do `manifest.webmanifest` e o `apple-touch-icon`. Os arquivos `sw.js`/`manifest.webmanifest` somem na Fase 9.
- [x] Typecheck, 125 testes e prettier verdes.
- [ ] Atualizar `docs/api.md` com `/api/sankhya/shell` e sem `/api/sankhya/navegador*`/`fechar` (Fase 7).

## Fase 6 — Empacotamento

- [x] `desktop/scripts/preparar-hub.mjs` reescrito:
  - [x] Sem build: copia `src/` e `public/` (sem `*.test.ts`/`*.test.js`), `package.json`, `package-lock.json` e `LICENSE`.
  - [x] `npm ci --omit=dev` em `build/hub` (84 pacotes, 28 MB, 0 vulnerabilidades).
  - [x] Valida `build/hub/src/index.ts` e `node_modules`. Validado rodando o backend de dentro de `build/hub` pelo Node do Electron: `/api/healthz` e painel com 200.
  - [x] Filtro de testes feito no próprio script, e não reaproveitando `scripts/empacotar-comum.mjs`, porque este sai na Fase 9.
- [x] `electron-builder.yml`:
  - [x] `appId` `br.dev.hubsnk.desktop`, `productName`/`shortcutName` "HUB SNK", `artifactName` `HUB-SNK-Setup-${version}.${ext}` (Linux: `hub-snk-${version}-${arch}.${ext}`), `copyright` do autor do projeto (D1).
  - [x] As duas entradas de `extraResources` (`build/hub` e `build/hub/node_modules`) mantidas; entrou `instalador/*.ps1`, fora do `app.asar`, porque o PowerShell não lê dentro do asar.
  - [x] Alvos: NSIS (Windows x64), AppImage + deb (Linux x64). Sem `dmg` (D6).
  - [x] `build/git-autosync` mantido no `extraResources` e o `include: installer.nsh` (D7). A macro `customInstall` do Flaviano virou `GasInstalar`, chamada pela `customInstall` nova depois da remoção da versão PWA.
  - [x] Git AutoSync: repositório `https://github.com/FlavianoRS/git-autosync` clonado em `C:\Workspace\scripts\git-autosync` (o caminho padrão do `preparar-autosync.mjs`).
    - **Usar a branch `master` (4.0.0), não a `main` (3.10.0, a padrão do GitHub).** Só a `master` tem o `installer/install-standalone.ps1` que o `installer.nsh` chama. As duas divergiram: a `master` tem 11 commits que a `main` não tem, e a `main` tem 3 que a `master` não tem. Avisar o Flaviano para unificar.
    - Binários gerados com `pythonuild_windows.ps1`, num venv em `python\.venv` (Python 3.14.6, PyInstaller 6.22.3, dependências do `requirements-dev.txt`), sem instalar nada no Python global: `git-autosync.exe` (19,7 MB) e `git-autosync-sync.exe` (9,0 MB).
    - `node scripts/preparar-autosync.mjs` montou o `desktop/build/git-autosync` e o `gas-version.nsh` (`GAS_VERSION "4.0.0"`).
  - [ ] Validar a página de componentes do instalador (instalar, tarefa diária, bandeja, atalhos, skills, PATH) e a desinstalação do autosync pelo NSIS.
  - [ ] CI (`distribuicao.yml`): de onde vêm os binários do Git AutoSync no build de release (checkout do outro repositório ou artefato publicado).
- [x] Remoção da instalação PWA antiga (D5): `desktop/instalador/remover-versao-pwa.ps1`, chamado pelo `customInstall` do `installer.nsh` em toda instalação. Falha não aborta: o instalador avisa e aponta o log.
  - [x] Reconhece a instalação só se a pasta tiver `abrir-hub-snk.vbs` **e** `src\index.ts`. Um `HUB_PROGRAMA_DIR` apontando para outra pasta não apaga nada.
  - [x] Encerra `node.exe`/`cmd.exe` com `<programa>\src\index.ts` na linha de comando e o `wscript.exe` do launcher.
  - [x] Atalhos (Menu Iniciar, Inicializar, Área de Trabalho): remove só os que apontam para o `abrir-hub-snk.vbs` antigo. O atalho novo do NSIS tem o **mesmo nome** (`HUB SNK.lnk`), e apagar pelo nome o levaria junto.
  - [x] Remove `hub-snk.env`, `hub-snk.log` e `navegador.txt`. **Nunca toca a pasta de dados.**
  - [x] Do programa, apaga só os itens do pacote PWA. O que sobrar vai para `%LOCALAPPDATA%\HubSnk
estos-da-versao-pwa-<data>`. Na instalação real, sobram `log\server.log*` (logs do WildFly que caíram ali) e uma pasta com UUID.
  - [x] `HUB_DADOS_DIR` personalizado no `hub-snk.env`: o caminho vai para `%LOCALAPPDATA%\HubSnk\pasta-de-dados.txt`, que o shell lê (`pastaDeDadosEscolhidaNaVersaoPwa` em `desktop/src/config.ts`; o `trim()` também descarta o BOM do PowerShell).
  - [x] `HUB_PORTA` diferente de 4100: registra um aviso no log.
  - [x] Log em `%LOCALAPPDATA%\HubSnk
emocao-da-versao-pwa.log` e na tela de detalhes do NSIS.
  - [x] Compatível com o Windows PowerShell 5.1: UTF-8 com BOM, CRLF e sintaxe validada pelo parser do 5.1.
  - [x] **Teste em cópia simulada** (`scratchpad\sim`), com backend falso rodando, atalhos antigos, atalho "novo" com o mesmo nome, dados padrão e personalizados, porta 4150 e itens estranhos na pasta do programa:
    - processos encerrados;
    - os 2 atalhos antigos removidos e o novo mantido;
    - `pasta-de-dados.txt` gravado;
    - aviso de porta registrado;
    - estado removido;
    - `log/` e UUID movidos para `restos-*`;
    - os dois `clientes.json` intactos;
    - código de saída 0.
  - [x] Segunda execução: não faz nada, código 0.
  - [x] Trava: com o `hub-snk.env` apontando para uma pasta que não é a PWA, a pasta ficou intacta e só a configuração saiu.
- [x] Instalador gerado: `release/HUB-SNK-Setup-1.1.0.exe` (146 MB, com o Git AutoSync 4.0.0). `release/win-unpacked` validado com dados e porta de teste: o backend subiu de `resources\hub\src\index.ts` pelo próprio `HUB SNK.exe`, e o encerramento foi limpo (SQLite sem `-wal`, nenhum processo sobrando).
- [x] **Instalação por cima da PWA real** (2026-09-24, com backup prévio do cadastro no scratchpad):
  - [x] O NSIS per-user instalou sem UAC em `%LOCALAPPDATA%\Programs\HUB SNK` (a pasta vem do `productName`, não `hub-snk-desktop`) e abriu o app no fim.
  - [x] Versão PWA removida: `Programs\HubSnk`, `hub-snk.env` e `hub-snk.log`. `log/` (16 `server.log*` do WildFly) e a pasta UUID foram para `restos-da-versao-pwa-20260924-124653`. Nenhum `node.exe` antigo sobrou.
  - [x] Atalhos: o NSIS **sobrescreve** os `HUB SNK.lnk` antigos (mesmo nome) antes do `customInstall`, então o script os encontrou já apontando para o app novo e corretamente os manteve. Resultado: Menu Iniciar e Área de Trabalho apontam para `Programs\HUB SNK\HUB SNK.exe`, e não há atalho na pasta Inicializar.
  - [x] Cadastro intacto: `clientes.json` com o mesmo SHA-256 de antes; 32 clientes no arquivo e 32 pela API; 38 bases carregadas como abas pelo shell.
  - [x] Backend subindo de `resources\hub\src\index.ts` pelo `HUB SNK.exe` na 4100; `/api/healthz` ok e `/api/sankhya/shell` disponível.
  - [x] Git AutoSync 4.0.0 instalado pelo instalador (`~/.git-autosync`, tarefa `GitAutoSyncPy` pronta, `instalado-pelo-hub.txt` gravado).
  - Observação: o primeiro boot levou 9 s até o `/api/healthz` (1,5 s nos testes). Provável varredura do antivírus na primeira execução; conferir nas próximas aberturas.
- [x] Página do Git AutoSync no instalador (instalação validada acima).
- [ ] Desinstalação do Git AutoSync pelo desinstalador do HUB SNK.
- [ ] Desinstalação preserva os dados (`deleteAppDataOnUninstall: false` + `%LOCALAPPDATA%\HubSnk\dados`).
- [ ] Linux: gerar AppImage + deb (precisa de máquina Linux: o PyInstaller não faz cross-compile e o electron-builder não gera AppImage no Windows), validar o `safeStorage` com o `libsecret` e remover a instalação antiga do `instalar-hub-snk.sh` (`.desktop` e autostart). **Ainda não implementado.**
- [ ] Assinatura: o `electron-builder` rodou o `signtool`, mas sem certificado o `.exe` sai sem assinatura, e o SmartScreen vai avisar na primeira execução.

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
