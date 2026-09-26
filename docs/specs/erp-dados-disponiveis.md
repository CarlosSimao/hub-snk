# Dados do Sankhya ERP que o DS consegue trazer

**Data:** 2026-09-25
**Para quê:** base para os painéis do corporativo e para a busca entre bases (item 6 do
backlog), e para decidir o que mais pode virar evento da Integração API.

## Como o DS lê

Toda leitura sai de **dentro da aba logada** (`desktop/src/chamarNaAba.ts`), com a sessão do
próprio usuário. Consequências medidas:

- **Só o que o usuário já vê.** A ACL do Sankhya vale por tabela e por campo. Não é um desvio
  de permissão.
- **Sem aba, sem dado.** De fora da aba o `service.sbr` nega tudo, até com login por API
  (medido em 2026-09-24 no corporativo). Aba fechada ou sessão caída = sem leitura.
- **Só leitura.** Gravar (botão de ação, salvar registro) exige capturar a chamada exata de
  cada caso e confirmação explícita.
- **`/mgeos`** (telas de OS) precisa do `mgeSession` na URL — o executor já manda.

Legenda: ✅ medido em sessão real · ⚠️ negado pela ACL · ❔ ainda não medido.

## ERP corporativo (skw.sankhya.com.br)

| Dado | Como | Estado | Serve para |
|---|---|---|---|
| Agenda de Recursos (eventos de todos os recursos visíveis) | `AgendaRecursosSP.carregarAgendas` em `/mgeos` | ✅ 273 eventos/mês | Ocupação, agenda por cliente (hoje: evento `agenda.evento.upsert`, só do próprio consultor) |
| Cadastro do próprio usuário: `CODUSU`, `NOMEUSU`, `EMAIL`, `CODEMP`, `CODGRUPO`, `CODVEND` | `loadRecords` `Usuario` | ✅ | Identificar o consultor |
| Cargo do usuário (`CODCARGO`, `DESCRCARGO`) | `loadRecords` `Usuario` | ⚠️ negado por campo | — |
| Financeiro | `loadRecords` | ⚠️ negado por tabela | — |
| Parceiros | `loadRecords` `Parceiro` / tela `br.com.sankhya.core.cad.parceiros` | ✅ tela abre no registro (link direto) | Dados do cliente atendido |
| Abrir qualquer tela no registro | `system.jsp#app/<b64 resourceID>/<b64 {"CAMPO":valor}>` | ✅ Parceiros `CODPARC=78764` | Atalhos dos painéis |
| Solicitação de Serviços DS | tela `solicitacaoservicos.br.com.sankhya.servicosds.solicitacaoservicos` | ❔ entidade e ACL a medir | Painel "minhas solicitações" |
| Planejamento da Agenda de Recursos | dashboard `nuDsb.1997.1` | ❔ | Painel de alocação |
| SER Gestão de Serviços | dashboard `nuDsb.549.1` | ❔ | Painel de serviços |
| Alocação de Pedidos/Demandas | view `AD_VWESCPED` | ❔ | Painel de demandas alocadas |
| Ordens de serviço (OS do ERP) | entidade a descobrir | ❔ | OS por status/prazo |

Para os itens ❔, o caminho é o mesmo dos medidos: descobrir a entidade (ou o serviço que a
tela chama, capturando a rede de uma abertura real) e fazer uma leitura de teste pela aba.
Dashboard (`nuDsb`) tem ID por base — não é portável entre bases.

## Bases de cliente

| Dado | Como | Estado |
|---|---|---|
| Módulos Java adicionais | `loadRecords` `ModuloAdicional` | ✅ painel Diagnóstico |
| Botões de ação (tipo, instância, módulo, classe da Rotina Java) | `loadRecords` `BotaoAcao` (TSIBTA) | ✅ painel Diagnóstico |
| Parâmetros do sistema, pela chave | `loadRecords` `ParametroSistema` (TSIPAR), `CODUSU = 0` | ✅ painel Diagnóstico (valor mascarado se parece segredo) |
| Versão do Sankhya | monitor de bases | ✅ |
| `server.log` do WildFly (tail/offset) | módulo `serverlog` + `ActionButtonsSP.executeJava` | ✅ (exige o módulo instalado na base) |
| Qualquer entidade que o usuário do cliente veja | `loadRecords` | ✅ mecanismo; cada entidade a validar |
| Abrir qualquer tela no registro | link direto + Entrar automaticamente | ✅ Parceiros `CODPARC=1` |

## Busca entre bases abertas (proposta)

Mesma leitura em todas as abas de cliente abertas, uma por vez (a fila é por aba), com o
resultado — ou o erro — de cada base na sua linha. Exemplos que já saem do diagnóstico:
"em quais clientes este módulo/botão está instalado", "qual o valor deste parâmetro em cada
cliente", "qual a versão de cada base".
