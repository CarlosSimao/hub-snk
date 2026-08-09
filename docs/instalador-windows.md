# Instalador do Windows

Como o `.exe` é montado, o que ele instala e por que as decisões foram estas.
Para apenas instalar o HUB SNK, veja o [README](../README.md#instalação-no-windows).

## Como gerar

O instalador é compilado pelo GitHub Actions a cada tag `v*` e anexado à release
correspondente — veja `.github/workflows/instalador-windows.yml`. Não é preciso
gerar nada à mão para publicar.

Para conferir localmente, é preciso ter o
[Inno Setup 6](https://jrsoftware.org/isdl.php) instalado
(`winget install JRSoftware.InnoSetup`):

```bash
npm run gerar-icones        # gera instalador/hub-snk.ico
npm run empacotar-windows   # monta dist/windows e dist/versao.iss
```

```powershell
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" instalador\hub-snk.iss
```

O `.exe` sai em `dist/`.

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
