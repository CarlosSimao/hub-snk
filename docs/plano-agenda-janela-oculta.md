# Plano — Agenda por janela oculta

## Objetivo

Fazer o HUB SNK buscar a Agenda de Recursos do Sankhya OM de forma imperceptível para o
usuário: sem depender de ele deixar a tela "Agenda de Recursos" aberta na aba ERP, sem
recarregar a aba que ele está usando e sem os erros recorrentes de "abra a tela" e de
sessão expirada.

A busca traz **apenas os eventos do próprio usuário** (pelo `CODUSU` da configuração
global, "Meu código de usuário Sankhya OM"), **mês a mês**, acumulando no snapshot local
em vez de sobrescrever tudo a cada consulta. A aba Agenda do menu principal mostra todos
os eventos do usuário; a aba Agenda dentro do cadastro do cliente mostra os mesmos
eventos recortados pelo(s) parceiro(s) vinculado(s).

## Diagnóstico que motivou a mudança

Provado em teste, com credencial real, contra o Sankhya OM de produção:

1. `MobileLoginSP.login` (login por API) autentica, mas a sessão resultante tem **ACL
   restrito**: `AgendaRecursosSP.carregarAgendas` responde `Acesso negado ao serviço`
   para o mesmo usuário que, no navegador, tem acesso normal.
2. O login **web** (formulário + `LoginUnicoSP`) cria a sessão com o serviço liberado.
3. O header anti-robô `sktk` (WebAssembly `skm0.1.wasm` / `top.charcleaner.a`) é
   aceito quando gerado fora do navegador — não é mais barreira.

Conclusão: a única forma confiável de ter o ACL completo é **logar pelo fluxo web**. Por
isso a solução é uma janela Electron oculta, com sessão própria, que faz o login web
sozinha e chama o serviço de dentro do contexto autenticado dela — nunca da aba visível
do usuário.

## Arquitetura da solução

- **Janela/contexto oculto** (`desktop/`): uma `WebContentsView` (ou `BrowserWindow`
  `show: false`) com **partição de sessão própria**, separada da aba ERP visível. Ela:
  1. Navega para a tela de login do ERP e preenche usuário/senha (reusa
     `scriptAutofillTick` do `autofill.ts`), com a credencial do cofre.
  2. Abre a tela "Agenda de Recursos" nela mesma, uma vez.
  3. Chama `AgendaRecursosSP.carregarAgendas` filtrando só o `CODUSU` configurado,
     mês a mês, pelo `ServiceProxy` da própria tela.
  4. Reloga sozinha quando a sessão expira — recarregar essa janela não afeta nada do
     usuário.
- **Camada de dados** (`src/sankhya/agenda.ts`): grava **incremental por período e por
  `CODUSU`**, em vez de apagar tudo.
- **Rotas** (`src/rotas/rotasAgenda.ts`): passam o `CODUSU`; sem o relogin baseado em
  texto de erro.
- **Frontend** (`public/app.js`): a grade abre com o cache local e atualiza em segundo
  plano; a aba Agenda do cliente consulta sozinha o mês que faltar.

## Fases

### Fase 1 — Camada de dados incremental (backend, sem Electron) ✅

- [x] `src/sankhya/agenda.ts`: `importar` passa a substituir apenas os eventos do
      `CODUSU` alvo que cruzam o período consultado, preservando os demais meses.
- [x] `src/sankhya/agenda.ts`: filtrar o payload para o `CODUSU` alvo (defesa: mesmo que
      o Sankhya devolva outros usuários, só a agenda do próprio é gravada).
- [x] `src/sankhya/agenda.ts`: `#upsertRecurso` evita recurso duplicado (chave `CODUSU`,
      com queda para `nomeusu`). Migração de schema não foi necessária: as colunas não
      mudaram, e o `sankhya.db` é cache reconstruído a partir do Sankhya.
- [x] Novo `src/sankhya/agenda.test.ts`: acumular mês a mês sem perder o anterior;
      reconsultar o mesmo mês não duplica; mês esvaziado remove os eventos; evento que
      cruza meses não duplica; payload com outro usuário não entra; recorte por parceiro.
- [x] `src/rotas/rotasAgenda.ts`: as duas chamadas de `importar` passam o `periodo` (o
      `codusuAlvo` fica para a Fase 4).
- [x] `npm test` (136 testes) e `npm run typecheck` verdes.

### Fase 2 — Janela/contexto oculto (Electron) ✅

- [x] `desktop/src/janelaAgendaOculta.ts` (novo): `BrowserWindow` oculta
      (`show:false`, `skipTaskbar`, `backgroundThrottling:false`) com partição própria
      (`persist:sankhya-hub-agenda`); login web automático; abre a tela da Agenda nela
      mesma; expõe `buscar(de, ate)` e `buscarNegociacoes(codParceiro)` pelo `ServiceProxy`
      da própria página (documento de topo, não iframe).
- [x] Reaproveita `scriptAutofillTick` para o login; submete o formulário depois de
      preencher; espera a navegação sair da tela de login e o `ServiceProxy` montar.
- [x] Detecção de sessão caída (HTML, "Não autorizado", "Acesso negado") com relogin e
      uma única retentativa dentro da própria janela.

### Fase 3 — Ligar a janela oculta ao fluxo ✅

- [x] Contrato `ConsultorDeAgenda` (buscar/buscarNegociacoes); `bridgeServer` depende dele,
      não da implementação concreta.
- [x] `desktop/src/main.ts`: cria a `JanelaAgendaOculta` no boot, injeta no bridge e a
      fecha no encerramento (`before-quit`).
- [x] `desktop/src/bridgeServer.ts`: rotas `/agenda/*` passam a falar com o contrato.

### Fase 4 — Rotas e CODUSU ✅

- [x] `src/rotas/rotasAgenda.ts`: lê o `CODUSU` da configuração e passa como `codusuAlvo`
      no `importar`; removido o relogin baseado em texto de erro (`/status/.test(...)`).
- [x] `src/index.ts`: injeta o `RepositorioConfiguracao` nas rotas da agenda.
- [x] Erro claro (`400`, `cadastroIncompleto`) quando o "Meu código de usuário Sankhya OM"
      não está configurado.

### Fase 5 — Frontend sem espera ✅

- [x] `public/app.js`: a aba Agenda do menu principal abre com o cache e atualiza em
      segundo plano; trocar de mês mostra o cache na hora e a consulta roda por trás, sem
      apagar a grade em caso de erro.
- [x] `public/app.js`: a aba Agenda do cadastro do cliente mostra o cache e dispara a
      consulta do mês em segundo plano para preencher o que faltar.

### Fase 6 — Limpeza e documentação ✅

- [x] Removido o fluxo antigo baseado na aba visível (`desktop/src/agenda.ts` inteiro:
      `AgendaFetcher`, exigência de "abra a tela", relogin por texto). `ResultadoFetch`
      migrou para `janelaAgendaOculta.ts`.
- [x] `docs/api.md` atualizado (`/api/agenda/consultar`). `docs/funcionalidades.md` não
      tem seção de agenda.
- [x] `npm test` (136), `npm run typecheck` (backend e desktop) e `prettier` verdes.

### Validação ao vivo ✅ (base de produção, 2026-09-28)

- [x] A janela oculta loga sozinha pela web e abre a tela pelo hash do workspace (~17s na
      primeira vez). Carregar o `.xhtml5` direto respondia 500 — corrigido para abrir via
      workspace, que registra o `resourceID` na sessão.
- [x] Consulta de setembro importou 25 eventos; a de outubro reusou a janela (0,2s) e somou
      1, totalizando 26 — acúmulo mês a mês confirmado.
- [x] Todos os eventos com `CODUSU` 4817 (só a agenda do próprio usuário); recurso único
      `USUARIO.TESTE(4817)`.
- [ ] Ainda não exercitado ao vivo: relogin automático ao expirar a sessão (caminho existe,
      dispara em resposta HTML/"Não autorizado"/"Acesso negado") e a interação pela própria
      UI (as rotas que ela consome já foram validadas via API).

## Decisões e riscos

- **Login web, não API**: exigência do ACL do Sankhya. Custo: a janela leva alguns
  segundos para subir e logar na primeira vez.
- **Partição de sessão separada** da aba ERP visível: a janela oculta não pode
  compartilhar cookie com a aba do usuário, senão relogar/recarregar uma afetaria a
  outra.
- **`CODUSU` obrigatório**: sem ele não há como filtrar "só a minha agenda"; a UI já tem
  o campo em Configurações › Geral.
- **`sankhya.db` é cache**: pode ser recriado a qualquer momento a partir do Sankhya, o
  que simplifica a migração de schema.

## Extensão — Aba OS pela janela oculta (2026-09-28)

Mesmo problema da agenda: a aba OS chama a API da Experience (AWS) com `Bearer <JWT>`, e o
JWT vinha da aba Experience VISÍVEL — se ela não estivesse logada, a OS quebrava.

- **Novo** `desktop/src/loginOcultoSankhya.ts`: peças comuns de login oculto (`criarJanelaOculta`,
  `preencherESubmeterLogin`), extraídas da janela da Agenda e reusadas pelas duas.
- **Novo** `desktop/src/janelaExperienceOculta.ts`: janela invisível própria
  (`persist:sankhya-hub-experience`) que loga sozinha, lê o `localStorage.token` e renova
  com folga antes de expirar (`obterSessao`). Não chama a API — só produz o token.
- `desktop/src/sessions.ts`: `capturarTokenDeWebContents` (reusável) e `decodificarJwt`
  exportado; `capturarTokenExperience` (aba visível) passou a delegar.
- `desktop/src/main.ts`: o laço de 15s lê o token da janela oculta (com guarda contra
  ticks concorrentes) em vez da aba visível; fecha a janela no encerramento.
- `desktop/src/janelaAgendaOculta.ts`: refatorada para usar o `loginOcultoSankhya`.

Backend (`src/sankhya/experience.ts`) inalterado — continua chamando a API server-side com
o token empurrado. O erro `ERR_ABORTED` no `loadURL` (a Experience redireciona para
`login.sankhya.com.br`) é ignorado de propósito: a página de login carrega mesmo assim.

**Validado ao vivo:** token pronto em ~4s, empurrado ao backend; `POST /api/os/consultar`
de setembro devolveu 20 OS com número, empresa e horários. Agenda segue funcionando após o
refactor do login compartilhado.

## Vínculo do cliente unificado por NOME (2026-09-28)

Havia dois vínculos com o Sankhya: `nomesCompletos` (por nome, usado pela OS) e
`agendaCodparcs` (por CODPARC, amarrado à mão, usado pela aba Agenda do cliente). O segundo
foi **eliminado** — a aba Agenda passou a casar o parceiro pelo nome, como a OS.

- `src/tipos.ts`: removido `agendaCodparcs` de `Cliente`.
- `src/sankhya/agenda.ts`: `casarParceiro` (sugestão de um único parceiro) virou
  `codparcsPorNomes(nomes)` (todos os CODPARCs cujo nome casa).
- `src/rotas/rotasAgenda.ts`: `/api/clientes/:id/agenda-eventos` deriva os CODPARCs pelo
  nome; removida a rota `/api/clientes/:id/agenda-sugestao`.
- `src/rotas/rotasClientes.ts`: removida a rota `PUT /api/clientes/:id/agenda` e o schema.
- `src/repositorio/*`: removido `definirAgenda` e o campo; a leitura descarta
  `agendaCodparcs`/`agendaCodparc`/`agendaRecursoUsuario` antigos do arquivo.
- `public/app.js` + `styles.css`: removidos o botão "vincular evento ao cliente" da agenda
  geral, o seletor de cliente, o ícone `link` e o CSS `painel-vinculo`.

**Validado ao vivo:** cliente "Comelli" (Nomes Completos "COMELLI TRANSPORTES" e "COMELLI
TRANSPORTES LTDA", sem nenhum codparc amarrado) passou a mostrar o evento do parceiro 73490
na aba Agenda, casado só pelo nome.
