# Correções multiplataforma — Linux e macOS

Lista de pendências levantadas na auditoria de compatibilidade com Linux e
macOS. Marque cada item conforme for corrigindo.

O que foi testado de fato: ciclo completo em Linux (Ubuntu sobre WSL2, Node
22.22.1) — empacotamento, execução a partir do pacote, instalação, uso e
desinstalação. O macOS não foi executado; os itens marcados como _revisão de
código_ vêm da leitura do fonte, não de execução.

---

## O que já funciona no Linux

Verificado em execução, não precisa de ação:

- `npm run empacotar-unix` gera os três `.tar.gz` e os `.sh` saem com permissão
  de execução (`-rwxr-xr-x`).
- `./hub-snk.sh servidor` sobe o servidor; `/api/sistema/versao` responde 200.
- `./instalar-hub-snk.sh` grava o `hub-snk.env`, cria o `.desktop` e copia o
  programa para o destino escolhido.
- `./hub-snk.sh parar` encerra o processo daquele pacote.
- `./desinstalar-hub-snk.sh` recusa rodar de dentro do pacote baixado, remove a
  instalação e preserva o cadastro.
- Seletor de pasta e de arquivo via `zenity`: devolve o caminho escolhido e
  `null` no cancelamento.
- Atalho apontando para arquivo com bit de execução: o programa é de fato
  executado.
- Atalho apontando para arquivo sem bit de execução: delegado ao `xdg-open`,
  como projetado.
- Ausência de `zenity`, `kdialog`, terminal ou IntelliJ produz os erros de
  domínio corretos, que viram 503 na API.
- Finais de linha: o `*.sh text eol=lf` do `.gitattributes` está correto — os
  scripts rodaram sem o problema de shebang com `\r`.

---

## Prioridade 1

### [x] 1. Falha silenciosa: a rota devolve sucesso e nada abriu

**Onde:** `src/sistema/abrirPasta.ts:28`, `src/sistema/abrirExecutavel.ts:99`,
`src/sistema/abrirJanelaDoAplicativo.ts:49`, `src/sistema/abrirShell.ts:130`,
`src/sistema/lancadorJetBrains.ts:63`

São dois padrões distintos, ambos confirmados em execução.

**a) Disparo sem espera.** `abrirPasta`, `abrirExecutavel` e
`abrirJanelaDoAplicativo` fazem `spawn` e seguem em frente; a falha só chega ao
`console.error`. Sem `xdg-open` na máquina, a rota responde 204 e a tela informa
que abriu:

```
RESOLVEU SEM ERRO (rota devolveria 204)
Falha ao executar "xdg-open" para abrir /tmp: Error: spawn xdg-open ENOENT
```

**b) Sucesso declarado no evento `spawn`.** `abrirShell.lancar` e
`lancadorJetBrains.lancar` resolvem quando o processo nasce, não quando ele
termina bem. Um candidato que existe mas falha logo em seguida encerra a lista, e
o próximo — que funcionaria — nunca é tentado. Reproduzido com um
`x-terminal-emulator` que sai com código 1:

```
abrirShell RESOLVEU (rota devolve 204)
x-terminal-emulator recebeu: --working-directory=/tmp -e bash -c git status; exec "$SHELL"
```

O `gnome-terminal`, disponível, não chegou a ser chamado. O caso não é
hipotético: em Debian e Ubuntu o `x-terminal-emulator` frequentemente aponta para
o `xterm`, que não aceita `--working-directory`.

**Correção sugerida:** aguardar o evento `close` por uma janela curta (na ordem
de 400 ms) antes de considerar o lançamento bem-sucedido. Código de saída
diferente de zero dentro desse prazo conta como falha — o que faz a lista de
candidatos continuar sendo percorrida e permite a rota responder 503 em vez de 204.

**Como conferir:** colocar no `PATH` um executável de nome `x-terminal-emulator`
que apenas saia com código 1 e confirmar que o `gnome-terminal` seguinte é
chamado.

**Corrigido.** Novo `src/sistema/lancarProcesso.ts`: espera 400 ms e trata como
falha o processo que morre com código diferente de zero nesse intervalo. Usado
por `abrirPasta`, `abrirExecutavel`, `abrirShell`, `lancadorJetBrains` e
`abrirJanelaDoAplicativo`. O `explorer.exe` fica de fora da conferência de código
porque sai com 1 mesmo quando abre a pasta. As rotas ganharam `503`. Verificado
no Linux — sem `xdg-open` o botão passa a responder erro, e o
`x-terminal-emulator` que sai com 1 agora cede a vez ao `gnome-terminal` — e no
Windows, onde o `explorer.exe` continua abrindo normalmente.

### [x] 2. macOS: atalho e início na sessão não existem

**Onde:** `instalador/instalar-hub-snk.sh:30-31,341-353`,
`instalador/desinstalar-hub-snk.sh:15-16`

O instalador grava `~/.local/share/applications/hub-snk.desktop` e
`~/.config/autostart/hub-snk.desktop`. Os dois caminhos são do XDG e o macOS os
ignora por completo. O script pergunta pelas duas coisas — o atalho com padrão
_Sim_ —, escreve os arquivos e imprime "HUB SNK instalado". No Mac o usuário fica
sem atalho e sem início automático, sem nenhum aviso.

O `docs/distribuicao.md:261` já registra que LaunchAgents seriam o mecanismo
equivalente. O README descreve o atalho do macOS como indo "para o menu de
aplicativos", o que não acontece.

**Correção sugerida:** detectar `uname -s` igual a `Darwin`. O mínimo aceitável é
pular as duas perguntas e avisar que não há atalho nessa plataforma. O correto é
gerar um `.app` mínimo em `/Applications` e um
`~/Library/LaunchAgents/com.hubsnk.plist` para o início na sessão — com a
desinstalação removendo os dois.

**Também:** corrigir README e `docs/distribuicao.md` para descrever o que cada
sistema realmente recebe.

**Corrigido.** O instalador decide pelo `uname -s`: no macOS grava
`~/Applications/HUB SNK.app` (Info.plist mais um executável de uma linha que
chama `hub-snk.sh abrir`) e o LaunchAgent
`~/Library/LaunchAgents/com.hubsnk.servidor.plist`, carregado na hora com
`launchctl`. O desinstalador descarrega o agente e remove os dois. A pergunta do
atalho muda de texto no macOS. README, `docs/distribuicao.md` e o CHANGELOG
atualizados. Verificado com `uname` e `launchctl` simulados: o bundle sobe o
servidor de verdade, nada de `.desktop` é criado, e a desinstalação limpa tudo.
Falta rodar num Mac real.

### [x] 3. macOS: a janela própria nunca abre pelo `node src/index.ts`

**Onde:** `src/sistema/abrirJanelaDoAplicativo.ts:35,105-109,144-151`

`COMANDOS_CHROMIUM_NO_UNIX` lista `google-chrome`, `chromium`, `microsoft-edge` e
`brave-browser`. Nenhum desses nomes existe como comando no `PATH` do macOS, onde
os navegadores são pacotes `.app`. O laço sempre termina sem achar nada e cai no
`open <endereço>`, que abre em aba comum.

O launcher de shell já trata o caso (`instalador/hub-snk.sh:168`, com
`/Applications/Google Chrome.app` e `open -na ... --app=`); o lado Node, não.
Quem roda sem instalar — caminho que o README recomenda — nunca vê a janela sem
abas no Mac, mesmo com `HUB_NAVEGADOR=auto`.

**Correção sugerida:** ramo específico para `darwin` antes do fallback, tentando
`open -na "Google Chrome" --args --app=<endereço>` e os equivalentes de Edge e
Brave, com verificação da existência do `.app`.

**Corrigido.** Ramo `darwin` novo, procurando Chrome, Chromium, Edge e Brave como
`.app` em `/Applications` e `~/Applications`. O valor gravado no `HUB_NAVEGADOR`
pelo instalador (`google-chrome`, `brave-browser`, ...) é traduzido para o nome
do aplicativo. Sem nenhum instalado, cai no `open <endereço>` como antes.
Verificado com `process.platform` forçado para `darwin` e `open` simulado, nos
cinco cenários (nenhum instalado, `auto`, preferência por nome de comando,
preferência com dois instalados e `padrao`). Falta rodar num Mac real.

---

## Prioridade 2

### [x] 4. macOS: atalho para script ou binário Unix pode não executar

**Onde:** `src/sistema/abrirExecutavel.ts:74-83`, `src/sistema/selecionarArquivo.ts:47`

No `darwin` o lançamento sempre delega ao `open`. Para um pacote `.app` isso está
certo. Mas o seletor de arquivo aceita também `public.unix-executable` e
`public.shell-script`, e `open script.sh` entrega o arquivo ao aplicativo
associado à extensão — normalmente um editor —, em vez de executá-lo.

O ramo do Linux já resolve isso corretamente: com bit de execução, chama o
arquivo direto; sem ele, delega ao despachante.

**Correção sugerida:** aplicar a mesma regra no `darwin` — se não é pacote `.app`
e tem bit de execução, `spawn` direto no caminho; caso contrário, `open`.

**Corrigido**, com uma exceção a mais que a sugerida: o `.command` também fica
com o `open`. Executá-lo direto o rodaria escondido, e a janela do Terminal é
justamente o motivo de alguém escolher essa extensão — a correção não podia
piorar o caso que já funcionava. Verificado com `process.platform` forçado para
`darwin` e `open` simulado, nos cinco casos:

| Alvo                     | Resultado        |
| ------------------------ | ---------------- |
| `Programa.app`           | `open`           |
| `roteiro.command` com +x | `open`           |
| `roteiro.sh` com +x      | executado direto |
| `sem-x.sh`               | `open`           |
| binário sem extensão     | executado direto |

O Linux foi conferido junto e não mudou. Falta rodar num Mac real.

### [x] 5. macOS: abrir o terminal com script exige permissão de Automação

**Onde:** `src/sistema/abrirShell.ts:77-91`

O primeiro candidato é
`osascript -e 'tell application "Terminal" to do script ...'`, que dispara o
diálogo de permissão de Automação do macOS na primeira vez. Negada a permissão,
o `osascript` sai com código diferente de zero — e, pelo item 1, isso hoje é
tratado como sucesso, de modo que o `open -a Terminal` seguinte nunca é tentado.

**Correção sugerida:** corrigir o item 1 resolve a queda para o próximo
candidato. Resta documentar em `docs/funcionalidades.md` que o primeiro uso do
botão de terminal no macOS pede permissão de Automação.

**Corrigido**, sem mudança de código: a queda para o `open -a Terminal` veio do
item 1, e o que faltava era documentação. Nova seção _Permissão de Automação no
macOS_ em `docs/funcionalidades.md` e uma linha na tabela de solução de problemas
do README.

Duas limitações ficam registradas por não terem correção barata, e por serem o
que a documentação precisa cobrir:

- **A queda para o `open -a Terminal` descarta o Script padrão.** O terminal abre
  na pasta certa, o script não roda, e a tela não avisa — para ela o terminal
  abriu. Avisar exigiria a rota distinguir sucesso total de parcial, o que muda o
  contrato da API e a tela. O sintoma está documentado: terminal na pasta certa
  ignorando o script é permissão negada.
- **O diálogo de autorização derrota a espera de 400 ms.** Enquanto ele está na
  tela o `osascript` continua vivo, então o HUB SNK o dá como iniciado; negar
  depois disso não abre nada naquela tentativa. Esperar mais significaria segurar
  a resposta HTTP presa a um diálogo. O segundo clique já cai no fallback.

Uma alternativa que dispensaria a permissão — gravar o comando num `.command`
temporário e abri-lo — traz gestão de arquivo temporário e ficou de fora por
peso maior que o do problema.

_Revisão de código: não executado em macOS._

---

## Prioridade 3

### [x] 6. `.desktop` com `Exec` sem aspas

**Onde:** `instalador/instalar-hub-snk.sh:290`

`Exec=$destino/hub-snk.sh abrir` quebra se a pasta de instalação tiver espaço no
caminho — e o instalador deixa digitar qualquer pasta. A especificação Desktop
Entry exige o caminho entre aspas quando ele contém espaços.

**Como conferir:** instalar em `~/Aplicativos com espaço/hub-snk` e clicar no
atalho do menu.

**Corrigido** junto com o item 2, por tocar a mesma função. Verificado no Linux:
instalação em `~/Programas com espaco/hub-snk`, com o `Exec` saindo entre aspas,
o servidor subindo pelo caminho gravado e a desinstalação removendo o atalho.

### [x] 7. `pgrep` é dependência não declarada do launcher

**Onde:** `instalador/hub-snk.sh:91-97`

Todo o controle de ciclo de vida depende de `pgrep -f`, que vem do pacote
`procps`. Sem ele, `pids_do_pacote` devolve vazio sempre: `servidor_no_ar` nunca
é verdadeiro, o launcher sobe uma segunda instância e o servidor falha com
`EADDRINUSE`; e `parar` informa que nada estava rodando. Ambientes de desktop
trazem o pacote, imagens enxutas não.

**Correção sugerida:** conferir `command -v pgrep` no início, como já é feito com
o `node`, e falhar com mensagem explícita.

**Corrigido.** `conferir_pgrep` no launcher, chamada antes do despacho dos três
modos, e a mesma conferência no `instalar-hub-snk.sh` ao lado do
`conferir_node` — pelo mesmo motivo que levou o Node para lá: a falta não pode
aparecer só depois de tudo copiado. A mensagem nomeia o pacote (`procps`).
README e `docs/distribuicao.md` passam a declarar o pré-requisito.

Verificado no Linux com um `PATH` montado à mão, sem `procps`:

| Comando               | Antes                                | Agora                         |
| --------------------- | ------------------------------------ | ----------------------------- |
| `hub-snk.sh servidor` | subia segundo servidor, `EADDRINUSE` | recusa com mensagem, sai 1    |
| `hub-snk.sh parar`    | "não está rodando", falso            | recusa com mensagem, sai 1    |
| `instalar-hub-snk.sh` | copiava tudo e quebrava no atalho    | recusa antes de copiar, sai 1 |

Com o `pgrep` de volta no `PATH`, o ciclo normal segue igual: sobe, responde 200
e para.

### [x] 8. CI não cobre macOS

**Onde:** `.github/workflows/ci.yml`

A matriz tem apenas `ubuntu-latest` e `windows-latest`. Nenhum caminho de código
`darwin` chega a ser executado em nenhum momento. `macos-latest` é gratuito para
repositório público.

**Correção sugerida:** acrescentar `macos-latest` à matriz do job `verificar`.

**Corrigido, com mais do que a sugestão.** Só a linha na matriz não valeria o
que promete: o `verificar` roda `typecheck` e testes, e os testes são de funções
puras — nenhum encosta em código específico de sistema. O `macos-latest` entrou
na matriz, e entrou também um job novo, `instalacao-unix`, que é o que de fato
exercita o que quebrou:

| Passo                    | O que garante                                                              |
| ------------------------ | -------------------------------------------------------------------------- |
| Sintaxe dos `.sh`        | `sh -n` nos quatro scripts — no dash do Ubuntu e no bash do macOS          |
| Empacotar e descompactar | O pacote da plataforma certa, escolhido por `uname -s`/`-m`                |
| Instalar                 | Ciclo real, com atalho e início na sessão respondidos com _sim_            |
| Conferência do Linux     | `.desktop` do atalho e do autostart, `Exec` entre aspas, nenhum `.app`     |
| Conferência do macOS     | `.app` executável, LaunchAgent, `plutil -lint` nos dois, nenhum `.desktop` |
| Subir e responder        | O servidor sobe pelo launcher instalado e atende na porta                  |
| Desinstalar              | Programa e atalhos removidos, cadastro preservado                          |

Não havia conferência nenhuma dos scripts `.sh` no CI — o `distribuicao.yml` só
checa a sintaxe dos `.ps1`. Agora há, e nos dois `sh` diferentes.

Verificado rodando o corpo de cada passo localmente, `bash -e` a `bash -e`, com
o `$GITHUB_ENV` simulado: a perna Ubuntu passa inteira, e a do macOS passa com
`uname` e `launchctl` simulados — os dois plists gerados são lidos pelo
`plistlib`, com as chaves certas, o que é o mesmo que o `plutil -lint` confere. O
YAML foi validado por parser.

A espera antes do `curl` não é decoração: na primeira execução local o `curl`
inicial falhou com _Could not connect_ e só o retry pegou. O launcher volta
quando o processo existe, e o Fastify ainda leva um instante para atender.

### [x] 9. Docker no Linux não sobe o daemon

**Onde:** `src/sistema/docker.ts:151-170`

`comandoParaAbrirODockerDesktop` lança erro explícito no Linux, com mensagem
adequada. Funciona, mas no Linux o Docker costuma ser serviço do systemd, e o
recurso simplesmente não está disponível ali.

**Correção sugerida:** avaliar tentar `systemctl --user start docker-desktop` — ou
deixar como está e documentar a limitação em `docs/funcionalidades.md`.

**Corrigido**, das duas alternativas a primeira: existe caminho sem root no
Linux, e deixar de fora só ele seria uma lacuna, já que o Windows e o macOS
ganham a subida automática. `candidatosParaIniciarODocker` tenta
`systemctl --user start docker-desktop` e, na falta dele, o `docker` rootless. O
Docker Engine como serviço do sistema continua fora de propósito: exige `sudo`,
e pedir senha numa janela que ninguém está vendo não levaria a nada — a mensagem
de erro passa a mostrar o comando.

O disparo passou a usar o `lancarProcesso` do item 1. Aqui isso importa mais que
nos outros: o `systemctl` é curto e o código de saída dele é o que separa
serviço iniciado de unidade inexistente, ao contrário do aplicativo do Windows e
do macOS, que fica vivo. Verificado no Linux com `systemctl` e `docker`
simulados:

| Cenário                         | Resultado                                                      |
| ------------------------------- | -------------------------------------------------------------- |
| Nenhuma unidade existe          | Erro com o comando do `sudo`, em 1 s — não nos 3 min da espera |
| `docker-desktop` sobe           | Para no primeiro candidato, daemon detectado                   |
| Daemon já no ar                 | `systemctl` nem é chamado                                      |
| Só o rootless `docker` responde | Cai para o segundo candidato e sobe                            |

**Efeito colateral a registrar:** o disparo no Windows passou de
`detached: false` para `detached: true`, que é o que o `lancarProcesso` faz.
Para um aplicativo de janela como o Docker Desktop os dois funcionam — com
`stdio: 'ignore'` e `unref`, o filho sobrevive ao pai nos dois modos —, e a
alternativa era manter dois mecanismos de lançamento no projeto. A detecção do
executável no Windows foi conferida na máquina de desenvolvimento: acha o
`%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`. Subir o Docker
Desktop de verdade não foi testado, para não abri-lo no meio do trabalho.

### [x] 10. Atualização por cima deixa arquivos órfãos

**Onde:** `instalador/instalar-hub-snk.sh:239-256` (e o equivalente no Windows)

`copiar_programa` copia sobre a instalação existente sem limpar o destino antes.
Um arquivo que deixou de existir na versão nova permanece na pasta instalada.
Vale para os dois instaladores, não é específico de plataforma.

**Correção sugerida:** remover o conteúdo do destino antes de copiar, preservando
o que não pertence ao programa — ou copiar para uma pasta nova e trocar.

**Corrigido** nos dois instaladores: cada item do pacote é removido antes de ser
copiado, em vez de fundido com o que estava lá. `rm -rf "$destino/$nome"` seguido
do `cp`, e o equivalente em PowerShell.

**A primeira tentativa estava errada e foi descartada.** Ela apagava a pasta de
destino inteira quando reconhecia ali uma instalação do HUB SNK, pelo `hub-snk.sh`
e pelo `src/index.ts`. O teste de segurança passou — mas só porque cobria a
_primeira_ instalação numa pasta com conteúdo alheio. Na segunda, os marcadores já
estariam lá, o `rm -rf` levaria junto o arquivo do usuário. Remover só o que o
pacote traz não tem esse buraco em nenhuma passada.

Sobra uma limitação, aceita de propósito: **órfão no topo da pasta sobrevive** —
um arquivo que uma versão antiga instalava e a nova não traz mais. Alcançá-lo
exigiria apagar o que não está na lista do pacote, que é justamente o que põe em
risco o arquivo alheio. O caso real de órfão é dentro de `src`, `public` e
`node_modules`, e esse está coberto.

Verificado no Linux:

| Cenário                                         | Resultado                               |
| ----------------------------------------------- | --------------------------------------- |
| Órfão em `src/` e em `public/`, após reinstalar | Removidos                               |
| Órfão no topo da pasta                          | Sobrevive — limitação conhecida         |
| Instalação continua íntegra e o servidor sobe   | Sim                                     |
| Pasta com arquivo alheio, **duas** instalações  | Arquivo preservado, conteúdo intacto    |
| Destino igual à pasta do pacote                 | Recusa copiar; o pacote não é destruído |

A sintaxe dos dois `.ps1` foi conferida pelo parser do PowerShell.
