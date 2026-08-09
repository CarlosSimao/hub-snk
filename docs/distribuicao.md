# Distribuição

Como os artefatos de cada release são montados e por que as decisões foram
estas. Para apenas instalar o HUB SNK, veja o [README](../README.md).

| Artefato | Plataforma |
|---|---|
| `hub-snk-<versão>-windows-x64.exe` | Windows — instalador com wizard |
| `hub-snk-<versão>-linux-x64.tar.gz` | Linux |
| `hub-snk-<versão>-macos-x64.tar.gz` | macOS com processador Intel |
| `hub-snk-<versão>-macos-arm64.tar.gz` | macOS com Apple Silicon |

Todos levam o próprio Node e as dependências instaladas: a máquina de destino
não precisa de Node, de npm nem de rede.

## Como gerar

Tudo é montado pelo GitHub Actions a cada tag `v*` e anexado à release — veja
`.github/workflows/distribuicao.yml`. Não é preciso gerar nada à mão para
publicar.

O instalador do Windows é compilado no runner Windows; os pacotes Unix, no
runner Linux, porque o `tar` precisa preservar o bit de execução do binário do
Node. Empacotar no Windows entrega um pacote que não roda do outro lado.

Para conferir localmente:

```bash
npm run gerar-icones        # gera instalador/hub-snk.ico
npm run empacotar-windows   # monta dist/windows e dist/versao.iss
npm run empacotar-unix      # gera os três .tar.gz em dist/
```

O instalador em si precisa do [Inno Setup 6](https://jrsoftware.org/isdl.php)
(`winget install JRSoftware.InnoSetup`):

```powershell
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" instalador\hub-snk.iss
```

O `.exe` sai em `dist/`.

---

# Instalador do Windows

## O que vai dentro

`npm run empacotar-windows` monta `dist/windows` com:

| Item | De onde vem |
|---|---|
| `node.exe` | Baixado de `nodejs.org/dist`, na versão fixada no script. Fica em cache em `dist/cache` para não rebaixar a cada empacotamento |
| `node_modules` | `npm ci --omit=dev` numa pasta separada, para não mexer no `node_modules` de desenvolvimento |
| `src`, `public`, `package.json` | Do repositório, sem os arquivos `.test.ts` |
| `abrir-hub-snk.vbs` | De `instalador/` |
| `LICENSE.txt` | O `LICENSE` do projeto, renomeado para o instalador exibir |

São ~106 MB descompactados, a maior parte do `node.exe`. O instalador comprime
isso com LZMA2.

**Por que embutir o Node:** sem ele, cada colega precisaria instalar o Node.js,
acertar a versão mínima e rodar `npm install` com rede. O custo é o tamanho do
instalador; o ganho é "baixou, instalou, usou".

## O que é instalado

Instalação **por usuário**, sem UAC (`PrivilegesRequired=lowest`). O programa
vai para a pasta de aplicativos do usuário; nada é escrito em `Program Files`
nem no registro da máquina.

| Caminho | Conteúdo |
|---|---|
| `%LOCALAPPDATA%\Programs\HubSnk` | O programa: `node.exe`, `src`, `public`, `node_modules` |
| `%LOCALAPPDATA%\HubSnk\dados` | O cadastro. **Não** é removido na desinstalação |
| `%LOCALAPPDATA%\HubSnk\hub-snk.log` | Saída do servidor |

## Por que não é um serviço do Windows

Um serviço roda na **sessão 0**, isolada da área de trabalho do usuário. O HUB
SNK abre o Explorer, o terminal, o IntelliJ, os atalhos cadastrados e os
diálogos de seleção de arquivo (`OpenFileDialog` via `powershell -STA`). Nada
disso apareceria na tela: os diálogos ficariam invisíveis, esperando um clique
que ninguém poderia dar.

O equivalente que funciona é o atalho em `{userstartup}`, que sobe o servidor no
logon, oculto, dentro da sessão do usuário — mesmo efeito prático, sem quebrar
metade do produto. É a opção "Iniciar o HUB SNK junto com o Windows" do
instalador.

## Os dois modos do launcher

`abrir-hub-snk.vbs` é o mesmo arquivo nos dois casos, separados por argumento:

| Chamada | Usada por | O que faz |
|---|---|---|
| `abrir-hub-snk.vbs` | Atalho do menu e da área de trabalho | Sobe o servidor se não estiver no ar, espera a porta responder e abre a janela do aplicativo |
| `abrir-hub-snk.vbs /servidor` | Atalho da pasta Inicializar | Só sobe o servidor, sem abrir janela |

Rodar o launcher com o servidor já no ar não sobe um segundo: ele confere a
porta antes.

A janela é aberta com `--app=http://127.0.0.1:4100` no Edge ou no Chrome, o que
dá a janela sem barra de endereço e sem abas sem depender de o usuário ter
instalado a PWA pelo botão do navegador. Sem nenhum dos dois, abre no navegador
padrão, em aba comum.

## Desinstalação

O desinstalador roda `encerrar-hub-snk.vbs` antes de apagar os arquivos — o
`node.exe` em uso travaria a remoção. Esse script encerra **apenas** processos
cujo executável é o `node.exe` da própria instalação: outro Node rodando na
máquina, de um projeto seu, não é tocado.

Ao final, um aviso lembra onde o cadastro ficou, para quem quiser apagá-lo à
mão.

## Assinatura digital

O instalador não é assinado. O SmartScreen do Windows vai mostrar "Windows
protegeu o computador" na primeira execução — é preciso clicar em *Mais
informações* › *Executar assim mesmo*.

Assinar exigiria um certificado de code signing pago, com renovação anual.
Enquanto não houver, vale avisar os colegas de que o aviso é esperado.

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
`LICENSE` e o `hub-snk.sh`.

As dependências são as mesmas nas três plataformas — todas JavaScript puro, sem
binário compilado —, então o `npm ci` roda uma vez e o resultado é reaproveitado.

## O launcher

```bash
./hub-snk.sh            # sobe o servidor e abre a janela
./hub-snk.sh servidor   # sobe o servidor sem abrir nada
./hub-snk.sh parar      # encerra o servidor deste pacote
```

Os dados ficam em `$XDG_DATA_HOME/hub-snk/dados` — na prática
`~/.local/share/hub-snk/dados` —, fora da pasta do pacote. Atualizar é apagar a
pasta do pacote e descompactar a nova; o cadastro fica onde está.

O `parar` encerra apenas os processos iniciados a partir do binário daquele
pacote, encontrados por `pgrep` no caminho completo. Outro Node rodando na
máquina não é tocado.

Não há início automático no logon: cada ambiente de desktop tem o seu jeito
(systemd user, LaunchAgents, autostart do XDG) e nenhum deles cabe num pacote
que é só descompactar. Quem quiser pode apontar o mecanismo do próprio sistema
para `hub-snk.sh servidor`.

## Tamanho

Cerca de 40 MB compactados por pacote, quase tudo binário do Node. Os fontes de
teste que algumas dependências publicam (`zod`, sobretudo) entram junto: filtrar
pastas de teste dentro do `node_modules` economizaria poucos megabytes e
arriscaria remover um arquivo de que o pacote depende em tempo de execução.
