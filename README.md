# HUB SNK

[![Versão](https://img.shields.io/github/v/release/CarlosSimao/hub-snk?label=vers%C3%A3o)](https://github.com/CarlosSimao/hub-snk/releases)
[![Licença](https://img.shields.io/github/license/CarlosSimao/hub-snk)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.18-brightgreen)](https://nodejs.org)

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

## Instalação no Windows

Baixe o `hub-snk-<versão>-windows-x64.exe` na
[página de releases](https://github.com/CarlosSimao/hub-snk/releases) e execute.

O instalador **não pede senha de administrador** e **não exige Node.js
instalado** — ele já traz o necessário. Instala na sua pasta de usuário e
oferece duas opções:

| Opção                       | O que faz                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| Atalho na área de trabalho  | Ícone do HUB SNK ao lado do menu Iniciar                                                        |
| Iniciar junto com o Windows | O servidor sobe sozinho no logon, sem abrir janela. Você abre a tela quando quiser, pelo atalho |

O atalho abre o HUB SNK em **janela própria**, sem barra de endereço e sem abas
— usa o Edge ou o Chrome já instalado, sem precisar instalar a PWA pelo botão do
navegador.

Seu cadastro fica em `%LOCALAPPDATA%\HubSnk\dados`, fora da pasta do programa.
Desinstalar **não apaga o cadastro**; atualizar também não.

### Atualizar no Windows

Baixe o instalador da versão nova e execute por cima. Não é preciso desinstalar
antes.

---

## Instalação no Linux e no macOS

Baixe o pacote da sua plataforma na
[página de releases](https://github.com/CarlosSimao/hub-snk/releases):

| Plataforma                             | Arquivo                               |
| -------------------------------------- | ------------------------------------- |
| Linux                                  | `hub-snk-<versão>-linux-x64.tar.gz`   |
| macOS com Apple Silicon (M1 em diante) | `hub-snk-<versão>-macos-arm64.tar.gz` |
| macOS com processador Intel            | `hub-snk-<versão>-macos-x64.tar.gz`   |

```bash
tar -xzf hub-snk-*-linux-x64.tar.gz
cd hub-snk-*-linux-x64
./hub-snk.sh
```

O pacote **já traz o Node** — não é preciso ter Node.js instalado.

```bash
./hub-snk.sh            # sobe o servidor e abre a janela
./hub-snk.sh servidor   # sobe o servidor sem abrir nada
./hub-snk.sh parar      # encerra o servidor
```

Seu cadastro fica em `~/.local/share/hub-snk/dados`, fora da pasta do pacote.
Para atualizar, apague a pasta do pacote e descompacte a versão nova — o
cadastro fica onde está.

> No macOS, a primeira execução pode ser barrada pelo Gatekeeper, porque o
> pacote não é assinado. Libere em _Ajustes do Sistema_ › _Privacidade e
> Segurança_, ou rode `xattr -dr com.apple.quarantine .` dentro da pasta.

---

## Rodar a partir do código

| Item                   | Versão               | Para quê                                                                                        |
| ---------------------- | -------------------- | ----------------------------------------------------------------------------------------------- |
| **Node.js**            | 22.18 ou superior    | Executa o servidor. A partir dessa versão o Node roda arquivos `.ts` direto, sem etapa de build |
| **Navegador Chromium** | Chrome ou Edge atual | Necessário para instalar a PWA em janela separada                                               |

```bash
npm install
npm start
```

HUB SNK em <http://127.0.0.1:4100>.

Os scripts `iniciar.sh` (Linux e macOS) e `iniciar.vbs` (Windows) sobem o
servidor em segundo plano, sem deixar terminal aberto.

### Instalar como aplicativo (janela separada)

Com o HUB SNK aberto no navegador:

- **Chrome / Edge**: ícone de instalação na barra de endereço, ou menu
  ⋮ → _Instalar HUB SNK_.
- **macOS (Safari)**: _Arquivo_ → _Adicionar ao Dock_.

Depois de instalado, o HUB SNK abre em janela própria, sem barra de endereço e
sem abas, e ganha ícone no menu Iniciar / Launchpad / lançador do sistema.

O `http://localhost` conta como origem segura para o navegador, então a PWA
funciona sem HTTPS e sem certificado.

### Atualizar

```bash
git pull
npm install
```

Feche a janela do HUB SNK e abra de novo. Seus dados ficam fora da pasta do
projeto atualizado — nada do cadastro é tocado pelo `git pull`.

Se a versão nova mudar o formato dos arquivos de dados, a conversão acontece
sozinha na primeira abertura, guardando antes uma cópia do arquivo original. A
versão em uso aparece no rodapé da tela.

---

## Configuração

Todas as variáveis são opcionais.

| Variável            | Padrão            | O que faz                                                                                                                                       |
| ------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `HUB_PORTA`         | `4100`            | Porta do servidor                                                                                                                               |
| `HUB_HOST`          | `127.0.0.1`       | Interface de escuta. Endereço fora do loopback só é aceito junto com `HUB_PERMITIR_REDE=1` — leia [Exposição na rede](#exposição-na-rede) antes |
| `HUB_PERMITIR_REDE` | _(vazio)_         | `1` autoriza o `HUB_HOST` fora do loopback. Sem ela, o servidor recusa subir                                                                    |
| `HUB_DADOS_DIR`     | `./dados-hub-snk` | Onde o cadastro é gravado                                                                                                                       |

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

O HUB SNK escuta só em `127.0.0.1`, e a razão é o que ele faz: **não tem
autenticação**, devolve o cadastro inteiro — senhas em texto puro incluídas — a
quem pedir, e abre programas do seu computador (IntelliJ, DataGrip, terminal,
gerenciador de arquivos) a pedido de quem chama a API.

Escutar fora do loopback junta as três coisas: qualquer máquina que alcance a
porta lê as senhas de todos os clientes e manda a sua máquina executar
programas. Por isso um endereço de rede só sobe com a permissão dita de
propósito:

```bash
# Recusado — o servidor nem inicia
HUB_HOST=0.0.0.0 npm start

# Aceito, com o risco assumido
HUB_PERMITIR_REDE=1 HUB_HOST=0.0.0.0 npm start
```

No modo padrão, o HUB SNK ainda confere se cada requisição veio mesmo da própria
janela dele, e recusa o resto — inclusive um site aberto no seu navegador
tentando falar com o programa. Com `HUB_PERMITIR_REDE=1` essa conferência é
desligada, e o servidor avisa isso no terminal ao subir. Os detalhes estão em
[SECURITY.md](SECURITY.md).

---

## Onde ficam os dados

Tudo o que você cadastra fica na pasta `dados-hub-snk/`, ao lado do projeto — ou
onde o `HUB_DADOS_DIR` apontar. São três arquivos: o cadastro de clientes, a
configuração global e as bases e bancos da própria máquina.

A pasta está no `.gitignore`, então o cadastro nunca vai junto num commit. O
formato dos arquivos está em [docs/formato-dos-dados.md](docs/formato-dos-dados.md).

---

## Backup na nuvem

Para ter backup, sincronize a pasta `dados-hub-snk` com o serviço de nuvem que
você já usa — Google Drive, OneDrive, Dropbox. Basta adicioná-la à sincronização
do cliente instalado na máquina, ou apontar o `HUB_DADOS_DIR` para dentro da
pasta que já é sincronizada. Nada a configurar dentro do HUB SNK.

> Os arquivos sobem como estão no disco, e o cadastro guarda as senhas das bases
> e dos bancos em texto puro. Confira se a pasta não está compartilhada com
> ninguém.

Usando em mais de uma máquina, feche o HUB SNK de uma antes de abrir na outra:
a sincronização é de arquivo, e edição simultânea faz uma das versões se perder.
Alteração que chega de fora com o HUB SNK aberto é percebida sozinha — ele vigia
a pasta e relê o arquivo.

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

| Tipo     | Marcadores reconhecidos                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------- |
| Produção | `p`, `pd`, `pro`, `prd`, `prod`, `producao`, `produção`, `produtivo`, `production`                                        |
| Teste    | `t`, `ts`, `tes`, `tst`, `test`, `teste`, `testes`, `hom`, `hmg`, `hml`, `homol`, `homolog`, `homologacao`, `homologação` |

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

| Navegador       | Arquivo aceito                                                          | Onde obter                                                                                                             |
| --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Google Chrome   | `Bookmarks` / `AccountBookmarks` (JSON, sem extensão) ou HTML exportado | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\` ou **Favoritos > Gerenciador de favoritos > ⋮ > Exportar favoritos** |
| Microsoft Edge  | `Bookmarks` (JSON, sem extensão) ou HTML exportado                      | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\` ou **Favoritos > ⋯ > Exportar favoritos**                           |
| Opera           | `Bookmarks` (JSON, sem extensão) ou HTML exportado                      | `%APPDATA%\Opera Software\Opera Stable\Default\` ou **Favoritos > Exportar favoritos**                                 |
| Mozilla Firefox | HTML exportado ou backup `.json`                                        | **Favoritos > Gerenciar favoritos > Importar e fazer backup > Exportar favoritos para HTML**                           |
| Safari          | HTML exportado                                                          | **Arquivo > Exportar > Favoritos**                                                                                     |

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

Quando um repositório tem caminho local cadastrado, a linha dele ganha o botão
**Arquivos**, que abre a pasta no gerenciador de arquivos do sistema:

| Sistema             | Programa usado |
| ------------------- | -------------- |
| Windows             | `explorer.exe` |
| macOS               | `open`         |
| Linux e demais Unix | `xdg-open`     |

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

| Cor    | Situação                                                                          |
| ------ | --------------------------------------------------------------------------------- |
| Verde  | o arquivo existe e as cinco variáveis estão preenchidas                           |
| Neutro | o arquivo não existe, ou existe incompleto — o `title` do botão distingue os dois |

> Como o arquivo fica dentro do repositório, vale conferir se `.sankhya-mcp.env`
> está no `.gitignore` do projeto — ele contém a senha do banco.

## Abrir o terminal no repositório

O botão **Shell**, ao lado de _Arquivos_, abre o terminal do sistema já
posicionado na pasta do repositório. Se o **Script padrão** estiver preenchido
nas configurações (engrenagem no topo), ele é executado assim que o terminal
abre, e a janela continua aberta depois para você ler a saída.

| Sistema | Como abre                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------ |
| Windows | Windows Terminal quando existe; o shell é `pwsh.exe`, `powershell.exe` ou `cmd.exe`, o primeiro encontrado no PATH |
| macOS   | `Terminal.app`, via `osascript` quando há script a executar                                                        |
| Linux   | primeiro encontrado entre `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xfce4-terminal` e `xterm`           |

Se nenhum terminal for encontrado, o HUB SNK mostra o aviso na tela.

> O **Script padrão** é interpretado pelo shell — é essa a função do campo. Ele
> roda na sua máquina, com as suas permissões, na pasta do repositório. Vale o
> mesmo critério de digitar um comando direto no terminal: só coloque ali o que
> você mesmo executaria.

## Abrir o repositório no IntelliJ

O botão de chaves `{ }`, ao lado de _Shell_, abre a pasta do repositório como
projeto no IntelliJ IDEA.

| Sistema | Como abre                                                                                                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | primeiro encontrado no PATH entre `idea64.exe`, `idea.exe`, `idea.cmd` e `idea.bat`; os `.cmd`/`.bat` são executados via `cmd.exe /c` |
| macOS   | `open -n -a "IntelliJ IDEA"` (ou a edição _CE_), com `idea` como alternativa                                                          |
| Linux   | primeiro encontrado entre `intellij-idea-ultimate`, `intellij-idea-community`, `idea` e `idea.sh`                                     |

Se nenhum launcher for encontrado, o HUB SNK mostra o aviso. No Windows, a pasta
`bin` da IDE precisa estar no PATH — ou o launcher de linha de comando precisa
ter sido gerado pelo JetBrains Toolbox.

## Atalhos

O botão de raio, à direita do botão de tema, abre a lista dos atalhos
cadastrados logo abaixo dele; o clique em um deles inicia o programa na sua
máquina. A lista fica no ar até um clique em qualquer ponto fora dela — ou
`Esc` — fechá-la. O cadastro fica em **Configurações › Atalhos**, com _Nome_ e
_Caminho do executável_.

O botão de pasta ao lado do caminho abre o seletor de arquivos do sistema e
preenche o campo com o que for escolhido. O campo continua editável — dá para
colar um caminho ou ajustar o que veio do seletor.

| Sistema | Seletor                                                      |
| ------- | ------------------------------------------------------------ |
| Windows | `OpenFileDialog` do Windows Forms, via `powershell.exe -STA` |
| macOS   | `choose file`, via `osascript`                               |
| Linux   | `zenity --file-selection`, com `kdialog` como alternativa    |

No Linux, sem nenhum dos dois resta digitar o caminho.

Vale tanto para `.exe` quanto para `.lnk`, `.bat` e qualquer extensão associada.
A existência do arquivo é checada na hora de executar, não no cadastro, então dá
para cadastrar o caminho de um programa ainda não instalado; sem o arquivo, o
HUB SNK avisa na tela.

## Situação dos repositórios

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
| Verde    | Nada pendente: tudo commitado                                                     |
| Cinza    | Não foi possível verificar                                                        |

O que é verificado:

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
| Alterações guardadas no stash                                                              | Amarelo   |
| O repositório ainda não tem nenhum commit                                                  | Amarelo   |

O provedor (GitHub ou GitLab) é deduzido do host do remoto. GitLab instalado no
domínio da empresa (`gitlab.suaempresa.com.br`) é reconhecido pelo nome no host;
um domínio sem pista nenhuma fica como desconhecido, sem palpite.

O nome da branch atual aparece no selo apenas como informação: nada do
diagnóstico compara branches entre si nem mede distância para o remoto.

Nenhuma parte do diagnóstico usa a rede: todos os comandos são leituras do
disco. O `git` roda sem prompt de credencial, então nenhum repositório trava o
HUB SNK esperando senha.

O `title` do selo mostra a hora da última verificação, e o botão de recarregar
do cliente refaz o diagnóstico de todos os repositórios ignorando o cache de 30
segundos.

### Atualização automática

Em **Configurações**, o campo **Atualizar a situação Git automaticamente**
(ligado por padrão) refaz o diagnóstico local a cada minuto enquanto a aba
está em primeiro plano — mesma leitura do botão de recarregar, só que sem
precisar clicar. Para de rodar sozinho quando a aba perde o foco ou é
minimizada.

---

## Solução de problemas

| Sintoma                                                  | O que fazer                                                                                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `EADDRINUSE` ao iniciar                                  | A porta 4100 já está ocupada. Suba em outra: `HUB_PORTA=4200 npm start`                                                                  |
| Erro de sintaxe em arquivo `.ts` ao iniciar              | Node abaixo de 22.18. Confira com `node -v` e atualize                                                                                   |
| O navegador não oferece instalar o aplicativo            | Use Chrome ou Edge atualizados, pelo endereço `127.0.0.1` ou `localhost`. Firefox e Safari não instalam PWA em janela própria no desktop |
| A tela abre, mas a atualização que eu baixei não aparece | A janela instalada está servindo o cache antigo. Recarregue com `Ctrl`+`Shift`+`R`, ou abra no navegador comum                           |
| Os botões de Git não fazem nada                          | O `git` precisa estar no PATH. Confira com `git --version` num terminal novo                                                             |
| Mensagem sobre esquema mais novo ao iniciar              | O cadastro foi gravado por uma versão mais nova do HUB SNK. Atualize com `git pull`                                                      |
| `403` em tudo, ou a tela não carrega nada                | O endereço usado não é `127.0.0.1` nem `localhost`, ou a porta não bate com a do servidor                                                |

Se não estiver na lista, [abra uma issue](https://github.com/CarlosSimao/hub-snk/issues/new/choose).

---

## Versões

O número da versão diz o que esperar de uma atualização:

| Parte               | Sobe quando                                                                  | Exemplo                                           |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| **MAJOR** — `2`.0.0 | O formato dos arquivos de dados muda, ou a atualização exige alguma ação sua | Uma variável de ambiente passa a ser obrigatória  |
| **MINOR** — 1.`3`.0 | Entra funcionalidade nova e o cadastro continua compatível                   | Um tipo de atalho novo                            |
| **PATCH** — 1.2.`4` | Correção de comportamento, sem nada novo                                     | A situação do Git deixa de errar o nome da branch |

Toda mudança visível fica registrada no [CHANGELOG](CHANGELOG.md).

---

## Suporte

A versão que você está rodando aparece no rodapé da tela — cite-a ao relatar
qualquer coisa.

| Para                                                      | Onde                                                                        |
| --------------------------------------------------------- | --------------------------------------------------------------------------- |
| Erro, comportamento estranho, algo que parou de funcionar | [Abrir uma issue](https://github.com/CarlosSimao/hub-snk/issues/new/choose) |
| Ideia, pedido de melhoria, dúvida de uso                  | [Discussions](https://github.com/CarlosSimao/hub-snk/discussions)           |
| Falha de segurança                                        | Não abra issue pública — veja o [SECURITY.md](SECURITY.md)                  |

**Antes de colar qualquer coisa numa issue:** o repositório é público. Não
publique o conteúdo do cadastro, nem trechos de log com nome de cliente, host,
usuário ou senha. Troque por `<cliente>` e `<host>` — o que importa para o
diagnóstico é a forma da mensagem, não os valores reais.

---

## Documentação técnica

Nada disto é necessário para usar o HUB SNK.

- [Como contribuir](CONTRIBUTING.md) — rodar em modo de desenvolvimento, padrões do código, publicar uma versão
- [Distribuição](docs/distribuicao.md) — como o instalador e os pacotes são montados
- [API HTTP](docs/api.md) — as rotas e os corpos aceitos
- [Formato dos arquivos de dados](docs/formato-dos-dados.md) — o envelope, o esquema e a migração
- [Estrutura do código](docs/estrutura-do-codigo.md) — mapa dos arquivos
- [Segurança](SECURITY.md) — o modelo de ameaça e como reportar uma falha

---

## Licença

[MIT](LICENSE) — use, altere e distribua à vontade, sem garantia nenhuma.

## Autor

Feito por [Carlos Nascimento](https://github.com/CarlosSimao).
