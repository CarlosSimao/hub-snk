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
  rotas/rotasSistema.ts                     versão, aviso de atualização, seletores do SO e varredura
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
  tipoDeBaseNoNome.js                       tira Produção/Teste do nome do favorito
  manifest.webmanifest  sw.js               o que torna o HUB SNK instalável
scripts/
  gerar-icones.mjs                          gera os PNG do manifest (npm run gerar-icones)
  sincronizar-versao-do-cache.mjs           alinha o cache do service worker à versão (npm version)
```

As rotas dependem apenas da interface `RepositorioClientes`. Trocar o
armazenamento local por outro — banco, API remota — é implementar essa interface
e injetá-la no `index.ts`; nada mais muda.

O servidor não tem etapa de build: a partir do Node 22.18 os arquivos `.ts`
rodam direto, e o `npm run typecheck` existe para conferir os tipos que o Node
ignora ao apagá-los.
