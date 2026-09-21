# Sankhya Hub sem Docker — plano de migração

Objetivo: instalar o hub numa máquina qualquer com um `.exe`, sem Docker Desktop, sem
rodar script à mão e sem janela de console aparecendo. O shell desktop (`desktop/`),
que na Fase 2 da migração anterior era acessório do container, passa a ser o hospedeiro.

## Fase 1 — o Electron hospeda o backend ✅ concluída

O shell sobe `dist/index.js` como processo filho e o encerra junto com o app.

| Arquivo | Papel |
|---|---|
| `desktop/src/backendProcess.ts` | Ciclo de vida do backend: escolhe o runtime, sobe, espera `/api/healthz`, encerra |
| `desktop/src/config.ts` | Caminhos e portas do backend hospedado (`RAIZ_PROJETO`, `DATA_DIR`, `DOCKER_SOCKET`, ...) |
| `desktop/src/main.ts` | Sobe o backend antes da janela; segura o `before-quit` até o filho morrer |
| `src/docker.ts` | Docker Engine API por named pipe do Windows, além do unix socket |
| `src/index.ts` | Default de `DOCKER_SOCKET` por plataforma |

Três modos, decididos em ordem, em `iniciarBackend()`:

1. `SANKHYA_HUB_BACKEND=externo` — não sobe nada, só espera. É o que `desenvolver.ps1`
   e o container querem.
2. Alguém já responde em `/api/healthz` — reusa. Sem isto, abrir o shell com o container
   de pé daria `EADDRINUSE` e, pior, dois backends disputando o mesmo SQLite.
3. Ninguém respondendo — spawn, com `windowsHide: true`.

Duas decisões que valem registro:

- **`HOST=127.0.0.1` forçado.** O default do backend é `0.0.0.0`, inofensivo dentro do
  container porque a publicação da porta já prendia no loopback. Nativo no Windows essa
  segunda barreira não existe, e o painel não tem autenticação nenhuma.
- **Runtime é um `node.exe` real**, procurado no PATH. O fallback
  (`ELECTRON_RUN_AS_NODE`) mantém o hub de pé numa máquina sem Node, mas o `oracledb` é
  addon nativo compilado contra o ABI do Node — no fallback o check do Oracle não carrega.
  A Fase 2 remove a ressalva.

### Verificado

- Backend nativo responde `/api/healthz` com `dockerAvailable: true` — pipe funcionando
  nas duas grafias (`\\.\pipe\...` e `//./pipe/...`); pipe inexistente devolve
  `available=false` em vez de travar.
- `inspect` real do container `sankhya-hub` pelo pipe.
- Porta escutando só em `127.0.0.1`.
- Fechar a janela encerra o backend junto — sem processo órfão, porta liberada.
- `npm test`: 264/264.

### Como rodar

```powershell
npm run app          # builda o hub, builda o shell e abre o Electron
```

## Fase 2 — Oracle nativo ❌ cancelada

**Decisão do usuário:** dispensar o Instant Client e trocar o check.

O `type: oracle` era o **único** consumidor de `oracledb` no projeto, com **uma** instância
no `services.yaml`. Ele exigia o Thick mode porque o ambiente é Oracle XE 11.2 e o driver
Thin só fala com 12.1+ — e era, sozinho, a razão de o instalador precisar carregar 50 MB
de cliente Oracle, `electron-rebuild` e VC++ Redistributable.

O que o monitoramento **não** usava Oracle, e por isso não foi afetado: as bases dos
clientes são medidas por HTTP (um GET na tela de login, extraindo `SYSVERSION`), e os
dados de banco do cartão do cliente são guardados e revelados para uso manual, nunca
usados para conectar.

No lugar, dois checks:

| Check | O que vê |
|---|---|
| `oracle` (`tcp` na 1521) | O listener aceita conexão |
| `oracle-container` (`docker`) | Estado, health e reinícios do `skdev-oracle` |

Não são redundantes: a porta pode aceitar conexão enquanto o container reinicia em laço, e
o container pode estar `running` com o listener ainda subindo.

**O que se perdeu:** autenticação real, distinção entre instância `MOUNTED` e banco
aberto, e os indicadores de sessões/uptime/versão.

**O código do check continua no hub** (`src/checks/oracle.ts`, com `ORACLE_CLIENT_DIR`
para apontar o Instant Client). Para voltar atrás, basta trocar o tipo no YAML. O que saiu
foi o download automático (`desktop/src/oracleClient.ts`), que era o peso no instalador.

## Fase 3 — migrar os helpers PowerShell ✅ concluída

### 3.1 Credenciais ✅

`/credentials` sai do `hub-helper.ps1`.

| Arquivo | Papel |
|---|---|
| `desktop/src/cofreCredenciais.ts` | Cofre com `safeStorage` (que é DPAPI no Windows), em `userData/credenciais.json` |
| `desktop/src/migracaoCofre.ts` | Puxa o que o helper já guardava, uma vez, enquanto ele ainda existe |
| `desktop/src/bridgeServer.ts` | Rotas `/credentials/*` com o mesmo contrato do helper |
| `src/sankhya/credenciais.ts` | Shell primeiro, helper como retaguarda |

Duas decisões:

- **Só a indisponibilidade do shell faz cair para o helper.** Se o shell respondeu com
  erro de negócio, repetir no helper daria a mesma resposta e mascararia o erro real.
- **O token do bridge passou a nascer no boot**, como o do helper. Antes só nascia na
  primeira chamada partindo do shell (o push da sessão da Experience) — num perfil que
  nunca logou na Experience isso não acontecia nunca, e o backend ficava sem token,
  caindo eternamente para o PowerShell. Bug encontrado testando esta fase.

Ganho de exposição: o helper escuta em **todas as interfaces** (porta 4102), e
`/credentials/:sistema/reveal` devolve senha em texto claro. O bridge escuta só em
`127.0.0.1`.

Verificado com perfil isolado (`--user-data-dir`), para não tocar nas credenciais reais:

- Gravar, consultar, revelar e remover pelo bridge; `usuario` com espaços é aparado.
- Senha cifrada em disco — o `credenciais.json` não tem texto claro.
- Sem token: HTTP 401. Sistema desconhecido: HTTP 404.
- `GET /api/sankhya/credenciais` no backend devolveu o valor gravado no cofre do shell,
  com o helper fora do ar.
- 6 testes novos cobrindo preferência pelo shell e fallback.

### 3.2 WildFly ✅

`wildfly-helper.ps1` (4100) e `wildfly-log-helper.ps1` (4101) saem de cena. As duas
escutavam em **todas as interfaces, sem token nenhum**: qualquer aparelho da rede local
derrubava o WildFly ou lia o `server.log`.

| Arquivo | Papel |
|---|---|
| `src/wildfly.ts` | Detecta a instalação, identifica o processo, sobe/mata/reinicia |
| `src/routesWildfly.ts` | Status, operações e o `server.log` ao vivo (SSE) |
| `src/actions.ts`, `src/config.ts` | Novo tipo de ação `wildfly`, também como passo de `sequence` |
| `config/services.yaml` | As ações deixam de ser `type: http` para uma porta de helper |

Decisões:

- **Novo tipo de ação em vez de URL.** As ações apontavam para
  `http://host.docker.internal:4100/iniciar`. Agora são `type: wildfly`, e o
  `src/wildfly.ts` decide sozinho: nativo no Windows faz spawn; em container delega ao
  helper por HTTP. O YAML fica igual nos dois mundos.
- **Uma dependência do Windows permanece.** Descobrir a linha de comando de um processo
  não tem API em Node, então a detecção usa `Get-CimInstance` por um `powershell.exe`
  pontual e oculto. O que some é o servidor HTTP aberto na rede, não o PowerShell.
- **A espera do restart usa `kill(pid, 0)`**, não uma nova listagem. Cada `powershell.exe`
  custa ~2s; com re-listagem, a espera de 20s viraria meia dúzia de amostras.

#### Verificado

- Detecção bateu com a realidade da máquina: instalação em `C:\wildfly_producao` (a
  config do usuário), WildFly parado — confirmado por `Get-CimInstance` à parte.
- `server.log` ao vivo: carga inicial das últimas linhas **e** linhas novas chegando
  durante o stream.
- Duas conexões simultâneas e uma ação respondendo com o log aberto — o helper antigo
  travava as ações enquanto um popup de log estivesse aberto (listener single-threaded).
- `npm test`: 280/280, com 10 testes novos. O que mais importa ali é a identificação da
  instalação: `C:\wildfly_producao` e `C:\wildfly_producao2` coexistem nesta máquina, e
  um `contains` cru mataria as duas.

**Não exercitado:** iniciar/parar/reiniciar de verdade — exigiria derrubar o WildFly do
usuário. A validação de caminho inválido e a identificação de processo estão cobertas; o
spawn em si é uma linha (`cmd.exe /c standalone.bat`, `detached`, `windowsHide`).

### 3.3 Segredos avulsos ✅

`/secret/encrypt` e `/secret/decrypt` saem do helper. São as senhas das bases dos
clientes (`cartao.ts`) e a senha do app do Gmail (`emailInterno.ts`) — N por cliente, e
quem sabe a qual base cada uma pertence é o hub, que guarda os blobs no SQLite dele.

| Arquivo | Papel |
|---|---|
| `src/sankhya/cifra.ts` | Decide quem cifra e quem decifra, pela marca do blob |
| `src/sankhya/migracaoSegredos.ts` | Recifra no boot o que o helper gravou |
| `desktop/src/cofreCredenciais.ts` | `cifrarSegredo`/`decifrarSegredo` com `safeStorage` |
| `desktop/src/bridgeServer.ts` | Rotas `/secret/*`, mesmo contrato do helper |

**A decisão central é o prefixo `sb1:`.** Dois produtores de blob convivem durante a
transição, e um não abre o do outro — o helper usa `ProtectedData` cru, o shell usa o
envelope do `safeStorage`. Sem a marca, a única forma de descobrir isso seria tentar
decifrar e falhar, e falha de decifragem é **indistinguível** de "senha gravada noutro
usuário do Windows", que é um problema real e de outra natureza. Com a marca:

- **Cifrar** é redirecionável — shell na frente, helper como retaguarda. O resultado
  carrega a marca de quem cifrou.
- **Decifrar não é.** A marca decide, não a disponibilidade. Blob do shell sem shell no
  ar levanta erro explicando o que fazer, em vez de tentar no helper e devolver uma
  mensagem que mandaria o usuário procurar defeito na credencial dele.

A marca resolve a correção, mas não a dependência: senha antiga seguiria exigindo o
helper para sempre. Daí a migração no boot, que recifra os blobs antigos quando os dois
lados estão no ar — precisa do helper para abrir o velho e do shell para gravar o novo.
É idempotente e oportunista: se o helper não abrir um blob, aquele valor fica como está
e conta como pendente. Perder a senha do cliente para "adiantar" a migração seria o pior
negócio possível.

#### Verificado

- `safeStorage` real, em perfil isolado: ida e volta pelo bridge, marca presente, sem
  texto claro no blob, 401 sem token.
- Blob sem marca recusado com mensagem específica em vez de erro genérico de cripto.
- **Ponta a ponta pelo backend**: criar base com senha pela API gravou `sb1:…` no SQLite
  (sem texto claro) e `POST /bases/:id/revelar` devolveu a senha original — tudo sem o
  helper PowerShell no ar.
- Os três alvos da migração conferidos contra o `sankhya.db` real: nome errado de tabela
  ou coluna não levanta erro nenhum, a migração só não acharia nada, em silêncio.
- `npm test`: 296/296 (16 testes novos).

### 3.4 Pastas e caminhos do WildFly ✅

`/pastas`, `/wildfly/config` e `/wildfly/detectar` saem do helper. São `fs` puro, sem
processo nenhum no meio.

| Arquivo | Papel |
|---|---|
| `src/pastas.ts` | Navegação de pastas e unidades do disco |
| `src/wildfly.ts` | `config()`, `gravarConfig()` e `detectar()` |
| `src/routesSankhya.ts` | As três rotas passam a chamar o caminho nativo |

Detalhes que parecem acidente do helper e não são — estão travados por teste:

- **Pasta oculta aparece.** Sem isso, um repositório dentro de uma delas some da tela e
  o usuário acha que sumiu do disco.
- **`pai` vazio no topo da unidade.** É dali que o "voltar" leva de volta à lista de
  unidades, em vez de travar na raiz.
- **Log em branco vira o caminho padrão da instalação**, poupando digitar duas vezes.
- **Pasta sem `bin\standalone.bat` é recusada na hora de salvar**, com HTTP 400 e
  mensagem específica — não como "helper indisponível". Descobrir isso só quando o
  Iniciar falha manda procurar defeito no lugar errado.

Nota de arquitetura: `/wildfly/config` e `/wildfly/detectar` moravam no
**`hub-helper.ps1` (4102)**, não no `wildfly-helper.ps1` (4100) que controla o processo.
São dois helpers diferentes em portas diferentes, e o modo container precisa de ambos —
por isso `Wildfly` recebe o `HubHelper` além da URL do outro.

#### Verificado

Com `WILDFLY_CONFIG_FILE` isolado, para não tocar no `wildfly.json` real:

- Unidades do disco listadas; raiz com `pai` vazio; pasta oculta presente.
- Caminho inexistente e arquivo no lugar de pasta: HTTP 404 com mensagem própria.
- `PUT` com `C:\Windows`: HTTP 400 explicando que não é instalação do WildFly.
- `PUT` válido preencheu o `server.log` sozinho e mediu que ele existe.
- **Detecção achou as duas instalações reais da máquina** (`wildfly_producao` e
  `wildfly_producao2`) em 8 ms, sem repetir — o mesmo par que a identificação de
  processo protege.
- `npm test`: 308/308 (12 testes novos).

### 3.5 git-autosync e evidência por IA ✅

| Arquivo | Papel |
|---|---|
| `src/gitAutosyncCli.ts` | Executa o CLI direto; mesma assinatura de transporte do `HubHelper` |
| `src/evidenciaIa.ts` | Roda o agente de IA local (claude/codex/opencode) |
| `src/gitAutosync.ts` | Passa a aceitar qualquer `TransporteAutosync` |

**O `src/gitAutosync.ts` não mudou de comportamento nem uma linha.** O CLI nativo
implementa a mesma assinatura do `HubHelper.requisitar`, então trocar o transporte no
`index.ts` é tudo o que separa os dois mundos.

Decisões preservadas do helper, porque nenhuma delas é estética:

- **Nunca chamar o `.bat`.** O launcher é resolvido para `python.exe` + `app.py`, e o
  spawn é sem `shell` em lugar nenhum. Chamar o `.bat` passaria pelo `cmd.exe`, que
  reinterpreta `&`, `|`, `^` e `%` **dentro** de argumentos já entre aspas — e o caminho
  do repositório vem do painel (BatBadBut, CVE-2024-24576).
- **Ação de escrita sem `caminho` é recusada antes de qualquer processo.** Sem `--repo`,
  o CLI opera sobre o diretório atual e commitaria o repositório errado.
- **`exclude`/`include` não são `remove`/`add`.** Um alvo `root` cobre N repositórios;
  `remove` apagaria a raiz e levaria todos junto.
- **O diff vai embutido no prompt e o agente roda com `cwd` num diretório temporário
  vazio**, com as ferramentas de arquivo desligadas. Não protege contra agente malicioso;
  protege contra ele mexer no repositório ao tentar "ajudar".

#### Dois defeitos que só a execução real revelou

1. **`PYTHONIOENCODING=utf-8` faltando.** Sem isso o Python do venv escreve no code page
   do console (cp1252 nesta máquina) e **estoura** ao encontrar emoji — e o
   `status --json` traz emoji de mensagem de commit. A rota inteira falhava com
   `'charmap' codec can't encode character`. O helper define a mesma variável, pelo
   mesmo motivo.
2. **`ConvertTo-Json -AsArray` não existe no `powershell.exe` 5.1.** Com a flag, o
   comando falha inteiro e a lista de tarefas volta **vazia** — como se não houvesse
   agendamento nenhum. Trocado por `@(...)`.

Nenhum dos dois apareceria em teste de unidade: os dois exigem o CLI e o Agendador reais.

#### Verificado

- Aba Git inteira pelo backend nativo: 13 repositórios, as 2 tarefas reais do Agendador
  (`GitAutoSyncDemandas`, `GitAutoSyncPy`), horário `17:40`, última execução e o agente
  de IA configurado.
- `commit` sem caminho: HTTP 400 com `envie { caminho }`.
- **Evidência por IA com o `claude` real**: 15s, 615 caracteres, sem markdown, em
  linguagem de negócio — exatamente o contrato do prompt.
- As três guardas de uso (caminho que não é repositório, data fora do formato, período
  sem commit) devolvem cada uma a sua mensagem.
- `npm test`: 326/326 (18 testes novos).

### 3.6 Navegador ✅

A última rota do `hub-helper.ps1`, e a que mais muda o que o usuário vê.

Antes: o helper abria uma **segunda janela do Chrome**, com perfil próprio em
`%APPDATA%\sankhya-hub
avegador`, subia o DevTools na porta 9222 e lia a sessão por
CDP. Tudo isso existia porque o hub rodava num container e não tinha navegador nenhum.

Agora o shell **é** o navegador: as abas ERP e Experience já estão abertas nele, e ler a
sessão é `session.cookies`. Some o CDP, some a 9222, some o Chrome paralelo — e some
junto a restrição do Chrome 136 (que recusa DevTools no perfil padrão), que era a razão
de existir todo o mecanismo de copiar favoritos para um perfil separado.

| Arquivo | Papel |
|---|---|
| `desktop/src/navegador.ts` | Status, telas, favoritos, abrir aba e capturar sessão |
| `desktop/src/bridgeServer.ts` | Rotas `/browser/*`, mesmo contrato do helper |
| `src/sankhya/credenciais.ts` | As seis chamadas passam a preferir o shell |

Duas rotas mudaram de sentido, e respondem explicando em vez de falhar:

- **`POST /browser/fechar`** fechava a janela do Chrome do hub. Aqui a janela é o próprio
  aplicativo, e fechá-la seria encerrar o hub.
- **`POST /browser/favoritos`** copiava o arquivo de favoritos para o perfil separado.
  Não há mais para onde copiar. A **leitura** (GET) continua servindo ao cadastro de
  cliente, que era o uso real.

Regras herdadas do helper, preservadas porque evitam "capturei" mentiroso:

- Para a Experience, a ausência do **token** é o único teste honesto de "está logado":
  cookie anônimo existe antes do login e daria falso positivo.
- Para o ERP, sem cookie nenhum do domínio não há o que capturar.

#### Verificado

Com perfil isolado (`--user-data-dir`), sem tocar na sessão real:

- `status`: detectou os **2 perfis reais** com favoritos (Chrome `Profile 1`, Edge
  `Default`), com os nomes lidos do `Preferences`.
- `favoritos`: 40 favoritos reais do Chrome, somente leitura.
- `abrir`: navegou a aba e devolveu a URL com o `resource` em base64 — mesmo formato do
  helper. Tela desconhecida → 400; sistema inválido → 404.
- `capturar` do ERP: 2 cookies, gravados **cifrados** no cofre.
- `capturar` da Experience: **recusado** mesmo havendo cookies, porque não havia JWT — a
  regra sutil funcionando.
- **Ponta a ponta com o helper fora do ar**: `GET /api/sankhya/helper` respondeu
  `{"disponivel":false}` e, ao mesmo tempo, `/api/sankhya/navegador` trouxe perfis, telas
  e abas, e `/api/sankhya/credenciais` mostrou `sessaoCapturada: true`. **O hub inteiro
  funciona sem o `hub-helper.ps1`.**

**Lacuna honesta:** `desktop/` não tem suíte de testes configurada, então o código do
shell (cofre, navegador, backendProcess, oracleClient) é coberto por exercício real e
pelos testes do backend que o consomem, não por teste unitário próprio.

## Migração executada — 18/09/2026

Roteiro rodado no ambiente real, com backup em `data/backup-20260918-135227/`.

1. `docker compose down` — container do hub removido; o `skdev-oracle` ficou de pé.
2. `hub-helper.ps1` subido uma última vez (é ele quem abre os blobs antigos).
3. `npm run app`.
4. Log: **`migrados: 1, pendentes: 0`**. Senha da base conferida pela API — decifra.
5. Helper encerrado. Com a porta 4102 fechada: credenciais, senha de base, 13
   repositórios do git-autosync, navegador e WildFly **todos respondendo**.

### Dois defeitos que só a execução no ambiente real revelou

**1. `port` do check `tcp` não coagia string.** O `oracleCheck` usa
`z.coerce.number()`; o `tcpCheck` usava `z.number()`. Como a interpolação de `${VAR}` no
YAML sempre entrega string, `port: ${ORACLE_PORT:1521}` era recusado no `tcp` e aceito no
`oracle` — o hub subia com um e saía com `exit 1` no outro. Bug latente do schema, não do
YAML: qualquer porta vinda de variável quebraria. Corrigido e coberto por teste.

**2. O bridge subia depois do backend.** `criarBridgeServer` vivia dentro de
`criarJanela`, que roda **depois** de `iniciarBackend`. O backend subia, fazia a migração
de segredos e as primeiras consultas de credencial sem ter com quem falar: a migração
cifrava pelo helper, o resultado saía sem a marca `sb1:` e era corretamente recusado —
reportando `pendentes: 1` para sempre. Foi exatamente o que aconteceu na primeira
execução. Com o bridge subindo antes, a segunda execução migrou.

Os dois são de ordem/integração e não apareceriam em teste unitário.

### O que dá para apagar agora

`scripts/hub-helper.ps1`, `scripts/wildfly-helper.ps1` e `scripts/wildfly-log-helper.ps1`
— junto com as portas 4100, 4101, 4102 e a 9222 do DevTools.

**Com uma ressalva de ordem:** o `hub-helper.ps1` ainda precisa rodar **uma última vez**
numa máquina que já usava o hub, porque é ele quem abre os blobs antigos para a migração
de segredos (§3.3). Só depois de a migração reportar `pendentes: 0` é que ele pode sair.

**Ao terminar a fase, o helper ainda precisa rodar uma última vez** na máquina de quem
já usava o hub: é ele quem abre os blobs antigos para a migração. Só depois disso dá
para apagá-lo.

## Fase 4 — instalador 🔨 em execução (2026-09-18)

Escopo decidido: **Windows primeiro**, Linux como Fase 4b (§4.6). O modo navegador entra
como componente opcional do mesmo instalador (§4.5).

### 4.0 Pré-requisitos do Git AutoSync ✅ feitos

Os quatro itens que precisavam existir antes de qualquer empacotamento:

1. **`resolverCli` acha a instalação standalone.** `src/gitAutosyncCli.ts` procurava só o
   launcher `.bat`, que a instalação standalone não cria — o hub se declararia "não
   instalado" justamente na máquina que recebeu o instalador. Agora resolve
   `git-autosync.exe` primeiro e o `.bat` como retaguarda, devolvendo
   `{ comando, prefixo, modo }`. Continua sem shell no caminho (BatBadBut).
2. **`--version` confiável nos dois executáveis.** O `git-autosync.exe` já tinha; o
   `git-autosync-sync.exe` não empacotava o `VERSION` (`git-autosync-sync.spec`,
   `datas`), então responderia "desconhecida".
3. **O executável agendado rejeita argumento desconhecido.** `run_sync.py` ignorava
   `sys.argv` inteiro: um `--version` de diagnóstico disparava sincronização real, com
   commit e push, em todos os alvos — foi o que criou commits em quatro repositórios
   durante a análise que originou este plano. Agora `--version`/`--help` saem 0 sem
   tocar em repositório, e qualquer outro argumento sai 2.
4. **Instalação silenciosa e idempotente.** `installer/install-standalone.ps1`, com
   `-TaskTime`, `-EnableTray`, `-Shortcut`, `-Skills`, `-AddToPath`, `-Uninstall`
   (`-PurgeData` opcional) e `-Quiet`; sai diferente de zero em falha. O
   `install_standalone.bat` virou casca dele, para não existirem dois instaladores
   divergentes.

Duas decisões dentro do item 4, ambas por delegação ao próprio binário:

- **A tarefa agendada NÃO é criada com `schtasks`.** Quem instala é
  `git-autosync set-schedule`, que valida o horário, aponta para o
  `git-autosync-sync.exe` ao lado, deduplica `GitAutoSyncPy_\d+` e faz rollback
  (`python/scheduler.py`). O `schtasks /Create /TN GitAutoSyncPy_0` do `.bat` antigo
  criava uma tarefa que a interface não reconhecia como sua — a origem das tarefas
  duplicadas que a lista de validações manda evitar.
- **A bandeja é ligada por `enable-tray`**, que escreve o `.bat` do Startup *e* grava
  `trayEnabled` no `config.json`. Escrever só o `.bat`, como o instalador antigo fazia,
  deixava a interface mostrando a bandeja desligada enquanto ela subia a cada login.

Além disso, `bin\VERSION` é gravado na instalação: o hub e o próximo instalador
descobrem a versão instalada **lendo um arquivo**, sem executar binário do autosync —
diagnóstico não pode ter efeito colateral, que é a lição do item 3.

Um bug de silêncio encontrado ao testar: `[Environment]::GetFolderPath('Desktop')`
devolve string **vazia** em processo não interativo, que é exatamente como o NSIS chama
o script. O caminho por baixo do perfil entra como retaguarda.

### 4.1 O pacote do hub ✅ gerado (sem o Git AutoSync ainda)

`electron-builder`, alvo NSIS **per-user** (`%LOCALAPPDATA%\Programs\sankhya-hub`, sem
admin). Dentro: Electron + `desktop/dist` + o backend em `resources/hub` (`dist/`,
`public/`, `config/` e o `node_modules` de produção).

Como está montado:

- `desktop/scripts/preparar-hub.mjs` monta `desktop/build/hub` — compila backend e
  painel, copia `dist/`, `public/`, `config/`, `package.json` e o lock, e roda
  `npm ci --omit=dev` ali dentro. É o que deixa TypeScript, Vite, React e tipos de fora:
  34 MB contra os ~400 MB do `node_modules` da raiz. O `data/` do repositório não entra.
- `desktop/electron-builder.yml` empacota o shell e leva `build/hub` como
  `extraResources` → `resources/hub`, exatamente onde `desktop/src/config.ts` já
  procurava.
- `npm --prefix desktop run empacotar` faz os dois e gera
  `release/Sankhya-Hub-Setup-0.1.0.exe` (113 MB).

**Três armadilhas encontradas gerando o pacote pela primeira vez:**

1. **`extraResources` não copia `node_modules`.** Mesmo com `filter: ['**/*']`, um
   `node_modules` dentro da pasta de recursos é ignorado — o electron-builder o trata
   como árvore de dependências do app, não como conteúdo. O primeiro instalador saiu com
   `resources/hub` de 1,6 MB, sem uma única dependência: o backend não subiria. Resolve
   com uma segunda entrada, `from: build/hub/node_modules` → `to: hub/node_modules`.
2. **`pino-pretty` é devDependency e era exigido no boot.** Sem `NODE_ENV=production` o
   Fastify pedia o transport, que não existe no pacote, e o backend morria com "unable to
   determine transport target" — mensagem que não ajuda ninguém. O shell sempre define
   `NODE_ENV=production`, mas quem subir o backend por fora (modo navegador, diagnóstico)
   não define. `src/index.ts` agora só usa o transport se o módulo for resolvível.
3. **`npm ci --ignore-scripts` é recusado** quando existe `allow-scripts` no `.npmrc` do
   usuário (npm 12, que já bloqueia scripts por padrão). O script de staging passa a flag
   apenas em npm anterior ao 12.

**Validado no pacote gerado** (backend rodando sob o Electron empacotado,
`ELECTRON_RUN_AS_NODE`, sem `node.exe` no caminho): `/api/healthz` responde 200, o painel
responde 200 e o `node:sqlite` cria `monitor.db` e `sankhya.db` no `DATA_DIR` — era a
dúvida em aberto sobre o `DatabaseSync` fora do Node normal. Sobe com e sem
`NODE_ENV=production`.

**Ainda não validado:** instalação de verdade numa máquina limpa, sem Node (item 6 da
sequência). O que foi exercitado aqui é o pacote, não o instalador rodando.

**Não precisa empacotar `node.exe` nem fazer `electron-rebuild`** — verificado: o backend
sobe sob o runtime do Electron (`ELECTRON_RUN_AS_NODE`) e responde `/api/healthz`
normalmente, inclusive com o `oracledb` importado (o `initOracleClient` já está em
try/catch, e o Thin mode não carrega o addon nativo).

Ícone: `desktop/assets/hub-snk.ico`, o mesmo da janela.

**Pendência do `services.yaml` — resolvida.** O arquivo viaja no pacote, e a pasta do
pacote é substituída inteira a cada atualização; lendo de lá, a primeira atualização
apagaria os alvos cadastrados. `desktop/src/primeiroBoot.ts` copia o arquivo para
`userData/config/services.yaml` no primeiro boot e nunca sobrescreve um existente — nem
quando o de fábrica muda, porque adotar alvo novo é decisão de quem editou. Em
desenvolvimento nada muda: os dois caminhos são o mesmo arquivo do repo.

### 4.2 Git AutoSync junto, completo

A pedido: levar **interface, CLI e skills**, não só o CLI.

O git-autosync já resolve o caso "máquina sem Python": `pythonuild_windows.ps1` gera
dois executáveis PyInstaller que não exigem Python em quem instala. O que cada parte
precisa:

| Parte | O que é | Como instalar sem Python |
|---|---|---|
| Interface + bandeja | `git-autosync.exe` (31,5 MB) | Copiar para `~/.git-autosync/bin` + atalho |
| CLI | o **mesmo** executável (`git-autosync status`, `add`, ...) | O mesmo arquivo; opcionalmente no PATH |
| Sync agendado | `git-autosync-sync.exe` (8,4 MB) | Copiar + tarefa no Agendador |
| Skills | `skill/SKILL.md` | Copiar para `~/.claude/skills/git-autosync` e, se existir, `~/.codex/skills/git-autosync` |

Único pré-requisito real que sobra: **git instalado** — o autosync executa `git` de
verdade.

**Dois itens a resolver antes de empacotar:**

1. **Os `.exe` prontos estão desatualizados.** São de 17/ago; sete fontes mudaram depois
   (até 08/set, versão 4.0.0). Rodar `build_windows.ps1` antes de empacotar — isso exige
   Python + PyInstaller, mas só na máquina de quem gera.
2. **`resolverCli` só entende o launcher `.bat`.** Numa instalação standalone não existe
   `.bat`, existe `git-autosync.exe`. Do jeito que está, o hub não acharia o autosync
   justamente no cenário de distribuição. Ver `src/gitAutosyncCli.ts`.

### 4.3a Decidido e implementado: opção A (página no NSIS) ✅

Escolhida a página de componentes no instalador. Como ficou:

- `desktop/scripts/preparar-autosync.mjs` traz do repositório do Git AutoSync
  (`../scripts/git-autosync`, ajustável por `GIT_AUTOSYNC_DIR`) os dois executáveis, o
  `install-standalone.ps1`, o `SKILL.md` e o `VERSION` para `desktop/build/git-autosync`,
  que vira `resources/git-autosync` no pacote. **Ele recusa binário mais antigo que os
  fontes** — era exatamente o erro do relatório de análise, `.exe` de agosto sendo
  distribuído como 4.0.0, e nada verificava.
- `desktop/assets/installer.nsh` desenha a página: instalar (marcado), horário da
  sincronização diária, bandeja no login, atalhos, skills e PATH. As opções filhas
  desligam junto com a caixa principal.
- **A página não executa nada**: monta as flags e chama o mesmo
  `install-standalone.ps1` da §4.0. Reimplementar a instalação em NSIS seria a segunda
  implementação a manter, e foi assim que nasceu a tarefa agendada duplicada.
- Falha do autosync **não** derruba a instalação do Hub: mostra o motivo provável (Git
  ausente) e o comando para tentar de novo depois.
- A desinstalação só oferece remover o autosync se o arquivo `instalado-pelo-hub.txt`
  existir — quem já tinha o autosync antes não o perde ao desinstalar o Hub. Dados
  (`config.json`, `status.json`, `autosync.log`) são preservados de qualquer forma.
- `npm run empacotar:sem-autosync` gera o instalador só do Hub: sem o arquivo de defines
  gerado pelo staging, o `installer.nsh` inteiro se desliga.

**Armadilhas do NSIS, as duas custaram um build cada:**

1. `MUI_HEADER_TEXT` não existe no ponto em que o electron-builder inclui o script
   customizado — ele entra antes do MUI2. A página usa o cabeçalho padrão.
2. O desinstalador é um **passe de compilação separado** (`BUILD_UNINSTALLER`), e nele o
   `customPageAfterChangeDir` não é inserido. As funções da página ficavam sem
   referência, virando o warning 6010 — que o electron-builder trata como erro. Tudo que
   é da página vive dentro de `!ifndef BUILD_UNINSTALLER`.

Também corrigido no `install-standalone.ps1`: `VERSION` e `SKILL.md` passam a ser
procurados ao lado dos binários antes do layout do repositório (no pacote não existe repo
nenhum), e falha ao criar atalho virou aviso — a pasta da área de trabalho ausente
abortava a instalação **depois** de copiar os binários e **antes** das skills, deixando
tudo pela metade por causa de um `.lnk`.

**Estado do artefato:** `release/Sankhya-Hub-Setup-0.1.0.exe`, 152 MB (Hub 113 MB +
autosync 40 MB). Binários do autosync regerados em 18/09/2026 com as correções da §4.0 —
verificado no executável: `--version` responde `git-autosync-sync 4.0.0` e sai 0,
argumento desconhecido sai 2, e um `GIT_AUTOSYNC_HOME` vazio terminou o teste sem
nenhuma entrada criada (nenhuma sincronização disparada).

### 4.3 Formas de oferecer as opções na instalação

| Forma | Como é | Custo |
|---|---|---|
| **A. Página de componentes no NSIS** | Checkboxes na tela do instalador (interface, CLI, skills, tarefa agendada, bandeja) | Script `.nsh` customizado; a lógica de copiar, agendar e criar atalho vira código NSIS, que é chato de testar |
| **B. Assistente no primeiro uso do hub** | O `.exe` instala os arquivos; o hub mostra as mesmas opções na primeira abertura | Lógica em TypeScript, testável; decisão reversível depois, sem reinstalar |
| **C. NSIS chama o instalador do git-autosync** | Um checkbox só; marcado, roda o instalador que já existe | Reaproveita pouco: o `install.py` exige Python e o `install_standalone.bat` não faz skills nem PATH |

Observação que simplifica qualquer uma delas: **os binários podem ir sempre no pacote**
(são inertes se ninguém os usar; custam ~40 MB). A opção só precisa existir para o que
tem **efeito colateral na máquina**: tarefa agendada, bandeja iniciando com o login,
skills em `~/.claude` e entrada no PATH.

Tamanho estimado do instalador: **~140 MB** (Electron ~100 MB + autosync ~40 MB).

### 4.4 Fora de escopo

Auto-update (`electron-updater`) e assinatura de código. Sem certificado, o SmartScreen
avisa a cada versão — resolve com certificado comprado, não de graça.

### 4.5 Modo navegador — componente opcional

Um segundo atalho, marcável na instalação: em vez da janela do Electron, sobe o backend
e abre `http://localhost:4000` no navegador padrão. Quem hospeda o backend é o mesmo
binário do pacote (`ELECTRON_RUN_AS_NODE`, sem janela), então nada novo é empacotado.

**O atalho sobe também o `scripts/hub-helper.ps1`.** Sem o shell não existem `safeStorage`
nem bridge: `src/sankhya/cifra.ts` e `credenciais.ts` já caem para o helper, e é o helper
que abre o Chrome com perfil próprio e lê a sessão por CDP. Ou seja, o modo navegador
reusa inteiro o caminho anterior à Fase 3, que continua no repositório (2132 linhas, com
`/credentials`, `/secret`, `/browser`, `/pastas`, `/ia`). Login no Sankhya e na
Experience é manual, na janela que o hub abre — e a captura de sessão continua
funcionando porque o perfil é separado, que era a razão de ele existir (Chrome 136 recusa
DevTools no perfil padrão).

**Antes de distribuir isso, uma correção obrigatória:** `scripts/hub-helper.ps1:2113`
escuta em `[IPAddress]::Any` — a porta 4102 fica aberta para a rede local inteira,
protegida só por token, e `/credentials/:sistema/reveal` devolve senha em texto claro. O
`Any` existia porque o container precisava alcançar o helper de fora; sem container, tem
que ser `Loopback`. O `LauncherGitAutosync` do helper também aponta só para o `.bat` e
precisa do mesmo tratamento que `resolverCli` recebeu (§4.0, item 1).

Funcionalmente a paridade é a da Fase 2: o que o shell fazia por `safeStorage` e pelo
bridge, o helper faz pelas rotas antigas. O que se perde é do shell, não do hub — abas,
user agent limpo e a janela única. O custo real é manter o helper vivo em vez de
aposentá-lo, e ele passa a ser parte do pacote (hoje é um script solto em `scripts/`).

### 4.6 Fase 4b — Linux 🔨 código adaptado, empacotamento por validar

**Feito** (21/09/2026), tudo verificado por `npm test` e `npm run typecheck`:

- **Container deixou de ser sinônimo de Linux.** O sinal passou a ser `/.dockerenv`
  (`NATIVO`, em `src/wildfly.ts`). Antes, `platform !== 'win32'` significava "estou no
  container e preciso do helper" — com o hub nativo no Linux isso passaria a delegar ao
  helper que não existe lá. `src/pastas.ts` usa a mesma regra.
- **WildFly**: `standalone.sh`, pastas padrão `/opt/sankhya/wildfly_producao`,
  `/opt/wildfly_producao` e `~/wildfly_producao`, busca em `/opt`, `/srv` e `$HOME`.
  Detecção de processo lê `/proc/<pid>/cmdline` — **sem processo auxiliar nenhum**,
  contra os ~2s de um `powershell.exe` no Windows. Encerramento por `SIGTERM`, que o
  WildFly trata como desligamento ordenado. E `casaInstalacao` passou a aceitar os dois
  separadores: exigindo só contrabarra, `/opt/wildfly_producao2` passaria pelo buraco que
  a regra existe para fechar (tem teste).
- **Git AutoSync**: CLI direto também no Linux, e o agendamento lido do **crontab** (as
  linhas que o `scheduler.py` marca com `# git-autosync`) no lugar do Agendador de
  Tarefas. O cron não guarda histórico, então última execução e resultado vêm vazios — o
  que sabe disso é o `autosync.log`.
- **Terminal**: o `GitAutosyncCli` parou de ter implementação própria e passou a chamar
  `src/ferramentas.ts`. Havia duas, e só uma recebeu a correção do alias do WindowsApps —
  exatamente o que duas implementações do mesmo comportamento produzem.
- **Agentes de IA**: `EvidenciaIa` habilitado fora do Windows; `codex` cai para o shim
  direto quando o layout `node_modules/@openai/...` não existe (é o caso no Linux), e o
  binário do `opencode` perde o `.exe`.
- **Configuração do WildFly** sai de `%APPDATA%` para `$XDG_CONFIG_HOME` ou
  `~/.config/sankhya-hub`.
- **Shell**: ícone `.png` (extraído do próprio `.ico`, 256x256) porque o `.ico` não é
  reconhecido no Linux; perfis de Chrome/Chromium/Edge nas três convenções que convivem
  por lá (`~/.config`, Flatpak `~/.var/app`, Snap `~/snap`).
- **Cofre**: `disponivel()` passou a recusar o backend `basic_text` do `safeStorage`. No
  Linux `isEncryptionAvailable()` responde **verdadeiro** mesmo sem chaveiro, cifrando com
  chave fixa e pública — indistinguível de proteção real pela API, e guardar senha de ERP
  assim seria pior do que recusar. A mensagem diz o que instalar.
- **Empacotamento**: alvos `AppImage` (sem root, equivalente ao NSIS per-user) e `.deb`,
  que declara `libsecret-1-0` como dependência — sem ela o cofre acima se recusa a
  gravar. O staging do autosync reconhece os binários sem `.exe` e manda gerar com
  `python/build_linux.sh`.

**Falta:** gerar o AppImage e o `.deb` de verdade. Precisa de máquina Linux (ou WSL, ou
Docker): o electron-builder não monta esses alvos a partir do Windows, e o PyInstaller
não faz cross-compile dos binários do autosync. Também sem validar em Linux: o
`node:sqlite` sob o runtime do Electron (funciona no Windows, medido no §4.1) e a página
de componentes do autosync, que é NSIS e não existe no AppImage — por lá o Git AutoSync
fica manual, com o `install_standalone.sh` que viaja no pacote.

Referência do que estava preso ao Windows antes desta rodada:

| Onde | Hoje | No Linux |
|---|---|---|
| `src/wildfly.ts:150,171,255,347,409` | `#nativo = win32`, `bin\standalone.bat`, `C:\Sankhya\...` | `bin/standalone.sh`, `/opt/sankhya/wildfly_producao`, `$HOME/wildfly*` |
| `src/wildfly.ts:113` | linha de comando do processo por `powershell Get-CimInstance` | `/proc/<pid>/cmdline` — mais barato que no Windows, sem spawn |
| `src/index.ts:166`, `src/gitAutosyncCli.ts` | CLI direto só em win32; resolve `.bat`/`.exe`; agenda por PowerShell | binário de `build_linux.sh`; agendamento por systemd user timer ou cron (`python/scheduler.py` já escreve crontab) |
| `src/index.ts:185`, `src/evidenciaIa.ts:88` | `EvidenciaIa` só win32, resolve shims `.cmd`/`.ps1` | binário puro no PATH |
| `src/pastas.ts:47` | nativo só win32; raiz = unidades | raiz = `/` e `$HOME` |
| `src/index.ts:66` | `wildfly.json` em `%APPDATA%` | XDG `~/.config/sankhya-hub` |
| `src/gitAutosyncCli.ts:196` | terminal = git-bash/cmd/powershell | `x-terminal-emulator`, `gnome-terminal`, `konsole` |
| `desktop/src/navegador.ts` | perfis Chrome/Edge em `AppData` | `~/.config/google-chrome`, `~/.config/microsoft-edge`, flatpak `~/.var/app/` |
| `desktop/src/config.ts` (`ICONE`) | `.ico` | `.png` |

Docker socket já está resolvido (`/var/run/docker.sock`), e o Oracle em Thin mode não
precisa de nada — só o Thick exige Instant Client de Linux.

**Segurança, e é o item que decide se dá para distribuir:** o `safeStorage` do Electron
só cifra de verdade no Linux com libsecret (gnome-keyring) ou kwallet. Sem eles o Electron
cai para o backend `basic_text`, que usa chave fixa e conhecida — as credenciais do ERP,
da Experience e das bases ficariam praticamente em texto claro no disco. O shell precisa
checar `safeStorage.isEncryptionAvailable()` no boot e **recusar gravar segredo** quando
o backend for `basic_text`, com mensagem explicando o que instalar; o `.deb` declara
`libsecret-1-0` como dependência.

**Build:** o PyInstaller não faz cross-compile, então os binários Linux do git-autosync
têm que ser gerados numa máquina ou container Linux (`python/build_linux.sh`). O mesmo
vale para o AppImage. A partir do Windows, só via WSL ou Docker.

**A validar antes de prometer:** `node:sqlite` (`DatabaseSync`) sob o runtime do Electron
no Linux — é o que guarda histórico, clientes, agenda e cartão.
