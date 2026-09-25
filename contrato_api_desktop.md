# Integracao da API com o aplicativo desktop

Este arquivo e o contrato tecnico que deve acompanhar a implementacao do aplicativo desktop. Ele descreve como configurar o envio de usuarios, ordens de servico, progresso e apontamentos de horas.

## 1. Configuracao

Configure os valores abaixo por instalacao do aplicativo:

```text
API_URL={API_BASE_URL}/public/serverFunction/60689/15/execute
INSTALLATION_ID={IDENTIFICADOR_DA_INSTALACAO}
API_KEY={CHAVE_SECRETA_DA_INSTALACAO}
API_VERSION=1
```

- Metodo HTTP: `POST`
- Header: `Content-Type: application/json`
- Autenticacao: campos `installationId` e `key` no corpo JSON
- Limite por requisicao: de 1 a 200 eventos
- Datas: ISO 8601, preferencialmente em UTC, por exemplo `2026-09-24T12:00:00.000Z`
- Uma instalacao nao pode usar a credencial de outra instalacao.
- `API_KEY` e segredo. Nao grave em log, banco sem criptografia, repositorio ou codigo-fonte.

O administrador fornece `INSTALLATION_ID` e `API_KEY`. A chave e exibida somente no momento da criacao. Caso seja perdida, a instalacao deve receber uma nova credencial.

## 2. Requisicao

O corpo da requisicao deve ser enviado diretamente, sem wrappers adicionais:

```json
{
  "version": 1,
  "installationId": "SEU_INSTALLATION_ID",
  "key": "SUA_API_KEY",
  "events": [
    {
      "id": "usuario-42-v1",
      "type": "usuario.upsert",
      "occurredAt": "2026-09-24T12:00:00.000Z",
      "data": {
        "externalId": "usuario-42",
        "name": "Ana Souza",
        "email": "ana@empresa.com",
        "active": true
      }
    }
  ]
}
```

### Campos do envelope

| Campo | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `version` | numero | sim | Deve ser `1` |
| `installationId` | string | sim | UUID fornecido ao criar a instalacao |
| `key` | string | sim | Chave secreta iniciada por `dsk_` |
| `events` | array | sim | Entre 1 e 200 eventos |

### Campos comuns de evento

| Campo | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `id` | string | sim | Identificador unico do evento dentro da instalacao, ate 120 caracteres |
| `type` | string | sim | Um dos quatro tipos documentados abaixo |
| `occurredAt` | string | sim | Data e hora em ISO 8601, ate 35 caracteres |
| `data` | objeto | sim | Conteudo conforme o tipo do evento |

O campo `id` implementa idempotencia. Ao reenviar o mesmo evento com o mesmo `id`, a API responde `duplicate` e nao duplica os dados.

Caracteres aceitos em identificadores: letras, numeros, `.`, `_`, `:`, `@`, `/` e `-`.

## 3. Tipos de evento

### 3.1. `usuario.upsert`

Cria ou atualiza um usuario originado no aplicativo desktop.

```json
{
  "id": "usuario-42-v1",
  "type": "usuario.upsert",
  "occurredAt": "2026-09-24T12:00:00.000Z",
  "data": {
    "externalId": "usuario-42",
    "name": "Ana Souza",
    "email": "ana@empresa.com",
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel do usuario no desktop, ate 120 caracteres |
| `name` | string | sim | Nome, de 1 a 180 caracteres |
| `email` | string | nao | Ate 254 caracteres |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para inativar |

### 3.2. `os.upsert`

Cria ou atualiza uma ordem de servico. O usuario indicado em `userExternalId` precisa existir na mesma instalacao.

```json
{
  "id": "os-1007-v3",
  "type": "os.upsert",
  "occurredAt": "2026-09-24T12:01:00.000Z",
  "data": {
    "externalId": "os-1007",
    "userExternalId": "usuario-42",
    "code": "OS-1007",
    "title": "Ajustar rotina de faturamento",
    "description": "Correcao da validacao fiscal",
    "status": "EM_ANDAMENTO",
    "priority": "ALTA",
    "progress": 45,
    "dueAt": "2026-09-30T18:00:00.000Z",
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel da OS no desktop, ate 120 caracteres |
| `userExternalId` | string | sim | `externalId` de um usuario ja enviado |
| `code` | string | sim | Codigo visivel da OS, ate 120 caracteres |
| `title` | string | sim | Titulo, ate 240 caracteres |
| `description` | string | nao | Ate 5.000 caracteres |
| `status` | string | sim | Status usado nas colunas do Kanban, ate 80 caracteres |
| `priority` | string | nao | Ate 40 caracteres |
| `progress` | numero | sim | De `0` a `100`, aceita casas decimais |
| `dueAt` | string | nao | Prazo em ISO 8601 |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para inativar |

### 3.3. `os.progresso`

Registra o historico de progresso e atualiza o progresso e o status atuais da OS. A OS precisa existir na mesma instalacao.

```json
{
  "id": "os-1007-progresso-70",
  "type": "os.progresso",
  "occurredAt": "2026-09-24T15:30:00.000Z",
  "data": {
    "osExternalId": "os-1007",
    "progress": 70,
    "status": "EM_ANDAMENTO"
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `osExternalId` | string | sim | `externalId` de uma OS ja enviada |
| `progress` | numero | sim | De `0` a `100`, aceita casas decimais |
| `status` | string | sim | Ate 80 caracteres |

### 3.4. `horas.apontar`

Cria ou atualiza um apontamento de horas. A OS e o usuario precisam existir na mesma instalacao.

```json
{
  "id": "apontamento-9001-v1",
  "type": "horas.apontar",
  "occurredAt": "2026-09-24T14:30:00.000Z",
  "data": {
    "externalId": "apontamento-9001",
    "osExternalId": "os-1007",
    "userExternalId": "usuario-42",
    "minutes": 90,
    "description": "Correcao e testes",
    "startedAt": "2026-09-24T13:00:00.000Z",
    "endedAt": "2026-09-24T14:30:00.000Z"
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel do apontamento, ate 120 caracteres |
| `osExternalId` | string | sim | `externalId` de uma OS ja enviada |
| `userExternalId` | string | sim | `externalId` de um usuario ja enviado |
| `minutes` | inteiro | sim | De `1` a `10080` |
| `description` | string | nao | Ate 500 caracteres |
| `startedAt` | string | nao | Inicio em ISO 8601 |
| `endedAt` | string | nao | Fim em ISO 8601 |

## 4. Ordem dos eventos

Os eventos sao processados na ordem do array. Em uma primeira sincronizacao, use esta ordem:

1. `usuario.upsert`
2. `os.upsert`
3. `os.progresso`
4. `horas.apontar`

O usuario pode estar no mesmo lote da OS desde que apareca antes dela. A OS pode estar no mesmo lote do progresso ou apontamento desde que apareca antes deles.

## 5. Exemplo de lote completo

```json
{
  "version": 1,
  "installationId": "SEU_INSTALLATION_ID",
  "key": "SUA_API_KEY",
  "events": [
    {
      "id": "usuario-42-v1",
      "type": "usuario.upsert",
      "occurredAt": "2026-09-24T12:00:00.000Z",
      "data": {
        "externalId": "usuario-42",
        "name": "Ana Souza",
        "email": "ana@empresa.com",
        "active": true
      }
    },
    {
      "id": "os-1007-v1",
      "type": "os.upsert",
      "occurredAt": "2026-09-24T12:01:00.000Z",
      "data": {
        "externalId": "os-1007",
        "userExternalId": "usuario-42",
        "code": "OS-1007",
        "title": "Ajustar rotina de faturamento",
        "description": "Correcao da validacao fiscal",
        "status": "EM_ANDAMENTO",
        "priority": "ALTA",
        "progress": 45,
        "dueAt": "2026-09-30T18:00:00.000Z",
        "active": true
      }
    },
    {
      "id": "os-1007-progresso-70",
      "type": "os.progresso",
      "occurredAt": "2026-09-24T15:30:00.000Z",
      "data": {
        "osExternalId": "os-1007",
        "progress": 70,
        "status": "EM_ANDAMENTO"
      }
    },
    {
      "id": "apontamento-9001-v1",
      "type": "horas.apontar",
      "occurredAt": "2026-09-24T14:30:00.000Z",
      "data": {
        "externalId": "apontamento-9001",
        "osExternalId": "os-1007",
        "userExternalId": "usuario-42",
        "minutes": 90,
        "description": "Correcao e testes",
        "startedAt": "2026-09-24T13:00:00.000Z",
        "endedAt": "2026-09-24T14:30:00.000Z"
      }
    }
  ]
}
```

## 6. Resposta e desserializacao

O endpoint publico retorna um envelope de execucao. O campo `output` pode ser um objeto ou uma string JSON, conforme a biblioteca HTTP utilizada:

```json
{
  "executionId": "identificador-da-execucao",
  "status": "COMPLETED",
  "output": "{\"logId\":\"identificador-do-lote\",\"accepted\":3,\"failed\":0,\"duplicate\":1,\"results\":[{\"id\":\"usuario-42-v1\",\"status\":\"accepted\"}]}"
}
```

Apos desserializar `output`, o resultado segue este formato:

```json
{
  "logId": "identificador-do-lote",
  "accepted": 3,
  "failed": 0,
  "duplicate": 1,
  "results": [
    { "id": "usuario-42-v1", "status": "accepted" },
    { "id": "os-1007-v1", "status": "duplicate" },
    { "id": "evento-invalido", "status": "failed", "error": "mensagem de validacao" }
  ]
}
```

Status por evento:

| Status | Significado | Acao no desktop |
|---|---|---|
| `accepted` | Evento persistido | Remover da fila local |
| `duplicate` | Evento ja havia sido aceito | Remover da fila local |
| `failed` | Evento rejeitado | Corrigir a causa antes de reenviar |

Se o envelope retornar `status: "FAILED"`, considere o lote nao confirmado e registre a mensagem de erro sem registrar a chave secreta.

## 7. Idempotencia e reenvio

- Gere um `event.id` deterministico e estavel para cada mudanca.
- Nao gere um novo `event.id` ao repetir uma tentativa de envio.
- Mantenha os eventos em fila ate receber `accepted` ou `duplicate`.
- Reenvie somente em falha de rede, timeout ou indisponibilidade temporaria.
- Nao faca retry automatico de evento com status `failed`; corrija o payload primeiro.
- Use espera progressiva entre tentativas, por exemplo 5 s, 15 s, 30 s e 60 s.
- Divida filas maiores que 200 eventos em lotes menores, preservando a ordem de dependencia.

Uma sugestao de ID e combinar entidade, identificador e versao da alteracao:

```text
usuario-{id}-v{versao}
os-{id}-v{versao}
os-{id}-progresso-{versao}
apontamento-{id}-v{versao}
```

## 8. Erros comuns

| Mensagem | Causa provavel | Correcao |
|---|---|---|
| `version deve ser 1` | Versao ausente ou diferente de 1 | Enviar `"version": 1` |
| `Instalacao ou chave invalida` | Credencial incorreta, revogada ou de outra instalacao | Revisar a configuracao ou solicitar nova chave |
| `events deve conter entre 1 e 200 itens` | Lote vazio ou grande demais | Enviar de 1 a 200 eventos |
| `OS nao persistida; envie o usuario primeiro` | Usuario referenciado ainda nao existe | Enviar `usuario.upsert` antes da OS |
| `Progresso nao persistido; OS inexistente` | OS referenciada ainda nao existe | Enviar `os.upsert` antes do progresso |
| `Apontamento nao persistido; OS ou usuario inexistente` | Dependencia ainda nao existe | Enviar usuario e OS antes do apontamento |
| `Tipo de evento nao suportado` | Valor de `type` desconhecido | Usar um dos quatro tipos deste contrato |

## 9. Checklist do aplicativo desktop

- Persistir `INSTALLATION_ID` e `API_KEY` em armazenamento protegido do sistema operacional.
- Enviar sempre por HTTPS.
- Implementar fila local duravel para tolerar falta de conexao.
- Preservar o mesmo `event.id` em reenvios.
- Enviar datas ISO 8601 em UTC.
- Respeitar o limite de 200 eventos por lote.
- Desserializar `output` quando ele chegar como string JSON.
- Remover da fila somente eventos `accepted` ou `duplicate`.
- Exibir ou registrar erros `failed` sem incluir a chave.
- Enviar usuario antes de OS e OS antes de progresso ou horas.

## 10. Teste inicial recomendado

1. Configure a URL, o identificador e a chave da instalacao.
2. Envie um lote contendo apenas um `usuario.upsert`.
3. Confirme `status: "COMPLETED"`, `accepted: 1` e `failed: 0`.
4. Reenvie exatamente o mesmo lote e confirme `duplicate: 1`.
5. Envie uma OS vinculada ao usuario e confirme `accepted: 1`.
6. So entao habilite o envio automatico e os lotes maiores.
