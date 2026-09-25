# Integração API — mapeamento dos eventos (passo 1)

**Data:** 2026-09-25
**Complementa:** `integracao-api-desktop-envio-eventos.md`, seção 6.
**Decisão do usuário:** a "OS" do receptor é o **projeto (FAP) da Experience**. Cada OS
lançada na Experience é um **apontamento de horas** desse projeto.

O motivo: na Experience, a "OS" que o consultor lança já é um apontamento individual —
tem `order_id` estável, dia (`order_done_date`) e duração própria (`diff_time`). O
projeto tem horas previstas e feitas (`total_expected`, `total_done`), o que dá um
progresso real. Com isso os quatro tipos saem de dado existente, sem nada sintetizado.

## Escopo de uma instalação

Uma instalação = um consultor. Só entram os projetos cadastrados no hub (clientes com ID
de projeto da Experience) e só as OS **do próprio consultor** (`personId` do filtro de
`/orders/filtering`), nunca as do projeto inteiro.

## Tipos

| Tipo | Origem | Campo do receptor | Valor |
|---|---|---|---|
| `usuario.upsert` | JWT da Experience + `/persons/implantation/{projeto}` | `externalId` | `exp-usuario:<email>` (minúsculo; caracteres fora do permitido viram `_`) |
| | | `name` | `person_name` |
| | | `email` | e-mail do JWT |
| | | `active` | `true` |
| `os.upsert` | Projeto cadastrado no hub | `externalId` | `exp-projeto-<projetoId>` |
| | | `userExternalId` | o do consultor |
| | | `code` | `FAP-<projetoId>` |
| | | `title` | nome do cliente no hub (ou `company_name`) |
| | | `status` | `EM_ANDAMENTO`; `CONCLUIDO` quando feito ≥ previsto |
| | | `progress` | `min(100, round(feito / previsto × 100))`; 0 sem previsto |
| | | `description` | coordenador do FAP (`fap_coordinator`), quando houver |
| `os.progresso` | `total_done` / `total_expected` do projeto | `osExternalId` | `exp-projeto-<projetoId>` |
| | | `progress`, `status` | mesma regra do `os.upsert` |
| `horas.apontar` | Cada OS da Experience do consultor | `externalId` | `exp-os-<order_id>` |
| | | `osExternalId` | `exp-projeto-<projetoId>` |
| | | `userExternalId` | o do consultor |
| | | `minutes` | `diff_time` (`HH:MM`) em minutos; `00:00` ou inválido não entra |
| | | `description` | `description` da OS, cortada em 500 |
| | | `startedAt` | `order_done_date` à 00:00 UTC (só a data é confiável) |

## IDs de evento (estáveis e determinísticos)

- `usuario.upsert`: `usuario:<externalId>:<hash8(name|email|active)>` — muda só se o dado mudar.
- `os.upsert`: `os:<projetoId>:<hash8(code|title|status|description)>`.
- `os.progresso`: `prog:<projetoId>:<minutos feitos>` — só nasce quando o feito muda. Consultar
  de novo com o mesmo feito repete o ID e o receptor devolve `duplicate`.
- `horas.apontar`: `horas:<order_id>:<hash8(minutes|description|dia)>` — uma edição da OS na
  Experience gera nova versão; o retry mantém o ID.

`hash8` = 8 primeiros hex do SHA-256. Todos cabem em 120 caracteres.

## Quando gerar

No ciclo que já consulta a Experience (resumo/agenda por cliente), comparando com o último
estado enviado por entidade. Não gerar evento a cada consulta: só quando o hash ou o feito
mudar. OS excluída na Experience não tem evento no contrato; fica registrada e não é enviada.

## Em aberto (confirmar com quem mantém a API)

- Se a OS da Experience é editável depois de lançada (se não, basta `horas:<order_id>`).
- Valores de `status` que o Kanban do receptor espera (`EM_ANDAMENTO`/`CONCLUIDO` são proposta).
- Se `total_expected` vazio (projeto sem previsão) deve mandar progresso 0 ou não mandar.
