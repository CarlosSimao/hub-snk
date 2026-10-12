# Assinatura digital do instalador (SignPath Foundation)

Estado: **planejado, não iniciado**. O pedido ao SignPath fica para depois das
funcionalidades que ainda vão entrar. Este documento junta o que já foi levantado e
o passo a passo para quando for a hora.

Hoje o instalador e o executável saem sem assinatura (ver a seção "Assinatura" de
`distribuicao.md`), e o SmartScreen avisa na primeira execução.

## Por que o SignPath Foundation

- Certificados de assinatura de código emitidos depois de 2023 não vêm mais como um
  `.pfx` exportável: a chave fica em HSM, seja um token USB ou a nuvem. Token USB
  não serve para o GitHub Actions, então na prática a assinatura tem que ser em nuvem.
- O SignPath Foundation assina de graça projetos open source. O hub-snk é público e
  MIT, e por isso se encaixa.
- Alternativas, se o pedido for negado:
  - **Certum Open Source Code Signing**: barato e em nome de pessoa física, mas a
    automação no CI é mais trabalhosa.
  - **Azure Trusted Signing**: tem restrição de país e de tempo de existência da
    empresa; confirmar se aceita o Brasil.
  - Certificado da Sankhya: exige aprovação formal, porque a Sankhya passaria a
    aparecer como editora de um projeto pessoal.

## O que muda para quem instala

- A janela do Windows mostra a editora como **"SignPath Foundation"**, não "Carlos
  Nascimento". O certificado é da fundação, que assina em nome do projeto.
- O SmartScreen **não some de imediato**. Desde 2024, nem certificado EV dá
  reputação instantânea: ela vem com o tempo e com o volume de downloads. As
  primeiras versões assinadas ainda podem mostrar o aviso.

## Regras do SignPath Foundation

Fonte: <https://signpath.org/terms>. As regras valem **o tempo todo**, não só no
pedido: violar uma delas depois pode levar à revogação.

| Regra                                                                                | Situação no hub-snk                                                                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Licença OSI, sem licenciamento duplo comercial                                       | MIT. Ok.                                                                                                                                                     |
| _"The project may not contain any proprietary, non open-source component"_           | **Bloqueio hoje**: o Git AutoSync (`FlavianoRS/git-autosync`) está público mas sem licença, e é embutido no instalador. Resolvido pela remoção (ver abaixo). |
| _"The team must only sign software artifacts built from their own source code"_      | Assinar só o `HUB SNK.exe` e o instalador. Nada de binário de terceiros.                                                                                     |
| Projeto já lançado, mantido e com as funcionalidades descritas na página de download | Site no GitHub Pages. Conferir se a descrição está completa.                                                                                                 |
| Página de "Code Signing Policy" com a atribuição, os papéis do time e a privacidade  | A criar.                                                                                                                                                     |
| MFA no GitHub e no SignPath para todo o time                                         | Conferir.                                                                                                                                                    |
| Build automatizado e verificável a partir do repositório declarado                   | GitHub Actions (`distribuicao.yml`). Nada assinado de build local.                                                                                           |
| Nome do produto e versão gravados no binário                                         | `signAndEditExecutable: true` já grava.                                                                                                                      |
| Aprovação manual de toda release antes da assinatura                                 | Vira passo fixo da rotina de release.                                                                                                                        |
| Não alterar o sistema sem avisar, não coletar dados sem aviso, ter desinstalador     | O desinstalador já existe. A coleta e o envio de dados precisam constar da declaração de privacidade.                                                        |

### Novas funcionalidades não exigem nova validação

A validação é feita uma vez por projeto. Funcionalidade nova ou rotina alterada não
reabre o processo, desde que o projeto continue dentro das regras acima. Antes de
incluir algo, conferir:

- Dependência nova: precisa ter licença OSI. Uma dependência proprietária quebra a
  regra.
- Envio novo de dados para fora da máquina: atualizar a declaração de privacidade.
- Binário novo ou caminho novo a assinar: ajustar a configuração de artefatos no
  SignPath. Ainda não sei se a fundação revisa essa mudança; confirmar no painel.
- Mudança no time (outra pessoa com commit): atualizar os papéis na página da
  política.

## Pré-requisito: tirar o Git AutoSync do instalador

Decisão tomada: o Git AutoSync deixa de viajar no instalador e passa a ser instalado
em separado, pelo instalador do próprio projeto dele. O HUB SNK continua lendo
`%USERPROFILE%\.git-autosync` (`GIT_AUTOSYNC_HOME`), então a integração do painel
segue funcionando para quem o tiver instalado.

Pontos que a remoção toca. Levantamento inicial, a detalhar quando for implementar:

- `.github/workflows/distribuicao.yml`: os passos de checkout do git-autosync, do
  Python e de "Gerar os binários do Git AutoSync", e a variável `GIT_AUTOSYNC_DIR`.
- `desktop/package.json`: `preparar-autosync` dentro de `empacotar`,
  `empacotar:sem-autosync` e `empacotar:rapido`.
- `desktop/scripts/preparar-autosync.mjs`.
- `desktop/electron-builder.yml`: o `extraResources` de `build/git-autosync`.
- `desktop/assets/installer.nsh`: a página de componentes e a instalação e a
  desinstalação via `install-standalone.ps1`.
- `desktop/src/config.ts` (`PACOTE_DO_AUTOSYNC`), `desktop/src/backendProcess.ts`
  (`HUB_AUTOSYNC_PACOTE`), `src/configuracao.ts` (`pacoteDoAutosync`) e
  `src/autosync/cliDoAutosyncProcesso.ts`: hoje o backend consegue instalar o
  autosync a partir do pacote embutido. Sem o pacote, esse caminho precisa sumir ou
  virar um link e uma instrução para instalar em separado.
- Quem já instalou o AutoSync pelo HUB: depois da remoção, o desinstalador do HUB
  para de oferecer a remoção dele (marca `HubSnk\git-autosync-instalado-pelo-hub.txt`).
  O AutoSync continua instalado e passa a ser removido pelo instalador dele.
  Documentar no CHANGELOG.
- Documentação: `README.md`, `docs/distribuicao.md`, `docs/funcionalidades.md`,
  `docs/estrutura-do-codigo.md`, `docs/manutencao.md` e `site/index.html`.

## Privacidade: o que sai da máquina

Inventário inicial para a declaração de privacidade. Revisar antes do pedido:

- **Sankhya Experience**: leitura de tarefas e OS na API do Sankhya Experience (AWS,
  `sa-east-1`), com o token da sessão do próprio usuário (`src/sankhya/experience.ts`).
- **GitHub**: consulta à última versão publicada (`src/sistema/ultimaVersaoPublicada.ts`)
  e download de atualização pelo `electron-updater`.
- **E-mail**: envio pelo SMTP que o usuário configura (`nodemailer`).
- **Guias web** (Sankhya, Gmail, Chat, WhatsApp Web): o conteúdo é carregado
  direto dos serviços, e os cookies ficam no `userData`.
- **Google Drive**: só com a conta conectada pelo usuário. Grava e lê, na conta dele, só a
  cópia dos dados do HUB SNK (`src/drive/`, `src/backup/`). Nada vai para servidor do projeto.
- **Credenciais**: guardadas no cofre local (`safeStorage` do Windows), nunca
  enviadas para servidor do projeto.
- **Telemetria**: nenhuma. Confirmar que continua assim.

## Plano e tutorial

### Fase 0: preparar o projeto (antes do pedido)

1. Terminar as funcionalidades planejadas.
2. Tirar o Git AutoSync do instalador (seção acima) e publicar uma versão sem ele,
   ainda sem assinatura.
3. Ativar MFA no GitHub, se ainda não estiver ativo.
4. Criar a página **Code Signing Policy** no site, linkada a partir da página de
   download e do README. Conteúdo mínimo:

   ```markdown
   ## Política de assinatura de código

   Free code signing provided by [SignPath.io](https://about.signpath.io),
   certificate by [SignPath Foundation](https://signpath.org).

   - Autores (committers): [Carlos Nascimento](https://github.com/CarlosSimao)
   - Revisores: [Carlos Nascimento](https://github.com/CarlosSimao)
   - Aprovadores: [Carlos Nascimento](https://github.com/CarlosSimao)

   Privacidade: este programa não envia informação para nenhum sistema na rede,
   a não ser que o usuário ou quem instala peça. <detalhar com o inventário acima>
   ```

5. Conferir se a página de download descreve o que o programa faz.

### Fase 1: fazer o pedido

1. Preencher o formulário em <https://signpath.org/apply>, com o repositório, a
   página de download e a página da política.
2. Aguardar a análise. Os relatos públicos falam em semanas; o prazo exato ainda
   não foi verificado.
3. Se pedirem ajustes, corrigir e responder. O pedido não precisa ser refeito do
   zero.

### Fase 2: configurar o SignPath (depois de aprovado)

No painel do SignPath (<https://app.signpath.io>):

1. Conferir o projeto criado pela fundação e anotar o **Organization ID** e o
   **Project slug**.
2. Conectar o **GitHub** como _Trusted Build System_ do projeto. É assim que o
   SignPath verifica que o artefato veio do Actions deste repositório.
3. Criar duas **configurações de artefato**:

   `hub-snk-app`: assina o executável dentro da pasta desempacotada.

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="HUB SNK.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   `hub-snk-instalador`: assina o instalador NSIS.

   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
     <zip-file>
       <pe-file path="HUB-SNK-Setup-*.exe">
         <authenticode-sign />
       </pe-file>
     </zip-file>
   </artifact-configuration>
   ```

   O artefato do GitHub chega ao SignPath como zip, por isso a raiz é `<zip-file>`.
   Conferir a sintaxe de curinga do `path` na documentação do SignPath.

4. Criar um **token de API** de usuário CI, com permissão de submissão na política
   de assinatura.
5. No GitHub, em _Settings → Secrets and variables → Actions_, criar:
   - `SIGNPATH_API_TOKEN` (secret);
   - `SIGNPATH_ORGANIZATION_ID` (variável);
   - `SIGNPATH_PROJECT_SLUG` (variável).
6. Anotar o slug da política: `release-signing` para produção. Se houver
   `test-signing`, usar primeiro para validar o pipeline, porque o certificado de
   teste não vale fora do ambiente de teste.

### Fase 3: ajustar o pipeline

**Por que duas assinaturas.** O instalador NSIS do `electron-builder` é um `.exe`
autoextraível, e o SignPath não consegue abrir esse formato para assinar o que tem
dentro. Por isso o fluxo tem duas passadas:

1. Empacotar só a pasta (`--dir`) e assinar o `HUB SNK.exe`.
2. Gerar o NSIS a partir dessa pasta já assinada (`--prepackaged`) e assinar o
   instalador.

O desinstalador é gerado dentro do NSIS e fica sem assinatura. É aceitável.

**Por que corrigir o `latest.yml`.** Assinar muda os bytes do instalador depois que
o `electron-builder` já gravou o `sha512` e o `size` dele no `latest.yml`. O
`electron-updater` recusa um download com hash divergente, e o auto-update quebraria
na primeira versão assinada. Depois da segunda assinatura, um script precisa:

- recalcular o `sha512` (base64) e o `size` do instalador assinado e regravar
  `files[0].sha512`, `files[0].size` e o `sha512` da raiz no `latest.yml`;
- regenerar o `.blockmap` do instalador assinado. A alternativa é não publicar o
  `.blockmap`: o `electron-updater` cai para o download completo.

Esboço do job `windows` em `distribuicao.yml`. Conferir a versão da action e os
nomes dos inputs na documentação dela antes de usar:

```yaml
- name: Empacotar a pasta do aplicativo
  run: npm --prefix desktop run empacotar:pasta # build + preparar-hub + electron-builder --dir

- id: pasta-sem-assinatura
  uses: actions/upload-artifact@v7
  with:
    name: app-sem-assinatura
    path: release/win-unpacked/

- name: Assinar o executável
  uses: signpath/github-action-submit-signing-request@v1
  with:
    api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
    organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
    project-slug: ${{ vars.SIGNPATH_PROJECT_SLUG }}
    signing-policy-slug: release-signing
    artifact-configuration-slug: hub-snk-app
    github-artifact-id: ${{ steps.pasta-sem-assinatura.outputs.artifact-id }}
    wait-for-completion: true
    output-artifact-directory: release/win-unpacked

- name: Gerar o instalador a partir da pasta assinada
  run: npm --prefix desktop run empacotar:instalador # electron-builder --prepackaged ../release/win-unpacked

- id: instalador-sem-assinatura
  uses: actions/upload-artifact@v7
  with:
    name: instalador-sem-assinatura
    path: release/HUB-SNK-Setup-*.exe

- name: Assinar o instalador
  uses: signpath/github-action-submit-signing-request@v1
  with:
    api-token: ${{ secrets.SIGNPATH_API_TOKEN }}
    organization-id: ${{ vars.SIGNPATH_ORGANIZATION_ID }}
    project-slug: ${{ vars.SIGNPATH_PROJECT_SLUG }}
    signing-policy-slug: release-signing
    artifact-configuration-slug: hub-snk-instalador
    github-artifact-id: ${{ steps.instalador-sem-assinatura.outputs.artifact-id }}
    wait-for-completion: true
    output-artifact-directory: release

- name: Corrigir o latest.yml e o blockmap
  run: node desktop/scripts/corrigir-metadados-de-atualizacao.mjs
```

Arquivos que mudam nesta fase:

- `.github/workflows/distribuicao.yml`: os passos acima.
- `desktop/package.json`: os scripts `empacotar:pasta` e `empacotar:instalador`.
- `desktop/scripts/corrigir-metadados-de-atualizacao.mjs`: arquivo novo, com a
  correção do `sha512`, do `size` e do `.blockmap`.
- `desktop/electron-builder.yml`: o comentário de `signAndEditExecutable` e,
  opcionalmente, o `publisherName` (ver abaixo).
- `docs/distribuicao.md`: atualizar a seção "Assinatura".

**`publisherName` e auto-update.** Sem `publisherName` no `app-update.yml`, o
`electron-updater` não confere quem assinou a atualização. Configurar
`publisherName: SignPath Foundation` faz o app recusar update que não venha assinado
pela fundação. É mais seguro, mas fica amarrado: se a assinatura pelo SignPath
acabar, quem já instalou para de receber update até reinstalar à mão. Decidir antes
da primeira versão assinada. Na versão do `electron-builder` em uso, a chave pode
estar em `win.signtoolOptions.publisherName`; conferir.

### Fase 4: validar a primeira versão assinada

1. Gerar uma tag de teste (`v2.x.y-beta.1`). Ela sai como pre-release e não chega
   aos usuários.
2. Aprovar as duas assinaturas no painel do SignPath.
3. Conferir as assinaturas:

   ```powershell
   Get-AuthenticodeSignature "HUB-SNK-Setup-2.x.y-beta.1.exe" | Format-List
   Get-AuthenticodeSignature "$env:LOCALAPPDATA\Programs\HUB SNK\HUB SNK.exe" | Format-List
   ```

   Esperado: `Status: Valid` e o signatário `SignPath Foundation`.

4. Conferir que o `sha512` do `latest.yml` bate com o instalador publicado.
5. Na VM de teste (checkpoint `limpo`):
   - instalação limpa da versão assinada;
   - atualização automática de uma versão **sem** assinatura para a assinada;
   - depois que houver duas versões assinadas, atualização de uma para a outra.

### Fase 5: rotina de cada release

1. Gerar a tag como hoje.
2. O workflow para e espera a primeira aprovação. Aprovar no SignPath.
3. O workflow para de novo no instalador. Aprovar de novo.
4. A publicação na release segue como hoje.

Se ninguém aprovar dentro do tempo limite da action, o job falha e a release não
sai. Para tentar de novo, basta rodar o workflow outra vez.

## Riscos e decisões em aberto

- **Prazo de aprovação inicial**: não verificado.
- **Revisão de mudança nas configurações de artefato**: não verificado se a
  fundação revisa.
- **`publisherName`**: decidir se amarra o auto-update à fundação.
- **`.blockmap`**: regenerar ou deixar de publicar.
- **Reputação no SmartScreen**: o aviso pode continuar nas primeiras versões
  assinadas.

## Referências

- [SignPath Foundation: termos](https://signpath.org/terms)
- [SignPath Foundation: pedido](https://signpath.org/apply)
- [GitHub Action do SignPath](https://github.com/SignPath/github-action-submit-signing-request)
- Exemplos de Electron + SignPath:
  [jbrowse-components #5631](https://github.com/GMOD/jbrowse-components/pull/5631),
  [pqp #677](https://github.com/rafaelcg/pqp/pull/677),
  [lila-modeler #501](https://github.com/AlambritoDito/lila-modeler/pull/501)
