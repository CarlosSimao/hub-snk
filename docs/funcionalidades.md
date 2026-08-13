# Funcionalidades em detalhe

O que cada recurso do HUB SNK faz, com as regras que valem por baixo: qual
programa é chamado em cada sistema, que formato de arquivo é aceito, o que
dispara cada cor. O [README](../README.md) traz o resumo; aqui está o detalhe.

## Cadastro de clientes

Cada cliente reúne quatro listas: **bases** (a URL do ERP, com usuário, senha e
o banco de dados vinculado), **repositórios** Git, **links** avulsos e as
**anotações**.

Nomes de cliente não se repetem. Nas bases, a mesma URL pode aparecer várias
vezes desde que o usuário mude — assim dá para cadastrar um acesso de
administração e outro de consulta na mesma base. Repositório com URL repetida no
mesmo cliente é recusado. Todas as comparações ignoram maiúsculas e espaços nas
pontas.

Cada base tem no máximo um banco de dados. A senha não é aparada: espaço nas
pontas pode fazer parte dela.

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

## Importação de favoritos do navegador

O botão **Importar** (no pé da lista de clientes) abre um assistente que transforma favoritos do navegador em bases de clientes: escolher
a origem, selecionar o arquivo de favoritos, marcar os favoritos desejados na
árvore e conferir nome, URL, tipo, usuário e senha antes de concluir.

O assistente **não pergunta qual é o navegador**: o formato do arquivo é
reconhecido pelo próprio conteúdo. O arquivo é lido no próprio navegador; nada
dele chega ao servidor além das bases confirmadas na última etapa.

### Navegadores suportados

| Navegador       | Arquivo aceito                                                          | Onde obter                                                                                                             |
| --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Google Chrome   | `Bookmarks` / `AccountBookmarks` (JSON, sem extensão) ou HTML exportado | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\` ou **Favoritos > Gerenciador de favoritos > ⋮ > Exportar favoritos** |
| Microsoft Edge  | `Bookmarks` (JSON, sem extensão) ou HTML exportado                      | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\` ou **Favoritos > ⋯ > Exportar favoritos**                           |
| Opera           | `Bookmarks` (JSON, sem extensão) ou HTML exportado                      | `%APPDATA%\Opera Software\Opera Stable\Default\` ou **Favoritos > Exportar favoritos**                                 |
| Mozilla Firefox | HTML exportado ou backup `.json`                                        | **Favoritos > Gerenciar favoritos > Importar e fazer backup > Exportar favoritos para HTML**                           |
| Safari          | HTML exportado                                                          | **Arquivo > Exportar > Favoritos**                                                                                     |

O arquivo de qualquer outro navegador é recusado com aviso na própria tela.

- O backup padrão do Firefox (`bookmarks-*.jsonlz4`) é compactado e **não** é
  aceito — o assistente avisa e indica a exportação em HTML.
- O Safari não guarda os favoritos em formato aberto (`Bookmarks.plist` é
  binário e só existe no macOS); o caminho é sempre a exportação em HTML.
- Favoritos que não sejam `http` ou `https` (`javascript:`, `place:`, `chrome://`)
  aparecem na árvore desmarcáveis: o HUB SNK só abre endereços navegáveis.

### Tipo da base deduzido do nome

Quando o nome do favorito carrega o ambiente, o tipo já vem preenchido e o
marcador sai do nome do cliente — `COCA - PROD` vira o cliente `COCA` com a base
de Produção. O marcador é aceito no começo ou no fim, entre `()`, `[]` ou `{}`
ou solto, separado por espaço, `-`, `–`, `|`, `/`, `:` ou `_`, com ou sem
acento e em qualquer caixa:

| Tipo     | Marcadores reconhecidos                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Produção | `p`, `pd`, `pro`, `prd`, `prod`, `producao`, `produção`, `produtivo`, `production`                                        |
| Teste    | `t`, `ts`, `tes`, `tst`, `test`, `teste`, `testes`, `hom`, `hmg`, `hml`, `homol`, `homolog`, `homologacao`, `homologação` |

Exemplos que caem todos em `COCA`: `COCA - PROD`, `PROD - COCA`, `P - COCA`,
`COCA (P)`, `(P) COCA`, `COCA [T]`, `PRODUÇÃO - COCA`, `COCA/TESTE`,
`COCA_PROD`.

Nada é retirado quando sobraria um nome vazio (`PROD` sozinho continua `PROD`)
ou quando o marcador é parte de uma palavra (`COCA - PRODUTOS` fica intacto).
Sem marcador, o tipo fica em branco e você escolhe na última etapa.

Homologação é tratada como Teste: o HUB SNK só tem os tipos Produção, Teste e
Outro.

## Exportar e importar cadastros

O botão **Exportar**, ao lado do **Importar** no pé da lista de clientes, gera um
`.txt` com os cadastros escolhidos. São duas etapas: marcar os clientes (com
marcar e desmarcar todos) e, depois, escolher o que sai de cada um.

**Nome do cliente, URL e tipo de cada base sempre saem.** As duas colunas da
segunda etapa acrescentam o resto, e cada uma tem o seu marcar/desmarcar todos:

| Coluna          | O que acrescenta ao arquivo                              |
| --------------- | -------------------------------------------------------- |
| **Credenciais** | usuário e senha de cada base                             |
| **Banco**       | host, porta, serviço, usuário e senha do banco vinculado |

A coluna fica bloqueada no cliente que não tem o que exportar nela — nenhuma base
com credencial anotada, nenhuma base com banco. Cliente sem base nenhuma entra no
arquivo só com o nome, o suficiente para recriar o cadastro do outro lado. O
resultado pode ser baixado ou copiado.

O formato é o mesmo do botão **Compartilhar** do cliente: blocos legíveis
separados por uma linha de traços. Por isso a importação lê os dois arquivos —
o de vários clientes e o de um só — pela mesma opção do assistente.

### Importar de volta

No assistente de importação, a opção **Importar cadastros de arquivo do HUB SNK**
aceita o arquivo arrastado ou escolhido no explorador. A leitura acontece no
próprio navegador; só o que você confirma na última etapa chega ao servidor.

A etapa de conferência separa o que entra do que precisa de decisão:

- **Entra direto** — cliente que ainda não existe e base cuja URL ninguém tem.
- **Já cadastrada** — base cuja URL já existe no cliente. Cada uma aparece com o
  cadastro atual e o importado lado a lado, e você escolhe qual fica. Havendo mais
  de uma, os botões **Manter todos os atuais** e **Substituir todos** decidem em
  bloco.

Toda decisão nasce em **manter o atual**: concluir sem mexer em nada nunca
sobrescreve cadastro. A senha aparece mascarada nas duas colunas — para decidir
basta saber que ela mudou, e a marca **diferente** aponta cada campo que muda.

**A substituição troca só o que o arquivo trouxe.** Arquivo exportado sem
"Credenciais" preserva o usuário e a senha já gravados; sem "Banco", preserva o
banco vinculado. Não exportar um campo não é o mesmo que apagá-lo — por isso
substituir um arquivo enxuto só atualiza a URL e o tipo.

O cliente é reconhecido pelo nome, tolerando caixa, acento e separador — o mesmo
critério da importação de favoritos, então `NecoTruck` e `Neco Truck` são o mesmo
cadastro. Dentro do cliente, é a URL que identifica a base.

O que o leitor não conseguiu aproveitar aparece na própria etapa, em vez de sumir:
bloco sem `Cliente:`, base sem URL ou com URL que não é `http`/`https`, banco de
dados incompleto e URL repetida no mesmo cliente (vale a primeira). O resto do
arquivo entra normalmente.

## Os botões do repositório

Repositório com **caminho local** cadastrado ganha quatro botões na própria
linha: **Arquivos** abre a pasta no gerenciador de arquivos, **Shell** abre o
terminal já posicionado nela, **`{ }`** abre a pasta como projeto no IntelliJ
IDEA e a **tomada** edita o `.sankhya-mcp.env`.

Se o **Script padrão** estiver preenchido em _Configurações_ (engrenagem no
topo), o botão Shell o executa assim que o terminal abre, e a janela continua
aberta depois para você ler a saída.

> O **Script padrão** é interpretado pelo shell — é essa a função do campo. Ele
> roda na sua máquina, com as suas permissões, na pasta do repositório. Vale o
> mesmo critério de digitar um comando direto no terminal: só coloque ali o que
> você mesmo executaria.

### Que programa é chamado em cada sistema

| Botão                            | Windows                                                                                                                    | macOS                                                                        | Linux                                                                                         |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **Arquivos**                     | `explorer.exe`                                                                                                             | `open`                                                                       | `xdg-open`                                                                                    |
| **Shell**                        | Windows Terminal quando existe; o shell é `pwsh.exe`, `powershell.exe` ou `cmd.exe`, o primeiro encontrado no PATH         | `Terminal.app`, via `osascript` quando há script a executar                  | primeiro entre `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` e `xterm` |
| **`{ }`**                        | primeiro no PATH entre `idea64.exe`, `idea.exe`, `idea.cmd` e `idea.bat`; os `.cmd`/`.bat` são executados via `cmd.exe /c` | `open -n -a "IntelliJ IDEA"` (ou a edição _CE_), com `idea` como alternativa | primeiro entre `intellij-idea-ultimate`, `intellij-idea-community`, `idea` e `idea.sh`        |
| **Seletor de arquivo** (atalhos) | `OpenFileDialog` do Windows Forms, via `powershell.exe -STA`                                                               | `choose file`, via `osascript`                                               | `zenity --file-selection`, com `kdialog` como alternativa                                     |

Quando nada é encontrado, o HUB SNK mostra o aviso na tela — exceto o
**Arquivos** no Linux sem `xdg-open`, em que o botão fica sem efeito e a falha
só aparece no log do servidor. No Windows, a pasta `bin` do IntelliJ precisa
estar no PATH, ou o launcher de linha de comando precisa ter sido gerado pelo
JetBrains Toolbox. No Linux sem `zenity` nem `kdialog`, resta digitar o caminho
do atalho à mão.

### Arquivo `.sankhya-mcp.env`

O botão de tomada grava este arquivo na raiz da pasta local do repositório.
**Esses dados não vão para o cadastro do HUB SNK** — vivem só nesse arquivo:

```
SANKHYA_DB_HOST=192.168.0.10
SANKHYA_DB_PORT=1521
SANKHYA_DB_SERVICE_NAME=ORCL
SANKHYA_DB_USER=system
SANKHYA_DB_PASSWORD=...
```

Uma linha por variável, sem aspas e sem quebra de linha no fim do arquivo. A
senha pode conter `=`: na leitura, só o primeiro sinal separa chave de valor.
Variáveis que já estivessem no arquivo e não sejam essas cinco são preservadas
no fim.

Ao abrir o formulário, o arquivo existente é carregado; se não existir, o
formulário abre em branco e o arquivo é criado ao salvar. O botão **Importar**,
dentro do formulário, copia host, porta, service name, usuário e senha de uma
base do mesmo cliente que tenha banco vinculado — só preenche os campos, nada é
gravado antes de você clicar em Salvar.

A cor do botão mostra a situação sem abrir o formulário: **verde** quando o
arquivo existe com as cinco variáveis preenchidas, **neutro** quando não existe
ou está incompleto — o `title` do botão distingue os dois casos.

> O arquivo guarda a senha do banco e fica **dentro** do repositório. Confira se
> ele está no `.gitignore` do projeto — o diagnóstico marca em vermelho o
> repositório em que ele estiver sendo rastreado pelo Git.

## Atalhos

O botão de raio, à direita do botão de tema, abre a lista dos atalhos
cadastrados; o clique em um deles inicia o programa na sua máquina. A lista fica
no ar até um clique fora dela — ou `Esc` — fechá-la. O cadastro fica em
**Configurações › Atalhos**, com _Nome_ e _Caminho do executável_.

Com mais de cinco atalhos cadastrados, a lista ganha um campo de busca no topo,
já com o foco quando ela abre: é só digitar. O filtro casa o nome **e** o
caminho — dois "IntelliJ" se distinguem pela pasta, que é do que a gente
lembra. O campo acompanha a rolagem, para não sumir numa lista longa, e o filtro
é esquecido ao fechar a lista, que reabre inteira. Até cinco atalhos não há
campo nenhum: a lista se lê de relance, e a busca só atrapalharia.

O botão de pasta ao lado do caminho abre o seletor de arquivos do sistema e
preenche o campo. O campo continua editável — dá para colar um caminho ou
ajustar o que veio do seletor.

Vale para `.exe`, `.lnk`, `.bat` e qualquer extensão associada. A existência do
arquivo é checada na hora de executar, não no cadastro, então dá para cadastrar
o caminho de um programa ainda não instalado; sem o arquivo, o HUB SNK avisa na
tela.

## Diagnóstico dos repositórios Git

Todo repositório com **caminho local** é verificado e ganha um selo na própria
linha, com a branch atual e a pendência mais grave. O clique no selo abre a
lista completa, cada item com o comando que resolve e um botão de copiar. Na
lista de clientes, uma bolinha resume a pior situação entre os repositórios
daquele cliente.

As cores nunca aparecem sozinhas — sempre acompanham o texto da pendência:

| Cor      | Significado                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| Vermelho | Precisa de ação: risco de perder trabalho, de vazar segredo ou o clone nem existe |
| Amarelo  | Pendência normal: falta commitar, falta versionar, falta esvaziar o stash         |
| Verde    | Nada pendente: tudo commitado e enviado                                           |
| Cinza    | Não foi possível verificar                                                        |

O que é verificado, e com que gravidade:

| Pendência                                                                                  | Gravidade |
| ------------------------------------------------------------------------------------------ | --------- |
| A pasta cadastrada não existe, ou existe e não é um repositório Git                        | Vermelho  |
| O repositório local não tem remoto vinculado                                               | Vermelho  |
| Merge, rebase, cherry-pick ou revert pela metade                                           | Vermelho  |
| Arquivos com conflito não resolvido                                                        | Vermelho  |
| `.sankhya-mcp.env` rastreado pelo Git — a senha do banco vai para o remoto no próximo push | Vermelho  |
| O remoto aponta para endereço diferente da URL cadastrada no HUB SNK                       | Amarelo   |
| Arquivos rastreados alterados e não commitados                                             | Amarelo   |
| Arquivos novos fora do controle de versão e fora do `.gitignore`                           | Amarelo   |
| Commits locais ainda não enviados ao remoto                                                | Amarelo   |
| A branch atual não tem upstream — os commits dela só existem nesta máquina                 | Amarelo   |
| Alterações guardadas no stash                                                              | Amarelo   |
| O repositório ainda não tem nenhum commit                                                  | Amarelo   |

O provedor (GitHub ou GitLab) é deduzido do host do remoto. GitLab instalado no
domínio da empresa (`gitlab.suaempresa.com.br`) é reconhecido pelo nome no host;
um domínio sem pista nenhuma fica como desconhecido, sem palpite.

O nome da branch atual aparece no selo apenas como informação: o diagnóstico não
compara branches entre si.

A contagem de commits não enviados sai do próprio repositório local, sem rede:
são commits que existem aqui e não na última posição conhecida do remoto. O
caminho inverso — commits que chegaram ao remoto e ainda não vieram para cá —
fica de fora justamente por depender de `fetch`: sem ele o número envelhece sem
aviso e acusaria pendência onde não há, ou silenciaria onde há.

Nenhuma parte do diagnóstico usa a rede: todos os comandos são leituras do
disco. O `git` roda sem prompt de credencial, então nenhum repositório trava o
HUB SNK esperando senha. O resultado fica em cache por 30 segundos, e o botão de
recarregar do cliente refaz tudo ignorando o cache.

### Atualização automática

Em **Configurações**, o campo **Atualizar a situação Git automaticamente**
(ligado por padrão) refaz o diagnóstico local a cada minuto enquanto a aba está
em primeiro plano — mesma leitura do botão de recarregar, só que sem precisar
clicar. Para de rodar sozinho quando a aba perde o foco ou é minimizada.

## Backup na nuvem

Não há backup embutido. Para ter um, sincronize a pasta de dados com o serviço
de nuvem que você já usa — Google Drive, OneDrive, Dropbox: basta adicioná-la à
sincronização do cliente instalado na máquina, ou apontar o `HUB_DADOS_DIR` para
dentro de uma pasta que já é sincronizada.

> Os arquivos sobem como estão no disco, e o cadastro guarda as senhas das bases
> e dos bancos em texto puro. Confira se a pasta não está compartilhada com
> ninguém.

Usando em mais de uma máquina, feche o HUB SNK de uma antes de abrir na outra: a
sincronização é de arquivo, e edição simultânea faz uma das versões se perder.
Alteração que chega de fora com o HUB SNK aberto é percebida sozinha — ele vigia
a pasta e relê o arquivo.
