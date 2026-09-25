# Integração API — dados disponíveis para novos eventos e gráficos

**Data:** 2026-09-25
**Contexto:** os quatro tipos do contrato atual (`usuario.upsert`, `os.upsert`, `os.progresso`,
`horas.apontar`) estão homologados — 18 eventos aceitos, central de monitoramento montando os
dados. Este documento lista o que MAIS o desktop tem hoje, para o receptor criar os endpoints e
payloads antes de o envio automático ser ligado.

**Convenções que valem para todo tipo novo** (as mesmas do contrato atual):

- Envelope inalterado: `{ version, installationId, key, events: [...] }`, 1 a 200 eventos.
- `event.id` determinístico: mesmo dado = mesmo id (o receptor responde `duplicate`); só uma
  mudança real gera id novo. Caracteres `A-Z a-z 0-9 . _ : @ / -`, até 120.
- `occurredAt` em ISO 8601 UTC. Quando a fonte não diz quando a mudança aconteceu, é o momento
  em que o desktop a detectou (dito em cada seção).
- Uma instalação = um consultor. Tudo que é "do consultor" já vem recortado por ele.
- `externalId` com prefixo da origem (`exp-`, `hub-`, `erp-`) para não colidir entre fontes.

---

## 1. Visão geral

| # | Domínio | Origem no desktop | Atualiza | Já enviado? | Gráficos que viabiliza |
|---|---|---|---|---|---|
| 1 | Consultor | JWT da Experience | Por sessão | ✅ `usuario.upsert` | — |
| 2 | Projetos (FAP) | Experience, por cliente cadastrado | 15 min | ✅ `os.upsert` / `os.progresso` | Previsto × feito, % por projeto |
| 3 | OS lançadas (apontamentos) | Experience `/orders/filtering` | 15 min | ✅ `horas.apontar` (parcial) | Horas por dia/semana/cliente, aceite |
| 4 | **Kanban de tarefas** (Escopo) | Banco local do hub | Na hora | ❌ | Kanban, throughput, lead time, burndown, horas estimadas |
| 5 | Demandas (documentos de escopo) | Banco local do hub | Na hora | ❌ | Tarefas por demanda, % concluído |
| 6 | Tarefas planejadas (Experience) | Experience `/tasks` | 15 min | ❌ | Planejado × realizado, atrasos |
| 7 | Agenda de Recursos (ERP) | Snapshot local do ERP | Sob demanda / ciclo | ❌ | Ocupação, alocação por cliente |
| 8 | Clientes | Cadastro do hub | Na hora | ❌ | Dimensão para todos os outros |
| 9 | Saúde das bases dos clientes | Monitor do hub | Sob demanda (cache 60 s) | ❌ | Disponibilidade, latência, versão |
| 10 | Sessões Sankhya (keepalive) | Shell desktop | 10 min | ❌ | Quedas de sessão |
| 11 | Autosync de repositórios | git-autosync | Por execução | ❌ | Commits por dia/cliente |

---

## 2. Projetos e OS — o que já vai e o que ainda não vai

Hoje o `os.upsert` manda `code`, `title`, `status`, `progress` e o coordenador em `description`; o
`horas.apontar` manda `minutes`, `description` e `startedAt`. A Experience devolve mais campos,
ainda não enviados, que enriquecem os gráficos **sem tipo novo** — basta o receptor aceitar
campos opcionais:

| Campo da OS (Experience) | Origem | Uso em gráfico |
|---|---|---|
| `tipo` | `order_type` | Horas por tipo de atividade |
| `etapa` | `stage_name` | Horas por etapa do projeto |
| `processos` | `process_all` | Horas por processo |
| `statusAceite` | `accepted_os_status` (`Gerado`, `Concluído`, vazio) | OS pendentes de aceite |
| `numeroSankhya` / `statusNumeroSankhya` | `numos_sankhya` / `..._status` | OS que chegaram ao ERP |
| `horasExcedidas` | `volume_hours_exceeded` | Alerta de estouro |
| `erro` | `error_description` | Falhas de integração com o ERP |
| `pedido` | `application_code` | Agrupar por pedido/chamado |
| `tarefasRealizadas` | `GET /orders/{id}` (1 chamada por OS) | Texto do que foi feito — só se o receptor precisar |

**Proposta:** estender `horas.apontar` com opcionais `activityType`, `stage`, `process`,
`acceptance` (`GERADO`/`CONCLUIDO`/`PENDENTE`), `erpNumber`, `erpStatus`, `exceeded`,
`requestCode`. Mudança de aceite passa a gerar nova versão do evento (entra no hash do id).

---

## 3. Kanban de tarefas (Escopo) — prioridade

Fonte: tabela `escopo_tarefas` do hub (`src/sankhya/escopo.ts`). A IA quebra o documento de escopo
em tarefas; pessoa ou IA externa movem os cartões. É o dado mais rico para gráfico e **não
depende de sessão** de nenhum sistema.

### Campos

| Campo | Tipo | Valores / observação |
|---|---|---|
| `id` | inteiro | Estável no hub |
| `clienteId` | inteiro | Liga ao cliente (seção 8) |
| `documentoId` | inteiro ou nulo | Demanda de origem (seção 5); nulo = tarefa avulsa |
| `titulo` | texto | |
| `descricao` | texto | Pode ser longo |
| `grupo` | texto | Feature/épico |
| `tipo` | enum | `backend`, `frontend`, `dados`, `relatorio`, `bi`, `integracao`, `configuracao`, `teste`, `documentacao`, `outro` |
| `estimativaHoras` | número | 1 a 16 por tarefa (regra da IA) |
| `prioridade` | enum | `alta`, `media`, `baixa` |
| `criteriosAceite` | texto | |
| `notas` | texto | Andamento registrado por quem executa |
| `estado` | enum | **Colunas, em ordem:** `backlog`, `a_fazer`, `em_andamento`, `em_revisao`, `concluido` |
| `ordem` | inteiro | Posição dentro da coluna |
| `criadaEm` / `atualizadaEm` | data-hora | |

**Limite importante:** o hub guarda só o estado ATUAL — não há histórico de movimentação. O
histórico passa a existir a partir do momento em que o desktop enviar os eventos de transição
abaixo (detectados por comparação com o último estado enviado, como o `os.progresso`).

### Tipos propostos

**`tarefa.upsert`** — cria ou atualiza o cartão.
```json
{
  "id": "tarefa:421:3f9a1c2e",
  "type": "tarefa.upsert",
  "occurredAt": "2026-09-25T14:00:00.000Z",
  "data": {
    "externalId": "hub-tarefa-421",
    "userExternalId": "exp-usuario:ana@sankhya.com.br",
    "clientExternalId": "hub-cliente-7",
    "demandExternalId": "hub-demanda-12",
    "title": "Criar tela de apontamento",
    "group": "Apontamentos",
    "kind": "frontend",
    "priority": "ALTA",
    "estimatedMinutes": 360,
    "status": "EM_ANDAMENTO",
    "position": 2,
    "createdAt": "2026-09-20T13:10:00.000Z",
    "updatedAt": "2026-09-25T13:58:00.000Z"
  }
}
```
Id: `tarefa:<id>:<hash8(título|grupo|tipo|prioridade|estimativa|estado|ordem)>`.

**`tarefa.transicao`** — uma mudança de coluna (é o que alimenta throughput, lead time e
burndown).
```json
{
  "id": "tarefa-mov:421:em_andamento:2026-09-25T13:58:00.000Z",
  "type": "tarefa.transicao",
  "occurredAt": "2026-09-25T13:58:00.000Z",
  "data": {
    "taskExternalId": "hub-tarefa-421",
    "from": "A_FAZER",
    "to": "EM_ANDAMENTO"
  }
}
```
`occurredAt` = `atualizadaEm` da tarefa (é quando o hub gravou a mudança). `from` vazio na
primeira vez que a tarefa é vista.

**Gráficos:** quadro Kanban por cliente/demanda; tarefas por coluna ao longo do tempo (CFD);
throughput semanal (entradas em `CONCLUIDO`); lead time (`backlog` → `concluido`) e cycle time
(`em_andamento` → `concluido`); horas estimadas restantes (burndown); estimado × apontado quando
cruzado com `horas.apontar` pelo cliente.

**A decidir:** mandar `descricao`, `criteriosAceite` e `notas` (texto livre, pode conter detalhe
do cliente) ou só os campos estruturados. Proposta: não mandar por padrão.

---

## 4. Demandas (documentos de escopo)

Fonte: `DocumentoEscopo`. Cada documento é uma demanda de um cliente e agrupa um quadro.

| Campo | Observação |
|---|---|
| `id`, `clienteId` | Estáveis |
| `demanda` | Nome da demanda |
| `nome`, `tipo`, `bytes` | Arquivo (`docx`, `pdf`, `md`, `txt`) |
| `status` | `enviado`, `analisando`, `analisado`, `falhou` |
| `enviadoEm`, `analisadoEm` | |
| `resumo` | Resumo escrito pela IA |

**`demanda.upsert`**: `externalId` `hub-demanda-<id>`, `clientExternalId`, `name`, `status`,
`createdAt`, `analyzedAt`. `resumo` opcional (texto livre — mesma decisão da seção 3).
**Gráficos:** demandas por cliente, % de tarefas concluídas por demanda, horas estimadas por demanda.

---

## 5. Tarefas planejadas da Experience

Fonte: `experience.tarefas()` — a agenda FUTURA do consultor no projeto (o que ainda vai virar OS).

| Campo | Observação |
|---|---|
| `id` | Estável na Experience |
| `dia` (`taskDate`) | Dia planejado |
| `horaInicio`, `horaFim` | |
| `procedimento`, `etapa`, `processo` | |
| `taskStatus` | Classificado pela Experience: `Hoje`, `Futura`, `Atrasada` |
| `pedido`, `observacoes` | |

**`planejamento.upsert`**: `externalId` `exp-tarefa-<id>`, `osExternalId` do projeto,
`userExternalId`, `plannedDate`, `startTime`, `endTime`, `stage`, `process`, `status`
(`HOJE`/`FUTURA`/`ATRASADA`). Id: `plan:<id>:<hash8(dia|horas|status)>`.
**Gráficos:** planejado × realizado por semana (cruzando com `horas.apontar`), tarefas atrasadas,
carga planejada dos próximos dias.

---

## 6. Agenda de Recursos (ERP corporativo)

Fonte: snapshot local importado da tela Agenda de Recursos (`AgendaRecursosSP.carregarAgendas`,
validado em 2026-09-24: 273 eventos no mês).

| Campo | Observação |
|---|---|
| `nuevento` | Id do evento no ERP |
| `codusu`, `nomeusu`, `descrcargo`, `corHex` | Recurso (pessoa) |
| `codparc`, `nomeparc` | Parceiro/cliente atendido |
| `inicio`, `fim`, `allday` | `YYYY-MM-DD HH:mm:ss` |
| `descrabrev`, `descrlonga` | Título e descrição |
| `tipo`, `confirmado` | |
| `nufap`, `numetapa`, `nueventopai` | Liga ao FAP/etapa — cruzável com o projeto da seção 2 |
| `dhlcto`, `usulancador` | Quando e quem lançou |
| `financiallate`, `diastraso` | Atraso financeiro (quase sempre vazio) |

**Cuidado:** a agenda traz TODOS os recursos que o usuário enxerga no ERP, não só ele. Proposta:
enviar só os eventos do próprio consultor (`codusu` dele), a menos que a central precise da visão
da equipe — decisão de quem mantém a central, com implicação de privacidade.

**`agenda.evento.upsert`**: `externalId` `erp-evento-<nuevento>`, `userExternalId`, `clientCode`
(`codparc`), `clientName`, `start`, `end`, `allDay`, `title`, `kind`, `confirmed`, `fapCode`
(`nufap`). Id: `agenda:<nuevento>:<hash8(início|fim|título|confirmado)>`.
**Gráficos:** ocupação por dia/semana, horas alocadas por cliente, alocado (agenda) × apontado
(Experience).

---

## 7. Clientes

Fonte: cadastro do hub (`Cliente`). Dimensão comum às seções 3 a 6.

| Campo | Enviar? |
|---|---|
| `id`, `nome` | Sim |
| `experienceProjetoId` | Sim — liga ao projeto (`exp-projeto-<id>`) |
| `agendaCodparc` | Sim — liga à agenda do ERP |
| `demandaFim` | Sim — prazo da demanda, útil para gráfico de prazo |
| `sankhyaUrl` | Talvez — identifica a base do cliente |
| `anotacoes`, `repositorioLocal`, `repositorioRemoto` | **Não** (texto livre / caminho local) |

**`cliente.upsert`**: `externalId` `hub-cliente-<id>`, `name`, `projectExternalId`, `erpPartnerCode`,
`dueAt`.

---

## 8. Saúde das bases dos clientes

Fonte: monitor do hub (`StatusBase` por base cadastrada com `monitorar` ligado).

| Campo | Observação |
|---|---|
| `baseId`, `ambiente` | `producao`, `teste`, `homologacao`, `outro` |
| `status` | `up`, `degraded`, `down`, `unknown` |
| `latenciaMs`, `versao` | Versão do Sankhya da base |
| `mensagem`, `medidoEm` | |

**`base.status`**: um evento por MUDANÇA de status (não por medição). Hoje o hub só mede quando a tela pede; para um histórico contínuo o desktop precisaria de um ciclo próprio, com `latencyMs` da medição.
Id: `base:<baseId>:<status>:<medidoEm>`. **Nunca** mandar URL com usuário, usuário ou senha da
base (o cadastro tem, cifrados — ficam no desktop).
**Gráficos:** disponibilidade por cliente/ambiente, histórico de quedas, versões em uso.

---

## 9. Sessões Sankhya e autosync

- **Keepalive** (`desktop.log`): `keepalive-sessao-caiu` / `keepalive-sessao-voltou` por aba (ERP ou
  base). Tipo possível `sessao.evento` (`system`: `erp`/host da base, `state`: `caiu`/`voltou`).
  Serve a um gráfico de quedas de sessão; valor baixo para a central, opcional.
- **Autosync de repositórios**: último resultado por repositório e commits (`hash`, `date`,
  `message`). Tipo possível `repo.commit` ligado ao cliente pelo repositório. Mensagem de commit
  pode citar cliente — mesma decisão de texto livre.

---

## 10. O que NÃO sai do desktop, em nenhum tipo

Senhas e usuários de base, chave da API, tokens/JWT, cookies de sessão, conteúdo do `server.log`
dos clientes, caminhos locais do disco, `anotacoes` dos clientes, e-mails de contatos dos clientes.

## 11. Ordem de dependência sugerida para os tipos novos

`usuario` → `cliente` → `os` (projeto) → `demanda` → `tarefa.upsert` → `tarefa.transicao` →
`planejamento` → `agenda.evento` → `horas.apontar` → `base.status` / `sessao.evento`.

## 12. Perguntas para a central antes de criar os endpoints

1. Kanban: só campos estruturados, ou também descrição, critérios e notas?
2. Agenda de Recursos: só o consultor, ou a equipe visível no ERP?
3. Os opcionais novos de `horas.apontar` (seção 2) entram no tipo atual ou num tipo novo?
4. Status em MAIÚSCULAS (`EM_ANDAMENTO`) como hoje, ou os valores do hub (`em_andamento`)?
5. Os tipos das seções 8 e 9 interessam, ou ficam fora do primeiro corte?
