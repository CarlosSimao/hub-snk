# Formato dos arquivos de dados

Como o HUB SNK grava o que você cadastra. Para o uso do dia a dia, veja o
[README](../README.md) — nada aqui é necessário para usar o programa.

Os arquivos ficam na pasta de dados: `%LOCALAPPDATA%\HubSnk\dados` no aplicativo
instalado, `dados-hub-snk/` na raiz do repositório em desenvolvimento, ou o que
estiver em `HUB_DADOS_DIR`:

| Arquivo             | Guarda                                                                    |
| ------------------- | ------------------------------------------------------------------------- |
| `clientes.json`     | O cadastro de clientes, com bases, bancos, repositórios, links e projetos |
| `configuracao.json` | A configuração global, os acessos, os atalhos e o SMTP                    |
| `local.json`        | As bases e os bancos da própria máquina                                   |
| `lembretes.json`    | Os lembretes cadastrados                                                  |
| `contatos.json`     | Os contatos, com ou sem cliente                                           |
| `notificacoes.json` | O painel de notificações e as chaves já notificadas                       |
| `sankhya.db`        | O snapshot da Agenda de Recursos e os kanbans dos projetos, em SQLite     |
| `kanbans/`          | Os documentos de escopo originais dos kanbans, uma pasta por cliente      |

## Envelope

Todos os `.json` seguem a mesma forma: um campo `versaoDoEsquema` e o conteúdo sob
uma chave própria — `clientes`, `configuracao`, `local`, `lembretes`, `contatos` e
`notificacoes`. O `sankhya.db` fica fora do envelope: guarda o snapshot que cada
consulta da agenda atualiza, e as rotas de eventos leem, e os kanbans (veja
[Kanban dos projetos](#kanban-dos-projetos)).

```json
{ "versaoDoEsquema": 1, "clientes": [ ... ] }
```

A gravação é atômica: o conteúdo vai para um arquivo temporário e só então
substitui o original, de modo que uma queda no meio da escrita não corrompe o
cadastro.

## Configuração global

```json
{
  "versaoDoEsquema": 1,
  "configuracao": {
    "scriptPadrao": "git fetch --all",
    "intervaloDeExecucaoAutomaticaSegundos": 30,
    "tempoLimiteSegundos": 5,
    "caminhoDoSchemaMcp": "",
    "atalhos": [
      {
        "id": "0f4c1e7a-4a1b-4d0e-9a2f-8c9d1e5b6a30",
        "nome": "DataGrip",
        "caminhoDoExecutavel": "C:\\Program Files\\JetBrains\\DataGrip\\bin\\datagrip64.exe"
      }
    ],
    "destinoDosLinks": "hub",
    "caminhoDoExecutavelDaIde": "C:\\Program Files\\JetBrains\\IntelliJ IDEA\\bin\\idea64.exe",
    "experiencePersonId": "123456",
    "sankhyaOmCodUsu": "4817",
    "perfil": "consultor",
    "funcionalidadesOcultas": ["cliente.repositorios", "autosync", "cliente.autosync"],
    "terceiro": false,
    "smtp": {
      "host": "smtp.office365.com",
      "porta": 587,
      "seguranca": "starttls",
      "usuario": "voce@empresa.com.br",
      "senha": "...",
      "remetente": "voce@empresa.com.br",
      "destinatario": "voce@empresa.com.br"
    },
    "alertaDaAgenda": { "ativo": true, "toleranciaMinutos": 30, "enviarEmail": true },
    "assistenteDeIa": { "assistente": "auto", "modelo": "", "raciocinio": "" },
    "nomeDoUsuario": "Ana Souza",
    "empresaDoUsuario": "Acme",
    "timeDoUsuario": "Suporte"
  }
}
```

`destinoDosLinks` diz onde todo link clicável do cadastro abre no aplicativo
desktop — bases, repositório, links gerais e de projeto: `hub` (guia do
aplicativo) ou `navegador-padrao` (o navegador do sistema). Arquivo de antes
deste campo, ou com um valor desconhecido, vale `hub`.

`caminhoDoExecutavelDaIde` é o executável chamado pelo botão **Abrir IDE** de
cada repositório, com a pasta como argumento. Vazio desliga o botão.

`perfil` (`desenvolvedor`, `consultor`, `analista` ou `gerente-de-projeto`) e
`funcionalidadesOcultas` são os acessos de **Configurações › Acessos**. A lista
guarda o que está **oculto**: uma funcionalidade criada numa versão futura já
nasce visível. Os valores aceitos são `local`, `agenda`, `os`, `contatos` e
`autosync` (abas do menu principal; `autosync` é a aba Git), `lembretes` (o botão
Lembretes do painel de notificações), `cliente.bases`, `cliente.repositorios` (a aba
Git do cliente), `cliente.projetos`, `cliente.agenda`, `cliente.os` e
`cliente.contatos` (abas do cadastro do cliente) e `cliente.autosync` (a seção
AutoSync da aba Git do cliente). Arquivo sem `perfil` recebe o perfil escolhido no instalador, com o
preset dele; sem instalador, `desenvolvedor`, com nada oculto. Valor desconhecido
na lista é descartado na leitura.

`terceiro` é a caixa **Terceiro** da aba Acessos: `true` oculta, por cima de
`funcionalidadesOcultas`, o que depende do SankhyaOm e da Experience, sem alterar
a lista. Arquivo sem o campo recebe a escolha do instalador; sem instalador,
`false`.

`sankhyaOmCodUsu` é o `CODUSU` digitado no topo de **Credenciais Sankhya**, que
recorta a Agenda de Recursos para os seus eventos. `experiencePersonId` é o
`person_id` da Experience, gravado sozinho ao capturar a sessão e nunca digitado;
vazio, a aba OS não tem de quem buscar as OS.

`smtp` é o servidor dos e-mails das notificações, com a senha em texto puro;
`seguranca` é `ssl`, `starttls` ou `nenhuma`, e host vazio desliga o e-mail.
`alertaDaAgenda` liga o aviso de evento da agenda de hoje sem OS lançada. Arquivo
de antes destes campos nasce com o SMTP vazio (porta 587, STARTTLS) e o alerta
desligado.

`assistenteDeIa` é quem gera as tarefas do kanban a partir do documento de escopo:
`auto` (o primeiro instalado, na ordem `claude`, `codex`, `opencode`, `gemini`,
`cursor`) ou um deles, com o `modelo` escolhido; vazio usa o padrão do assistente.
`raciocinio` é o nível de raciocínio do modelo (`low`, `high`, `max`...), vazio
para o padrão dele. Arquivo de antes do campo, ou com assistente desconhecido, vale
`auto`.

`nomeDoUsuario`, `empresaDoUsuario` e `timeDoUsuario` são os campos de **Configurações ›
Geral** que dizem quem usa o aplicativo (a empresa é a da pessoa, e não um cliente do
cadastro). Os três são obrigatórios para abrir um relato ao suporte e seguem com ele.
Arquivo de antes dos campos nasce com eles vazios.

Nada do Git AutoSync fica aqui. A configuração dele é o `config.json` da pasta dele
(`%USERPROFILE%\.git-autosync`), que o HUB SNK só lê e altera pelo CLI, e o host e o
token do GitLab da engrenagem da aba **Git AutoSync** vão para as variáveis de ambiente do
usuário do Windows (`GIT_AUTOSYNC_GITLAB_HOST` e `GIT_AUTOSYNC_GITLAB_TOKEN`), para
não viajarem com a pasta de dados sincronizada.

## Lembretes

O conteúdo de `lembretes`:

```json
[
  {
    "id": "7c1e4f0a-3b8d-4e2a-9f61-2d5c8a7b9e10",
    "resumo": "Relatório de horas",
    "texto": "Enviar o relatório de horas",
    "tipo": "recorrente",
    "dataHora": "",
    "expressaoCron": "0 17 * * 5",
    "clienteId": "4fb3993a-f8b3-4e9a-be7d-c79556fa78e5",
    "projetoId": null,
    "enviarEmail": true,
    "contatoIds": ["0d6f3c2e-8a41-4b7e-9c55-1e2f3a4b5c6d"],
    "ativo": true,
    "ultimoDisparoEm": "2026-09-25T20:00:04.112Z",
    "criadoEm": "2026-09-01T12:00:00.000Z",
    "atualizadoEm": "2026-09-01T12:00:00.000Z"
  }
]
```

`dataHora` só vale para o `unico` e `expressaoCron` só para o `recorrente`.
`ultimoDisparoEm` vazio é lembrete que nunca disparou; o recorrente conta a
próxima ocorrência a partir dele, ou de `atualizadoEm` quando vazio.
`contatoIds` são os contatos em cópia no e-mail, e fica vazio quando o lembrete não
envia e-mail. Lembrete gravado antes do `resumo` e dos `contatoIds` é lido com os
dois vazios.

## Contatos

O conteúdo de `contatos`:

```json
[
  {
    "id": "0d6f3c2e-8a41-4b7e-9c55-1e2f3a4b5c6d",
    "nome": "Ana Souza",
    "telefone": "(11) 99999-0000",
    "email": "ana@cliente.com.br",
    "cargo": "Coordenadora de TI",
    "clienteId": "4fb3993a-f8b3-4e9a-be7d-c79556fa78e5",
    "criadoEm": "2026-09-28T12:00:00.000Z",
    "atualizadoEm": "2026-09-28T12:00:00.000Z"
  }
]
```

Só o `nome` é obrigatório; os outros textos ficam vazios. `clienteId` é `null` no
contato sem cliente, e excluir o cliente o passa a `null`. Um `clienteId` que não
existe mais — pasta sincronizada com outra máquina — vale como sem cliente.

## Notificações

O conteúdo de `notificacoes` tem a `lista` (as 200 mais recentes) e as
`chavesEmitidas`, que impedem notificar duas vezes o mesmo fato — o evento da
agenda num dia, a ocorrência de um lembrete. Limpar o painel esvazia só a lista;
as chaves ficam por sete dias.

## Cadastro de clientes

O conteúdo de `clientes`:

```json
[
  {
    "id": "4fb3993a-f8b3-4e9a-be7d-c79556fa78e5",
    "nome": "Indústria Alfa",
    "anotacoes": "Contato: Maria, ramal 23.\nJanela de deploy só depois das 18h.",
    "bases": [
      {
        "id": "3d2b21fa-8b04-4e91-8793-e4170aab9909",
        "url": "https://erp.alfa.com.br:8180/mge",
        "tipo": "producao",
        "usuario": "admin",
        "senha": "...",
        "bancoDeDados": {
          "sgbd": "oracle",
          "identificadorOracle": "service-name",
          "host": "192.168.0.10",
          "porta": 1521,
          "nomeDoServico": "ORCL",
          "usuario": "system",
          "senha": "..."
        }
      }
    ],
    "repositorios": [
      {
        "id": "0d1df29e-dd3d-4a9c-ada9-1d25a877f2cf",
        "url": "https://github.com/grupo/projeto",
        "caminhoLocal": "C:\\Workspace\\projeto"
      }
    ],
    "links": [
      {
        "id": "b8a5c07e-2f56-4f1c-9a44-0c6b1d3f5e28",
        "nome": "Portal do chamado",
        "url": "https://portal.alfa.com.br"
      }
    ],
    "criadoEm": "2026-08-07T18:44:43.109Z",
    "atualizadoEm": "2026-08-07T18:44:43.109Z"
  }
]
```

Repositório não tem nome gravado: a tela mostra a pasta do `caminhoLocal` ou, sem
clone, o último trecho da URL. O cadastro exige o `caminhoLocal`; ele só falta em
repositório gravado por versão anterior, quando o campo ainda era opcional.

Clientes gravados antes de anotações, bases, repositórios e links existirem são
carregados com essas listas vazias. O `nome` que versões anteriores gravavam em
cada repositório é descartado na leitura e sai do arquivo na próxima gravação.
Banco de dados gravado antes de `sgbd` e
`identificadorOracle` existirem é lido como `oracle` e `service-name`. Não há
migração manual a rodar.

## Kanban dos projetos

Três tabelas no `sankhya.db`, ao lado das da Agenda (`ag_*`):

| Tabela          | Guarda                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| `kb_demandas`   | Cada kanban: cliente, projeto, nome, pasta do arquivo de tarefas, documento e análise |
| `kb_tarefas`    | As tarefas, com a coluna (`estado`) e a posição nela (`ordem`, densa por kanban)      |
| `kb_transicoes` | Cada criação, troca de coluna e exclusão de tarefa, com data e origem                 |

`projeto_id` guarda o id do projeto do `clientes.json`, sem chave estrangeira: vazio
quer dizer kanban órfão, cujo projeto foi excluído com a opção de manter os kanbans.
Excluir o cliente apaga os kanbans dele. O original do documento fica em
`kanbans/<id do cliente>/<id do kanban>-<nome>`; no banco vai só o texto extraído. No
PDF, o texto serve ao visor e ao Codex e ao Cursor, que não leem PDF; os outros
assistentes recebem o arquivo original. PDF digitalizado fica sem texto.

`checklist`, em `kb_tarefas`, guarda a lista de verificação da tarefa como JSON:
`[{ "texto": "...", "feito": false }]`.

`mcp` (0 ou 1) libera o kanban para agentes pelo servidor MCP. `arquivo_nome` é o
nome do arquivo de tarefas dentro de `<pasta>/Tarefas`, escolhido ao ligar o arquivo
e mantido enquanto a pasta não muda.

### Arquivo de tarefas

Com a pasta escolhida, o kanban ganha `<pasta>/Tarefas/<projeto>.json`, no mesmo
formato do DS-hub:

```json
{
  "geradoPor": "hub-snk",
  "documentoId": 4,
  "sobre": "Tarefas do kanban ... mantidas pelo HUB SNK.",
  "comoAtualizar": ["Altere só \"estado\" e \"notas\". ..."],
  "projeto": "Integração CERTADOC",
  "demanda": "Escopo do envio de pedidos",
  "documentoDeEscopo": "escopo.pdf",
  "resumoDoEscopo": "...",
  "atualizadoEm": "2026-10-01T16:09:00.000Z",
  "tarefas": [
    {
      "id": 7,
      "titulo": "Criar tabela adicional AD_LOGENVIO",
      "estado": "backlog",
      "notas": "",
      "funcionalidade": "Log de envio",
      "tipo": "dados",
      "prioridade": "alta",
      "estimativaHoras": 3,
      "descricao": "...",
      "criteriosAceite": ["..."],
      "checklist": [{ "texto": "Criar a tabela", "feito": true }]
    }
  ]
}
```

O HUB SNK reescreve o arquivo a cada mudança no quadro e o confere a cada 1,5 s: o que
outro programa mudar em `estado`, `notas` ou no `feito` dos itens de `checklist`
entra no quadro; o resto é ignorado e
volta ao que está no HUB SNK. JSON quebrado não é sobrescrito. A pasta `Tarefas` entra
no `.gitignore` quando está num repositório Git; fora de um, só é criada. Arquivo de
mesmo nome que não foi gerado pelo HUB SNK não é tocado: o kanban usa outro nome. Tirar
a pasta, ou excluir o kanban, apaga o arquivo.

## Versão do esquema

O número existe por causa da pasta compartilhada e da atualização desencontrada.
Sem ele, um HUB SNK antigo abriria um arquivo gravado por um HUB SNK novo, leria
os campos que reconhece, ignoraria o resto e apagaria o que não entendeu na
primeira gravação — perda silenciosa, sem erro nenhum na tela.

**Arquivo em esquema mais novo do que o programa entende:** o HUB SNK não sobe e
diz o que houve. O arquivo fica intacto; atualize o HUB SNK e abra de novo.

```
O arquivo D:\HubSnk\clientes.json está no esquema 2, e esta versão do HUB SNK
entende até o 1. Atualize o HUB SNK: abrir o cadastro assim descartaria o que a
versão mais nova gravou.
```

**Arquivo em esquema mais antigo:** a migração roda sozinha na primeira leitura,
e antes de reescrever qualquer coisa o arquivo original é copiado para
`<nome>.esquema<versão de origem>` — por exemplo `clientes.json.esquema0`, onde
`esquema0` é o formato anterior ao envelope. A cópia é feita uma vez por versão
de origem e nunca é sobrescrita: ela guarda o estado original, não o último.

Os arquivos são lidos na inicialização, antes de o servidor abrir a porta.
Erro de esquema aparece no terminal na largada, e não na primeira tela aberta.

Ao publicar uma versão que muda o formato dos dados, suba a
`VERSAO_ATUAL_DO_ESQUEMA` em `src/repositorio/arquivo/arquivoDeDados.ts` junto com a
parte MAJOR da versão do HUB SNK, e escreva a migração da versão anterior para a
nova.

A recíproca não vale: release MAJOR não obriga a subir o esquema. A versão 2 é
MAJOR pela troca da PWA pelo aplicativo desktop, e a `VERSAO_ATUAL_DO_ESQUEMA`
continua `1`, porque a única retirada de campo, o `nome` dos repositórios, é
compatível nos dois sentidos: a versão 2 descarta o campo na leitura, e a 1.1.0,
ao abrir um arquivo sem ele, deriva o nome do último trecho da URL. O resto da
versão 2 só acrescenta campos. No `clientes.json` eles sobrevivem a uma gravação
da 1.1.0, que preserva o que não reconhece em cada cliente; no
`configuracao.json`, não: a 1.1.0 remonta a configuração só com os campos dela, e
salvar as configurações nela descarta acessos, SMTP e alerta da agenda gravados
pela versão 2. Numa pasta compartilhada entre máquinas, atualize todas.
