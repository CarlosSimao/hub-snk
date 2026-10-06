# API HTTP

Referência das rotas do HUB SNK. Para instalar e usar, veja o
[README](../README.md).

Base: `http://127.0.0.1:4100`

## Conferência de origem

Escutar em `127.0.0.1` não isola o programa do resto da internet. Qualquer página
aberta no navegador consegue mandar requisições para o endereço local, e um
domínio configurado para resolver em `127.0.0.1` — DNS rebinding — passa por
origem legítima aos olhos do navegador. Como a API devolve o cadastro inteiro e
abre programas, isso bastaria para vazar as senhas de todos os clientes a partir
de uma aba qualquer.

Por isso, antes de chegar a qualquer rota, dois cabeçalhos são conferidos:

- **`Host`** — precisa ser `127.0.0.1`, `localhost` ou `[::1]`, na porta em que o
  servidor está escutando. Um nome de domínio ali denuncia o rebinding.
- **`Origin`** — quando presente, precisa ser a própria origem do HUB SNK.
  Requisição sem `Origin` é aceita: navegação direta, o shell desktop chamando o
  backend e chamadas de linha de comando não mandam o cabeçalho, e o `Host` já foi
  conferido.

O que não passa recebe `403` e fica registrado no log do servidor.

O servidor só escuta em loopback: um `HUB_HOST` fora dele é recusado na largada.

## Autenticação

A conferência de origem barra páginas do navegador, mas não outros processos da
própria máquina — inclusive os de outro usuário do Windows, porque o loopback é
compartilhado num servidor RDS ou na troca rápida de usuário. Por isso toda rota
`/api/*`, menos `/api/healthz`, exige o token do shell, o conteúdo de
`%APPDATA%\sankhya-hub\ipc\desktop-token.txt`. Ele vale de dois jeitos:

- **cabeçalho `x-hub-token`** — o que o shell e qualquer chamada de fora (script,
  linha de comando) usam;
- **cookie `hub_token`** — o que o painel usa. O shell o grava na sessão da guia
  Painel, com `HttpOnly` e `SameSite=Strict`, antes de carregá-la: o JavaScript da
  página não lê o valor, e as outras guias não fazem chamadas autenticadas.

Sem o arquivo do token, a resposta é `503`; sem token ou com o token errado,
`401`. A decisão é pela rota encontrada, e não pela escrita da URL. Os arquivos do
painel (`/`, `*.js`, `*.css`) não exigem token: não têm dado nenhum.

Para desenvolver o painel no navegador sem o aplicativo aberto, `HUB_SEM_TOKEN=1`
no backend desliga a exigência, e o servidor avisa no log ao subir.

```powershell
$token = Get-Content "$env:APPDATA\sankhya-hub\ipc\desktop-token.txt"
Invoke-RestMethod http://127.0.0.1:4100/api/clientes -Headers @{ 'x-hub-token' = $token }
```

## Rotas

| Método   | Rota                                                        | Resposta                                                                                   |
| -------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET`    | `/api/clientes`                                             | `200` — lista ordenada por nome, com as bases                                              |
| `POST`   | `/api/clientes`                                             | `201` — cliente criado                                                                     |
| `PUT`    | `/api/clientes/:id`                                         | `200` — cliente atualizado                                                                 |
| `GET`    | `/api/clientes/:id`                                         | `200` — um cliente, com a situação do MCP de cada repositório                              |
| `PUT`    | `/api/clientes/:id/anotacoes`                               | `200` — cliente com as anotações gravadas                                                  |
| `PUT`    | `/api/clientes/:id/nomes-completos`                         | `200` — cliente com os `{ nomesCompletos }` (razões sociais) gravados                      |
| `DELETE` | `/api/clientes/:id`                                         | `204` — sem conteúdo                                                                       |
| `POST`   | `/api/clientes/importacao`                                  | `201` — bases criadas a partir dos favoritos do navegador                                  |
| `POST`   | `/api/clientes/importacao-de-repositorios`                  | `201` — repositórios criados a partir da varredura de pastas                               |
| `POST`   | `/api/clientes/importacao-de-cadastros`                     | `201` — clientes e bases lidos de um arquivo de cadastros do HUB SNK                       |
| `POST`   | `/api/clientes/:id/bases`                                   | `201` — base criada                                                                        |
| `PUT`    | `/api/clientes/:id/bases/:idBase`                           | `200` — base atualizada                                                                    |
| `DELETE` | `/api/clientes/:id/bases/:idBase`                           | `204` — sem conteúdo                                                                       |
| `GET`    | `/api/clientes/:id/bases/:idBase/situacao`                  | `200` — `{ urlOk, versaoDaPlataforma, historico }` da URL da base                          |
| `PUT`    | `/api/clientes/:id/bases/:idBase/banco`                     | `200` — banco vinculado ou substituído                                                     |
| `DELETE` | `/api/clientes/:id/bases/:idBase/banco`                     | `204` — banco desvinculado                                                                 |
| `POST`   | `/api/clientes/:id/repositorios`                            | `201` — repositório criado                                                                 |
| `PUT`    | `/api/clientes/:id/repositorios/:idRepositorio`             | `200` — repositório atualizado                                                             |
| `DELETE` | `/api/clientes/:id/repositorios/:idRepositorio`             | `204` — sem conteúdo                                                                       |
| `POST`   | `/api/clientes/:id/repositorios/:idRepositorio/abrir-pasta` | `204` — pasta aberta; `503` quando o gerenciador falta                                     |
| `POST`   | `/api/clientes/:id/repositorios/:idRepositorio/abrir-shell` | `204` — terminal aberto; `503` quando nenhum abre                                          |
| `POST`   | `/api/clientes/:id/repositorios/:idRepositorio/abrir-ide`   | `204` — projeto aberto; `503` sem IDE configurada ou indisponível                          |
| `GET`    | `/api/clientes/:id/repositorios/:idRepositorio/mcp`         | `200` — conteúdo do `.sankhya-mcp.env`                                                     |
| `PUT`    | `/api/clientes/:id/repositorios/:idRepositorio/mcp`         | `204` — arquivo criado ou sobrescrito                                                      |
| `POST`   | `/api/clientes/:id/links`                                   | `201` — link criado                                                                        |
| `PUT`    | `/api/clientes/:id/links/:idLink`                           | `200` — link atualizado                                                                    |
| `DELETE` | `/api/clientes/:id/links/:idLink`                           | `204` — sem conteúdo                                                                       |
| `POST`   | `/api/clientes/:id/projetos`                                | `201` — projeto criado                                                                     |
| `PUT`    | `/api/clientes/:id/projetos/:idProjeto`                     | `200` — projeto atualizado                                                                 |
| `DELETE` | `/api/clientes/:id/projetos/:idProjeto`                     | `204` — sem conteúdo; com kanban, exige `?kanbans=manter` ou `excluir` (`409` sem ele)     |
| `PUT`    | `/api/clientes/:id/projetos/:idProjeto/anotacoes`           | `200` — projeto com as anotações gravadas                                                  |
| `POST`   | `/api/clientes/:id/projetos/:idProjeto/links`               | `201` — link do projeto criado                                                             |
| `PUT`    | `/api/clientes/:id/projetos/:idProjeto/links/:idLink`       | `200` — link do projeto atualizado                                                         |
| `DELETE` | `/api/clientes/:id/projetos/:idProjeto/links/:idLink`       | `204` — sem conteúdo                                                                       |
| `GET`    | `/api/situacao-git?forcar=true`                             | `200` — situação Git dos repositórios com pasta local, indexada pelo id                    |
| `GET`    | `/api/configuracao`                                         | `200` — configuração global                                                                |
| `PUT`    | `/api/configuracao`                                         | `200` — configuração salva                                                                 |
| `GET`    | `/api/configuracao/perfis`                                  | `200` — funcionalidades ocultas no preset de cada perfil                                   |
| `GET`    | `/api/configuracao/assistentes-de-ia`                       | `200` — `{ assistentes }`: instalado, caminho, modelos e se lê PDF, de cada assistente     |
| `PUT`    | `/api/configuracao/sankhya-om-codusu`                       | `200` — grava só o `{ sankhyaOmCodUsu }`, fora do formulário                               |
| `GET`    | `/api/configuracao/mcp`                                     | `200` — `{ configuracao, existe }` do `.env` do sankhya-schema-mcp                         |
| `POST`   | `/api/configuracao/mcp/importar`                            | `200` — `{ caminhoDoSchemaMcp, configuracao }` do `.env` escolhido; `204` quando cancelado |
| `POST`   | `/api/atalhos/selecionar-executavel`                        | `200` — caminho escolhido; `204` quando cancelado                                          |
| `POST`   | `/api/atalhos/:id/abrir`                                    | `204` — programa iniciado; `503` se ele não subir                                          |
| `GET`    | `/api/sistema/versao`                                       | `200` — `{ "versao": "1.0.0" }`, a mesma exibida no rodapé                                 |
| `GET`    | `/api/sistema/atualizacao`                                  | `200` — comparação com a última release publicada no GitHub                                |
| `POST`   | `/api/sistema/selecionar-pasta`                             | `200` — `{ caminho }` escolhido no seletor do sistema; `204` quando cancelado              |
| `POST`   | `/api/sistema/repositorios-locais`                          | `200` — `{ repositorios }` Git encontrados nas `{ pastas }` do corpo                       |
| `GET`    | `/api/notificacoes`                                         | `200` — `{ notificacoes, naoLidas }`, da mais recente para a mais antiga                   |
| `GET`    | `/api/notificacoes/fluxo`                                   | SSE — evento `notificacao` com cada notificação nova                                       |
| `POST`   | `/api/notificacoes/lidas`                                   | `200` — marca as `{ ids }` como lidas; sem `ids`, todas                                    |
| `DELETE` | `/api/notificacoes`                                         | `204` — esvazia o painel (as chaves emitidas continuam guardadas)                          |
| `POST`   | `/api/notificacoes/email-de-teste`                          | `200` — e-mail enviado com o `{ smtp }` do corpo; `502` se o SMTP falha                    |
| `GET`    | `/api/lembretes`                                            | `200` — `{ lembretes }`, cada um com o `proximoDisparo`                                    |
| `POST`   | `/api/lembretes`                                            | `201` — lembrete criado                                                                    |
| `PUT`    | `/api/lembretes/:id`                                        | `200` — lembrete atualizado                                                                |
| `DELETE` | `/api/lembretes/:id`                                        | `204` — sem conteúdo                                                                       |
| `GET`    | `/api/lembretes/previa?expressao=`                          | `200` — `{ ocorrencias }`, as três próximas; `400` com o cron inválido                     |
| `GET`    | `/api/contatos`                                             | `200` — `{ contatos }`                                                                     |
| `POST`   | `/api/contatos`                                             | `201` — contato criado                                                                     |
| `PUT`    | `/api/contatos/:id`                                         | `200` — contato atualizado                                                                 |
| `DELETE` | `/api/contatos/:id`                                         | `204` — sem conteúdo                                                                       |

A situação da base cadastrada é um nível só: a URL responde ou não dentro do
`tempoLimiteSegundos` da configuração. `versaoDaPlataforma` vem nula quando a
página não a informa, e `historico` traz as amostras recentes, que somem junto
com a base.

`GET /api/configuracao/mcp` lê o `.env` da pasta gravada em
`caminhoDoSchemaMcp`, não o `configuracao.json`. Sem caminho, responde
`{ "configuracao": null, "existe": false }`; com a pasta ausente, `404`. O
`importar` abre o seletor de arquivo do sistema, porque o navegador não entrega o
caminho absoluto, e só aceita um arquivo chamado `.env` (`400` para outro nome).
Nada é gravado ali: a pasta e as variáveis voltam para a tela e só persistem no
`PUT /api/configuracao`.

`repositorios-locais` só lê o disco: recebe `{ "pastas": ["C:\\Workspace"] }`,
de 1 a 20 caminhos absolutos, e devolve o que encontrou, sem cadastrar nada.
Pasta inexistente responde `404`.

## Ambiente local

Bases locais são instalações do WildFly na máquina; bancos locais são containers
Docker. Nenhuma destas rotas passa pelo shell desktop.

| Método   | Rota                                     | Resposta                                                                     |
| -------- | ---------------------------------------- | ---------------------------------------------------------------------------- |
| `GET`    | `/api/local/bases`                       | `200` — bases locais, com a situação do `.sankhya-mcp.env` de cada uma       |
| `POST`   | `/api/local/bases`                       | `201` — base local criada                                                    |
| `PUT`    | `/api/local/bases/:id`                   | `200` — base local atualizada                                                |
| `DELETE` | `/api/local/bases/:id`                   | `204` — sem conteúdo                                                         |
| `POST`   | `/api/local/bases/:id/iniciar`           | `204` — WildFly iniciado; `503` quando o comando falha                       |
| `POST`   | `/api/local/bases/:id/reiniciar`         | `204` — WildFly reiniciado; `503` quando o comando falha                     |
| `POST`   | `/api/local/bases/:id/parar`             | `204` — WildFly parado; `503` quando o comando falha                         |
| `GET`    | `/api/local/bases/:id/situacao`          | `200` — `{ servicoRodando, paginaInicialOk, versaoDaPlataforma, historico }` |
| `GET`    | `/api/local/bases/:id/log/stream?desde=` | SSE — acompanha o `server.log` da base                                       |
| `GET`    | `/api/local/bases/:id/log/download`      | `200` — `server.log` inteiro como anexo; `404` quando o arquivo não existe   |
| `GET`    | `/api/local/bases/:id/mcp`               | `200` — conteúdo do `.sankhya-mcp.env` da pasta do WildFly                   |
| `PUT`    | `/api/local/bases/:id/mcp`               | `204` — arquivo criado ou sobrescrito                                        |
| `GET`    | `/api/local/bancos`                      | `200` — bancos locais                                                        |
| `POST`   | `/api/local/bancos`                      | `201` — banco local criado                                                   |
| `PUT`    | `/api/local/bancos/:id`                  | `200` — banco local atualizado                                               |
| `DELETE` | `/api/local/bancos/:id`                  | `204` — sem conteúdo                                                         |
| `POST`   | `/api/local/bancos/:id/iniciar`          | `204` — container iniciado; `503` sem Docker ou com o comando falhando       |
| `POST`   | `/api/local/bancos/:id/reiniciar`        | `204` — container reiniciado; `503` sem Docker ou com o comando falhando     |
| `POST`   | `/api/local/bancos/:id/parar`            | `204` — container parado; `503` sem Docker ou com o comando falhando         |
| `GET`    | `/api/local/bancos/:id/situacao`         | `200` — `{ containerRodando, bancoAcessivel, historico }`                    |

A situação da base local tem dois níveis: o serviço do WildFly responde e, só
então, a página inicial na `porta` da base abre. A do banco também: o container
está rodando e, só então, o banco aceita conexão. As duas checagens usam o
`tempoLimiteSegundos` da configuração, lido a cada chamada, e o `historico` some
junto com o cadastro.

O stream lê `standalone/log/server.log` dentro do `caminhoWildfly` e emite quatro
eventos, todos com o dado em JSON:

- **`trecho`** — texto novo do log. Sem `desde`, o primeiro traz os últimos 64 KB
  do arquivo.
- **`posicao`** — até que byte o cliente já recebeu. Passado em `?desde=` ao
  retomar, continua dali em vez de repetir o final do arquivo.
- **`aviso`** — o log ainda não existe; o acompanhamento segue esperando por ele.
- **`erro`** — a leitura falhou; o acompanhamento continua.

O arquivo é conferido a cada segundo, e o acompanhamento para quando a conexão
fecha. O download sai como `text/plain` com o nome `server-<nome-da-base>.log`,
sem acento nem espaço.

Base local:

```json
{ "nome": "Local 4.30", "caminhoWildfly": "C:\\sankhya\\wildfly", "porta": 8080 }
```

Banco local:

```json
{
  "container": "oracle-sankhya",
  "host": "localhost",
  "porta": 1521,
  "nomeDoServico": "ORCL",
  "usuario": "system",
  "senha": "..."
}
```

Todos os campos são obrigatórios nos dois cadastros, e `porta` segue a regra do
banco de dados das bases de cliente.

## Git AutoSync

Falam com o Git AutoSync instalado em `GIT_AUTOSYNC_HOME` (padrão `~/.git-autosync`).
O HUB SNK nunca grava o `config.json` dele: toda mudança é um subcomando do CLI,
chamado sem shell. O que a tela faz com cada rota está em
[funcionalidades.md](funcionalidades.md#git-autosync).

| Método e rota                                | Corpo / query                                              | O que faz                                                                         |
| -------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/autosync`                          | `?clientes=true` marca o cliente dono de cada repositório  | Estado, horários, tarefas, IA, alvos e repositórios                               |
| `GET /api/autosync/clientes`                 |                                                            | Repositórios dos clientes com a situação no autosync e as sugestões de pasta-raiz |
| `GET /api/autosync/git`                      |                                                            | `{ instalado, versao }` do `git --version`: a tela pergunta antes de instalar     |
| `POST /api/autosync/instalar`                | `{ horario?, bandeja?, atalhos?, skills?, path? }`         | Confere o Git, baixa a Release mais recente e roda o `install-standalone.ps1`     |
| `POST /api/autosync/repositorios`            | `{ caminho, tipo: 'repo' \| 'root' }`                      | Põe no autosync (`add`, `include` ou religa o alvo desligado)                     |
| `DELETE /api/autosync/repositorios`          | `{ caminho }`                                              | Tira do autosync (`remove` no alvo próprio, `exclude` na raiz)                    |
| `POST /api/autosync/repositorios/lote`       | `{ origem: 'clientes' }`                                   | Adiciona um a um os repositórios de clientes que estão fora                       |
| `POST /api/autosync/repositorios/excluir`    | `{ caminho }`                                              | `exclude` de um repositório de pasta-raiz                                         |
| `POST /api/autosync/repositorios/incluir`    | `{ caminho }`                                              | `include` de um repositório de pasta-raiz                                         |
| `PUT /api/autosync/agendamento`              | `{ horarios: ['HH:MM'] }`, de 1 a 6, sem repetir           | `set-schedule`, que reinstala a tarefa                                            |
| `POST /api/autosync/agendamento/instalar`    |                                                            | `install`                                                                         |
| `POST /api/autosync/agendamento/desinstalar` |                                                            | `uninstall` (desliga também a bandeja no login)                                   |
| `PUT /api/autosync/bandeja`                  | `{ ligada }`                                               | `enable-tray` / `disable-tray`                                                    |
| `PUT /api/autosync/ia`                       | `{ ligada, agente?: auto \| claude \| codex \| opencode }` | `set-ai` e `set-agent`                                                            |
| `PUT /api/autosync/politica`                 | `{ caminho, include?, exclude?, ramos?, maxBytes?, ia? }`  | `set-policy`; devolve a política gravada                                          |
| `GET /api/autosync/previa`                   | `?caminho=`                                                | `{ caminho, mensagem }` ou `{ semAlteracoes: true }`                              |
| `POST /api/autosync/commit`                  | `{ caminho, mensagem? }`                                   | Commit sem push                                                                   |
| `POST /api/autosync/push`                    | `{ caminho }`                                              | Push do que já foi commitado                                                      |
| `POST /api/autosync/sincronizar`             | `{ caminho?, mensagem? }`                                  | Commit e push; sem `caminho`, `sync --all`                                        |
| `POST /api/autosync/merge-request`           | `{ caminho, titulo?, destino?, origem? }`                  | Merge Request no GitLab                                                           |
| `POST /api/autosync/terminal`                | `{ caminho }`                                              | `204` — terminal aberto na pasta, com o Script padrão; nenhum comando é rodado    |
| `GET /api/autosync/historico`                | `?caminho=&limite=20`                                      | `{ commits }`                                                                     |
| `GET /api/autosync/log`                      | `?limite=200`                                              | `{ linhas }` do `autosync.log`                                                    |
| `GET /api/autosync/diagnostico`              | `?rede=true`                                               | Saída do `doctor`                                                                 |
| `GET /api/autosync/gitlab`                   |                                                            | `{ host, tokenDefinido }` — o token nunca volta                                   |
| `PUT /api/autosync/gitlab`                   | `{ host, token? }`                                         | Grava host e token nas variáveis do usuário; sem `token`, mantém o gravado        |
| `DELETE /api/autosync/gitlab`                |                                                            | Apaga o token e mantém o host; devolve `{ host, tokenDefinido }`                  |

`caminho` precisa ser absoluto, com até 400 caracteres, e já conhecido: estar no
autosync ou no cadastro de um cliente (para `tipo: 'root'`, vale também a pasta-mãe de
um repositório de cliente). Respostas de ação trazem `{ saida }` com o texto do CLI.
Códigos: `400` entrada inválida, `404` pasta inexistente, `409` pacote do autosync
indisponível (sem Release, Release sem os executáveis, fora do Windows) ou Git ausente
na instalação (`gitAusente: true`, `urlDoGit`), `502` o CLI rodou e falhou (a mensagem é a saída dele, e
`sugestoes` traz, para cada erro reconhecido, `{ explicacao, comandos, acao? }`),
`503` autosync não instalado (`naoInstalado: true`) ou, no `terminal`, nenhum
terminal abriu.

As rotas de `gitlab` gravam `GIT_AUTOSYNC_GITLAB_HOST` e `GIT_AUTOSYNC_GITLAB_TOKEN`
nas variáveis de ambiente do usuário do Windows, de onde o Git AutoSync as lê. O
`host` vai sem protocolo nem caminho (`gitlab.empresa.com.br`, com porta opcional), e
o `token` tem até 500 caracteres, sem espaço. `PUT` sem token, e sem nenhum gravado,
responde `400`. Fora do Windows, a gravação responde `400` pedindo para definir as
duas variáveis no perfil do shell.

## Kanban dos projetos

Cada projeto do cliente tem quantos kanbans precisar. Um kanban nasce de um documento
de escopo (`.docx`, `.pdf`, `.md` ou `.txt`, até 20 MB, em base64 no JSON), que o
assistente de IA de **Configurações** decompõe em tarefas, ou vazio, para as tarefas
serem lançadas à mão. Os dados ficam no `sankhya.db`; o documento original, em
`kanbans/<cliente>/` na pasta de dados.

| Método e rota                                         | Corpo / query                                         | O que faz                                                               |
| ----------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/clientes/:id/kanbans`                       |                                                       | `{ demandas, tarefas }` de todos os projetos do cliente, e as órfãs     |
| `POST /api/clientes/:id/kanbans`                      | `{ projetoId, nome?, pasta?, documento?, analisar? }` | `201` — kanban criado; com `analisar`, a análise já começa              |
| `PUT /api/kanban/demandas/:idDemanda`                 | `{ nome?, projetoId?, pasta? }`                       | Renomeia, troca a pasta ou vincula a outro projeto do cliente           |
| `DELETE /api/kanban/demandas/:idDemanda`              |                                                       | `204` — apaga o kanban com as tarefas, o histórico e o documento        |
| `PUT /api/kanban/demandas/:idDemanda/documento`       | `{ nome, conteudoBase64, analisar? }`                 | Anexa ou troca o documento; as tarefas ficam                            |
| `DELETE /api/kanban/demandas/:idDemanda/documento`    |                                                       | Tira o documento e mantém o quadro                                      |
| `GET /api/kanban/demandas/:idDemanda/documento`       | `?baixar=1` força o download                          | O original, com `nosniff` e `no-store`; texto sai como `text/plain`     |
| `GET /api/kanban/demandas/:idDemanda/documento/texto` |                                                       | `{ nome, tipo, texto }` extraído (vazio no PDF digitalizado)            |
| `POST /api/kanban/demandas/:idDemanda/analisar`       |                                                       | `202` — análise em segundo plano; a tela acompanha a `situacao`         |
| `POST /api/kanban/demandas/:idDemanda/tarefas`        | `{ titulo, descricao?, grupo?, tipo?, estado?, ... }` | `201` — tarefa criada, no `estado` pedido (padrão `backlog`)            |
| `PUT /api/kanban/tarefas/:idTarefa`                   | os mesmos campos, todos opcionais                     | Tarefa atualizada                                                       |
| `POST /api/kanban/tarefas/:idTarefa/mover`            | `{ estado, indice? }`                                 | Leva para a coluna, na posição `indice` (ausente, vai para o fim)       |
| `DELETE /api/kanban/tarefas/:idTarefa`                |                                                       | `204` — tarefa excluída                                                 |
| `GET /api/kanban/fluxo`                               | SSE                                                   | `event: kanban` com `{ demandaId, clienteId, removida }` a cada mudança |
| `GET /api/kanban/transicoes`                          | `?clienteId=&desde=`                                  | `{ transicoes }`: histórico de colunas, em ordem cronológica            |

`nome` ausente vale o nome do arquivo sem extensão ou, sem documento, o do projeto.
`pasta` é onde o arquivo JSON das tarefas será criado; vazia, fica para depois, e
informada precisa ser um caminho absoluto que já existe. `documento` é
`{ nome, conteudoBase64 }`; o `.doc` do Word antigo é recusado. A tarefa tem ainda
`estimativaHoras`, `prioridade` (`alta`, `media` ou `baixa`), `criteriosDeAceite` e
`notas`; `tipo` é `backend`, `frontend`, `dados`, `relatorio`, `bi`, `integracao`,
`configuracao`, `teste`, `documentacao` ou `outro`, e valor desconhecido vira `outro`.

A tarefa aceita também `checklist`, a lista de verificação: até 50 itens
`{ texto, feito }`, com até 300 caracteres no texto; itens sem texto são descartados.
O fluxo `/api/kanban/fluxo` avisa toda mudança num kanban — da tela, do MCP, do arquivo
de tarefas ou da análise da IA —, e é por ele que o painel relê o cliente aberto.

As colunas (`estado`) são `backlog`, `a_fazer`, `em_andamento`, `em_revisao` e
`concluido`. A `situacao` do kanban é `sem-documento`, `enviado`, `analisando`,
`analisado` ou `falhou` (com o motivo em `erro`). Reanalisar troca só as tarefas que
continuam no Backlog: o que já mudou de coluna fica. Durante a análise, analisar de
novo, trocar ou tirar o documento e excluir o kanban respondem `409`.

### Arquivo de tarefas e MCP

| Método e rota                               | Corpo / query                 | O que faz                                                         |
| ------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `PUT /api/kanban/demandas/:idDemanda/mcp`   | `{ ligado }`                  | Libera (ou tira) o kanban para agentes pelo servidor MCP          |
| `GET /api/mcp/configuracao`                 |                               | `{ nome, command, args, env, mcpServers }` para colar no agente   |
| `GET /api/mcp/kanbans`                      |                               | `{ estados, kanbans }` liberados, com cliente, projeto e contagem |
| `GET /api/mcp/kanbans/:id`                  |                               | Resumo do escopo e todas as tarefas do kanban liberado            |
| `GET /api/mcp/mudancas`                     | `?desde=` (ISO) `&kanbanId=`  | `{ agora, tarefas, transicoes }` alteradas depois do cursor       |
| `POST /api/mcp/tarefas/:id/mover`           | `{ estado, indice? }`         | Move a tarefa; aceita o código ou o rótulo da coluna              |
| `POST /api/mcp/tarefas/:id/lista`           | `{ texto, feito?, posicao? }` | `201` — item novo na lista de verificação (sem posição, no fim)   |
| `PUT /api/mcp/tarefas/:id/lista/:indice`    | `{ texto?, feito? }`          | Altera o texto, a marcação ou os dois                             |
| `DELETE /api/mcp/tarefas/:id/lista/:indice` |                               | Exclui o item; os seguintes sobem uma posição                     |
| `PUT /api/mcp/tarefas/:id/notas`            | `{ notas, acrescentar? }`     | Acrescenta às notas (ou substitui, com `acrescentar: false`)      |
| `POST /api/mcp/kanbans/:id/tarefas`         | `{ titulo, ... }`             | `201` — tarefa nova, sempre no Backlog                            |

Kanban não liberado, e tarefa dele, respondem `404` nas rotas `/api/mcp/*`: a trava é
do servidor, não do processo MCP. As rotas exigem o token do shell como as demais; o
servidor MCP (`src/mcp/servidorMcp.ts`) o lê do arquivo apontado em
`HUB_SNK_TOKEN_FILE` e o manda no cabeçalho `x-hub-token`.

`pasta` preenchida liga o arquivo de tarefas: o HUB SNK cria a subpasta `Tarefas` e
grava nela `<projeto>.json` (com o nome do kanban junto, se outro do mesmo projeto já
usa o nome). Nas respostas, o kanban traz `arquivo` com `{ caminho, sincronizadoEm,
importadoEm, mudancasImportadas, gitignore, erro }`.

## Integração com o Sankhya e com o aplicativo desktop

Estas rotas dependem do shell desktop (Electron): quem tem a sessão do Sankhya e o
cofre das credenciais é ele, e o backend fala com ele pela ponte local
`127.0.0.1:4103` (`src/sankhya/ponteDoDesktop.ts`). Com o backend rodando sozinho
(`npm run dev`, sem o aplicativo aberto), elas respondem
`503 { "mensagem": "...", "shellIndisponivel": true }`.

| Método   | Rota                                        | Resposta                                                                                                             |
| -------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/sankhya/shell`                        | `200` — `{ "disponivel": true }` quando o aplicativo desktop responde                                                |
| `GET`    | `/api/sankhya/credenciais`                  | `200` — estado das credenciais do ERP e da Experience, sem senha                                                     |
| `GET`    | `/api/sankhya/credenciais/:sistema/senha`   | `200` — `{ senha }` em claro, para a janela de credenciais mostrar                                                   |
| `POST`   | `/api/sankhya/credenciais/:sistema`         | `200` — credencial gravada no cofre do aplicativo (`{ usuario, senha }`)                                             |
| `DELETE` | `/api/sankhya/credenciais/:sistema`         | `200` — credencial removida                                                                                          |
| `POST`   | `/api/sankhya/navegador/abrir/:sistema`     | `200` — a guia do sistema passa a ser a guia ativa do aplicativo                                                     |
| `POST`   | `/api/sankhya/navegador/capturar/:sistema`  | `200` — sessão da guia guardada no cofre; `409` quando a guia não está logada                                        |
| `POST`   | `/api/sankhya/navegador/autologin/:sistema` | `200` — loga na guia com a credencial do cofre e captura a sessão; `409` quando não consegue                         |
| `GET`    | `/api/agenda/estado`                        | `200` — quantos recursos e eventos há no snapshot e quando foi importado                                             |
| `GET`    | `/api/agenda/eventos?de=&ate=`              | `200` — `{ eventos }` do snapshot no período, de todos os parceiros                                                  |
| `GET`    | `/api/clientes/:id/agenda-eventos?de=&ate=` | `200` — `{ eventos }` do snapshot no período, só dos parceiros do cliente                                            |
| `POST`   | `/api/agenda/consultar`                     | `200` — consulta a Agenda de Recursos do usuário (`{ de, ate }`), mês a mês, e importa; `400` sem CODUSU configurado |
| `GET`    | `/api/agenda/situacao-do-dia?codparc=&dia=` | `200` — sem tarefa, tarefa aberta ou OS lançada na Experience naquele dia                                            |
| `POST`   | `/api/os/consultar`                         | `200` — `{ itens, buscadoEm }`, as OS do usuário no período (`{ de, ate }`), em todos os projetos                    |
| `POST`   | `/api/clientes/:id/os-consultar`            | `200` — as mesmas OS, só as das empresas do cliente                                                                  |

`:sistema` é `sankhya-erp` ou `sankhya-experience`; outro valor responde `404`.
Datas vão sempre no formato `YYYY-MM-DD`, e fora dele a resposta é `400`.

As rotas de eventos leem só o snapshot gravado pelo `consultar` e respondem mesmo
sem o aplicativo aberto. Na versão por cliente, e também na das OS, o cliente
é casado com o Sankhya pelo nome: o do cadastro e os `nomesCompletos`, sem
vínculo por CODPARC. Nas OS, com `nomesCompletos` preenchido vale só a lista. Na
agenda, sem nenhum parceiro casado, a resposta é
`{ "eventos": [], "semParceiroCasado": true }`.

As OS são consultadas ao vivo na Experience, sem nada gravado, com o
`experiencePersonId` descoberto na captura da sessão. Sem ele, a resposta é
`400` com `codigoDeUsuarioAusente: true`. Sessão da Experience vencida, aqui e
nas rotas da agenda, responde `409` com `sessaoExpirada: true`. O `consultar` da
agenda também responde `502` quando o Sankhya devolve algo fora do formato
esperado.

### Rotas que só o aplicativo desktop chama

Estas exigem o token no cabeçalho `x-hub-token` — o cookie do painel não basta.
A tela não tem acesso ao valor, então nem o próprio painel consegue chamá-las.
Sem o arquivo, a resposta é `503`; com o token errado, `401`.

| Método   | Rota                                             | Resposta                                                                           |
| -------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `GET`    | `/api/healthz`                                   | `200` — `{ "ok": true }`. Não exige token: é a sonda de vida do shell              |
| `POST`   | `/api/sistema/encerrar`                          | `202` — fecha as conexões e o SQLite e encerra o processo                          |
| `POST`   | `/api/sankhya/desktop/sessao/sankhya-experience` | `200` — guarda em memória o JWT da guia Experience (`{ usuario, token, expira? }`) |
| `DELETE` | `/api/sankhya/desktop/sessao/sankhya-experience` | `200` — esquece a sessão (logout na guia)                                          |
| `POST`   | `/api/clientes/:id/bases/:idBase/senha`          | `200` — `{ "senha": "..." }`, para o login automático da guia daquela base         |

## Aviso de versão nova

`GET /api/sistema/atualizacao` consulta a última release do repositório na API
pública do GitHub e compara a tag com a versão do `package.json`:

```json
{
  "versaoInstalada": "1.0.0",
  "ultimaVersao": "v1.1.0",
  "atualizacaoDisponivel": true,
  "url": "https://github.com/CarlosSimao/hub-snk/releases/tag/v1.1.0"
}
```

Fica separada de `/api/sistema/versao` porque depende da rede: a versão em uso é
leitura local e instantânea, e o rodapé não deve esperar o GitHub para exibi-la.

Sem internet, sem release publicada ou com a resposta fora do formato esperado,
`ultimaVersao` e `url` vêm nulas e `atualizacaoDisponivel` é `false` — nunca um
erro. A comparação é estrita e ignora pré-lançamento: versão local à frente da
publicada (quem desenvolve) e tags como `v1.1.0-beta.1` não geram aviso.

A resposta do GitHub fica em cache por seis horas, e uma falha por quinze
minutos. A API anônima permite 60 requisições por hora por IP, e sem cache a
consulta sairia a cada abertura da tela.

## Corpos

Cliente:

```json
{ "nome": "Indústria Alfa" }
```

Base:

```json
{
  "url": "https://erp.alfa.com.br:8180/mge",
  "tipo": "producao",
  "usuario": "admin",
  "senha": "..."
}
```

Banco de dados:

```json
{
  "sgbd": "oracle",
  "identificadorOracle": "service-name",
  "host": "192.168.0.10",
  "porta": 1521,
  "nomeDoServico": "ORCL",
  "usuario": "system",
  "senha": "..."
}
```

`sgbd` aceita `oracle` ou `sqlserver`; `identificadorOracle` aceita
`service-name` ou `sid` e só tem efeito no Oracle. Os dois são opcionais e,
ausentes, valem `oracle` e `service-name`. `nomeDoServico` guarda o service name
ou o SID no Oracle e o nome do database no SQL Server.

Cada base tem no máximo um banco, por isso o `PUT` faz as duas coisas: vincula
quando não existe e substitui quando existe. `porta` aceita número ou texto
numérico e precisa ficar entre 1 e 65535. O `DELETE` é idempotente — desvincular
uma base que já está sem banco também responde `204`.

Repositório:

```json
{
  "url": "https://github.com/grupo/projeto",
  "caminhoLocal": "C:\\Workspace\\projeto"
}
```

`caminhoLocal` é obrigatório e precisa ser um caminho absoluto. Não exige que a
pasta exista no momento do cadastro — o repositório pode ainda não ter sido
clonado. A ausência da pasta só aparece ao tentar abri-la.

Configuração do MCP, a mesma nos repositórios de cliente e nas bases locais:

```json
{
  "SANKHYA_DB_HOST": "192.168.0.10",
  "SANKHYA_DB_PORT": 1521,
  "SANKHYA_DB_SERVICE_NAME": "ORCL",
  "SANKHYA_DB_USER": "system",
  "SANKHYA_DB_PASSWORD": "..."
}
```

Todas as chaves são obrigatórias. O arquivo é regravado inteiro, e qualquer
outra linha que já estivesse nele é mantida no fim. O mesmo objeto vai em `mcp`
no `PUT /api/configuracao`, obrigatório quando `caminhoDoSchemaMcp` não está em
branco; ali o `.env` é gravado antes da configuração, e pasta inexistente
responde `404` sem salvar nada.

Nomes completos do cliente:

```json
{ "nomesCompletos": ["Indústria Alfa Ltda", "Alfa Indústria e Comércio S.A."] }
```

São as razões sociais do cliente no Sankhya, e o único vínculo dele com a
agenda e as OS. Vale até 20 nomes, e `[]` apaga a lista.

Projeto:

```json
{ "nome": "Implantação do WMS" }
```

Projetos agrupam anotações e links próprios. As anotações seguem o corpo das do
cliente (`{ anotacoes }`, até 5000 caracteres), e os links, o do link do cliente
(`{ nome, url }`).

`tipo` aceita apenas `producao`, `teste` ou `outro`. Toda `url` precisa ser
`http` ou `https` válida — endereços SSH (`git@host:grupo/projeto.git`) são
recusados. A `senha` não é aparada: espaço nas pontas pode fazer parte dela.

Importação de cadastros:

```json
{
  "clientes": [
    {
      "nome": "Indústria Alfa",
      "bases": [
        {
          "url": "https://erp.alfa.com.br:8180/mge",
          "tipo": "producao",
          "usuario": "admin",
          "senha": "...",
          "bancoDeDados": {
            "sgbd": "oracle",
            "identificadorOracle": "service-name",
            "host": "192.168.0.10",
            "porta": 1521,
            "nomeDoServico": "ORCL",
            "usuario": "system",
            "senha": "..."
          },
          "substituir": false
        }
      ]
    }
  ]
}
```

O cliente é resolvido pelo nome: cadastro existente é reaproveitado, nome inédito
vira cliente novo. `bases` pode ser vazio — o arquivo carrega o cliente mesmo sem
base exportada. Dentro do cliente, a URL identifica a base: URL inédita entra e
URL já cadastrada só muda com `substituir: true`.

A substituição sobrescreve apenas o que o corpo trouxe. `bancoDeDados` ausente e o
par `usuario`/`senha` inteiro em branco preservam o que já estava gravado, porque
o arquivo de exportação omite o que não foi marcado na tela, e campo não exportado
não é campo apagado. A resposta traz a contagem do que aconteceu:

```json
{ "clientesCriados": 1, "basesCriadas": 2, "basesSubstituidas": 1, "basesIgnoradas": 3 }
```

O lote é tudo ou nada, como as outras importações, e vale até 300 clientes e 600
bases por chamada.

### Lembrete

```json
{
  "resumo": "Relatório de horas",
  "texto": "Enviar o relatório de horas",
  "tipo": "recorrente",
  "dataHora": "",
  "expressaoCron": "0 17 * * 5",
  "clienteId": "4fb3993a-f8b3-4e9a-be7d-c79556fa78e5",
  "projetoId": null,
  "enviarEmail": true,
  "contatoIds": ["0d6f3c2e-8a41-4b7e-9c55-1e2f3a4b5c6d"],
  "ativo": true
}
```

`resumo` (até 120 caracteres) e `texto` (até 1000) são obrigatórios. `tipo` é
`unico` ou `recorrente`. O `unico` exige `dataHora` em ISO 8601 **com fuso** —
`2026-10-01T12:00:00.000Z` ou `2026-10-01T09:00:00-03:00`; data sem fuso
(`2026-10-01T09:00`) responde `400` com "Data e hora inválidas.". O `recorrente`
exige `expressaoCron`, cinco campos. `projetoId` exige `clienteId`, e o projeto
precisa ser daquele cliente. `contatoIds` são os contatos em cópia no e-mail do
lembrete: com `enviarEmail`, cada um precisa existir, ter e-mail e, com
`clienteId` preenchido, ser sem cliente ou daquele cliente — senão, `400`.
Ausentes, `contatoIds` vale `[]`, `enviarEmail` vale `false` e `ativo`, `true`.

### Contato

```json
{
  "nome": "Ana Souza",
  "cargo": "Coordenadora de TI",
  "telefone": "(11) 99999-0000",
  "email": "ana@cliente.com.br",
  "clienteId": "4fb3993a-f8b3-4e9a-be7d-c79556fa78e5"
}
```

Só o `nome` é obrigatório (até 120 caracteres); `cargo` vai até 120, `telefone`
até 40 e `email`, quando preenchido, precisa ser um endereço válido. `clienteId` é
opcional — `null` é o contato sem cliente — e precisa existir no cadastro. Os
dois erros respondem `400`.

### SMTP

`smtp` e `alertaDaAgenda` vão no mesmo `PUT /api/configuracao` do resto da
configuração. Ausentes, o que está gravado é preservado.

```json
{
  "smtp": {
    "host": "smtp.office365.com",
    "porta": 587,
    "seguranca": "starttls",
    "usuario": "voce@empresa.com.br",
    "senha": "...",
    "remetente": "voce@empresa.com.br",
    "destinatario": "voce@empresa.com.br"
  },
  "alertaDaAgenda": { "ativo": true, "toleranciaMinutos": 30, "enviarEmail": true }
}
```

`seguranca` é `ssl`, `starttls` ou `nenhuma`.

### Assistente de IA

Também no `PUT /api/configuracao`, e preservado quando ausente:

```json
{ "assistenteDeIa": { "assistente": "claude", "modelo": "sonnet", "raciocinio": "high" } }
```

`assistente` é `auto` (o primeiro instalado), `claude`, `codex`, `opencode`, `gemini`
ou `cursor`. `modelo` vazio usa o padrão do assistente, e é ignorado no `auto`.
`raciocinio` é o nível de raciocínio do modelo — vai no `--effort` do Claude Code, no
`model_reasoning_effort` do Codex e no `--variant` do OpenCode; o Gemini CLI e o
Cursor não têm a opção. Vazio usa o padrão do modelo. Os níveis de cada modelo saem de
`GET /api/configuracao/assistentes-de-ia`, em `raciocinio` (`{ modelo: { niveis,
padrao } }`; a chave vazia é o modelo padrão do assistente).

### Nome, empresa, time e e-mail do usuário

Também no `PUT /api/configuracao`, e preservados quando ausentes:

```json
{
  "nomeDoUsuario": "Ana Souza",
  "empresaDoUsuario": "Acme",
  "timeDoUsuario": "Suporte",
  "emailDoUsuario": "ana@acme.com"
}
```

Cada um vai até 120 caracteres (acima disso, `400`); o e-mail, se preenchido, precisa ser válido. Vazios são aceitos aqui, mas o
`POST /api/suporte/relatos` responde `400` — `Preencha em Configurações antes de enviar:
Nome do usuário, Empresa, Time, E-mail.`, com só os que faltam — enquanto algum dos quatro
estiver vazio. Os valores seguem no `context` do relato (`usuario`, `empresa`, `time`, `email`) e
aparecem em `GET /api/suporte/previa`.

## Erros

Erros retornam `{ "mensagem": "..." }` com `400` (dados inválidos), `403`
(origem recusada), `404` (cadastro, pasta ou arquivo inexistente), `409`
(conflito), `502` (resposta inválida do Sankhya ou falha do SMTP) ou `503`
(recurso indisponível). O `503` também sai quando o aplicativo desktop não
responde — com `shellIndisponivel: true` — e cobre as rotas que
abrem programa da máquina — gerenciador de arquivos, terminal, IDE, seletor
de arquivo e de pasta, atalho, WildFly e Docker — quando o programa não existe ou não chega a
subir; a mensagem diz o que instalar. São
conflito o nome de cliente repetido, o par URL + usuário repetido nas bases do
mesmo cliente, a URL de repositório repetida no mesmo cliente, o nome de projeto
repetido no mesmo cliente e a URL de link repetida no mesmo cliente ou no mesmo
projeto. Nas bases, a
mesma URL pode aparecer várias vezes desde que o usuário mude — assim dá para
cadastrar um acesso de administração e outro de consulta na mesma base. Todas as
comparações ignoram maiúsculas e espaços nas pontas.
