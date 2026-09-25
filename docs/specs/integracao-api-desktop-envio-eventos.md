# Integração do desktop com a API de eventos

**Data:** 2026-09-25  
**Estado:** especificação para implementação  
**Fonte do contrato:** `C:\Users\flaviano.santos_sank\Documents\Projetos\Integracao da API com o aplicativ.txt` (cópia de trabalho no repositório: `contrato_api_desktop.md`).

## 1. Objetivo

Enviar usuários, ordens de serviço (OS), mudanças de progresso e apontamentos de horas do aplicativo desktop para um **mesmo serviço receptor**. Cada instalação do aplicativo tem configuração e credencial próprias. A URL pode ser igual em todas; `installationId` e `API_KEY` não podem ser compartilhados entre instalações.

O envio é unidirecional, do desktop para a API. A integração não substitui o cadastro nem o fluxo atual de OS no Sankhya Experience. A ativação do envio automático depende de identificar, para cada tipo de evento, a fonte local e o momento em que o dado está confirmado.

## 2. Escopo e limite de entrega

1. Adicionar uma subaba **Integração API** em **Configurações** do Hub quando executado no desktop.
2. Configurar, por instalação: habilitação, URL completa do endpoint, `installationId` e `API_KEY`.
3. Guardar a chave cifrada pelo `safeStorage` do Electron no perfil local da instalação. Nunca devolver a chave em consultas de estado nem mostrá-la preenchida na tela.
4. Exibir estado da configuração, última validação local, último envio, pendências e erros sanitizados.
5. Oferecer **Testar conexão** por um evento de teste somente quando houver um tipo de evento de teste previsto pelo receptor. O contrato atual **não prevê** esse tipo. Portanto, o teste inicial será um `usuario.upsert` real, iniciado de forma explícita pelo usuário, ou uma validação local de campos e alcance HTTP que não será apresentada como confirmação de autenticação. O botão deve se chamar **Validar configuração** até existir um teste remoto seguro.
6. Implementar fila durável, adaptadores de dados, envio em lotes e acompanhamento por evento conforme as seções seguintes.

Esta especificação descreve o ajuste completo. A aba pode ser entregue antes dos adaptadores, desde que deixe claro “Envio automático ainda não disponível” e não ofereça um controle de ativação que prometa funcionamento.

## 3. Localização e desenho da aba

A interface existente tem a aba superior **Configurações** (`web/src/App.tsx`) e um painel de e-mail (`web/src/components/ConfiguracoesGerais.tsx`). A nova subaba fica ao lado de **E-mail**, pois o destino é uma configuração da instalação, não de um cliente ou projeto. O rótulo proposto é **Integração API**.

| Área | Campo/ação | Comportamento |
|---|---|---|
| Destino | URL da API | URL HTTPS completa, terminada em `/public/serverFunction/60689/15/execute`; não anexar o caminho duas vezes. Rejeitar HTTP fora de ambiente de desenvolvimento explícito. |
| Identidade | ID da instalação | UUID fornecido pelo administrador do receptor. Exibir sem mascarar. |
| Credencial | Chave da API | Campo `password`, sempre vazio ao abrir; indicar somente “configurada” ou “pendente”. Em branco ao salvar mantém a chave atual; ação separada para substituir/remover. |
| Controle | Envio automático | Desligado por padrão. Só habilitável com configuração válida e adaptadores prontos. Desligar suspende envio e preserva a fila. |
| Diagnóstico | Estado | Configurada/pendente, última confirmação, quantidade em fila, próximo retry, último erro sem segredo. |
| Ações | Salvar, Validar configuração, Enviar pendências | Validar campos localmente; enviar pendências força uma tentativa da fila existente, sem criar eventos de teste fictícios. |

Esboço da subaba:

```text
Configurações   [E-mail] [Integração API]

Destino comum
URL da API              [https://.../public/serverFunction/60689/15/execute]

Identidade desta instalação
ID da instalação        [UUID fornecido pelo administrador]
Chave da API            [••••••••••••••••]  Configurada/Pendente

Estado                  Desabilitado / Pronto / Enviando / Atenção
Último envio            data e resultado, sem dados sensíveis
Fila                    pendentes | rejeitados | próxima tentativa

[Validar configuração] [Salvar] [Enviar pendências]
Envio automático        [desligado/ligado, somente após homologação]
```

Fluxo de tela: `Configurações > Integração API > preencher URL, ID e chave > Salvar > verificar estado > habilitar envio automático`. Caso a chave seja perdida ou revogada, o operador solicita nova credencial, substitui a chave e reenvia a fila pendente com os mesmos `event.id`.

No navegador externo, sem processo Electron, a subaba deve explicar que a configuração pertence à instalação desktop e não apresentar formulário capaz de guardar segredo no `localStorage` ou no backend HTTP comum.

## 4. Modelo de configuração e segurança

```ts
interface ConfiguracaoIntegracao {
  habilitada: boolean;
  apiUrl: string;
  installationId: string;
  apiVersion: 1;
  temChave: boolean; // somente leitura na UI
}
```

- Cada instalação mantém um único perfil de integração. Outra cópia instalada precisa cadastrar seu próprio `installationId` e chave, mesmo usando a mesma URL. Não copiar a configuração secreta em backups de projetos, `services.yaml`, repositório ou log.
- A chave cifrada deve ficar em arquivo do `app.getPath('userData')` do Electron, usando `safeStorage` como já faz `desktop/src/cofreCredenciais.ts`. Falha em cifrar/decifrar deixa a integração desabilitada e exige nova chave; nunca degrada para texto puro.
- A configuração sem segredo e o estado podem ser lidos pela UI. O segredo só é acessível no processo principal para compor o corpo do `POST`. Não criar rota HTTP local que revele a chave ao React, às abas ERP/Experience ou a páginas de cliente.
- O processo principal aceita alterações da configuração somente da superfície local confiável. A aba Hub atual é um `WebContentsView` sem preload; por isso, antes de implementar a UI, é obrigatório definir um canal seguro e restrito à origem local do Hub. Não adicionar IPC genérico a abas remotas.
- Sanitizar logs, erros de rede, corpo da requisição e resposta: remover `key`, tokens e URLs com credenciais. O identificador da instalação pode aparecer em diagnóstico; a chave, nunca.
- Alterar URL ou `installationId` com eventos pendentes exige confirmação: a fila antiga pertence à instalação original. Ela não pode ser enviada sob a nova identidade. Preservar a fila antiga para recuperação ou oferecer descarte explícito.

## 5. Contrato de transporte

`POST {API_URL}` com `Content-Type: application/json` e corpo direto, sem wrapper adicional:

```json
{
  "version": 1,
  "installationId": "UUID_DA_INSTALACAO",
  "key": "CHAVE_DA_INSTALACAO",
  "events": [
    {
      "id": "usuario-42-v1",
      "type": "usuario.upsert",
      "occurredAt": "2026-09-24T12:00:00.000Z",
      "data": {
        "externalId": "usuario-42",
        "name": "Ana Souza",
        "active": true
      }
    }
  ]
}
```

Enviar de 1 a 200 eventos por requisição, em ordem de dependência. Datas em ISO 8601 UTC. `event.id` é único **dentro da instalação**, determinístico e estável para cada alteração; deve ter até 120 caracteres e usar apenas letras, números, `.`, `_`, `:`, `@`, `/`, `-`. O ID de uma atualização precisa mudar, mas um retry da mesma atualização conserva o ID.

Tipos aceitos e dependências:

| Ordem | Tipo | Dados essenciais | Pré-requisito |
|---:|---|---|---|
| 1 | `usuario.upsert` | `externalId`, `name`; opcionais `email`, `active` | Nenhum |
| 2 | `os.upsert` | `externalId`, `userExternalId`, `code`, `title`, `status`, `progress`; opcionais `description`, `priority`, `dueAt`, `active` | Usuário aceito ou anterior no mesmo lote |
| 3 | `os.progresso` | `osExternalId`, `progress`, `status` | OS aceita ou anterior no mesmo lote |
| 4 | `horas.apontar` | `externalId`, `osExternalId`, `userExternalId`, `minutes`; opcionais `description`, `startedAt`, `endedAt` | OS e usuário aceitos ou anteriores no mesmo lote |

Os limites e formatos de cada campo são os do contrato de origem, inclusive progresso de 0 a 100, `minutes` inteiro de 1 a 10080 e os comprimentos máximos de strings. A implementação deve validar esses limites antes de entrar na fila e mostrar erros de dados sem incluir a chave.

## 6. Origem dos dados e decisões de mapeamento

O Hub já possui cadastro de clientes, consulta de OS e integração com Experience. Esses dados **não equivalem automaticamente** às quatro entidades exigidas pelo receptor. Antes de ligar o envio, registrar o mapeamento abaixo com identificadores estáveis e origem da alteração.

| Evento | Candidato no projeto | Decisão necessária antes do adaptador |
|---|---|---|
| Usuário | Sessão da Experience e/ou recurso da Agenda | Escolher o identificador estável, nome, e-mail e regra de inativação. Usuários de clientes distintos não podem colidir. |
| OS | OS do Experience (`src/sankhya/experience.ts`, `web/src/components/sankhya/OrdensDoProjeto.tsx`) | Definir ID, código, responsável, status, prioridade, prazo e progressão; confirmar se a OS pertence à instalação local e se pode ser replicada. |
| Progresso | Histórico/estado da OS | Identificar a mudança real que cria um novo evento. Não gerar progresso repetido a cada consulta periódica. |
| Horas | Apontamentos associados à OS | Confirmar onde estão os apontamentos individuais. Total acumulado de horas de uma OS não serve como `horas.apontar` sem ID estável por apontamento. |

Se a fonte de um tipo não existir no desktop atual, entregar a aba e os tipos já mapeados, sinalizando explicitamente o tipo como indisponível. Não sintetizar usuários, progresso ou apontamentos a partir de valores agregados.

## 7. Fila, confirmação e recuperação

1. Persistir evento, identidade da instalação, payload, data de criação, estado, tentativas e último erro em fila local durável **antes** do primeiro envio. Usar transação/arquivo atômico e garantir que reinício não perca eventos.
2. Ordenar por dependência e por sequência da alteração de cada entidade. Montar lotes de até 200 eventos. Não enviar OS antes do usuário nem progresso/horas antes da OS.
3. Interpretar o envelope de execução. Se `status` não for `COMPLETED`, manter o lote pendente. Se `output` for string JSON, desserializar; se for objeto, usar diretamente. Validar a presença de `results` antes de confirmar.
4. Para cada resultado: `accepted` e `duplicate` concluem e retiram da fila; `failed` mantém o evento com motivo para correção manual ou de mapeamento. Um `failed` bloqueia dependentes, sem retry automático dessa falha de validação.
5. Em falha de rede, timeout ou indisponibilidade, manter todos os eventos sem confirmação e repetir com o mesmo ID, em espera progressiva de 5, 15, 30 e 60 segundos (teto 60 s). Respostas HTTP não bem-sucedidas devem ser classificadas; não presumir aceitação.
6. Limitar concorrência a um envio por instalação. Ao desligar a integração ou fechar o app, parar novas tentativas sem apagar a fila.
7. Registrar métricas e erros sanitizados. A tela mostra estado de cada evento e contagens; nunca registra o corpo completo com `key`.

## 8. Componentes previstos no código

| Camada | Local existente / componente novo | Responsabilidade |
|---|---|---|
| Navegação | `web/src/components/ConfiguracoesGerais.tsx` | Subabas E-mail e Integração API, visibilidade conforme modo desktop. |
| Interface | `web/src/components/IntegracaoApi.tsx` (novo) | Formulário, validação, estados e ações. |
| Comunicação UI–desktop | `desktop/src/preload.ts`, `desktop/src/main.ts` ou canal local restrito ao Hub | Operações específicas de configuração e diagnóstico, sem leitura do segredo. |
| Cofre | Módulo novo em `desktop/src/`, seguindo `cofreCredenciais.ts` | Cifrar, trocar e invalidar a chave. |
| Fila e remetente | Módulos novos em `desktop/src/` ou backend local, sem expor o segredo por HTTP | Persistência, ordenação, envio, retry e leitura da resposta. |
| Adaptadores | `src/sankhya/` / `desktop/src/`, após definição da fonte | Converter alterações reais nos quatro tipos do contrato. |

O serviço receptor não precisa de alterações para receber esses quatro tipos, segundo o arquivo fornecido. A ausência de endpoint de teste e de formato de erro HTTP detalhado devem ser confirmadas com quem mantém a API.

## 9. Critérios de aceite

1. Em duas instalações, ambas exibem a mesma URL configurada e IDs/chaves diferentes; um backup ou log não revela nenhuma chave.
2. Reiniciar o desktop preserva a configuração e a fila. Remover ou trocar a chave não altera IDs de eventos pendentes da mesma instalação.
3. Sem URL HTTPS, UUID válido ou chave, o envio fica desabilitado e a tela informa o campo pendente.
4. Um `usuario.upsert` real é aceito; repetir o mesmo evento resulta em `duplicate`, sem duplicar dados.
5. Um lote misto mantém ordem usuário → OS → progresso → horas e nunca supera 200 eventos.
6. Resposta com `output` string e resposta com `output` objeto produzem o mesmo tratamento.
7. Em resposta parcial, somente `accepted` e `duplicate` saem da fila; `failed` fica visível, bloqueia seus dependentes e não recebe retry automático.
8. Queda de rede, timeout e reinício preservam evento e `event.id`; o envio posterior confirma sem duplicação.
9. Alterar `installationId` ou URL com fila pendente não mistura eventos da instalação anterior com a nova.
10. Página remota do ERP/Experience, navegador externo e rotas HTTP comuns não conseguem ler a chave.

## 10. Ordem de construção

1. Fechar o mapeamento dos quatro tipos e identificar a origem dos apontamentos individuais.
2. Criar cofre e operações seguras de configuração por instalação.
3. Criar a subaba de configuração e diagnóstico, inicialmente com envio automático indisponível.
4. Criar fila durável, remetente, processamento da resposta e testes de falha/idempotência.
5. Ligar cada adaptador de dados confirmado e homologar com uma instalação de teste.
6. Habilitar envio automático somente após os critérios de aceite dos tipos em uso.
