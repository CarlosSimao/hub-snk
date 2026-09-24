# Manutenção

Notas de quem mantém o HUB SNK. Para usar o programa, veja o
[README](../README.md).

## Modo de desenvolvimento

```bash
npm install
npm --prefix desktop install
node desktop/node_modules/electron/install.js   # veja a nota abaixo

npm run app      # compila o shell e abre o aplicativo, que sobe o backend
```

Para mexer no backend com recarga automática, suba-o sozinho e deixe o aplicativo
usar esse backend em vez de subir o dele:

```bash
npm run dev                                   # uma janela: backend com --watch
SANKHYA_HUB_BACKEND=externo npm run app       # outra: o shell, sem subir backend
```

Não há etapa de build no backend: a partir do Node 22.18 os arquivos `.ts` rodam
direto. O shell é compilado pelo `tsc` do `desktop/` a cada `npm run app`.

> O npm 11 bloqueia scripts de instalação por padrão, e o `postinstall` do
> `electron` é o que baixa o binário. O `desktop/package.json` já libera o
> `electron` no `allowScripts`, mas se o `desktop/node_modules/electron/dist` não
> existir depois do `npm install`, rode o `install.js` acima.

Em desenvolvimento o shell se chama "HUB SNK (desenvolvimento)": perfil, cofre,
cookies e trava de instância única são outros, e ele não se mistura com o HUB
SNK instalado. As portas, porém, são as mesmas. Com o instalado aberto, suba o de
desenvolvimento em outras portas e com uma pasta de dados separada:

```powershell
$env:SANKHYA_HUB_URL = 'http://127.0.0.1:4199'
$env:SANKHYA_DESKTOP_BRIDGE_PORT = '4193'
$env:HUB_DADOS_DIR = "$env:TEMP\hub-snk-dev"
npm run app
```

Sem o aplicativo aberto, as rotas que dependem dele (credenciais, guias do
Sankhya, agenda) respondem `503` com `shellIndisponivel`; o resto do painel
funciona no navegador, em `http://127.0.0.1:4100`.

Use uma pasta de dados separada, para não mexer no cadastro de verdade:

```bash
# Windows (PowerShell)
$env:HUB_DADOS_DIR = "$env:TEMP\hub-snk-dev"; npm run dev

# Linux / macOS
HUB_DADOS_DIR=/tmp/hub-snk-dev npm run dev
```

## Antes de commitar

```bash
npm run typecheck
npm test
npm run formatar
```

É o que o CI roda em cada push e pull request, no Linux, no Windows e no macOS,
nas versões 22.18 e 24 do Node. O `typecheck` existe porque o Node apaga os tipos
sem conferi-los: sem ele, erro de tipo só apareceria rodando.

A formatação é do Prettier, configurado no `.prettierrc.json`. O
`npm run conferir-formato` só aponta; o `npm run formatar` corrige.

Esses três comandos não cobrem o aplicativo desktop. Para ele o CI tem o job
`desktop`, no Windows: compila o shell, monta o backend do pacote com o
`preparar-hub.mjs`, sobe esse backend no Node do Electron e espera o
`/api/healthz`, confere a sintaxe do `remover-versao-pwa.ps1` no Windows
PowerShell 5.1 e monta a pasta do aplicativo com o `electron-builder --dir`.

O que nenhum job cobre, e precisa ser testado à mão antes de uma release: o
instalador NSIS de ponta a ponta (instalar, a página do Git AutoSync, instalar
por cima de uma versão anterior e desinstalar). O roteiro, com o que foi
validado na migração, está em [plano-migracao-electron.md](plano-migracao-electron.md).

## Padrões do código

- **Tudo em português**: nomes de variáveis, funções, classes, arquivos,
  comentários e mensagens de commit. Termos técnicos consagrados ficam como são
  (`cache`, `commit`, `host`).
- **Comentário explica o porquê, nunca o quê.** Se o código precisa de comentário
  para dizer o que faz, o problema é o código.
- **Sem framework no `public/`**: a interface é HTML, CSS e JavaScript com
  módulos ES. O DOM é montado com `createElement`/`textContent`, nunca com
  concatenação de HTML — dado digitado pelo usuário não pode virar markup.
- **Toda entrada da API é validada com Zod** na camada de rotas, antes de chegar
  ao repositório.
- **Nada de executar comando por shell** com dado vindo da requisição. Caminhos e
  argumentos vão como argumentos separados do processo, e sempre saem do que está
  gravado em disco — a requisição manda o id, nunca o caminho.

O mapa dos arquivos está em [estrutura-do-codigo.md](estrutura-do-codigo.md).

## Mensagens de commit

[Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/), em
português:

```
feat(atalhos): permite reordenar a lista arrastando

O cadastro cresce rápido e o atalho mais usado acabava no fim.
```

Prefixos em uso: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`.

## Regra de versão

O número da versão diz o que esperar de uma atualização:

| Parte               | Sobe quando                                                                  | Exemplo                                           |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------- |
| **MAJOR** — `2`.0.0 | O formato dos arquivos de dados muda, ou a atualização exige alguma ação sua | Uma variável de ambiente passa a ser obrigatória  |
| **MINOR** — 1.`3`.0 | Entra funcionalidade nova e o cadastro continua compatível                   | Um tipo de atalho novo                            |
| **PATCH** — 1.2.`4` | Correção de comportamento, sem nada novo                                     | A situação do Git deixa de errar o nome da branch |

Toda mudança visível fica registrada no [CHANGELOG](../CHANGELOG.md).

## Publicando uma versão

Nada entra na `main` por push direto — nem código, nem release. Toda mudança
passa por branch e pull request, e a tag nasce depois do merge.

1. Merge do que vai na versão. Cada funcionalidade ou correção entra por seu
   próprio pull request, com o CI verde.

2. Da `main` atualizada, abra a branch da release:

   ```bash
   git checkout main && git pull --ff-only
   git checkout -b chore/release-v1.2.0
   ```

3. Mova o conteúdo de `## [Não publicado]` do `CHANGELOG.md` para uma seção com o
   número e a data da versão, e atualize os links do rodapé do arquivo.

4. Suba o número na raiz **e** no `desktop/`, sem deixar o npm criar commit nem
   tag. O instalador leva a versão do `desktop/package.json`, e o workflow de
   distribuição recusa a tag se as duas não baterem com ela:

   ```bash
   npm version minor --no-git-tag-version
   npm --prefix desktop version minor --no-git-tag-version
   # ou patch, ou major
   ```

5. Commite, abra o pull request e mergeie com o CI verde:

   ```bash
   git commit -am "chore(release): v1.2.0"
   git push -u origin chore/release-v1.2.0
   gh pr create --base main --title "chore(release): v1.2.0" --fill
   ```

6. Só então marque a versão, na `main` já mergeada:

   ```bash
   git checkout main && git pull --ff-only
   git tag -a v1.2.0 -m "v1.2.0"
   git push origin v1.2.0
   ```

A tag é criada depois do merge de propósito. Criada na branch, ela apontaria para
um commit que o merge deixa fora da `main` — a release sairia de um código que
não é o publicado.

A tag dispara o workflow `Distribuição`, que gera os binários do Git AutoSync (do
repositório `FlavianoRS/git-autosync`, branch `master`), monta o instalador
`HUB-SNK-Setup-<versão>.exe`, cria a release se ela ainda não existir e o anexa.
Não é preciso rodar `gh release create` à mão.

Para gerar o instalador na sua máquina: `npm run empacotar-desktop`, com o
repositório do Git AutoSync em `C:\Workspace\scripts\git-autosync` (ou apontado
por `GIT_AUTOSYNC_DIR`) e os binários dele já gerados pelo
`python\build_windows.ps1`. Sem o Git AutoSync, use
`npm --prefix desktop run empacotar:sem-autosync`. O resultado sai em `release/`.

O aviso de atualização dentro do programa vem da release do GitHub, lida por
`src/sistema/ultimaVersaoPublicada.ts`. Enquanto a tag não sobe, quem já usa o
HUB SNK não fica sabendo que existe versão nova — daí a versão andar a cada
entrega, e não de vez em quando.

Mudança incompatível no formato dos arquivos de dados é release MAJOR, e exige
subir a versão do esquema junto — o procedimento está em
[formato-dos-dados.md](formato-dos-dados.md#versão-do-esquema).
