# Formato dos arquivos de dados

Como o HUB SNK grava o que você cadastra. Para o uso do dia a dia, veja o
[README](../README.md) — nada aqui é necessário para usar o programa.

Os arquivos ficam na pasta de dados (`dados-hub-snk/` por padrão, ou o que
estiver em `HUB_DADOS_DIR`):

| Arquivo             | Guarda                                                          |
| ------------------- | --------------------------------------------------------------- |
| `clientes.json`     | O cadastro de clientes, com bases, bancos, repositórios e links |
| `configuracao.json` | A configuração global, os atalhos e o SMTP                      |
| `local.json`        | As bases e os bancos da própria máquina                         |
| `lembretes.json`    | Os lembretes cadastrados                                        |
| `contatos.json`     | Os contatos, com ou sem cliente                                 |
| `notificacoes.json` | O painel de notificações e as chaves já notificadas             |

## Envelope

Todos seguem a mesma forma: um campo `versaoDoEsquema` e o conteúdo sob uma
chave própria — `clientes`, `configuracao`, `local`, `lembretes` e
`notificacoes`.

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
    "perfil": "consultor",
    "funcionalidadesOcultas": ["cliente.repositorios"],
    "smtp": {
      "host": "smtp.office365.com",
      "porta": 587,
      "seguranca": "starttls",
      "usuario": "voce@empresa.com.br",
      "senha": "...",
      "remetente": "voce@empresa.com.br",
      "destinatario": "voce@empresa.com.br"
    },
    "alertaDaAgenda": { "ativo": true, "toleranciaMinutos": 30, "enviarEmail": true }
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
nasce visível. Os valores aceitos são `local`, `agenda`, `os` e `lembretes` (menu principal) e
`cliente.bases`, `cliente.repositorios`, `cliente.projetos`, `cliente.agenda` e
`cliente.os` (cadastro do cliente). Arquivo sem `perfil` recebe o perfil escolhido
no instalador, com o preset dele; sem instalador, `desenvolvedor`, com nada
oculto. Valor desconhecido na lista é descartado na leitura.

`smtp` é o servidor dos e-mails das notificações, com a senha em texto puro;
`seguranca` é `ssl`, `starttls` ou `nenhuma`, e host vazio desliga o e-mail.
`alertaDaAgenda` liga o aviso de evento da agenda de hoje sem OS lançada. Arquivo
de antes destes campos nasce com o SMTP vazio (porta 587, STARTTLS) e o alerta
desligado.

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
        "nome": "Addon de faturamento",
        "url": "https://github.com/grupo/projeto"
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

Clientes gravados antes de anotações, bases, repositórios e links existirem são
carregados com essas listas vazias, e repositórios sem `nome` recebem como
rótulo o último trecho da URL. Banco de dados gravado antes de `sgbd` e
`identificadorOracle` existirem é lido como `oracle` e `service-name`. Não há
migração manual a rodar.

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
`VERSAO_ATUAL_DO_ESQUEMA` em `src/repositorio/arquivoDeDados.ts` junto com a
parte MAJOR da versão do HUB SNK, e escreva a migração da versão anterior para a
nova.
