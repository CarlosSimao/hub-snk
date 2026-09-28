# Integracao da API com o aplicativo desktop — extensao: demandas da agenda e das OS

Este arquivo **complementa** o contrato `contrato_api_desktop.md` (versao 1, 10 tipos de evento). Ele nao cria tipo de evento novo nem muda o envelope, a URL, a autenticacao, os limites ou as regras de idempotencia de la. O que muda:

- `demanda.upsert` passa a receber tambem as demandas vindas do **ERP** (Solicitacao de Servicos DS), alem das demandas do Kanban que ja recebe.
- `horas.apontar` ganha **2 campos opcionais**: a demanda de cada OS lancada na Experience.
- `agenda.evento.upsert` ganha **3 campos opcionais**: a demanda de cada dia reservado na Agenda de Recursos do ERP e o **status do confronto** desse dia com a Experience.

Todos os campos novos sao **opcionais**. Como um receptor que valida os campos de forma estrita recusaria o evento inteiro por causa de um campo desconhecido, o desktop so passa a envia-los quando a opcao "Enviar as demandas (OS e agenda)" for ligada na instalacao — o que so deve acontecer depois de o receptor confirmar que aceita os campos desta extensao. Com a opcao desligada, os eventos continuam exatamente como no contrato original.

Objetivo: alimentar dashboards de acompanhamento com quatro leituras por consultor, cliente e demanda:

1. dias reservados na agenda **sem demanda** informada;
2. dias reservados **com demanda, mas sem OS** lancada;
3. dias com **OS sem demanda** identificada;
4. dias em que **demanda e OS conferem**;

e, como quinta leitura, os dias em que agenda, tarefa e OS apontam para **demandas diferentes**.

## 1. Conceitos

| Termo | O que e | Onde nasce |
|---|---|---|
| Demanda | Uma Solicitacao de Servicos DS do ERP corporativo. Identificada pelo codigo da solicitacao (`CODIGO`, ex.: `2996`) | ERP (entidade `SolicitacaoServicos`) |
| Dia reservado | Um agendamento do consultor na Agenda de Recursos do ERP para um cliente | ERP (`AgendaRecursosSP.carregarAgendas`) |
| Tarefa | Tarefa planejada na Experience para o consultor e o cliente | Experience |
| OS | Ordem de servico lancada na Experience. No contrato ela e um `horas.apontar` | Experience |

Como o desktop descobre a demanda de cada item:

| Item | Regra, em ordem de prioridade |
|---|---|
| Dia reservado (agenda) | 1. Vinculo manual feito na tela. 2. ID escrito na observacao do agendamento (`DESCRLONGA`), no padrao `TECH \| ID 2996 - NOME DO CLIENTE` |
| Tarefa | 1. Vinculo manual. 2. ID escrito nas observacoes da tarefa (`additional_information`), mesmo padrao |
| OS | 1. Vinculo manual da OS. 2. Vinculo manual do pedido da OS. 3. Pedido aprendido das tarefas (a tarefa e a OS carregam o mesmo numero de pedido de origem). 4. ID escrito na descricao da OS. 5. Cliente com uma unica demanda cadastrada |

## 2. `demanda.upsert` — demandas do ERP

**Sem campo novo.** O tipo e o formato sao os da secao 3.5 do contrato. O que muda e a origem: alem das demandas do Kanban (`externalId` `hub-demanda-{id}`), chegam as demandas do ERP com prefixo proprio, que nunca colide com o do Kanban.

```json
{
  "id": "demanda-erp:2996:4f1c9a2b",
  "type": "demanda.upsert",
  "occurredAt": "2026-09-28T18:00:00.000Z",
  "data": {
    "externalId": "erp-demanda-2996",
    "clientExternalId": "hub-cliente-2",
    "name": "ID 2996 - Aos cuidados de Clayton;",
    "status": "ANALISADO",
    "createdAt": "2026-07-16T14:10:15.000Z",
    "active": true
  }
}
```

| Campo de `data` | Valor enviado pelo desktop |
|---|---|
| `externalId` | `erp-demanda-{CODIGO}` |
| `clientExternalId` | `hub-cliente-{id}` do cliente ja enviado em `cliente.upsert` |
| `name` | `ID {CODIGO} - {primeira linha da descricao da solicitacao}`, ate 240 caracteres |
| `status` | Mapeado do status do orcamento no ERP (tabela abaixo) |
| `createdAt` | Data de abertura da solicitacao, convertida de horario de Brasilia para UTC |
| `analyzedAt` | Data de aprovacao, quando existir |
| `active` | `true` |

Mapeamento do status do orcamento do ERP para o contrato:

| Status do orcamento no ERP | `status` |
|---|---|
| Orcamento Aprovado | `ANALISADO` |
| Em Orcamento, Aguardando Aprovacao, Em Negociacao / Cliente, Pendente Correcao | `ANALISANDO` |
| Orcamento Reprovado, Orcamento Cancelado, Prazo Retorno Excedido | `FALHOU` |
| Nao Iniciado, Pendente Atendimento | `ENVIADO` |

Observacoes para o receptor:

- O numero da demanda que o usuario reconhece e o `CODIGO` (ex.: `2996`). Ele tambem chega sozinho no campo `demandCode` dos eventos das secoes 3 e 4 — use-o para exibicao e filtro.
- O desktop so envia `demanda.upsert` de demanda do ERP quando conseguiu ler a solicitacao (tem data de abertura). Um `demandCode` pode, portanto, chegar sem a demanda correspondente — ver regra do `demandExternalId` abaixo.

## 3. `horas.apontar` — campos novos

Dois campos opcionais, somados aos da secao 3.10 do contrato:

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `demandExternalId` | string | nao | `externalId` de uma demanda ja enviada (`demanda.upsert`), no formato `erp-demanda-{CODIGO}` |
| `demandCode` | string/numero | nao | Codigo da demanda no ERP (ex.: `"2996"`), para exibicao e filtro |

```json
{
  "id": "horas:539845:baa37219",
  "type": "horas.apontar",
  "occurredAt": "2026-09-28T18:00:00.000Z",
  "data": {
    "externalId": "exp-os-539845",
    "osExternalId": "exp-projeto-10269",
    "userExternalId": "exp-usuario:flaviano.santos@sankhya.com.br",
    "minutes": 480,
    "description": "SER-COMPARTILHAMENTO MELHORES PRATICAS",
    "startedAt": "2026-09-22T00:00:00.000Z",
    "activityType": "Conformidade",
    "stage": "Configuracao",
    "process": "Vendas",
    "erpNumber": "7172277",
    "requestCode": "5585742",
    "acceptance": "CONCLUIDO",
    "exceeded": false,
    "demandExternalId": "erp-demanda-2996",
    "demandCode": "2996"
  }
}
```

Regras:

- `demandExternalId` so e enviado quando o `demanda.upsert` daquela demanda sai no mesmo lote ou ja saiu antes. Assim o receptor nunca recebe referencia a demanda inexistente.
- Os dois campos ausentes significam **OS sem demanda identificada**.
- Se o vinculo mudar (ex.: o usuario corrige a demanda da OS na tela), o desktop reenvia o mesmo `externalId` com um novo `event.id`. O receptor deve **sobrescrever** a demanda do apontamento, e remover a demanda quando os campos vierem ausentes no reenvio.

## 4. `agenda.evento.upsert` — campos novos

Tres campos opcionais, somados aos da secao 3.9 do contrato:

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `demandExternalId` | string | nao | `externalId` de uma demanda ja enviada, formato `erp-demanda-{CODIGO}` |
| `demandCode` | string/numero | nao | Codigo da demanda no ERP. Ausente = o agendamento nao informa demanda |
| `demandStatus` | string | nao | Status do confronto do dia com a Experience (tabela abaixo) |

Valores de `demandStatus`:

| Valor | Significado | Leitura do dashboard |
|---|---|---|
| `SEM_DEMANDA` | O agendamento nao informa demanda (sem ID na observacao nem vinculo manual) | 1. Reservado sem demanda |
| `DEMANDA_SEM_OS` | O agendamento informa a demanda, mas nao ha OS lancada no dia | 2. Demanda sem OS |
| `OS_SEM_DEMANDA` | Ha OS lancada no dia, mas sem demanda identificada | 3. OS sem demanda |
| `CONFERE` | Agendamento, tarefa (quando existir) e OS do dia apontam para a mesma demanda | 4. Confere |
| `DIVERGENTE` | Agendamento, tarefa ou OS do dia apontam para demandas diferentes | 5. Divergente |
| `SEM_EXPERIENCE` | O agendamento informa a demanda, mas a Experience nao respondeu para o cliente naquele ciclo | Nao contar nos indicadores 2 a 5 |

A regra, aplicada a cada agendamento no dia de `start`:

```text
se o agendamento nao tem demanda                        -> SEM_DEMANDA
senao, se a Experience nao respondeu                    -> SEM_EXPERIENCE
senao, se alguma tarefa ou OS do dia e de outra demanda -> DIVERGENTE
senao, se nao ha OS no dia                              -> DEMANDA_SEM_OS
senao, se alguma OS do dia nao tem demanda              -> OS_SEM_DEMANDA
senao                                                   -> CONFERE
```

Exemplos:

```json
{
  "id": "agenda:48636200:7e21c04d",
  "type": "agenda.evento.upsert",
  "occurredAt": "2026-09-28T18:00:00.000Z",
  "data": {
    "externalId": "erp-evento-48636200",
    "userExternalId": "exp-usuario:flaviano.santos@sankhya.com.br",
    "clientCode": 78764,
    "clientName": "AMATOOLS COMERCIAL E IMPORTADORA LTDA",
    "start": "2026-09-22T11:00:00.000Z",
    "end": "2026-09-22T21:00:00.000Z",
    "allDay": false,
    "title": "AMATOOLS COMERCIAL E IMPORTADORA LTDA",
    "kind": "ESTATICO",
    "confirmed": true,
    "fapCode": 32503,
    "active": true,
    "demandExternalId": "erp-demanda-2996",
    "demandCode": "2996",
    "demandStatus": "CONFERE"
  }
}
```

```json
{
  "id": "agenda:48655699:0b93d1aa",
  "type": "agenda.evento.upsert",
  "occurredAt": "2026-09-28T18:00:00.000Z",
  "data": {
    "externalId": "erp-evento-48655699",
    "userExternalId": "exp-usuario:flaviano.santos@sankhya.com.br",
    "clientCode": 62230,
    "clientName": "LARIFO TRANSPORTES LTDA",
    "start": "2026-09-28T11:00:00.000Z",
    "end": "2026-09-28T21:00:00.000Z",
    "allDay": false,
    "title": "LARIFO TRANSPORTES LTDA",
    "kind": "ESTATICO",
    "confirmed": true,
    "active": true,
    "demandStatus": "SEM_DEMANDA"
  }
}
```

Regras:

- O status **muda com o tempo**: um dia `DEMANDA_SEM_OS` vira `CONFERE` quando a OS e lancada, ou `SEM_DEMANDA` vira `CONFERE` quando o usuario vincula a demanda. A cada mudanca o desktop reenvia o mesmo `externalId` com um novo `event.id`. O receptor deve **guardar so o valor mais recente** de cada `externalId` (upsert) e, se quiser historico, registrar a data em que o status mudou.
- `demandCode` sem `demandExternalId` e valido: a demanda foi informada na agenda, mas a solicitacao ainda nao foi lida do ERP. Agrupe por `demandCode`.
- O desktop recalcula o status a cada 15 minutos (secao 8 do contrato). Um dia recem-trabalhado pode aparecer como `DEMANDA_SEM_OS` ate a OS ser lancada.

## 5. Ordem e dependencias

Nao muda a ordem da secao 4 do contrato. As novas dependencias sao so as dos campos novos:

| Evento | Depende de, quando o campo vier |
|---|---|
| `demanda.upsert` (ERP) | `cliente.upsert` (`clientExternalId`) |
| `horas.apontar` com `demandExternalId` | `demanda.upsert` da mesma demanda |
| `agenda.evento.upsert` com `demandExternalId` | `demanda.upsert` da mesma demanda |

`demanda.upsert` ja vem antes de `agenda.evento.upsert` e de `horas.apontar` na ordem atual, entao nada precisa ser reordenado.

## 6. Validacao esperada no receptor

| Situacao | Resposta esperada |
|---|---|
| Campo novo ausente | Aceitar (todos sao opcionais) |
| `demandStatus` fora da lista da secao 4 | `failed` com mensagem clara (ex.: `demandStatus invalido`) |
| `demandExternalId` de demanda ainda nao enviada | `failed` com `Demanda inexistente; envie a dependencia primeiro` (mesma mensagem da secao 9 do contrato) |
| `demandCode` com caractere fora de letras, numeros e `._:@/-` | `failed` |
| `demandCode` sem `demandExternalId` | Aceitar |

## 7. Indicadores sugeridos para os dashboards

Todos saem dos eventos acima, por consultor (`userExternalId`), cliente (`clientCode` / `clientExternalId`), demanda (`demandCode`) e periodo (data de `start` em horario de Brasilia).

| Indicador | Calculo |
|---|---|
| Dias reservados sem demanda | Agendamentos ativos com `demandStatus = SEM_DEMANDA` |
| Dias reservados de demanda sem OS | Agendamentos ativos com `demandStatus = DEMANDA_SEM_OS` e `start` no passado |
| Dias com OS sem demanda | Agendamentos com `demandStatus = OS_SEM_DEMANDA`, mais `horas.apontar` sem `demandCode` |
| Dias com demanda e OS conferindo | Agendamentos ativos com `demandStatus = CONFERE` |
| Divergencias | Agendamentos ativos com `demandStatus = DIVERGENTE` (pedem correcao na origem) |
| Taxa de conformidade | `CONFERE / (SEM_DEMANDA + DEMANDA_SEM_OS + OS_SEM_DEMANDA + DIVERGENTE + CONFERE)`, excluindo `SEM_EXPERIENCE` |
| Horas por demanda | Soma de `minutes` de `horas.apontar` agrupada por `demandCode` |
| Horas previstas x realizadas | Horas previstas da demanda (dado do ERP, ver secao 9) contra a soma de `minutes` por `demandCode` |
| Dias reservados x dias com OS por demanda | Contagem de agendamentos por `demandCode` contra contagem de dias distintos de `horas.apontar` por `demandCode` |

Cuidados de leitura:

- **Fuso horario:** `start` e `end` da agenda vem em UTC e correspondem a horario de Brasilia (`08:00` local = `11:00Z`). Para agrupar por dia, converta para `America/Sao_Paulo` antes de truncar a data.
- **`horas.apontar.startedAt`** hoje representa **so o dia** da OS, enviado como `T00:00:00.000Z`. Para agrupar por dia, use a data UTC dessa string **sem** converter para Brasilia — convertendo, a OS cai no dia anterior. (Ver secao 9.)
- **Agendamento cancelado no ERP:** hoje o desktop nao envia `active: false` quando um agendamento some da agenda. Ate isso existir, considere so os agendamentos reenviados recentemente ou trate `start` no passado com cautela.

## 8. Ativacao

1. O receptor implementa os campos das secoes 3 e 4 (aceitar, validar e persistir) e o `demanda.upsert` com `externalId` `erp-demanda-*`.
2. O receptor confirma ao usuario do desktop.
3. O usuario liga "Enviar as demandas (OS e agenda)" na tela de Integracao do desktop.
4. No ciclo seguinte (ate 15 minutos), o desktop envia as demandas do ERP e reenvia agenda e horas com os campos novos. O volume do primeiro envio e de uma vez o mes corrente de agenda e de OS.

## 9. Pontos em aberto

- **Horas estimadas da demanda:** o ERP tem as horas estimadas da solicitacao (ex.: 174 h na 2996), mas o `demanda.upsert` do contrato nao tem campo para isso. Se o dashboard for usar "previsto x realizado por demanda", falta um campo opcional, por exemplo `estimatedMinutes`.
- **Data das horas:** o desktop pode passar a enviar `startedAt` como `{dia}T03:00:00.000Z` (meia-noite de Brasilia), para quem converter fuso nao cair no dia anterior. Confirmar com o receptor antes de mudar, porque altera o `event.id` de todos os apontamentos ja enviados (reenvio unico, respondido como upsert).
- **Cancelamento de agendamento:** enviar `active: false` quando um agendamento some do ERP.
- **Tarefas antigas:** a Experience so lista tarefas em aberto. Em dias passados, o confronto fica entre agenda e OS, sem a tarefa — `CONFERE` continua valido nesses casos.
