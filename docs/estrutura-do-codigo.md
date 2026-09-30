# Estrutura do código

Mapa dos arquivos, para quem vai mexer no HUB SNK. Para usar o programa, veja o
[README](../README.md).

```
src/
  index.ts                                  sobe o Fastify e serve public/
  configuracao.ts                           porta, host, diretório de dados e perfil do instalador
  acessos.ts                                preset de funcionalidades ocultas de cada perfil
  tipos.ts                                  os tipos do domínio: cadastro (Cliente, Base, BancoDeDados, RepositorioGit,
                                            Projeto), configuração global e acessos, situação do Git, bases e bancos
                                            locais, Agenda de Recursos, OS da Experience, notificações, lembretes e contatos
  repositorio/arquivoDeDados.ts             envelope com versaoDoEsquema, migração e escrita atômica
  repositorio/repositorioClientes.ts        contrato de persistência e erros de domínio
  repositorio/repositorioClientesArquivo.ts implementação em arquivo JSON local
  repositorio/repositorioConfiguracao.ts    contrato da configuração global
  repositorio/repositorioConfiguracaoArquivo.ts  configuração em arquivo JSON local
  repositorio/repositorioLocal.ts           contrato das bases e bancos da máquina
  repositorio/repositorioLocalArquivo.ts    bases e bancos locais em arquivo JSON
  repositorio/repositorioLembretes.ts       contrato dos lembretes
  repositorio/repositorioLembretesArquivo.ts  lembretes em arquivo JSON local
  repositorio/repositorioContatos.ts        contrato dos contatos
  repositorio/repositorioContatosArquivo.ts contatos em arquivo JSON local
  repositorio/repositorioNotificacoes.ts    contrato do painel de notificações
  repositorio/repositorioNotificacoesArquivo.ts  notificações e chaves emitidas em arquivo JSON
  rotas/protecaoDeOrigem.ts                 confere Host e Origin antes de qualquer rota
  rotas/autenticacaoDoPainel.ts             exige o token do shell em toda a API
  rotas/rotasClientes.ts                    rotas HTTP e validação de entrada
  rotas/rotasConfiguracao.ts                rotas da configuração global
  rotas/rotasGit.ts                         rota da situação dos repositórios locais
  rotas/rotasAtalhos.ts                     rota que dispara os atalhos cadastrados
  rotas/rotasLocal.ts                       rotas das bases e bancos da máquina
  rotas/rotasSistema.ts                     versão, sonda de vida, encerramento, seletores do SO e varredura
  rotas/rotasSankhya.ts                     credenciais, guias do Sankhya e sessão empurrada pelo shell
  rotas/rotasAgenda.ts                      Agenda de Recursos e situação do dia na Experience
  rotas/rotasOs.ts                          OS da Experience, geral e por cliente, consultadas ao vivo
  rotas/rotasNotificacoes.ts                painel de notificações, fluxo SSE e e-mail de teste
  rotas/rotasLembretes.ts                   cadastro dos lembretes e prévia do cron
  rotas/rotasContatos.ts                    cadastro dos contatos
  rotas/esquemaDeNotificacoes.ts            validação do SMTP e do alerta da agenda
  rotas/esquemaDeConfiguracaoMcp.ts         validação do .sankhya-mcp.env, comum ao repositório e à base local
  rotas/autenticacaoDoShell.ts              confere o token das rotas que só o shell desktop chama
  rotas/respostasDoShell.ts                 traduz a falha da ponte com o shell em resposta HTTP
  sankhya/ponteDoDesktop.ts                 cliente HTTP da ponte do shell desktop (127.0.0.1:4103)
  sankhya/sessaoDoDesktop.ts                JWT da Experience empurrado pelo shell, em memória
  sankhya/credenciais.ts                    credenciais do cofre do shell e consultas feitas por ele no ERP
  sankhya/agenda.ts  sankhya/agendaParser.ts   snapshot da Agenda de Recursos em SQLite
  sankhya/negociacoes.ts                    FAPs de um parceiro, a partir das negociações do ERP
  sankhya/consultasDaAgenda.ts              importar um período da agenda e a situação do dia do parceiro
  notificacoes/centralDeNotificacoes.ts     repetida descartada, e-mail, gravação e aviso ao painel
  notificacoes/enviadorDeEmail.ts           envio pelo SMTP da configuração (nodemailer)
  notificacoes/verificadorDaAgendaDoDia.ts  alerta de evento de hoje sem OS lançada, a cada 15 minutos
  notificacoes/disparoDeLembretes.ts        quando cada lembrete dispara (croner)
  notificacoes/agendadorDeLembretes.ts      confere os lembretes a cada 30 segundos e dispara os vencidos
  notificacoes/emailDoLembrete.ts           assunto, HTML com a logo e texto puro do e-mail do lembrete
  notificacoes/relogio.ts                   datas no fuso da máquina
  sankhya/experience.ts                     leitura da API da Experience com o JWT da guia
  git/executarGit.ts                        executa comandos git sem shell e sem prompt
  git/provedorDeHospedagem.ts               lê a URL do remoto: host, GitHub ou GitLab
  git/situacaoDoRepositorio.ts              diagnóstico de um repositório local
  git/cacheDeSituacao.ts                    cache por tempo e limite de leituras simultâneas
  sistema/observadorDeDados.ts              descarta o cache quando a pasta de dados muda no disco
  sistema/pasta.ts                          checagem de existência de diretório
  sistema/abrirPasta.ts                     abre uma pasta no gerenciador do SO
  sistema/abrirShell.ts                     abre o terminal do SO na pasta
  sistema/abrirIde.ts                        abre a pasta como projeto na IDE configurada
  sistema/abrirExecutavel.ts                inicia o programa de um atalho
  sistema/lancarProcesso.ts                 lança um programa e confere que ele de fato subiu
  sistema/selecionarArquivo.ts              abre o seletor de arquivo do SO
  sistema/selecionarPasta.ts                abre o seletor de pasta do SO
  sistema/arquivoMcp.ts                     lê e grava o .sankhya-mcp.env do repositório
  sistema/varreduraDeRepositorios.ts        procura repositórios Git dentro das pastas escolhidas
  sistema/ultimaVersaoPublicada.ts          consulta a última release no GitHub, com cache
  sistema/comparacaoDeVersao.ts             diz se a versão publicada é mais nova que a instalada
  sistema/wildfly.ts  sistema/docker.ts     situação das bases e dos bancos locais
  sistema/logDaBase.ts                      final do server.log de uma base local e o que chega depois, para o log ao vivo
  sistema/baseDoCliente.ts                  checagem HTTP da base de um cliente
  sistema/versaoDaPlataforma.ts             versão da plataforma lida da página inicial do Sankhya
  sistema/historicoDeSituacaoDaBase.ts      amostras de situação de cada base local, em memória, para o gráfico de uptime
  sistema/historicoDeSituacaoDoBanco.ts     o mesmo para cada banco local
  sistema/historicoDeSituacaoDaBaseDoCliente.ts  o mesmo para cada base de cliente
public/
  index.html  styles.css  app.js            interface, sem framework e sem build
  buscaRapida.js                            índice e ordenação dos resultados da busca rápida (Ctrl+K)
  leitorDeFavoritos.js                      lê o arquivo de favoritos de qualquer navegador suportado
  leitorDeArquivoDeCadastros.js             lê o .txt de cadastros gerado pelo Exportar e pelo Compartilhar
  tipoDeBaseNoNome.js                       tira Produção/Teste do nome do favorito
  log.html  log.js                          log ao vivo de uma base local, em janela própria
desktop/                                    shell Electron: o aplicativo que o usuário instala
  src/main.ts                               boot: ponte, backend, janela, guias e menu
  src/nomeDoApp.ts                          nome, perfil e trava próprios em desenvolvimento
  src/backendProcess.ts                     sobe o src/index.ts no Node do Electron e o encerra pela API
  src/config.ts                             endereços, portas e caminhos, em desenvolvimento e empacotado
  src/tabs.ts                               guias fixas e por base, política de pop-up e de links
  src/bridgeServer.ts                       ponte que o backend chama: cofre, guias e consultas ao ERP
  src/tokenStore.ts                         token compartilhado entre a ponte e o backend, gerado no primeiro boot
  src/cofreCredenciais.ts                   cofre das credenciais com o safeStorage do Electron
  src/navegador.ts  src/sessions.ts         abrir as guias do Sankhya e capturar a sessão delas
  src/autoLoginSankhya.ts                   login automático nas guias SankhyaOm e Experience com a credencial do cofre
  src/loginOcultoSankhya.ts                 janela invisível e preenchimento do login web, comuns às janelas ocultas
  src/janelaAgendaOculta.ts                 janela oculta que loga no ERP e consulta a Agenda de Recursos e as negociações
  src/janelaExperienceOculta.ts             janela oculta que loga na Experience e mantém o JWT para o backend
  src/autofill.ts                           preenche o login da guia de uma base de cliente
  src/backendClient.ts                      empurra a sessão da Experience para o backend
  src/log.ts                                desktop.log, com redação de senha, token, JWT e e-mail
  src/menu.ts  src/preload.ts  index.html  renderer.js   menu e a barra de guias
  src/buscaRapida.ts                        abre a busca rápida do painel e executa os itens dela, pelo executeJavaScript
  src/janelaDeAtalhos.ts  atalhos.html  atalhos.js   janela de Ajuda › Atalhos, com as teclas lidas do menu
  src/atalhoGlobal.ts                       liga e desliga o atalho global da busca, com a escolha gravada
  src/bandeja.ts                            ícone na bandeja, com a busca, o atalho global e o início automático
  src/inicioAutomatico.ts                   liga e desliga o início do HUB SNK junto com o Windows
  scripts/preparar-hub.mjs                  monta o backend do pacote, só com as dependências de produção
  scripts/preparar-autosync.mjs             monta os binários do Git AutoSync para o instalador
  instalador/remover-versao-pwa.ps1         remove a instalação PWA antiga, preservando o cadastro
  assets/installer.nsh                      personalização do NSIS: remoção da PWA, página de perfil (com a caixa
                                            Terceiro) e página do Git AutoSync
  electron-builder.yml                      identidade, recursos e alvos do instalador
```

As rotas dependem só das interfaces de repositório — `RepositorioClientes`,
`RepositorioConfiguracao`, `RepositorioLocal`, `RepositorioLembretes` e
`RepositorioContatos`; as de notificações passam pela `CentralDeNotificacoes`, que
depende de `RepositorioNotificacoes` —, e nunca das implementações em arquivo.
Trocar o armazenamento local por outro — banco, API remota — é implementar essas
interfaces e injetá-las no `index.ts`.

O servidor não tem etapa de build: os arquivos `.ts` rodam direto, no Node 22.18
ou mais novo em desenvolvimento e no Node embutido no Electron no aplicativo. O
`npm run typecheck` existe para conferir os tipos que o Node ignora ao apagá-los.
O shell em `desktop/` é compilado pelo próprio `tsc` para `desktop/dist/`.
