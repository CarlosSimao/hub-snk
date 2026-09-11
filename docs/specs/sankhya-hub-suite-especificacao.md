# Especificação — Sankhya Hub Suite (Agenda + Experience + Git Autosync)

Documento de especificação completa para implementação numa branch dedicada do
`sankhya-hub`. Escrito para que um agente (ou desenvolvedor) consiga construir a feature
sem precisar re-descobrir o que já foi investigado.

**Branch sugerida:** `feature/sankhya-suite`.
**Local deste arquivo:** `docs/specs/sankhya-hub-suite-especificacao.md` (fica na branch).

## 0. Leitura prévia obrigatória

Este documento assume conhecimento do conteúdo de três arquivos de descoberta, feitos
antes dele, em `C:\Users\flaviano.santos_sank\Documents\Projetos\`:

1. `Sankhya-agenda.md` — especificação original da Agenda de Recursos via Mitra (captura
   manual de JSON, parser, modelo de dados, armadilhas). **Esta suite reaproveita o parser
   e o modelo de dados, mas abandona o Mitra como runtime** (ver seção 9).
2. `sankhya-experience-tarefas-api.md` — API real (JSON, AWS API Gateway) por trás das
   telas de Tarefas e Ordens de Serviço do Sankhya Experience, incluindo o fluxo do modal
   "Gerar OS" (parcialmente mapeado — falta o endpoint de `Salvar`, ver seção 16).
3. `sankhya-agenda-recursos-escrita-ui.md` — por que a escrita na Agenda de Recursos (ERP
   legado) não foi confirmada via API (ACL de serviço), e como ela funciona via automação
   de UI.

Não repita essas investigações — leia os arquivos.

## 1. Objetivo

Transformar o `sankhya-hub` (hoje: painel de monitoramento de WildFly/Oracle local) num
painel único de trabalho para o dia a dia com Sankhya, agregando:

- Leitura da **Agenda de Recursos** (Sankhya ERP) e das **Tarefas/Ordens de Serviço**
  (Sankhya Experience), filtradas para o usuário logado.
- Um calendário por cliente mostrando os dias de atuação, com indicador de atraso.
- Um modal por dia pra gerar OS na Experience (quando o endpoint estiver confirmado).
- Controle do **git-autosync** (config de repositórios, histórico, commit/push/MR) de
  dentro do mesmo painel, organizado por cliente.
- Frontend migrado para **React**, mantendo a identidade visual atual do hub.

Tudo isso **sem quebrar** o que o hub já faz hoje (monitoramento de serviços).

## 2. Decisões já tomadas (não reabrir sem motivo novo)

| Decisão | Escolha | Por quê |
|---|---|---|
| Abrir Sankhya "dentro" do hub | **Proxy reverso same-origin** (iframe embutido na SPA) | Fica de verdade dentro do app. Ver risco técnico na seção 8.3 — pode não ser viável, tem fallback definido. |
| Guardar login/senha do Sankhya | **Backend criptografado, oculto até do navegador** | Precisa funcionar também em automação headless (Playwright sem janela). Ver seção 3 — a implementação muda por causa do container Linux. |
| Associar cliente ↔ pasta de repositório local | **Manual, via UI** | Tela nova onde você aponta a pasta de cada cliente; sem heurística automática. |
| Endpoint de criação de OS (`Salvar`) | **Confirmado em 2026-09-10** (fechamento real de OS testado) | Ver `sankhya-experience-tarefas-api.md` seção 7.2 — 3 chamadas: `POST /orders` (cria), `POST /accepted-os` (aceite), `POST /accepted-os/send-email` (e-mail pro cliente). Não é mais pendência — ver seção 16 atualizada. |

## 3. Descoberta técnica que muda a arquitetura: DPAPI não roda no container

O `Cofre` atual (`src/segredos.ts`) grava segredos em **JSON puro** no volume
`monitor-data`, protegido só por permissão de arquivo (`0o600`) — não é DPAPI, é
confiança na fronteira do container. E o hub roda **dentro de um container Linux**
(README, seção "Segurança" e "Pré-requisitos") — a API DPAPI do Windows
(`System.Security.Cryptography.ProtectedData`) **não existe em Linux**, então "cofre
criptografado com DPAPI" não pode ser implementado dentro do container atual.

**Resolução:** reaproveitar o padrão que o hub já usa para tudo que precisa do Windows
nativo — os helpers do WildFly (`scripts/wildfly-helper.ps1`, `scripts/wildfly-log-helper.ps1`,
portas 4100/4101, alcançados pelo container via `host.docker.internal`). Este projeto
adiciona um terceiro: **`scripts/hub-helper.ps1`**, rodando nativamente no Windows (fora
do Docker), responsável por tudo que exige SO Windows:

- Criptografia/decriptografia via DPAPI (`ProtectedData.Protect`/`Unprotect`) dos
  logins/senhas do Sankhya ERP e do Sankhya Experience.
- Execução do `git-autosync.exe` (binário nativo Windows, não roda dentro de um container
  Linux) e leitura de `~/.git-autosync/config.json` / `status.json`.

O resto (proxy reverso do Sankhya, chamadas HTTPS pra API da Experience, parser da Agenda
de Recursos, Playwright headless) continua rodando **dentro do container Linux** como
hoje — Playwright/Chromium headless não depende de Windows, só a parte de
criptografia e a execução do `.exe` dependem.

### 3.1 Fluxo de uma senha, do preenchimento ao uso

1. Usuário digita login/senha uma vez num formulário do hub (React, dentro do container).
2. Hub (container) envia pro `hub-helper.ps1` (Windows, via `host.docker.internal:4102`):
   `POST /credentials/:sistema` com `{ usuario, senha }`.
3. Helper criptografa com DPAPI e grava em arquivo local (ex.:
   `%APPDATA%\sankhya-hub\credentials.dat`) — nunca em texto plano, nunca dentro do
   container/volume Docker.
4. Quando o hub precisa logar de verdade (Playwright headless dentro do container, ou
   renovar um cookie), chama `GET /credentials/:sistema/reveal` no helper — só esse
   endpoint devolve o valor decriptado, e só é chamado pelo backend do hub, nunca exposto
   pro frontend/React.
5. Hub usa o valor revelado uma única vez (login automatizado) e não o persiste em
   nenhuma variável de longa duração no container.

### 3.2 Segurança do helper — CORRIGIDO na implementação

> A versão original desta seção dizia "mesmo padrão de risco dos helpers do WildFly:
> sem token". **Isso foi descartado na implementação** e não deve ser reintroduzido.
>
> Não é o mesmo risco. Derrubar o WildFly pela rede local é reversível; `GET
> /credentials/:sistema/reveal` devolve a senha do Sankhya em texto claro, e sem
> autenticação bastaria um `curl` de qualquer aparelho da rede para levá-la.
>
> **Como ficou:** toda rota exige o header `X-Hub-Token`. O helper gera o token no
> primeiro boot em `%APPDATA%\sankhya-hub\ipc\token.txt`, o `docker-compose.yml` monta
> essa pasta read-only em `/app/helper-ipc`, e o backend lê o arquivo a cada chamada
> (para sobreviver a uma regeneração do token). A comparação é de tempo constante.
>
> Escutar em todas as interfaces continua necessário: o container alcança o host por
> `host.docker.internal`, que não chega pelo loopback.

## 4. Arquitetura geral (visão macro)

```
┌─────────────────────────────── Windows (host) ───────────────────────────────┐
│                                                                                │
│  scripts/hub-helper.ps1  (novo, porta 4102)                                   │
│    - DPAPI encrypt/decrypt/reveal de credenciais Sankhya                      │
│    - shell-out para git-autosync.exe (config, commit, push, sync, mr, hist.)  │
│                                                                                │
│  git-autosync.exe (já existe, compilado via PyInstaller)                     │
│  ~/.git-autosync/config.json, status.json (já existem)                       │
│                                                                                │
│  wildfly-helper.ps1 (4100), wildfly-log-helper.ps1 (4101)  — já existem       │
│                                                                                │
│  ┌──────────────────────── Docker (Linux container) ─────────────────────┐   │
│  │                                                                        │   │
│  │  sankhya-hub (Fastify + React, porta 4000)                            │   │
│  │    - tudo que já existe hoje (checks, engine, cofre atual de infra)   │   │
│  │    - NOVO: proxy reverso p/ Sankhya ERP e Experience                  │   │
│  │    - NOVO: rotas /api/agenda/*, /api/experience/*, /api/clientes/*    │   │
│  │    - NOVO: rotas /api/git-autosync/* (repassa pro hub-helper)         │   │
│  │    - NOVO: SQLite local p/ dados da Agenda de Recursos                │   │
│  │    - Playwright/Chromium headless (login automatizado, escrita        │   │
│  │      na Agenda de Recursos via automação de UI)                       │   │
│  │                                                                        │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────────────┘
```

## 5. Frontend — migração para React

- Build com **Vite + React**, servido pelo mesmo Fastify (build estático em `public/dist`
  ou similar) — não muda a porta nem a forma de acesso (`http://localhost:4000`).
- **Manter a identidade visual atual**: reaproveitar as variáveis de cor/tema hoje em
  `public/styles.css` como design tokens do React (CSS variables continuam válidas, não
  precisa reescrever em CSS-in-JS). Antes de estilizar qualquer componente novo, ler
  `public/styles.css` e `public/app.js` pra extrair paleta, tipografia e padrão de card
  já usados.
- **Inspiração de organização em abas do `git-autosync`**: abrir `python/gui.py` e usar
  como referência de **como agrupar ações** (lista de repositórios + status + botões de
  ação por item, histórico separado) — não é pra copiar o visual do customtkinter (é
  desktop, teria estética Windows nativa), é pra copiar a **lógica de organização da
  informação**, adaptada aos tokens visuais do hub.
- **Paridade total com o que existe hoje antes de tocar em qualquer coisa nova**: o
  dashboard atual (cards de serviço, semáforo, SSE, ações, configurações de check, cofre
  de env vars) precisa continuar funcionando **exatamente igual**, só que renderizado em
  componentes React em vez de vanilla JS. Contrato das rotas `/api/*` existentes
  (`src/routes.ts`) não muda nesta migração.
- Estrutura de abas de topo sugerida (nomes ajustáveis):
  - **Infra** — o que já existe hoje (cards de serviço, WildFly/Oracle).
  - **Sankhya** — nova, contém sub-abas: **Clientes** (calendário por cliente),
    **Agenda Mensal** (resumo consolidado).
  - **Git** — nova, config geral do autosync + acesso às sub-abas de cada cliente (que
    também aparecem dentro da aba Clientes, ver seção 14).

## 6. Backend novo dentro do container — visão dos módulos

Seguir a convenção já usada em `src/` (arquivos curtos, um assunto por módulo, comentários
em português só quando o "porquê" não é óbvio). Sugestão de novos arquivos:

- `src/sankhya/credenciais.ts` — cliente HTTP pro `hub-helper.ps1` (set/reveal).
- `src/sankhya/proxy.ts` — proxy reverso do Sankhya ERP/Experience.
- `src/sankhya/agenda.ts` — parser + storage (SQLite) da Agenda de Recursos.
- `src/sankhya/experience.ts` — cliente HTTP pra API da Experience (tasks/orders).
- `src/sankhya/clientes.ts` — CRUD da entidade Cliente (associações).
- `src/gitAutosync.ts` — cliente HTTP pro `hub-helper.ps1` (comandos do autosync).
- `src/routesSankhya.ts`, `src/routesGitAutosync.ts` — novas rotas Fastify, registradas
  ao lado de `registerRoutes` (routes.ts) sem alterá-la.

## 7. `hub-helper.ps1` — contrato de API

Novo processo Windows nativo, porta sugerida **4102** (livre — 4100/4101 já usadas).

| Rota | Método | Descrição |
|---|---|---|
| `/credentials/:sistema` | `POST` | Body `{usuario, senha}`. `:sistema` = `sankhya-erp` \| `sankhya-experience`. Criptografa com DPAPI e grava. |
| `/credentials/:sistema` | `GET` | Devolve só `{usuario, definido: bool}` — nunca a senha. Espelha o padrão do `Cofre` atual (`EnvVarStatus`). |
| `/credentials/:sistema/reveal` | `GET` | Devolve `{usuario, senha}` decriptado. Só deve ser chamado pelo backend do hub (mesma rede Docker), nunca pelo frontend. |
| `/git-autosync/status` | `GET` | Roda `git-autosync.exe status --json`, repassa a saída. |
| `/git-autosync/list` | `GET` | `git-autosync.exe list --json`. |
| `/git-autosync/history` | `GET` | `git-autosync.exe history --json` (aceita querystring pra filtrar por pasta, se o CLI suportar — checar `app.py --help`). |
| `/git-autosync/repos` | `POST` | Body `{caminho}` → `git-autosync.exe add <caminho>`. |
| `/git-autosync/repos` | `DELETE` | Body `{caminho}` → `git-autosync.exe remove <caminho>`. |
| `/git-autosync/commit` | `POST` | Body `{caminho, mensagem?}` → `git-autosync.exe commit [--message ...]` no repo indicado (checar como o CLI aponta o repo-alvo — hoje pode operar sobre todos os configurados; se for o caso, documentar essa limitação e possivelmente propor mudança no `app.py` como item separado, fora desta fase). |
| `/git-autosync/push` | `POST` | Idem, `push`. |
| `/git-autosync/sync` | `POST` | Idem, `sync` (commit+push). |
| `/git-autosync/mr` | `POST` | Idem, `mr` (Merge Request GitLab — **não existe PR de GitHub hoje**, ver `sankhya-experience-tarefas-api.md`... na verdade ver descoberta do git-autosync na conversa: só GitLab MR). Se o cliente usa GitHub, este botão fica indisponível/desabilitado pra esse repo até existir suporte. |

### 7.1 Investigação do CLI — CONCLUÍDA, e a tabela acima está desatualizada

O CLI foi lido (`app.py`, `autosync_core.py`). O que mudou em relação ao que a tabela
acima supunha:

1. **`commit`, `push`, `sync` e `mr` ACEITAM `--repo PATH`** (`app.py:218-220,319-400`).
   Os botões por-cliente da seção 14.2 funcionam como especificado — a dúvida que abria
   esta seção está resolvida. Sem `--repo` o CLI opera no diretório atual, que no
   contexto do helper seria a pasta errada; por isso o helper **exige** `caminho`.
2. **Não existe `git-autosync.exe`.** O launcher é
   `%USERPROFILE%\.git-autosync\bin\git-autosync.bat`, duas linhas, chamando o Python de
   um venv com `python\app.py`. O helper lê os dois caminhos de dentro do `.bat` e chama
   o **python.exe direto** — invocar o `.bat` faria os argumentos passarem pelo
   `cmd.exe`, que reinterpreta `&`, `|` e `^` mesmo dentro de aspas, transformando o
   caminho do repositório (que vem do painel) em execução de comando arbitrário.
3. **`list` não tem `--json`** — só `status`, `preview` e `history` têm. A lista de
   repositórios configurados vem de ler `~/.git-autosync/config.json` direto, e o estado
   de cada um vem de `status --json`. O hub cruza os dois (`src/gitAutosync.ts`).
4. **`exclude`/`include` não são `remove`/`add`.** Um alvo do tipo `root` é uma PASTA que
   varre todos os repositórios dentro dela. Tirar um repositório do agendamento é
   `exclude`; `remove` apagaria o alvo raiz e levaria junto todos os outros. O checkbox
   da seção 14.1 escolhe entre os dois conforme `alvoProprio`.
5. **`mr` é só GitLab** (`autosync_core.py:890-983`), confirmando a nota da tabela — não
   há pull request de GitHub.
6. O Python precisa de `PYTHONIOENCODING=utf-8`: sem isso o `history` **aborta** com
   `'charmap' codec can't encode character` em qualquer repositório cuja mensagem de
   commit tenha acento ou BOM.

## 8. Abrir o Sankhya "dentro" do hub — proxy reverso

### 8.1 Rota

- Frontend: nova aba/rota React, ex. `/sankhya/erp` e `/sankhya/experience`, cada uma
  renderizando um `<iframe>` apontando pro proxy do próprio hub:
  `src="/proxy/sankhya-erp/"` e `src="/proxy/sankhya-experience/"`.
- Backend: `src/sankhya/proxy.ts` registra rotas `app.all('/proxy/sankhya-erp/*', ...)` e
  equivalente pra Experience, repassando pra `https://skw.sankhya.com.br` e
  `https://experience.sankhya.com.br` respectivamente (usar `undici` ou biblioteca de
  proxy HTTP já disponível no ecossistema Fastify, ex. `@fastify/http-proxy`).
- Remover headers que bloqueiam iframe na resposta proxiada: `X-Frame-Options`,
  `Content-Security-Policy` (ou reescrever `frame-ancestors` pra incluir a origem do hub).
- Reescrever `Set-Cookie` da resposta proxiada pra não fixar `Domain=` como o domínio real
  do Sankhya (o cookie precisa valer pro domínio do hub, já que o browser vê o iframe como
  servido pelo hub).

### 8.2 Login automático dentro do proxy

1. Primeira vez: usuário loga manualmente dentro do iframe (formulário normal do Sankhya),
   e o hub oferece "salvar essa sessão" — ou, preferencialmente, pede login/senha uma vez
   num formulário próprio do hub (fora do iframe) e guarda via `hub-helper.ps1` (seção 3).
2. Da próxima vez que abrir a aba: backend do hub usa Playwright headless (dentro do
   container) com a credencial revelada pra logar direto em `skw.sankhya.com.br` /
   `experience.sankhya.com.br`, extrai o cookie de sessão resultante, e injeta esse cookie
   na primeira resposta do proxy antes de o iframe carregar — usuário já abre autenticado.
3. Se a sessão expirar (401/redirect pra tela de login detectado na resposta proxiada),
   repetir o passo 2 automaticamente antes de mostrar erro pro usuário.

### 8.3 Risco técnico a validar ANTES de construir o resto (spike obrigatório)

Aplicações legadas como o Sankhya ERP (`skw.sankhya.com.br/mge`) costumam fazer chamadas
**absolutas** pro próprio domínio (`https://skw.sankhya.com.br/mge/service.sbr`, não
caminhos relativos). Quando servido via proxy sob o domínio do hub, o browser enxerga o
iframe como tendo origem = domínio do hub, mas o JS da página continua chamando o domínio
real do Sankhya — isso é uma chamada **cross-origin** de dentro do iframe, que só funciona
se o Sankhya responder com headers CORS permitindo a origem do hub (`Access-Control-Allow-Origin`),
o que é **improvável** numa aplicação legada não desenhada pra isso.

**Antes de investir na Fase de proxy (ver seção 17), fazer um spike**: subir o proxy mínimo,
abrir a Agenda de Recursos e a tela de Tarefas dentro do iframe, e verificar no Network se
as chamadas da própria aplicação (`service.sbr`, API da Experience) funcionam ou dão erro de
CORS/bloqueio. Dois desfechos possíveis:

- **Funciona** (talvez o navegador libere por já ter cookie de sessão válido e a API não
  checar `Origin` rigorosamente) → segue como especificado.
- **Não funciona** → fallback: o proxy também precisa reescrever essas URLs absolutas para
  relativas ao próprio proxy (`/proxy/sankhya-erp/mge/service.sbr` em vez de
  `https://skw.sankhya.com.br/mge/service.sbr`), reescrevendo o HTML/JS servido — trabalho
  bem maior (equivalente a um mini `mitmproxy`). Se isso também não for viável em tempo
  hábil, cair pra alternativa mais simples: botão abre uma **aba real do navegador**
  (`window.open`) em vez de iframe embutido — ainda automatiza login (Playwright preenche
  e o navegador real assume a sessão), só não fica visualmente "dentro" da SPA do hub.

## 9. Extração — Agenda de Recursos (reescrita, sem Mitra)

Baseado no `Sankhya-agenda.md`, adaptado pra rodar nativamente no hub em vez de na
plataforma Mitra:

| Peça do doc original (Mitra) | Equivalente nesta suite |
|---|---|
| Tabelas `AG_RECURSOS`/`AG_EVENTOS` no JDBC do Mitra | Mesmas duas tabelas, em **SQLite local** dentro do volume `monitor-data` (lib `better-sqlite3` ou `node:sqlite` se a versão do Node do container suportar nativamente) |
| 5 Server Functions SQL | 5 rotas Fastify (`GET /api/agenda/recursos`, `/api/agenda/eventos`, etc.) com a mesma SQL adaptada a SQLite |
| Frontend React (`AgendaPage.tsx`) do template Mitra | Componente React equivalente, dentro da aba **Clientes** do hub (ver seção 12) |
| Captura manual do JSON (`agenda-capturado.json`) | Continua manual por enquanto — endpoint `POST /api/agenda/importar` recebe o JSON colado pelo usuário (ACL de leitura via API segue bloqueada, ver `Sankhya-agenda.md` seção 1.4) |
| Parser (desembrulho `{"$":...}`, conversão de data `DD/MM/YYYY HH:mm`→`YYYY-MM-DD HH:mm:ss`, cor `0xRRGGBB`→`#RRGGBB`, normalização de `lane.task` objeto-ou-array) | Reaproveitar o algoritmo tal como documentado — são as mesmas regras, só troca o destino da escrita |

**Escrita de novos eventos** (criar/editar evento na Agenda de Recursos de verdade, não só
importar snapshot) segue o fluxo documentado em `sankhya-agenda-recursos-escrita-ui.md`:
automação de UI via Playwright, abrindo o modal "Edição de Evento" dentro do proxy (seção
8) e preenchendo os campos programaticamente — **não existe API de escrita liberada**.

## 10. Extração — Sankhya Experience (Tarefas + Ordens de Serviço)

Usar diretamente os endpoints já confirmados em `sankhya-experience-tarefas-api.md`:

- `POST https://d83n39pk6d.execute-api.sa-east-1.amazonaws.com/prod/tasks/filtering/implantation/{projetoId}/person/{personId}`
- `POST .../orders/filtering?implantation_ids={projetoId}`
- Endpoints de apoio do modal Gerar OS: `orders/tasks/validate`,
  `orders/tasks/{id}/get-tasks-observations`, `tasks/work_hours/implantation/{projId}/person/{personId}`,
  `orders/check-processes-orders`, `persons/implantation/{projId}/get-approvers`.

Essas chamadas **não precisam do proxy/iframe** — são requisições HTTPS diretas feitas pelo
próprio backend do hub (dentro do container), usando o cookie de sessão da Experience
capturado via login automatizado (mesmo mecanismo Playwright da seção 8.2, mas para
`experience.sankhya.com.br`). O proxy/iframe da seção 8 é só pra quando o usuário quer
**ver a tela de verdade** (ex.: pra conferir algo visualmente); a extração de dados em si
é API-to-API, sem navegador.

**Pendência (seção 16):** descobrir `person_id` programaticamente — hoje foi lido do
payload de resposta de uma chamada já autenticada; precisa achar de onde a própria
Experience descobre isso no login (provável endpoint de perfil/sessão) antes de automatizar
sem intervenção manual.

## 11. Modelo de dados — entidade Cliente

Nova tabela/coleção `clientes` (SQLite, mesmo banco da seção 9):

| Campo | Descrição |
|---|---|
| `id` | Interno, autoincrement |
| `nome` | Nome de exibição (ex.: "AMATOOLS COMERCIAL E IMPORTADORA LTDA") |
| `experienceProjetoId` | ID do projeto na Experience (ex.: `10269`) |
| `experiencePersonId` | `person_id` do usuário logado nesse contexto (ver pendência acima) |
| `agendaRecursoUsuario` | Username do recurso na Agenda de Recursos (ex.: `FLAVIANO.SANTOS`) — pra filtrar eventos do usuário logado |
| `repositorioLocal` | Caminho da pasta local do repositório git desse cliente (associação manual, seção 14) |
| `repositorioRemoto` | URL do remote git (informativo/cadastro, seção 14) |

Tela de cadastro/edição manual desses campos — sem tentativa de auto-descoberta nesta fase
(decisão da seção 2).

## 12. Calendário por cliente

Dentro da aba **Sankhya › Clientes**, ao selecionar um cliente:

- Calendário mensal (ou visão de semana, decidir na implementação conforme espaço de tela)
  mostrando os dias em que o usuário logado tem atuação **combinando**:
  - Tarefas da Experience (`tasks/filtering`) daquele `experienceProjetoId` +
    `experiencePersonId`.
  - Eventos da Agenda de Recursos (tabela local) daquele `agendaRecursoUsuario`.
- **Indicador vermelho no dia**: quando existir tarefa/OS com status "Atrasada"
  (`task_status: "Atrasada"` da Experience, ou OS com `accepted_os_status` pendente e data
  de execução no passado) associada àquele dia.
- **Clicar no dia** abre modal mostrando:
  - OS já lançadas naquele dia (via `orders/filtering`, filtrando por período = aquele dia).
  - Tarefas daquele dia ainda **sem** OS lançada (via `tasks/filtering` menos o que já
    aparece em `orders/filtering`).
  - Formulário "Gerar OS" com os campos já mapeados (seção 7.1 do
    `sankhya-experience-tarefas-api.md`): `Data`, `Hora Inicial`, `Hora Final`, `Intervalo`,
    `Classificação`, `Tarefas Realizadas`. **Endpoint de submit confirmado** (seção 7.2 do
    mesmo doc, testado em 2026-09-10): implementar como 3 chamadas em sequência —
    `POST /orders` (cria a OS) → popup "enviar pro cliente aprovar?" → se **Sim**,
    `POST /accepted-os` (gera aceite) seguido de `POST /accepted-os/send-email` (dispara
    e-mail); se **Não**, parar depois do `POST /orders` (comportamento não confirmado, mas
    é a leitura razoável do fluxo).

## 13. Aba "Agenda Mensal" (resumo)

Visão consolidada de **todos os clientes** cadastrados, mês corrente: um resumo visual
(semáforo por cliente ou por dia — decidir no design, mas o critério é: verde = todas as
tarefas do período têm OS gerada e em dia; atenção/vermelho = existe atraso ou tarefa sem
OS). Serve como "olhar rápido" antes de entrar em cada cliente individualmente.

## 14. Git Autosync — integração

### 14.1 Configuração geral (aba "Git", nível hub)

- Lista de repositórios hoje configurados no `~/.git-autosync/config.json` (lido via
  `hub-helper.ps1`), com o mesmo tipo de informação que `git-autosync.exe list --json` ou
  `status --json` devolve.
- **Cada linha da lista corresponde a uma pasta local.** Ao lado do caminho da pasta,
  **checkbox "faz parte do autosync"**: marcar chama `POST /git-autosync/repos` (helper →
  `git-autosync.exe add <caminho>`); desmarcar chama `DELETE` equivalente. Isso substitui
  a tela/CLI do git-autosync como forma primária de gerenciar quais pastas entram no
  agendamento automático.

### 14.2 Sub-aba de Git dentro de cada Cliente

Dentro da tela do Cliente (seção 12), uma sub-aba **Git** mostrando, filtrado pela
`repositorioLocal` daquele cliente:

- Cadastro/edição do repositório local e remoto (campos já existem no modelo de dados,
  seção 11 — esta sub-aba é a UI deles).
- Histórico de commits, com a mesma lógica visual do histórico do git-autosync
  (`git-autosync.exe history --json`, filtrado pelo caminho desse cliente).
- Botões **Commit**, **Push**, **Sync**, **MR** — mesmos subcomandos do CLI, aplicados à
  pasta desse cliente especificamente (checar limitação de "checar antes de implementar"
  da seção 7 sobre se o CLI aceita um caminho-alvo).

## 15. Preservação das funcionalidades atuais — checklist

Não é opcional, é requisito de aceite desta fase:

- [ ] Todas as rotas de `src/routes.ts` continuam respondendo igual (contrato inalterado).
- [ ] Card do serviço "Sankhya - Local" (WildFly + Oracle) continua com semáforo, ações
      (subir/parar/reiniciar), botão Testar, Configurações e botão Log funcionando.
- [ ] SSE (`/api/stream`) continua entregando snapshot + deltas sem regressão de latência.
- [ ] Cofre atual (`src/segredos.ts`, variáveis de ambiente por projeto) continua
      funcionando exatamente como hoje — **não confundir com o novo cofre de credenciais
      Sankhya da seção 3**, que é um mecanismo separado (DPAPI, fora do container).
- [ ] `docker compose up -d --build` e o atalho `scripts/criar-atalho.ps1` continuam
      subindo o hub normalmente, agora também iniciando o `hub-helper.ps1` novo (atualizar
      o atalho pra também iniciar esse processo, do mesmo jeito que já inicia os helpers do
      WildFly).

## 16. Pendências abertas (resolver antes ou durante a implementação)

1. ~~Endpoint de criação de OS~~ — **resolvido em 2026-09-10**, ver seção 12 e
   `sankhya-experience-tarefas-api.md` seção 7.2. Restam sub-pendências menores: onde vai
   o campo `Classificação` no body (não apareceu no teste, só "Conformidade" foi usado) e
   o que acontece ao clicar "Não" no popup de aprovação (não testado).
2. **Viabilidade do proxy-iframe (CORS/CSP)** — spike descrito na seção 8.3, fazer antes de
   construir o resto da integração de proxy.
3. **Descobrir `person_id` da Experience programaticamente** — segue aberta, mas com duas
   pistas descartadas (ver 18.2): NÃO é o `id` do JWT (esse é a conta, 378512 vs. 21986)
   e NÃO vem de `get-approvers`. Não bloqueia: o campo está no cadastro do Cliente.
4. **ACL de escrita na Agenda de Recursos via API** — não confirmada (só a via UI está
   confirmada). Se um dia for liberada pelo admin, a escrita fica mais simples que
   automação de UI — não é bloqueante agora, é otimização futura.
5. ~~Confirmar se `commit/push/sync` aceitam um caminho específico~~ — **resolvido**:
   aceitam `--repo PATH`, nenhuma mudança no git-autosync é necessária. Ver seção 7.1.
6. **Formato exato de `filters` na tela de Ordens de Serviço** além de `period`/`users`
   (Classificação, Processos, Serviços, Etapas etc.) — não mapeado, só necessário se o
   calendário por cliente precisar desses filtros além do que já foi confirmado.

## 17. Ordem de implementação sugerida (fases)

1. **Fase 0 — Spikes de validação** (sem código de produto ainda): proxy-iframe
   (seção 8.3) e, em paralelo (fora desta branch), a captura do endpoint de criação de OS.
2. **Fase 1 — Paridade React**: migrar o frontend atual pra React sem adicionar nenhuma
   feature nova. Critério de pronto: checklist da seção 15 inteiro marcado.
3. **Fase 2 — `hub-helper.ps1`**: DPAPI (credenciais) + shell-out do git-autosync,
   atualizando o atalho de inicialização.
4. **Fase 3 — Cadastro de Clientes** (seção 11) + credenciais Sankhya (seção 3) via UI.
5. **Fase 4 — Extração Experience** (leitura, seção 10) + calendário por cliente
   (seção 12, sem o botão de Gerar OS ainda) + indicador de atraso.
6. **Fase 5 — Proxy reverso** (seção 8) — só depois do spike da Fase 0 confirmar que vale
   a pena, senão usar o fallback de aba real.
7. **Fase 6 — Extração + escrita da Agenda de Recursos** (seção 9).
8. **Fase 7 — Modal "Gerar OS"** completo (seção 12) — endpoint já confirmado (pendência 1
   resolvida), sem bloqueio pra esta fase.
9. **Fase 8 — Git Autosync integrado** (seção 14, config geral + sub-aba por cliente).
10. **Fase 9 — Aba "Agenda Mensal"** (seção 13), por último — depende de todo o resto já
    estar alimentando dados reais.

Cada fase deve manter o hub funcional e implantável ao final (não deixar o build quebrado
entre fases).

## 18. Estado da implementação

| Fase | Estado | Observação |
|---|---|---|
| 1 — Paridade React | **pronta** | `web/` (Vite + React), `public/` virou artefato de build. Checklist da seção 15 conferido na tela. |
| 2 — `hub-helper.ps1` | **pronta** | DPAPI + git-autosync na porta 4102, com token (seção 3.2). Ações de escrita do git **não testadas** — ver abaixo. |
| 3 — Cadastro de Clientes + credenciais | **pronta** | SQLite `sankhya.db`, abas Sankhya › Clientes e Credenciais. |
| 8 — Git Autosync | **pronta** | Aba Git (14.1) e sub-aba Git dentro de cada cliente (14.2). |
| 4 — Extração Experience | **destravada** | Autenticação resolvida e medida (18.2): sessão real capturada, `tasks/filtering` e `orders/filtering` respondendo 200 de dentro do Node. Falta escrever o cliente e o calendário. |
| 0, 5, 6, 7, 9 | pendentes | 0 e 5 dependem do spike de CORS do iframe; 6 de uma captura do JSON da Agenda; 7 e 9 vêm depois da 4. |

### 18.1 Autenticação — o desenho mudou em relação à seção 8.2

A seção 8.2 previa o hub preenchendo usuário e senha no formulário de login via
Playwright. **Não foi isso que se implementou.** O caminho agora é:

1. O helper abre uma janela de navegador com perfil próprio do hub
   (`%APPDATA%\sankhya-hub\navegador`), separado do Chrome do usuário, com
   `--remote-debugging-port=9222` em `127.0.0.1`.
2. O usuário faz o login nessa janela, na cara dele. **A senha não passa pelo hub.**
3. O helper lê os cookies pelo DevTools Protocol (`Storage.getCookies` no alvo do
   navegador, que devolve o perfil inteiro sem precisar descobrir a guia certa) e os
   guarda cifrados com DPAPI, no mesmo cofre da senha.

Por que assim: sobrevive a MFA, não quebra quando a Sankhya muda o layout da tela de
login, e permite operar sem nunca guardar a senha. O login automatizado da seção 8.2
continua possível como camada opcional — o campo de senha segue na tela, escondido atrás
de um toggle, para quem quiser que o hub religue sozinho.

A porta 9222 **não** é exposta ao container: quem fala CDP é o helper, e o hub recebe o
resultado pela 4102, que exige token. Abrir o CDP para a rede daria controle total de um
navegador logado no Sankhya para qualquer aparelho que alcançasse a porta.

### 18.2 O que autentica a API da Experience — MEDIDO, e não é o cookie

Spike feito com sessão real logada, em 2026-09-10. Resolve a pendência da seção 5 de
`sankhya-experience-tarefas-api.md` ("validar se o cookie sozinho basta fora do browser").

| Tentativa contra `tasks/filtering` | Resultado |
|---|---|
| Sem nada (controle) | **403** |
| Só o cookie de sessão | **403** |
| Cookie + `Origin`/`Referer` corretos | **403** |
| `Authorization: Bearer <localStorage.token>` | **200** — 11 tarefas |
| `Authorization: <token>` sem o `Bearer` | 403 |

**Conclusão: o cookie não serve para a API.** Quem autentica é um JWT guardado em
`localStorage.token` da página da Experience. Não existe cookie no domínio
`amazonaws.com` — a chamada ao API Gateway não depende de cookie nenhum.

Consequências, todas boas:

1. **Playwright é desnecessário para a coleta.** O JWT funciona de dentro do Node, fora
   do navegador. O browser só é preciso no momento do login, e a janela pode ser fechada
   depois. A decisão de engordar a imagem com Chromium fica cancelada.
2. O JWT vale **72 horas** (`exp` no payload). O helper decodifica e guarda a data em
   claro (`expira`), e a tela mostra "expira em 3 dias" — dá para avisar antes de falhar.
3. A captura agora **exige** o token para a Experience. É o único teste honesto de "está
   logado": cookie anônimo existe antes do login e dava falso positivo.

`orders/filtering` também respondeu 200 com o mesmo token, então a Fase 4 inteira está
destravada do lado da autenticação.

**O que o JWT NÃO resolve:** o `person_id`. O `id` do payload é 378512 (a conta na
Experience), enquanto o `person_id` usado no caminho da API é 21986. `get-approvers`
devolve só os aprovadores do projeto, não o usuário logado. Segue vindo do cadastro
manual do Cliente — não bloqueia nada, mas a pendência 3 continua aberta.

Descoberta secundária: a Experience redireciona o login para **`login.sankhya.com.br`**,
um terceiro domínio. O filtro de cookies por sufixo (`sankhya.com.br`) já o cobre.

**Não verificado, precisa de você:**

- `commit`, `push`, `sync` e `mr` pela tela: escrevem em repositório real, então não foram
  disparados. O caminho de leitura (status, config, histórico, prévia) foi exercitado
  contra a instalação real e funciona.
- Build da imagem Docker (`docker compose up -d --build`): o Docker Desktop estava fora do
  ar na máquina durante a implementação. O `Dockerfile` e o `docker-compose.yml` mudaram
  (estágio de build do painel, mount de `%APPDATA%/sankhya-hub/ipc`).
- `scripts/iniciar-monitor.ps1` de ponta a ponta: as três funções `Start-*Helper` viraram
  uma `Start-Helper` parametrizada, e o helper do hub entrou como terceira chamada.
