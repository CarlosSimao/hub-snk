# Estrutura do código

Mapa dos arquivos, para quem vai mexer no HUB SNK. Para usar o programa, veja o
[README](../README.md).

```
src/
  index.ts                                  sobe o Fastify e serve public/
  configuracao.ts                           porta, host e diretório de dados
  tipos.ts                                  os tipos Cliente, Base e RepositorioGit
  repositorio/arquivoDeDados.ts             envelope com versaoDoEsquema, migração e escrita atômica
  repositorio/repositorioClientes.ts        contrato de persistência e erros de domínio
  repositorio/repositorioClientesArquivo.ts implementação em arquivo JSON local
  repositorio/repositorioConfiguracao.ts    contrato da configuração global
  repositorio/repositorioConfiguracaoArquivo.ts  configuração em arquivo JSON local
  repositorio/repositorioLocal.ts           contrato das bases e bancos da máquina
  repositorio/repositorioLocalArquivo.ts    bases e bancos locais em arquivo JSON
  rotas/protecaoDeOrigem.ts                 confere Host e Origin antes de qualquer rota
  rotas/rotasClientes.ts                    rotas HTTP e validação de entrada
  rotas/rotasConfiguracao.ts                rotas da configuração global
  rotas/rotasGit.ts                         rota da situação dos repositórios locais
  rotas/rotasAtalhos.ts                     rota que dispara os atalhos cadastrados
  rotas/rotasLocal.ts                       rotas das bases e bancos da máquina
  rotas/rotasSistema.ts                     versão, sonda de vida, encerramento, seletores do SO e varredura
  rotas/rotasSankhya.ts                     credenciais, guias do Sankhya e sessão empurrada pelo shell
  rotas/rotasAgenda.ts                      Agenda de Recursos e situação do dia na Experience
  rotas/autenticacaoDoShell.ts              confere o token das rotas que só o shell desktop chama
  rotas/respostasDoShell.ts                 traduz a falha da ponte com o shell em resposta HTTP
  sankhya/ponteDoDesktop.ts                 cliente HTTP da ponte do shell desktop (127.0.0.1:4103)
  sankhya/sessaoDoDesktop.ts                JWT da Experience empurrado pelo shell, em memória
  sankhya/credenciais.ts                    credenciais e consultas feitas de dentro da guia do ERP
  sankhya/agenda.ts  sankhya/agendaParser.ts   snapshot da Agenda de Recursos em SQLite
  sankhya/negociacoes.ts                    FAPs de um parceiro, a partir das negociações do ERP
  sankhya/experience.ts                     leitura da API da Experience com o JWT da guia
  git/executarGit.ts                        executa comandos git sem shell e sem prompt
  git/provedorDeHospedagem.ts               lê a URL do remoto: host, GitHub ou GitLab
  git/situacaoDoRepositorio.ts              diagnóstico de um repositório local
  git/cacheDeSituacao.ts                    cache por tempo e limite de leituras simultâneas
  sistema/observadorDeDados.ts              descarta o cache quando a pasta de dados muda no disco
  sistema/pasta.ts                          checagem de existência de diretório
  sistema/abrirPasta.ts                     abre uma pasta no gerenciador do SO
  sistema/abrirShell.ts                     abre o terminal do SO na pasta
  sistema/lancadorJetBrains.ts              descobre e dispara launchers das IDEs JetBrains
  sistema/abrirIntelliJ.ts                  abre a pasta como projeto no IntelliJ IDEA
  sistema/abrirExecutavel.ts                inicia o programa de um atalho
  sistema/selecionarArquivo.ts              abre o seletor de arquivo do SO
  sistema/selecionarPasta.ts                abre o seletor de pasta do SO
  sistema/arquivoMcp.ts                     lê e grava o .sankhya-mcp.env do repositório
  sistema/varreduraDeRepositorios.ts        procura repositórios Git dentro das pastas escolhidas
  sistema/ultimaVersaoPublicada.ts          consulta a última release no GitHub, com cache
  sistema/comparacaoDeVersao.ts             diz se a versão publicada é mais nova que a instalada
  sistema/wildfly.ts  sistema/docker.ts     situação das bases e dos bancos locais
public/
  index.html  styles.css  app.js            interface, sem framework e sem build
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
  src/cofreCredenciais.ts                   cofre das credenciais com o safeStorage do Electron
  src/navegador.ts  src/sessions.ts         abrir e capturar a sessão das guias do Sankhya
  src/agenda.ts                             Agenda de Recursos e negociações, de dentro da guia do ERP
  src/autofill.ts                           preenche o login da guia de uma base de cliente
  src/backendClient.ts                      empurra a sessão da Experience para o backend
  src/migracaoCofre.ts                      traz as credenciais do antigo hub-helper.ps1, uma vez
  src/menu.ts  src/preload.ts  index.html  renderer.js   menu nativo e a barra de guias
  scripts/preparar-hub.mjs                  monta o backend do pacote, só com as dependências de produção
  scripts/preparar-autosync.mjs             monta os binários do Git AutoSync para o instalador
  instalador/remover-versao-pwa.ps1         remove a instalação PWA antiga, preservando o cadastro
  assets/installer.nsh                      personalização do NSIS: remoção da PWA e página do Git AutoSync
  electron-builder.yml                      identidade, recursos e alvos do instalador
```

As rotas dependem apenas da interface `RepositorioClientes`. Trocar o
armazenamento local por outro — banco, API remota — é implementar essa interface
e injetá-la no `index.ts`; nada mais muda.

O servidor não tem etapa de build: os arquivos `.ts` rodam direto, no Node 22.18
ou mais novo em desenvolvimento e no Node embutido no Electron no aplicativo. O
`npm run typecheck` existe para conferir os tipos que o Node ignora ao apagá-los.
O shell em `desktop/` é compilado pelo próprio `tsc` para `desktop/dist/`.
