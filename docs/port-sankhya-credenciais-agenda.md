# Port de Credenciais + Agenda (do sankhya-hub para o HUB SNK)

## ✅ DECIDIDO (2026-09-23) — hub-snk e sankhya-hub (Flaviano) vão virar um produto só

Carlos confirmou: não são dois produtos que vão convivir, é absorção. Isso
resolve a questão do helper/credentials.dat compartilhado (alternativa 1:
manter como está, é recurso de UM produto, não de dois) e confirma a
estratégia já em curso — portar peça por peça pra dentro do `hub-snk`,
preservando a identidade e as rotas dele (cadastro de clientes), em vez de
importar o `index.ts` do sankhya-hub que substituiria tudo (ver o problema
achado no merge da `dev` com `hub-suite`, seção mais abaixo/histórico da
conversa). Quando o port cobrir o que importa do sankhya-hub, o worktree
`hub-snk-flaviano` e o branch `flaviano-sankhya-hub` ficam sem função —
decisão de quando descartar é futura, não agora.

Notas de acompanhamento enquanto porto as abas **Credenciais** e **Agenda** do
projeto do Flaviano (`hub-snk-flaviano`, branch `flaviano-sankhya-hub`) para o
HUB SNK (`dev`, porta 4200). Pontos que exigem decisão do Carlos ficam
marcados com **⚠️ DECISÃO**.

## Estado

- [x] **Fase 1 — transporte para o helper.** `src/sankhya/helper.ts`,
      `src/rotas/rotasSankhya.ts` (`GET /api/sankhya/helper`), variáveis
      `HUB_HELPER_URL` / `HUB_HELPER_TOKEN_FILE` em `configuracao.ts`.
      Validado: `curl localhost:4200/api/sankhya/helper` → `{"disponivel":true}`.
- [x] **Fase 2 — captura de credenciais.** `src/sankhya/credenciais.ts`,
      rotas em `rotasSankhya.ts` (status, salvar, remover, abrir navegador,
      capturar sessão, fechar navegador). Aba nova (cadeado, topbar) com 2
      cartões (ERP / Experience). Fora do escopo: importar favoritos do
      navegador pessoal (onboarding, não é a aba Credenciais em si) e o
      caminho do shell desktop (ver "O que NÃO é portável como está").
      Validado via `curl` nos três endpoints principais.
- [x] **Fase 3 — SQLite + snapshot da agenda + campos no cadastro.**
      `src/sankhya/{agenda,agendaParser}.ts` portados quase sem alteração;
      `Cliente` ganhou `agendaRecursoUsuario`/`agendaCodparc`; rota
      `PUT /api/clientes/:id/agenda` (padrão de `definirAnotacoes`); rotas
      `POST /api/agenda/importar`, `GET /api/agenda/{estado,recursos,sugestao}`,
      `GET /api/clientes/:id/atuacao`. Frontend: aba "Agenda" em Configurações
      (colar JSON + importar + estado do snapshot) e seção "Agenda de
      Recursos" no detalhe do cliente (usuário/codparc com auto-save +
      lista de dias de atuação). **Sem grade de calendário visual** — só
      lista de texto; o grid mensal fica pra Fase 4, junto com a Experience.
      Validado ponta a ponta via `curl`: importar snapshot sintético → casar
      parceiro por nome → vincular cliente real → ler dias de atuação. Todos
      os passos bateram certo.
- [x] **Fase 4 (retomada, só leitura) — Experience + calendário cruzado.**
      `src/sankhya/{experience,calendario}.ts` portados sem os métodos de
      escrita (`prepararOrdem`, `criarOrdem`, `gerarAceite`, `detalharOrdem`
      ficaram de fora — geram OS/mandam e-mail, fora de escopo). 2 campos
      novos no `Cliente` (`experienceProjetoId`, `experiencePersonId`), rota
      `PUT /api/clientes/:id/experience`. Rotas de leitura:
      `GET /api/experience/person-id`, `GET /api/clientes/:id/agenda-mensal`
      (grade do mês já cruzada — eventos do ERP + tarefas/ordens da
      Experience, via `montarGrade`). Frontend: campos de projeto/person_id
      com auto-save e botão "Descobrir person_id"; calendário mensal inline
      na seção "Agenda de Recursos & Experience", com navegação de mês e
      selo colorido por dia (`casado`/`alocado-sem-os`/`os-sem-alocacao`/etc).
      Validado via `curl`: dia com evento do ERP e nenhuma OS voltou
      `cruzamento: "alocado-sem-os"`, exatamente a regra esperada.
      `Credenciais.revelar()` religado (removido na Fase 2 por falta de uso;
      `Experience` precisa dele para o token, só uso interno, sem rota HTTP).

## Pontos críticos

### ✅ DECIDIDO (2026-09-23) — senha em texto puro, nos dois casos

Carlos escolheu a opção 3: senha de base continua em texto puro no
`clientes.json`, sem migração para DPAPI. Nenhuma mudança de código —
decisão de aceitar o risco por ora, revisitável depois se algum dia hub-snk
sair do ambiente controlado de hoje (só na máquina do Carlos).

### Automação de navegador (CDP) mora inteira no helper, não no Node

Boa notícia: `hub-helper.ps1` já faz toda a automação via Chrome DevTools
Protocol (abrir janela, ler cookie/JWT). O lado Node (`credenciais.ts` do
Flaviano) é só um cliente HTTP fino desse helper. **Não precisamos escrever
automação de navegador no HUB SNK** — só replicar as rotas que chamam o
helper.

Implicação: a janela do navegador que o usuário loga precisa ficar **visível**
— não é headless. É a mesma UX que já validamos nesta sessão com o
`hub-helper.ps1` pro monitor do Flaviano.

### `node:sqlite` funciona nesta máquina

Confirmado (Node v24.18.1, `require('node:sqlite')` ok). Sem bloqueio de
versão pra Fase 3. Ainda assim é dependência nova pro HUB SNK, que hoje é 100%
arquivo JSON (`repositorioClientesArquivo.ts`) — banco relacional é um
conceito que não existe no projeto ainda.

### Cadastro de cliente precisa de 2 campos novos (Fase 3) — feito

`agendaRecursoUsuario` e `agendaCodparc` adicionados a `Cliente`
(`src/tipos.ts`). Clientes antigos sem os campos recebem `''`/`null` na
leitura (mesmo padrão usado pra `anotacoes`/`bases`), sem precisar migrar o
arquivo na mão.

### `sankhya.db` fica dentro de `dados-hub-snk/`

Mesma pasta do `clientes.json`, mas é arquivo binário SQLite — não entra no
`.gitignore` por engano (já está fora do controle de versão, como o resto de
`dados-hub-snk/`), mas vale checar se algum backup/sincronização da pasta trata
bem um arquivo que muda em WAL (`-shm`/`-wal` ao lado).

### O que NÃO é portável como está

`desktopBridge.ts` e `sessaoDesktop.ts` (do Flaviano) dependem do shell
desktop Electron dele. O HUB SNK não tem shell desktop — essas ramificações
são ignoradas no port, mantendo só o caminho container/helper.

### ⚠️ DECISÃO — Fase 4 é maior do que parecia, pausada

Ao ler `routesExperience.ts` e `experience.ts` do Flaviano de verdade (não só
o resumo do investigativo), a integração com o Sankhya Experience não é só
"mostrar tarefas no calendário" — inclui:

- `POST /orders`: **cria Ordem de Serviço de verdade** no projeto.
- `/accepted-os/send-email`: **manda e-mail de aprovação pro cliente**, não
  reversível pelo hub.
- Dois campos novos de cadastro (`experienceProjetoId`, `experiencePersonId`)
  amarrando o cliente a um projeto de implantação da Experience — conceito
  de consultoria/projeto, não de "cadastro de cliente" como o HUB SNK tem
  hoje.

Perguntei o escopo antes de portar. Decisão: **pausar a Fase 4 inteira** por
enquanto — nem a parte de leitura (tarefas/ordens no calendário) foi feita.
Fases 1–3 (helper, credenciais, snapshot da Agenda de Recursos) ficam de pé e
funcionando; retomar isso é decisão futura, com escopo (só leitura vs. criar
OS) definido antes de qualquer código.

### Consulta automática da Agenda de Recursos (2026-09-23) — implementada, sem copiar JSON

Carlos pediu pra não reusar o fluxo de colar JSON manual (Fase 3) — queria a
lógica nova, consultando a Agenda de Recursos do SankhyaOn direto.

Analisei um `.har` real (`Downloads/agenda de recursos.har`) pra achar a
chamada verdadeira: `POST https://skw.sankhya.com.br/mgeos/service.sbr?
serviceName=AgendaRecursosSP.carregarAgendas`. Achado importante: o request
carrega um header `sktk` calculado por `sktk.y(conteudo)` no `snk.js` do
Sankhya, que chama `top.charcleaner.a(...)` — um objeto injetado no
`window`, ofuscado. **Isso é mecanismo anti-automação**: só existe dentro de
uma página real do navegador. Não tentei reproduzir esse cálculo — seria
engenharia reversa de proteção anti-bot, e perguntei o Carlos antes de seguir.

Caminho aprovado: usar o CDP que já controla o navegador do helper pra
disparar o `fetch` de DENTRO da aba autenticada (`credentials: 'same-origin'`),
onde o `sktk` sai natural do contexto real da página. **Achado bônus:** essa
função (`Get-AgendaRecursos`) e a rota (`POST /browser/agenda`) **já existiam
prontas no `hub-helper.ps1`** do Flaviano — só precisei ligar o hub-snk nela,
zero PowerShell novo.

Implementado: `Credenciais.consultarAgendaDeRecursos(de, ate)` chama
`/browser/agenda`; rota `POST /api/agenda/consultar` (recebe `YYYY-MM-DD`,
converte pra `DD/MM/YYYY`, importa no snapshot) e `GET /api/agenda/eventos`
(lista sem recorte de cliente). Aba "Agenda" do topo (antes "Ainda não
implementado") agora tem campos de data + botão "Consultar Agenda de
Recursos" + lista de eventos por dia.

**Validado com dado real**, não sintético: consultei de verdade e importou 1
recurso, 5 eventos, todos com nome de parceiro e data corretos.

### ⚠️ PAUSADO (2026-09-23) — verificação de tarefa aberta por parceiro (`getNegociacoes`)

Pedido do Carlos: pra cada evento da Agenda de Recursos, verificar se existe
tarefa aberta no Experience pro parceiro daquele evento — sem usar cadastro
manual (Fase 4), descobrindo o FAP (`numNegociacao` com `tipo:"2"`) na hora
via `AgendaRecursosSP.getNegociacoes`, a partir do `.har` real analisado
(`listaFAP.har`, `buscaTarefaExperience.har`).

**Implementado (funciona tecnicamente, mas bloqueado por permissão real):**

- `hub-helper.ps1`: `Get-NegociacoesDoParceiro` + rota `POST /browser/agenda-negociacoes`.
- hub-snk: `Credenciais.consultarNegociacoesDoParceiro()`, `src/sankhya/negociacoes.ts`
  (parser + `fapsDoParceiro`), `Experience.temTarefaAberta()`, rota
  `GET /api/agenda/tarefa-aberta?codparc=`.
- Frontend: removido (mostrava selo permanentemente quebrado). O código de
  chamada (`api.tarefaAbertaDoParceiro`) foi tirado; a rota do backend
  continua de pé, só não é chamada por ninguém agora.

**Por que parou:** `getNegociacoes`, diferente de `carregarAgendas`, exige o
header `sktk` — confirmei isso e resolvi corretamente (token calculado pelo
serviço Angular real da página, via `injector.get('sktk').y(...)`, testado
e retornando um valor válido). Mesmo com sessão, `resourceID`, `mgeSession`,
`globalID`, `vss` e `sktk` todos corretos, o Sankhya **ainda** devolve
`status: "3"` / `"Não autorizado."`. Não é mais bloqueio técnico
(anti-automação) — é uma autorização de servidor que só parece valer dentro
do fluxo real do popup na tela (estado de sessão que a automação não
reproduz). Não investiguei mais fundo por decisão do Carlos.

**Se for retomar:** ideia não testada — usar CDP pra simular o clique real
que abre o popup de negociações na tela (em vez de chamar o serviço direto),
deixando o próprio Sankhya montar o contexto que ele exige. Alternativa mais
simples: abandonar a descoberta automática e usar os campos já existentes
(`experienceProjetoId`/`experiencePersonId`, Fase 4) cadastrados à mão por
cliente — funciona hoje, sem depender de `getNegociacoes`.

### Dependência entre as duas features

Agenda (Fase 3/4) depende da sessão do Sankhya Experience capturada por
Credenciais (Fase 2). Não dá pra portar Agenda isolada — a ordem das fases
importa.
