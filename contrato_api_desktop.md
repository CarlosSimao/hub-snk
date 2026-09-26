# Integracao da API com o aplicativo desktop

Este arquivo e o contrato tecnico que deve acompanhar a implementacao do aplicativo desktop (Development Swich / DS). Ele descreve como configurar o envio de usuarios, clientes, ordens de servico, demandas, tarefas, planejamentos, agenda e apontamentos de horas.

## 1. Configuracao

Configure os valores abaixo por instalacao do aplicativo:

```text
API_URL=https://newmitra.mitrasheet.com:8080/public/serverFunction/60689/15/execute
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
- O mesmo endpoint recebe **todos** os tipos de evento deste contrato. Nao existe uma URL por tipo de evento.

O administrador fornece `INSTALLATION_ID` e `API_KEY` na tela de Administracao do painel. A chave e exibida somente no momento da criacao. Caso seja perdida, a instalacao deve receber uma nova credencial (isso nao invalida as demais instalacoes).

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
| `type` | string | sim | Um dos tipos documentados na secao 3 |
| `occurredAt` | string | sim | Data e hora em ISO 8601, ate 35 caracteres |
| `data` | objeto | sim | Conteudo conforme o tipo do evento |

O campo `id` implementa idempotencia. Ao reenviar o mesmo evento com o mesmo `id`, a API responde `duplicate` e nao duplica os dados.

Caracteres aceitos em identificadores (`externalId` e afins): letras, numeros, `.`, `_`, `:`, `@`, `/` e `-`.

Valores de status/categoria (`status`, `priority`, `kind` etc.) sao normalizados no servidor para maiusculas e `_` (acentos e espacos sao removidos automaticamente), mas envie ja no formato canonico para evitar ambiguidade.

## 3. Tipos de evento

Sao 10 tipos suportados hoje. Cada um cria ou atualiza a entidade correspondente. Eventos com dependencia (ex.: uma OS que referencia um usuario) exigem que a entidade referenciada ja tenha sido enviada antes, no mesmo lote ou em lote anterior.

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

### 3.2. `cliente.upsert`

Cria ou atualiza um cliente/projeto atendido pela consultoria. Alimenta os graficos de horas por cliente, demandas e agenda por cliente.

```json
{
  "id": "cliente-77-v1",
  "type": "cliente.upsert",
  "occurredAt": "2026-09-24T09:00:00.000Z",
  "data": {
    "externalId": "cliente-77",
    "name": "Industria Alfa",
    "projectExternalId": "projeto-alfa-erp",
    "erpPartnerCode": "PARC-0077",
    "dueAt": "2026-12-31T23:59:59.000Z",
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel do cliente no desktop, ate 120 caracteres |
| `name` | string | sim | Nome do cliente, ate 180 caracteres |
| `projectExternalId` | string | nao | ID do projeto associado, ate 120 caracteres |
| `erpPartnerCode` | string/numero | nao | Codigo do parceiro no ERP (ex.: CODPARC Sankhya). **Obrigatorio para clientes que terao eventos de `agenda.evento.upsert`**, pois a agenda localiza o cliente por este codigo |
| `dueAt` | string | nao | Prazo/vigencia em ISO 8601 |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para inativar |

### 3.3. `os.upsert`

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

### 3.4. `os.progresso`

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

### 3.5. `demanda.upsert`

Cria ou atualiza uma demanda de um cliente (etapa anterior a virar tarefas). Alimenta os graficos de progresso e estimativa por demanda.

```json
{
  "id": "demanda-501-v2",
  "type": "demanda.upsert",
  "occurredAt": "2026-09-24T10:00:00.000Z",
  "data": {
    "externalId": "demanda-501",
    "clientExternalId": "cliente-77",
    "name": "Integracao com marketplace",
    "status": "ANALISANDO",
    "createdAt": "2026-09-20T10:00:00.000Z",
    "analyzedAt": null,
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel da demanda, ate 120 caracteres |
| `clientExternalId` | string | sim | `externalId` de um cliente ja enviado (`cliente.upsert`) |
| `name` | string | sim | Ate 240 caracteres |
| `status` | string | sim | Um de: `ENVIADO`, `ANALISANDO`, `ANALISADO`, `FALHOU` |
| `createdAt` | string | sim | Data de criacao da demanda, ISO 8601 |
| `analyzedAt` | string | nao | Data em que a analise terminou, ISO 8601 |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para inativar |

### 3.6. `tarefa.upsert`

Cria ou atualiza uma tarefa de execucao de escopo (item do Kanban de tarefas). Alimenta Kanban, fluxo cumulativo, throughput, lead time, cycle time e burndown.

```json
{
  "id": "tarefa-8801-v4",
  "type": "tarefa.upsert",
  "occurredAt": "2026-09-24T11:00:00.000Z",
  "data": {
    "externalId": "tarefa-8801",
    "userExternalId": "usuario-42",
    "clientExternalId": "cliente-77",
    "demandExternalId": "demanda-501",
    "title": "Criar endpoint de sincronizacao de pedidos",
    "group": "Integracao",
    "kind": "BACKEND",
    "priority": "ALTA",
    "estimatedMinutes": 240,
    "status": "EM_ANDAMENTO",
    "position": 3,
    "createdAt": "2026-09-22T09:00:00.000Z",
    "updatedAt": "2026-09-24T11:00:00.000Z",
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel da tarefa, ate 120 caracteres |
| `userExternalId` | string | sim | `externalId` de um usuario ja enviado |
| `clientExternalId` | string | sim | `externalId` de um cliente ja enviado |
| `demandExternalId` | string | nao | `externalId` de uma demanda ja enviada (`demanda.upsert`) |
| `title` | string | sim | Ate 240 caracteres |
| `group` | string | nao | Agrupamento/epico, ate 160 caracteres |
| `kind` | string | sim | Um de: `BACKEND`, `FRONTEND`, `DADOS`, `RELATORIO`, `BI`, `INTEGRACAO`, `CONFIGURACAO`, `TESTE`, `DOCUMENTACAO`, `OUTRO` |
| `priority` | string | sim | Um de: `ALTA`, `MEDIA`, `BAIXA` |
| `estimatedMinutes` | inteiro | sim | De `1` a `960` (16h) |
| `status` | string | sim | Um de: `BACKLOG`, `A_FAZER`, `EM_ANDAMENTO`, `EM_REVISAO`, `CONCLUIDO` — colunas do Kanban de tarefas |
| `position` | inteiro | sim | Posicao/ordem dentro da coluna, de `0` a `1000000` |
| `createdAt` | string | sim | Data de criacao, ISO 8601 |
| `updatedAt` | string | sim | Data da ultima atualizacao conhecida pelo desktop, ISO 8601 |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para inativar |

> Para mudar apenas o status da tarefa (mover no Kanban), prefira enviar `tarefa.transicao` — ele preserva o historico de mudancas de coluna usado no fluxo cumulativo, lead time e cycle time. Use `tarefa.upsert` para os demais campos.

### 3.7. `tarefa.transicao`

Registra uma mudanca de status/coluna de uma tarefa existente. Esse historico so existe a partir do momento em que o evento comeca a ser enviado — nao ha como reconstruir transicoes passadas.

```json
{
  "id": "tarefa-8801-transicao-3",
  "type": "tarefa.transicao",
  "occurredAt": "2026-09-24T16:45:00.000Z",
  "data": {
    "taskExternalId": "tarefa-8801",
    "from": "A_FAZER",
    "to": "EM_ANDAMENTO"
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `taskExternalId` | string | sim | `externalId` de uma tarefa ja enviada (`tarefa.upsert`) |
| `from` | string | nao | Status de origem (mesmo dominio de `tarefa.upsert.status`); omita na primeira transicao |
| `to` | string | sim | Status de destino (mesmo dominio de `tarefa.upsert.status`); precisa ser diferente de `from` |

### 3.8. `planejamento.upsert`

Cria ou atualiza um planejamento de execucao (agenda de trabalho futura sobre uma OS). Alimenta planejado vs. realizado, planejamentos atrasados e carga dos proximos dias.

```json
{
  "id": "planejamento-330-v1",
  "type": "planejamento.upsert",
  "occurredAt": "2026-09-24T08:00:00.000Z",
  "data": {
    "externalId": "planejamento-330",
    "osExternalId": "os-1007",
    "userExternalId": "usuario-42",
    "plannedDate": "2026-09-26",
    "startTime": "09:00",
    "endTime": "12:00",
    "stage": "Homologacao",
    "process": "Faturamento",
    "status": "FUTURA",
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel do planejamento, ate 120 caracteres |
| `osExternalId` | string | sim | `externalId` de uma OS ja enviada |
| `userExternalId` | string | sim | `externalId` de um usuario ja enviado |
| `plannedDate` | string | sim | Data no formato `YYYY-MM-DD` |
| `startTime` | string | nao | Hora `HH:mm` ou `HH:mm:ss`; se enviado, `endTime` tambem e obrigatorio |
| `endTime` | string | nao | Hora `HH:mm` ou `HH:mm:ss`; precisa ser maior que `startTime` |
| `stage` | string | nao | Etapa do processo, ate 160 caracteres |
| `process` | string | nao | Nome do processo, ate 240 caracteres |
| `status` | string | sim | Um de: `HOJE`, `FUTURA`, `ATRASADA` |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para inativar |

### 3.9. `agenda.evento.upsert`

Cria ou atualiza um compromisso de agenda do consultor. O cliente e localizado pelo `erpPartnerCode` enviado em `cliente.upsert` — envie o cliente antes.

```json
{
  "id": "agenda-9910-v1",
  "type": "agenda.evento.upsert",
  "occurredAt": "2026-09-24T07:30:00.000Z",
  "data": {
    "externalId": "agenda-9910",
    "userExternalId": "usuario-42",
    "clientCode": "PARC-0077",
    "clientName": "Industria Alfa",
    "start": "2026-09-26T13:00:00.000Z",
    "end": "2026-09-26T15:00:00.000Z",
    "allDay": false,
    "title": "Reuniao de homologacao",
    "kind": "REUNIAO",
    "confirmed": true,
    "fapCode": "FAP-5521",
    "active": true
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel do evento de agenda, ate 120 caracteres |
| `userExternalId` | string | sim | `externalId` de um usuario ja enviado |
| `clientCode` | string/numero | sim | Igual ao `erpPartnerCode` enviado em `cliente.upsert` do cliente do compromisso |
| `clientName` | string | sim | Nome do cliente no momento do evento, ate 180 caracteres (usado apenas para validacao/legibilidade) |
| `start` | string | sim | Inicio em ISO 8601 |
| `end` | string | sim | Fim em ISO 8601, precisa ser maior que `start` |
| `allDay` | boolean | sim | `true` para evento de dia inteiro |
| `title` | string | sim | Ate 240 caracteres |
| `kind` | string | sim | Categoria do compromisso (ex.: `REUNIAO`, `VIAGEM`, `SUPORTE`), ate 80 caracteres |
| `confirmed` | boolean | sim | Se o compromisso esta confirmado |
| `fapCode` | string/numero | nao | Codigo do FAP/atividade no ERP, se houver |
| `active` | boolean | nao | O valor padrao e `true`; envie `false` para cancelar/inativar |

> A agenda enviada e restrita a agenda do proprio consultor (o `userExternalId` do evento). Nao envie a agenda de terceiros.

### 3.10. `horas.apontar`

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
    "endedAt": "2026-09-24T14:30:00.000Z",
    "activityType": "Desenvolvimento",
    "stage": "Homologacao",
    "process": "Faturamento",
    "acceptance": "CONCLUIDO",
    "erpNumber": "12345",
    "erpStatus": "LANCADO",
    "exceeded": false,
    "requestCode": "PED-778"
  }
}
```

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `externalId` | string | sim | ID estavel do apontamento, ate 120 caracteres |
| `osExternalId` | string | sim | `externalId` de uma OS ja enviada |
| `userExternalId` | string | sim | `externalId` do usuario que apontou as horas (o apontamento e sempre atribuido a quem apontou, nao ao responsavel da OS) |
| `minutes` | inteiro | sim | De `1` a `10080` |
| `description` | string | nao | Ate 500 caracteres |
| `startedAt` | string | nao | Inicio em ISO 8601 |
| `endedAt` | string | nao | Fim em ISO 8601; precisa ser maior que `startedAt` quando ambos forem enviados |
| `activityType` | string | nao | Tipo de atividade, ate 120 caracteres |
| `stage` | string | nao | Etapa do processo, ate 160 caracteres |
| `process` | string | nao | Nome do processo, ate 240 caracteres |
| `acceptance` | string | nao | Um de: `GERADO`, `CONCLUIDO`, `PENDENTE` |
| `erpNumber` | string/numero | nao | Numero do lancamento no ERP |
| `erpStatus` | string | nao | Status do lancamento no ERP |
| `exceeded` | boolean | nao | Se o apontamento excedeu a estimativa/limite |
| `requestCode` | string/numero | nao | Codigo do pedido associado, se houver |

## 4. Ordem dos eventos

Os eventos sao processados na ordem do array. Em uma primeira sincronizacao completa, use esta ordem (a entidade referenciada precisa aparecer antes de quem a referencia, no mesmo lote ou em lote anterior):

1. `usuario.upsert`
2. `cliente.upsert`
3. `os.upsert`
4. `os.progresso`
5. `demanda.upsert`
6. `tarefa.upsert`
7. `tarefa.transicao`
8. `planejamento.upsert`
9. `agenda.evento.upsert`
10. `horas.apontar`

Dependencias diretas:

| Evento | Depende de |
|---|---|
| `os.upsert` | `usuario.upsert` (`userExternalId`) |
| `os.progresso` | `os.upsert` (`osExternalId`) |
| `demanda.upsert` | `cliente.upsert` (`clientExternalId`) |
| `tarefa.upsert` | `usuario.upsert`, `cliente.upsert` e, se informado, `demanda.upsert` |
| `tarefa.transicao` | `tarefa.upsert` (`taskExternalId`) |
| `planejamento.upsert` | `os.upsert` e `usuario.upsert` |
| `agenda.evento.upsert` | `usuario.upsert` e `cliente.upsert` (localizado por `erpPartnerCode`/`clientCode`) |
| `horas.apontar` | `os.upsert` e `usuario.upsert` |

A entidade pode estar no mesmo lote de quem a referencia, desde que apareca antes no array `events`.

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
      "id": "cliente-77-v1",
      "type": "cliente.upsert",
      "occurredAt": "2026-09-24T09:00:00.000Z",
      "data": {
        "externalId": "cliente-77",
        "name": "Industria Alfa",
        "erpPartnerCode": "PARC-0077",
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
      "id": "demanda-501-v1",
      "type": "demanda.upsert",
      "occurredAt": "2026-09-24T10:00:00.000Z",
      "data": {
        "externalId": "demanda-501",
        "clientExternalId": "cliente-77",
        "name": "Integracao com marketplace",
        "status": "ANALISANDO",
        "createdAt": "2026-09-20T10:00:00.000Z",
        "active": true
      }
    },
    {
      "id": "tarefa-8801-v1",
      "type": "tarefa.upsert",
      "occurredAt": "2026-09-24T11:00:00.000Z",
      "data": {
        "externalId": "tarefa-8801",
        "userExternalId": "usuario-42",
        "clientExternalId": "cliente-77",
        "demandExternalId": "demanda-501",
        "title": "Criar endpoint de sincronizacao de pedidos",
        "kind": "BACKEND",
        "priority": "ALTA",
        "estimatedMinutes": 240,
        "status": "A_FAZER",
        "position": 1,
        "createdAt": "2026-09-22T09:00:00.000Z",
        "updatedAt": "2026-09-24T11:00:00.000Z",
        "active": true
      }
    },
    {
      "id": "tarefa-8801-transicao-1",
      "type": "tarefa.transicao",
      "occurredAt": "2026-09-24T16:45:00.000Z",
      "data": {
        "taskExternalId": "tarefa-8801",
        "from": "A_FAZER",
        "to": "EM_ANDAMENTO"
      }
    },
    {
      "id": "planejamento-330-v1",
      "type": "planejamento.upsert",
      "occurredAt": "2026-09-24T08:00:00.000Z",
      "data": {
        "externalId": "planejamento-330",
        "osExternalId": "os-1007",
        "userExternalId": "usuario-42",
        "plannedDate": "2026-09-26",
        "startTime": "09:00",
        "endTime": "12:00",
        "status": "FUTURA",
        "active": true
      }
    },
    {
      "id": "agenda-9910-v1",
      "type": "agenda.evento.upsert",
      "occurredAt": "2026-09-24T07:30:00.000Z",
      "data": {
        "externalId": "agenda-9910",
        "userExternalId": "usuario-42",
        "clientCode": "PARC-0077",
        "clientName": "Industria Alfa",
        "start": "2026-09-26T13:00:00.000Z",
        "end": "2026-09-26T15:00:00.000Z",
        "allDay": false,
        "title": "Reuniao de homologacao",
        "kind": "REUNIAO",
        "confirmed": true,
        "active": true
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
- Use espera progressiva entre tentativas, por exemplo 5 s, 15 s, 30 s e 60 s, com jitter aleatorio (ver secao 8).
- Divida filas maiores que 200 eventos em lotes menores, preservando a ordem de dependencia.

Uma sugestao de ID e combinar entidade, identificador e versao da alteracao:

```text
usuario-{id}-v{versao}
cliente-{id}-v{versao}
os-{id}-v{versao}
os-{id}-progresso-{versao}
demanda-{id}-v{versao}
tarefa-{id}-v{versao}
tarefa-{id}-transicao-{sequencia}
planejamento-{id}-v{versao}
agenda-{id}-v{versao}
apontamento-{id}-v{versao}
```

## 8. Periodicidade recomendada (mais de 25 instalacoes simultaneas)

O painel tem limite de **300 execucoes de Server Function por minuto, somando todas as instalacoes**. Acima de 25 instalacoes ativas, siga estas regras para nao estourar o limite:

- **Deteccao local:** capture cada mudanca (upsert/transicao) localmente assim que ocorrer, mas **nao envie imediatamente por evento** — acumule em uma fila local.
- **Envio da fila local:** libere o lote da fila local em ate **60 segundos** apos a primeira mudanca pendente (ou antes, se o lote atingir o tamanho-alvo).
- **Consulta as fontes do desktop** (banco local, ERP, agenda): a cada **15 minutos**, para capturar mudancas feitas fora do fluxo que gera evento imediato.
- **Atraso aleatorio por instalacao (jitter de inicializacao):** ao agendar o proximo envio, some um atraso aleatorio de **0 a 2 minutos** por instalacao. Isso evita que todas as 25+ instalacoes tentem enviar no mesmo segundo.
- **Tamanho do lote:** agrupe entre **50 e 100 eventos** por requisicao (o contrato aceita ate 200, mas usar o teto reduz a margem para reenvio parcial). So exceda 100 se a fila local acumulou mais que isso por indisponibilidade temporaria.
- **Uma requisicao em transito por instalacao:** nunca envie um novo lote antes de receber a resposta do lote anterior daquela mesma instalacao.
- **Retry com backoff e jitter:** em falha de rede/timeout, aguarde `backoff base x tentativa + jitter aleatorio` (ex.: 5s, 15s, 30s, 60s, cada um com ate ±20% de variacao aleatoria) antes de tentar novamente.

Com essas regras, o pior caso teorico (25 instalacoes enviando o lote maximo a cada 60s) fica bem abaixo do limite de 300/min — o jitter existe justamente para evitar que o pior caso teorico vire pior caso real (todas sincronizadas no mesmo segundo).

## 9. Erros comuns

| Mensagem | Causa provavel | Correcao |
|---|---|---|
| `version deve ser 1` | Versao ausente ou diferente de 1 | Enviar `"version": 1` |
| `Instalacao ou chave invalida` | Credencial incorreta, revogada ou de outra instalacao | Revisar a configuracao ou solicitar nova chave |
| `events deve conter entre 1 e 200 itens` | Lote vazio ou grande demais | Enviar de 1 a 200 eventos |
| `Tipo de evento nao suportado` | Valor de `type` desconhecido | Usar um dos 10 tipos deste contrato |
| `Usuario inexistente; envie a dependencia primeiro` | Usuario referenciado ainda nao existe | Enviar `usuario.upsert` antes |
| `Cliente inexistente; envie a dependencia primeiro` | Cliente referenciado ainda nao existe | Enviar `cliente.upsert` antes |
| `OS inexistente; envie a dependencia primeiro` | OS referenciada ainda nao existe | Enviar `os.upsert` antes |
| `Demanda inexistente; envie a dependencia primeiro` | Demanda referenciada ainda nao existe | Enviar `demanda.upsert` antes |
| `Tarefa inexistente; envie a dependencia primeiro` | Tarefa referenciada ainda nao existe | Enviar `tarefa.upsert` antes |
| `Cliente da agenda inexistente; envie cliente.upsert primeiro` | `clientCode` da agenda nao bate com nenhum `erpPartnerCode` cadastrado | Enviar `cliente.upsert` com `erpPartnerCode` preenchido antes da agenda |
| `Transicao sem mudanca de status` | `from` igual a `to` em `tarefa.transicao` | So enviar transicao quando o status realmente mudar |
| `Intervalo planejado invalido` | `startTime`/`endTime` incompletos ou fora de ordem | Enviar os dois horarios e garantir `startTime < endTime` |
| `Intervalo de agenda invalido` | `end` menor ou igual a `start` | Garantir que `end` seja depois de `start` |
| `Intervalo de apontamento invalido` | `endedAt` menor ou igual a `startedAt` | Garantir que `endedAt` seja depois de `startedAt` |

## 10. Checklist do aplicativo desktop

- Persistir `INSTALLATION_ID` e `API_KEY` em armazenamento protegido do sistema operacional.
- Enviar sempre por HTTPS.
- Implementar fila local duravel para tolerar falta de conexao.
- Preservar o mesmo `event.id` em reenvios.
- Enviar datas ISO 8601 em UTC.
- Respeitar o limite de 200 eventos por lote (usar 50 a 100 como alvo).
- Aplicar o jitter e a periodicidade da secao 8 antes de habilitar o envio automatico em producao.
- Desserializar `output` quando ele chegar como string JSON.
- Remover da fila somente eventos `accepted` ou `duplicate`.
- Exibir ou registrar erros `failed` sem incluir a chave.
- Respeitar a ordem de dependencia da secao 4 (usuario/cliente antes de quem os referencia).
- Enviar `cliente.upsert` com `erpPartnerCode` preenchido antes de qualquer `agenda.evento.upsert` daquele cliente.
- Enviar `tarefa.transicao` para mudancas de coluna do Kanban de tarefas, preservando o historico; usar `tarefa.upsert` para os demais campos.
- Restringir o envio de agenda ao proprio consultor (nao enviar agenda de terceiros).

## 11. Teste inicial recomendado

1. Configure a URL, o identificador e a chave da instalacao.
2. Envie um lote contendo apenas um `usuario.upsert`.
3. Confirme `status: "COMPLETED"`, `accepted: 1` e `failed: 0`.
4. Reenvie exatamente o mesmo lote e confirme `duplicate: 1`.
5. Envie um `cliente.upsert` e depois uma OS vinculada ao usuario e confirme `accepted: 1` para ambos.
6. Envie uma `demanda.upsert` vinculada ao cliente e uma `tarefa.upsert` vinculada a demanda, ao usuario e ao cliente.
7. Envie uma `tarefa.transicao` mudando o status da tarefa e confirme que o Kanban de tarefas reflete a mudanca.
8. Envie um `planejamento.upsert` e um `agenda.evento.upsert` (com o cliente ja tendo `erpPartnerCode`).
9. So entao habilite o envio automatico com a periodicidade e o jitter da secao 8, e os lotes maiores.
