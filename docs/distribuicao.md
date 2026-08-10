# Distribuição

Como os artefatos de cada release são montados e por que as decisões foram
estas. Para apenas instalar o HUB SNK, veja o [README](../README.md).

| Artefato                              | Plataforma                  |
| ------------------------------------- | --------------------------- |
| `hub-snk-<versão>-windows-x64.zip`    | Windows                     |
| `hub-snk-<versão>-linux-x64.tar.gz`   | Linux                       |
| `hub-snk-<versão>-macos-x64.tar.gz`   | macOS com processador Intel |
| `hub-snk-<versão>-macos-arm64.tar.gz` | macOS com Apple Silicon     |

Todos levam o próprio Node, as dependências instaladas e os scripts de
instalação e remoção: a máquina de destino não precisa de Node, de npm nem de
rede.

## O bloqueio do Windows, e o que passa por ele

O Controle Inteligente de Aplicativos do Windows 11 barra o que não é assinado
**e** carrega a marca de arquivo baixado da internet — o Mark-of-the-Web, que o
Explorer põe em cada arquivo saído de um zip baixado. Isso derrubou duas
tentativas em sequência: o `hub-snk-<versão>-windows-x64.exe` do Inno Setup e,
depois dele, o `instalar-hub-snk.bat`.

O que passa é o `node.exe` do próprio pacote, assinado pela OpenJS Foundation.
Por isso o caminho principal no Windows não usa script nenhum:

```powershell
.\node.exe src\index.ts
```

O servidor sobe e abre a janela sozinho — veja
[A janela aberta pelo servidor](#a-janela-aberta-pelo-servidor).

Os scripts de instalação continuam no pacote, para quem quer atalho e início no
logon. Eles voltam a funcionar assim que a marca sai: botão direito no `.zip` →
_Propriedades_ → _Desbloquear_, **antes** de descompactar.

Assinar resolveria tudo de uma vez, e exige certificado de code signing pago com
renovação anual.

## A janela aberta pelo servidor

Quem sobe o `node` direto do pacote não tem launcher para abrir a tela, e pedir
que digite o endereço no navegador é um passo a mais em cima de um programa que
já sabe qual é. Então o próprio servidor abre a janela ao terminar de subir, com
o `--app` do Chromium — a mesma janela sem barra de endereço e sem abas que o
launcher dá.

A detecção de navegador é a de sempre, agora em
`src/sistema/abrirJanelaDoAplicativo.ts`: o `HUB_NAVEGADOR` escolhe, e sem
Chromium na máquina cai no navegador padrão, em aba comum.

Os launchers sobem o servidor com `HUB_ABRIR_JANELA=0`, senão o usuário veria
duas janelas — e o `hub-snk.sh servidor`, que existe para não abrir nada,
deixaria de ser silencioso. O modo `--watch` do desenvolvimento se desliga
sozinho, sem variável nenhuma: ali o processo reinicia a cada arquivo salvo, e
uma janela por salvamento inviabilizaria o modo.

## Como gerar

Tudo é montado pelo GitHub Actions a cada tag `v*` e anexado à release — veja
`.github/workflows/distribuicao.yml`. Não é preciso gerar nada à mão para
publicar.

O zip do Windows é montado no runner Windows, porque quem grava zip ali é o
bsdtar do próprio sistema; os pacotes Unix, no runner Linux, porque o `tar`
precisa preservar o bit de execução do binário do Node. Empacotar no Windows
entrega um pacote Unix que não roda do outro lado.

Para conferir localmente:

```bash
npm run gerar-icones        # gera instalador/hub-snk.ico
npm run empacotar-windows   # gera dist/hub-snk-<versão>-windows-x64.zip
npm run empacotar-unix      # gera os três .tar.gz em dist/
```

---

# Pacote do Windows

## O que vai dentro

| Item                                 | De onde vem                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `node.exe`                           | Baixado de `nodejs.org/dist`, na versão fixada no script. Fica em cache em `dist/cache` para não rebaixar a cada empacotamento |
| `node_modules`                       | `npm ci --omit=dev` numa pasta separada, para não mexer no `node_modules` de desenvolvimento                                   |
| `src`, `public`, `package.json`      | Do repositório, sem os arquivos `.test.ts`                                                                                     |
| Os `.vbs`, `.bat`, `.ps1` e o `.ico` | De `instalador/`                                                                                                               |
| `LICENSE.txt` e `README.md`          | Do repositório, o `LICENSE` renomeado para abrir com duplo clique no Windows                                                   |

São ~106 MB descompactados e ~37 MB no zip, a maior parte do `node.exe`.

**Por que embutir o Node:** sem ele, cada colega precisaria instalar o Node.js,
acertar a versão mínima e rodar `npm install` com rede. O custo é o tamanho do
pacote; o ganho é "baixou, descompactou, usou".

**Por que zip e não tar.gz:** no Windows o zip abre com duplo clique no próprio
Explorer. O bit de execução, que obriga os pacotes Unix a usarem tar, não existe
aqui. O empacotador chama o `tar.exe` do System32 pelo caminho completo e
confere a assinatura `PK` do arquivo gerado: o `tar` do PATH pode ser o GNU tar
do Git Bash, que aceita o `-a`, ignora a extensão e entrega um tar puro com nome
de zip.

## O que é instalado

Instalação **por usuário**, sem UAC. O programa vai para a pasta de aplicativos
do usuário; nada é escrito em `Program Files` nem no registro da máquina.

| Caminho                             | Conteúdo                                                |
| ----------------------------------- | ------------------------------------------------------- |
| `%LOCALAPPDATA%\Programs\HubSnk`    | O programa: `node.exe`, `src`, `public`, `node_modules` |
| `%LOCALAPPDATA%\HubSnk\dados`       | O cadastro. **Não** é removido na desinstalação         |
| `%LOCALAPPDATA%\HubSnk\hub-snk.env` | As respostas dadas na instalação                        |
| `%LOCALAPPDATA%\HubSnk\hub-snk.log` | Saída do servidor                                       |

Os atalhos ficam no menu Iniciar, na área de trabalho e na pasta Inicializar,
conforme as respostas — cada um apontando para o `wscript.exe` com o
`abrir-hub-snk.vbs` como argumento, que é o que evita a janela de console.

## O arquivo de configuração

O instalador não guarda as escolhas no registro nem dentro do programa: elas vão
para o `hub-snk.env`, no formato `CHAVE=valor`, ao lado do cadastro. O launcher
lê o arquivo a cada abertura e leva cada valor para o ambiente do servidor.

```
HUB_PORTA=4100
HUB_HOST=127.0.0.1
HUB_PERMITIR_REDE=0
HUB_DADOS_DIR=C:\Users\voce\AppData\Local\HubSnk\dados
HUB_NAVEGADOR=edge
```

Variável de ambiente com o mesmo nome vence o arquivo: dá para testar outra
porta ou outro navegador sem reinstalar. Reinstalar, por sua vez, lê o arquivo e
usa cada valor como padrão das perguntas — Enter em tudo repete a instalação
anterior.

`HUB_HOST` fora do loopback é o único que não passa direto: o script mostra o
que a exposição significa (API sem autenticação, senhas do cadastro, abertura de
programas da máquina) e só grava com o `HUB_PERMITIR_REDE=1` confirmado na hora.
É a mesma regra que o servidor aplica em `src/configuracao.ts`.

## Por que não é um serviço do Windows

Um serviço roda na **sessão 0**, isolada da área de trabalho do usuário. O HUB
SNK abre o Explorer, o terminal, o IntelliJ, os atalhos cadastrados e os
diálogos de seleção de arquivo (`OpenFileDialog` via `powershell -STA`). Nada
disso apareceria na tela: os diálogos ficariam invisíveis, esperando um clique
que ninguém poderia dar.

O equivalente que funciona é o atalho na pasta Inicializar, que sobe o servidor
no logon, oculto, dentro da sessão do usuário — mesmo efeito prático, sem
quebrar metade do produto. É a opção "Iniciar o HUB SNK junto com o Windows" da
instalação.

## Os dois modos do launcher

`abrir-hub-snk.vbs` é o mesmo arquivo nos dois casos, separados por argumento:

| Chamada                       | Usada por                            | O que faz                                                                                    |
| ----------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| `abrir-hub-snk.vbs`           | Atalho do menu e da área de trabalho | Sobe o servidor se não estiver no ar, espera a porta responder e abre a janela do aplicativo |
| `abrir-hub-snk.vbs /servidor` | Atalho da pasta Inicializar          | Só sobe o servidor, sem abrir janela                                                         |

Rodar o launcher com o servidor já no ar não sobe um segundo: ele confere a
porta antes.

A janela é aberta com `--app=http://<host>:<porta>` no Edge ou no Chrome, o que
dá a janela sem barra de endereço e sem abas sem depender de o usuário ter
instalado a PWA pelo botão do navegador. Sem nenhum dos dois, abre no navegador
padrão, em aba comum.

## Por que os `.bat` ao lado dos `.ps1`

Duplo clique num `.ps1` abre o Bloco de Notas, não executa. E a política de
execução padrão do Windows recusa script sem assinatura vindo da internet. Os
dois `.bat` resolvem os dois problemas de uma vez: chamam o PowerShell com
`-ExecutionPolicy Bypass`, que vale só para aquela chamada e não altera a
configuração da máquina. Eles preferem o `pwsh.exe` e caem para o
`powershell.exe` quando o PowerShell 7 não está instalado.

## Desinstalação

O `desinstalar-hub-snk.bat` roda `encerrar-hub-snk.vbs` antes de apagar os
arquivos — o `node.exe` em uso travaria a remoção. Esse script encerra **apenas**
processos cujo executável é o `node.exe` da própria instalação: outro Node
rodando na máquina, de um projeto seu, não é tocado.

Saem os atalhos, o programa, o log e o `hub-snk.env`. O cadastro fica, e um
aviso lembra onde ele está para quem quiser apagá-lo à mão.

---

# Pacotes do Linux e do macOS

## Por que `.tar.gz` e não `.zip`

O zip não guarda o bit de execução de forma confiável entre ferramentas. O
binário do Node chegaria sem permissão de execução, e o pacote não rodaria sem
um `chmod` que ninguém adivinha. O `tar.gz` preserva o modo dos arquivos, e é o
formato que Linux e macOS esperam.

Ainda assim, o `hub-snk.sh` restaura o bit de execução do Node se ele tiver se
perdido: descompactadores gráficos às vezes o descartam, e explicar o erro
depois custa mais que a linha de código.

## O que vai dentro

Cada pacote traz `node` (o binário da plataforma, extraído do tarball oficial),
`node_modules` de produção, `src`, `public`, `package.json`, o `README.md`, o
`LICENSE`, o `hub-snk.sh` e os dois scripts de instalação.

As dependências são as mesmas nas três plataformas — todas JavaScript puro, sem
binário compilado —, então o `npm ci` roda uma vez e o resultado é reaproveitado.

## O launcher

```bash
./hub-snk.sh            # sobe o servidor e abre a janela
./hub-snk.sh servidor   # sobe o servidor sem abrir nada
./hub-snk.sh parar      # encerra o servidor deste pacote
```

Os dados ficam em `$XDG_DATA_HOME/hub-snk/dados` — na prática
`~/.local/share/hub-snk/dados` —, fora da pasta do programa. Atualizar é
descompactar a versão nova e rodar o `instalar-hub-snk.sh` de novo; o cadastro
fica onde está.

O `parar` encerra apenas os processos iniciados a partir do binário daquele
pacote, encontrados por `pgrep` no caminho completo. Outro Node rodando na
máquina não é tocado.

O launcher funciona de dentro do pacote, sem instalar nada — é o caminho para
quem só quer experimentar.

## A instalação

`./instalar-hub-snk.sh` pergunta os mesmos cinco parâmetros da versão Windows,
grava as respostas em `$XDG_CONFIG_HOME/hub-snk/hub-snk.env` — na prática
`~/.config/hub-snk/hub-snk.env` — e copia o programa para
`~/.local/share/hub-snk/programa`.

O atalho é um `.desktop` em `~/.local/share/applications`, e o início junto com
a sessão é o mesmo arquivo em `~/.config/autostart`, chamando
`hub-snk.sh servidor`. É o mecanismo do XDG, respeitado por GNOME, KDE e pelos
ambientes leves; systemd user e LaunchAgents resolveriam o mesmo problema com
uma unidade a mais para manter em cada sistema.

`./desinstalar-hub-snk.sh`, rodado de dentro da pasta instalada, encerra o
servidor, remove os dois `.desktop`, o `hub-snk.env`, o log e o programa. O
cadastro fica, e o caminho dele aparece no fim.

## Tamanho

Cerca de 40 MB compactados por pacote, quase tudo binário do Node. Os fontes de
teste que algumas dependências publicam (`zod`, sobretudo) entram junto: filtrar
pastas de teste dentro do `node_modules` economizaria poucos megabytes e
arriscaria remover um arquivo de que o pacote depende em tempo de execução.
