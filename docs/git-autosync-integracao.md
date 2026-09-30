# Especificação: integração do Git AutoSync no HUB SNK

Como instalar o Git AutoSync junto com o HUB SNK, cadastrar no `config.json` dele os
repositórios dos clientes e configurar livremente o commit e o push automáticos.

Referência de implementação já pronta: o projeto `sankhya-hub` (`src/gitAutosync.ts`,
`src/gitAutosyncCli.ts`, `src/routesGitAutosync.ts`, `desktop/scripts/preparar-autosync.mjs`,
`desktop/assets/installer.nsh`). Esta especificação diz o que aproveitar, o que adaptar
ao estilo do HUB SNK (Fastify + zod, repositórios com interface, front sem framework) e
o que ainda não existe.

Sumário do estado atual do `hub-snk` (verificado em 2026-09-29):

| Parte                                              | Estado                                                            |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| Empacotar os binários (`preparar-autosync.mjs`)    | Pronto                                                            |
| Página de componentes e chamada no NSIS            | Pronto (`desktop/assets/installer.nsh`, 370 linhas)               |
| `electron-builder.yml` (`extraResources`)          | Pronto (`build/git-autosync` para `resources/git-autosync`)       |
| Workflow de distribuição                           | Pronto (`REPOSITORIO_GIT_AUTOSYNC: FlavianoRS/git-autosync`)      |
| **Backend que fala com o CLI**                     | **Não existe** (nenhum `.ts` em `src/` cita autosync)             |
| **Cadastrar repositórios de clientes no config**   | **Não existe**                                                    |
| **Tela de configuração do commit/push automático** | **Não existe**                                                    |

Esta especificação cobre o que está em negrito, mais a parte de instalação como
contrato (§2), porque o resto depende de saber exatamente o que ela deixa na máquina.

---

## 1. Peças do Git AutoSync e para que serve cada uma

O Git AutoSync é um programa Python empacotado em PyInstaller. Mora em outro repositório
(`https://github.com/FlavianoRS/git-autosync`, branch `master`; nesta máquina em
`C:\Users\flaviano.santos_sank\Documents\Projetos\scripts\git-autosync`).

### 1.1 Arquivos que viajam no pacote (`resources/git-autosync/`)

| Arquivo                  | Origem no repo do autosync               | Função                                                                                              |
| ------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `git-autosync.exe`       | `python/dist/`                           | Interface gráfica, bandeja **e CLI** (mesmo binário). É o que o HUB SNK chama.                     |
| `git-autosync-sync.exe`  | `python/dist/`                           | O que a tarefa agendada executa. O HUB SNK nunca o chama.                                          |
| `install-standalone.ps1` | `installer/install-standalone.ps1`       | Instalação silenciosa e idempotente. Quem o NSIS chama; também serve para reparar à mão.           |
| `SKILL.md`               | `skill/SKILL.md`                         | Skill para Claude Code e Codex, copiada só se o usuário marcar a opção.                            |
| `VERSION`                | `python/VERSION` (hoje `4.0.0`)          | Versão; o ps1 a grava em `~/.git-autosync/bin/VERSION`.                                            |
| `instalado-pelo-hub.txt` | criado pelo NSIS após instalar com êxito | Marca de quem instalou. A desinstalação só oferece remover o autosync se o marcador existir.       |

Fonte da verdade sobre o que o pacote tem: `desktop/scripts/preparar-autosync.mjs`. Ele
recusa binário mais antigo que qualquer `python/*.py` do autosync e recusa `.ps1` com
caractere fora do ASCII e sem BOM (o `powershell.exe` 5.1 lê ANSI e o script não
compila).

### 1.2 O que existe fora do pacote, na máquina do usuário (`~/.git-autosync/`)

| Caminho                     | Quem escreve                              | Conteúdo                                                                    |
| --------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `bin/git-autosync.exe`      | `install-standalone.ps1`                  | Cópia do binário. **É este que o backend do HUB SNK executa.**              |
| `bin/git-autosync-sync.exe` | `install-standalone.ps1`                  | Cópia do binário da tarefa agendada.                                        |
| `bin/VERSION`               | `install-standalone.ps1`                  | Versão instalada; lida como arquivo, sem executar nada.                     |
| `config.json`               | o CLI (`load_config`/`save_config`)       | **Configuração. É o arquivo que a tela edita, sempre pelo CLI.**            |
| `status.json`               | o CLI                                     | Último resultado por repositório (`lastRun`, `lastPush`, `state`, ...).     |
| `autosync.log`              | o CLI                                     | Log em texto; rotaciona em 5 MB, guarda 3 arquivos.                         |
| `state.lock`, `log.lock`    | o CLI                                     | Travas de arquivo. Não tocar.                                               |

A pasta inteira pode ser trocada com a variável `GIT_AUTOSYNC_HOME`. O backend do HUB
SNK deve respeitá-la (default `~/.git-autosync`) e repassá-la ao processo filho.

Fora dessa pasta, a instalação também cria (todas opcionais, por flag do ps1): a tarefa
`GitAutoSyncPy_<n>` no Agendador de Tarefas, `Startup\GitAutoSyncTray.bat`, atalhos
`Git AutoSync.lnk`, `~\.claude\skills\git-autosync`, `~\.codex\skills\git-autosync` e a
entrada `bin` no PATH do usuário.

---

## 2. Instalação junto com o HUB SNK (contrato do instalador)

Nada a construir aqui; a seção descreve o que já está no `hub-snk` para que o backend e
a tela saibam o que esperar. Manter como está.

### 2.1 Fluxo

1. `npm --prefix desktop run empacotar` roda `tsc`, `preparar-hub.mjs`,
   `preparar-autosync.mjs` e o `electron-builder`.
2. `preparar-autosync.mjs` monta `desktop/build/git-autosync` (cinco arquivos da §1.1) e
   gera `desktop/build/gas-version.nsh` com `!define GAS_PRESENTE` e
   `!define GAS_VERSION "<versão>"`.
3. `installer.nsh` inclui esse `.nsh` com `!include /NONFATAL`. Sem `GAS_PRESENTE`, nada
   do autosync entra no instalador (`empacotar:sem-autosync` grava um `.nsh` sem o
   define, porque arquivo ausente vira o warning 7000, tratado como erro).
4. Página de componentes (depois da escolha da pasta) e `customInstall` chamam:

```
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
  -File "$INSTDIR\resources\git-autosync\install-standalone.ps1"
  -Source "$INSTDIR\resources\git-autosync"
  [-TaskTime HH:mm[,HH:mm]] [-EnableTray] [-Shortcut] [-Skills] [-AddToPath]
```

### 2.2 O que cada flag do `install-standalone.ps1` faz

| Flag                 | Efeito                                                                                                                | Como é feito                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| (sempre)             | Copia os dois `.exe` para `~/.git-autosync/bin` só se o hash mudou; grava `bin/VERSION`.                              | `Copy-Item` condicional                                                 |
| `-TaskTime 17:30`    | Cria/atualiza a tarefa agendada e grava `schedules` no `config.json`. Aceita lista `12:00,17:30`.                     | Delegado a `git-autosync set-schedule` (idempotente, deduplica, rollback) |
| `-EnableTray`        | Bandeja sobe no login e `trayEnabled: true` vai para o config.                                                        | Delegado a `git-autosync enable-tray`                                   |
| `-Shortcut`          | `.lnk` na área de trabalho e no menu Iniciar. Falha aqui não derruba a instalação.                                    | `WScript.Shell`                                                         |
| `-Skills`            | Copia `SKILL.md` (com a versão substituída) para `.claude` e, se a pasta existir, `.codex`.                           | `Set-Content`                                                           |
| `-AddToPath`         | Põe `bin` no PATH do **usuário**, nunca da máquina.                                                                   | `SetEnvironmentVariable(..., 'User')`                                   |
| `-Uninstall`         | Remove binários, tarefa, bandeja, atalhos e skills. Preserva `config.json`, `status.json`, `autosync.log`.            | `git-autosync uninstall`, com fallback `schtasks`                       |
| `-PurgeData`         | Só com `-Uninstall`: apaga também `~/.git-autosync`.                                                                  | `Remove-Item`                                                           |

Regras que não podem ser quebradas (cada uma custou um bug medido na 0.2.0 do
`sankhya-hub`):

- O `.ps1` fica só em ASCII (ou UTF-8 com BOM).
- `git-autosync.exe` é binário de janela: o ps1 o chama com `Start-Process -PassThru`,
  lê `$processo.Handle` e usa `WaitForExit()` (função `Invocar-Exe`). Nunca `& exe` e
  nunca `-Wait` (espera a árvore e o `enable-tray` deixa a bandeja filha viva).
- Um exe PyInstaller que abre outro exe PyInstaller precisa de
  `PYINSTALLER_RESET_ENVIRONMENT=1` (corrigido no autosync, commit `ebc258b`); por isso
  o `hub-snk` deve empacotar um autosync **igual ou mais novo** que esse commit.
- Pré-requisito único da máquina de destino: `git` no PATH. A mensagem "Git não está
  instalado" do NSIS é palpite: qualquer código de saída diferente de zero a mostra.
  Para diagnosticar, rodar o ps1 à mão com os mesmos argumentos.
- Falha do autosync **não aborta** a instalação do HUB SNK.

### 2.3 Ajustes de ambiente a documentar em `docs/distribuicao.md`

- `docs/distribuicao.md` cita `C:\Workspace\scripts\git-autosync` como local padrão;
  `preparar-autosync.mjs` usa `../scripts/git-autosync` relativo ao repo. Em máquina onde
  o autosync está em outro lugar (caso desta: `...\Projetos\scripts\git-autosync`), definir
  `GIT_AUTOSYNC_DIR`.
- Antes de empacotar: `python\build_windows.ps1` no repo do autosync, na branch `master`.
  O PyInstaller não faz cross-compile.

---

## 3. Backend: falar com o CLI

Objetivo: o HUB SNK lê e altera a configuração do autosync **exclusivamente chamando o
CLI** (`git-autosync.exe`), e lê `config.json`, `status.json` e `autosync.log` só para
exibir.

### 3.1 Regra central: quem escreve o `config.json`

O backend **não** grava `config.json`. Toda escrita passa por um subcomando do CLI.
Motivos:

- O CLI usa `state.lock` e escrita atômica (`atomic_json`), com merge de snapshot. Uma
  escrita do Node por fora pode perder alteração feita ao mesmo tempo pela bandeja ou
  pela tarefa agendada.
- `set-schedule` e `install` mexem também no Agendador; editar só o JSON deixaria
  `schedules` dizendo uma coisa e o Agendador outra.
- `add` valida o caminho e normaliza; `save_config` valida os horários.

Leitura direta do `config.json` é permitida (é o que o `sankhya-hub` faz) para montar a
tela sem custo de processo.

### 3.2 Módulo novo: `src/autosync/`

Seguir a estrutura por camadas do `hub-snk` (interface + implementação, rotas dependendo
só da interface):

```
src/autosync/
  tiposDoAutosync.ts        tipos do config.json, do status.json e da visão da tela
  cliDoAutosync.ts          interface CliDoAutosync + erros de domínio
  cliDoAutosyncProcesso.ts  implementação: resolve o exe e faz spawn sem shell
  visaoDoAutosync.ts        cruza config + status + tarefas numa lista por repositório
  sincronizacaoComClientes.ts  compara repositórios dos clientes com os alvos do config
src/rotas/rotasAutosync.ts  rotas HTTP e validação com zod
src/rotas/rotasAutosync.test.ts
```

Reaproveitar do `sankhya-hub` (copiar e adaptar nomes e estilo, não importar):

| `sankhya-hub`                       | `hub-snk`                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `src/gitAutosyncCli.ts` `executar`  | `cliDoAutosyncProcesso.ts`; ou reusar `src/git/executarGit.ts` se aceitar o exe      |
| `resolverCli()`                     | idem, com a ordem da §3.3                                                            |
| `#tarefas()` (PowerShell/cron)      | `cliDoAutosyncProcesso.ts`, `listarTarefas()`                                        |
| `src/gitAutosync.ts` `visao()`      | `visaoDoAutosync.ts`                                                                 |
| `src/routesGitAutosync.ts`          | `rotasAutosync.ts`, trocando validação manual por zod                                |

### 3.3 Resolver o executável

Sem shell, sem `.bat`. Ordem:

1. `<GIT_AUTOSYNC_HOME ou ~/.git-autosync>/bin/git-autosync.exe` (`git-autosync` no Linux),
   se existir: modo `standalone`.
2. `<...>/bin/git-autosync.bat`: ler o arquivo, extrair com
   `/^\s*"([^"]+\.exe)"\s+"([^"]+\.py)"/` o `python.exe` e o `app.py`, e chamar
   `python.exe app.py <args>`: modo `venv`.
3. Nenhum dos dois: `instalado = false`. A tela mostra o estado "Git AutoSync não
   instalado" com a instrução de rodar
   `resources\git-autosync\install-standalone.ps1` (caminho real vem do `process.resourcesPath`
   quando empacotado; ver §3.8).

Motivo de nunca chamar o `.bat`: o `cmd.exe` reinterpreta `& | ^ %` dentro de argumentos
já entre aspas, e o caminho do repositório vem da tela (BatBadBut, CVE-2024-24576). O
`sankhya-hub` documenta a mesma decisão em `gitAutosyncCli.ts`.

### 3.4 Executar o CLI

```ts
spawn(comando, [...prefixo, ...args], {
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PYTHONIOENCODING: 'utf-8' },   // sem isso, emoji no status quebra com charmap
});
```

- **Nunca `shell: true`.** Argumentos sempre em array.
- Juntar stdout e stderr no texto de saída (o git escreve em stderr sem ser erro, e o
  motivo de falha de push costuma sair por lá).
- Timeout: 180 s para `sync`/`commit`/`push`/`mr`; 20 s para consulta do Agendador.
  Estourou: matar o processo e devolver "o git-autosync passou de 180s e foi encerrado".
- Código de saída diferente de zero vira `GitAutosyncFalhouError(saida)`; caminho ou
  argumento inválido vira `GitAutosyncUsoError` (HTTP 400/404, nunca 503).
- O autosync novo já força UTF-8 no stdout (`core.force_utf8_stdio()`), mas manter o
  `PYTHONIOENCODING` para o caso de autosync mais antigo na máquina.

### 3.5 Mapa de operações para subcomandos do CLI

| Operação da tela                        | Comando executado                                                   | Observação                                                                          |
| --------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Estado geral                            | `status --json`                                                     | JSON: `{ lastSyncRun, repos: { <caminho>: {...} } }`                                |
| Ler configuração                        | leitura direta de `config.json`                                     | `null` se o arquivo ainda não existe (o CLI o cria na primeira chamada)             |
| Adicionar repositório                   | `add <caminho> --type repo`                                         | Já entra ativo. Validar `existsSync` antes.                                         |
| Adicionar pasta-raiz                    | `add <caminho> --type root`                                         | Varre subpastas com `.git` (um nível).                                              |
| Remover alvo próprio                    | `remove <caminho>`                                                  | Não checar existência: pasta apagada também precisa sair.                           |
| Desativar repo vindo de uma raiz        | `exclude <caminho>`                                                 | **Nunca** `remove` aqui: levaria todos os repos da raiz junto.                      |
| Reativar repo excluído de uma raiz      | `include <caminho>`                                                 |                                                                                     |
| Horários                                | `set-schedule "12:00,17:30"`                                        | Reinstala a tarefa junto. Lista vazia é erro no CLI: para parar, `uninstall`.       |
| (Re)criar a tarefa                      | `install`                                                           | Quando o config tem horário mas o Agendador não tem tarefa.                         |
| Remover a tarefa                        | `uninstall`                                                         | Config e repositórios ficam.                                                        |
| Bandeja                                 | `enable-tray` / `disable-tray`                                      | Só um por vez; hoje não há instância única (bandeja duplicada se já houver uma).    |
| Mensagem por IA ligada/desligada        | `set-ai on\|off`                                                    | Manda o **diff** ao agente escolhido: ver §5.3.                                     |
| Agente de IA                            | `set-agent auto\|claude\|codex\|opencode`                           |                                                                                     |
| Política por repositório                | `set-policy --repo <p> [--include g]* [--exclude g]* [--branch g]* [--max-file-bytes n] [--ai on\|off]` | Repetir a flag para lista. Ver §5.4.                    |
| Prévia da mensagem                      | `preview --json --repo <p>`                                         | Não grava nada.                                                                     |
| Commit sem push                         | `commit --repo <p> [-m "texto"] [--agent a]`                        |                                                                                     |
| Push do que já foi commitado            | `push --repo <p>`                                                   |                                                                                     |
| Commit + push                           | `sync --repo <p> [-m "texto"] [--agent a]`                          | Sem `--repo` o CLI opera no diretório atual: **sempre** passar `--repo`.            |
| Rodar tudo agora                        | `sync --all`                                                        | Não aceita `-m`.                                                                    |
| Histórico                               | `history --json --repo <p> --limit 20 --since all`                  | Chave do objeto de retorno pode vir com barras diferentes das enviadas.             |
| Log                                     | leitura direta de `autosync.log`, últimas N linhas                  |                                                                                     |
| Diagnóstico                             | `doctor [--network]`                                                | Sai com código 1 se algum repo falha; a saída ainda é JSON útil.                    |
| Merge request                           | `mr --repo <p> [--title t] [--target b] [--source b]`               | Só GitLab. Token: `set-gitlab-token` (input oculto, não expor na tela).             |

Toda ação que muda repositório exige `caminho` no corpo; sem ele a rota responde 400
(`envie { caminho }`) antes de chamar o CLI.

### 3.6 Estado do Agendador

O CLI não devolve as tarefas em JSON leve; o `doctor` percorre todos os repos e leva
segundos. Ler direto:

- **Windows** (`powershell.exe` 5.1): `@(Get-ScheduledTask | Where-Object { $_.TaskName -like 'GitAutoSync*' } | ForEach-Object {...}) | ConvertTo-Json -Compress`,
  com `nome`, `estado`, `proximaExecucao`, `ultimaExecucao`, `ultimoResultado`.
  Armadilhas medidas: sem `-AsArray` (não existe no 5.1); `[long]` e não `[int]` em
  `LastTaskResult` (HRESULT sem sinal estoura Int32).
- **Linux/macOS**: `crontab -l`, linhas que terminam em `# git-autosync`.

Lista vazia com `schedules` preenchido no config = agendamento que parece configurado e
nunca roda. A tela deve deixar isso **visível** com botão "Criar tarefa" (`install`).

### 3.7 Visão consolidada

`visao()` devolve, em uma chamada, o que a tela precisa. Cruza os dois arquivos porque
nenhum sozinho serve: o config lista **alvos** (uma raiz cobre N repos sem nomeá-los) e o
status lista o que **já rodou** (sem dizer se ainda está no agendamento).

```ts
interface VisaoDoAutosync {
  instalado: boolean;
  versao: string | null;               // conteúdo de bin/VERSION
  horarios: string[];                  // config.schedules
  tarefas: TarefaDoAgendador[];        // o que o Agendador realmente tem
  ultimaExecucao: string | null;       // status.lastSyncRun
  bandeja: boolean;                    // config.trayEnabled
  ia: { ligada: boolean; agente: string };   // aiEnabled, aiAgent
  agenteDaTarefa: string | null;       // config.scheduleAgent
  ramoDoMr: string;                    // config.mrTargetBranch
  repositorios: RepositorioDoAutosync[];
}
interface RepositorioDoAutosync {
  caminho: string;
  alvo: string;             // o próprio caminho se for alvo próprio; a raiz que o cobre; '' se só no status
  alvoProprio: boolean;
  ativo: boolean;           // não está em nenhum `exclude` de raiz e o alvo tem enabled != false
  politica: PoliticaDoRepositorio | null;   // config.repoPolicies (comparando caminho normalizado)
  estado: EstadoDoRepositorio | null;       // status.repos[caminho]
  clienteId?: string;       // preenchido pela sincronização da §4
}
```

Comparação de caminho: `replace(/\\/g,'/')`, sem `/` final, minúsculas. O `config.json` deste
usuário mistura `C:/...` e `C:\\...`, e o Windows não diferencia maiúsculas.

### 3.8 Localizar o instalador quando ele não foi executado

Se o usuário desmarcou o autosync no instalador e depois quer instalá-lo, o backend
precisa achar o `install-standalone.ps1`. O shell (`desktop/src/config.ts`) já sabe o
`resourcesPath`; passar ao backend uma variável `HUB_AUTOSYNC_PACOTE` apontando para
`<resourcesPath>\git-autosync`. Rota `POST /api/autosync/instalar` (§6) roda o ps1 com as
mesmas flags da §2.1. Sem a variável (desenvolvimento), responder 409 com a mensagem
"pacote do Git AutoSync não está neste build".

---

## 4. Cadastrar no `config.json` os repositórios dos clientes

Origem dos dados: `clientes.json`, `cliente.repositorios[]`, cada um
`{ id, url, caminhoLocal? }` (`src/tipos.ts`, `RepositorioGit`). Só entram no autosync
os que têm `caminhoLocal`, a pasta existe **e** é repositório git.

O cadastro do cliente **não** mexe no autosync sozinho. Entrar no `config.json` é uma
ação explícita da pessoa, pelos botões abaixo. (É a mesma decisão do `sankhya-hub`, e
evita commit automático em pasta que a pessoa só cadastrou para consulta.)

### 4.1 Regras da comparação

1. Construir o conjunto de repositórios dos clientes com pasta local.
2. Para cada um, procurar o caminho normalizado na visão do autosync (§3.7).
3. Classificar:

| Situação                                                   | Estado na tela                     | Ação oferecida            |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------- |
| Não está no autosync                                       | `fora`                             | **Adicionar**             |
| É alvo próprio, ativo                                      | `ativo`                            | Desativar (`remove`)      |
| Coberto por uma raiz e ativo                               | `ativo (pela pasta <raiz>)`        | Desativar (`exclude`)     |
| Coberto por uma raiz e excluído                            | `excluído`                         | Reativar (`include`)      |
| Alvo próprio com `enabled: false`                          | `desligado`                        | Reativar (`remove`+`add`) |
| Pasta não existe mais                                      | `pasta ausente`                    | Nenhuma (só `remove`)     |
| Pasta existe mas não tem `.git`                            | `não é repositório`                | Nenhuma                   |

`enabled: false` num alvo **não tem subcomando** no CLI atual. Para reativar: `remove`
e `add`. Não editar o JSON à mão para isso (§3.1).

4. Se o repositório está dentro de uma raiz já cadastrada (`caminho` começa com
   `<raiz>/`), **não** chamar `add`: ele já roda. Se estiver em `exclude`, o botão é
   `include`.

### 4.2 Ações

- **Por repositório**, na aba de repositórios do cliente: botão "Adicionar ao autosync" /
  "Tirar do autosync" e o estado da §4.1 como selo. Chama `POST /api/autosync/repositorios`
  com `{ caminho, tipo: 'repo' }`.
- **Em lote**, na tela de configuração do autosync: "Adicionar todos os repositórios dos
  clientes". Percorre o conjunto `fora`, chama `add` um a um em série (o `state.lock` já
  serializa, e paralelo só gera contenção) e devolve o resultado por repositório:
  `{ adicionados: [], jaEstavam: [], ignorados: [{caminho, motivo}], falhas: [{caminho, erro}] }`.
  Um `add` que falha não interrompe os seguintes.
- **Remover cliente ou repositório do cadastro** não tira do autosync automaticamente:
  a tela oferece, na confirmação da exclusão, "Tirar também do Git AutoSync" (padrão
  desmarcado), porque o histórico e os commits pendentes daquele repo ainda importam.

### 4.3 Pasta-raiz como atalho

Quem guarda todos os clones sob uma pasta (`Documents\Demandas\<cliente>-customizacoes`)
pode cadastrar a pasta como `root`. A tela deve **sugerir** isso quando 3 ou mais
repositórios de clientes compartilham o mesmo pai imediato: "N repositórios estão em
`<pai>`. Cadastrar a pasta cobre todos e os futuros." Aceitar vira `add <pai> --type root`.
A sugestão é só uma sugestão: uma raiz também pega repos que a pessoa não queria
sincronizar (por isso existe `exclude`).

### 4.4 Formato resultante do `config.json`

```json
{
  "schedules": ["17:30"],
  "targets": [
    { "path": "C:/Users/x/Projetos/cliente-a", "type": "repo", "enabled": true },
    {
      "path": "C:/Users/x/Documents/Demandas",
      "type": "root",
      "enabled": true,
      "exclude": ["C:\\Users\\x\\Documents\\Demandas\\cliente-b-customizacoes"]
    }
  ],
  "taskName": "GitAutoSyncPy",
  "trayEnabled": true,
  "theme": "dark",
  "viewMode": "card",
  "aiAgent": "codex",
  "scheduleAgent": "claude",
  "mrTargetBranch": "main",
  "aiEnabled": false,
  "repoPolicies": {}
}
```

Ficam de fora da tela, e o HUB SNK nunca escreve: `taskName`, `theme`, `viewMode`
(específicos da interface do próprio autosync).

---

## 5. Configurar livremente o commit e o push automáticos

"Livremente" aqui é o conjunto de botões do autosync que o CLI aceita. A tela do HUB SNK
expõe todos eles; o que o CLI **não** aceita fica fora e é listado na §5.5.

### 5.1 Quando roda

- **Horários** (`schedules`): lista `HH:MM`, validada por `/^([01][0-9]|2[0-3]):[0-5][0-9]$/`.
  Vários horários viram vários gatilhos da mesma tarefa. Editar chama `set-schedule`,
  que reinstala a tarefa; não existe passo de "reinstalar" depois.
- **Sem horário não existe**: o CLI recusa lista vazia. A tela tem "Desativar o
  agendamento" (`uninstall`) e "Ativar" (`install`), separados de editar horários.
- **Agora**: botão "Rodar agora" (`sync --all`) e, por repositório, `commit`, `push` e
  `sync`.
- **Bandeja**: `enable-tray`/`disable-tray`. A tela avisa que hoje ligar duas vezes abre
  duas bandejas (pendência do autosync).

### 5.2 O que vai no commit

Comportamento do autosync (ver `autosync_core.py`):

- Faz `git add -A` num **índice privado** e commita dali; o índice real da pessoa não é
  alterado. Se o commit falha, nada muda.
- Recusa (o commit inteiro, não só o arquivo) quando encontra no que iria commitar:
  arquivo sensível por nome (`.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa`, `id_ed25519`,
  `credentials.json`), arquivo acima de `maxFileBytes` (5 MB por padrão) ou padrão de
  segredo no conteúdo (chave privada PEM, `glpat-`, `ghp_`, `github_pat_`, `AKIA...`).
- Recusa em HEAD destacado, em merge/rebase/cherry-pick/revert em andamento e com
  conflitos pendentes.
- Sem alterações: não faz nada e registra "sem alteracoes, nada a fazer".

A tela precisa **mostrar o motivo da recusa** ao pé do repositório (vem em
`status.repos[...].message`), com o texto do CLI sem reescrever.

### 5.3 Quem escreve a mensagem do commit

| Config                | Efeito                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `aiEnabled: false`    | Padrão. Mensagem fixa `chore: auto-commit AAAA-MM-DD HH:MM`. É a origem do histórico cheio de "auto-commit". Nada sai da máquina.   |
| `aiEnabled: true`     | Envia o **diff** (até 12.000 caracteres) ao agente escolhido, que devolve mensagem em Conventional Commits com emoji.               |
| `aiAgent`             | `auto` (primeiro instalado na ordem claude, codex, opencode), `claude`, `codex` ou `opencode`.                                      |
| `scheduleAgent`       | Agente fixado só para a rodada agendada; o CLI o preenche na primeira instalação feita de dentro de uma skill. Somente leitura na tela. |
| `repoPolicies[p].aiEnabled` | Sobrepõe `aiEnabled` para um repositório (liga ou desliga só nele).                                                        |

**A tela precisa de confirmação explícita antes de ligar a IA**, com o texto: "O diff das
alterações será enviado ao agente escolhido (Claude, Codex ou OpenCode) para escrever a
mensagem do commit." Ligar não é decisão do sistema. O ideal é ligar por repositório
(`set-policy --ai on`) para quem tem repositório de cliente com código sensível. Falha do
agente não trava nada: cai na mensagem fixa e registra um aviso no log.

Mensagem manual: `commit -m` e `sync -m` pulam a geração. A tela oferece "Escrever a
mensagem" (com "Gerar prévia" chamando `preview --json`) para o commit individual; não
há mensagem manual para `--all`.

### 5.4 Política por repositório (`repoPolicies`)

Chave: caminho do repositório (comparado normalizado). Comando: `set-policy --repo <p>`.
Cada flag **substitui** o campo inteiro; para editar a lista, reenviar todos os itens.

| Campo (`config.json`) | Flag                | Significado                                                                              |
| --------------------- | ------------------- | ---------------------------------------------------------------------------------------- |
| `include`             | `--include <glob>`  | Se preenchido, só arquivos que casam entram; qualquer outro **bloqueia o commit inteiro**. |
| `exclude`             | `--exclude <glob>`  | Acrescenta à lista de arquivos proibidos (soma-se à lista fixa da §5.2).                 |
| `allowedBranches`     | `--branch <glob>`   | Só sincroniza se a branch atual casar (`fnmatch`, ex.: `feature/*`).                     |
| `maxFileBytes`        | `--max-file-bytes`  | Inteiro positivo; substitui os 5 MB.                                                     |
| `aiEnabled`           | `--ai on\|off`      | Sobrepõe o global.                                                                       |

A tela tem um editor por repositório com esses cinco campos, lista de globs em chips e
um aviso ao lado de `include`: "Arquivo fora da lista bloqueia o commit inteiro, não é
ignorado". Sem forma de **apagar** um campo pelo CLI (não há `--clear`): o esperado é
enviar lista vazia; validar em teste que `set-policy --repo p --exclude ""` não grava
`[""]`. Se gravar, tratar item vazio como remoção na tela e pedir suporte ao autosync
(§5.5).

### 5.5 O que o CLI não permite e a tela não deve fingir que permite

| Desejo                                             | Situação no autosync 4.0.0                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Editar o **texto do prompt** de mensagem de commit | Fixo em `_generate_commit_message` (Conventional Commits com emoji, 72 colunas). Não existe campo no config.                   |
| Formato da mensagem fixa sem IA                    | Fixo: `chore: auto-commit AAAA-MM-DD HH:MM`.                                                                                   |
| Dias da semana no agendamento                      | Não existe; os horários valem todo dia.                                                                                        |
| Desligar só o push (commit automático sem push)    | Não há chave. `sync` faz os dois; `commit` faz só o commit. A rodada agendada usa `sync`.                                      |
| Ligar/desligar um alvo (`enabled`)                 | Sem subcomando; usar `remove` + `add`.                                                                                         |
| Trocar `mrTargetBranch`                            | Sem subcomando; o `mr` aceita `--target` por chamada.                                                                          |
| Limpar um campo de `repoPolicies`                  | Sem `--clear` (ver §5.4).                                                                                                      |

Para o que a pessoa quer de fato ("configurar o arquivo de commit e push livremente"),
há duas rotas, e a escolha é da equipe:

- **Rota A (recomendada): não editar o JSON pelo HUB SNK.** Implementar tudo que a
  §5.1–5.4 cobre, e propor ao repositório do autosync um `set-config <chave> <valor>`
  para os campos acima (`mrTargetBranch`, `enabled` de alvo, limpar política, um
  `commitTemplate`/`commitPrompt` opcional). Fica no lugar certo: o autosync é dono do
  arquivo.
- **Rota B: edição direta do `config.json` pela tela** (um editor de texto com validação).
  Só é segura se o HUB SNK: (1) tomar o mesmo `state.lock` (exige implementar o lock
  compatível com `runtime_safety.file_lock` em Node); (2) escrever de forma atômica
  (arquivo temporário + `rename`); (3) preservar chaves que não conhece; (4) validar
  `schedules` com a regex acima; (5) depois de gravar `schedules`, chamar `install` para
  o Agendador acompanhar. Custo alto e risco de corromper o arquivo se a bandeja
  gravar ao mesmo tempo. **Não recomendada.**

Esta especificação implementa a Rota A no lado do HUB SNK. Os itens da tabela acima que
dependem de mudança no autosync entram como pendência (§9), sem bloquear a entrega.

---

## 6. Rotas HTTP

Prefixo `/api/autosync`, todas atrás de `registrarProtecaoDeOrigem`. Validar entrada com
zod, como as demais (`rotasConfiguracao.ts`). Mensagens em português.

| Método e rota                          | Corpo / query                                                | Resposta                                                      |
| -------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| `GET /api/autosync`                    | `?clientes=true` inclui vínculo com cliente                  | `VisaoDoAutosync` (§3.7)                                      |
| `GET /api/autosync/clientes`           |                                                              | Repositórios dos clientes com o estado da §4.1                |
| `POST /api/autosync/instalar`          | `{ horario?, bandeja?, atalhos?, skills?, path? }`           | `{ saida }`; roda o ps1 (§3.8)                                |
| `POST /api/autosync/repositorios`      | `{ caminho, tipo: 'repo'\|'root' }`                          | `{ saida }`                                                   |
| `POST /api/autosync/repositorios/lote` | `{ origem: 'clientes' }`                                     | Resultado por repositório (§4.2)                              |
| `DELETE /api/autosync/repositorios`    | `{ caminho }`                                                | `{ saida }`                                                   |
| `POST /api/autosync/repositorios/excluir` / `incluir` | `{ caminho }`                                  | `{ saida }`                                                   |
| `PUT /api/autosync/agendamento`        | `{ horarios: string[] }` (1 a 6, `HH:MM`, sem repetir)       | `{ saida }`                                                   |
| `POST /api/autosync/agendamento/instalar` \| `/desinstalar` |                                                  | `{ saida }`                                                   |
| `PUT /api/autosync/bandeja`            | `{ ligada: boolean }`                                        | `{ saida }`                                                   |
| `PUT /api/autosync/ia`                 | `{ ligada: boolean, agente?: 'auto'\|'claude'\|'codex'\|'opencode' }` | `{ ligada, agente }`                                 |
| `PUT /api/autosync/politica`           | `{ caminho, include?, exclude?, ramos?, maxBytes?, ia?: 'on'\|'off' }` | Política gravada (lida de volta do config)          |
| `GET /api/autosync/previa`             | `?caminho=`                                                  | `{ caminho, mensagem }` ou `{ semAlteracoes: true }`          |
| `POST /api/autosync/commit`            | `{ caminho, mensagem? }`                                     | `{ saida }`                                                   |
| `POST /api/autosync/push`              | `{ caminho }`                                                | `{ saida }`                                                   |
| `POST /api/autosync/sincronizar`       | `{ caminho?, mensagem? }`; sem `caminho`: `sync --all`       | `{ saida }`                                                   |
| `GET /api/autosync/historico`          | `?caminho=&limite=20`                                        | Lista de commits                                              |
| `GET /api/autosync/log`                | `?limite=200`                                                | `string[]`                                                    |
| `GET /api/autosync/diagnostico`        | `?rede=true`                                                 | Saída do `doctor`                                             |

Códigos: 400 entrada inválida (`GitAutosyncUsoError`); 404 pasta inexistente; 409 pacote
do autosync ausente; 502 o CLI rodou e falhou (`GitAutosyncFalhouError`, com a saída);
503 autosync não instalado.

Segurança:

- `caminho` é sempre absoluto (`isAbsolute`), com no máximo 400 caracteres, e para
  qualquer rota que muda repositório **precisa** existir em `visao().repositorios` ou em
  algum repositório de cliente. Não é uma porta para o CLI operar em pasta qualquer
  do disco.
- `mensagem` sem limite de conteúdo, mas máx. 2000 caracteres; passa como argumento de
  processo, nunca por shell.
- Nada de `set-gitlab-token` pela API nesta entrega (token em input oculto do CLI).
- A saída do CLI vai ao log do HUB SNK já **redigida** (o CLI aplica `redact`; não
  reintroduzir token em mensagem de erro).

---

## 7. Tela

Sem framework, em `public/app.js` e `public/index.html`, no padrão das telas atuais.
Duas áreas:

**7.1 Aba "Git AutoSync" em Configurações** (ou item de menu próprio):

1. **Estado**: instalado (versão `bin/VERSION`), bandeja, última execução, tarefas do
   Agendador. Selo vermelho "horário configurado, tarefa não instalada" com botão
   Criar tarefa. Se não instalado: botão "Instalar" (§3.8) e o motivo mais comum
   (falta do Git).
2. **Quando roda**: chips de horário editáveis, botão Salvar (`PUT agendamento`),
   Ativar/Desativar agendamento, Rodar agora.
3. **Mensagem do commit**: interruptor da IA com a confirmação da §5.3, seletor de
   agente.
4. **Repositórios**: lista da §3.7 com selo de estado, último resultado (`message` do
   status), ações por linha (Commit, Push, Sync, Histórico, Prévia, Política, Ativar/
   Desativar) e o botão "Adicionar todos os repositórios dos clientes" (§4.2).
5. **Log**: últimas 200 linhas do `autosync.log`, com atualizar.

**7.2 Aba de repositórios do cliente** (`cliente.repositorios`): selo de estado do
autosync por repositório e o botão da §4.2. Respeita a funcionalidade oculta
`cliente.repositorios` de `src/acessos.ts`. Adicionar uma funcionalidade `autosync` em
`FUNCIONALIDADES` (`src/tipos.ts`) e no preset de cada perfil (`src/acessos.ts`), para
quem não usa Git AutoSync (perfil Gerente de projeto, por exemplo) não ver a aba.

Acessibilidade e estados: cada ação desabilita o botão e mostra "em andamento" enquanto
espera (o `sync` chega a minutos); erro do CLI aparece ao lado da linha, com o texto
original.

---

## 8. Testes

Padrão do projeto: `node --test`, arquivos `*.test.ts` ao lado do código.

| Teste                               | O que prova                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `cliDoAutosyncProcesso.test.ts`     | `resolverCli` prefere o `.exe`, cai no `.bat`, devolve `null` sem os dois; o parse do `.bat` aceita aspas e espaços; nenhum `spawn` com `shell: true`. |
| idem                                | Caminho com `& | ^ %` e espaços chega literal como um argumento só (usar um `.exe` falso que ecoa `argv`).          |
| `visaoDoAutosync.test.ts`           | União config+status; repo em raiz vs. alvo próprio; `exclude` some da lista de ativos; barras e maiúsculas misturadas casam; `repoPolicies` casa por caminho normalizado. |
| `sincronizacaoComClientes.test.ts`  | Cada linha da tabela da §4.1; repo dentro de raiz não chama `add`; lote continua após falha de um item.           |
| `rotasAutosync.test.ts`             | Validação zod (horário inválido, lista vazia, repetido); 400 sem `caminho`; 404 pasta inexistente; 503 sem instalação; `sync` sem `caminho` roda `--all` sem `-m`. |
| `aiComConfirmacao`                  | `PUT /ia` com `ligada: true` chama `set-ai on` e, se informado, `set-agent`; agente inválido é 400.               |
| Manual, na máquina                  | Instalar o pacote, marcar o autosync, conferir `~/.git-autosync/bin`, tarefa `GitAutoSyncPy_1`, `config.json` com o horário; adicionar um repositório de cliente pela tela e ver o `targets` mudar; `sync` real num repositório de teste; desinstalar e conferir que o marcador `instalado-pelo-hub.txt` controla a pergunta. |

Usar `GIT_AUTOSYNC_HOME` apontando para uma pasta temporária e um executável de mentira
nos testes automáticos; nenhum deles toca no `~/.git-autosync` real nem no Agendador.

---

## 9. Ordem de implementação e pendências

1. `tiposDoAutosync.ts`, `cliDoAutosync.ts`, `cliDoAutosyncProcesso.ts` e testes (§3.2–3.4).
2. `visaoDoAutosync.ts` e leitura de `config.json`/`status.json`/`log`/Agendador (§3.6–3.7).
3. `rotasAutosync.ts`: primeiro as rotas de leitura, depois as de escrita (§6).
4. `sincronizacaoComClientes.ts` e o lote (§4).
5. Tela (§7), depois `docs/api.md`, `docs/funcionalidades.md` e `docs/estrutura-do-codigo.md`.
6. Registrar no `src/index.ts`: `registrarRotasDeAutosync(servidor, { cli, repositorioDeClientes })`.
7. Variável `HUB_AUTOSYNC_PACOTE` no `desktop/src/backendProcess.ts` (§3.8).

Pendências fora do HUB SNK (repositório `git-autosync`, sem bloquear nada acima):

- `set-config` genérico e `set-target --enabled`, para a Rota A da §5.5.
- Opção de prompt/template de mensagem de commit e de formato da mensagem fixa.
- Instância única da bandeja (`enable-tray` abre duplicada).
- `set-policy` com `--clear` por campo.
- Chave para "só commit" na rodada agendada.

Riscos a conferir na implementação:

- **Autosync antigo na máquina** (instalado por Python, com `.bat`): `resolverCli` cobre,
  mas o `--json` do `status`/`history` só existe nas versões recentes; se o comando sair
  com erro de argumento, mostrar "atualize o Git AutoSync" em vez de erro genérico.
- **Dois HUBs, um autosync**: `sankhya-hub` e `hub-snk` instalados na mesma máquina
  compartilham `~/.git-autosync`. Não há conflito de arquivo (trava de arquivo do CLI), mas
  a desinstalação de um remove o autosync do outro se o marcador `instalado-pelo-hub.txt`
  for dele. Documentar.
- **Commit automático de repo de cliente**: o autosync faz `git add -A` de tudo que não
  está no `.gitignore`. Um repositório de cliente sem `.gitignore` decente vai subir
  build e log. A política `exclude` e o limite de tamanho protegem em parte; a tela deve
  sugerir revisar a política ao adicionar em lote.
