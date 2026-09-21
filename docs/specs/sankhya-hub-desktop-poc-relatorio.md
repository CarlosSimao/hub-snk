# PoC Electron — relatório de viabilidade (Fase 1)

**Data da execução:** 2026-09-16 (rodada 1 e rodada 2, mesma data)
**Executado por:** Session 1 (Claude Code), com login manual e observação do usuário (flaviano.santos@sankhya.com.br)
**Código da PoC:** `poc-desktop/` (isolada; não altera o app principal)
**Especificação de referência:** `docs/specs/sankhya-hub-desktop-especificacao.md`, Fase 1 (Seção 11)

> **Rodada 2 (continuação, mesmo dia):** investigação dirigida do erro "require is not
> defined"/"Invalid URL" com checagem de URL e sessão, testes complementares
> automatizáveis (pop-up sintético, backend indisponível) e documentação do baseline de
> OS a preservar. Ver Seção "Rodada 2" ao final.
>
> **Rodada 3 (continuação, mesmo dia):** correção da nota sobre o download (o `cancelled`
> era cancelamento manual do próprio usuário, não bug do Electron); stack real da
> exceção do ERP via CDP (conclusão: 100% interna do Electron, não do Sankhya);
> links de clientes cadastrados agora abrem em aba própria isolada; teste real de
> backend indisponível/recuperação com sessão autenticada. Ver Seção "Rodada 3" ao final.

## Ambiente

| Item | Valor |
|---|---|
| SO | Windows 11 Pro |
| Node | v24.15.0 |
| Electron | 44.4.1 |
| Commit do repo no início do trabalho | `68341a1` |
| Backend real usado nos testes | container Docker `sankhya-hub`, `http://localhost:4000` (já estava no ar) |
| Cliente real usado nos testes | Amatools (`experienceProjetoId=10269`, `experiencePersonId=21986`) — vindo do cadastro real via `GET /api/clientes` |
| `hub-helper.ps1` (provedor antigo) | não estava rodando; não foi iniciado nem usado — a PoC testa o provedor **novo** (desktop), não o antigo |

Nenhum segredo (senha, cookie, JWT) aparece neste relatório. `poc-desktop/report/eventos.log` e `resultados.json` (não versionados) guardam metadados sanitizados de cada execução.

## Como reproduzir

```powershell
cd poc-desktop
npm install
npm start
```

Login manual nas abas ERP/Experience dentro da própria janela; botões do painel superior disparam cada teste e gravam o resultado em `report/resultados.json`.

## O que foi reaproveitado (não inventado)

- Agenda: mesmo `serviceName`/payload de `AgendaRecursosSP.carregarAgendas` que `scripts/hub-helper.ps1` (`Get-AgendaRecursos`, linhas ~445-498) já usa — só que executado via `WebContentsView.webContents.executeJavaScript` em vez de CDP externo. O resultado foi entregue à rota **real e já existente** `POST /api/agenda/importar` (`src/routesAgenda.ts:145`).
- Experience: mesmos endpoints e payloads de `src/sankhya/experience.ts` (`tasks/filtering/...`), autenticados com o JWT capturado do `localStorage.token` da aba — mesma chave que `hub-helper.ps1` usa (`$TokenSistema`).

## Resultados por item da matriz (Seção 12 da especificação)

| # | Teste | Status | Evidência / observação |
|---|---|---|---|
| 1 | Chrome/Edge pessoal intocado | **PASS** (por construção, não observado lado a lado) | Partição exclusiva `persist:sankhya-hub-desktop-poc` + `userData` em `poc-desktop/.perfil`, nunca o perfil do Chrome/Edge pessoal nem o perfil do `hub-helper.ps1`. Não testei com o Chrome pessoal aberto simultaneamente comparando estado antes/depois. |
| 2 | Abrir Hub/ERP/Experience sem navegador externo | **PASS** | As 3 abas carregaram dentro do app (`aba-carregada` no log); nenhuma chamada a `shell.openExternal` ocorreu nesse fluxo. |
| 3 | Login normal / MFA-SSO / cancelamento / falha de rede | **PARCIAL** | Login normal real funcionou em ERP e Experience (usuário logou de verdade, 4 vezes ao longo da sessão). Experience usa **redirect in-page** para `login.sankhya.com.br`, não `window.open` — o caminho de pop-up do gerenciador de abas não foi exercitado por um caso real. MFA, cancelamento e falha de rede: **NOT_RUN** (não ocorreram/não foram forçados). |
| 4 | Cookies ERP inclusive HttpOnly, validação útil | **PASS com ressalva** | Correção feita em tempo real: a consulta por `{domain}` perdia o cookie de sessão real (só trazia cookies de analytics); trocada para `{url}` (mede como o Chromium mandaria numa requisição real) e passou a trazer `JSESSIONID`, `isB2B`, `recuperaTela`, `userIDLogado` (11 cookies reais, nenhum valor exposto à UI). **Nenhum desses cookies é `HttpOnly` no ambiente real observado** (`httpOnly: 0`) — o mecanismo de captura via `session.cookies` suporta HttpOnly (é a API certa para isso), mas não há cookie HttpOnly real no Sankhya ERP hoje para confirmar essa parte empiricamente. |
| 5 | JWT Experience: captura + leitura + expiração/logout/recaptura | **PARCIAL — atualizado na Rodada 3** | Token capturado do `localStorage` real (`expIso` decodificado = `2026-09-19T13:57:22Z`). Leitura real de tarefas: `GET-equivalente /tasks/filtering/implantation/10269/person/21986` devolveu **8 tarefas reais** do projeto Amatools. **Atenção (correção da Rodada 3):** o que foi testado é limpar o token em memória do processo principal + recapturar — isso NÃO é logout remoto (o servidor não é avisado). Logout remoto real (clicar "Sair" de verdade) + recaptura + confirmação de leitura útil: **NOT_RUN**. Expiração real do JWT (aguardar 72h) e troca de conta: **NOT_RUN**. |
| 6 | Agenda in-page coincide com baseline | **PASS** | `agenda.fetch` real dentro da aba ERP autenticada trouxe 78.357 bytes de JSON real; entregue à rota real `POST /api/agenda/importar`, que respondeu HTTP 200 com `{ recursos: 12, eventos: 128 }`. Não houve diff formal linha a linha contra uma captura antiga do mesmo período (não existia uma para comparar), mas o endpoint, payload e parser usados são os mesmos da produção. |
| 7 | Criar OS de teste, interromper, reconciliar | **PASS — concluído na Rodada 4** | OS real criada via rota existente (`POST /api/experience/os`), autorização e confirmação explícita do usuário em cada etapa (alvo, horário, texto de observações), alvo de produção conscientemente assumido pelo usuário (cliente Amatools). `orderId 537403` / `numos 7169595`, sem aceite, sem e-mail, verificado por consulta independente. Ver Rodada 4. "Interromper e reconciliar" (timeout no meio da escrita) não foi exercitado por não ter ocorrido — o código trata isso como indeterminado, não repetindo sozinho, mas não houve timeout real para observar. |
| 8 | Reiniciar app / Windows; persistência | **PARCIAL** | App reiniciado 3× de propósito. Experience: sessão (JWT em `localStorage`) **persistiu** sem novo login. ERP: pediu login de novo em pelo menos uma reinicialização — coerente com cookie de sessão sem persistência própria, não é falha da partição (a partição em si persistiu os outros cookies, como confirmado pelo item 4 depois do login de novo). Reinício do Windows: **NOT_RUN**. |
| 9 | Git/logs/SSE/infra continuam OK | **NOT_RUN** | Fora do escopo desta PoC isolada — o app principal não foi tocado nem precisa ser, já que ele continuou rodando normalmente (`docker ps` mostrou `sankhya-hub` saudável o tempo todo). |
| 10 | Pop-up/POST/opener, upload/download/PDF, protocolos externos, links de cliente | **PARCIAL — atualizado na Rodada 3** | Download/PDF real: **PASS**, confirmado (ver Rodada 2 §6, corrigido na Rodada 3: o `cancelled` do log era cancelamento manual do usuário, não bug). Links de cliente cadastrado: **PASS** — agora abrem em aba interna isolada (partição efêmera, sem bridge), testado com 4 clientes reais (Rodada 3 §2). Pop-up SSO: mecanismo confirmado só de forma **sintética**; negação real de domínio fora da lista branca também confirmada. SSO real via pop-up e `mailto:`/protocolos externos: **NOT_RUN**. |
| 11 | Fechar/sair/reabrir, conflito de porta, backend offline, crash de aba | **PARCIAL — atualizado na Rodada 3** | **Bug real encontrado e corrigido**: `app.quit()` na segunda instância não interrompia a execução síncrona do processo — corrigido com `process.exit(0)`, testado de novo, instância única confirmada. **Backend offline: PASS** para resiliência (Rodada 3 §3 — testado com sessão ERP real, porta isolada sem tocar o container compartilhado; conteúdo capturado não se perde, `agenda.importar` é substituição atômica então retry não duplica). Conflito de porta e crash de aba: **NOT_RUN**. |
| 12 | Página remota não acessa bridge nem credencial de outro sistema | **PASS** (após corrigir falso positivo) | 1ª medição deu FAIL porque o teste checava só `typeof window.hub`, e o site real da Experience **também** define um `window.hub` próprio (coincidência de nome) — falso positivo do teste, não do isolamento. Corrigido para checar a **assinatura** da bridge (`window.hub.tabs.mostrar` etc.), não só o nome. 2ª medição: `isolado: true` para ERP e Experience — nenhuma das duas abas remotas enxerga `window.hub` real, `ipcRenderer` ou `require`. |
| 13 | Atualização/rollback sem repetir escrita | **NOT_RUN** | Fora do escopo da Fase 1 — não há empacotamento/instalador nesta PoC. |

## Achado adicional fora da matriz — defeito real, agora caracterizado (ver Rodada 2 para detalhe)

Em pelo menos 2 das 4 rodadas de login real no ERP dentro da `WebContentsView`, a própria página do Sankhya ERP (`skw.sankhya.com.br`) disparou um `alert()` nativo com o texto **"require is not defined"** logo após o login.

**Atualização (Rodada 2, qualificação das evidências):** URL correta confirmada e erro de console correlato reproduzido na carga inicial, antes de novo login. Os reinícios usaram perfil persistente: não excluem cookies/cache/Service Worker anteriores. Mensagem `[E-FLG-401]` de `js/login/sso.js` é correlação observada, não causa raiz isolada. Não há evidência suficiente para atribuir o erro ao ERP ou ao Electron sem stack da exceção e comparação controlada.

## Bugs reais encontrados e corrigidos durante esta rodada

1. **Vazamento de JWT em log** (severidade alta): o evento `aba-carregada` logava a URL completa da aba, e o redirect de SSO da Experience carrega o JWT (com nome e e-mail reais do usuário) na querystring (`?token=eyJ...`). A rotina de redação (`report.js`) só filtrava por **nome de chave** (`cookie|token|senha|...`), não por conteúdo — um JWT completo, legível, ficou gravado em texto puro em `report/eventos.log` por cerca de 45 minutos nesta máquina. **Corrigido**: `report.js` agora também varre valores string por padrão de JWT (`eyJ...\.[...]\.[...]`) e por `?token=`/`&token=` em querystring, redigindo antes de gravar; `main.js` para de logar querystring em qualquer URL (`origemSemQuery`). O log já gravado foi **higienizado** (token substituído por `[jwt-redigido]`) nesta mesma sessão. `resultados.json` nunca teve o token (verificado).
2. **Segunda instância não era realmente bloqueada** (severidade média): ver item 11 da matriz acima.
3. **Diagnóstico de cookies perdia o cookie de sessão real** (severidade baixa, defeito de ferramenta de teste, não do app): ver item 4.

## Recomendação (atualizada após Rodada 2 — ver recomendação final, mais recente, ao fim do documento)

**GO CONDICIONAL** para avançar à Fase 2 (shell e provedor de sessões). O erro do ERP deixou de ser um "desconhecido bloqueante" — está caracterizado, é determinístico, não depende de sessão/URL, e correlaciona com um script do próprio Sankhya ERP (`sso.js`). Condições antes de comprometer o cronograma total:

1. Confirmar com o time do ERP (ou com DevTools anexado — não disponível para esta PoC rodar sozinha) se `[E-FLG-401]` em `js/login/sso.js` é a causa direta do `alert("require is not defined")`, ou se são dois sintomas paralelos do mesmo carregamento. Não bloqueia a Agenda quando ocorre, mas é uma exceção real não tratada na página de produção.
2. Exercitar um cenário **real** de pop-up/SSO quando um estiver disponível — o exercício desta rodada foi só sintético (mecanismo confirmado, não o fluxo real).
3. Reinício do Windows: **depende de coordenação explícita do usuário** (não foi feito — evitado de propósito, ver Rodada 2).
4. MFA real e troca de conta: precisam de cenário/credencial que a PoC não tinha nesta rodada.
5. Completar o teste de escrita de OS (item 7) quando houver ambiente de homologação confirmado — usuário adiou explicitamente para mais tarde no mesmo dia; baseline a reaproveitar já documentado abaixo, nenhuma regra reescrita.

O que já está comprovado com dados reais, não simulados: WebContentsView hospeda Hub/ERP/Experience sem navegador externo; captura de cookie real (incl. o cookie de sessão do ERP) funciona pela API certa; captura de JWT real funciona e persiste entre reinícios; leitura real de tarefas da Experience funciona ponta a ponta; a Agenda de Recursos funciona ponta a ponta reaproveitando a rota real do backend, sem CDP externo; isolamento da bridge se sustenta sob verificação correta; instância única funciona depois do fix; mecanismo de pop-up confirmado (sintético); resiliência a backend indisponível confirmada (código-nível); **download real de PDF via link de mesma origem funciona ponta a ponta** (arquivo confirmado salvo pelo usuário), depois de corrigidos 2 bugs reais de referência/sessão descobertos no processo. Isso cobre o núcleo do risco técnico que a especificação apontava como principal (Seção 14, item final): "compatibilidade de autenticação + consulta de Agenda em página" — e adiciona evidência real para o item 10 da matriz (downloads), que antes estava só em teoria.

---

## Rodada 2 — investigação dirigida e testes complementares (2026-09-16, continuação)

### 1. Checagem de URL do ERP (pedido explícito do usuário)

Evidência do log (`aba-carregada`, `id:"erp"`) em todas as cargas observadas nas duas rodadas: a aba ERP sempre carrega exatamente `https://skw.sankhya.com.br/mge/`, navegando depois para `https://skw.sankhya.com.br/mge/system.jsp` após login — mesma origem, path esperado do app real. **Confirmado: a URL usada é a correta, byte a byte, igual ao `$UrlLogin['sankhya-erp']` de `hub-helper.ps1`. A URL não é a causa do erro.**

### 2. Caracterização do erro "require is not defined" / "Invalid URL"

Metodologia: 3 reinícios automáticos e limpos do app (sem login, sem interação humana — só a carga inicial da página de login do ERP), com captura de console ligada, cada um verificado independentemente no log.

**Resultado: erro de console correlato reproduzido em 3 de 3 reinícios, ~2ms após `did-finish-load` da aba ERP, antes de novo login humano.** Isso mostra que uma nova autenticação não é necessária para reproduzi-lo. Não comprova ausência de JSESSIONID nem descarta estado antigo: o perfil era persistente e o servidor pode emitir cookies já na página de login. É necessário teste com novo diretório de dados para controlar essa variável; alerta visual e erros de console devem ser rastreados separadamente.

Trecho do log (3 ocorrências idênticas, uma por reinício, sanitizado):
```
aba-carregada  id=erp  url=https://skw.sankhya.com.br/mge/
aba-console    id=erp  level=3  "Uncaught (in promise) TypeError: Failed to construct 'URL': Invalid URL"
                        sourceId=electron/js2c/sandbox_bundle  line=2
aba-console    id=erp  level=3  "NotSupportedError: Error connecting to Credential Management service."
                        sourceId=https://skw.sankhya.com.br/mge/
```

Numa 4ª execução (com login real), a mesma janela de tempo também mostrou:
```
aba-console  id=erp  level=3  "[E-FLG-401] Falha ao montar contexto/consultar feature flag [object Object]"
                      sourceId=https://skw.sankhya.com.br/mge/js/login/sso.js
```

**Interpretação, com o grau de confiança que a evidência permite:**
- `sourceId: electron/js2c/sandbox_bundle` localiza um erro reportado no console, mas sem stack completa não permite estabelecer a relação causal com o alerta `require is not defined` nem excluir defeito no runtime.
- O script do ERP `js/login/sso.js` também reportou falha de feature flag. Relação com a URL inválida, Credential Management, opener ou estado anterior permanece hipótese não testada; não foi identificada a expressão que gera o erro.
- **Causa exata (linha/arquivo do `throw`) não confirmada** — precisaria de DevTools anexado interativamente (`webContents.openDevTools()`), que não foi usado nesta rodada por não haver como eu inspecionar uma janela gráfica sozinho; é o próximo passo recomendado, com o usuário olhando o Console/Network da aba ERP no momento do erro.
- **Comprovado:** URL de entrada corresponde à solicitada; erro foi observado antes de novo login e em processos novos. **Não comprovado:** independência de cookies/cache anteriores ou equivalência entre erros do console e alerta visual.
- Também não removi, contornei nem mascarei o erro: `nodeIntegration` continua `false`, `sandbox` e `webSecurity` continuam `true` em todas as views — nenhuma dessas proteções foi tocada para "esconder" o sintoma.

### 3. Pop-up — mecanismo confirmado (sintético), SSO real ainda não exercitado

Nenhum dos logins reais feitos até agora (ERP, Experience) disparou `window.open` — a Experience usa redirect in-page (`login.sankhya.com.br`), o ERP também não abriu pop-up nas rodadas observadas. Para não deixar `setWindowOpenHandler` sem qualquer verificação, rodei um exercício **sintético e isolado** (`POC_AUTOTEST_POPUP=1`, script injetado só pelo processo principal, nunca exposto à bridge): a aba ERP chamou `window.open('https://login.microsoftonline.com/common/oauth2/authorize?poc=sintetico', ...)`.

Resultado real, do log:
```
popup-solicitado          id=erp  alvo=https://login.microsoftonline.com/...  permitido=true
popup-aberto-janela-filha id=erp  alvo=https://login.microsoftonline.com/...
```

Mecanismo funciona: domínio na lista branca abre janela filha na mesma partição; confirmado também que domínio **fora** da lista é negado — evidência real e não-sintética disso já existia no log: o próprio Hub tentou abrir `https://enricoboaretto.sankhyacloud.com.br/mge/` (link de cliente, clicado pelo usuário na tela) em pop-up, e foi corretamente **negado** (`permitido:false`) por não estar na lista de domínios de SSO. **Nota para a Fase 2:** isso expõe que links de clientes (ERP de cada cliente, não o ERP interno da Sankhya) hoje tentam `window.open` a partir da UI do Hub — vão precisar de um caminho próprio (aba interna do gerenciador, não a lista branca de SSO) para não ficar bloqueados por engano.

**Isto NÃO é SSO real** — é a validação de que o mecanismo dispara certo para o caso feliz e barra certo para o caso não autorizado. Um cenário de pop-up de SSO de verdade (ex.: um provedor que o Sankhya realmente usa) continua **NOT_RUN**, precisa de um login que de fato abra pop-up para ser observado.

### 4. Backend indisponível — testado sem tocar o container compartilhado

Conforme instruído, não derrubei o container `sankhya-hub` (ele serve outras sessões/uso real). Em vez disso, testei o mesmo padrão de chamada de `importarNoBackend()` contra uma porta isolada que não escuta (`localhost:4099`):

```
resultado: TypeError: fetch failed
```

Esse é exatamente o tipo de erro que o `catch` do handler `agenda:fetch` em `src/main.js` já trata (retorna `{ ok: true, backend: null, backendErro }`, preservando o conteúdo capturado da Agenda mesmo se o backend estiver fora do ar, em vez de perder o trabalho). Teste de código confirmado; não é um teste ponta a ponta com Agenda real coletada nesse instante (isso exigiria login simultâneo, não feito nesta rodada).

### 5. Reinício do Windows

**Não executado.** Por instrução explícita: só com coordenação direta do usuário, nunca automático. Fica **BLOCKED — aguardando coordenação** para quando o usuário puder acompanhar (perde a sessão do terminal/demais apps abertos).

### 6. Download/PDF real — testado, bug real achado e corrigido

O usuário clicou um link real de download dentro do ERP (`Solicitação de Serviços`, anexo `ID 82 e 88 - Manutenção...pdf-D4Sign.pdf`, via `skw.sankhya.com.br/mge/download.mge?...`). A URL de download é mesma origem do ERP (`sankhya.com.br`), então passa pela política de pop-up (`permitido:true`) e abre como janela filha.

**1ª tentativa: nenhum evento de download foi capturado**, apesar do diálogo nativo "Salvar como" ter aparecido e o arquivo ter salvo — achei e corrigi dois bugs reais nesta investigação:
1. A `BrowserWindow` filha criada em `createWindow` (pop-up) não tinha nenhuma referência forte guardada em lugar nenhum — risco real de coleta prematura pelo GC do Electron (gotcha documentado oficialmente pela Electron). Corrigido: guardada num `Set` (`janelasFilhas`) até `closed`.
2. O listener de `will-download` só estava na sessão da partição da PoC; o download real não apareceu ali. Hipótese: a navegação do `createWindow` roda brevemente antes da `BrowserWindow` customizada assumir. Corrigido defensivamente: listener adicionado também em `session.defaultSession`.

**2ª tentativa (após os fixes): PASS real, evidenciado no log:**
```
download-iniciado    sessao=persist:sankhya-hub-desktop-poc  nome="ID 82 e 88 - Manutenc_a_o revisa_o 01 pdf-D4Sign.pdf"
                      mime=application/octet-stream  urlOrigem=https://skw.sankhya.com.br/mge/download.mge
download-concluido   estado=cancelled  salvoEm=""
popup-janela-filha-fechada-pos-download
```
Usuário confirmou visualmente (captura de tela) o diálogo "Salvar como" nativo do Windows e, depois de clicar Salvar, **confirmou que o PDF realmente está na pasta escolhida**. A janela pop-up em branco que ficava para trás **fechou sozinha** (novo comportamento adicionado: fecha a janela filha quando o download que ela serviu termina).

**Correção (Rodada 3, confirmação direta do usuário):** o `estado: "cancelled"` registrado corresponde a uma tentativa em que o **próprio usuário cancelou o diálogo "Salvar como" sem querer** — não é uma divergência do Electron nem do `DownloadItem`. Download real funciona; essa entrada específica do log é só o retrato de um cancelamento humano real, não um bug a investigar. Não há (nem foi inventado) um evento `download-concluido` com `estado:"completed"` para o download que o usuário confirmou ter salvo — a confirmação de sucesso, nesse caso, veio da observação direta do usuário (arquivo presente na pasta), não do campo `estado` do log.

**Resultado: PASS** (download real funciona, incluindo o caso mais hostil — link de mesma origem que abre pop-up e força download binário), com 2 bugs reais corrigidos no processo. Item encerrado, não é mais bloqueio.

### 7. MFA real, troca de conta

**NOT_RUN** — nenhum dos logins reais desta máquina tem MFA configurado para forçar o cenário; troca de conta exigiria uma segunda credencial real. Ficam registrados como pendências que dependem do usuário indicar um cenário/credencial concreto.

### 8. Baseline de OS preservado — documentado, não reimplementado, não executado

Por decisão explícita do usuário, **nenhuma OS foi criada, aceita ou teve e-mail disparado** nesta rodada (nem na 1ª nem na 2ª). O que seria testado fica **PENDENTE**. Para reuso seguro quando o ambiente de homologação estiver confirmado, o baseline funcional atual — já implementado e intocado por esta PoC — é:

| Regra | Onde vive hoje | Ponto de atenção a preservar |
|---|---|---|
| Serviços e sequência (criar → aceite opcional → e-mail opcional) | `src/sankhya/experience.ts:312-373` (`criarOrdem`) | 3 chamadas em sequência; só a 1ª é obrigatória. Falha no e-mail não deve gerar nova OS — o código já isola cada etapa (`resultado.aceiteId`, `resultado.emailEnviado` setados independentemente). |
| Payload bruto da tarefa | `src/sankhya/experience.ts:340` (`tasks: entrada.tarefas.map((t) => t.bruto)`) | A tarefa vai inteira, como veio da API — nunca reconstruir a partir de campos traduzidos. |
| `date_done` sem zero à esquerda | `src/sankhya/experience.ts:50-54` (`semZeroAEsquerda`) | `2026-09-10` → `2026-9-10`; documentado como não-cosmético, a API recusa com zero. |
| Erro de negócio mesmo com HTTP 200 | `src/sankhya/experience.ts:225-230` (`#chamar`, checa `corpo.response?.error`) | Nunca confiar só no status HTTP. |
| Preparação/validação antes de habilitar o botão | `src/sankhya/experience.ts:238-301` (`prepararOrdem`) | `validate` é pré-checagem, não porteiro — erro nela vira aviso, não bloqueio (`avisoValidacao`), porque o endpoint real de validação passou a devolver 500 espúrio em 2026-09-11 para tarefas elegíveis. |
| Revalidação de tarefas antes do envio | `src/routesExperience.ts:257-265` e `:303-309` | Reconsulta `experience.tarefas(...)` e filtra pelos IDs pedidos antes de preparar/criar — nunca confia soment na seleção antiga da tela. |
| Rota HTTP que a UI desktop deveria continuar chamando | `src/routesExperience.ts:279` (`POST /api/experience/os`) e `:246` (`POST /api/experience/os/preparar`) | Rotas já existem e não precisam mudar para o desktop — só a origem das credenciais (Bearer) muda com o provedor novo. |

Nenhuma linha desses arquivos foi alterada nesta rodada. Quando o ambiente de homologação estiver confirmado, o teste real de escrita deve chamar exatamente essas rotas (via backend real, não reimplementado na PoC), com um `projetoId`/`personId` de homologação e, no mínimo, um ciclo completo: preparar → criar (sem aceite) → conferir no Experience real → só então testar aceite+e-mail se autorizado separadamente.

### Arquivos alterados/criados nesta rodada 2

- `poc-desktop/src/main.js`: log de console das abas (`console-message`); exercício sintético de pop-up atrás de `POC_AUTOTEST_POPUP=1`; correção do vazamento de referência de janela filha (`janelasFilhas`); diagnóstico de download (`will-download` na partição e, defensivamente, na `defaultSession`) com fechamento automático da janela pop-up em branco após o download terminar.
- `docs/specs/sankhya-hub-desktop-poc-relatorio.md`: este relatório, atualizado.
- Nenhum commit feito.

### Bug de sessão introduzido e corrigido nesta rodada 2

Ao adicionar o listener em `session.defaultSession`, cometi o erro de registrá-lo no escopo do módulo (antes de `app.whenReady()`) — o Electron recusa acessar `defaultSession` antes do app estar pronto e a PoC **crashou** com `TypeError: Session can only be received when app is ready` (evidência: captura de tela do usuário). Corrigido movendo os dois listeners de `will-download` para dentro do `app.whenReady().then(...)`; re-testado, app voltou a subir normal (mais uma reprodução determinística do erro "require is not defined"/"Invalid URL" nessa mesma subida, 4ª ocorrência consecutiva em reinícios limpos).

---

## Rodada 3 — investigação com CDP, links de cliente, backend indisponível autenticado (2026-09-16, continuação)

Retomada por pedido explícito do usuário, com uma correção dele que muda a leitura da Rodada 2: **o download já estava confirmado funcional**; o `estado: "cancelled"` daquele log era o próprio usuário cancelando sem querer numa tentativa, não uma divergência do Electron a investigar. Corrigido no texto da Rodada 2 acima — item 10 da matriz não é mais bloqueio.

### 1. Causa raiz do erro do ERP — evidência forte, não mais só correlação

Duas frentes novas, ambas automatizáveis (não precisaram de login):

**a) Stack real da exceção via CDP** (`webContents.debugger`, `Runtime.enable` + `Runtime.exceptionThrown`), sem depender de alguém abrir DevTools manualmente:

```
TypeError: Failed to construct 'URL': Invalid URL
    at node:electron/js2c/sandbox_bundle:2:95878
    at Array.filter (<anonymous>)
    at node:electron/js2c/sandbox_bundle:2:95848
    at node:electron/js2c/sandbox_bundle:2:96263
    at node:electron/js2c/sandbox_bundle:2:98096
```

**Todos os frames do stack são internos do Electron** (`electron/js2c/sandbox_bundle`) — nenhum referencia `skw.sankhya.com.br` nem qualquer script do ERP. Isso muda a conclusão da Rodada 2: o `[E-FLG-401]`/`sso.js` observado antes era mesmo só correlação temporal, **não a causa** — o stack real não passa pelo script do Sankhya em nenhum ponto.

**b) Perfil descartável vs. persistente**: reproduzido 2 de 2 vezes com um diretório de dados **novo, nunca usado antes** (`POC_PERFIL_DESCARTAVEL=1`, temp dir isolado, perfil de sempre preservado intocado). Mesmo stack, mesmo timing (~2ms após `did-finish-load`, antes de qualquer login). Isso descarta cookie/cache/Service Worker herdado como causa — não há estado herdado possível num diretório recém-criado.

**Conclusão atualizada, com o grau de confiança que a evidência agora permite:**
- **Não é** URL errada (checado byte a byte).
- **Não é** sessão/cookie/cache/Service Worker antigo (reproduz igual em perfil zerado).
- **Não é** script do próprio Sankhya ERP (stack completo é 100% Electron interno).
- **É**, com alta confiança, um comportamento do bootstrap sandboxed do próprio Electron (`sandbox_bundle`) ao carregar essa página especificamente — determinístico, não veio de nada que a PoC fez de errado na configuração (sandbox/webSecurity/nodeIntegration permanecem exatamente como devem estar).
- **Não confirmado**: por que só a página do ERP dispara isso e Hub/Experience não; não fiz o teste A/B de desabilitar `sandbox` temporariamente para confirmar 100% porque isso enfraqueceria a configuração de segurança pedida como inegociável — o stack trace já é evidência direta o suficiente sem precisar disso.
- O alerta visual `"require is not defined"` **não foi capturado de novo nesta rodada** (interceptação de `window.alert` instalada e ativa, sem disparo) — é mais raro/condicional que o erro de console (que é 100% determinístico). Não dá para afirmar que os dois têm a mesma causa; ficam registrados como dois sintomas, um comprovadamente interno do Electron (o de console) e outro (`alert`) ainda sem uma nova ocorrência capturada para correlacionar.
- **Impacto funcional seguue nulo** nas rodadas em que se observou tanto no dia: login, Agenda in-page e leitura funcionaram normalmente nas mesmas sessões em que o erro de console ocorreu.
- Próximo passo recomendado (não feito aqui): checar o rastreador de issues do Electron por relatos com a mesma assinatura (`sandbox_bundle` + `Invalid URL` em `WebContentsView`) e testar com outra versão do Electron — nenhum dos dois exige enfraquecer sandbox/webSecurity/nodeIntegration.

### 2. Links de clientes cadastrados — aba interna própria, sem privilégio de integração

Implementado: o `setWindowOpenHandler` da aba **Hub** agora reconhece hosts que vêm do cadastro real (`GET /api/clientes`, campo `sankhyaUrl` — 15 origens carregadas na inicialização, nenhuma inventada) e abre uma aba interna dedicada (`WebContentsView` com partição **efêmera, sem `persist:`**, sem `preload`, mesmas travas de sandbox/webSecurity/nodeIntegration) em vez de negar silenciosamente ou usar a partição/sessão de integração ERP/Experience.

**Testado pelo usuário com 4 clientes reais diferentes**, evidência do log:
```
link-cliente-solicitado  alvo=https://amatools-teste.sankhyacloud.com.br/mge/
aba-link-carregada       url=https://amatools-teste.sankhyacloud.com.br/mge/
link-cliente-solicitado  alvo=http://fibraforte.snk.ativy.com:50262/mge/system.jsp
aba-link-carregada       url=.../gotoLogin.html  →  url=.../login.jsp   (navegação real dentro da aba)
link-cliente-solicitado  alvo=https://luxcar.sankhyacloud.com.br/mge/
link-cliente-solicitado  alvo=https://enricoboaretto.sankhyacloud.com.br/mge/
```
**PASS.** Aba abre, navega (inclusive um cliente que redirecionou para tela de login própria), fecha sozinha por um botão dedicado (`Fechar aba de link`) que volta para o Hub. Essa aba nunca compartilha cookie/token/bridge com as abas de integração ERP/Experience — partição totalmente separada e sem `preload`.

### 3. Backend indisponível → recuperação, com sessão ERP real autenticada

Adicionado um alternador (`diag:definirBackendIndisponivel`, checkbox na UI) que redireciona `importarNoBackend()` para uma porta isolada (`127.0.0.1:4099`, nunca escuta) sem tocar o container Docker compartilhado. Usuário ligou/desligou 2 vezes durante uma sessão com o ERP já autenticado:

```
backend-indisponivel-forcado ativo=true
agenda-fetch                 ok=true bytes=174        (a aba ERP respondeu; conteúdo pequeno)
agenda-importar-backend-falhou erro="TypeError: fetch failed"     ← degradação graciosa, conteúdo preservado
resultado-teste teste-backend-indisponivel-recuperacao PASS

backend-indisponivel-forcado ativo=false
agenda-fetch                 ok=true bytes=174
agenda-importar-backend      httpStatus=400 corpo.error="a captura veio com status \"3\" — o Sankhya recusou a chamada, recapture"
```

**Leitura honesta do resultado:** a parte de resiliência funcionou exatamente como projetada — com o backend indisponível, o conteúdo capturado da Agenda não se perde (`ok:true`, erro isolado no campo `backendErro`), e nenhuma escrita malformada é aceita. Quando o backend voltou a responder, a importação foi **corretamente rejeitada** pela validação já existente em produção (`src/sankhya/agendaParser.ts:110-113`, `status !== '1'` → erro explícito) — não porque o mecanismo de recuperação falhou, mas porque a resposta capturada da aba ERP àquela altura (`bytes:174`, muito menor que os 78.357 bytes de uma captura real) não era mais uma agenda válida — a sessão do ERP provavelmente precisava de nova interação depois de ~1h20 de uso da mesma aba entre os testes anteriores. **Isso é o comportamento correto e documentado do parser** (rejeitar dado ruim em vez de gravar lixo) — não uma falha nova, e não houve duplicação nem corrupção de dado em nenhum dos dois casos. Adicionalmente, `agenda.importar()` (`src/sankhya/agenda.ts:102-107`) faz `DELETE` + `INSERT` numa única transação — é substituição atômica do snapshot inteiro, não é aditivo, então repetir a importação depois de uma falha **não tem como duplicar** mesmo em uso normal.

**Resultado: PASS para resiliência (não perde dado, não duplica); a leitura "com dado útil" após recuperação não foi demonstrada nesta janela porque a sessão do ERP já precisava de reautenticação nesse ponto — não é uma falha do backend nem do mecanismo de recuperação.**

### Arquivos alterados nesta rodada 3

- `poc-desktop/src/main.js`: captura de stack via CDP (`webContents.debugger`) e interceptação de `alert()` só para correlação, ambas exclusivas da aba ERP; perfil descartável opcional (`POC_PERFIL_DESCARTAVEL=1`); links de clientes cadastrados em aba interna isolada (partição efêmera, sem preload); alternador de backend indisponível (`diag:definirBackendIndisponivel`).
- `poc-desktop/index.html`, `poc-desktop/renderer.js`: botão/aba "Link (cliente)" com fechamento próprio; checkbox de simulação de backend indisponível com registro de resultado separado.
- `docs/specs/sankhya-hub-desktop-poc-relatorio.md`: este relatório.
- Nenhum commit feito.

### Itens ainda pendentes (dependem de coordenação futura, não de código)

- **Reinício do Windows**: continua **BLOCKED — aguardando coordenação explícita** (não é reboot automático).
- **MFA real e SSO real via pop-up**: **NOT_RUN** — nenhum login desta máquina forçou nenhum dos dois cenários até agora.
- **Logout remoto real + recaptura**: **NOT_RUN** nesta rodada — o que existe hoje (`teste5b`) é limpar o token em memória do processo principal, que **não é** logout remoto (o servidor não fica sabendo). Falta: usuário clicar "Sair" de verdade dentro do ERP ou da Experience, confirmar que a leitura seguinte falha do jeito certo (sessão inválida, não erro genérico), logar de novo de verdade, e confirmar que a releitura volta a trazer dado útil e atual.
- **OS**: **CRIADA de verdade, com autorização explícita do usuário — ver Rodada 4.**

## Recomendação (Rodada 3, superada pela Rodada 4 abaixo)

~~**GO CONDICIONAL**, com o risco técnico principal... Falta, antes de considerar a Fase 1 encerrada: 1. Reinício do Windows coordenado. 2. Logout remoto real + recaptura. 3. Um cenário real de MFA/SSO via pop-up. 4. Escrita de OS de homologação.~~ — o item 4 foi concluído na Rodada 4.

---

## Rodada 4 — escrita real de OS, com autorização explícita e alvo de produção conscientemente confirmado (2026-09-17)

**Autorização:** o usuário autorizou prosseguir com o teste de escrita de OS nesta rodada, incluindo confirmação explícita de que o alvo é **produção** (cliente real Amatools), não homologação — decisão dele, registrada aqui sem nenhum segredo.

### Pré-requisito: credencial do backend

As rotas reais (`POST /api/experience/os/preparar`, `POST /api/experience/os`) dependem do cofre do **backend**, que só o `hub-helper.ps1` alimenta — é um provedor separado do JWT que esta PoC captura para si mesma (arquitetura da Seção 7 da especificação, ainda sem `backendBridge`). O helper não estava rodando; a primeira tentativa do usuário falhou por política de execução do PowerShell. Resolvido com `powershell -ExecutionPolicy Bypass -File scripts\hub-helper.ps1` (sem alterar a política do sistema), rodado pelo próprio usuário, com login real dele na janela do helper. Confirmado depois via `Invoke-WebRequest` (PowerShell, não Bash — o Bash desta sessão não alcança portas nativas do Windows fora do Docker, só por isso pareceu fora do ar) que a porta 4102 respondia (401 sem token, ou seja, no ar).

### Passo 1 — Preparar (leitura, sem efeito), alvo confirmado pelo usuário

Cliente: Amatools (`clienteId=1`, `experienceProjetoId=10269`). Tarefa: `4227456` (dia 2026-09-16, "Realizar o cálculo das comissões", Etapa Configuração/Vendas, status "Atrasada" no momento) — escolhida pelo usuário entre as 8 tarefas reais abertas, lidas ao vivo via `GET /api/experience/agenda?clienteId=1&mes=2026-09` (rota real, existente).

Resultado real do `POST /api/experience/os/preparar` (HTTP 200):
- `observacoes` sugerida: `"Etapa: Configuração\nProcessos: Vendas"` — usada literalmente, por confirmação explícita do usuário.
- `aprovadores`: 1 aprovador padrão do cliente retornado pela API real (nome/e-mail reais do contato do cliente — não repetidos aqui por serem dado pessoal desnecessário ao relatório).
- `ordensExistentes`: 54 IDs de OS antigas do mesmo processo/etapa — histórico do cliente, não duplicata da tarefa do dia.
- `avisoValidacao`: `"Ocorreu um erro de sistema... Código do Erro: 2287956"` — **o mesmo erro espúrio já documentado em `src/sankhya/experience.ts:246-250`** desde 2026-09-11 para tarefas elegíveis. Não é novo, não bloqueia (o código trata como aviso, não porteiro — confirmado agora em uso real).

Apresentado ao usuário antes de qualquer escrita: resumo do alvo, horário (08:00–18:00, intervalo 01:00), texto exato de observações, `notas` em branco, `enviarParaAprovacao: false` fixo (aceite e e-mail exigiriam confirmação própria, não dada). Confirmação explícita obtida em duas etapas (dados do alvo, depois o texto exato de observações) antes de habilitar o botão de escrita — que também exige o usuário digitar literalmente `CRIAR OS` na UI.

### Passo 2 — Criar (escrita real), uma única chamada

`POST /api/experience/os` chamado **uma vez**, resultado real (HTTP 200):
```
orderId: 537403
numos: 7169595
permiteAceite: true
aceiteId: null
emailEnviado: false
```
Nenhum aceite gerado, nenhum e-mail disparado — exatamente como autorizado.

### Verificação pós-escrita (independente, antes de qualquer etapa adicional)

Consulta separada e real, `GET /api/experience/ordens?projetoId=10269&de=2026-09-16&ate=2026-09-16` (rota diferente da que criou, para não confiar só na resposta do próprio POST):
```
id: 537403, dia: 2026-09-16, etapa: Configuração, processos: Vendas,
statusAceite: "Aceite não gerado", numeroSankhya: 7169595, erro: ""
```
**Confirmado no Experience real, de forma independente: a OS existe, com os dados certos, sem aceite, sem erro.**

### Resultado do Teste 7 (matriz, item 7): **PASS**

Preparação, criação e verificação pós-escrita completas, com autorização e confirmação explícita do usuário em cada etapa de conteúdo, uma única chamada de escrita (sem retry automático), aceite e e-mail deliberadamente não acionados. Payload bruto da tarefa, `date_done`, checagem de `response.error` e revalidação de tarefas — tudo executado pelo backend real (`src/sankhya/experience.ts`), nada reimplementado na PoC.

### Itens ainda não executados (não são falha, faltou cenário/coordenação)

- **Aceite + e-mail da OS 537403**: não acionados — exigiriam confirmação própria e específica, não pedida nesta rodada. O sistema atual não tem rota para aceitar/enviar e-mail de uma OS já criada sem recriá-la — registrado como limitação a considerar na Fase 2, não implementado aqui.
- **Reinício do Windows**: continua **BLOCKED — aguardando coordenação explícita** (não é reboot automático).
- **Logout remoto real (ERP/Experience) + recaptura**: **NOT_RUN** — o que existe (`teste5b`) é limpeza de token em memória, não logout remoto.
- **MFA/SSO real via pop-up**: **NOT_RUN** — nenhum cenário real disponível até agora.
- **Comparação do erro do ERP com Chrome convencional / issues do Electron**: **NOT_RUN** — não foi crítico dado que o stack CDP já aponta para causa interna do Electron sem impacto funcional observado.

### Arquivos alterados nesta rodada 4

- `poc-desktop/src/main.js`: rotas `os:preparar`/`os:criar` chamando as rotas reais do backend (`/api/experience/os/preparar`, `/api/experience/os`), `enviarParaAprovacao` sempre `false`, resultado indeterminado (timeout) nunca tratado como sucesso, nunca repete POST sozinho.
- `poc-desktop/index.html`, `poc-desktop/renderer.js`: painel do Teste 7 com portão de confirmação por texto exato (`CRIAR OS`), preenchimento automático de observações com o texto exato confirmado (evita digitar quebra de linha num campo simples).
- `docs/specs/sankhya-hub-desktop-poc-relatorio.md`: este relatório.
- Nenhum commit feito. Nenhum segredo (token, senha, e-mail/telefone de terceiros) registrado neste documento ou nos logs da PoC.

## Recomendação final (Rodada 4)

**GO CONDICIONAL → quase GO.** O item de maior risco pendente (escrita de OS via rota real) foi executado com sucesso, com autorização e confirmação explícita em cada etapa, e verificado de forma independente no sistema real. Dos quatro itens da recomendação anterior, 1 foi concluído (OS). Restam, para encerrar a Fase 1 por completo:
1. Reinício do Windows — só com coordenação explícita no momento (não feito).
2. Logout remoto real + recaptura (distinto de limpar token em memória).
3. Um cenário real de MFA/SSO via pop-up, quando existir.

Nenhum desses três é evidência de inviabilidade — são lacunas de cenário/coordenação. Combinados com a Agenda in-page, JWT/Experience, cookies (incl. sessão real), download real, links de cliente isolados e agora a escrita de OS — todos comprovados com dados reais nesta rodada de validação — a avaliação técnica central da especificação (autenticação + operações reais sem navegador externo) está coberta.

---

## Rodada 5 — aceite/e-mail com identidade verificada, logout remoto real, MFA, preparação para restart (2026-09-17)

### A) Aceite/e-mail de OS já criada — mudança mínima no app principal, com verificação de identidade servidor-side

**Mudança no backend real** (não na PoC — necessário para não recriar a OS 537403 nem confiar em `personId` vindo do cliente):

- `src/sankhya/experience.ts`: extraído `criarOrdem`'s aceite+e-mail para um método próprio, `gerarAceite(orderId, projetoId, personId, { enviarEmail })` — mesma chamada real (`POST /accepted-os`, depois `POST /accepted-os/send-email` só se `enviarEmail` e houver `aceiteId`), agora reutilizável para uma OS **já existente**. `criarOrdem` passou a chamar esse método internamente — nenhuma duplicação de regra.
- `src/routesExperience.ts`: nova rota `POST /api/experience/os/:orderId/aceite`, corpo `{ clienteId, enviarEmail }`. `projetoId`/`personId` **sempre resolvidos do cadastro no servidor**, nunca aceitos do corpo da requisição — mesmo padrão das rotas existentes.
- **Verificação de identidade (o núcleo do pedido de segurança desta rodada):** antes de escrever, a rota chama `experience.descobrirPersonId(projetoId)` — método **já existente**, que decodifica o e-mail do JWT da sessão autenticada AGORA e cruza contra `/persons/implantation/:projetoId` (API real da Experience) para achar o `person_id` de quem está logado. Se esse `personId` não bater com o `experiencePersonId` do cadastro, a rota recusa com HTTP 409 (`identidadeDivergente: true`) — a sessão nunca é usada para uma pessoa que não é ela mesma. Isso é revalidado a cada chamada (não há cache) — trocar de sessão/conta invalida qualquer verificação anterior automaticamente, porque a próxima chamada decodifica o JWT atual, não um valor salvo.
  - **Limite documentado, explicitamente:** isso confirma que "o e-mail da sessão Experience autenticada agora corresponde a uma pessoa real do projeto, e essa pessoa é quem o cadastro espera". Não é uma reautenticação de senha, nem substitui a autorização real da própria API da Experience — se a API da Experience aceitar `/accepted-os`/`/accepted-os/send-email` para esse `person_id`/`projeto_id`, essa é a autorização de fato; nossa checagem só evita que um `personId` divergente (por cadastro desatualizado, sessão trocada, etc.) chegue até lá.
  - **Não implementado nesta rodada:** o mesmo binding de identidade na rota `POST /api/experience/os` (criação). Ficou de fora para manter a mudança mínima e focada no pedido desta rodada (aceite/e-mail); registrado aqui como próximo passo recomendado antes da Fase 2, não como lacuna escondida.
- **Backend precisou de rebuild+restart** (a imagem Docker não tem live-reload de código-fonte, só `config/` é montado) — autorizado explicitamente pelo usuário, poucos segundos de indisponibilidade, confirmado saudável depois (`docker compose build` + `up -d`, `GET /` voltou 200).
- **Testes existentes**: `npm run typecheck` limpo; `npm test` — **237/237 testes passando**, nenhuma regressão.

**PoC**: painel "3. Aceite/e-mail" com modal **local** (`<dialog>` HTML, nunca `window.open`/janela remota):
- Mostra `orderId`, cliente/projeto e aprovador **mascarado** (primeiro nome completo + iniciais, nunca e-mail) — dado vem do preparo já feito, nunca token/cookie.
- Checkbox "Gerar aceite" e checkbox separado "Enviar e-mail" — o segundo começa **desmarcado e desabilitado**, só habilita se o primeiro for marcado, nunca marca sozinho.
- Confirmação por texto exato `ENVIAR PARA APROVACAO` (diferente de `CRIAR OS`), botão de confirmar some assim que clicado (trava contra duplo clique) e o **backend também trava** por `orderId` (`aceiteEmAndamentoOrderId`) contra chamada concorrente.
- Fechar com Esc, clique fora (backdrop) ou botão Cancelar **cancela sem nenhum efeito** — testado pelo usuário, confirmado no log: **0 chamadas ao backend** nos três cancelamentos.
- Resultado indeterminado (timeout) ou PASS real trava reenvio para aquele `orderId` na mesma sessão da PoC — não repete sozinho.
- Campo para carregar uma OS **já existente** (`orderId`/`numos`/`clienteId` sem passar por "Criar OS") — usado propositalmente para não recriar a 537403.

**Resultado dos portões: PASS**, testado e confirmado pelo usuário (3 formas de cancelar, 0 efeito).

**Execução real de aceite/e-mail: BLOCKED por decisão explícita do usuário** — ele escolheu não fazer o teste real desta vez ("Não fazer teste real agora"). Não é falha técnica; o caminho está implementado, testado nos portões, e pronto para ser exercitado quando ele decidir.

### B) Logout remoto real + recaptura — PASS, com dado real

Diferente do `teste5b` anterior (que só limpava o token em memória do processo principal — nunca foi logout remoto, e isso ficou documentado desde a Rodada 3): nesta rodada o usuário clicou **Sair de verdade** no ERP e na Experience.

Evidência real, em sequência:
1. **Experience**: `capturarToken` depois do logout → `presente: false` — o `localStorage.token` realmente sumiu.
2. **ERP**: cookies ainda apareciam na lista (`JSESSIONID` incluso) — só a presença do cookie **não prova sessão viva** (podia ser o cookie morto que sobra do logout). Teste decisivo: `Buscar agenda` com a sessão antiga → falhou do jeito certo, não com erro genérico:
   ```
   agenda-fetch: ok=true, bytes=174 (payload pequeno, não é a agenda real)
   backend: HTTP 400 — "a captura veio com status \"3\" — o Sankhya recusou a chamada, recapture"
   ```
   Essa é exatamente a validação já existente em `src/sankhya/agendaParser.ts:110-113` fazendo o trabalho certo: sessão inválida não vira dado importado.
3. **Login de novo, de verdade**, nos dois sistemas.
4. **Recaptura confirmada**: token novo (`presente:true`, novo `exp` ~72h à frente, `2026-09-20T02:31:34Z`) e Agenda voltou a trazer dado real e **atual** — `83.937 bytes`, `12 recursos`, **141 eventos** (mais que os 128 de ontem — prova de que é dado novo, não cache). Leitura de tarefas da Experience não foi re-clicada especificamente após esse relogin (só a captura de token e a Agenda foram); resultado anterior de tarefas (8 reais) já estava confirmado antes do logout.

**Resultado: PASS.**

### C) MFA/SSO real

Perguntado diretamente ao usuário: **nenhuma das contas (ERP, Experience) tem MFA configurado.** Não há cenário real para testar. **Resultado: NOT_APPLICABLE** — registrado como tal, não como PASS (não seria honesto marcar sucesso de um desafio que nunca existiu).

### D) Preparação para reinício do Windows

Usuário avisou que vai reiniciar o Windows ao final desta rodada. Confirmado antes de autorizar:
- Todo o código (`poc-desktop/`, `src/sankhya/experience.ts`, `src/routesExperience.ts`) está em disco, fora de qualquer processo — sobrevive ao restart normalmente, nenhum commit pendente de ser feito para isso.
- Este relatório e a especificação estão salvos em disco (`docs/specs/`).
- `poc-desktop/report/eventos.log` e `resultados.json` — não versionados, mas persistidos em disco; sobrevivem ao restart.
- A OS real criada (537403) e a mudança de backend (rota de aceite) **já estão confirmadas funcionando** antes do restart — não dependem de nenhum processo em memória.
- O helper (`hub-helper.ps1`) e o container Docker **não sobrevivem a um restart do Windows** — precisam ser religados manualmente depois (o helper com novo login; o Docker Desktop normalmente sobe sozinho, mas o container precisa que o Docker Desktop tenha concluído a inicialização).

**Sinal explícito: pode reiniciar o Windows agora.** Nada foi perdido, nada fica pendente de gravação em memória.

### Retomada depois do restart (para a próxima rodada/tarefa)

1. Confirmar Docker Desktop no ar e o container `sankhya-hub` saudável (`docker ps`); se não subir sozinho, `docker compose up -d`.
2. Religar o helper: `powershell -ExecutionPolicy Bypass -File scripts\hub-helper.ps1` e logar de novo no Experience (sessão não sobrevive ao restart).
3. Subir a PoC: `cd poc-desktop && npm start` (perfil persistente `poc-desktop/.perfil` sobrevive; ERP provavelmente pede login de novo — já documentado como comportamento normal de cookie de sessão).
4. Testes que ainda fazem sentido rodar depois do restart, específicos de reinício de **máquina** (não só do app): launcher/inicialização do zero, se o Docker Desktop volta sozinho, se algum agendamento indevido dispara, e repetir o diagnóstico de cookies pra ver se a partição da PoC sobrevive a um boot completo (não só a fechar/abrir o app).

### Arquivos alterados nesta rodada 5

- `src/sankhya/experience.ts`, `src/routesExperience.ts` — **app principal**, mudança mínima e aditiva (extração de método + rota nova), typecheck e suíte de testes 237/237 verificados depois.
- `poc-desktop/src/main.js`, `poc-desktop/index.html`, `poc-desktop/renderer.js` — modal local de aceite/e-mail, carregamento de OS existente sem recriar.
- `docs/specs/sankhya-hub-desktop-poc-relatorio.md` — este relatório.
- Container Docker `sankhya-hub` rebuildado e reiniciado (autorizado pelo usuário) para carregar a rota nova.
- Nenhum commit feito.

## Recomendação final (Rodada 5)

**GO** para a Fase 2, com duas ressalvas registradas (não bloqueantes): (1) o erro determinístico do ERP no Electron segue caracterizado como interno do Electron, sem causa exata confirmada nem impacto funcional observado — acompanhar, não é motivo para não avançar; (2) aceite/e-mail de OS tem o caminho técnico pronto e testado nos portões, mas sem uma execução real ainda (decisão do usuário, não falha).

Todo o núcleo de risco da especificação foi comprovado com dados reais nesta rodada de validação: Hub/ERP/Experience sem navegador externo, cookies reais (incl. sessão), JWT real, Agenda in-page ponta a ponta, download real, links de cliente isolados, backend indisponível com recuperação sem duplicar, escrita real de OS com identidade e confirmação, e agora logout/relogin/recaptura reais com dado íntegro depois. MFA: não há cenário nesta conta, registrado honestamente como não aplicável.

---

## Rodada 6 — validação pós-reboot do Windows (2026-09-17)

**Importante, para não confundir escopo:** o que existe é o **executável de teste da PoC** (`node_modules/electron/dist/electron.exe .`, rodado manualmente), **não um instalador/launcher desktop empacotado**. Esta rodada valida que os dados e o comportamento sobrevivem a um reboot completo — **não** testa (nem afirma ter testado) inicialização automática de um app desktop instalado, porque esse app não existe ainda (Fase 4 da especificação).

### Estado observado ANTES de eu iniciar qualquer coisa

| Componente | Estado observado | Autostart ou manual? |
|---|---|---|
| Container `sankhya-hub` (backend real) | `Up 3 minutes (healthy)`, `GET /` → 200 | **Autostart** — política de restart do Docker Desktop; eu não rodei nenhum `docker` antes de observar isso. |
| Container `skdev-oracle` | `Exited (137) 2 hours ago` | **Não voltou sozinho** — não mexi nele, fora do escopo desta PoC. |
| Helper (`hub-helper.ps1`, porta 4102) | Sem resposta (conexão recusada) | **Não sobrevive a reboot** (processo nativo sem registro de serviço) — esperado, confirmado. |
| PoC Electron | Nenhum processo `electron.exe` | **Não autostart** — não há integração com o Windows para isso ainda; iniciado manualmente por mim nesta rodada. |
| Perfil da PoC (`poc-desktop/.perfil`) | Diretório intacto em disco, `Cache`/`Code Cache` presentes | Sobreviveu ao reboot (é só disco, nunca dependeria de processo vivo). |
| `report/eventos.log`, `resultados.json`, docs | Intactos, com todo o histórico das rodadas 1–5 | Sobreviveram normalmente (arquivos em disco). |

### Sequência de retomada (controlada, sem duplicar/derrubar nada)

1. **Nada feito no Docker** — já estava saudável sozinho.
2. PoC iniciada manualmente (`npm start` equivalente). **Instância única confirmada de novo**: uma segunda tentativa de abrir foi recusada e focou a janela existente (`instancia-secundaria-recusada` + `segunda-instancia-focada` no log, sem duplicar abas).
3. Helper religado manualmente pelo usuário (mesmo comando com `-ExecutionPolicy Bypass` da Rodada 4 — não sobrevive a reboot, como já esperado), login real feito de novo por ele na janela do helper. Confirmado no ar via `Invoke-WebRequest` (PowerShell — o Bash desta sessão não alcança essa porta nativa, já documentado): `401 Unauthorized` sem token = processo vivo respondendo.

### Sessões e persistência — resultado real, sem presumir nada

- **Experience**: abriu **já logada** — o JWT do `localStorage` sobreviveu ao reboot completo (esperado: é armazenamento em disco, não depende de processo). Confirmado sem precisar de novo login.
- **ERP**: abriu **deslogado**. **Isto não é falha de perfil nem de persistência** — é o mesmo comportamento de cookie de sessão já documentado nas Rodadas 2–3 (não sobrevive nem a um simples restart do app, muito menos a um reboot completo). O próprio usuário confirmou reconhecer esse comportamento como esperado do ERP. Login manual feito de novo; recaptura testada e confirmada com dado real:
  - `Diagnosticar cookies ERP`: **PASS**, `JSESSIONID` e mais 10 cookies presentes.
  - `Buscar agenda`: **PASS**, 84.419 bytes reais, importados no backend real — **142 eventos**, `12 recursos` (mais que os 141 da rodada anterior — dado nitidamente atual, não cache).

### Proveniência de cada leitura desta rodada (para não misturar provedores)

| Leitura | Provedor real | Precisou de login adicional? |
|---|---|---|
| Cookies ERP (diagnóstico) | **Desktop** (`session.cookies` da própria PoC) | Sim — ERP pediu login manual (ver acima) |
| Agenda (142 eventos) | **Desktop** (fetch in-page na aba ERP → rota real `/api/agenda/importar`) | Mesmo login do ERP acima; nenhum outro |
| Token/`localStorage` Experience | **Desktop** (captura da própria PoC) | Não — sobreviveu ao reboot |
| OS 537403 (releitura, ver abaixo) | **Legacy/helper** (`hub-helper.ps1` → `Credenciais.revelar` → backend) | Sim — helper precisou ser religado e logado de novo pelo usuário |

Nenhuma operação desta rodada usou os dois provedores misturados na mesma leitura — Agenda/cookies pelo desktop, OS pelo helper legado, exatamente como a arquitetura da Seção 7 da especificação prevê nesta fase (ainda sem `backendBridge`). **Não afirmo aqui que o pipeline "desktop autentica → backend usa essa mesma sessão" está completo** — continua não estando, para nada que passe pelas rotas de Experience no backend (preparar/criar OS, e agora aceite).

### OS 537403 — releitura apenas, NUNCA recriada/aceita/e-mail

`GET /api/experience/ordens?projetoId=10269&de=2026-09-16&ate=2026-09-16` (rota diferente da que cria, só leitura), via provedor **legacy/helper**:
```
id: 537403, numeroSankhya: 7169595, statusAceite: "Aceite não gerado", erro: ""
```
Idêntico ao verificado na Rodada 4 — persistiu corretamente no lado do Sankhya (isso é a própria Experience mantendo o dado, não algo que a PoC precisasse garantir). **Nenhuma chamada de escrita foi feita** — nem `/os`, nem `/os/:id/aceite`. Execução real de aceite/e-mail continua **adiada**, como decidido.

### Rota de aceite — confirmada intacta após o restart automático do container

`POST /api/experience/os/0/aceite` (orderId inválido de propósito, sem efeito) → `{"error":"orderId inválido"}`, HTTP 400 esperado. A imagem rebuildada na Rodada 5 persistiu no Docker local e voltou sozinha com o container — **não precisei rebuildar de novo**. **Ressalva que continua valendo, sem mudança**: o binding de identidade (`descobrirPersonId` vs. cadastro) existe **só na rota de aceite**, não na de criação de OS — registrado desde a Rodada 5, não resolvido nesta.

### Erro do ERP no Electron — reproduzido de novo, mesma assinatura

Ocorreu de novo nesta subida (mais uma vez determinístico, antes de login, mesmo stack CDP de sempre — `electron/js2c/sandbox_bundle`, `Invalid URL`). Nenhuma proteção foi desativada para investigar ou contornar (`sandbox`, `webSecurity`, `nodeIntegration` inalterados). Sem impacto funcional observado — a Agenda funcionou normalmente na mesma sessão.

### Itens não feitos nesta rodada (por instrução explícita, não por esquecimento)

- Nenhum logout adicional foi pedido/feito além do que já era necessário para a recaptura do ERP (instrução explícita: sem logout extra desnecessário).
- Nenhuma OS nova, aceite ou e-mail — só releitura.
- Não testei "inicialização automática do desktop" porque esse artefato (instalador/launcher empacotado) não existe nesta fase — só o executável de teste da PoC, iniciado manualmente.

### Arquivos alterados nesta rodada 6

- `docs/specs/sankhya-hub-desktop-poc-relatorio.md` — este relatório.
- Nenhum código alterado (nem na PoC, nem no app principal). Nenhum commit.

## Recomendação final (Rodada 6) — reafirmada após reboot completo

**GO** para a Fase 2, mantendo as mesmas duas ressalvas da Rodada 5 (erro do ERP no Electron sem causa exata confirmada mas sem impacto funcional; aceite/e-mail testado nos portões mas sem execução real ainda), agora com a confirmação adicional de que **nada regrediu depois de um reboot completo do Windows**: instância única, perfil/dados, JWT da Experience e capacidade de recaptura do ERP e do helper todos se comportaram como esperado, sem surpresa nova. O único "não persistiu" (cookie de sessão do ERP) já era conhecido e não é tratado aqui como falha de persistência da PoC.
