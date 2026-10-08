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

```powershell
npm run dev                                          # uma janela: backend com --watch
$env:SANKHYA_HUB_BACKEND = 'externo'; npm run app    # outra: o shell, sem subir backend
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

Variáveis internas, raramente necessárias: no shell, `SANKHYA_HUB_IPC_DIR` troca a
pasta do `desktop-token.txt` (padrão `%APPDATA%\sankhya-hub\ipc`) e
`SANKHYA_HUB_RAIZ` troca a pasta do backend que ele sobe (padrão: a raiz do
repositório em desenvolvimento, `resources\hub` no instalado); no backend,
`SANKHYA_DESKTOP_BRIDGE_URL` e `DESKTOP_BRIDGE_TOKEN_FILE` dizem onde está a ponte e
o token dela — o shell passa as duas ao backend que sobe, e só o `npm run dev` com
o shell fora do padrão precisa defini-las à mão.

Sem o aplicativo aberto, a API exige o token que só ele entrega ao painel. Para
usar o painel no navegador, em `http://127.0.0.1:4100`, suba o backend com
`HUB_SEM_TOKEN=1`. As rotas que dependem do aplicativo (credenciais, guias do
Sankhya, agenda) respondem `503` com `shellIndisponivel`.

Use uma pasta de dados separada, para não mexer no cadastro de verdade:

```powershell
$env:HUB_DADOS_DIR = "$env:TEMP\hub-snk-dev"; $env:HUB_SEM_TOKEN = '1'; npm run dev
```

## Antes de commitar

```bash
npm run typecheck
npm test
npm run formatar
```

É o que o job `verificar` do CI roda em cada pull request e em cada push na `main`,
no Linux, no Windows e no macOS, nas versões 22.18 e 24 do Node. A matriz é do
backend, que em desenvolvimento roda com o Node do sistema; não é promessa de
aplicativo fora do Windows, o único sistema para o qual ele é distribuído. O
`typecheck` existe porque o Node apaga os tipos sem conferi-los: sem ele, erro de
tipo só apareceria rodando.

A formatação é do Prettier, configurado no `.prettierrc.json`. O
`npm run conferir-formato` só aponta; o `npm run formatar` corrige.

Esses três comandos não cobrem o aplicativo desktop. Para ele o CI tem o job
`desktop`, no Windows: compila o shell, monta o backend do pacote com o
`preparar-hub.mjs`, sobe esse backend no Node do Electron e espera o
`/api/healthz`, confere a sintaxe do `remover-versao-pwa.ps1` no Windows
PowerShell 5.1 e monta a pasta do aplicativo com o `electron-builder --dir`.

O que nenhum job cobre, e precisa ser testado à mão antes de uma release: o
instalador NSIS de ponta a ponta e o aplicativo instalado, logado no Sankhya de
verdade. O passo a passo está em
[Roteiro de teste de release](#roteiro-de-teste-de-release).

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

**O projeto fica na linha `2.x.x`.** A parte MAJOR só sobe quando o dono pedir, de forma
explícita, a passagem para a versão 3. Até lá, nenhuma mudança vira release `3.0.0`, nem
mesmo uma que a tabela acima classificaria como MAJOR. Se uma mudança assim aparecer,
pare e pergunte ao dono antes de subir o número. Dentro da `2.x.x`, prefira agrupar
funcionalidades pequenas numa mesma versão MINOR em vez de publicar uma versão para cada
uma, e use PATCH só para correção.

Tag com hífen — `v2.1.0-beta.1` — é versão de teste: o workflow `Distribuição` a
publica como pre-release, que o aviso de versão nova do Painel e a atualização
automática ignoram. Serve para distribuir o instalador a quem vai testar sem que ele
chegue a mais ninguém; a versão definitiva sai depois com a tag sem hífen.

Toda mudança visível fica registrada no [CHANGELOG](../CHANGELOG.md).

## Roteiro de teste de release

Feito no Windows, com o instalador gerado na sua máquina (`npm run
empacotar-desktop`, veja [Publicando uma versão](#publicando-uma-versão)), antes
de abrir o pull request da release. Use uma cópia do cadastro, ou confira o
SHA-256 do `clientes.json` antes e depois: parte do roteiro instala por cima do
que já existe.

### Instalador

- **Instalação limpa**, num usuário sem HUB SNK: instala sem pedir administrador
  em `%LOCALAPPDATA%\Programs\HUB SNK`, cria os atalhos "HUB SNK" no menu
  Iniciar e na área de trabalho e abre o aplicativo no fim.
- **Página de perfil**: o perfil escolhido vai para
  `%LOCALAPPDATA%\HubSnk\perfil-inicial.txt`, e a caixa Terceiro, para o
  `terceiro-inicial.txt`. Na primeira abertura, **Configurações › Acessos** mostra
  o preset do perfil, e com Terceiro marcado somem Credenciais Sankhya, Agenda, OS
  e as guias SankhyaOm e Experience.
- **Reinstalação**: a página de perfil abre com a escolha anterior marcada, e o
  que foi ajustado na aba Acessos não é desfeito.
- **Página do Git AutoSync**: com as opções marcadas, ele fica em
  `%USERPROFILE%\.git-autosync`, com a tarefa diária, o ícone na bandeja, os
  atalhos, a skill e a entrada no PATH, e a marca
  `%LOCALAPPDATA%\HubSnk\git-autosync-instalado-pelo-hub.txt` é criada. Numa máquina
  sem Git, o HUB SNK instala do mesmo jeito e só o Git AutoSync fica de fora.
- **Por cima da versão anterior**: o cadastro continua o mesmo (mesmo SHA-256), e
  os atalhos apontam para o `HUB SNK.exe` novo.
- **Por cima da versão 1 (PWA)**, enquanto houver quem a use: o
  `%LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log` registra o que foi removido,
  nenhum `node.exe` antigo sobra, o que não era do pacote vai para
  `restos-da-versao-pwa-<data>` e a pasta de dados fica intacta.
- **Desinstalação**: pergunta se o Git AutoSync sai junto só quando ele foi
  instalado pelo HUB SNK, e preserva `%LOCALAPPDATA%\HubSnk\dados` e
  `%APPDATA%\HUB SNK`.

### Aplicativo

- Abre em instância única: uma segunda execução foca a janela que já está aberta.
  O primeiro boot depois de instalar pode levar alguns segundos a mais, pela
  varredura do antivírus.
- O cadastro existente aparece, e criar, editar e remover funcionam em clientes,
  bases, repositórios, links, projetos, contatos e lembretes.
- Com credencial salva, as guias SankhyaOm e Experience logam sozinhas, e a
  sessão continua depois de reiniciar o aplicativo. A janela de Credenciais
  Sankhya mostra a senha salva.
- A Agenda de Recursos e as negociações (FAP) do parceiro chegam pela janela
  oculta, com o login de verdade no ERP, e a aba OS lista as OS da Experience.
- A guia de uma base de cliente preenche o usuário, avança para a senha e entra
  sozinha.
- Bases e bancos locais (WildFly e Docker) ligam, param e mostram o log ao vivo.
- Os botões de abrir pasta, terminal e IDE e os atalhos cadastrados abrem o
  programa certo.
- A busca rápida abre pelo `Ctrl+K` em qualquer guia e pelo `Ctrl+Shift+Espaço` com
  outro programa em foco, e o `Enter` abre cliente, base, repositório e atalho.
- O `Ctrl+F` abre a barra no canto da guia ativa no Painel, no SankhyaOm (inclusive
  numa tela dentro de frame) e numa base de cliente; `Enter` e `Shift+Enter` andam
  pelas ocorrências, `Esc` fecha, e trocar de guia fecha a barra.
- Git AutoSync, com um repositório de teste com remoto: a aba **Git AutoSync** do menu mostra a
  versão e a tarefa do Agendador; salvar um horário muda a tarefa; **Adicionar ao Git
  AutoSync** na aba Git do cliente muda o `targets` do
  `%USERPROFILE%\.git-autosync\config.json`; **Sincronizar** faz commit e push de
  verdade; o histórico e o log aparecem. Um push rejeitado (commit novo no remoto)
  mostra o bloco **Como resolver**, e **Abrir terminal na pasta** abre o terminal ali.
  Com o Git AutoSync desinstalado, a aba oferece **Instalar**, e ele sobe pelo pacote.
- A engrenagem da aba **Git AutoSync** grava o host e o token do GitLab em
  `GIT_AUTOSYNC_GITLAB_HOST` e `GIT_AUTOSYNC_GITLAB_TOKEN` do usuário, e o token não
  aparece de volta na tela.
- O e-mail de teste do SMTP chega, e um lembrete marcado para dali a um minuto
  dispara a notificação.
- Com uma release mais nova publicada no GitHub, o aviso de atualização aparece.
- A atualização automática, testada na VM contra um servidor local (veja
  [Testando a atualização automática](#testando-a-atualização-automática)): a
  versão nova baixa sozinha, a notificação e **Ajuda › Reiniciar para atualizar**
  aparecem, e depois de reiniciar o cadastro, o perfil e o login continuam lá.
- Ao fechar o aplicativo, o backend encerra: nenhum `HUB SNK.exe` sobra no
  Gerenciador de Tarefas, e o `sankhya.db` fica sem `-wal` na pasta de dados.
- O `backend.log` e o `desktop.log`, em `%APPDATA%\HUB SNK\log`, não trazem erro
  nem senha, token ou cookie em texto puro.
- Em Configurações › Sobre, **Reportar problema ou sugerir** abre o diálogo; **Ver o
  que será enviado** mostra os dados técnicos e o log sem token, senha, e-mail nem o
  nome da conta do Windows; **Enviar** responde "Relato enviado". Com a rede
  desligada, a resposta é que o relato ficou guardado, e ele sai na abertura seguinte.

### Testando a atualização automática

A atualização automática lê o `latest.yml` da release mais recente, e testar contra o
GitHub seria publicar uma versão. Em vez disso, gere duas versões de teste apontando
para um servidor HTTP na sua máquina, sem commitar nada disso:

1. Copie o `desktop/electron-builder.yml` para um arquivo temporário e troque o
   `publish` por `provider: generic` com `url: http://<IP>:8765/`, onde `<IP>` é o
   do adaptador `vEthernet (Default Switch)` da sua máquina.
2. Gere as duas versões com esse arquivo, mudando só a versão:

   ```bash
   npx electron-builder --config <arquivo temporário> --publish never \
     -c.extraMetadata.version=2.0.1 -c.directories.output=../release/teste-atualizacao/2.0.1
   ```

   e de novo com `2.0.2`.

3. Sirva a pasta da `2.0.2` nesse IP e porta (um servidor estático qualquer), instale a
   `2.0.1` na VM e abra o HUB SNK. Uns 30 segundos depois ele baixa a `2.0.2`, avisa
   por notificação e oferece **Ajuda › Reiniciar para atualizar**.

Para testar também a migração da marca do Git AutoSync, instale antes a última versão
oficial com o Git AutoSync marcado e rode a `2.0.1` por cima com ele desmarcado: a marca
tem de aparecer em `%LOCALAPPDATA%\HubSnk\git-autosync-instalado-pelo-hub.txt`, e a
desinstalação no fim tem de perguntar se remove o Git AutoSync.

## Credencial do Google Drive

A conexão com o Google Drive usa uma credencial OAuth do projeto no Google Cloud, que
viaja no instalador mas **não está no repositório**: ele é público, e o GitHub recusa o
push de um commit com a chave. Sem a credencial a janela de Backup diz que a integração
não está configurada, e o resto do HUB SNK funciona normalmente. Para criar:

1. Em <https://console.cloud.google.com>, crie um projeto e ative a **Google Drive API**.
2. Em **Google Auth Platform**, configure a tela de consentimento como **Externo**, com o
   nome do aplicativo e o e-mail de suporte, e adicione o escopo
   `.../auth/drive.file`, e só ele.
3. Em **Clientes**, crie um cliente OAuth do tipo **App para computador**.
4. Guarde o ID e a chave secreta (a chave só aparece na criação). Nesse tipo de cliente o
   Google não trata a chave como segredo, e o que protege a autorização é o PKCE e o
   consentimento do usuário — mas ela fica fora do Git e entra no instalador:

   - **No instalador publicado**: cadastre os secrets `GOOGLE_CLIENT_ID` e
     `GOOGLE_CLIENT_SECRET` no repositório (_Settings › Secrets and variables › Actions_).
     O workflow `Distribuição` os passa ao `npm run empacotar-desktop`, e o
     `preparar-hub.mjs` os grava em `credencial-google.json` dentro de `resources/hub`.
     Na tag de versão, secret faltando **falha o job**: o instalador não sai sem o Drive.
   - **Na sua máquina**: crie o `credencial-google.json` na raiz do repositório, que o
     `.gitignore` ignora, com `{ "clientId": "...", "clientSecret": "..." }`. Serve ao
     `npm run app` e a um `npm run empacotar-desktop` local.

   Para testar com outra credencial sem mexer em arquivo, defina `HUB_GOOGLE_CLIENT_ID` e
   `HUB_GOOGLE_CLIENT_SECRET` antes de abrir o aplicativo: elas vencem o arquivo.

Se a chave vazar para onde não devia, ou precisar ser trocada, gere uma chave nova no
cliente OAuth do Google Cloud e atualize os secrets: os HUB SNK já instalados só voltam a
conectar depois de atualizar, porque a chave antiga está dentro do instalador deles.

O `drive.file` é um escopo **não sensível**: o aplicativo pode ficar **em produção** sem
verificação do Google, sem o aviso "O Google não verificou este app" e sem o teto de 100
contas. Com a tela de consentimento em **Teste**, só entram contas cadastradas como
usuários de teste, e a autorização vence em 7 dias: serve só para desenvolver.

**Não acrescente escopo de leitura do Drive** (`drive.readonly`, `drive.metadata.readonly`
e parecidos): são restritos, e trazem de volta o aviso, o teto e a exigência de verificação
com avaliação de segurança anual. Listar o conteúdo de pastas que o HUB SNK não criou
exige um deles.

Todo o fluxo roda contra dublês nos testes (`src/drive/*.test.ts`). Com a credencial
criada, teste à mão: conectar, enviar a cópia, restaurar e desconectar.

## Relato de problema

Configurações › Sobre › **Reportar problema ou sugerir** envia o relato ao suporte do
mantenedor (`src/suporte/`, `src/rotas/rotasSuporte.ts`, `public/js/relatoDeProblema.js`).
É o único ponto do aplicativo que manda dado do usuário para fora da máquina.

A cópia no Google Drive, quando ligada, manda os dados para a conta do próprio usuário,
e não para o mantenedor.

O que segue no relato, e só quando o usuário clica em Enviar:

| Dado                            | Observação                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tipo e texto                    | O que ele escreveu.                                                                                                              |
| E-mail                          | Só se ele preencher.                                                                                                             |
| Dados técnicos                  | Versão do HUB SNK, do Windows, arquitetura e perfil.                                                                             |
| Nome, empresa e time            | Obrigatórios, preenchidos em Configurações › Geral. Seguem em `context` (`usuario`, `empresa`, `time`) e na prévia.              |
| Identificador da instalação     | UUID aleatório, criado no primeiro relato em `%APPDATA%\HUB SNK\suporte`. Sozinho, não identifica a pessoa; nunca viaja sozinho. |
| Log de diagnóstico (se marcado) | Os últimos 512 KB do `desktop.log` e do `backend.log`, mascarados e compactados.                                                 |

O envio exige os três campos de identificação: sem nome, empresa ou time em
Configurações, a tela e a rota `POST /api/suporte/relatos` recusam o relato (`400`) e
dizem quais faltam. O relato, portanto, **identifica quem o enviou**; o mascaramento
abaixo vale só para o log.

O mascaramento (`src/suporte/mascaramento.ts`) roda na coleta, sobre os dois arquivos, e
tira token, JWT, senha, cabeçalho de autorização, e-mail e o nome da conta do Windows
nos caminhos. **Nome de cliente e de servidor não são mascarados** — não há como
reconhecê-los —, e a tela avisa isso antes do envio.

Sem rede, o relato fica em `%APPDATA%\HUB SNK\suporte\relatos-pendentes` e é reenviado na
abertura seguinte, com o mesmo identificador, então não é registrado duas vezes. O
suporte limita os envios por instalação e por IP.

O endereço de destino é fixo no código (`src/configuracao.ts`). `HUB_ENDERECO_DO_SUPORTE`
troca o destino para testar sem enviar nada de verdade.

Os dois logs passam a ser **rotacionados** na abertura do aplicativo: acima de 5 MB o
arquivo vira `.1` (até `.3`) e um novo começa.

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

5. Gere o instalador com o número novo e passe pelo
   [roteiro de teste de release](#roteiro-de-teste-de-release). Depois, commite,
   abra o pull request e mergeie com o CI verde:

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

A tag dispara o workflow `Distribuição`, que monta o instalador
`HUB-SNK-Setup-<versão>.exe`, cria a release se ela ainda não existir e o anexa.
Não é preciso rodar `gh release create` à mão. Tag com hífen sai como pre-release (veja
[Regra de versão](#regra-de-versão)); a release que já existia antes da tag mantém o
que estiver marcado nela.

Para gerar o instalador na sua máquina: `npm run empacotar-desktop`. O Git AutoSync
não entra no pacote (veja [Distribuição](distribuicao.md#o-git-autosync)). O resultado
sai em `release/`.

O `latest.yml` e o `.blockmap` sobem para a release junto do instalador: é o que
a atualização automática do aplicativo (`desktop/src/atualizacao.ts`) lê. Release
sem eles não chega a quem já tem o HUB SNK instalado, só o aviso do Painel.

O aviso de atualização dentro do programa vem da release do GitHub, lida por
`src/sistema/versao/ultimaVersaoPublicada.ts`. Enquanto a tag não sobe, quem já usa o
HUB SNK não fica sabendo que existe versão nova — daí a versão andar a cada
entrega, e não de vez em quando.

Mudança incompatível no formato dos arquivos de dados seria release MAJOR, mas o projeto
fica na `2.x.x` até o dono pedir a versão 3 (veja [Regra de versão](#regra-de-versão)); ela
também exige subir a versão do esquema junto — o procedimento está em
[formato-dos-dados.md](formato-dos-dados.md#versão-do-esquema).
