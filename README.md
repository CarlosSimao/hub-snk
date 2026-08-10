# HUB SNK

[![Versão](https://img.shields.io/github/v/release/CarlosSimao/hub-snk?label=vers%C3%A3o)](https://github.com/CarlosSimao/hub-snk/releases)
[![Licença](https://img.shields.io/github/license/CarlosSimao/hub-snk)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.18-brightgreen)](https://nodejs.org)

Hub local de cadastro de clientes, das bases e dos repositórios Git de cada
um. Roda na sua máquina, sem Docker, sem banco de dados e sem autenticação, e
pode ser instalado como PWA para abrir em janela própria — como um aplicativo de
desktop.

Funciona em Windows, Linux e macOS.

![Tela do HUB SNK com a lista de clientes cadastrados](docs/img/screenshot.png)

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
[Backup na nuvem](docs/funcionalidades.md#backup-na-nuvem).

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
desligada, e o servidor avisa isso no terminal ao subir. Como a conferência
funciona está em [docs/api.md](docs/api.md#conferência-de-origem).

---

## Onde ficam os dados

Tudo o que você cadastra fica na pasta `dados-hub-snk/`, ao lado do projeto — ou
onde o `HUB_DADOS_DIR` apontar. São três arquivos: o cadastro de clientes, a
configuração global e as bases e bancos da própria máquina.

A pasta está no `.gitignore`, então o cadastro nunca vai junto num commit. O
formato dos arquivos está em [docs/formato-dos-dados.md](docs/formato-dos-dados.md).

---

## Funcionalidades

| O quê                       | Resumo                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Cadastro de clientes**    | Bases do ERP com usuário, senha e banco vinculado, repositórios Git, links avulsos e anotações livres                           |
| **Importação de favoritos** | Transforma favoritos do Chrome, Edge, Opera, Firefox ou Safari em bases, deduzindo Produção ou Teste do nome                    |
| **Botões do repositório**   | Abrem a pasta, o terminal (rodando o script padrão) e o IntelliJ; e editam o `.sankhya-mcp.env` do MCP Claude                   |
| **Atalhos**                 | Lista de programas da sua máquina, iniciados com um clique pelo botão de raio                                                   |
| **Diagnóstico Git**         | Selo por repositório com a branch e a pendência mais grave — commit faltando, conflito, segredo rastreado —, atualizado sozinho |
| **Backup na nuvem**         | Não é embutido: aponte a pasta de dados para o Drive, o OneDrive ou o Dropbox que você já usa                                   |

Cada uma em detalhe, com as regras e o que muda em cada sistema operacional, em
[docs/funcionalidades.md](docs/funcionalidades.md).

> Os arquivos da pasta de dados sobem para a nuvem **como estão no disco**, e o
> cadastro guarda as senhas das bases e dos bancos em texto puro. Confira se a
> pasta não está compartilhada com ninguém.

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

Se não estiver na lista, [abra uma issue](https://github.com/CarlosSimao/hub-snk/issues/new/choose)
— citando a versão que aparece no rodapé da tela, e sem colar senha, host,
usuário ou nome de cliente: o repositório é público.

---

## Documentação técnica

Nada disto é necessário para usar o HUB SNK.

- [Funcionalidades em detalhe](docs/funcionalidades.md) — cada recurso, com as regras e o que muda em cada sistema
- [API HTTP](docs/api.md) — as rotas, os corpos aceitos e a conferência de origem
- [Formato dos arquivos de dados](docs/formato-dos-dados.md) — o envelope, o esquema e a migração
- [Distribuição](docs/distribuicao.md) — como o instalador e os pacotes são montados
- [Estrutura do código](docs/estrutura-do-codigo.md) — mapa dos arquivos
- [Manutenção](docs/manutencao.md) — modo de desenvolvimento, padrões do código, regra de versão e publicação
- [CHANGELOG](CHANGELOG.md) — o que mudou em cada versão

---

## Licença

[MIT](LICENSE) — use, altere e distribua à vontade, sem garantia nenhuma.

## Autor

Feito por [Carlos Nascimento](https://github.com/CarlosSimao).
