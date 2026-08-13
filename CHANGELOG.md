# Changelog

Tudo que muda de uma versão para outra, escrito para quem usa o HUB SNK.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a
numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/) — veja
em [Regra de versão](docs/manutencao.md#regra-de-versão) o que cada parte do
número significa aqui.

## [Não publicado]

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

[não publicado]: https://github.com/CarlosSimao/hub-snk/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CarlosSimao/hub-snk/releases/tag/v1.0.0
