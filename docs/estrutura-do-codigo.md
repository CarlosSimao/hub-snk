# Estrutura do código

Mapa dos arquivos, para quem vai mexer no HUB SNK. Para usar o programa, veja o
[README](../README.md).

```
src/                                        backend (Fastify), sem build: o Node roda o .ts direto
  index.ts                                  sobe o Fastify e serve public/
  configuracao.ts                           porta, host, diretório de dados e perfil do instalador
  acessos.ts                                preset de funcionalidades ocultas de cada perfil
  tipos.ts                                  os tipos do domínio: cadastro (Cliente, Base, BancoDeDados, RepositorioGit,
                                            Projeto), configuração global e acessos, situação do Git, bases e bancos
                                            locais, Agenda de Recursos, OS da Experience, notificações, lembretes e contatos

  repositorio/                              contratos de persistência (as rotas dependem só deles)
    repositorioClientes.ts                  clientes e erros de domínio
    repositorioConfiguracao.ts              configuração global
    repositorioLocal.ts                     bases e bancos da máquina
    repositorioLembretes.ts                 lembretes
    repositorioContatos.ts                  contatos
    repositorioNotificacoes.ts              painel de notificações
    arquivo/                                implementações em arquivo JSON local
      arquivoDeDados.ts                     envelope com versaoDoEsquema, migração e escrita atômica
      filaDeOperacoes.ts                    uma gravação por vez em cada arquivo, para uma não apagar a outra
      repositorioClientesArquivo.ts  repositorioConfiguracaoArquivo.ts  repositorioLocalArquivo.ts
      repositorioLembretesArquivo.ts  repositorioContatosArquivo.ts  repositorioNotificacoesArquivo.ts

  rotas/                                    uma rota HTTP por área, com a validação de entrada
    rotasClientes.ts                        cadastro dos clientes
    rotasConfiguracao.ts                    configuração global
    rotasGit.ts                             situação dos repositórios locais
    rotasAtalhos.ts                         dispara os atalhos cadastrados
    rotasLocal.ts                           bases e bancos da máquina
    rotasSistema.ts                         versão, sonda de vida, encerramento, seletores do SO e varredura
    rotasSankhya.ts                         credenciais, guias do Sankhya e sessão empurrada pelo shell
    rotasAgenda.ts                          Agenda de Recursos e situação do dia na Experience
    rotasOs.ts                              OS da Experience, geral e por cliente, consultadas ao vivo
    rotasNotificacoes.ts                    painel de notificações, fluxo SSE e e-mail de teste
    rotasLembretes.ts                       cadastro dos lembretes e prévia do cron
    rotasContatos.ts                        cadastro dos contatos
    rotasAutosync.ts                        Git AutoSync: visão, repositórios, horários, commit, push, MR e token do GitLab
    rotasKanban.ts                          kanban dos projetos: documento de escopo, análise pela IA e tarefas
    rotasDrive.ts                           conexão com a conta do Google Drive
    rotasBackup.ts                          configuração, backup agora, cópias no Drive e restauração
    rotasMcp.ts                             o lado do HUB SNK do servidor MCP do kanban, com a trava dos liberados
    seguranca/
      protecaoDeOrigem.ts                   confere Host e Origin antes de qualquer rota
      autenticacaoDoPainel.ts               exige o token do shell em toda a API
      autenticacaoDoShell.ts                confere o token das rotas que só o shell desktop chama
    comum/
      respostasDoShell.ts                   traduz a falha da ponte com o shell em resposta HTTP
      esquemaDeNotificacoes.ts              validação do SMTP e do alerta da agenda
      esquemaDeConfiguracaoMcp.ts           validação do .sankhya-mcp.env, comum ao repositório e à base local

  drive/
    credencialDoGoogle.ts                   lê a credencial OAuth de credencial-google.json ou do ambiente, fora do Git
    contaDoGoogle.ts                        autorização OAuth (PKCE, retorno em 127.0.0.1) e token de acesso
    cofreDoDrive.ts                         a autorização guardada no cofre do shell, pela ponte
    clienteDoDrive.ts                       API do Drive: guardar, achar e baixar a cópia dos dados

  backup/
    zip.ts                                  escrita e leitura de .zip, sem dependência nova
    pacoteDeDados.ts                        a pasta de dados num .zip, o resumo que diz se algo mudou e a extração
    servicoDeBackup.ts                      agendador do backup na pasta e da cópia no Drive
    estadoDoBackup.ts                       o que o backup lembra desta máquina, fora da pasta de dados
    restauracaoPendente.ts                  backup à espera do reinício, aplicado na largada

  mcp/servidorMcp.ts                        servidor MCP por stdio que os agentes rodam; fala só com /api/mcp/*

  sankhya/
    ponteDoDesktop.ts                       cliente HTTP da ponte do shell desktop (127.0.0.1:4103)
    sessaoDoDesktop.ts                      JWT da Experience empurrado pelo shell, em memória
    credenciais.ts                          credenciais do cofre do shell e consultas feitas por ele no ERP
    agenda.ts  agendaParser.ts              snapshot da Agenda de Recursos em SQLite
    consultasDaAgenda.ts                    importar um período da agenda e a situação do dia do parceiro
    negociacoes.ts                          FAPs de um parceiro, a partir das negociações do ERP
    experience.ts                           leitura da API da Experience com o JWT da guia

  notificacoes/
    centralDeNotificacoes.ts                repetida descartada, e-mail, gravação e aviso ao painel
    enviadorDeEmail.ts                      envio pelo SMTP da configuração (nodemailer)
    verificadorDaAgendaDoDia.ts             alerta de evento sem tarefa na Experience, na periodicidade configurada
    disparoDeLembretes.ts                   quando cada lembrete dispara (croner)
    agendadorDeLembretes.ts                 confere os lembretes a cada 30 segundos e dispara os vencidos
    emailDoLembrete.ts                      assunto, HTML com a logo e texto puro do e-mail do lembrete
    relogio.ts                              datas no fuso da máquina

  git/
    executarGit.ts                          executa comandos git sem shell e sem prompt
    provedorDeHospedagem.ts                 lê a URL do remoto: host, GitHub ou GitLab
    situacaoDoRepositorio.ts                diagnóstico de um repositório local
    cacheDeSituacao.ts                      cache por tempo e limite de leituras simultâneas
    varreduraDeRepositorios.ts              procura repositórios Git dentro das pastas escolhidas

  autosync/
    tiposDoAutosync.ts                      formatos do config.json e do status.json do Git AutoSync e a visão da tela
    cliDoAutosync.ts                        contrato com o CLI do Git AutoSync e erros de domínio
    cliDoAutosyncProcesso.ts                acha o git-autosync.exe, roda sem shell e lê config, status, log e Agendador
    servicoDoAutosync.ts                    cada ação da tela traduzida em subcomando do CLI, com o caminho conferido
    visaoDoAutosync.ts                      cruza config, status e pastas-raiz numa linha por repositório
    sincronizacaoComClientes.ts             situação de cada repositório de cliente no Git AutoSync e sugestão de pasta-raiz
    sugestoesDeCorrecao.ts                  explicação e comandos para a falha, lidos da saída do CLI
    variaveisDoGitlab.ts                    host e token do GitLab nas variáveis de ambiente do usuário
    pacoteDoGithub.ts                       baixa a Release mais recente do Git AutoSync para a instalação pela aba Git
    desinstalacaoJuntoDoHub.ts              marca e script que a desinstalação do HUB SNK usa para remover o autosync junto

  kanban/
    tiposDoKanban.ts                        colunas, tipos e prioridades das tarefas, demandas e assistentes de IA
    kanbanDosProjetos.ts                    demandas, tarefas e transições do kanban em SQLite, e os documentos em disco
    arquivoDeTarefas.ts                     arquivo JSON de tarefas em <pasta>/Tarefas, gravado e vigiado
    documentos/
      textoDoDocx.ts                        texto corrido de um .docx, sem dependência nova
      textoDoPdf.ts                         texto corrido de um PDF, sem dependência nova, para quem não lê PDF
    ia/
      assistentesDeIa.ts                    claude, codex, opencode, gemini e cursor-agent: detecção, modelos e execução isolada
      analiseDeEscopo.ts                    prompt do escopo e leitura do JSON de tarefas devolvido pela IA

  sistema/
    observadorDeDados.ts                    descarta o cache quando a pasta de dados muda no disco
    pasta.ts                                checagem de existência de diretório
    arquivoMcp.ts                           lê e grava o .sankhya-mcp.env do repositório
    mapearComLimite.ts                      Promise.all com teto de tarefas simultâneas, para não abrir centenas de git
    processos/
      abrirPasta.ts                         abre uma pasta no gerenciador do SO
      abrirShell.ts                         abre o terminal do SO na pasta
      abrirIde.ts                           abre a pasta como projeto na IDE configurada
      abrirNoNavegador.ts                   abre um endereço no navegador padrão, fora do HUB SNK
      abrirExecutavel.ts                    inicia o programa de um atalho
      lancarProcesso.ts                     lança um programa e confere que ele de fato subiu
      linhaDeComandoDoCmd.ts                monta a linha do cmd.exe para .bat e .cmd, recusando % e aspas
      selecionarArquivo.ts                  abre o seletor de arquivo do SO
      selecionarPasta.ts                    abre o seletor de pasta do SO
    bases/
      wildfly.ts  docker.ts                 situação das bases e dos bancos locais
      logDaBase.ts                          final do server.log de uma base local e o que chega depois, para o log ao vivo
      baseDoCliente.ts                      checagem HTTP da base de um cliente
      versaoDaPlataforma.ts                 versão da plataforma lida da página inicial do Sankhya
      historicoDeSituacaoDaBase.ts          amostras de situação de cada base local, em memória, para o gráfico de uptime
      historicoDeSituacaoDoBanco.ts         o mesmo para cada banco local
      historicoDeSituacaoDaBaseDoCliente.ts o mesmo para cada base de cliente
    versao/
      ultimaVersaoPublicada.ts              consulta a última release no GitHub, com cache
      comparacaoDeVersao.ts                 diz se a versão publicada é mais nova que a instalada

public/                                     painel, sem framework e sem build
  index.html                                a tela do painel
  log.html                                  log ao vivo de uma base local, em janela própria
  css/styles.css                            estilos do painel e do log
  img/                                      ícone
  js/
    app.js                                  lógica do painel
    backup.js                               janela Backup e Google Drive
    kanban.js                               kanban da aba Projetos: seção do projeto, órfãs, quadro e janelas
    buscaRapida.js                          índice e ordenação dos resultados da busca rápida (Ctrl+K)
    leitorDeFavoritos.js                    lê o arquivo de favoritos de qualquer navegador suportado
    leitorDeArquivoDeCadastros.js           lê o .txt de cadastros gerado pelo Exportar e pelo Compartilhar
    tipoDeBaseNoNome.js                     tira Produção/Teste do nome do favorito
    log.js                                  script do log.html

desktop/                                    shell Electron: o aplicativo que o usuário instala
  src/
    main.ts                                 boot: ponte, backend, janela, guias e menu
    config.ts                               endereços, portas e caminhos, em desenvolvimento e empacotado
    nomeDoApp.ts                            nome, perfil e trava próprios em desenvolvimento
    log.ts                                  desktop.log, com redação de senha, token, JWT e e-mail
    atualizacao.ts                          atualização automática pelas releases do GitHub (electron-updater)
    inicioAutomatico.ts                     liga e desliga o início do HUB SNK junto com o Windows
    backend/
      backendProcess.ts                     sobe o src/index.ts no Node do Electron e o encerra pela API
      backendClient.ts                      empurra a sessão da Experience para o backend
      bridgeServer.ts                       ponte que o backend chama: cofre, guias e consultas ao ERP
      cofreDeSegredos.ts                    segredos do backend que não são do Sankhya (Google Drive), com o safeStorage
      tokenStore.ts                         token compartilhado entre a ponte e o backend, gerado no primeiro boot
    sankhya/
      cofreCredenciais.ts                   cofre das credenciais com o safeStorage do Electron
      navegador.ts  sessions.ts             abrir as guias do Sankhya e capturar a sessão delas
      autoLoginSankhya.ts                   login automático nas guias SankhyaOm e Experience com a credencial do cofre
      loginOcultoSankhya.ts                 janela invisível e preenchimento do login web, comuns às janelas ocultas
      janelaAgendaOculta.ts                 janela oculta que loga no ERP e consulta a Agenda de Recursos e as negociações
      janelaExperienceOculta.ts             janela oculta que loga na Experience e mantém o JWT para o backend
      autofill.ts                           preenche o login da guia de uma base de cliente
    interface/
      tabs.ts                               guias fixas, por base e avulsas, política de pop-up e de links
      menu.ts                               menu da janela e das guias
      menuFlutuante.ts                      menu em HTML por cima da janela, que não fecha ao marcar caixa
      barraDeBusca.ts                       barra do Ctrl+F na guia ativa
      buscaRapida.ts                        abre a busca rápida do painel e executa os itens dela, pelo executeJavaScript
      janelaDeAtalhos.ts                    janela de Ajuda › Atalhos, com as teclas lidas do menu
      atalhoGlobal.ts                       liga e desliga o atalho global da busca, com a escolha gravada
      bandeja.ts                            ícone na bandeja, com a busca, o atalho global e o início automático
      comunicacao.ts                        painel de comunicação: WhatsApp Web, Gmail e Google Chat por cima das guias
      avisosDoHub.ts                        notificação do HUB SNK como aviso do Windows
      enderecoDigitado.ts                   URL ou busca a partir do que foi digitado na guia avulsa
      janelaEmUso.ts                        diz se a janela está em uso (minimizada não conta)
      ruffle.ts                             compatibilidade com Flash pelo Ruffle, injetado no começo de cada frame
    preloads/
      preload.ts                            ponte da janela principal (telas/index.html)
      preloadMenu.ts  preloadBarraDeBusca.ts  preloadRuffle.ts   pontes das camadas e do Ruffle
  telas/                                    HTML e JS carregados por loadFile
    index.html  renderer.js                 barra de guias
    menu.html  menu.js                      menu flutuante
    barraDeBusca.html  barraDeBusca.js      barra do Ctrl+F
    atalhos.html  atalhos.js                janela de atalhos
  scripts/preparar-hub.mjs                  monta o backend do pacote, só com as dependências de produção
  instalador/remover-versao-pwa.ps1         remove a instalação PWA antiga, preservando o cadastro
  assets/installer.nsh                      personalização do NSIS: remoção da PWA, página de perfil (com a caixa
                                            Terceiro) e remoção do Git AutoSync junto
  electron-builder.yml                      identidade, recursos e alvos do instalador
```

Os testes ficam ao lado do arquivo que testam (`x.ts` e `x.test.ts`), e o `npm test`
acha todos pelo nome.

As rotas dependem só das interfaces de repositório — `RepositorioClientes`,
`RepositorioConfiguracao`, `RepositorioLocal`, `RepositorioLembretes` e
`RepositorioContatos`; as de notificações passam pela `CentralDeNotificacoes`, que
depende de `RepositorioNotificacoes`, e as do Git AutoSync pelo `ServicoDoAutosync`,
que depende da interface `CliDoAutosync` —, e nunca das implementações em arquivo ou
em processo.
Trocar o armazenamento local por outro — banco, API remota — é implementar essas
interfaces e injetá-las no `index.ts`.

O servidor não tem etapa de build: os arquivos `.ts` rodam direto, no Node 22.18
ou mais novo em desenvolvimento e no Node embutido no Electron no aplicativo. O
`npm run typecheck` existe para conferir os tipos que o Node ignora ao apagá-los.
O shell em `desktop/` é compilado pelo próprio `tsc` para `desktop/dist/`.
