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

É o que o CI roda em cada push e pull request, no Linux e no Windows, nas
versões 22.18 e 24 do Node. O `typecheck` existe porque o Node apaga os tipos
sem conferi-los: sem ele, erro de tipo só apareceria rodando.

A formatação é do Prettier, configurado no `.prettierrc.json`. O
`npm run conferir-formato` só aponta; o `npm run formatar` corrige.

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

## Publicando uma versão

1. Mova o conteúdo de `## [Não publicado]` do `CHANGELOG.md` para uma seção com o
   número e a data da versão, e atualize os links do rodapé do arquivo.
2. Commite o CHANGELOG.
3. Rode o `npm version` correspondente. Ele sobe o `package.json`, sincroniza o
   nome do cache do service worker, cria o commit e a tag anotada:

   ```bash
   npm version patch -m "chore(release): v%s"
   # ou minor, ou major
   ```

4. Publique:

   ```bash
   git push --follow-tags
   gh release create v1.2.0 --title "v1.2.0" --notes-file NOTAS.md
   ```

Mudança incompatível no formato dos arquivos de dados é release MAJOR, e exige
subir a versão do esquema junto — o procedimento está em
[formato-dos-dados.md](formato-dos-dados.md#versão-do-esquema).

O nome do cache do service worker só é sincronizado no `npm version`. Entre
releases, quem acompanha a branch pelo `git pull` pode continuar vendo o shell
antigo na janela instalada — recarregue com o cache desabilitado, ou use o
navegador comum durante o desenvolvimento.
