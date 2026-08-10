# TODO — Publicação do HUB SNK

Checklist para publicar o projeto no GitHub (repositório público, licença aberta,
suporte via Issues) e mantê-lo de forma profissional.

Substitua `SEU_USUARIO` pelo seu usuário/organização do GitHub em todos os itens.

---

## 0. Bloqueantes — resolver antes do primeiro push

- [x] Revisar o `.gitignore` e confirmar que `dados-hub-snk/`, `*.log` e `.idea/` estão cobertos
- [x] Rodar `git init` e conferir `git status --porcelain` antes do primeiro commit
- [x] Confirmar que nenhum arquivo com dado real de cliente, host ou senha entra no commit inicial
- [x] Revisar o histórico do README e do código em busca de nomes de clientes, IPs, caminhos internos ou credenciais
- [x] Recusar host não-loopback por padrão: exigir uma confirmação explícita (ex.: `HUB_PERMITIR_REDE=1`) para aceitar `HUB_HOST` diferente de `127.0.0.1`
- [x] Validar os headers `Host` e `Origin` nas requisições (hook `onRequest` no Fastify), rejeitando origem que não seja o próprio loopback na porta configurada
- [x] Documentar no README que a aplicação executa binários e comandos do sistema, e o que isso implica ao expor o servidor na rede
- [x] Publicar o commit inicial (`git push -u origin main`)

## 1. Versionamento de dados (fazer antes de distribuir)

- [x] Adicionar `versaoDoEsquema` em `clientes.json`, `configuracao.json` e `local.json`
- [x] Implementar leitura da versão do esquema no boot, com erro claro quando for maior que a suportada
- [x] Gerar cópia de segurança (`<arquivo>.esquema<versao>`) antes de qualquer migração automática
- [x] Documentar a política de migração no README

## 2. Licença e metadados

- [x] Criar `LICENSE` (MIT) com ano e nome do autor
- [x] Adicionar `license`, `author`, `repository`, `bugs` e `homepage` ao `package.json`
- [x] Manter `"private": true` para impedir publicação acidental no npm
- [x] Definir descrição e tópicos (topics) do repositório no GitHub — aplicados: `pwa`, `fastify`, `nodejs`, `typescript`, `ferramenta-interna`

## 3. Atribuição e contato

### Na aplicação

- [x] Criar rota `GET /api/sistema/versao` devolvendo a versão do `package.json`
- [x] Habilitar `resolveJsonModule` no `tsconfig.json` (se optar por importar o `package.json`)
- [x] Adicionar rodapé em `public/index.html` com: nome do app, versão, autor e link "Reportar problema"
- [x] Estilizar o rodapé em `public/styles.css` de forma discreta
- [x] Preencher a versão do rodapé no boot do `public/app.js`, consumindo a rota nova

### No repositório

- [x] Adicionar seção "Suporte" no README com link do Issues, do Discussions e e-mail de contato
- [x] Adicionar seção "Autor" ou linha de crédito no final do README
- [x] Adicionar seção "Licença" no README apontando para o `LICENSE`

## 4. Versionamento e releases

- [x] Definir e documentar a regra de SemVer do projeto (o que caracteriza MAJOR, MINOR e PATCH aqui)
- [x] Subir a versão de `0.1.0` para `1.0.0` na primeira release pública
- [x] Criar `CHANGELOG.md` no padrão Keep a Changelog, em português, escrito para o usuário final
- [x] Adotar Conventional Commits nas mensagens de commit
- [x] Documentar o fluxo de release (`npm version` → `git push --follow-tags` → `gh release create`)
- [x] Automatizar o bump de `VERSAO_DO_CACHE` em `public/sw.js` a cada release (hook `version` no `package.json`)
- [x] Publicar a primeira release no GitHub Releases — `v1.0.0`, com o instalador do Windows e os três pacotes Unix anexados pelo CI
- [x] Proteger a branch `main` exigindo pull request — sem force push e sem exclusão da branch; a regra não vale para o administrador, para o fluxo de release seguir direto

## 5. Bugs e sugestões

- [x] Criar `.github/ISSUE_TEMPLATE/config.yml` desabilitando issue em branco e apontando dúvidas para Discussions
- [x] Criar `.github/ISSUE_TEMPLATE/bug.yml` com campos obrigatórios: versão do HUB, sistema operacional, versão do Node, passos, resultado esperado e obtido, trecho do log
- [x] Criar `.github/ISSUE_TEMPLATE/melhoria.yml` com problema a resolver, solução proposta e alternativas consideradas
- [x] Incluir em todos os templates o aviso de não colar conteúdo de `clientes.json` nem logs com dados sensíveis
- [x] `.github/PULL_REQUEST_TEMPLATE.md` — removido: não recebo pull request, tudo entra por issue
- [x] Habilitar Discussions no repositório (Issues já vem ligado) — sem isso o link do `config.yml` cai em página inexistente
- [x] Criar as labels — as padrão do GitHub foram renomeadas para português em vez de duplicadas: `melhoria`, `duvida`, `nao-vai-fazer`, `boa-primeira-issue`, `documentacao`, `duplicada`, `invalida`, `ajuda-bem-vinda` e `bug`
- [x] Conferir na tela `.../issues/new/choose` que os dois formulários aparecem — os arquivos já estão no remoto e a sintaxe foi validada; a conferência visual precisa de você logado, porque a página não abre para anônimos

## 6. README

- [x] Adicionar screenshot ou GIF da interface logo após o parágrafo de abertura
- [x] Adicionar badges de versão da release, licença e versão mínima do Node
- [x] Criar seção "Como atualizar" (cobre `git pull`; falta a parte de instalador Windows e `.zip`, do bloco 9)
- [x] Criar seção "Solução de problemas" (porta ocupada, Node antigo, PWA sem opção de instalar, git fora do PATH)
- [x] Criar seção "Suporte" com os canais de contato
- [x] Criar seção "Documentação técnica" com link para os documentos de `docs/`
- [x] Criar seção "Licença" com link para o `LICENSE`
- [x] Adicionar link para o `CHANGELOG.md`
- [x] Mover as seções técnicas para `docs/` — API, formato dos dados e estrutura do código saíram do README

## 7. Documentos de apoio

- [x] Criar `CONTRIBUTING.md` — reduzido a "não recebo pull request, peça por issue"; o conteúdo de manutenção foi para `docs/manutencao.md`
- [x] Criar `SECURITY.md` — reduzido ao canal privado, à versão suportada e ao que não é falha; a conferência de origem foi para `docs/api.md`
- [x] Mover o detalhe técnico do README para `docs/comportamento-detalhado.md` — programa chamado por SO, formatos de favoritos, `.sankhya-mcp.env` e gravidade das pendências Git
- [x] `CODE_OF_CONDUCT.md` — dispensado: projeto de um mantenedor, público restrito a colegas
- [x] `CODEOWNERS` — dispensado: um mantenedor só

## 8. Qualidade e automação

- [x] Criar os primeiros testes com `node:test`, cobrindo os repositórios de arquivo e a migração de esquema
- [x] Adicionar o script `test` ao `package.json`
- [x] Criar workflow do GitHub Actions rodando `npm ci`, `npm run typecheck` e `node --test` em push e pull request — em Linux e Windows, nas versões 22.18 e 24 do Node
- [x] Adicionar `.gitattributes` com `* text=auto eol=lf` (colegas em Linux e macOS clonam o mesmo repositório)
- [x] Adicionar `.editorconfig`
- [x] Adicionar Prettier com configuração versionada
- [x] Adicionar `.nvmrc` com a versão do Node
- [x] Configurar `.github/dependabot.yml` para npm e GitHub Actions

## 9. Distribuição

- [x] Definir a ferramenta do instalador Windows — Inno Setup 6, instalação por usuário, sem UAC
- [x] Empacotar o Node e as dependências junto, para não exigir Node na máquina do colega
- [x] Gerar o `hub-snk.ico` a partir do mesmo desenho dos ícones da PWA
- [x] Launcher que sobe o servidor e abre a janela sem barra de endereço (`--app`)
- [x] Início automático no logon pela pasta Inicializar, na sessão do usuário
- [x] Desinstalação que encerra só o servidor da instalação e preserva o cadastro
- [x] Workflow que compila o instalador e anexa à release a cada tag
- [x] Gerar os pacotes de Linux e macOS (Intel e Apple Silicon), também com o Node embutido
- [x] Usar `.tar.gz` em vez de `.zip` nos pacotes Unix — o zip não preserva o bit de execução do binário do Node
- [x] Unificar a distribuição num workflow só, com um job de publicação no fim
- [ ] **Testar o instalador de ponta a ponta numa máquina Windows** — instalar, reiniciar, conferir o início no logon, atualizar por cima e desinstalar
- [ ] **Testar os pacotes numa máquina Linux e numa macOS** — descompactar, `./hub-snk.sh`, `parar`, e o Gatekeeper no macOS
- [ ] Documentar a verificação de integridade dos artefatos (checksum)
- [ ] Avaliar assinatura digital — sem ela, o SmartScreen alerta no Windows e o Gatekeeper barra no macOS

## 10. Pós-publicação

- [ ] Implementar aviso de versão nova no rodapé, comparando com a última release via API do GitHub
- [ ] Divulgar o repositório para os colegas com um guia curto de primeiro uso
- [ ] Definir uma rotina de triagem das issues (frequência e critério de priorização)
