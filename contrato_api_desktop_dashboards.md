# Integracao da API com o aplicativo desktop — ATUALIZACAO v1.1: painel de liderancas

> **Este documento e uma ATUALIZACAO do contrato `contrato_api_desktop.md` (versao 1).**
> Ele nao substitui o contrato: envelope, URL, autenticacao, limites, idempotencia, ordem dos eventos e erros continuam valendo como estao la. Aqui estao (a) os campos novos que o aplicativo desktop (DS) passa a enviar, (b) o modelo de dados sugerido para o painel e (c) o catalogo de graficos para liderancas, com calculo e filtros.
>
> **Para quem implementa (pessoa ou IA):** leia as secoes na ordem. A secao 2 diz o que ja chega hoje e o que depende de mudanca no DS; nao implemente grafico que dependa de campo marcado como "a enviar" sem tratar a ausencia dele. Todos os campos novos sao **opcionais** e payloads antigos continuam validos.

## 1. Objetivo e publico

O painel atende a **lideranca de um time de desenvolvedores** (consultores de customizacao Sankhya). Cada desenvolvedor roda uma instalacao do DS, que envia os dados dele. A lideranca precisa responder, por pessoa, por cliente e para o time todo:

- Quanto foi produzido (OS e horas apontadas) e como isso evolui mes a mes.
- Quanto esta previsto (agenda) para este mes e o proximo, contra o realizado no mes anterior.
- Onde ha falha de processo: demanda sem OS, OS sem demanda, agendamento sem OS.
- Quanto cada cliente ja consumiu, de forma acumulada, e contra o que foi estimado.
- Quanto da agenda do mes esta ocupada, livre ou em ausencia.

Glossario:

| Termo | Significado | De onde vem |
|---|---|---|
| Consultor | O desenvolvedor dono da instalacao | `usuario.upsert` |
| Cliente | Empresa atendida, identificada no ERP pelo codigo do parceiro (`erpPartnerCode`) | `cliente.upsert` |
| Projeto (FAP) | Contrato de atendimento do cliente na Experience. No contrato ele e o `os.upsert` (`exp-projeto-{id}`) | `os.upsert` |
| OS | Ordem de servico lancada pelo consultor na Experience. No contrato ela e o `horas.apontar` (`exp-os-{id}`) | `horas.apontar` |
| Demanda | Solicitacao de Servicos DS do ERP (`erp-demanda-{CODIGO}`) ou demanda do Kanban de escopo do DS (`hub-demanda-{id}`) | `demanda.upsert` |
| Agendamento | Dia/periodo reservado na Agenda de Recursos do ERP | `agenda.evento.upsert` |
| Planejamento | Tarefa planejada na Experience (so as em aberto: hoje, futura, atrasada) | `planejamento.upsert` |

> Atencao ao nome: no contrato, `os.upsert` e o **projeto** e `horas.apontar` e a **OS**. Nos graficos, "quantidade de OS" = quantidade de `horas.apontar`.

## 2. O que muda (resumo)

Legenda da coluna Estado: **enviado** = o DS ja manda hoje; **opcional ligado** = o DS manda quando a opcao "Enviar as demandas (OS e agenda)" esta ligada na instalacao; **a enviar** = o DS passa a mandar nesta atualizacao (o painel deve funcionar sem ele ate chegar).

| # | Evento | Mudanca | Estado | Para que serve |
|---|---|---|---|---|
| 1 | `demanda.upsert` | Demandas do ERP com `externalId` `erp-demanda-{CODIGO}` | opcional ligado | Graficos por demanda |
| 2 | `horas.apontar` | `demandExternalId`, `demandCode` | opcional ligado | OS sem demanda, horas por demanda |
| 3 | `agenda.evento.upsert` | `demandExternalId`, `demandCode`, `demandStatus` | opcional ligado | Conformidade agenda x OS |
| 4 | `horas.apontar` | `workDate` (dia da OS, `YYYY-MM-DD`) | a enviar | Agrupar por dia/mes sem erro de fuso |
| 5 | `agenda.evento.upsert` | `plannedMinutes`, `osCount`, `osMinutes` | a enviar | Horas agendadas x apontadas, agendamento sem OS |
| 6 | `agenda.evento.upsert` | `category` e `clientCode` opcional quando `category = AUSENCIA` ou `INTERNO` | a enviar | Dias livres x ocupados x ausencia |
| 7 | `agenda.evento.upsert` | Janela: mes anterior, atual e os 2 seguintes (hoje: so o atual) | a enviar | Horas previstas para este mes e o proximo |
| 8 | `agenda.evento.upsert` | `active: false` quando o agendamento some do ERP | a enviar | Previsto confiavel |
| 9 | `cliente.upsert` | Cliente automatico para parceiro da agenda que nao esta cadastrado no DS | a enviar | Ocupacao completa da agenda |
| 10 | `demanda.upsert` | `estimatedMinutes`, `requestType`, `erpStatusLabel` | a enviar | Consumo x estimado por demanda |
| 11 | `usuario.upsert` | `role`, `team` | a enviar | Filtro por cargo e equipe |

## 3. Campos novos por evento

Somente o que muda. Os demais campos continuam como no contrato.

### 3.1. `usuario.upsert`

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `role` | string | nao | Cargo do consultor no ERP (ex.: `DEVELOPER I`), ate 120 caracteres |
| `team` | string | nao | Equipe informada na instalacao (ex.: `Customizacao Sul`), ate 120 caracteres |

### 3.2. `cliente.upsert` — cliente automatico da agenda

Hoje o DS so envia agenda de cliente cadastrado nele. Para a ocupacao da agenda ficar completa, o DS passa a enviar um `cliente.upsert` para cada parceiro que aparece na agenda do consultor e nao esta cadastrado:

```json
{
  "id": "cliente-erp:75742:9a0c11de",
  "type": "cliente.upsert",
  "occurredAt": "2026-09-28T18:00:00.000Z",
  "data": {
    "externalId": "erp-parceiro-75742",
    "name": "AGROSALLES COMERCIO DE SEMENTES LTDA",
    "erpPartnerCode": 75742,
    "active": true
  }
}
```

- `externalId` `erp-parceiro-{CODPARC}`. Cliente cadastrado no DS continua `hub-cliente-{id}`.
- Se depois o cliente for cadastrado no DS, chega um `cliente.upsert` `hub-cliente-{id}` com o **mesmo** `erpPartnerCode`. O painel deve tratar `erpPartnerCode` como a chave do cliente para agregacao (ver tabela `CLIENTES` na secao 4).

### 3.3. `demanda.upsert`

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `estimatedMinutes` | inteiro | nao | Horas estimadas da solicitacao no ERP, em minutos (ex.: 174 h = `10440`). De `1` a `600000` |
| `requestType` | string | nao | Tipo da solicitacao no ERP (ex.: `PERSONALIZACAO_E_CUSTOMIZACAO`, `INTEGRACOES`, `RELATORIOS_E_DASHBOARD`), ate 80 caracteres |
| `erpStatusLabel` | string | nao | Status original do orcamento no ERP (ex.: `Orcamento Aprovado`), ate 80 caracteres. O `status` do contrato continua sendo o mapeado |

### 3.4. `agenda.evento.upsert`

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `demandExternalId` | string | nao | Ja documentado (opcional ligado) |
| `demandCode` | string/numero | nao | Ja documentado (opcional ligado) |
| `demandStatus` | string | nao | Ja documentado: `SEM_DEMANDA`, `DEMANDA_SEM_OS`, `OS_SEM_DEMANDA`, `CONFERE`, `DIVERGENTE`, `SEM_EXPERIENCE` |
| `category` | string | nao | `CLIENTE` (atendimento), `AUSENCIA` (ferias, atestado, particular) ou `INTERNO` (treinamento, reuniao interna) |
| `plannedMinutes` | inteiro | nao | Minutos de trabalho previstos no agendamento, **ja descontado o intervalo**. Regra do DS: dia inteiro (ou `08:00`–`18:00`) = `480`; periodo parcial = duracao, limitada a `480` por dia; agendamento de varios dias = `480` x dias uteis cobertos |
| `osCount` | inteiro | nao | Quantidade de OS do consultor para o mesmo cliente no dia do agendamento. `0` = agendamento sem OS |
| `osMinutes` | inteiro | nao | Soma dos minutos dessas OS |
| `clientCode` | string/numero | **condicional** | Continua obrigatorio para `category = CLIENTE`. Para `AUSENCIA` e `INTERNO` pode vir ausente (compromisso sem parceiro no ERP) |

Exemplo de ausencia (hoje nao e enviado; passa a ser):

```json
{
  "id": "agenda:48600001:1c2d3e4f",
  "type": "agenda.evento.upsert",
  "occurredAt": "2026-09-28T18:00:00.000Z",
  "data": {
    "externalId": "erp-evento-48600001",
    "userExternalId": "exp-usuario:flaviano.santos@sankhya.com.br",
    "clientName": "Ferias",
    "start": "2026-08-03T11:00:00.000Z",
    "end": "2026-08-07T21:00:00.000Z",
    "allDay": false,
    "title": "Ferias",
    "kind": "ESTATICO",
    "confirmed": true,
    "category": "AUSENCIA",
    "plannedMinutes": 0,
    "active": true
  }
}
```

Exemplo de atendimento completo:

```json
{
  "id": "agenda:48636200:5b6c7d8e",
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
    "category": "CLIENTE",
    "plannedMinutes": 480,
    "osCount": 1,
    "osMinutes": 480,
    "demandExternalId": "erp-demanda-2996",
    "demandCode": "2996",
    "demandStatus": "CONFERE",
    "active": true
  }
}
```

Regras de envio da agenda (DS):

- Janela enviada: do primeiro dia do mes anterior ao ultimo dia do **segundo mes seguinte**. E isso que permite "previsto para este mes e o proximo".
- Agendamento que existia e sumiu do ERP e reenviado com `active: false`. O painel deve **excluir** `active = false` de todo calculo de previsto e ocupacao.
- `osCount`, `osMinutes` e `demandStatus` mudam ao longo do tempo (a OS e lancada depois do agendamento). Cada mudanca chega como novo `event.id` do mesmo `externalId`: o painel guarda **so o ultimo valor** (upsert).

### 3.5. `horas.apontar`

| Campo de `data` | Tipo | Obrigatorio | Regra |
|---|---|---:|---|
| `demandExternalId` | string | nao | Ja documentado (opcional ligado) |
| `demandCode` | string/numero | nao | Ja documentado (opcional ligado) |
| `workDate` | string | nao | Dia em que a OS foi realizada, `YYYY-MM-DD`, horario de Brasilia |

Regra de data para o painel: use `workDate` quando existir. Sem ele (eventos antigos), use a **data UTC** de `startedAt` sem converter fuso (hoje o DS envia `startedAt` como `{dia}T00:00:00.000Z`; convertendo para Brasilia a OS cai no dia anterior).

## 4. Modelo de dados sugerido para o painel

Tipos genericos de SQL; adapte ao banco do painel. As tabelas que ja existem (citadas no contrato: `AGENDA_EVENTOS`, `DEMANDAS`) ganham colunas; as demais sao sugestoes. `*` marca coluna nova nesta atualizacao.

### 4.1. Tabelas de entidade (alimentadas pelos eventos)

**`USUARIOS`** — `usuario.upsert`

| Coluna | Tipo | Origem |
|---|---|---|
| `ID` | BIGINT PK | interno |
| `INSTALACAO_ID` | VARCHAR(36) | envelope `installationId` |
| `EXTERNAL_ID` | VARCHAR(120) | `externalId` (unico por instalacao) |
| `NOME` | VARCHAR(180) | `name` |
| `EMAIL` | VARCHAR(254) | `email` |
| `CARGO`* | VARCHAR(120) | `role` |
| `EQUIPE`* | VARCHAR(120) | `team` |
| `ATIVO` | BOOLEAN | `active` |
| `ATUALIZADO_EM` | TIMESTAMP | `occurredAt` do ultimo evento aceito |

**`CLIENTES`** — `cliente.upsert`

| Coluna | Tipo | Origem |
|---|---|---|
| `ID` | BIGINT PK | interno |
| `EXTERNAL_ID` | VARCHAR(120) | `externalId` (`hub-cliente-*` ou `erp-parceiro-*`) |
| `CODIGO_PARCEIRO` | VARCHAR(40) | `erpPartnerCode` — **chave de agregacao**: dois `EXTERNAL_ID` com o mesmo codigo sao o mesmo cliente |
| `NOME` | VARCHAR(180) | `name` |
| `PROJETO_EXTERNAL_ID` | VARCHAR(120) | `projectExternalId` (`exp-projeto-{id}`) |
| `CADASTRADO_NO_DS`* | BOOLEAN | `true` quando `externalId` comeca com `hub-cliente-` |
| `VIGENCIA_ATE` | TIMESTAMP | `dueAt` |
| `ATIVO` | BOOLEAN | `active` |

**`PROJETOS`** — `os.upsert` + `os.progresso`

| Coluna | Tipo | Origem |
|---|---|---|
| `ID` | BIGINT PK | interno |
| `EXTERNAL_ID` | VARCHAR(120) | `externalId` (`exp-projeto-{id}`) |
| `CODIGO` | VARCHAR(120) | `code` (`FAP-{id}`) |
| `CLIENTE_ID` | BIGINT FK | via `CLIENTES.PROJETO_EXTERNAL_ID = EXTERNAL_ID` |
| `STATUS` | VARCHAR(80) | `status` |
| `PROGRESSO` | DECIMAL(5,2) | `progress` |
| `DEMANDA_ID` | BIGINT FK NULL | `demandExternalId` |

**`DEMANDAS`** — `demanda.upsert`

| Coluna | Tipo | Origem |
|---|---|---|
| `ID` | BIGINT PK | interno |
| `EXTERNAL_ID` | VARCHAR(120) | `externalId` |
| `ORIGEM`* | VARCHAR(10) | `ERP` para `erp-demanda-*`, `KANBAN` para `hub-demanda-*` |
| `CODIGO`* | VARCHAR(40) | numero depois de `erp-demanda-` (o que o usuario reconhece) |
| `CLIENTE_ID` | BIGINT FK | `clientExternalId` |
| `NOME` | VARCHAR(240) | `name` |
| `STATUS` | VARCHAR(20) | `status` |
| `STATUS_ERP`* | VARCHAR(80) | `erpStatusLabel` |
| `TIPO`* | VARCHAR(80) | `requestType` |
| `MINUTOS_ESTIMADOS`* | INTEGER NULL | `estimatedMinutes` |
| `CRIADA_EM` | TIMESTAMP | `createdAt` |
| `ANALISADA_EM` | TIMESTAMP NULL | `analyzedAt` |
| `ATIVO` | BOOLEAN | `active` |

**`APONTAMENTOS`** (as OS) — `horas.apontar`

| Coluna | Tipo | Origem |
|---|---|---|
| `ID` | BIGINT PK | interno |
| `EXTERNAL_ID` | VARCHAR(120) | `externalId` (`exp-os-{id}`) |
| `USUARIO_ID` | BIGINT FK | `userExternalId` |
| `PROJETO_ID` | BIGINT FK | `osExternalId` |
| `CLIENTE_ID` | BIGINT FK | via `PROJETOS.CLIENTE_ID` |
| `DEMANDA_ID`* | BIGINT FK NULL | `demandExternalId` |
| `CODIGO_DEMANDA`* | VARCHAR(40) NULL | `demandCode` |
| `DATA_TRABALHO`* | DATE | `workDate`, ou data UTC de `startedAt` (ver 3.5) |
| `MINUTOS` | INTEGER | `minutes` |
| `DESCRICAO` | VARCHAR(500) | `description` |
| `TIPO_ATIVIDADE` | VARCHAR(120) | `activityType` |
| `ETAPA` | VARCHAR(160) | `stage` |
| `PROCESSO` | VARCHAR(240) | `process` |
| `ACEITE` | VARCHAR(20) | `acceptance` |
| `NUMERO_ERP` | VARCHAR(40) | `erpNumber` |
| `STATUS_ERP` | VARCHAR(80) | `erpStatus` |
| `EXCEDIDO` | BOOLEAN | `exceeded` |
| `PEDIDO` | VARCHAR(40) | `requestCode` |

**`AGENDA_EVENTOS`** — `agenda.evento.upsert`

| Coluna | Tipo | Origem |
|---|---|---|
| `ID` | BIGINT PK | interno |
| `EXTERNAL_ID` | VARCHAR(120) | `externalId` (`erp-evento-{NUEVENTO}`) |
| `USUARIO_ID` | BIGINT FK | `userExternalId` |
| `CLIENTE_ID` | BIGINT FK NULL | via `clientCode` = `CLIENTES.CODIGO_PARCEIRO`; nulo em ausencia/interno |
| `INICIO_EM` | TIMESTAMP | `start` |
| `FIM_EM` | TIMESTAMP | `end` |
| `DATA_LOCAL`* | DATE | data de `start` convertida para `America/Sao_Paulo` |
| `TITULO` | VARCHAR(240) | `title` |
| `CATEGORIA`* | VARCHAR(20) | `category` (`CLIENTE` quando ausente e houver `clientCode`) |
| `CONFIRMADO` | BOOLEAN | `confirmed` |
| `MINUTOS_PREVISTOS`* | INTEGER NULL | `plannedMinutes` |
| `QTD_OS`* | INTEGER NULL | `osCount` |
| `MINUTOS_OS`* | INTEGER NULL | `osMinutes` |
| `DEMANDA_ID` | BIGINT FK NULL | `demandExternalId` |
| `CODIGO_DEMANDA` | VARCHAR(40) NULL | `demandCode` |
| `STATUS_DEMANDA` | VARCHAR(20) NULL | `demandStatus` |
| `ATIVO` | BOOLEAN | `active` |

**`PLANEJAMENTOS`** — `planejamento.upsert` (sem mudanca; usado no grafico 7.13).

### 4.2. Tabela de apoio: `CALENDARIO`

Necessaria para dias uteis, ocupacao e jornada. Mantida pelo painel (nao vem do DS).

| Coluna | Tipo | Regra |
|---|---|---|
| `DATA` | DATE PK | Todos os dias, de 2 anos atras a 2 anos a frente |
| `ANO_MES` | CHAR(7) | `YYYY-MM` |
| `DIA_SEMANA` | SMALLINT | 1 = domingo ... 7 = sabado |
| `DIA_UTIL` | BOOLEAN | Seg a sex e nao feriado |
| `FERIADO` | VARCHAR(120) NULL | Nome do feriado nacional (e estadual, se a equipe for de um estado so) |
| `MINUTOS_JORNADA` | INTEGER | `480` em dia util, `0` fora dele |

### 4.3. Visoes sugeridas (o grafico le daqui)

| Visao | Grao | Conteudo |
|---|---|---|
| `VW_OS_MES` | usuario x cliente x mes | quantidade de OS, minutos, minutos por aceite, minutos sem demanda |
| `VW_AGENDA_DIA` | usuario x data | dia util?, categoria dominante (`CLIENTE`/`INTERNO`/`AUSENCIA`/livre), minutos previstos, minutos apontados, status de demanda |
| `VW_CLIENTE_ACUMULADO` | cliente x data | minutos apontados no dia e acumulados desde o inicio |
| `VW_DEMANDA_CONSUMO` | demanda | minutos estimados, minutos apontados, % consumido, primeira e ultima OS |

Regra para `VW_AGENDA_DIA` com mais de um agendamento no dia: prioridade `AUSENCIA` > `CLIENTE` > `INTERNO`; minutos previstos somados e limitados a `MINUTOS_JORNADA` do dia.

## 5. Regras de calculo comuns

1. **So o valor mais recente:** toda entidade e upsert pelo `externalId`. Nunca some versoes antigas do mesmo `externalId`.
2. **Inativos fora:** `active = false` nao entra em nenhum calculo.
3. **Dia:** agenda usa `DATA_LOCAL` (Brasilia); OS usa `DATA_TRABALHO`. Mes = `YYYY-MM` desse dia.
4. **Horas:** guarde minutos; exiba horas com uma casa (`minutos / 60`).
5. **Jornada:** 8 h (480 min) por dia util. Um agendamento de 08:00 as 18:00 = 480 min previstos (a janela tem 1 h de intervalo e o padrao da OS de dia inteiro e 8 h).
6. **`SEM_EXPERIENCE`** fica fora de todo indicador de conformidade (a fonte nao respondeu, nao e falha do consultor).
7. **Previsto x realizado:** previsto vem da agenda (`MINUTOS_PREVISTOS` de `CATEGORIA = CLIENTE`); realizado vem das OS (`APONTAMENTOS.MINUTOS`). Nao use `planejamento.upsert` como previsto: a Experience so envia tarefa em aberto e ela repete a agenda.
8. **Cliente:** agregue por `CLIENTES.CODIGO_PARCEIRO`, nao por `EXTERNAL_ID`.
9. **Dado parcial:** enquanto um campo "a enviar" nao chega, o grafico que depende dele mostra "sem dados" para a instalacao (nao zero).

## 6. Filtros globais (valem para todas as telas)

| Filtro | Tipo | Padrao | Observacao |
|---|---|---|---|
| Periodo | intervalo de datas + atalhos | mes atual | Atalhos: este mes, mes anterior, proximo mes, ultimos 3 / 6 / 12 meses, ano atual. Graficos de "previsto" aceitam datas futuras |
| Comparar com | alternancia | desligado | Periodo anterior de mesmo tamanho ou mesmo mes do ano anterior; mostra variacao % |
| Equipe | multipla escolha | todas | `USUARIOS.EQUIPE` |
| Cargo | multipla escolha | todos | `USUARIOS.CARGO` |
| Consultor | multipla escolha com busca | todos | `USUARIOS.NOME` |
| Cliente | multipla escolha com busca | todos | Por `CODIGO_PARCEIRO`; opcao "so cadastrados no DS" |
| Demanda | multipla escolha com busca | todas | Mostra `CODIGO - NOME` |
| Tipo de solicitacao | multipla escolha | todos | `DEMANDAS.TIPO` |
| Status da demanda na agenda | multipla escolha | todos | `STATUS_DEMANDA` |
| Aceite da OS | multipla escolha | todos | `GERADO`, `CONCLUIDO`, `PENDENTE`, sem aceite |
| Etapa / Processo / Tipo de atividade | multipla escolha | todos | Das OS |
| Granularidade | lista | mes | dia, semana, mes (para os graficos de serie) |

Recomendacoes de fluidez:

- Os filtros ficam no topo, fixos, e valem para a tela inteira; o estado vai para a URL (compartilhar o link reproduz a visao).
- Clique numa barra/fatia filtra o resto da tela por aquele consultor, cliente ou demanda (filtro cruzado) e aparece como "chip" removivel.
- Todo numero de cartao abre a lista de registros que o compoe (drill-down para os agendamentos ou OS).
- Consultor ve so os proprios dados; lideranca ve a equipe. (Controle de acesso do painel, fora do DS.)

## 7. Catalogo de graficos

Cada grafico: o que responde, de onde vem, como calcular e a visualizacao sugerida. "Filtros" lista os que alem dos globais fazem sentido nele. A coluna **Depende de** remete a secao 2.

### Tela 1 — Produtividade

**7.1 OS apontadas por mes (quantidade e horas)**
- Responde: quanto o time produziu, mes a mes.
- Fonte: `APONTAMENTOS` por `ANO_MES(DATA_TRABALHO)`.
- Calculo: `COUNT(*)` OS e `SUM(MINUTOS)/60` horas.
- Visual: colunas (horas) + linha (quantidade de OS), eixo duplo; ultimos 12 meses.
- Depende de: nada (item 4 melhora a data).

**7.2 Horas: realizado no mes anterior x previsto neste mes e no proximo**
- Responde: o ritmo esta mantido? o proximo mes ja esta coberto?
- Fonte: realizado = `APONTAMENTOS` do mes anterior; previsto = `AGENDA_EVENTOS` (`CATEGORIA = CLIENTE`, ativos) do mes atual e do seguinte.
- Calculo: tres barras — `SUM(MINUTOS)` mes-1; `SUM(MINUTOS_PREVISTOS)` mes atual; `SUM(MINUTOS_PREVISTOS)` mes+1. Mostrar tambem a capacidade (`SUM(MINUTOS_JORNADA)` dos dias uteis de cada mes, menos ausencias) como marcador.
- Visual: barras agrupadas por consultor ou total; marcador de capacidade.
- Depende de: 5, 7, 8.

**7.3 Horas agendadas x apontadas no mes**
- Responde: o que foi reservado virou trabalho registrado?
- Fonte: `AGENDA_EVENTOS` (`MINUTOS_PREVISTOS`, `MINUTOS_OS`) e `APONTAMENTOS`.
- Calculo: por consultor no mes, `SUM(MINUTOS_PREVISTOS)` x `SUM(APONTAMENTOS.MINUTOS)`; diferenca e %.
- Visual: barras lado a lado por consultor; serie por dia no detalhe.
- Depende de: 5.

**7.4 Horas agendadas x apontadas por cliente**
- Mesmo calculo do 7.3, agrupado por cliente (`CODIGO_PARCEIRO`).
- Visual: barras horizontais ordenadas pelo maior previsto; destaque vermelho quando apontado < 80% do previsto em dia ja passado.
- Depende de: 5, 9.

**7.5 Horas por tipo de atividade, etapa e processo**
- Fonte: `APONTAMENTOS` (`TIPO_ATIVIDADE`, `ETAPA`, `PROCESSO`).
- Visual: rosca ou barras empilhadas 100% por mes.

**7.6 Ranking de consultores no periodo**
- Horas apontadas, quantidade de OS, % de dias com agenda conferindo (7.9), % de OS com aceite.
- Visual: tabela ordenavel com mini-barras.

### Tela 2 — Qualidade do processo (demanda, agenda, OS)

**7.7 Demandas sem OS**
- Responde: ha demanda aprovada/agendada sem nenhum trabalho registrado?
- Fonte: `DEMANDAS` (`ORIGEM = ERP`, ativas) sem nenhum `APONTAMENTOS.DEMANDA_ID` no periodo; e dias `STATUS_DEMANDA = DEMANDA_SEM_OS` ja passados.
- Calculo: duas contagens — demandas sem nenhuma OS; dias reservados de demanda sem OS.
- Visual: cartao numerico + lista (demanda, cliente, dias reservados, ultima agenda).
- Depende de: 1, 3.

**7.8 OS sem demanda**
- Fonte: `APONTAMENTOS` com `CODIGO_DEMANDA` nulo.
- Calculo: quantidade e horas; % sobre o total do periodo.
- Visual: cartao + tendencia mensal (quanto menor, melhor).
- Depende de: 2.

**7.9 Agendamentos sem OS**
- Responde: dias reservados que passaram sem OS lancada.
- Fonte: `AGENDA_EVENTOS` (`CATEGORIA = CLIENTE`, ativos, `DATA_LOCAL < hoje`) com `QTD_OS = 0`.
- Calculo: contagem e minutos previstos perdidos (`SUM(MINUTOS_PREVISTOS)`).
- Visual: cartao + calendario-mapa de calor por consultor (dia vermelho = sem OS).
- Depende de: 5 (sem ele, use `STATUS_DEMANDA = DEMANDA_SEM_OS`, que nao cobre agendamento sem demanda).

**7.10 Conformidade de demandas na agenda**
- Fonte: `AGENDA_EVENTOS.STATUS_DEMANDA` (dias passados, sem `SEM_EXPERIENCE`).
- Calculo: distribuicao dos 5 status; taxa de conformidade = `CONFERE / total`.
- Visual: barras empilhadas 100% por mes e por consultor; cartao com a taxa.
- Depende de: 3.

**7.11 OS com pendencia**
- Aceite pendente (`ACEITE` nulo ou `PENDENTE`), sem numero no ERP (`NUMERO_ERP` nulo), horas excedidas (`EXCEDIDO = true`).
- Visual: tres cartoes com drill-down para a lista.

### Tela 3 — Clientes e demandas

**7.12 Horas atendidas por cliente, acumuladas**
- Responde: quanto cada cliente ja consumiu ate hoje.
- Fonte: `VW_CLIENTE_ACUMULADO`.
- Calculo: soma acumulada de `MINUTOS` por cliente ao longo das datas.
- Visual: linhas acumuladas (uma por cliente, top 10 + "outros"); tabela ao lado com total, ultimo mes e ultima OS.

**7.13 Consumo da demanda (estimado x apontado)**
- Fonte: `VW_DEMANDA_CONSUMO`.
- Calculo: `SUM(APONTAMENTOS.MINUTOS) / DEMANDAS.MINUTOS_ESTIMADOS`; projecao de termino pelo ritmo das ultimas 4 semanas e pela agenda futura (`MINUTOS_PREVISTOS` da demanda).
- Visual: barra de progresso por demanda (verde < 80%, amarelo 80–100%, vermelho > 100%) e burn-up no detalhe.
- Depende de: 1, 2, 10.

**7.14 Demandas por status e tempo ate a primeira OS**
- Fonte: `DEMANDAS` + primeira `APONTAMENTOS.DATA_TRABALHO`.
- Calculo: contagem por `STATUS`/`STATUS_ERP`; mediana de dias entre `CRIADA_EM` (ou `ANALISADA_EM`) e a primeira OS.
- Visual: funil (enviado > analisando > analisado > com OS) e cartao da mediana.

### Tela 4 — Agenda e capacidade

**7.15 Dias da agenda: ocupados, livres e ausencias no mes**
- Responde: quanto da capacidade do mes ja esta comprometida?
- Fonte: `CALENDARIO` (dias uteis) + `VW_AGENDA_DIA`.
- Calculo por consultor e mes: dias uteis; ocupados (`CLIENTE` ou `INTERNO`); ausencia (`AUSENCIA`); livres = uteis - ocupados - ausencia. Taxa de ocupacao = ocupados / (uteis - ausencia).
- Visual: barra empilhada por consultor (ocupado/ausencia/livre) + calendario mensal colorido por dia.
- Depende de: 6, 7, 8, 9.

**7.16 Capacidade livre dos proximos 60 dias**
- Mesmo calculo do 7.15 para o mes atual (a partir de hoje) e o seguinte, em horas (`dias livres x 8`).
- Visual: cartao por consultor ordenado pelo mais livre — ajuda a lideranca a distribuir demanda nova.

**7.17 Planejamentos atrasados**
- Fonte: `PLANEJAMENTOS` com `STATUS = ATRASADA`.
- Visual: cartao + lista.

## 8. Ordem de implementacao sugerida

1. **Ja possivel com os dados de hoje:** 7.1, 7.5, 7.6 (sem conformidade), 7.11, 7.12, 7.14 (sem OS por demanda), 7.17.
2. **Com a opcao de demandas ligada no DS (itens 1–3 da secao 2):** 7.7, 7.8, 7.10, 7.13 (sem estimado).
3. **Depois da atualizacao do DS (itens 4–11):** 7.2, 7.3, 7.4, 7.9, 7.13 completo, 7.15, 7.16 e os filtros de equipe/cargo.

Em cada fase, os graficos da fase seguinte ja podem existir, mostrando "sem dados" onde o campo ainda nao chegou (regra 9 da secao 5).

## 9. Validacao no receptor (campos novos)

| Situacao | Resposta |
|---|---|
| Campo novo ausente | Aceitar |
| `category` fora de `CLIENTE`, `AUSENCIA`, `INTERNO` | `failed`: `data.category nao suportado` |
| `clientCode` ausente com `category = CLIENTE` ou sem `category` | `failed`: mensagem atual de cliente da agenda |
| `plannedMinutes`, `osCount`, `osMinutes`, `estimatedMinutes` negativos ou nao inteiros | `failed` |
| `workDate` fora de `YYYY-MM-DD` | `failed`: `data.workDate invalido` |
| `role`/`team`/`requestType`/`erpStatusLabel` acima do limite | `failed` |

## 10. Checklist de aceite do painel

- Reenviar o mesmo lote nao altera nenhum numero (idempotencia).
- Reenvio de agendamento com `osCount` diferente atualiza 7.3, 7.9 e 7.10 sem duplicar.
- Agendamento reenviado com `active: false` some de 7.2, 7.15 e 7.16.
- Cliente com `hub-cliente-*` e `erp-parceiro-*` de mesmo `erpPartnerCode` aparece uma vez so.
- Uma OS com `startedAt = 2026-09-22T00:00:00.000Z` e sem `workDate` conta em 22/09, nao em 21/09.
- Ferias de 03/08 a 07/08 contam 5 dias de ausencia e nao reduzem a taxa de ocupacao.
- Filtro por consultor, cliente e periodo muda todos os graficos da tela e fica na URL.
