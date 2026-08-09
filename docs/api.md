# API HTTP

Referência das rotas do HUB SNK. Para instalar e usar, veja o
[README](../README.md).

Base: `http://127.0.0.1:4100`

Toda requisição passa antes pela conferência de origem descrita em
[SECURITY.md](../SECURITY.md#o-que-protege-a-api): chamada vinda de outra origem
recebe `403` sem chegar às rotas.

## Rotas

| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/api/clientes` | `200` — lista ordenada por nome, com as bases |
| `POST` | `/api/clientes` | `201` — cliente criado |
| `PUT` | `/api/clientes/:id` | `200` — cliente atualizado |
| `GET` | `/api/clientes/:id` | `200` — um cliente, com a situação do MCP de cada repositório |
| `PUT` | `/api/clientes/:id/anotacoes` | `200` — cliente com as anotações gravadas |
| `DELETE` | `/api/clientes/:id` | `204` — sem conteúdo |
| `POST` | `/api/clientes/:id/bases` | `201` — base criada |
| `PUT` | `/api/clientes/:id/bases/:idBase` | `200` — base atualizada |
| `DELETE` | `/api/clientes/:id/bases/:idBase` | `204` — sem conteúdo |
| `PUT` | `/api/clientes/:id/bases/:idBase/banco` | `200` — banco vinculado ou substituído |
| `DELETE` | `/api/clientes/:id/bases/:idBase/banco` | `204` — banco desvinculado |
| `POST` | `/api/clientes/:id/repositorios` | `201` — repositório criado |
| `PUT` | `/api/clientes/:id/repositorios/:idRepositorio` | `200` — repositório atualizado |
| `DELETE` | `/api/clientes/:id/repositorios/:idRepositorio` | `204` — sem conteúdo |
| `POST` | `/api/clientes/:id/repositorios/:idRepositorio/abrir-pasta` | `204` — pasta aberta no gerenciador de arquivos |
| `POST` | `/api/clientes/:id/repositorios/:idRepositorio/abrir-shell` | `204` — terminal aberto na pasta |
| `POST` | `/api/clientes/:id/repositorios/:idRepositorio/abrir-intellij` | `204` — pasta aberta como projeto no IntelliJ |
| `GET` | `/api/clientes/:id/repositorios/:idRepositorio/mcp` | `200` — conteúdo do `.sankhya-mcp.env` |
| `PUT` | `/api/clientes/:id/repositorios/:idRepositorio/mcp` | `204` — arquivo criado ou sobrescrito |
| `POST` | `/api/clientes/:id/links` | `201` — link criado |
| `PUT` | `/api/clientes/:id/links/:idLink` | `200` — link atualizado |
| `DELETE` | `/api/clientes/:id/links/:idLink` | `204` — sem conteúdo |
| `GET` | `/api/situacao-git?forcar=true` | `200` — situação Git dos repositórios com pasta local, indexada pelo id |
| `GET` | `/api/configuracao` | `200` — configuração global |
| `PUT` | `/api/configuracao` | `200` — configuração salva |
| `POST` | `/api/atalhos/selecionar-executavel` | `200` — caminho escolhido; `204` quando cancelado |
| `POST` | `/api/atalhos/:id/abrir` | `204` — programa do atalho iniciado |
| `GET` | `/api/sistema/versao` | `200` — `{ "versao": "1.0.0" }`, a mesma exibida no rodapé |

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

## Erros

Erros retornam `{ "mensagem": "..." }` com `400` (dados inválidos), `403`
(origem recusada), `404` (cliente ou base inexistente) ou `409` (conflito). São
conflito o nome de cliente repetido, o par URL + usuário repetido nas bases do
mesmo cliente e a URL de repositório repetida no mesmo cliente. Nas bases, a
mesma URL pode aparecer várias vezes desde que o usuário mude — assim dá para
cadastrar um acesso de administração e outro de consulta na mesma base. Todas as
comparações ignoram maiúsculas e espaços nas pontas.
