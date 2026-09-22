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
  Requisição sem `Origin` é aceita: navegação direta, a própria PWA carregando o
  shell e chamadas de linha de comando não mandam o cabeçalho, e o `Host` já foi
  conferido.

O que não passa recebe `403` e fica registrado no log do servidor.

Com `HUB_PERMITIR_REDE=1` e um `HUB_HOST` de rede, a conferência sai: não há
lista de endereços válidos a comparar quando o acesso é pelo IP ou pelo nome da
máquina, e manter a checagem seria teatro. O servidor registra um aviso no log ao
subir nesse modo.

## Rotas

| Método   | Rota                                                           | Resposta                                                                |
| -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `GET`    | `/api/clientes`                                                | `200` — lista ordenada por nome, com as bases                           |
| `POST`   | `/api/clientes`                                                | `201` — cliente criado                                                  |
| `PUT`    | `/api/clientes/:id`                                            | `200` — cliente atualizado                                              |
| `GET`    | `/api/clientes/:id`                                            | `200` — um cliente, com a situação do MCP de cada repositório           |
| `PUT`    | `/api/clientes/:id/anotacoes`                                  | `200` — cliente com as anotações gravadas                               |
| `DELETE` | `/api/clientes/:id`                                            | `204` — sem conteúdo                                                    |
| `POST`   | `/api/clientes/importacao`                                     | `201` — bases criadas a partir dos favoritos do navegador               |
| `POST`   | `/api/clientes/importacao-de-repositorios`                     | `201` — repositórios criados a partir da varredura de pastas            |
| `POST`   | `/api/clientes/importacao-de-cadastros`                        | `201` — clientes e bases lidos de um arquivo de cadastros do HUB SNK    |
| `POST`   | `/api/clientes/:id/bases`                                      | `201` — base criada                                                     |
| `PUT`    | `/api/clientes/:id/bases/:idBase`                              | `200` — base atualizada                                                 |
| `DELETE` | `/api/clientes/:id/bases/:idBase`                              | `204` — sem conteúdo                                                    |
| `PUT`    | `/api/clientes/:id/bases/:idBase/banco`                        | `200` — banco vinculado ou substituído                                  |
| `DELETE` | `/api/clientes/:id/bases/:idBase/banco`                        | `204` — banco desvinculado                                              |
| `POST`   | `/api/clientes/:id/repositorios`                               | `201` — repositório criado                                              |
| `PUT`    | `/api/clientes/:id/repositorios/:idRepositorio`                | `200` — repositório atualizado                                          |
| `DELETE` | `/api/clientes/:id/repositorios/:idRepositorio`                | `204` — sem conteúdo                                                    |
| `POST`   | `/api/clientes/:id/repositorios/:idRepositorio/abrir-pasta`    | `204` — pasta aberta; `503` quando o gerenciador falta                  |
| `POST`   | `/api/clientes/:id/repositorios/:idRepositorio/abrir-shell`    | `204` — terminal aberto; `503` quando nenhum abre                       |
| `POST`   | `/api/clientes/:id/repositorios/:idRepositorio/abrir-intellij` | `204` — projeto aberto; `503` sem IntelliJ                              |
| `GET`    | `/api/clientes/:id/repositorios/:idRepositorio/mcp`            | `200` — conteúdo do `.sankhya-mcp.env`                                  |
| `PUT`    | `/api/clientes/:id/repositorios/:idRepositorio/mcp`            | `204` — arquivo criado ou sobrescrito                                   |
| `POST`   | `/api/clientes/:id/links`                                      | `201` — link criado                                                     |
| `PUT`    | `/api/clientes/:id/links/:idLink`                              | `200` — link atualizado                                                 |
| `DELETE` | `/api/clientes/:id/links/:idLink`                              | `204` — sem conteúdo                                                    |
| `GET`    | `/api/situacao-git?forcar=true`                                | `200` — situação Git dos repositórios com pasta local, indexada pelo id |
| `GET`    | `/api/configuracao`                                            | `200` — configuração global                                             |
| `PUT`    | `/api/configuracao`                                            | `200` — configuração salva                                              |
| `POST`   | `/api/atalhos/selecionar-executavel`                           | `200` — caminho escolhido; `204` quando cancelado                       |
| `POST`   | `/api/atalhos/:id/abrir`                                       | `204` — programa iniciado; `503` se ele não subir                       |
| `GET`    | `/api/sistema/versao`                                          | `200` — `{ "versao": "1.0.0" }`, a mesma exibida no rodapé              |
| `GET`    | `/api/sistema/atualizacao`                                     | `200` — comparação com a última release publicada no GitHub             |

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
  "host": "192.168.0.10",
  "porta": 1521,
  "nomeDoServico": "ORCL",
  "usuario": "system",
  "senha": "..."
}
```

Cada base tem no máximo um banco, por isso o `PUT` faz as duas coisas: vincula
quando não existe e substitui quando existe. `porta` aceita número ou texto
numérico e precisa ficar entre 1 e 65535. O `DELETE` é idempotente — desvincular
uma base que já está sem banco também responde `204`.

Repositório:

```json
{
  "nome": "Addon de faturamento",
  "url": "https://github.com/grupo/projeto",
  "caminhoLocal": "C:\\Workspace\\projeto"
}
```

`caminhoLocal` é opcional e, quando informado, precisa ser um caminho absoluto.
Não exige que a pasta exista no momento do cadastro — o repositório pode ainda
não ter sido clonado. A ausência da pasta só aparece ao tentar abri-la.

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

## Erros

Erros retornam `{ "mensagem": "..." }` com `400` (dados inválidos), `403`
(origem recusada), `404` (cliente ou base inexistente), `409` (conflito) ou
`503` (recurso do sistema operacional indisponível). O `503` cobre as rotas que
abrem programa da máquina — gerenciador de arquivos, terminal, IntelliJ, seletor
de arquivo e de pasta, atalho — quando o programa não existe ou não chega a
subir; a mensagem diz o que instalar. São
conflito o nome de cliente repetido, o par URL + usuário repetido nas bases do
mesmo cliente e a URL de repositório repetida no mesmo cliente. Nas bases, a
mesma URL pode aparecer várias vezes desde que o usuário mude — assim dá para
cadastrar um acesso de administração e outro de consulta na mesma base. Todas as
comparações ignoram maiúsculas e espaços nas pontas.
