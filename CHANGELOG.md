# Changelog

Tudo que muda de uma versão para outra, escrito para quem usa o HUB SNK.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a
numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/) — veja
em [Regra de versão](docs/manutencao.md#regra-de-versão) o que cada parte do
número significa aqui.

## [Não publicado]

## [3.1.1] - 2026-08-10

### Corrigido

- A desinstalação falhava com _"The process cannot access the file
  'hub-snk.log' because it is being used by another process"_. Quem segura o log
  é o `cmd.exe` que o launcher usa para redirecionar a saída do servidor, e o
  encerramento só derrubava o `node.exe`. Agora os dois são encerrados, e um
  arquivo que ainda assim ficar preso vira aviso em vez de interromper a
  remoção pela metade.

- Rodar o `desinstalar-hub-snk.bat` de dentro do pacote recém-baixado apagava a
  pasta baixada e deixava a instalação de pé, com o servidor rodando. As duas
  pastas têm quase o mesmo conteúdo, e a conferência não as distinguia. Agora o
  script reconhece que está no pacote e aponta o caminho da instalação, que
  passou a ser gravado no `hub-snk.env`. Vale para o `.sh` do Linux e do macOS
  também.

## [3.1.0] - 2026-08-10

### Alterado

- O navegador da janela passa a vir como `padrao` na primeira instalação, em vez
  do Edge: a tela abre no navegador que você já usa. Quem prefere a janela sem
  barra de endereço e sem abas escolhe `edge` ou `chrome` na hora, e a escolha
  volta como padrão na próxima instalação.

- As perguntas de sim ou não passam a mostrar `[S/N] (padrão: S)`, com o padrão
  escrito por extenso. O `[S/n]` anterior indicava a resposta de quem aperta
  Enter só pela caixa da letra, o que passa despercebido.

- Os instaladores do Windows e do Linux/macOS passam a fazer as mesmas
  perguntas, na mesma ordem e com a mesma redação. O `HUB_NAVEGADOR` aceita as
  mesmas três formas em todos os sistemas: `padrao` para o navegador do sistema,
  `auto` para o primeiro Chromium encontrado, ou um nome da lista — antes o
  `auto` existia só no Linux e no macOS. Só a pergunta do atalho continua
  diferente, porque menu Iniciar e menu de aplicativos não são a mesma coisa.

### Documentação

- O README explica como habilitar o `instalar-hub-snk.bat` no Windows 11:
  desbloquear o `.zip` nas propriedades **antes** de descompactar tira a marca de
  arquivo baixado, e o Controle Inteligente de Aplicativos deixa o script rodar.
  A ordem importa — a marca é por arquivo, e desbloquear depois exigiria repetir
  em cada um.

## [3.0.0] - 2026-08-10

### Removido

- O Node deixa de ir dentro dos pacotes. **A partir desta versão é preciso ter o
  Node.js 22.18 ou mais novo instalado** — <https://nodejs.org>. Era o binário
  que respondia por quase todo o tamanho do download: o pacote do Windows caiu de
  37 MB para 5,6 MB, e os de Linux e macOS de ~40 MB para 3,9 MB. Embutir também
  prendia a versão do Node à escolhida no dia do empacotamento.

### Alterado

- O comando para usar sem instalar passa a ser `node src\index.ts`, com o Node da
  sua máquina, no lugar do `.\node.exe src\index.ts`. Ele continua livre do
  Controle Inteligente de Aplicativos: o Node instalado é assinado e não carrega
  a marca de arquivo baixado.

- Launchers e instaladores conferem o Node antes de subir ou instalar e mandam
  para o `nodejs.org` quando ele falta ou é antigo demais. Sem isso, a ausência
  apareceria como `node: not found` no log, ou como erro de sintaxe em `.ts` num
  Node velho.

- O encerramento passa a identificar o servidor pelo `src/index.ts` da própria
  pasta, e não mais pelo executável: agora que o Node é o da máquina, o
  executável é o mesmo de qualquer outro projeto seu. Nenhum outro Node em
  execução é tocado, como antes.

> **Ao atualizar:** instale o Node 22.18 ou mais novo antes de trocar de versão.
> Quem já desenvolve na máquina provavelmente tem — confira com `node -v`.

## [2.1.0] - 2026-08-10

### Adicionado

- O servidor passa a abrir a janela do HUB SNK sozinho ao subir. É o que permite
  usar o pacote do Windows sem instalar nada: descompactar e rodar
  `.\node.exe src\index.ts` já leva à tela. `HUB_ABRIR_JANELA=0` desliga, e é o
  que os launchers usam — a janela quem abre é eles.

### Corrigido

- No Windows 11 com o Controle Inteligente de Aplicativos ligado, o
  `instalar-hub-snk.bat` era bloqueado como o `.exe` que ele substituiu: o
  bloqueio pega também script sem assinatura vindo da internet. O README passa a
  liderar com o caminho sem instalação, que roda pelo `node.exe` do pacote —
  assinado pela OpenJS Foundation, e por isso liberado. Para quem quer atalho e
  início no logon, os scripts continuam ali e voltam a funcionar desbloqueando o
  `.zip` nas propriedades antes de descompactar.

## [2.0.0] - 2026-08-10

### Removido

- O instalador `.exe` do Windows saiu da distribuição. O Controle Inteligente de
  Aplicativos do Windows 11 bloqueia executável sem assinatura digital, e
  assinar exige certificado pago com renovação anual. No lugar dele, o Windows
  passa a receber um `.zip` com scripts de instalação.

### Adicionado

- Instalação por script nas três plataformas: `instalar-hub-snk.bat` no Windows,
  `instalar-hub-snk.sh` no Linux e no macOS. A instalação pergunta a pasta do
  programa, os cinco parâmetros do servidor — `HUB_PORTA`, `HUB_HOST`,
  `HUB_PERMITIR_REDE`, `HUB_DADOS_DIR` e `HUB_NAVEGADOR` —, se cria atalho e se
  o servidor sobe junto com a sessão. Toda pergunta vem com um valor pronto
  entre colchetes: Enter em tudo instala como antes.

- `HUB_HOST` fora do loopback passa a ser tratado à parte na instalação: o
  script mostra o que a exposição significa e só grava com o
  `HUB_PERMITIR_REDE=1` confirmado na hora.

- Remoção por script: `desinstalar-hub-snk.bat` e `desinstalar-hub-snk.sh`
  encerram o servidor, apagam atalhos, programa, log e configuração, e deixam o
  cadastro onde está.

- No Linux e no macOS, a instalação passa a criar atalho no menu de aplicativos
  e, se pedido, entrada de início automático da sessão — o que antes só existia
  no Windows.

### Alterado

- As escolhas da instalação ficam num `hub-snk.env` legível, em
  `%LOCALAPPDATA%\HubSnk\` no Windows e em `~/.config/hub-snk/` no Linux e no
  macOS. Dá para editar à mão sem reinstalar, e reinstalar aproveita cada valor
  como padrão das perguntas. O `navegador.txt` das versões anteriores é lido uma
  última vez, para a escolha de navegador não se perder.

- A janela do aplicativo passa a abrir no endereço configurado, e não no
  `127.0.0.1` fixo: com `HUB_HOST` apontado para outro endereço, o atalho abria
  uma janela que não respondia.

- O README passa a tratar só de instalar e usar o HUB SNK pelos pacotes. Rodar a
  partir do clone, instalar a PWA pelo navegador e atualizar por `git pull` são
  assunto de quem mexe no código, e ficaram em
  [Manutenção](docs/manutencao.md). Os exemplos de configuração passam a mostrar
  o `hub-snk.env`, que é onde as variáveis moram numa instalação.

> **Ao atualizar:** desinstale a versão antiga pelo "Adicionar ou remover
> programas" do Windows antes de rodar o `instalar-hub-snk.bat`. O cadastro não
> é tocado por nenhum dos dois passos.

## [1.1.1] - 2026-08-10

### Corrigido

- O diagnóstico Git dizia "Sem pendências: tudo commitado e enviado" em
  repositório com commit feito e push esquecido. Agora ele conta os commits
  locais que ainda não foram para o remoto e avisa em amarelo, com o `git push`
  pronto para copiar. Branch sem upstream — cujos commits não existem em lugar
  nenhum além da máquina — também passou a ser acusada, com o
  `git push -u origin <branch>`. O caminho inverso, commits que já estão no
  remoto e ainda não vieram para cá, continua fora: medir isso exigiria rede.

- Os esquemas de validação foram migrados para a API do Zod 4, que já vinha
  instalado. As mensagens continuam as mesmas; a do tipo da base passou a
  aparecer também quando o campo vem ausente, e não só com valor fora da lista.

## [1.1.0] - 2026-08-10

### Adicionado

- Aviso de versão nova no rodapé. O HUB SNK compara a versão em uso com a última
  release publicada no GitHub e, quando existe versão mais nova, mostra um link
  para a página dela ao lado do número da versão. Sem internet, sem release nova
  ou com uma versão de desenvolvimento à frente da publicada, o rodapé fica como
  sempre foi.

- Escolha do navegador no instalador do Windows. Ele pergunta em qual navegador
  instalado o HUB SNK deve abrir — Edge, Chrome ou o navegador padrão do Windows
  — e o atalho passa a abrir a janela nele. Como os links dos clientes abrem na
  mesma janela, eles caem no navegador escolhido. Quem já tinha o HUB SNK
  instalado continua com o Edge, ou o Chrome quando não há Edge, até reinstalar.

### Corrigido

- No Windows, o seletor de pasta dos atalhos abria atrás da janela do HUB SNK e
  dava a impressão de que o botão não tinha feito nada. Agora ele vem para a
  frente.

## [1.0.0] - 2026-08-09

Primeira versão pública. O que já existia continua igual; esta entrada registra o
que mudou ao preparar a distribuição.

### Adicionado

- Instalador para Windows, anexado à release. Não pede senha de administrador e
  não exige Node.js instalado — leva o próprio. Oferece atalho na área de
  trabalho e início automático no logon, e abre o HUB SNK em janela própria, sem
  barra de endereço.
- Pacotes para Linux e macOS (Intel e Apple Silicon), também com o Node
  embutido: descompactar e rodar `./hub-snk.sh`.
- Rodapé com a versão em uso, crédito e link para reportar problema. Cite a
  versão do rodapé ao abrir uma issue.
- Campo `versaoDoEsquema` nos arquivos de dados. O HUB SNK passa a recusar abrir
  um cadastro gravado por uma versão mais nova do que a sua, em vez de descartar
  em silêncio o que não reconhece.
- Migração automática dos arquivos no formato antigo, com cópia de segurança em
  `<nome>.esquema0` antes de qualquer reescrita.
- Variável `HUB_PERMITIR_REDE`, exigida para escutar fora do `127.0.0.1`.
- Licença MIT, formulários de issue e canais de suporte.

### Alterado

- Os três arquivos de dados agora são gravados dentro de um envelope, com o
  conteúdo sob as chaves `clientes`, `configuracao` e `local`. A migração é
  automática na primeira abertura.
- Os arquivos de dados passam a ser lidos na inicialização: problema no cadastro
  aparece no terminal na largada, não na primeira tela aberta.
- O README passa a tratar só do uso do programa. A referência da API, o formato
  dos arquivos de dados e o mapa do código foram para `docs/`, junto com um guia
  de solução de problemas e as instruções de atualização.

### Segurança

- Toda requisição passa a ter os cabeçalhos `Host` e `Origin` conferidos antes de
  chegar às rotas. Isso barra um site aberto no seu navegador chamando a API
  local e um domínio apontado para `127.0.0.1`. A API não tem autenticação,
  devolve as senhas do cadastro e abre programas da máquina — sem a conferência,
  estar no loopback não bastava.
- `HUB_HOST` fora do loopback não sobe mais sozinho: precisa de
  `HUB_PERMITIR_REDE=1`, dito de propósito.

[não publicado]: https://github.com/CarlosSimao/hub-snk/compare/v3.1.1...HEAD
[3.1.1]: https://github.com/CarlosSimao/hub-snk/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/CarlosSimao/hub-snk/compare/v1.1.1...v2.0.0
[1.1.1]: https://github.com/CarlosSimao/hub-snk/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/CarlosSimao/hub-snk/releases/tag/v1.0.0
