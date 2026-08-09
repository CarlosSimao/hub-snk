# Como contribuir

Obrigado por olhar o código. Este é um projeto pequeno, mantido por uma pessoa
só — o que vale aqui é o combinado abaixo, não cerimônia.

## Antes de escrever código

Para correção pequena e óbvia, mande o pull request direto.

Para funcionalidade nova ou mudança de comportamento,
[abra uma issue](https://github.com/CarlosSimao/hub-snk/issues/new/choose) antes.
É mais rápido alinhar em três frases do que descobrir na revisão que a ideia não
cabe no projeto.

## Rodando localmente

```bash
npm install
npm run dev      # reinicia o servidor a cada alteração
```

Não há etapa de build: a partir do Node 22.18 os arquivos `.ts` rodam direto.

Use uma pasta de dados separada enquanto desenvolve, para não mexer no seu
cadastro de verdade:

```bash
# Windows (PowerShell)
$env:HUB_DADOS_DIR = "$env:TEMP\hub-snk-dev"; npm run dev

# Linux / macOS
HUB_DADOS_DIR=/tmp/hub-snk-dev npm run dev
```

## Antes de abrir o pull request

```bash
npm run typecheck
npm test
```

Os dois precisam passar. O `typecheck` existe porque o Node apaga os tipos sem
conferi-los — sem ele, erro de tipo só apareceria em produção.

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

Veja a [estrutura do código](docs/estrutura-do-codigo.md) para o mapa dos
arquivos.

## Mensagens de commit

[Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/), em
português:

```
feat(atalhos): permite reordenar a lista arrastando

O cadastro cresce rápido e o atalho mais usado acabava no fim.
```

Prefixos em uso: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`.

## Mudando o formato dos dados

Se a sua mudança altera o que é gravado em `clientes.json`, `configuracao.json`
ou `local.json` de forma incompatível:

1. Suba a `VERSAO_ATUAL_DO_ESQUEMA` em `src/repositorio/arquivoDeDados.ts`.
2. Escreva a conversão da versão anterior para a nova, na leitura do repositório
   correspondente.
3. Confira que a cópia de segurança é gerada antes da regravação.
4. A release passa a ser MAJOR.

Detalhes em [docs/formato-dos-dados.md](docs/formato-dos-dados.md).

## Publicando uma versão

Para quem mantém o projeto.

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

O nome do cache do service worker só é sincronizado no `npm version`. Entre
releases, quem acompanha a branch pelo `git pull` pode continuar vendo o shell
antigo na janela instalada — recarregue com o cache desabilitado, ou use o
navegador comum durante o desenvolvimento.
