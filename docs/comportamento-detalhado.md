# Comportamento detalhado

O que cada recurso faz por baixo: qual programa é chamado em cada sistema, que
formato de arquivo é aceito, que regra decide o quê. Para usar o HUB SNK, o
[README](../README.md) basta — nada aqui é necessário no dia a dia.

## Importação de favoritos

### Navegadores suportados

| Navegador       | Arquivo aceito                                                          | Onde obter                                                                                                             |
| --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Google Chrome   | `Bookmarks` / `AccountBookmarks` (JSON, sem extensão) ou HTML exportado | `%LOCALAPPDATA%\Google\Chrome\User Data\Default\` ou **Favoritos > Gerenciador de favoritos > ⋮ > Exportar favoritos** |
| Microsoft Edge  | `Bookmarks` (JSON, sem extensão) ou HTML exportado                      | `%LOCALAPPDATA%\Microsoft\Edge\User Data\Default\` ou **Favoritos > ⋯ > Exportar favoritos**                           |
| Opera           | `Bookmarks` (JSON, sem extensão) ou HTML exportado                      | `%APPDATA%\Opera Software\Opera Stable\Default\` ou **Favoritos > Exportar favoritos**                                 |
| Mozilla Firefox | HTML exportado ou backup `.json`                                        | **Favoritos > Gerenciar favoritos > Importar e fazer backup > Exportar favoritos para HTML**                           |
| Safari          | HTML exportado                                                          | **Arquivo > Exportar > Favoritos**                                                                                     |

Qualquer outro navegador está fora do escopo: o arquivo é recusado com aviso na
própria tela. O formato é reconhecido pelo conteúdo — o assistente não pergunta
qual é o navegador.

- O backup padrão do Firefox (`bookmarks-*.jsonlz4`) é compactado e **não** é
  aceito — o assistente avisa e indica a exportação em HTML.
- O Safari não guarda os favoritos em formato aberto (`Bookmarks.plist` é
  binário e só existe no macOS); o caminho é sempre a exportação em HTML.
- Favoritos que não sejam `http` ou `https` (`javascript:`, `place:`, `chrome://`)
  aparecem na árvore desmarcáveis: o HUB SNK só abre endereços navegáveis.
- O arquivo é lido no próprio navegador; nada dele é enviado ao servidor além
  das bases confirmadas na última etapa.

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
Sem marcador, o tipo fica em branco e o usuário escolhe na última etapa.

Homologação é tratada como Teste: o HUB SNK só tem os tipos Produção, Teste e
Outro.

## Que programa cada botão chama

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

Os atalhos valem tanto para `.exe` quanto para `.lnk`, `.bat` e qualquer
extensão associada. A existência do arquivo é checada na hora de executar, não
no cadastro — dá para cadastrar o caminho de um programa ainda não instalado.

## Arquivo `.sankhya-mcp.env`

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

A cor do botão mostra a situação sem abrir o formulário: **verde** quando o
arquivo existe com as cinco variáveis preenchidas, **neutro** quando não existe
ou está incompleto — o `title` do botão distingue os dois casos.

## Diagnóstico dos repositórios Git

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
| Alterações guardadas no stash                                                              | Amarelo   |
| O repositório ainda não tem nenhum commit                                                  | Amarelo   |

O provedor (GitHub ou GitLab) é deduzido do host do remoto. GitLab instalado no
domínio da empresa (`gitlab.suaempresa.com.br`) é reconhecido pelo nome no host;
um domínio sem pista nenhuma fica como desconhecido, sem palpite.

O nome da branch atual aparece no selo apenas como informação: nada do
diagnóstico compara branches entre si nem mede distância para o remoto.

Nenhuma parte do diagnóstico usa a rede: todos os comandos são leituras do
disco. O `git` roda sem prompt de credencial, então nenhum repositório trava o
HUB SNK esperando senha. O resultado fica em cache por 30 segundos; o botão de
recarregar do cliente ignora o cache.
