# Formato dos arquivos de dados

Como o HUB SNK grava o que você cadastra. Para o uso do dia a dia, veja o
[README](../README.md) — nada aqui é necessário para usar o programa.

Os três arquivos ficam na pasta de dados (`dados-hub-snk/` por padrão, ou o que
estiver em `HUB_DADOS_DIR`):

| Arquivo             | Guarda                                                          |
| ------------------- | --------------------------------------------------------------- |
| `clientes.json`     | O cadastro de clientes, com bases, bancos, repositórios e links |
| `configuracao.json` | A configuração global e os atalhos                              |
| `local.json`        | As bases e os bancos da própria máquina                         |

## Envelope

Os três seguem a mesma forma: um campo `versaoDoEsquema` e o conteúdo sob uma
chave própria — `clientes`, `configuracao` e `local`.

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
    ]
  }
}
```

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
rótulo o último trecho da URL. Não há migração manual a rodar.

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

Os três arquivos são lidos na inicialização, antes de o servidor abrir a porta.
Erro de esquema aparece no terminal na largada, e não na primeira tela aberta.

Ao publicar uma versão que muda o formato dos dados, suba a
`VERSAO_ATUAL_DO_ESQUEMA` em `src/repositorio/arquivoDeDados.ts` junto com a
parte MAJOR da versão do HUB SNK, e escreva a migração da versão anterior para a
nova.
