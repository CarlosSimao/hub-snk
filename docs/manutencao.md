# Manutenção

Notas de quem mantém o HUB SNK. Para usar o programa, veja o
[README](../README.md).

## Modo de desenvolvimento

```bash
npm install
npm run dev      # reinicia o servidor a cada alteração
```

Não há etapa de build: a partir do Node 22.18 os arquivos `.ts` rodam direto.

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

Esses três comandos não cobrem tudo. Os testes são de funções puras e não
encostam nos scripts de instalação nem no que muda de sistema para sistema — por
isso o CI tem mais dois jobs, que nenhum comando local reproduz:

| Job               | O que faz                                                                     |
| ----------------- | ----------------------------------------------------------------------------- |
| `empacotamento`   | Gera os ícones e os pacotes, e confere que os `.sh` saem executáveis do `tar` |
| `instalacao-unix` | Instala, sobe, para e desinstala de verdade, no Ubuntu e no macOS             |

O `instalacao-unix` é a rede que faltava: o atalho e o início na sessão são a
parte que muda entre Linux e macOS, e já estiveram quebrados no macOS sem
ninguém perceber. Ele confere o `.desktop` de um lado, o `.app` e o LaunchAgent
do outro, e roda `sh -n` nos scripts — no dash do Ubuntu e no bash do macOS, que
é como bashismo acidental aparece.

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

4. Suba o número, sem deixar o npm criar commit nem tag:

   ```bash
   npm version minor --no-git-tag-version
   # ou patch, ou major
   ```

   O hook `version` sincroniza o nome do cache do service worker junto. Confira
   que o `public/sw.js` mudou — sem isso a atualização não chega ao navegador de
   quem já usa.

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

A tag dispara o workflow `Distribuição`, que monta os pacotes dos três sistemas,
cria a release se ela ainda não existir e anexa tudo. Não é preciso rodar
`gh release create` à mão.

O aviso de atualização dentro do programa vem da release do GitHub, lida por
`src/sistema/ultimaVersaoPublicada.ts`. Enquanto a tag não sobe, quem já usa o
HUB SNK não fica sabendo que existe versão nova — daí a versão andar a cada
entrega, e não de vez em quando.

Mudança incompatível no formato dos arquivos de dados é release MAJOR, e exige
subir a versão do esquema junto — o procedimento está em
[formato-dos-dados.md](formato-dos-dados.md#versão-do-esquema).

O nome do cache do service worker só é sincronizado no `npm version`. Entre
releases, quem acompanha a branch pelo `git pull` pode continuar vendo o shell
antigo na janela instalada — recarregue com o cache desabilitado, ou use o
navegador comum durante o desenvolvimento.
