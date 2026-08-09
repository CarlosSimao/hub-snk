# HUB SNK

Hub local de cadastro de clientes, das bases e dos repositórios Git de cada
um. Roda na sua máquina, sem Docker, sem banco de dados e sem autenticação, e
pode ser instalado como PWA para abrir em janela própria — como um aplicativo de
desktop.

Funciona em Windows, Linux e macOS.

> **As senhas das bases e dos bancos ficam em texto puro** em
> `dados-hub-snk/clientes.json`. O HUB SNK não tem autenticação e roda só na sua
> máquina, então qualquer chave de criptografia teria de ficar no mesmo disco
> que o arquivo cifrado — o que não protege de nada. A pasta `dados-hub-snk/` não é
> versionada (já está no `.gitignore`).
>
> Dá para [sincronizar a pasta com a nuvem](#backup-na-nuvem) e ter backup, mas
> **o arquivo sobe como está, com as senhas legíveis**.
>
> O HUB SNK também abre programas do sistema operacional a pedido da API, então
> **não o exponha na rede** sem ler [Exposição na rede](#exposição-na-rede).

---

## Pré-requisitos

| Item | Versão | Para quê |
|---|---|---|
| **Node.js** | 22.18 ou superior | Executa o servidor. A partir dessa versão o Node roda arquivos `.ts` direto, sem etapa de build |
| **Navegador Chromium** | Chrome ou Edge atual | Necessário para instalar a PWA em janela separada |

---

## Instalação

```bash
npm install
```

## Uso

```bash
npm start
```

HUB SNK em <http://127.0.0.1:4100>.

Durante o desenvolvimento, `npm run dev` reinicia o servidor a cada alteração
no código.

### Instalar como aplicativo (janela separada)

Com o HUB SNK aberto no navegador:

- **Chrome / Edge**: ícone de instalação na barra de endereço, ou menu
  ⋮ → *Instalar HUB SNK*.
- **macOS (Safari)**: *Arquivo* → *Adicionar ao Dock*.

Depois de instalado, o HUB SNK abre em janela própria, sem barra de endereço e
sem abas, e ganha ícone no menu Iniciar / Launchpad / lançador do sistema.

O `http://localhost` conta como origem segura para o navegador, então a PWA
funciona sem HTTPS e sem certificado.

---

## Configuração

Todas as variáveis são opcionais.

| Variável | Padrão | O que faz |
|---|---|---|
| `HUB_PORTA` | `4100` | Porta do servidor |
| `HUB_HOST` | `127.0.0.1` | Interface de escuta. Endereço fora do loopback só é aceito junto com `HUB_PERMITIR_REDE=1` — leia [Exposição na rede](#exposição-na-rede) antes |
| `HUB_PERMITIR_REDE` | *(vazio)* | `1` autoriza o `HUB_HOST` fora do loopback. Sem ela, o servidor recusa subir |
| `HUB_DADOS_DIR` | `./dados-hub-snk` | Onde o `clientes.json` é gravado |

Exemplo — gravar os dados em outro disco:

```bash
# Windows (PowerShell)
$env:HUB_DADOS_DIR = "D:\HubSnk"; npm start

# Linux / macOS
HUB_DADOS_DIR="$HOME/.hub-snk" npm start
```

Apontar para dentro de uma pasta de nuvem é o que dá backup — veja
[Backup na nuvem](#backup-na-nuvem).

---

## Exposição na rede

O HUB SNK foi desenhado para escutar só em `127.0.0.1`, e a razão é o que ele
faz: **não tem autenticação**, devolve o cadastro inteiro — senhas em texto puro
incluídas — em `GET /api/clientes`, e abre programas do sistema operacional
(IntelliJ, DataGrip, terminal, gerenciador de arquivos) a pedido de quem chama a
API.

Escutar fora do loopback junta as três coisas: qualquer máquina que alcance a
porta lê as senhas de todos os clientes e manda a sua máquina executar
programas. Por isso `HUB_HOST` com endereço de rede só sobe acompanhado de
`HUB_PERMITIR_REDE=1`:

```bash
# Recusado — o servidor nem inicia
HUB_HOST=0.0.0.0 npm start

# Aceito, com o risco assumido de propósito
HUB_PERMITIR_REDE=1 HUB_HOST=0.0.0.0 npm start
```

No modo padrão (loopback), cada requisição precisa provar que veio da própria
janela do HUB SNK: os cabeçalhos `Host` e `Origin` são conferidos antes de
qualquer rota, e o que não bate leva `403`. Isso barra duas coisas que o
`127.0.0.1` sozinho não barra — um site aberto no seu navegador chamando a API
local (CSRF) e um domínio que resolve para `127.0.0.1` (DNS rebinding).

Com `HUB_PERMITIR_REDE=1` essa conferência é desligada: o acesso passa a ser por
IP ou nome da máquina, e não existe lista de endereços válidos a comparar. O
servidor avisa isso no log ao subir.

---

## Onde ficam os dados

O cadastro fica em `dados-hub-snk/clientes.json`, a configuração global em
`dados-hub-snk/configuracao.json` e as bases e bancos da máquina em `dados-hub-snk/local.json`.

A configuração global:

```json
{
  "scriptPadrao": "git fetch --all",
  "intervaloDeExecucaoAutomaticaSegundos": 30,
  "tempoLimiteSegundos": 5,
  "atalhos": [
    {
      "id": "0f4c1e7a-4a1b-4d0e-9a2f-8c9d1e5b6a30",
      "nome": "DataGrip",
      "caminhoDoExecutavel": "C:\\Program Files\\JetBrains\\DataGrip\\bin\\datagrip64.exe"
    }
  ]
}
```

O cadastro tem esta forma:

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

Clientes gravados antes de anotações, bases, repositórios e links existirem são carregados
com essas listas vazias, e repositórios sem `nome` recebem como rótulo o último
trecho da URL. Não há migração manual a rodar.

A gravação é atômica — o conteúdo vai para um arquivo temporário e só então
substitui o original, de modo que uma queda no meio da escrita não corrompe o
cadastro. A pasta `dados-hub-snk/` está no `.gitignore`.

---

## Backup na nuvem

Para ter backup, sincronize a pasta `dados-hub-snk` com o serviço de nuvem que
você já usa — Google Drive, OneDrive, Dropbox. Basta adicioná-la à sincronização
do cliente instalado na máquina, ou apontar o `HUB_DADOS_DIR` para dentro da
pasta que já é sincronizada. Nada a configurar dentro do HUB SNK.

> Os arquivos sobem como estão no disco, e o `clientes.json` guarda as senhas
> das bases e dos bancos em texto puro. Confira se a pasta não está
> compartilhada com ninguém.

Usando em mais de uma máquina, feche o HUB SNK de uma antes de abrir na outra:
a sincronização é de arquivo, e edição simultânea faz uma das versões se perder.
Alteração que chega de fora com o HUB SNK aberto é percebida sozinha — ele vigia
a pasta e relê o arquivo.

---

## API

Base: `http://127.0.0.1:4100`

| Método | Rota | Resposta |
|---|---|---|
| `GET` | `/api/clientes` | `200` — lista ordenada por nome, com as bases |
| `POST` | `/api/clientes` | `201` — cliente criado |
| `PUT` | `/api/clientes/:id` | `200` — cliente atualizado |
| `GET` | `/api/clientes/:id` | `200` — um cliente, com a situação do MCP de cada repositório |
| `PUT` | `/api/clientes/:id/anotacoes` | `200` — cliente com as anotações gravadas |
| `DELETE` | `/api/clientes/:id` | `204` — sem conteúdo |
| `POST` | `/api/clientes/:id/bases` | `201` — base criada |
| `PUT` | `/api/clientes/:id/bases/:idBase` | `200` — base atualizada |
| `DELETE` | `/api/clientes/:id/bases/:idBase` | `204` — sem conteúdo |
| `PUT` | `/api/clientes/:id/bases/:idBase/banco` | `200` — banco vinculado ou substituído |
| `DELETE` | `/api/clientes/:id/bases/:idBase/banco` | `204` — banco desvinculado |
| `POST` | `/api/clientes/:id/repositorios` | `201` — repositório criado |
| `PUT` | `/api/clientes/:id/repositorios/:idRepositorio` | `200` — repositório atualizado |
| `DELETE` | `/api/clientes/:id/repositorios/:idRepositorio` | `204` — sem conteúdo |
| `POST` | `/api/clientes/:id/repositorios/:idRepositorio/abrir-pasta` | `204` — pasta aberta no gerenciador de arquivos |
| `POST` | `/api/clientes/:id/repositorios/:idRepositorio/abrir-shell` | `204` — terminal aberto na pasta |
| `POST` | `/api/clientes/:id/repositorios/:idRepositorio/abrir-intellij` | `204` — pasta aberta como projeto no IntelliJ |
| `GET` | `/api/clientes/:id/repositorios/:idRepositorio/mcp` | `200` — conteúdo do `.sankhya-mcp.env` |
| `PUT` | `/api/clientes/:id/repositorios/:idRepositorio/mcp` | `204` — arquivo criado ou sobrescrito |
| `POST` | `/api/clientes/:id/links` | `201` — link criado |
| `PUT` | `/api/clientes/:id/links/:idLink` | `200` — link atualizado |
| `DELETE` | `/api/clientes/:id/links/:idLink` | `204` — sem conteúdo |
| `GET` | `/api/situacao-git?forcar=true` | `200` — situação Git dos repositórios com pasta local, indexada pelo id |
| `GET` | `/api/configuracao` | `200` — configuração global |
| `PUT` | `/api/configuracao` | `200` — configuração salva |
| `POST` | `/api/atalhos/selecionar-executavel` | `200` — caminho escolhido; `204` quando cancelado |
| `POST` | `/api/atalhos/:id/abrir` | `204` — programa do atalho iniciado |

Corpo de cliente:

```json
{ "nome": "Indústria Alfa" }
```

Corpo de base:

```json
{
  "url": "https://erp.alfa.com.br:8180/mge",
  "tipo": "producao",
  "usuario": "admin",
  "senha": "..."
}
```

Corpo de banco de dados:

```json
{
  "host": "192.168.0.10",
  "porta": 1521,
  "nomeDoServico": "ORCL",
  "usuario": "system",
  "senha": "..."
}
```

Cada base tem no máximo um banco, por isso o `PUT` faz as duas coisas: vincula
quando não existe e substitui quando existe. `porta` aceita número ou texto
numérico e precisa ficar entre 1 e 65535. O `DELETE` é idempotente — desvincular
uma base que já está sem banco também responde `204`.

Corpo de repositório:

```json
{
  "nome": "Addon de faturamento",
  "url": "https://github.com/grupo/projeto",
  "caminhoLocal": "C:\\Workspace\\projeto"
}
```

`caminhoLocal` é opcional e, quando informado, precisa ser um caminho absoluto.
Não exige que a pasta exista no momento do cadastro — o repositório pode ainda
não ter sido clonado. A ausência da pasta só aparece ao tentar abri-la.

`tipo` aceita apenas `producao`, `teste` ou `outro`. Toda `url` precisa ser
`http` ou `https` válida — endereços SSH (`git@host:grupo/projeto.git`) são
recusados. A `senha` não é aparada: espaço nas pontas pode fazer parte dela.

Erros retornam `{ "mensagem": "..." }` com `400` (dados inválidos), `404`
(cliente ou base inexistente) ou `409` (conflito). São conflito o nome de
cliente repetido, o par URL + usuário repetido nas bases do mesmo cliente e a
URL de repositório repetida no mesmo cliente. Nas bases, a mesma URL pode
aparecer várias vezes desde que o usuário mude — assim dá para cadastrar um
acesso de administração e outro de consulta na mesma base. Todas as comparações
ignoram maiúsculas e espaços nas pontas.

---

## Estrutura

```
src/
  index.ts                                  sobe o Fastify e serve public/
  configuracao.ts                           porta, host e diretório de dados
  tipos.ts                                  os tipos Cliente, Base e RepositorioGit
  repositorio/repositorioClientes.ts        contrato de persistência e erros de domínio
  repositorio/repositorioClientesArquivo.ts implementação em arquivo JSON local
  repositorio/repositorioConfiguracao.ts    contrato da configuração global
  repositorio/repositorioConfiguracaoArquivo.ts  configuração em arquivo JSON local
  rotas/rotasClientes.ts                    rotas HTTP e validação de entrada
  rotas/rotasConfiguracao.ts                rotas da configuração global
  rotas/rotasGit.ts                         rota da situação dos repositórios locais
  rotas/rotasAtalhos.ts                     rota que dispara os atalhos cadastrados
  git/executarGit.ts                        executa comandos git sem shell e sem prompt
  git/provedorDeHospedagem.ts               lê a URL do remoto: host, GitHub ou GitLab
  git/situacaoDoRepositorio.ts              diagnóstico de um repositório local
  git/cacheDeSituacao.ts                    cache por tempo e limite de leituras simultâneas
  sistema/observadorDeDados.ts              descarta o cache quando dados-hub-snk/ muda no disco
  sistema/pasta.ts                          checagem de existência de diretório
  sistema/abrirPasta.ts                     abre uma pasta no gerenciador do SO
  sistema/abrirShell.ts                     abre o terminal do SO na pasta
  sistema/lancadorJetBrains.ts              descobre e dispara launchers das IDEs JetBrains
  sistema/abrirIntelliJ.ts                  abre a pasta como projeto no IntelliJ IDEA
  sistema/abrirExecutavel.ts                inicia o programa de um atalho
  sistema/selecionarArquivo.ts              abre o seletor de arquivo do SO
  sistema/arquivoMcp.ts                     lê e grava o .sankhya-mcp.env do repositório
public/
  index.html  styles.css  app.js            interface, sem framework e sem build
  leitorDeFavoritos.js                      lê o arquivo de favoritos de qualquer navegador suportado
  tipoDeBaseNoNome.js                       tira Produção/Teste do nome do favorito
  manifest.webmanifest  sw.js               o que torna o HUB SNK instalável
scripts/
  gerar-icones.mjs                          gera os PNG do manifest (npm run gerar-icones)
```

As rotas dependem apenas da interface `RepositorioClientes`. Trocar o
armazenamento local por outro — banco, API remota — é implementar essa interface
e injetá-la no `index.ts` — nada mais muda.

---

## Importar bases dos favoritos do navegador

O botão **Importar** (ícone de estrela, no topo da lista de clientes) abre um
assistente que transforma favoritos do navegador em bases de clientes: escolher
a origem, selecionar o arquivo de favoritos, marcar os favoritos desejados na
árvore e conferir nome, URL, tipo, usuário e senha antes de concluir.

O assistente **não pergunta qual é o navegador**: o formato do arquivo é
reconhecido pelo próprio conteúdo.

### Tipo da base reconhecido pelo nome

Quando o nome do favorito carrega o ambiente, o tipo já vem preenchido e o
marcador sai do nome do cliente — `COCA - PROD` vira o cliente `COCA` com a base
de Produção. O marcador é aceito no começo ou no fim, entre `()`, `[]` ou `{}`
ou solto, separado por espaço, `-`, `–`, `|`, `/`, `:` ou `_`, com ou sem
acento e em qualquer caixa:

| Tipo | Marcadores reconhecidos |
|---|---|
| Produção | `p`, `pd`, `pro`, `prd`, `prod`, `producao`, `produção`, `produtivo`, `production` |
| Teste | `t`, `ts`, `tes`, `tst`, `test`, `teste`, `testes`, `hom`, `hmg`, `hml`, `homol`, `homolog`, `homologacao`, `homologação` |

Exemplos que caem todos em `COCA`: `COCA - PROD`, `PROD - COCA`, `P - COCA`,
`COCA (P)`, `(P) COCA`, `COCA [T]`, `PRODUÇÃO - COCA`, `COCA/TESTE`,
`COCA_PROD`.

Nada é retirado quando sobraria um nome vazio (`PROD` sozinho continua `PROD`)
ou quando o marcador é parte de uma palavra (`COCA - PRODUTOS` fica intacto).
Sem marcador, o tipo fica em branco e o usuário escolhe na última etapa.

Homologação é tratada como Teste: o HUB SNK só tem os tipos Produção, Teste e
Outro.

### Navegadores suportados

A importação é suportada **apenas** para estes cinco navegadores:

| Navegador | Arquivo aceito | Onde obter |
|---|---|---|
| Google Chrome | `Bookmarks` / `AccountBookmarks` (JSON, sem extensão) ou HTML exportado | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\` ou **Favoritos > Gerenciador de favoritos > ⋮ > Exportar favoritos** |
| Microsoft Edge | `Bookmarks` (JSON, sem extensão) ou HTML exportado | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\` ou **Favoritos > ⋯ > Exportar favoritos** |
| Opera | `Bookmarks` (JSON, sem extensão) ou HTML exportado | `%APPDATA%\Opera Software\Opera Stable\Default\` ou **Favoritos > Exportar favoritos** |
| Mozilla Firefox | HTML exportado ou backup `.json` | **Favoritos > Gerenciar favoritos > Importar e fazer backup > Exportar favoritos para HTML** |
| Safari | HTML exportado | **Arquivo > Exportar > Favoritos** |

Qualquer outro navegador está fora do escopo: o arquivo é recusado com aviso na
própria tela.

Detalhes que valem saber:

- O backup padrão do Firefox (`bookmarks-*.jsonlz4`) é compactado e **não** é
  aceito — o assistente avisa e indica a exportação em HTML.
- O Safari não guarda os favoritos em formato aberto (`Bookmarks.plist` é
  binário e só existe no macOS); o caminho é sempre a exportação em HTML.
- Favoritos que não sejam `http` ou `https` (`javascript:`, `place:`, `chrome://`)
  aparecem na árvore desmarcáveis: o HUB SNK só abre endereços navegáveis.
- O arquivo é lido no próprio navegador; nada dele é enviado ao servidor além
  das bases confirmadas na última etapa.

## Anotações do cliente

O último bloco do detalhe do cliente é uma caixa de texto livre — contatos,
particularidades, combinados, o que for. São até 5000 caracteres, com quebra de
linha preservada.

Não há botão de salvar: a gravação acontece ao sair do campo, e um aviso
confirma. Só os espaços das pontas são aparados. Se a gravação falhar, o texto
digitado continua no campo e o aviso explica o motivo — nada se perde.

O detalhe é redesenhado sozinho enquanto a tela está aberta (atualização
automática da situação Git, por exemplo); o texto em digitação e a posição do
cursor sobrevivem a esses redesenhos.

## Abrir a pasta do repositório

Quando um repositório tem `caminhoLocal`, a linha dele ganha o botão
**Arquivos**, que abre a pasta no gerenciador de arquivos do sistema:

| Sistema | Comando usado |
|---|---|
| Windows | `explorer.exe` |
| macOS | `open` |
| Linux e demais Unix | `xdg-open` |

O caminho vai como argumento separado do comando, sem shell no meio — um
caminho contendo `&&` ou `;` é tratado como texto, não como comando. E a
requisição informa apenas *qual repositório* abrir: o caminho sempre vem do
registro gravado, nunca do corpo da chamada.

Em Linux sem `xdg-open` instalado (ambiente mínimo, sem desktop) o botão não
tem efeito e a falha fica registrada no log do servidor.

## Banco de dados do MCP Claude

O botão de tomada, na linha do repositório, edita o arquivo `.sankhya-mcp.env`
na raiz da pasta local. **Esses dados não vão para o cadastro** — vivem só nesse
arquivo, junto do repositório:

```
SANKHYA_DB_HOST=192.168.0.10
SANKHYA_DB_PORT=1521
SANKHYA_DB_SERVICE_NAME=ORCL
SANKHYA_DB_USER=system
SANKHYA_DB_PASSWORD=...
```

Uma linha por variável, sem aspas e sem quebra de linha no fim do arquivo. A
senha pode conter `=`: na leitura, só o primeiro sinal separa chave de valor.

Ao abrir o formulário, o arquivo existente é carregado; se não existir, o
formulário abre em branco e o arquivo é criado ao salvar. Variáveis que já
estivessem no arquivo e não sejam essas cinco são preservadas no fim.

O botão **Importar** copia host, porta, service name, usuário e senha de uma
base do mesmo cliente que tenha banco vinculado. Ele só preenche o formulário —
nada é gravado antes de você clicar em Salvar.

O botão só aparece em repositórios com caminho local, já que o arquivo precisa
de uma pasta onde morar. A cor dele mostra a situação sem abrir o formulário:

| Cor | Situação |
|---|---|
| Verde | o arquivo existe e as cinco variáveis estão preenchidas |
| Neutro | o arquivo não existe, ou existe incompleto — o `title` do botão distingue os dois |

Essa situação vem no campo `mcp` de cada repositório com caminho local, tanto
no `GET /api/clientes` quanto no `GET /api/clientes/:id`. É estado do disco,
lido a cada requisição — pasta inexistente ou ilegível conta como arquivo
ausente e nunca derruba a resposta.

> Como o arquivo fica dentro do repositório, vale conferir se `.sankhya-mcp.env`
> está no `.gitignore` do projeto — ele contém a senha do banco.

## Abrir o terminal no repositório

O botão **Shell**, ao lado de *Arquivos*, abre o terminal do sistema já
posicionado na pasta do repositório. Se o **Script padrão** estiver preenchido
nas configurações (engrenagem no topo), ele é executado assim que o terminal
abre, e a janela continua aberta depois para você ler a saída.

| Sistema | Como abre |
|---|---|
| Windows | Windows Terminal quando existe; o shell é `pwsh.exe`, `powershell.exe` ou `cmd.exe`, o primeiro encontrado no PATH |
| macOS | `Terminal.app`, via `osascript` quando há script a executar |
| Linux | primeiro encontrado entre `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` e `xterm` |

Se nenhum terminal for encontrado, a API responde `503` e o HUB SNK mostra o
aviso na tela.

## Abrir o repositório no IntelliJ

O botão de chaves `{ }`, ao lado de *Shell*, abre a pasta do
repositório como projeto no IntelliJ IDEA. O caminho vai como argumento do
processo, sem passar por shell.

| Sistema | Como abre |
|---|---|
| Windows | primeiro encontrado no PATH entre `idea64.exe`, `idea.exe`, `idea.cmd` e `idea.bat`; os `.cmd`/`.bat` são executados via `cmd.exe /c` |
| macOS | `open -n -a "IntelliJ IDEA"` (ou a edição *CE*), com `idea` como alternativa |
| Linux | primeiro encontrado entre `intellij-idea-ultimate`, `intellij-idea-community`, `idea` e `idea.sh` |

Se nenhum launcher for encontrado, a API responde `503` e o HUB SNK mostra o
aviso. No Windows, a pasta `bin` da IDE precisa estar no PATH — ou o launcher de
linha de comando precisa ter sido gerado pelo JetBrains Toolbox.

## Atalhos

O botão de raio, à direita do botão de tema, abre a lista dos atalhos
cadastrados logo abaixo dele; o clique em um deles inicia o programa na sua
máquina. A lista é posicionada por cima da tela, então abrir e fechar não
desloca nada do que já está desenhado. Ela fica no ar até um clique em qualquer
ponto fora dela — ou `Esc` — fechá-la. O cadastro fica em
**Configurações › Atalhos**, com *Nome* e *Caminho do executável*, e é gravado
no `configuracao.json` junto com o resto da configuração global.

O botão de pasta ao lado do caminho abre o seletor de arquivos do sistema e
preenche o campo com o que for escolhido. O diálogo é aberto pelo servidor, e
não pelo navegador: `input[type=file]` devolve só o nome do arquivo, e o HUB SNK
precisa do caminho absoluto para executar o programa depois. O campo continua
editável — dá para colar um caminho ou ajustar o que veio do seletor.

| Sistema | Seletor |
|---|---|
| Windows | `OpenFileDialog` do Windows Forms, via `powershell.exe -STA` |
| macOS | `choose file`, via `osascript` |
| Linux | `zenity --file-selection`, com `kdialog` como alternativa |

No Linux, sem nenhum dos dois a API responde `503` e resta digitar o caminho.

O caminho vai como argumento do despachante do sistema — `explorer.exe` no
Windows, `open` no macOS, `xdg-open` no Linux —, nunca por shell. Por isso vale
tanto para `.exe` quanto para `.lnk`, `.bat` e qualquer extensão associada, e um
caminho com aspas ou `&&` é tratado como texto.

O disparo é `POST /api/atalhos/:id/abrir`: a requisição manda só o id, e o
caminho sai do cadastro — nada executa um programa que não foi cadastrado. A
existência do arquivo é checada na hora de executar, não no cadastro, então dá
para cadastrar o caminho de um programa ainda não instalado; sem o arquivo, a
API responde `404` e o HUB SNK mostra o aviso.

## Situação dos repositórios

Todo repositório com **caminho local** é verificado e ganha um selo na própria
linha, com a branch atual e a pendência mais grave. O clique no selo abre a
lista completa, cada item com o comando que resolve e um botão de copiar. Na
lista de clientes, uma bolinha resume a pior situação entre os repositórios
daquele cliente.

As cores nunca aparecem sozinhas — sempre acompanham o texto da pendência:

| Cor | Significado |
|---|---|
| Vermelho | Precisa de ação: risco de perder trabalho, de vazar segredo ou o clone nem existe |
| Amarelo | Pendência normal: falta commitar, falta versionar, falta esvaziar o stash |
| Verde | Nada pendente: tudo commitado |
| Cinza | Não foi possível verificar |

O que é verificado:

| Pendência | Gravidade |
|---|---|
| A pasta cadastrada não existe, ou existe e não é um repositório Git | Vermelho |
| O repositório local não tem remoto vinculado | Vermelho |
| Merge, rebase, cherry-pick ou revert pela metade | Vermelho |
| Arquivos com conflito não resolvido | Vermelho |
| `.sankhya-mcp.env` rastreado pelo Git — a senha do banco vai para o remoto no próximo push | Vermelho |
| O remoto aponta para endereço diferente da URL cadastrada no HUB SNK | Amarelo |
| Arquivos rastreados alterados e não commitados | Amarelo |
| Arquivos novos fora do controle de versão e fora do `.gitignore` | Amarelo |
| Alterações guardadas no stash | Amarelo |
| O repositório ainda não tem nenhum commit | Amarelo |

O provedor (GitHub ou GitLab) é deduzido do host do remoto. GitLab instalado no
domínio da empresa (`gitlab.suaempresa.com.br`) é reconhecido pelo nome no host;
um domínio sem pista nenhuma fica como desconhecido, sem palpite.

O nome da branch atual aparece no selo apenas como informação: nada do
diagnóstico compara branches entre si nem mede distância para o remoto.

Nenhuma parte do diagnóstico usa a rede: todos os comandos são leituras do
disco. O `git` roda sem prompt de credencial (`GIT_TERMINAL_PROMPT=0`), então
nenhum repositório trava o HUB SNK esperando senha.

O `title` do selo mostra a hora da última verificação, e o botão de recarregar
do cliente refaz o diagnóstico de todos os repositórios ignorando o cache de 30
segundos.

### Atualização automática

Em **Configurações**, o campo **Atualizar a situação Git automaticamente**
(ligado por padrão) refaz o diagnóstico local a cada minuto enquanto a aba
está em primeiro plano — mesma leitura do botão de recarregar, só que sem
precisar clicar. Para de rodar sozinho quando a aba perde o foco ou é
minimizada, e não força o cache do servidor: cada tique só busca o que já
tinha expirado.

### Sobre o Script padrão

O script **é interpretado pelo shell** — é essa a função do campo. Ele roda na
sua máquina, com as suas permissões, na pasta do repositório. Vale o mesmo
critério de digitar um comando direto no terminal: só coloque ali o que você
mesmo executaria.

A requisição de abertura informa apenas *qual repositório* abrir. Tanto a pasta
quanto o script vêm do que está gravado em disco, nunca do corpo da chamada —
não existe caminho pela API para executar um comando arbitrário sem antes
gravá-lo na configuração.

## Verificação

```bash
npm run typecheck
```
