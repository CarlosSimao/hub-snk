# Changelog

Tudo que muda de uma versão para outra, escrito para quem usa o HUB SNK.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a
numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/) — veja
em [Versões e releases](README.md#versões-e-releases) o que cada parte do número
significa aqui.

## [Não publicado]

## [1.0.0] - 2026-08-09

Primeira versão pública. O que já existia continua igual; esta entrada registra o
que mudou ao preparar a distribuição.

### Adicionado

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

### Segurança

- Toda requisição passa a ter os cabeçalhos `Host` e `Origin` conferidos antes de
  chegar às rotas. Isso barra um site aberto no seu navegador chamando a API
  local e um domínio apontado para `127.0.0.1`. A API não tem autenticação,
  devolve as senhas do cadastro e abre programas da máquina — sem a conferência,
  estar no loopback não bastava.
- `HUB_HOST` fora do loopback não sobe mais sozinho: precisa de
  `HUB_PERMITIR_REDE=1`, dito de propósito.

[não publicado]: https://github.com/CarlosSimao/hub-snk/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/CarlosSimao/hub-snk/releases/tag/v1.0.0
