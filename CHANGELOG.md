# Changelog

Tudo que muda de uma versão para outra, escrito para quem usa o HUB SNK.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a
numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/) — veja
em [Regra de versão](docs/manutencao.md#regra-de-versão) o que cada parte do
número significa aqui.

## [Não publicado]

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

[não publicado]: https://github.com/CarlosSimao/hub-snk/compare/v1.1.1...HEAD
[1.1.1]: https://github.com/CarlosSimao/hub-snk/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/CarlosSimao/hub-snk/releases/tag/v1.0.0
