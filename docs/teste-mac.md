# Teste manual no Mac

Roteiro para validar o HUB SNK num Mac de verdade. O job `mac` da `Distribuição` só prova
que o `.dmg` é gerado, que a assinatura ad-hoc é válida e que o app abre com o backend no
ar (ver [distribuicao.md](distribuicao.md#mac)). O resto — Gatekeeper com clique, Keychain,
teclado, bandeja, Dock, atalho global, início automático — só se vê aqui.

## Antes de começar

- Mac com chip Apple ( › Sobre Este Mac › "Chip Apple M…"). Mac Intel não roda o pacote.
- Senha de administrador do Mac.
- Anote a versão do macOS e a versão do HUB SNK testada.
- Se algo falhar: print, mais `desktop.log` e `backend.log` de
  `~/Library/Application Support/HUB SNK/log/` (Finder › Ir › Ir para a Pasta).

## 1. Instalação e Gatekeeper

- [ ] Baixar o `.dmg` pelo botão do site, **pelo navegador** (é o que marca a quarentena).
- [ ] Abrir o `.dmg` e arrastar o HUB SNK para Aplicativos.
- [ ] Abrir o app. Esperado: aviso de que a Apple não pôde verificar o app (botão
      Concluído). Falha: "está danificado".
- [ ] Ajustes do Sistema › Privacidade e Segurança › **Abrir Mesmo Assim** › senha. O app
      abre.
- [ ] Sem o botão: `xattr -dr com.apple.quarantine "/Applications/HUB SNK.app"` no
      Terminal. Anotar que precisou.
- [ ] Fechar e abrir de novo: sem aviso nenhum.

## 2. Primeira abertura

- [ ] O assistente de boas-vindas aparece; os 4 passos funcionam.
- [ ] O Painel carrega com dados (Painel em branco = backend não subiu).
- [ ] O ícone do Dock é o do HUB SNK.
- [ ] O ícone na barra de menus (canto superior direito) tem tamanho normal.

## 3. Menu e teclado

- [ ] A barra de menus mostra **HUB SNK, Editar, Guias, Janela, Ajuda**.
- [ ] Num campo de texto do Painel: Cmd+C, Cmd+V, Cmd+X, Cmd+A, Cmd+Z.
- [ ] Os mesmos atalhos no campo de login da guia SankhyaOm.
- [ ] Option+← e Option+→ num campo de texto pulam palavra (não voltam a página).
- [ ] Cmd+K busca rápida, Cmd+F busca na página, Cmd+R recarrega, Cmd+Shift+R recarrega
      sem cache, Cmd+T nova guia, Cmd+M minimiza.
- [ ] Cmd+[ e Cmd+] voltam e avançam numa guia avulsa.
- [ ] Ajuda › Atalhos mostra "Cmd+", não "Ctrl+".
- [ ] Ajuda **não** tem "Atualizar automaticamente".
- [ ] O menu ☰ da barra de guias **não** tem a seção Editar.

## 4. Janela, Dock e barra de menus

- [ ] O botão vermelho esconde a janela; na primeira vez, notificação "O HUB SNK continua
      aberto" (permitir notificações se o macOS pedir).
- [ ] Clique no ícone do Dock traz a janela de volta.
- [ ] Clique no ícone da barra de menus abre o menu: Abrir o HUB SNK, Busca rápida, Sair.
- [ ] Depois de Sair, `lsof -i :4100` no Terminal não mostra nada (sem backend órfão).
- [ ] Cmd+Q também encerra de vez.

## 5. Atalho global

- [ ] Com outro app em foco, **Cmd+Shift+Espaço** abre a busca rápida.
- [ ] Se não abrir: o menu da barra de menus diz "o sistema não liberou a tecla"? Anotar.
- [ ] Desmarcar e marcar o atalho global no menu desliga e religa.

## 6. Sankhya ID e Keychain

- [ ] Configurações › Sankhya ID: salvar usuário e senha sem erro.
- [ ] As guias SankhyaOm e Experience fazem login sozinhas.
- [ ] Sair e abrir de novo: login automático continua, sem pedido de senha.
- [ ] O app Acesso às Chaves mostra o item **HUB SNK Safe Storage**.

## 7. Integrações com o sistema

Abrir o app pelo Finder ou Launchpad, não pelo Terminal: é o que testa o PATH.

- [ ] Git, Docker, Claude/Codex instalados pelo Homebrew aparecem como instalados.
- [ ] "Abrir pasta" abre o Finder.
- [ ] Link externo abre no navegador padrão.
- [ ] "Abrir terminal" abre o Terminal.
- [ ] Atalho para um `.app` (DBeaver, IntelliJ...) abre o programa.
- [ ] Seletor de pasta e de arquivo: janela nativa do Mac.
- [ ] Docker instalado: iniciar uma base funciona.
- [ ] Aba Git AutoSync: informa que não há instalação para o Mac, sem travar.
- [ ] Notificações das guias (WhatsApp, Gmail, Chat) com o nome HUB SNK.
- [ ] Backup no Google Drive (se usar): o login abre no navegador e o envio funciona.

## 8. Início automático

- [ ] Barra de menus › marcar **Iniciar HUB SNK automaticamente**. Passa a existir
      `~/Library/LaunchAgents/br.dev.hubsnk.desktop.plist`. O aviso "Item de segundo plano
      adicionado" do macOS é esperado.
- [ ] Sair da sessão do Mac e entrar de novo: o app sobe **escondido** (só o ícone na barra
      de menus).
- [ ] Desmarcar: o arquivo some e, no próximo login, o app não abre.

## 9. Atualização

Precisa de duas versões publicadas (ex.: duas betas). O Painel não avisa de uma beta para
outra (pre-release é ignorada), então a troca é manual.

- [ ] Com a versão anterior em uso, clientes cadastrados e Sankhya ID salvo: Sair, baixar o
      `.dmg` novo e arrastar para Aplicativos, substituindo.
- [ ] Ao abrir: o Gatekeeper pediu liberação de novo? Anotar.
- [ ] O macOS pede acesso à chave **HUB SNK Safe Storage**: senha › **Sempre Permitir**.
- [ ] Cadastro igual; guias logam sozinhas.
- [ ] Ajuda mostra a versão nova.
- [ ] Opcional: repetir clicando em **Negar**. Esperado: guias não logam sozinhas, cadastro
      intacto, e o pedido volta ao reabrir.

## 10. Desinstalação

- [ ] Sair e arrastar o app de Aplicativos para o Lixo.
- [ ] `~/Library/Application Support/HUB SNK/dados` continua lá.
- [ ] Instalar de novo: clientes e preferências voltam.
