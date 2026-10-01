# Mapeamento do kanban (DS-hub)

Mapeamento do funcionamento do kanban de escopo do sankhya-hub, para integração na versão do Carlos. Baseado na leitura do código em 2026-10-01 (branch `hub-suite`).

Arquivos lidos: `src/routesEscopo.ts`, `src/sankhya/escopo.ts`, `src/sankhya/escopoIa.ts`, `src/sankhya/escopoCompartilhado.ts`, `src/routesMcp.ts`, `src/mcp/servidor.ts`, `web/src/components/sankhya/EscopoDoCliente.tsx`, `web/src/hooks/useEscopo.ts`.

## 1. Entrada do documento

- UI: `EscopoDoCliente.tsx`, botão **Nova demanda**. Aceita `.docx`, `.pdf`, `.md`, `.txt`. `.doc` é recusado.
- Rota: `POST /api/clientes/:id/escopo/documentos` (`src/routesEscopo.ts:234`).
  - O arquivo vai como **base64 dentro do JSON**, sem multipart.
  - Limite de 20 MB no arquivo e 30 MB no corpo.
- Extração de texto:
  - `.docx` passa por `textoDoDocx`.
  - `.md` e `.txt` são lidos como utf8.
  - **PDF não tem texto extraído** (fica `''`). Quem lê é a IA.
- Gravação (`Escopo.adicionarDocumento`, `src/sankhya/escopo.ts:289`):
  - O original vai para `<dataDir>/escopos/<clienteId>/<id>-<nome>`.
  - A linha vai para `escopo_documentos` no `sankhya.db` (SQLite), com status `enviado` e o texto.
- Depois do upload, a tela chama **analisar sozinha** (`aoEscolherArquivo`).

## 2. Geração das tarefas

- Rota: `POST /api/escopo/documentos/:docId/analisar`.
  - Responde **202** na hora e roda em segundo plano.
  - Um `Set emAnalise` impede análise dupla (409).
  - A tela faz polling enquanto houver documento `analisando`.
- IA (`src/sankhya/escopoIa.ts`): roda o `claude -p` instalado na máquina, com timeout de 8 min.
  - **Texto** (docx/md/txt): vai embutido no prompt, cortado em 150 mil caracteres. Roda com todas as ferramentas bloqueadas, em diretório temporário vazio.
  - **PDF**: copiado como `escopo.pdf` para o temp, e só a ferramenta `Read` fica liberada.
- Prompt: pede um JSON com `resumo`, `duvidas[]` e `tarefas[]`.
  - Cada tarefa tem `titulo, descricao, grupo, tipo, estimativaHoras, prioridade, criteriosAceite`.
  - Regras: 1 a 16 h por tarefa, não inventar funcionalidade, dúvida vai em `duvidas`.
- Parser (`extrairResultado`): aceita JSON cercado de texto ou crases. Falha se não houver tarefas.
- Gravação (`registrarAnalise`, `escopo.ts:361`), numa transação:
  - Apaga **só as tarefas desse documento que ainda estão em `backlog`**. O que já foi movido de coluna fica.
  - Insere as novas em `backlog`, com transição `criada`.
  - Documento passa a `analisado`.
  - `resumo` guardado = resumo + "Pontos a esclarecer com o cliente".
  - Valores inválidos viram padrão: `tipo` vira `outro`, `prioridade` vira `media`, horas arredondam para 0,5.

## 3. Registro e atualização das tarefas

- Tabelas: `escopo_documentos`, `escopo_tarefas`, `escopo_transicoes`.
- Colunas fixas: `backlog`, `a_fazer`, `em_andamento`, `em_revisao`, `concluido`.
- Ordem dentro da coluna: inteiro denso 0..n-1, renumerado a cada movimento.
- Operações:

| Ação               | Rota                                                                       |
| ------------------ | -------------------------------------------------------------------------- |
| Criar tarefa à mão | `POST /api/clientes/:id/escopo/tarefas`                                    |
| Editar             | `PUT /api/escopo/tarefas/:id`                                              |
| Mover              | `POST /api/escopo/tarefas/:id/mover` (estado + índice, usado no drag&drop) |
| Excluir            | `DELETE /api/escopo/tarefas/:id`                                           |

- Transições gravadas em `escopo_transicoes` com origem `criada`, `movida`, `removida` ou `carga-inicial`. Reordenar dentro da mesma coluna **não** gera transição.
- `GET /api/escopo/transicoes` alimenta o evento `tarefa.transicao` da Integração API.
- Toda mudança chama `#avisar(clienteId)`, que reescreve o arquivo JSON compartilhado.
- Remover documento **não apaga as tarefas**: elas viram avulsas (`documento_id = NULL`).
- Ao subir, análise que ficou "analisando" vira `falhou` ("o hub reiniciou").

## 4. Seleção do modelo

**Não existe para o kanban.** `analisarEscopo` chama `claude -p` sem `--model`, então usa o padrão do `claude` instalado. Também não há escolha de agente: é `claude` fixo, sem `codex` ou `opencode`.

A escolha de modelo (`'' | opus | sonnet | haiku`, `--model`) existe só no módulo de **skills** (`src/skills.ts:287`, `MODELOS_SKILL` em `src/types.ts:989`). Se a versão do Carlos precisar escolher modelo na análise, isso é a base a reaproveitar.

## 5. Vários documentos e kanbans por cliente

- Um cliente tem **N documentos**, e cada documento é uma "demanda". `tarefa.documento_id` aponta para a demanda de origem.
- Não há N tabelas de kanban. É **um quadro por cliente**, filtrado por demanda.
- Seletor na tela: _Todas as demandas_, _uma demanda_ (o id do documento) ou _Avulsas_. A escolha é lembrada em `localStorage` (`escopo-demanda-<clienteId>`).
- Com "todas" e mais de uma demanda, o cartão mostra a etiqueta da demanda.
- Regra de integridade: tarefa só aponta para demanda **do mesmo cliente** (`#demandaValida`).
- Cada demanda tem nome editável (`demanda`, que por padrão é o nome do arquivo sem extensão), progresso próprio, e seus próprios flags de MCP e de arquivo.

## 6. MCP × arquivo JSON

**O MCP não depende do arquivo JSON.** São dois flags independentes na mesma demanda: `compartilhar_mcp` (0/1) e `compartilhar_em`/`compartilhar_nome`. O próprio código diz: "Independe do arquivo JSON".

|                      | **MCP**                                                                                                                | **Arquivo JSON**                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Ligar                | checkbox, `PUT /api/escopo/documentos/:id/mcp`                                                                         | pasta + nome, `PUT .../compartilhamento`                   |
| Como o agente acessa | servidor `src/mcp/servidor.ts` (stdio, JSON-RPC) chama `/api/mcp/*` do hub por HTTP                                    | agente edita o arquivo no disco                            |
| Requisito            | agente com MCP configurado (botão "Copiar configuração MCP" gera o bloco `mcpServers`). **O hub precisa estar aberto** | só um agente que edite arquivo; funciona com o hub fechado |
| Latência             | imediata                                                                                                               | o hub vigia o arquivo a cada 1,5 s (`watchFile`)           |
| Pode mudar           | `estado`, `notas`, criar tarefa nova (sempre no Backlog)                                                               | só `estado` e `notas`. Não cria nem remove                 |
| Ferramentas          | `listar_demandas`, `ler_demanda`, `mudancas_desde`, `mover_tarefa`, `anotar_tarefa`, `criar_tarefa`                    | n/a                                                        |
| Trava                | no hub (`routesMcp.ts`): demanda não liberada ou tarefa avulsa dá 404                                                  | `arquivoLivrePara` impede sobrescrever arquivo alheio      |
| Notas                | acrescenta por padrão; `substituir=true` reescreve; limite de 4000 caracteres                                          | o agente reescreve o campo                                 |
| Remoção              | desmarcar o checkbox                                                                                                   | "Parar de compartilhar" **apaga o arquivo**                |

### Detalhes do arquivo JSON

- Nome: `sankhya-hub-tarefas-<id>.json` por padrão, ou o nome escolhido, sugerido como slug da demanda.
- Pasta sugerida: o repositório local do cliente, ou `<dataDir>/escopos/<cliente>/compartilhado`.
- Pode criar a subpasta `Tarefas` e adicionar ao `.gitignore`.
- Traz `comoAtualizar` (instruções para a IA) e a lista de tarefas.
- A importação compara contra uma `base` e só aceita mudança de `estado` e `notas`. Aceita apelidos (`done`, `doing`, "Em andamento"…).
- JSON quebrado não é sobrescrito: o hub espera uma gravação válida.

### Pontos de atenção sobre o MCP

- O arquivo é só um espelho para quem não usa MCP. O hub grava nele mesmo quando a mudança veio do MCP, se o arquivo estiver ligado.
- Com o hub em container, `/api/mcp/config` devolve `disponivel: false`.
- Toda mudança feita por MCP passa pelos mesmos métodos da tela. Grava a transição, atualiza o quadro e vai para a Integração API.

## 7. Visualizar o documento inserido (ponto para a versão do Carlos)

- Componente `VisorDocumento`, aberto por **Ver documento**, em `<dialog>` modal.
- Endpoints a integrar:
  - `GET /api/escopo/documentos/:docId/arquivo`: devolve o original. Content-type por tipo, `inline` por padrão, `?baixar=1` força download, `nosniff`, `no-store`. Texto sai como `text/plain` para nunca virar página.
  - `GET /api/escopo/documentos/:docId/texto`: devolve `{ texto, tipo, nome }`.
- Como cada tipo aparece:
  - **PDF**: `<iframe src=/arquivo>`. O navegador ou o Electron desenha.
  - **docx**: só o texto extraído em `<pre>`, **sem a formatação do Word**. O original fica em "Baixar original".
  - **md/txt**: texto puro em `<pre>`. Markdown **não é renderizado**.
  - Documento sem texto legível mostra a mensagem "use Baixar original".
- Para integrar, o essencial é: os dois endpoints acima, a dependência de `textoDoDocx` no upload, e o fato de o PDF não ter texto no banco.

## 8. Lacunas

- Não há escolha de modelo nem de agente na análise (seção 4).
- A visualização do docx não preserva formatação.
- Sem autenticação nas rotas `/api/mcp/*`: a trava é só o flag por demanda, e o hub escuta em `127.0.0.1`.
- Não foram lidos `docxTexto.ts` nem os testes (`test/escopo.test.ts`, `test/mcp.test.ts`).
