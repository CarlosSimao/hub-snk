# Changelog

Tudo que muda de uma versão para outra, escrito para quem usa o HUB SNK.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a
numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/) — veja
em [Regra de versão](docs/manutencao.md#regra-de-versão) o que cada parte do
número significa aqui.

## [Não publicado]

## [1.1.0] - 2026-08-13

### Adicionado

- **Exportar cadastros para arquivo**, no botão ao lado do **Importar**, no pé da
  lista de clientes. Um assistente de duas etapas: marcar os clientes e escolher
  o que sai de cada um. Nome do cliente, URL e tipo de cada base sempre saem;
  **Credenciais** acrescenta usuário e senha, e **Banco** acrescenta os dados do
  banco vinculado. As duas colunas têm marcar e desmarcar todos, e ficam
  bloqueadas no cliente que não tem o que exportar nelas.

- **Importar cadastros de arquivo do HUB SNK**, opção nova do assistente de
  importação. Lê tanto o arquivo do **Exportar** quanto o `.txt` do
  **Compartilhar** de um cliente — o formato é o mesmo. A etapa de conferência
  mostra o que entra direto e, para cada base cuja URL já está cadastrada, o
  cadastro atual e o importado lado a lado, com a marca **diferente** em cada
  campo que muda. Toda decisão nasce em "manter o atual", e há **Manter todos os
  atuais** e **Substituir todos** para decidir em bloco.

  Substituir troca só o que o arquivo trouxe: exportação sem "Credenciais"
  preserva o usuário e a senha já gravados, e sem "Banco" preserva o banco
  vinculado — campo não exportado não é campo apagado.

- **Atalho e início na sessão no macOS**, que antes não existiam. O instalador
  criava um `.desktop` do XDG nos dois casos — arquivo que o macOS ignora em
  silêncio —, e o Mac ficava sem atalho e sem início automático mesmo tendo
  respondido _Sim_. Agora o atalho é um `HUB SNK.app` em `~/Applications`, e o
  início na sessão é um LaunchAgent em `~/Library/LaunchAgents`, carregado na
  hora. A desinstalação remove os dois.

- **Janela própria no macOS** ao rodar `node src/index.ts` direto do pacote. A
  procura por navegador só conhecia nome de comando do Linux, que no macOS nunca
  existe, e a tela sempre acabava numa aba comum. Agora o Chrome, o Chromium, o
  Edge e o Brave são procurados como aplicativo, em `/Applications` e em
  `~/Applications`.

### Corrigido

- **Botão que dizia ter aberto o programa sem ter aberto.** Abrir a pasta, o
  terminal, o IntelliJ ou um atalho respondia sucesso assim que o processo
  nascia — ou mesmo sem ele nascer. Sem `xdg-open` no Linux, o botão **Arquivos**
  não fazia nada e a falha só aparecia no log do servidor. Agora o HUB SNK espera
  um instante para ver se o programa sobreviveu e mostra o aviso na tela quando
  ele não subiu.

- **Terminal que não abria no Linux mesmo havendo um instalado.** O primeiro
  candidato da lista encerrava a busca por ter nascido, ainda que morresse no
  argumento seguinte — o caso do `x-terminal-emulator` apontando para um emulador
  que não aceita `--working-directory`. Agora a busca continua até um deles de
  fato abrir.

- **Atalho do menu quebrado quando a pasta de instalação tinha espaço no nome**,
  no Linux: o `Exec` do `.desktop` agora leva o caminho entre aspas.

- **Atualização que deixava arquivo velho para trás.** Reinstalar copiava por
  cima sem apagar nada, então um arquivo removido do projeto sobrevivia dentro de
  `src` ou `public` na sua instalação. Agora cada item do pacote é removido antes
  de ser copiado. Só o que o pacote traz é tocado: instalação numa pasta com
  outras coisas dentro não perde nada. Vale para os dois instaladores.

- **Ligar o banco local no Linux, que nem tentava subir o Docker.** A ação
  respondia direto que a inicialização automática não era suportada. Agora o HUB
  SNK sobe o serviço de usuário do systemd — `docker-desktop` e, na falta dele, o
  `docker` rootless —, os dois sem root. O Docker Engine como serviço do sistema
  continua de fora, porque exige `sudo`; nesse caso a mensagem mostra o comando.

- **Launcher do Linux sem `pgrep`, que subia um segundo servidor em cima do
  primeiro.** Sem o comando, a busca por processo devolvia vazio em vez de erro:
  o `hub-snk.sh` achava que nada estava no ar e falhava com `EADDRINUSE`, e o
  `parar` informava que nada estava rodando. Agora o launcher e o instalador
  conferem o `pgrep` antes de qualquer coisa e dizem qual pacote instalar.

- **Atalho para script no macOS, que abria no editor em vez de rodar.** Todo
  atalho era entregue ao `open`, que decide pela associação de tipo — e a de um
  `.sh` costuma ser o Xcode ou o bloco de notas. Agora o arquivo com bit de
  execução é chamado direto, como já era no Linux. O pacote `.app` e o
  `.command` seguem com o `open`, que é quem sabe iniciá-los.

## [1.0.0] - 2026-08-10

Primeira versão distribuída ao time.

### O que o HUB SNK faz

- **Cadastro de clientes**, com as bases e os repositórios Git de cada um. Roda
  na sua máquina, sem Docker, sem banco de dados e sem autenticação.

- **Diagnóstico dos repositórios Git**: cada repositório com caminho local ganha
  um selo com a branch atual e a pendência mais grave — pasta ausente, remoto
  faltando, merge pela metade, conflito, `.sankhya-mcp.env` rastreado, arquivo
  não commitado, commit não enviado, branch sem upstream, stash pendente. Cada
  item vem com o comando que resolve. Nada disso usa a rede.

- **Bases locais**: ligam, param e reiniciam o WildFly da máquina, com a situação
  do serviço, o log ao vivo e o `.sankhya-mcp.env` da instalação.

- **Atalhos** para programas da máquina, e botões para abrir a pasta, o
  terminal e o IntelliJ de cada repositório. A lista ganha uma busca por nome e
  caminho quando passa de cinco atalhos.

- **Seletor de pasta do sistema** nos campos de caminho — o do repositório e o
  do WildFly da base local —, porque o navegador não entrega o caminho absoluto
  de uma pasta escolhida.

- **Aviso de versão nova** no rodapé, comparando a versão em uso com a última
  release publicada no GitHub.

### Instalação

- Pacotes para Windows (`.zip`), Linux e macOS (`.tar.gz`), anexados a cada
  release. **Node.js 22.18 ou mais novo é pré-requisito** — o Node não vai
  dentro dos pacotes.

- Dá para usar sem instalar: `node src\index.ts` da pasta descompactada sobe o
  servidor e abre a janela do HUB SNK sozinho, sem barra de endereço e sem abas.
  No Linux e no macOS, `./hub-snk.sh` faz o mesmo.

- Instalação por script — `instalar-hub-snk.bat` no Windows,
  `./instalar-hub-snk.sh` no Linux e no macOS —, com atalho e início automático
  na sessão. Pergunta a pasta do programa e os cinco parâmetros do servidor
  (`HUB_PORTA`, `HUB_HOST`, `HUB_PERMITIR_REDE`, `HUB_DADOS_DIR` e
  `HUB_NAVEGADOR`), cada um com o valor padrão pronto. As respostas ficam num
  `hub-snk.env` legível, que o launcher lê a cada abertura.

  > No Windows 11, desbloqueie o `.zip` nas propriedades **antes** de
  > descompactar: sem isso o Controle Inteligente de Aplicativos barra os
  > scripts.

- Remoção por script, que encerra o servidor, apaga atalhos, programa e
  configuração, e **deixa o cadastro onde está**.

### Dados

- Os arquivos de dados são gravados num envelope com `versaoDoEsquema`. Um
  cadastro gravado por uma versão mais nova é recusado com aviso, em vez de ter
  o que não se reconhece descartado em silêncio. Formato antigo é migrado na
  primeira abertura, com cópia de segurança antes de qualquer reescrita.

- O cadastro mora fora da pasta do programa: atualizar e desinstalar não o
  tocam. `HUB_DADOS_DIR` aponta para outro lugar — uma pasta de nuvem, por
  exemplo, que é o que dá backup.

### Segurança

- Toda requisição tem os cabeçalhos `Host` e `Origin` conferidos antes de chegar
  às rotas. Isso barra um site aberto no seu navegador chamando a API local, e
  um domínio apontado para `127.0.0.1`. A API não tem autenticação, devolve as
  senhas do cadastro e abre programas da máquina — sem a conferência, estar no
  loopback não bastava.

- `HUB_HOST` fora do loopback não sobe sozinho: precisa de
  `HUB_PERMITIR_REDE=1`, dito de propósito. A instalação mostra o que a
  exposição significa antes de gravar.

[não publicado]: https://github.com/CarlosSimao/hub-snk/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/CarlosSimao/hub-snk/releases/tag/v1.0.0
