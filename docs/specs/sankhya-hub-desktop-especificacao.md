# Sankhya Hub Desktop — viabilidade e especificação funcional/técnica

**Data:** 2026-09-16

**Status:** GO CONDICIONAL para continuar validação. PoC executada com login e dados reais; migração completa ainda não aprovada. Achados das rodadas 1 e 2 incorporados em 2026-09-16.

**Prioridade:** funcionalidades, sessões, dados e operações existentes. O redesenho visual será posterior.

**Plataforma inicial:** Windows, compatível com as dependências nativas atuais.

## 1. Objetivo e conclusão

Transformar o Hub em aplicativo desktop com navegação interna, preservando monitoramento, coleta de informações, Agenda, Experience, lançamentos de OS, clientes, favoritos e Git Autosync.

A transformação é tecnicamente viável. O aplicativo pode hospedar Chromium e acessar as sessões criadas em seu próprio navegador por APIs do host. Não precisa acessar o perfil pessoal do Chrome/Edge, de extensão ou de proxy reverso para esse objetivo.

**Arquitetura recomendada:** Electron com interface React existente, abas remotas em `WebContentsView`, gerenciamento de sessões no processo principal e preservação inicial do backend e dos helpers. A PoC confirmou navegação, captura e coleta reais; escrita de OS e demais critérios de paridade continuam pendentes.

“Sem perder nada” é um critério de aceite verificável, não uma garantia antecipada. A liberação depende da matriz de paridade. A compatibilidade de todos os provedores de autenticação e URLs externas não pode ser deduzida apenas do uso de Chromium.

### 1.1 Evidência da PoC e decisão vigente

Protótipo isolado: `poc-desktop/`, Electron 44.4.1. Relatório de execução: [sankhya-hub-desktop-poc-relatorio.md](sankhya-hub-desktop-poc-relatorio.md). Os resultados abaixo são observações registradas pela Session 1 com participação do usuário, não novos testes executados durante esta atualização documental.

| Item | Evidência atual | Limite / próximo aceite |
|---|---|---|
| Navegação | Hub, ERP e Experience carregaram dentro do Electron | Demais URLs cadastradas ainda precisam de homologação |
| Login ERP | URL correta `https://skw.sankhya.com.br/mge/`; após login, `/mge/system.jsp` | Erro de script na carga inicial ainda sem causa confirmada |
| Cookies ERP | Captura de cookies reais, incluindo JSESSIONID, por filtro `{url}` | Nenhum cookie HttpOnly observado; essa característica ainda não testada empiricamente |
| Agenda | Fetch na página autenticada e importação no backend real: 12 recursos e 128 eventos | Sem comparação formal com captura anterior; não equivale à integração desktop completa |
| Experience | JWT real capturado; consulta retornou 8 tarefas | Logout remoto, expiração e troca de conta não homologados |
| Persistência | JWT Experience persistiu após reinício do app | ERP exigiu novo login em pelo menos um reinício; Windows não reiniciado |
| Pop-ups | Abertura/negação verificadas por exercício sintético | SSO real com pop-up não exercitado |
| PDF | Usuário confirmou arquivo real salvo | Evento de conclusão registrou `cancelled`; diagnóstico permanece inconsistente |
| Backend offline | Conexão a porta isolada indisponível retornou falha esperada | Recuperação com coleta real e posterior reenvio ainda não exercitada ponta a ponta |
| OS | Baseline funcional preservado e referenciado no relatório | Implementação desktop e escrita adiadas por decisão do usuário; nenhuma OS criada/aceita/enviada |

**Decisão:** continuar diagnóstico e testes da PoC, preservando o app atual. Não declarar Fase 1 integralmente concluída nem converter GO CONDICIONAL em autorização para migração completa.

## 2. Premissas e relação com a especificação anterior

- Este documento define a migração desktop. `sankhya-hub-suite-especificacao.md` permanece como histórico funcional, mas suas propostas de proxy/iframe e automação não devem ser tratadas como descrição automática da implementação atual.
- A abertura interna proposta aqui usa superfícies de navegador de nível superior, não iframe no React. Assim, não depende de remover `X-Frame-Options` ou CSP dos sistemas remotos.
- O executável atual é um launcher C#, não um navegador embutido.
- Login inicial será feito dentro do desktop. Não se promete importar cookies/perfil do navegador pessoal ou reutilizar diretamente o diretório de dados do Chrome no Electron.
- Persistência de perfil não impede expiração ou revogação da sessão pelo servidor. Cookies de sessão também não se tornam permanentes por existir uma partição persistente.
- O primeiro desktop pode continuar dependendo de Docker. Eliminar Docker é uma frente separada, posterior à paridade, e não condição para esconder a URL ou embutir as páginas.
- Alterações concorrentes existentes no projeto deverão ser incorporadas ao baseline antes da implementação.

## 3. Evidências de arquitetura atual

Levantamento da Session 6, consolidado nesta especificação; referências de linha são fotografias do estado analisado e podem mudar.

| Evidência | Local |
|---|---|
| Launcher verifica porta 4000, inicia PowerShell e abre URL via ShellExecute | `scripts/compilar-launcher.ps1:101-155,183-192,202-237,479-487` |
| Hub aberto no navegador padrão | `scripts/abrir-hub.ps1:13-18,365-367` |
| Chrome/Edge dedicado com perfil próprio e CDP | `scripts/hub-helper.ps1:198-210,283-320,805-817` |
| Backend no container alcança helper nativo, com token montado read-only | `scripts/hub-helper.ps1:1-37`; `docker-compose.yml:21-31,46-58` |
| Credenciais/sessões protegidas por DPAPI no host | `scripts/hub-helper.ps1:108-153` |
| ERP utiliza cookies; Experience utiliza token/JWT de localStorage | `scripts/hub-helper.ps1:423-433,820-867` |
| Consumo de autenticação pelo backend | `src/sankhya/credenciais.ts:91-100`; `src/sankhya/experience.ts:4-10` |
| Fechamento do navegador dedicado filtra perfil | `scripts/hub-helper.ps1:667-686` |
| Inicialização Fastify e registro dos módulos atuais | `src/index.ts:32-124` |
| Agenda depende de fetch autenticado dentro da aba ERP, executado em sequência | `src/routesAgenda.ts:41-86`; `scripts/hub-helper.ps1:435-497` |
| Experience preserva payload bruto, prepara e cria OS, com aceite/e-mail opcionais | `src/sankhya/experience.ts:164-183,235-370`; `src/routesExperience.ts:279-325` |
| Clientes, bases, links, segredos e medição | `src/routesCartao.ts:51-263`; `src/monitorBases.ts:1-111` |
| Git Autosync e comandos nativos | `src/gitAutosync.ts:56-240`; `src/routesGitAutosync.ts:35-228` |
| Dados SQLite/WAL e migrações | `src/sankhya/agenda.ts`; `src/sankhya/clientes.ts`; `src/sankhya/cartao.ts` |

A pesquisa não encontrou auto-updater implementado. O fluxo atual também delega SSO, pop-ups e downloads ao navegador externo; hospedar esses comportamentos passa a ser responsabilidade nova do desktop.

## 4. Escolha de tecnologia

| Critério | Electron | WebView2 |
|---|---|---|
| Reutilização da stack React/TypeScript/Node | Direta no shell e nos contratos | React reutilizável; host e bridge novos em .NET |
| Cookies do navegador interno | `session.cookies` | `CoreWebView2.CookieManager` |
| Token no armazenamento da página | Execução controlada no contexto da origem | `ExecuteScriptAsync` no controle apropriado |
| Abas próprias | Gerenciador com `WebContentsView` | Gerenciador com múltiplos controles |
| Runtime | Chromium/Node distribuídos com aplicativo | Runtime WebView2, Evergreen ou distribuição fixa |
| Atualizações | Aplicativo deve atualizar também Electron/Chromium | Runtime e host têm ciclos próprios |
| Integração Windows existente | Manter helpers; migrar gradualmente | Integração .NET favorável, mas launcher atual não é host pronto |
| Tamanho do pacote | Geralmente maior | Potencialmente menor com runtime compartilhado |

Electron é a recomendação para maximizar reaproveitamento e concentrar evolução em TypeScript. WebView2 permanece alternativa caso a prova de conceito revele restrição real de autenticação/compatibilidade no Electron ou exista decisão de produto por host .NET. Ambos exigem desenvolvimento; nenhum converte automaticamente o launcher existente em aplicativo completo.

## 5. Arquitetura proposta

```text
Sankhya Hub Desktop (Electron / Windows)
  ├─ Processo principal
  │    ├─ Gerenciador de abas e navegação
  │    ├─ Provedor de sessão ERP/Experience
  │    ├─ Supervisor de serviços e instância única
  │    └─ Integração autenticada com backend/helper
  ├─ Interface local confiável: React atual + controles mínimos de abas
  ├─ WebContentsView ERP: origem original, sessão própria
  ├─ WebContentsView Experience: origem original, sessão própria
  └─ WebContentsView de outros links: sem privilégios de integração

Backend atual (primeira etapa: Docker)
  ├─ Regras e rotas existentes de coleta/OS/infra/Git
  └─ Helpers Windows: DPAPI, execução nativa e monitoramento
```

### 5.1 URL e interface

- A janela do aplicativo não apresenta barra de endereços do Chrome/Edge. Pode carregar o Hub atual por HTTP local sem expor essa URL no uso normal.
- Abas exibem nomes amigáveis: Hub, ERP, Experience e título do conteúdo.
- Nome do ambiente e domínio devem estar disponíveis em detalhes, especialmente durante autenticação. Ocultar endereço técnico não deve ocultar qual ambiente está sendo operado.
- `hub://app` é uma opção futura de protocolo interno para arquivos empacotados, não requisito da primeira etapa. Alterar origem exige testar armazenamento local, chamadas de API, SSE e roteamento.
- Controles funcionais mínimos: abrir, selecionar, fechar, voltar, avançar, recarregar e indicar carregamento/falha. Estilo, animações e reorganização das telas não fazem parte desta migração.

### 5.2 Abas, links e pop-ups

- ERP e Experience abrem nas suas origens HTTPS reais, sem reescrita de cookies ou respostas.
- Links HTTP(S) usados pelo projeto devem ser inventariados e homologados para abertura interna. URLs genéricas não recebem acesso a sessões de integração ou operações nativas.
- A PoC bloqueou um link real de ERP de cliente por usar a lista de domínios de SSO. O desktop deve separar navegação iniciada pela interface confiável para URLs cadastradas da política de pop-ups de autenticação. Validar protocolo/destino e abrir aba remota sem privilégios; cadastrar um link não concede acesso a cookies ou bridge de integração.
- `target=_blank` e `window.open` devem passar pelo gerenciador de navegação. Não basta cancelar toda abertura e executar `loadURL`: isso pode perder POST, relação com `opener` e comunicação de login.
- Pop-ups de autenticação precisam preservar contexto, partição e comunicação esperada. Priorizar aba interna compatível; se uma janela filha do próprio app for indispensável, registrar a exceção de UX na homologação.
- Downloads, PDFs, impressão, upload, clipboard, atalhos e protocolos externos precisam de tratamento próprio. Protocolos como `mailto:` não são páginas web e não têm garantia de execução interna.
- Manter referências fortes das janelas filhas até `closed`; inicializar sessões/listeners somente após `app.whenReady()`. Associar `will-download` à sessão efetivamente usada e evitar registros duplicados.
- Download só recebe estado final de sucesso após reconciliar evento, arquivo produzido e tentativa correspondente. Na PoC houve arquivo salvo confirmado pelo usuário com evento `cancelled`; investigar origem/duplicação/cancelamento antes de usar essa telemetria para UX ou fechar janelas automaticamente. Não tratar todo cancelamento como sucesso nem presumir que existência de arquivo antigo com mesmo nome comprove a tentativa atual.
- Se um provedor recusar navegador embutido, esse fluxo fica bloqueado para a promessa de execução integral interna até existir alternativa suportada. Não contornar a política com disfarce de navegador.

## 6. Sessões e autenticação

### 6.1 Separação de responsabilidades

Introduzir abstração de provedor de sessão, preservando contratos de negócio:

```text
Regras de Agenda/Experience/OS
           ↓
Contrato de sessão/autenticação
           ├─ Provedor atual: helper + CDP (compatibilidade)
           └─ Provedor desktop: APIs do navegador interno
```

Contrato lógico proposto: abrir sistema, consultar estado, capturar/validar autenticação, obter autenticação apenas para backend, executar consulta de Agenda na aba ERP, invalidar e desconectar. Nomes e DTOs finais devem adaptar-se às rotas atuais, sem redesenhar o domínio.

O frontend recebe estado e identidade resumida, nunca cookies/JWT brutos. Backend continua realizando as operações existentes, evitando reimplementá-las por automação visual.

### 6.2 ERP

1. Usuário abre exatamente `https://skw.sankhya.com.br/mge/` para login no ERP corporativo e autentica no navegador interno. Após login, a navegação observada foi `/mge/system.jsp`.
2. Processo principal consulta cookies da partição correspondente, filtrados pelas URLs de integração necessárias, incluindo HttpOnly quando aplicável.
3. Cookie é associado ao ambiente/conta correto. Não concatenar indiscriminadamente cookies de todos os sites.
4. Provedor entrega autenticação ao backend por canal autenticado.
5. Validar com operação de leitura no contexto exigido pelo serviço e manter o fluxo atual de coleta.

Eventos de alteração de cookies podem solicitar atualização com debounce. Sucesso não é determinado só pela presença de um cookie: é necessário validar aceitação pelo servidor.

Após cada novo login, associar captura à geração atual de sessão e usar o JSESSIONID emitido/aceito nesse contexto, nunca uma cópia anterior por conveniência. Preferir `cookies.get({url: ...})` para os destinos necessários: na PoC, filtro somente por domínio deixou de retornar o cookie de sessão esperado. Confirmar autenticação por leitura útil; não exigir que o valor do cookie mude em todo fluxo se o servidor reutilizar uma sessão válida. A exigência funcional é usar sessão atual aceita pelo servidor.

Para Agenda, o fetch ocorre na mesma aba/partição já autenticada, com cookies administrados pelo navegador. Não injetar JSESSIONID antigo nesse fetch. O endereço corporativo acima não deve substituir URLs específicas dos ERPs de clientes cadastrados.

#### Consulta de Agenda: requisito obrigatório além dos cookies

O código atual executa fetch same-origin dentro da aba ERP autenticada para satisfazer a ACL do serviço. Exportar cookies e repetir a chamada no Node não é substituto homologado.

O provedor desktop deve oferecer uma operação específica `agenda.fetch`:

- Receber apenas os parâmetros tipados que a coleta existente já aceita; não receber código JavaScript, URL arbitrária ou nome de serviço livre.
- Localizar a aba/partição ERP correta e conferir a origem antes da execução.
- Executar o fetch por script fixo no `WebContentsView` autenticado, mantendo endpoint, método e formato da operação já implementada.
- Serializar consultas por sessão ERP, preservando a restrição do fluxo atual.
- Devolver resultado ao backend para reutilização do parser e persistência existentes.
- Aplicar timeout, correlação, limite de resposta e descarte de resultado após troca de sessão.
- Se a aba necessária estiver fechada, reabri-la no aplicativo ou informar necessidade de conexão. O scheduler não pode pressupor um contexto de página inexistente.

Não expor uma API genérica de `eval` ao frontend, backend ou conteúdo remoto. A execução de script é detalhe privado de uma operação previamente definida.

### 6.3 Experience

1. Usuário autentica na aba Experience.
2. Processo principal lê a chave de token já utilizada pelo projeto no contexto da origem exata homologada, por script fixo e restrito.
3. Captura deve lidar com navegação SPA e token criado após o carregamento inicial: comando explícito, eventos relevantes e verificação periódica limitada enquanto integração estiver ativa.
4. Backend continua consumindo Bearer pelo contrato existente.
5. Alteração, ausência, expiração ou rejeição do token atualiza estado e interrompe uso de credencial obsoleta.

Decodificar `exp` de JWT é apenas indicação de expiração, não validação de autenticidade. O servidor continua sendo a autoridade.

O levantamento identificou recaptura após expiração/rejeição, não um mecanismo de refresh implementado. Não prometer renovação silenciosa nem fixar aproximadamente 72 horas como validade universal. Tratar 401/403 conforme as respostas e regras atuais, distinguindo falha de permissão de sessão inválida quando possível.

### 6.4 Persistência e isolamento

- Usar partições persistentes identificadas por sistema, ambiente e conta quando suportado. Não confundir cliente comercial da Agenda com conta de autenticação: clientes podem compartilhar o mesmo login corporativo.
- Pop-ups de um mesmo login compartilham a partição necessária ao SSO. Compartilhamento entre ERP/Experience só será definido após testar o fluxo real.
- Perfil do Hub e páginas remotas ficam separados. Links genéricos têm partição sem acesso à bridge de integração.
- Fechar aba não equivale a logout. Desconectar deve invalidar cache do backend, limpar credenciais capturadas e tratar armazenamento da partição apropriada.
- No logout remoto ou falha de autenticação, invalidar a cópia no backend; impedir que uma atualização atrasada restaure credenciais antigas. Usar geração/versionamento de sessão.
- Persistência inicial de segredos continua no helper DPAPI. `safeStorage` é alternativa posterior, mas seu formato não deve ser presumido compatível com os arquivos DPAPI atuais.
- Sessão expirada exige reautenticação, preservando formulários e trabalhos pendentes. Não manter login vivo por mecanismos que o servidor não suporta.

## 7. Ponte desktop, backend e helpers

O backend Linux não consegue chamar diretamente APIs de janela do Electron. A migração deve explicitar o transporte entre processos.

**Transporte recomendado para o modo Docker:** processo principal abre uma conexão persistente autenticada com o backend pela porta local publicada. Um canal WebSocket interno proposto transporta comandos tipados do backend para o host e respostas correlacionadas no sentido inverso. Isso permite `agenda.fetch` sem exigir que o container alcance um listener de loopback do Windows. A rota/canal ainda precisa ser implementada, não existe por pressuposto.

O backend seleciona `legacy-cdp` ou `desktop` por configuração explícita. O adaptador desktop encaminha somente operações conhecidas pelo canal. A interface confiável solicita abertura de abas por IPC específico; captura/estado segue pelo canal interno e armazenamento sensível mantém o helper DPAPI na primeira versão.

Regras de transporte: autenticação no handshake, limite de payload, deadline, identificador único, validação de esquema, uma conexão dona por contexto, limpeza de pendências na desconexão e reconexão com backoff. Falhas do canal suspendem coleta dependente da aba. Não repetir operações de escrita automaticamente. O segredo do canal é específico da comunicação interna, fora da URL, logs e renderers.

- Definir um único responsável por cada porta, token e estado de sessão. Não iniciar um segundo servidor disputando a porta 4102.
- Se rotas legadas de abertura continuarem disponíveis, adaptá-las com semântica explícita; em modo desktop não devem abrir Chrome externo acidentalmente.
- Mensagens incluem sistema, ambiente, identificador da captura, geração e correlação da operação. Segredos trafegam somente entre processos autorizados.
- O token do helper não é exposto ao React ou conteúdo remoto. CORS, isoladamente, não autentica uma API local.
- A topologia atual usa `host.docker.internal`; um helper ligado apenas a loopback pode ficar inacessível ao container. Não aplicar mudança de bind sem validar a topologia e o controle de acesso.
- Na etapa posterior sem Docker, preferir IPC local ou endpoints de loopback autenticados, com descoberta de porta e teste de identidade do serviço.
- Versões de shell/backend/helper devem ser verificadas no início para evitar mistura de contratos incompatíveis.

## 8. Isolamento exigido pela arquitetura

O conteúdo remoto executa scripts de outros sistemas. Ele deve poder funcionar como página web sem obter acesso ao computador ou às outras integrações.

- `nodeIntegration: false`, `contextIsolation: true`, sandbox habilitada e `webSecurity` mantido.
- Bridge privilegiada somente na interface local confiável. Não expor `ipcRenderer`, shell, filesystem ou avaliador genérico de JavaScript a páginas remotas.
- Validar origem e identidade do remetente de cada IPC, argumentos e destino da operação.
- Capturar cookies/token apenas dos sistemas configurados; URLs de favoritos não se tornam origens autorizadas para captura.
- Solicitações de permissão, navegações e abertura de janelas passam por política centralizada.
- Logs e diagnóstico não incluem cabeçalhos Cookie/Authorization ou valores de armazenamento de sessão.
- Achado real da PoC: URL de redirect SSO expôs JWT no log antes da correção. O relatório registra higienização do arquivo. O desktop deve eliminar query/fragmento sensíveis antes de qualquer log de navegação e redigir segredos também por conteúdo, não apenas por nome de chave. Testar sanitização com tokens sintéticos em redirects, mensagens e exceções.
- A versão distribuída não depende de porta CDP externa nem desativa validação de certificado.

## 9. Paridade funcional e operações de escrita

Antes de implementar, congelar baseline funcional, incluindo mudanças concorrentes, e registrar entradas/saídas com dados de teste.

| Área | Critério de paridade |
|---|---|
| Inicialização | Um executável abre app, apresenta progresso e identifica falha de dependência |
| Infraestrutura | Monitoramento, atualizações ao vivo, ações e logs mantêm comportamento |
| Configurações/cofres | Dados atuais acessíveis após migração; segredos protegidos e fora de logs |
| ERP/Agenda | Login, captura, coleta, filtros e associação de clientes produzem mesmos resultados |
| Experience | Login, token, coleta de tarefas/OS e filtros preservados |
| Lançamento de OS | Mesmos dados, validações, etapas e resultados do fluxo atual |
| Clientes/repositórios/favoritos | Vínculos preservados e links abertos pelo gerenciador interno |
| Cartão do cliente e bases | Links, segredos, repositórios, medição e monitoramento de bases preservados |
| Git Autosync | Configuração, status, histórico e comandos existentes preservados |
| Persistência | Reinício mantém dados e sessões ainda válidas; expiração é comunicada |
| Navegação | URLs do catálogo e fluxos de login homologados dentro do app |
| Encerramento | Fechar janela, permanecer em segundo plano e sair têm efeitos definidos |

### 9.1 OS e recuperação de falhas

- Reutilizar serviços, payloads e sequência atuais; trocar origem das credenciais não deve alterar regra de OS.
- Baseline a preservar: `src/sankhya/experience.ts` (`prepararOrdem`, `criarOrdem`, `semZeroAEsquerda` e tratamento de resposta) e `src/routesExperience.ts`. Manter `POST /api/experience/os/preparar` e `POST /api/experience/os`; não duplicar implementação de criação dentro do Electron.
- Por decisão do usuário, nesta etapa somente preservar/documentar esse fluxo. Implementação desktop e teste real de escrita ficam pendentes até retomada explícita; adiamento não equivale a aprovação funcional.
- Preservar payload bruto da tarefa, preparação, observações, aprovadores, tratamento de duplicidade e revalidação das tarefas antes do envio.
- Preservar formato de `date_done` sem zero à esquerda, conforme `semZeroAEsquerda` na implementação atual. Verificar erro de negócio no corpo (`response.error`), mesmo com HTTP 200.
- Registrar operações com identificador de correlação e resultado confirmado.
- Após timeout de escrita, não repetir automaticamente a criação: verificar no sistema remoto se foi concluída. Se não houver mecanismo confiável de reconciliação, informar resultado indeterminado e exigir verificação antes de repetir.
- Quando fluxo tiver etapas separadas (criação, aceite, e-mail), manter o estado individual de cada etapa. Falha de e-mail não deve provocar nova criação de OS.
- Troca de sessão, fechamento de aba, crash ou atualização não podem provocar reenvio silencioso.
- Validar escrita somente em ambiente/registro de homologação autorizado, comparando identificador e conteúdo do resultado remoto.

## 10. Ciclo de vida, distribuição e migração

- Instância única por usuário/contexto; segundo clique apenas focaliza aplicativo.
- Supervisor distingue serviços iniciados pelo Hub de serviços preexistentes. Encerrar o Hub não encerra infraestrutura ou navegador pessoal indiscriminadamente.
- Proposta de comportamento: fechar janela mantém atividade em bandeja quando houver monitoramento/agendamentos ativos; “Sair” encerra componentes pertencentes ao aplicativo após tratar operações em andamento. Confirmar comportamento na homologação.
- Nenhum agendamento é prometido com computador desligado, sessão revogada ou processo responsável encerrado. Serviços externos que hoje operam independentemente devem continuar assim.
- Primeira migração preserva volumes/diretórios de dados atuais. Backup e manifest de versão antecedem qualquer conversão.
- Perfis desktop ficam em diretório novo. Reautenticação inicial substitui tentativa de copiar banco de cookies entre produtos Chromium.
- Configuração e dados do frontend em localStorage/IndexedDB exigem inventário: mover para Electron altera perfil mesmo que a URL seja igual. Migrar valores necessários por exportação/importação explícita.
- Distribuição usa instalador e artefatos versionados; assinatura e atualização devem ser definidas antes da entrega aos usuários. Atualização não ocorre durante escrita de OS.
- Rollback conserva executável anterior e backup compatível, mas somente uma instância deve executar automações/escritas. Não manter dois agendadores ativos durante comparação.

## 11. Plano de implementação com gates

### Fase 0 — baseline e catálogo

Inventariar recursos reais, armazenamento, URLs, autenticação, trabalhos em segundo plano e dependências. Registrar resultado conhecido de cada item da matriz. Resolver divergências entre especificação antiga e código atual.

**Saída:** matriz de paridade e catálogo de navegação aprovados como baseline técnico.

### Fase 1 — prova de conceito vertical

**Estado em 2026-09-16: executada parcialmente.** Navegação, captura e leituras reais comprovadas; detalhes na seção 1.1. Seguem pendentes diagnóstico ERP, cenários complementares e escrita OS adiada pelo usuário.

Criar host Electron mínimo, Hub atual e duas abas remotas. Autenticar ERP/Experience, obter cookie/token pelo host e executar leitura pelo backend existente. Testar SSO/pop-up, reinício e uma OS de homologação com a mesma sequência atual.

Incluir obrigatoriamente consulta real de Agenda via `agenda.fetch` sequencial dentro da aba; leitura só por cookie exportado não aprova a prova de conceito. Executar dois ciclos de login/expiração ou logout/recaptura para ambos os sistemas.

**Gate:** somente avançar quando autenticação e operação ponta a ponta funcionarem sem navegador externo. Bloqueios de provedor devem ser documentados; não mascarar falha trocando requisito silenciosamente.

### Fase 2 — shell e provedor de sessões

Implementar gerenciador de abas, partições, IPC, canal backend-host, `agenda.fetch`, captura/validação/expiração, compatibilidade do helper e inicialização supervisionada. Manter backend Docker inicialmente.

**Gate:** Hub, ERP e Experience operacionais dentro do aplicativo; modo desktop não requer CDP externo; front não recebe segredos.

### Fase 3 — paridade completa

Homologar matriz, demais URLs, favoritos, infra, Git, downloads e recuperação de falhas. Adicionar testes significativos de contrato, sessão e escrita sem duplicação.

**Gate:** cada requisito tem evidência; nenhum item funcional é removido por não caber no shell.

### Fase 4 — distribuição e transição

Empacotar instalador, persistência, diagnóstico, backup/migração, atualização e rollback. Validar instalação em máquina Windows distinta da máquina de desenvolvimento.

**Gate:** instalação reproduzível, dados preservados e dependências informadas/administradas pelo aplicativo.

### Fase 5 — simplificação opcional do runtime

Avaliar backend Node em processo filho/utility process, retirada do container do Hub e redução de helpers. Levantar módulos nativos, paths Linux, Docker socket, caminhos Windows e dependências de rede antes de portar.

**Gate:** Docker pode continuar existindo para serviços monitorados; remover o container do Hub não implica remover Docker do ambiente inteiro. Repetir homologação afetada pela troca de runtime.

### Fase posterior — layout

Redesenhar interface sobre contratos estáveis. Gerenciador de abas, integração e sessão não dependem de componentes visuais específicos. Não fixar design final nesta especificação.

## 12. Testes essenciais

1. Chrome/Edge pessoal aberto; desktop não lê nem altera seus perfis.
2. Abrir Hub, ERP, Experience e links homologados sem abrir navegador externo.
3. Login normal, MFA/SSO quando utilizado, cancelamento e falha de rede.
4. Cookies HttpOnly e token da origem correta chegam somente ao backend autorizado.
5. Expiração, logout, troca de conta e captura atrasada não reutilizam sessão anterior.
6. Coleta de Agenda/tarefas/OS coincide com baseline.
7. Criar OS de teste, interromper resposta e reconciliar sem duplicação; verificar etapas posteriores.
8. Reiniciar aplicativo e Windows; recuperar dados sem prometer validade eterna do login.
9. Git, logs, SSE e ações de infra continuam funcionando; indisponibilidade de helper é explicada.
10. URLs com pop-up/POST/opener, upload/download/PDF e protocolos externos têm resultado documentado.
11. Fechar janela, sair, reabrir, conflito de porta, backend offline e crash de aba não duplicam processos/agendadores.
12. Página remota não consegue chamar bridge privilegiada ou obter credencial de outro sistema.
13. Atualização/rollback mantêm dados e não repetem operações de escrita.
14. Perfil persistente e perfil realmente novo comparados separadamente; reinício de processo não classificado como limpeza de cookies/cache/Service Worker.
15. Link de ERP de cliente abre em aba interna apropriada sem ampliar permissões da integração ou da lista de SSO.
16. Download concluído/cancelado/interrompido tem evidência coerente por tentativa, inclusive arquivo parcial e janela filha.
17. URLs com JWT sintético em query/fragmento e exceções não deixam segredo em logs.

## 13. Mapa de implementação proposto

Os novos nomes abaixo são proposta de organização, não arquivos já existentes.

| Área | Responsabilidade |
|---|---|
| `desktop/main.ts` | Inicialização Electron, instância única e ciclo de vida |
| `desktop/tabs.ts` | WebContentsView, navegação, pop-ups e downloads |
| `desktop/sessions.ts` | Partições, cookies, token Experience e estados de sessão |
| `desktop/agenda.ts` | Fetch fixo same-origin e fila serial de consultas |
| `desktop/backendBridge.ts` | Canal interno autenticado e comandos tipados |
| `desktop/preload.ts` | API mínima somente para interface confiável |
| `desktop/services.ts` | Supervisão das dependências existentes |
| `src/sankhya/credenciais.ts` e adaptador de navegador proposto | Seleção do provider, mantendo consumidores de negócio |
| `src/routesAgenda.ts` | Usar contrato de consulta em página no provider configurado |
| `src/routesSankhya.ts` | Adaptar abertura/captura/status ao provider |
| `src/sankhya/experience.ts`, `src/routesExperience.ts` | Preservar regras e validar paridade; evitar reescrita funcional |
| `scripts/hub-helper.ps1` | Compatibilidade de cofre/nativo e retirada gradual de responsabilidades CDP |
| `scripts/abrir-hub.ps1`, `scripts/iniciar-monitor.ps1`, `scripts/compilar-launcher.ps1` | Transição da inicialização para executável desktop |
| `package.json` e configuração de empacotamento nova | Build desktop, runtime fixado, instalador e distribuição |
| Componentes/hooks atuais de abertura | Adaptar comandos via facade estável, independente do layout futuro |

### 13.1 Dependências que não desaparecem ao criar o desktop

- Docker Engine/Desktop e serviços monitorados, enquanto o backend permanecer no container.
- Acesso ao Docker socket utilizado pelo monitoramento; o shell não deve repassar esse poder às páginas remotas.
- Helpers do WildFly, DPAPI e integrações Windows atuais.
- Executável/configuração do Git Autosync, Git, Agendador do Windows e provedores opcionais utilizados por comandos de IA/terminal/MR.
- Configurações de acesso e disponibilidade dos ambientes Oracle/WildFly/ERP/Experience.

## 14. Pendências de homologação e decisões de produto

1. Catálogo completo de URLs e domínios de SSO realmente utilizados; execução interna é meta para esse catálogo, não garantia para qualquer site da internet.
2. Compatibilidade dos provedores com navegador embutido e possíveis janelas filhas do próprio aplicativo.
3. Comportamento esperado de fechar janela/bandeja e atividades com a interface fechada.
4. Necessidade real de contas/ambientes simultâneos; partições devem permitir evolução sem misturar identidades.
5. Inventário final de dados em perfil web, SQLite, volumes e arquivos nativos; formato de migração e rollback.
6. Forma de distribuição, assinatura, canal de atualização e política de versões compatíveis.
7. Confirmação de que retirar Docker é ou não objetivo posterior. Isso não bloqueia o primeiro desktop funcional.

### 14.1 Diagnóstico pendente do ERP

O erro `require is not defined` e erros correlatos `Invalid URL`/Credential Management foram observados na PoC. Nas reproduções dirigidas, erros de console surgiram na carga inicial, antes de novo login; houve também mensagem `[E-FLG-401]` de `js/login/sso.js` em execução com login. A URL estava correta.

Isso não confirma que a feature flag, o Electron ou um JSESSIONID antigo sejam a causa. Reinícios usaram perfil persistente; portanto, estado anterior de cookies/cache/Service Worker não foi eliminado. Mensagens próximas no tempo e `sourceId` não substituem stack do lançamento da exceção.

Próxima investigação deve:

1. Comparar perfil persistente com novo diretório de dados descartável, sem apagar o perfil existente.
2. Capturar separadamente o alerta e cada erro de console; habilitar pausa em exceções/rejeições no DevTools para localizar origem e chamada.
3. Comparar mesma URL/fluxo em navegador convencional e Electron, documentando versões e condições.
4. Verificar login, navegação e Agenda após o erro para delimitar impacto.
5. Não habilitar Node em páginas remotas nem desativar sandbox, TLS ou `webSecurity` como correção.

**Atualização (rodada de validação seguinte, mesmo dia):** os itens 1 e 2 acima foram executados sem exigir DevTools manual. Stack completo da exceção capturado via `webContents.debugger` (CDP, `Runtime.exceptionThrown`) mostra **todos os frames dentro de `electron/js2c/sandbox_bundle`** — nenhum referencia código do ERP. O erro também reproduziu, idêntico, em diretório de dados novo/descartável (2 de 2 reinícios), afastando cookie/cache/Service Worker herdado como causa. Isso reforça a leitura de que a origem é interna ao bootstrap sandboxed do Electron, não ao script do Sankhya — mas ainda não há confirmação por comparação em navegador convencional (item 3) nem teste isolado de desabilitar sandbox só como diagnóstico (deliberadamente não feito, para não abrir mão da configuração de segurança pedida). Item 4 (impacto) segue sem evidência de bloqueio: login, Agenda in-page e leitura funcionaram nas mesmas sessões em que o erro ocorreu. Ver `docs/specs/sankhya-hub-desktop-poc-relatorio.md`, Rodada 3, para o stack completo e o log.

### 14.2 Critérios para encerrar a rodada de validação

- Explicar/corrigir erro ERP, ou demonstrar seu impacto e registrar explicitamente aceitação da limitação.
- Validar links cadastrados e reconciliar diagnóstico de download com resultado real.
- Realizar recuperação de backend indisponível ponta a ponta, sem interromper container compartilhado sem coordenação.
- Testar Windows restart, MFA/SSO pop-up e troca de conta apenas quando houver cenário e participação necessários; manter pendências explícitas até lá.

**Atualização (2026-09-17):** Windows restart executado com coordenação do usuário (ele reiniciou, avisou antes e depois). Observado sem presumir: container do backend voltou sozinho (restart policy do Docker), helper nativo e a PoC não sobrevivem a reboot (esperado, religados manualmente). Cookie de sessão do ERP não persistiu (comportamento já conhecido, não é falha de perfil); JWT da Experience persistiu (armazenamento em disco). Recaptura de ambos testada com dado real (Agenda com 142 eventos atuais). MFA/SSO pop-up: sem cenário real disponível nesta conta, registrado como não aplicável, não testado por simulação. Troca de conta: não testada, sem segunda credencial disponível. Detalhe completo em `docs/specs/sankhya-hub-desktop-poc-relatorio.md`, Rodada 6.
- Retomar OS em momento acordado, com registro/ambiente autorizado e confirmação do resultado remoto. Não inferir sucesso de escrita a partir de leitura de tarefas.

O próximo trabalho é concluir a validação da Fase 1. A consulta de Agenda em página já funcionou em teste real; riscos restantes incluem erro ERP, autenticação complementar, escrita OS e paridade de navegação, não capacidade de esconder a URL.

## 15. Fontes técnicas

- Electron WebContentsView: https://www.electronjs.org/docs/latest/api/web-contents-view
- Cookies e evento changed: https://www.electronjs.org/docs/latest/api/cookies
- Abertura de janelas e contexto de opener: https://www.electronjs.org/docs/latest/api/window-open
- Isolamento e IPC: https://www.electronjs.org/docs/latest/tutorial/security
- Armazenamento protegido: https://www.electronjs.org/docs/latest/api/safe-storage
- WebView2, APIs de cookies, script e navegação: https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/overview-features-apis
- Restrição do Chrome sobre diretório padrão e remote debugging: https://developer.chrome.com/blog/remote-debugging-port

Consulta documental confirma capacidades das plataformas. A PoC em `poc-desktop/` acrescenta testes reais delimitados pelo relatório; não representa implementação da migração completa nem homologação integral.
