# HUB SNK

[![Versão](https://img.shields.io/github/v/release/CarlosSimao/hub-snk?label=vers%C3%A3o)](https://github.com/CarlosSimao/hub-snk/releases)
[![Licença](https://img.shields.io/github/license/CarlosSimao/hub-snk)](LICENSE)

Hub local de cadastro de clientes, das bases e dos repositórios Git de cada
um, com o Sankhya Om e a Experience abertos em guias do próprio aplicativo. Roda
na sua máquina, sem Docker, sem banco de dados e sem autenticação.

É um aplicativo desktop (Electron) para Windows. O pacote para Linux está em
preparação, e o macOS não tem distribuição a partir da versão 2.

![Tela do HUB SNK com a lista de clientes cadastrados](docs/img/screenshot.png)

---

## Vídeos

Gravações de tela, hospedadas no Drive da empresa — **é preciso estar logado com
a conta corporativa** para abrir.

1. [Instalação](https://drive.google.com/file/d/1fl85T-dmL1fFpGBBf9L0FtIEaW4gbl4q/view?usp=drive_link)
   — da versão 1, com o instalador por script, que não existe mais. Para a versão
   atual, siga a seção [Instalação](#instalação) abaixo.
2. [Funcionalidades](https://drive.google.com/file/d/1DzZlq7BkFz8LhVUXN41SAo9PKB795mB7/view?usp=sharing)
   — o dia a dia: cadastro de clientes, bases, repositórios e atalhos.
3. [Funcionalidades tech](https://drive.google.com/file/d/1ognNxuQbAoATqLoMZ7wzFszq9bB2B6MZ/view?usp=drive_link)
   — o que está por baixo: diagnóstico Git, bases e bancos locais,
   `.sankhya-mcp.env`.

---

## Instalação

Baixe o `HUB-SNK-Setup-<versão>.exe` na
[página de releases](https://github.com/CarlosSimao/hub-snk/releases) e rode.

- Instala só para o seu usuário, em `%LOCALAPPDATA%\Programs\HUB SNK`, **sem
  pedir administrador**.
- Não exige Node.js: o backend roda no Node que vem dentro do aplicativo.
- Cria os atalhos "HUB SNK" no menu Iniciar e na área de trabalho.
- Uma das telas oferece instalar junto o **Git AutoSync** (commit e push
  automáticos dos repositórios), com tarefa diária, ícone na bandeja, atalhos,
  skill para os agentes de IA e entrada no PATH. Ele exige o Git instalado; sem o
  Git, o HUB SNK é instalado do mesmo jeito e o Git AutoSync fica de fora.

> O instalador não é assinado digitalmente. Na primeira execução, o SmartScreen
> pode mostrar _"O Windows protegeu o computador"_: clique em _Mais informações_ ›
> _Executar assim mesmo_.

### Quem já usava a versão 1 (PWA)

O instalador remove a versão antiga sozinho, e **o cadastro fica onde está** —
`%LOCALAPPDATA%\HubSnk\dados` é a mesma pasta nas duas versões. Ele encerra o
servidor antigo, apaga o programa, o `hub-snk.env` e os atalhos antigos, e move o
que não era do pacote (os logs do WildFly que caíam na pasta do programa, por
exemplo) para `%LOCALAPPDATA%\HubSnk\restos-da-versao-pwa-<data>`. O que foi
feito fica registrado em `%LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log`.

Se o cadastro estava numa pasta escolhida à mão (`HUB_DADOS_DIR` no
`hub-snk.env`), o aplicativo novo continua usando essa pasta.

### Atualizar e desinstalar

Para atualizar, rode o instalador da versão nova por cima. Para desinstalar, use
_Configurações_ › _Aplicativos_ › _HUB SNK_. Nos dois casos o cadastro não é
apagado; na desinstalação, o instalador pergunta se o Git AutoSync sai junto.

---

## Como é o aplicativo

A janela tem guias no topo:

| Guia                | O que é                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Painel**          | O HUB SNK: clientes, bases, repositórios, ambiente local e agenda                            |
| **Sankhya Om**      | O ERP. O login feito aqui é o que o HUB SNK usa para consultar a Agenda de Recursos          |
| **Experience**      | A Experience. O HUB SNK lê a sessão desta guia sozinho, sem precisar capturar nada           |
| Uma por base aberta | Cada base de cliente abre na sua própria guia, isolada das outras, com o login já preenchido |

Links que não são de uma base cadastrada (Jira, GitHub, documentação) abrem no
navegador do sistema. O menu _Guias_ esconde e mostra cada guia, e _Ajuda_ ›
_Abrir o painel no navegador_ abre o painel fora do aplicativo.

---

## Configuração

O aplicativo não precisa de configuração: porta, endereço e pasta de dados são
fixos. Para quem desenvolve ou precisa mudar alguma coisa, estas variáveis de
ambiente valem antes de abrir o aplicativo:

| Variável                 | Padrão                               | O que faz                                                                      |
| ------------------------ | ------------------------------------ | ------------------------------------------------------------------------------ |
| `HUB_DADOS_DIR`          | `%LOCALAPPDATA%\HubSnk\dados`        | Onde o cadastro é gravado                                                      |
| `SANKHYA_HUB_URL`        | `http://127.0.0.1:4100`              | Endereço do backend. A porta daqui é a porta em que o aplicativo o sobe        |
| `SANKHYA_HUB_BACKEND`    | `gerenciado`                         | `externo` faz o aplicativo usar um backend que já esteja no ar (`npm run dev`) |
| `SANKHYA_ERP_URL`        | `https://skw.sankhya.com.br/mge/`    | Endereço da guia Sankhya Om                                                    |
| `SANKHYA_EXPERIENCE_URL` | `https://experience.sankhya.com.br/` | Endereço da guia Experience                                                    |

Rodando só o backend (`npm run dev`, veja [Manutenção](docs/manutencao.md)),
valem `HUB_PORTA` (padrão `4100`), `HUB_HOST` (padrão `127.0.0.1`, e só aceita
loopback) e `HUB_DADOS_DIR` (padrão `./dados-hub-snk`).

Apontar a pasta de dados para dentro de uma pasta de nuvem é o que dá backup —
veja [Backup na nuvem](docs/funcionalidades.md#backup-na-nuvem).

---

## Segurança

O backend escuta só em `127.0.0.1`, e a razão é o que ele faz: **não tem
autenticação**, devolve o cadastro inteiro — senhas em texto puro incluídas — a
quem pedir, e abre programas do seu computador (IntelliJ, DataGrip, terminal,
gerenciador de arquivos) a pedido de quem chama a API. Um `HUB_HOST` fora do
loopback é recusado na largada.

Além disso, o backend confere se cada requisição veio mesmo da própria máquina e
recusa o resto — inclusive um site aberto no seu navegador tentando falar com o
programa. As rotas que só o aplicativo chama (sessão da Experience, senha para o
login automático, encerramento) exigem ainda um token que só ele lê. Como a
conferência funciona está em [docs/api.md](docs/api.md#conferência-de-origem).

As credenciais do Sankhya ERP e da Experience ficam no cofre do sistema
operacional, cifradas pelo aplicativo — nunca em texto puro.

---

## Onde ficam os dados

Tudo o que você cadastra fica em `%LOCALAPPDATA%\HubSnk\dados` — ou onde o
`HUB_DADOS_DIR` apontar. São o cadastro de clientes, a configuração global, as
bases e bancos da própria máquina e o `sankhya.db` com a Agenda de Recursos.

Os logs do aplicativo ficam em `%APPDATA%\HUB SNK\log` (`desktop.log` e
`backend.log`). O formato dos arquivos de dados está em
[docs/formato-dos-dados.md](docs/formato-dos-dados.md).

---

## Funcionalidades

| O quê                       | Resumo                                                                                                                           |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Cadastro de clientes**    | Bases do ERP com usuário, senha e banco vinculado, repositórios Git, links avulsos, projetos e anotações livres                  |
| **Guias do Sankhya**        | Sankhya Om e Experience dentro do aplicativo; cada base de cliente numa guia isolada, com usuário e senha preenchidos            |
| **Agenda de Recursos**      | Consultada de dentro da guia do Sankhya Om já logada, cruzada com a Experience no calendário de cada cliente                     |
| **Importação de favoritos** | Transforma favoritos do Chrome, Edge, Opera, Firefox ou Safari em bases, deduzindo Produção ou Teste do nome                     |
| **Botões do repositório**   | Abrem a pasta, o terminal (rodando o script padrão) e o IntelliJ; e editam o `.sankhya-mcp.env` do MCP Claude                    |
| **Atalhos**                 | Lista de programas da sua máquina, iniciados com um clique pelo botão de raio, com busca a partir de seis cadastrados            |
| **Bases locais (Local)**    | Ligam, param e reiniciam o WildFly da sua máquina, com a situação do serviço, o log ao vivo e o `.sankhya-mcp.env` da instalação |
| **Bancos locais (Local)**   | Ligam, param e reiniciam o container Docker do banco, conferindo se ele responde login com as credenciais cadastradas            |
| **Diagnóstico Git**         | Selo por repositório com a branch e a pendência mais grave — commit faltando, conflito, segredo rastreado —, atualizado sozinho  |
| **Git AutoSync**            | Opcional, no instalador: commit e push automáticos dos repositórios, com tarefa diária e ícone na bandeja                        |
| **Backup na nuvem**         | Não é embutido: aponte a pasta de dados para o Drive, o OneDrive ou o Dropbox que você já usa                                    |

As bases e os bancos locais ficam no botão **Local**, no topo do painel, ao lado
de _Clientes_: é o ambiente de desenvolvimento da sua própria máquina, separado do
cadastro dos clientes. Ligar o banco sobe o Docker antes, se ele estiver parado,
e parar o WildFly usa o desligamento limpo do próprio servidor, não um
encerramento forçado.

Cada uma em detalhe, com as regras, em
[docs/funcionalidades.md](docs/funcionalidades.md).

> Os arquivos da pasta de dados sobem para a nuvem **como estão no disco**, e o
> cadastro guarda as senhas das bases e dos bancos em texto puro. Confira se a
> pasta não está compartilhada com ninguém.

---

## Solução de problemas

| Sintoma                                                       | O que fazer                                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| _"HUB SNK — o backend não subiu"_ ao abrir                    | A porta 4100 está ocupada por outro programa, ou o backend falhou. As últimas linhas estão na mensagem e em `backend.log`    |
| O painel avisa que o aplicativo HUB SNK não está respondendo  | O painel foi aberto fora do aplicativo (_Abrir o painel no navegador_). Credenciais, agenda e guias só funcionam dentro dele |
| A agenda diz que a tela da Agenda de Recursos não está aberta | Abra a Agenda de Recursos na guia Sankhya Om, com o login feito, e tente de novo                                             |
| Os botões de Git não fazem nada                               | O `git` precisa estar no PATH. Confira com `git --version` num terminal novo                                                 |
| Mensagem sobre esquema mais novo ao iniciar                   | O cadastro foi gravado por uma versão mais nova do HUB SNK. Instale a versão mais recente                                    |
| A instalação avisou que a versão antiga não foi removida      | O motivo está em `%LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log`. O aplicativo novo funciona mesmo assim                   |

Se não estiver na lista, [abra uma issue](https://github.com/CarlosSimao/hub-snk/issues/new/choose)
— citando a versão que aparece no rodapé da tela, e sem colar senha, host,
usuário ou nome de cliente: o repositório é público.

---

## Documentação técnica

Nada disto é necessário para usar o HUB SNK.

- [Funcionalidades em detalhe](docs/funcionalidades.md) — cada recurso, com as regras
- [API HTTP](docs/api.md) — as rotas, os corpos aceitos e a conferência de origem
- [Formato dos arquivos de dados](docs/formato-dos-dados.md) — o envelope, o esquema e a migração
- [Distribuição](docs/distribuicao.md) — como o aplicativo desktop e o instalador são montados
- [Estrutura do código](docs/estrutura-do-codigo.md) — mapa dos arquivos
- [Manutenção](docs/manutencao.md) — modo de desenvolvimento, padrões do código, regra de versão e publicação
- [Plano de migração para o Electron](docs/plano-migracao-electron.md) — decisões e o que foi validado em cada fase
- [CHANGELOG](CHANGELOG.md) — o que mudou em cada versão

---

## Licença

[MIT](LICENSE) — use, altere e distribua à vontade, sem garantia nenhuma.

## Autor

Feito por [Carlos Nascimento](https://github.com/CarlosSimao).
