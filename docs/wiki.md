# Wiki do site

A wiki (`site/wiki/`) explica cada funcionalidade do HUB SNK passo a passo, com prints. É
publicada junto da página do projeto, em https://carlossimao.github.io/hub-snk/wiki/.

## Como ela é organizada

- **Uma página por macro funcionalidade** (`clientes.html`, `bases.html`...). A lista das
  páginas, na ordem do menu, fica em `site/wiki/wiki.js` (`PAGINAS`); página ainda não
  escrita fica com `pronta: false` e aparece no menu sem link.
- **Uma seção por micro funcionalidade**, com `id` próprio (a âncora dos links), e sempre as
  mesmas partes: o que faz, **Passo a passo** (com um print por passo), **Configurações que
  dependem ou alteram** (com link para `configuracoes.html#<aba>-<campo>`) e **Depende de**
  (com link para a funcionalidade citada, mesmo em outra página).
- **Tema claro/escuro** escolhido no botão do topo, o mesmo do site (`site/tema.js`). Cada
  print existe nos dois temas: o HTML aponta para `nome.webp` (escuro) e o `wiki.js` troca
  por `nome-claro.webp` no tema claro.
- **Dados fictícios** em todos os prints: nomes, endereços (`.example`), mensagens.

## Onde ficam os prints

Nenhum print fica na `main` (`site/wiki/img/` está no `.gitignore`). Na publicação, o
workflow `.github/workflows/site.yml` junta dois lugares:

| Origem                     | O que tem                                                                                                     | Quem atualiza                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **Capturador**, no Actions | Os prints do próprio HUB SNK, gerados a cada publicação rodando o aplicativo de verdade sobre dados fictícios | Sozinho: mudou a tela, o print acompanha       |
| **Branch órfã `wiki-img`** | Os prints de telas de terceiros (SankhyaOm, Experience, login do WhatsApp e do Google)                        | À mão, com sessão real e revisão antes do push |

A `wiki-img` tem um commit só, sobrescrito a cada atualização (`push --force`): o histórico
não cresce, por mais que os prints mudem.

## Capturador (`ferramentas/captura-wiki`)

Sobe o HUB SNK desktop isolado do instalado (perfil, pasta de dados, portas 4120/4123 e IPC
próprios) e roda cada roteiro (`roteiros/<macro>.mjs`) num aplicativo novo, uma vez em cada
tema, sempre a partir dos mesmos dados fictícios (`preparar-dados.mjs`; os repositórios Git
ficam em `C:\Workspace-demo`, para o caminho na tela não trazer o nome do usuário). Cada
roteiro clica pela tela e chama `print(nome, { destacando })`; o contorno laranja marca o
que o passo manda clicar.

- **Dados só de uma página:** o roteiro exporta `semear(pastaDeDados)`, que grava os
  arquivos extras (lembretes, kanban, base local...) antes de o aplicativo abrir.
- **O que viria de fora** (SankhyaOm, Experience, Docker, WildFly, Git AutoSync, Google
  Drive, assistentes de IA, versão nova no GitHub) é respondido por rota
  (`painel.route('**/api/...')`), no formato que o código espera. Nada é enviado de verdade:
  nem e-mail, nem relato ao suporte, nem push.
- **Painel da barra de comunicação:** o WhatsApp Web e o Google (Gmail, Chat, Agenda, Meet)
  são respondidos, nas partições deles, pelas telas fictícias de `comunicacao-ficticia.html`
  (`servirComunicacaoFicticia(aplicativo)`, de `comunicacao-ficticia.mjs`), com contagem de
  não lidas para acender os botões. A página diz que essas telas são ilustrações.
- **Bandeja, aviso do Windows e barra de tarefas:** `printDoSistema(nome, { cena, ... })`
  renderiza uma área de trabalho fictícia do Windows 11 (`sistema-ficticio.html`), no tema da
  captura, com o ícone, o menu da bandeja ou o aviso do HUB SNK e o contorno no que o passo
  pede. As cenas estão no comentário do topo do arquivo.
- **As outras telas de terceiros e as do sistema** (SankhyaOm, Experience, login do WhatsApp
  e do Google, Explorador, seletor de arquivo, instalador...) não são capturadas: o passo fica sem print e com o comentário `<!-- print-pendente: ... -->` no
  HTML, para a fase da `wiki-img`.
- **Várias capturas ao mesmo tempo:** `CAPTURA_INSTANCIA=<n>` separa portas e pastas
  (`4120 + 10n`). A 7 não serve: cai na porta 4190, que o Chromium bloqueia.

```bash
cd ferramentas/captura-wiki
npm install
node capturar.mjs            # todas as páginas
node capturar.mjs clientes   # só uma
node verificar-links.mjs     # links, âncoras e prints quebrados
```

Precisa do binário do Electron (`node desktop/node_modules/electron/install.js`) e do
desktop compilado (`npm --prefix desktop run build`).

## Ver localmente

```bash
git fetch origin wiki-img && git archive FETCH_HEAD | tar -x -C site/wiki/img
mkdir -p site/img && cp desktop/assets/hub-snk.png site/img/icone.png
npx http-server site -c-1
```

E abrir `http://127.0.0.1:8080/wiki/`.

## Atualizar os prints de terceiros

1. Gerar os prints com a sessão real e os dados trocados no DOM, e **revisar cada um**: o
   repositório é público, e um nome real que escapar fica publicado.
2. Juntar numa pasta, no mesmo formato de `site/wiki/img` (`<macro>/<nome>.webp` e
   `<macro>/<nome>-claro.webp`), **com todos os prints de terceiros**, não só os novos: o
   commit substitui a branch inteira. Para partir do que já está publicado, extrair antes
   com `git archive origin/wiki-img`.
3. Sobrescrever a branch:

   ```bash
   git worktree add --detach ../wiki-img
   cd ../wiki-img
   git checkout --orphan wiki-img-nova
   git rm -rf .
   # copiar a pasta do passo 2 para cá
   git add .
   git commit -m "docs(wiki): prints de terceiros"
   git push --force origin wiki-img-nova:wiki-img
   cd -
   git worktree remove --force ../wiki-img
   ```

4. Republicar o site (Actions › Site › Run workflow), para a wiki pegar os prints novos.

## Ao publicar uma versão nova

O site é republicado sozinho quando a `main` recebe mudança em `site/`, `public/`,
`desktop/` ou no capturador, e os prints do HUB SNK saem da tela da versão nova. O que fica
para fazer à mão, antes do PR da versão:

- **Mudou um botão, um rótulo ou um fluxo?** Ajustar o roteiro da página
  (`roteiros/<macro>.mjs`) e o texto da seção na wiki, e rodar `node capturar.mjs <macro>`
  para conferir. Roteiro quebrado derruba a publicação do site.
- **Funcionalidade nova?** Nova seção na página da macro (ou página nova, com `pronta: true`
  no `wiki.js`), com roteiro, configurações e dependências.
- **Mudou uma tela de terceiros** (SankhyaOm, Experience, WhatsApp, Google)? Atualizar a
  `wiki-img` (seção acima).
- Rodar `node verificar-links.mjs`.

## Teste do workflow

Push na branch `teste/wiki-ci` roda só a captura e deixa os prints no artefato
`prints-da-wiki` da execução, sem publicar nada. Quem publica é só a `main`.
