# TODO — Publicação do HUB SNK

Checklist para publicar o projeto no GitHub (repositório público, licença aberta,
suporte via Issues) e mantê-lo de forma profissional.

Substitua `SEU_USUARIO` pelo seu usuário/organização do GitHub em todos os itens.

---

## 0. Bloqueantes — resolver antes do primeiro push

- [ ] Revisar o `.gitignore` e confirmar que `dados-hub-snk/`, `*.log` e `.idea/` estão cobertos
- [ ] Rodar `git init` e conferir `git status --porcelain` antes do primeiro commit
- [ ] Confirmar que nenhum arquivo com dado real de cliente, host ou senha entra no commit inicial
- [ ] Revisar o histórico do README e do código em busca de nomes de clientes, IPs, caminhos internos ou credenciais
- [ ] Recusar host não-loopback por padrão: exigir uma confirmação explícita (ex.: `HUB_PERMITIR_REDE=1`) para aceitar `HUB_HOST` diferente de `127.0.0.1`
- [ ] Validar os headers `Host` e `Origin` nas requisições (hook `onRequest` no Fastify), rejeitando origem que não seja o próprio loopback na porta configurada
- [ ] Documentar no README que a aplicação executa binários e comandos do sistema, e o que isso implica ao expor o servidor na rede

## 1. Versionamento de dados (fazer antes de distribuir)

- [ ] Adicionar `versaoDoEsquema` em `clientes.json`, `configuracao.json` e `local.json`
- [ ] Implementar leitura da versão do esquema no boot, com erro claro quando for maior que a suportada
- [ ] Gerar cópia de segurança (`<arquivo>.bak-<versao>`) antes de qualquer migração automática
- [ ] Documentar a política de migração no README

## 2. Licença e metadados

- [ ] Criar `LICENSE` (MIT) com ano e nome do autor
- [ ] Adicionar `license`, `author`, `repository`, `bugs` e `homepage` ao `package.json`
- [ ] Manter `"private": true` para impedir publicação acidental no npm
- [ ] Definir descrição e tópicos (topics) do repositório no GitHub

## 3. Atribuição e contato

### Na aplicação

- [ ] Criar rota `GET /api/sistema/versao` devolvendo a versão do `package.json`
- [ ] Habilitar `resolveJsonModule` no `tsconfig.json` (se optar por importar o `package.json`)
- [ ] Adicionar rodapé em `public/index.html` com: nome do app, versão, autor e link "Reportar problema"
- [ ] Estilizar o rodapé em `public/styles.css` de forma discreta
- [ ] Preencher a versão do rodapé no boot do `public/app.js`, consumindo a rota nova

### No repositório

- [ ] Adicionar seção "Suporte" no README com link do Issues, do Discussions e e-mail de contato
- [ ] Adicionar seção "Autor" ou linha de crédito no final do README

## 4. Versionamento e releases

- [ ] Definir e documentar a regra de SemVer do projeto (o que caracteriza MAJOR, MINOR e PATCH aqui)
- [ ] Subir a versão de `0.1.0` para `1.0.0` na primeira release pública
- [ ] Criar `CHANGELOG.md` no padrão Keep a Changelog, em português, escrito para o usuário final
- [ ] Adotar Conventional Commits nas mensagens de commit
- [ ] Documentar o fluxo de release (`npm version` → `git push --follow-tags` → `gh release create`)
- [ ] Automatizar o bump de `VERSAO_DO_CACHE` em `public/sw.js` a cada release (hook `version` no `package.json`)
- [ ] Publicar a primeira release no GitHub Releases, com notas extraídas do CHANGELOG
- [ ] Proteger a branch `main` exigindo pull request

## 5. Bugs e sugestões

- [ ] Habilitar Issues e Discussions no repositório
- [ ] Criar `.github/ISSUE_TEMPLATE/config.yml` desabilitando issue em branco e apontando dúvidas para Discussions
- [ ] Criar `.github/ISSUE_TEMPLATE/bug.yml` com campos obrigatórios: versão do HUB, sistema operacional, versão do Node, passos, resultado esperado e obtido, trecho do log
- [ ] Criar `.github/ISSUE_TEMPLATE/melhoria.yml` com problema a resolver, solução proposta e alternativas consideradas
- [ ] Incluir em todos os templates o aviso de não colar conteúdo de `clientes.json` nem logs com dados sensíveis
- [ ] Criar as labels: `bug`, `melhoria`, `duvida`, `nao-vai-fazer`, `boa-primeira-issue`
- [ ] Criar `.github/PULL_REQUEST_TEMPLATE.md`

## 6. README

- [ ] Adicionar screenshot ou GIF da interface logo após o parágrafo de abertura
- [ ] Adicionar badges de versão da release, licença e versão mínima do Node
- [ ] Criar seção "Como atualizar", cobrindo instalador Windows e pacote `.zip`
- [ ] Criar seção "Solução de problemas" (porta ocupada, Node antigo, PWA sem opção de instalar, git fora do PATH)
- [ ] Criar seção "Suporte" com os canais de contato
- [ ] Criar seção "Contribuindo" com link para o `CONTRIBUTING.md`
- [ ] Criar seção "Licença" com link para o `LICENSE`
- [ ] Adicionar link para o `CHANGELOG.md`
- [ ] Avaliar mover as seções "API" e "Estrutura" para `docs/`, deixando o README focado no usuário final

## 7. Documentos de apoio

- [ ] Criar `CONTRIBUTING.md`: como rodar localmente, padrão de commit, padrão de nomes em português, exigência de typecheck e testes antes do PR
- [ ] Criar `SECURITY.md`: canal privado para reportar falhas e modelo de ameaça assumido (sem autenticação, senhas em texto puro, escuta apenas em loopback)
- [ ] Avaliar a necessidade de `CODE_OF_CONDUCT.md`
- [ ] Criar `CODEOWNERS`

## 8. Qualidade e automação

- [ ] Criar os primeiros testes com `node:test`, cobrindo os repositórios de arquivo e a migração de esquema
- [ ] Adicionar o script `test` ao `package.json`
- [ ] Criar workflow do GitHub Actions rodando `npm ci`, `npm run typecheck` e `node --test` em push e pull request
- [ ] Adicionar `.editorconfig`
- [ ] Adicionar Prettier com configuração versionada
- [ ] Adicionar `.nvmrc` com a versão do Node
- [ ] Configurar `.github/dependabot.yml` para npm e GitHub Actions

## 9. Distribuição (detalhar depois)

- [ ] Definir a ferramenta do instalador Windows
- [ ] Definir o conteúdo e a geração do pacote `.zip` para Linux e macOS
- [ ] Anexar os artefatos a cada GitHub Release
- [ ] Documentar a verificação de integridade dos artefatos (checksum)

## 10. Pós-publicação

- [ ] Implementar aviso de versão nova no rodapé, comparando com a última release via API do GitHub
- [ ] Divulgar o repositório para os colegas com um guia curto de primeiro uso
- [ ] Definir uma rotina de triagem das issues (frequência e critério de priorização)
