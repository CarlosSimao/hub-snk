# Changelog

Tudo que muda de uma versão para outra, escrito para quem usa o HUB SNK.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e a
numeração segue o [Versionamento Semântico](https://semver.org/lang/pt-BR/) — veja
em [Regra de versão](docs/manutencao.md#regra-de-versão) o que cada parte do
número significa aqui.

## [Não publicado]

### Adicionado

- **Lançar ocorrência pela Agenda** (contribuição de Flaviano): o botão **Lançar ocorrência**
  no cabeçalho da Agenda registra férias, folga e afins no ERP, sempre para o usuário
  logado, e atualiza a Agenda no mês lançado.
- **Downloads do HUB**: arquivos baixados pelas guias vão para a pasta Downloads, e um botão
  na barra de guias, como o do navegador, lista os arquivos e abre cada um com um clique.
- **Recarregar no kanban**: botão no quadro para reler as tarefas sem fechá-lo.
- **Google Agenda e Google Meet na barra lateral**: dois botões novos abaixo do Google Chat.
  Os dois abrem no painel, como o Gmail e o Chat. Entrar numa reunião (pelo Meet, pelo link
  da Agenda, do Gmail ou do Chat) abre a chamada numa janela própria, uma por reunião, que
  não some ao clicar numa guia. Ambos usam o mesmo login do Google e podem ser ocultados na
  engrenagem.
- **Cliente da agenda vira link**: na Agenda de Recursos e no Resumo do dia, o nome do
  parceiro já vinculado a um cliente abre o cadastro dele no HUB.

- **Backup e Google Drive**: aba **Backup** nas Configurações. Conecta a sua conta do Google
  com um clique (a autorização abre no navegador), mantém no Drive uma cópia sempre atual
  dos dados do HUB e faz backup periódico numa pasta à sua escolha, guardando as últimas
  cópias. A restauração, do Drive ou de um arquivo, é aplicada ao reiniciar, e os dados de
  antes ficam guardados. Falha de backup vira notificação.

- **Seus dados no instalador**: página nova, toda opcional, com nome, empresa, time e e-mail.
  Preenche os mesmos campos de Configurações quando ainda estão vazios; o que já foi
  editado lá não é trocado ao reinstalar ou atualizar.

### Alterado

- **Sankhya ID**: as credenciais do SankhyaOm e da Experience viraram um usuário e uma
  senha só, com o nome **Sankhya ID**. Quem já tinha credenciais salvas é migrado sozinho:
  vale o login do SankhyaOm, e as sessões capturadas continuam. Se os dois usuários eram
  diferentes, a tela avisa, e pode ser preciso salvar o Sankhya ID de novo. Uma senha
  recusada em qualquer um dos dois sistemas pausa o login automático nos dois.
- **Vínculo de cliente na Agenda**: vincular ou trocar o cliente do parceiro recarrega o
  card, com o link do título e a situação no Experience. Trocar agora tira o vínculo do
  cliente anterior, que antes podia continuar aparecendo no lugar do novo.
- **HUB já aberto**: abrir o aplicativo de novo traz a janela existente para a frente e
  mostra um aviso, sem criar um segundo ícone na bandeja.

## [2.6.0] - 2026-10-06

### Adicionado

- **Tags nas notificações do sino**: cada notificação mostra uma tag. Lembretes avulsos
  saem como `padrão`, o alerta de agenda sem tarefa na Experience como `OS`, e o aviso de
  versão disponível passa a chegar no sino com a tag `atualização`.
- **Copiar link**: os links do cliente e dos projetos ganharam um botão, só com ícone, que
  copia o endereço para a área de transferência.
- **E-mail em Configurações**: novo campo na aba Geral, ao lado de nome, empresa e time.
  Os quatro seguem com o relato de **Reportar problema ou sugerir**, e o e-mail passa a
  ser obrigatório para enviá-lo.

### Alterado

- Todo e-mail enviado pelo HUB SNK agora traz, no rodapé, quem enviou: nome, empresa e
  time preenchidos em Configurações.

## [2.5.0] - 2026-10-05

### Adicionado

- **Nome, empresa e time em Configurações**: três campos novos na aba Geral. Eles são
  obrigatórios para **Reportar problema ou sugerir**: sem os três preenchidos o envio é
  bloqueado e a mensagem diz o que falta. Os valores seguem com o relato e aparecem em
  **Ver o que será enviado**.

## [2.4.0] - 2026-10-05

### Adicionado

- **Reportar problema ou sugerir**: em Configurações › Sobre, o botão abre um diálogo que
  envia o relato em privado ao mantenedor, no lugar do link para issue pública e do
  e-mail. Se você deixar marcado, segue junto o final dos dois logs, compactado e com
  token, senha, e-mail e o nome da sua conta do Windows mascarados; **Ver o que será
  enviado** mostra exatamente o conteúdo antes de enviar. Nomes de cliente e de servidor
  que estiverem no log não podem ser mascarados automaticamente, e a tela avisa isso.
  Sem rede, o relato fica guardado e sai na próxima abertura do aplicativo.

### Alterado

- Os logs do aplicativo passam a ser rotacionados na abertura: ao passar de 5 MB, o
  arquivo é arquivado, e os 3 mais recentes são mantidos.

## [2.3.0] - 2026-10-01

### Adicionado

- **Guia avulsa**: no aplicativo desktop, o botão **+** ao lado das guias (ou `Ctrl+T`)
  abre uma guia de navegação livre no Google, com barra de endereço para ver e digitar a
  URL — domínio sem `https://` e termo de busca também valem —, voltar e avançar
  (`Alt+←`/`Alt+→`) e `×` para fechar. O login feito nela fica numa partição própria,
  separada da do Sankhya, e continua depois de reiniciar o aplicativo.
- **Recarregar sem cache**: `Ctrl+F5` (ou `Ctrl+Shift+R`, ou `Shift`+clique no botão de
  recarregar) recarrega a guia ativa buscando tudo de novo no servidor, como no Chrome.
  O clique direito numa guia oferece **Recarregar** e **Recarregar sem cache** para ela,
  mesmo que não seja a que está na tela.
- **Aviso do Windows para as notificações do HUB SNK**: lembrete, agenda sem tarefa na
  Experience e falha ao conferir a agenda aparecem como aviso do Windows, no canto
  inferior direito, como as mensagens do WhatsApp, e o ícone do HUB SNK pisca na barra
  de tarefas até a janela ganhar foco. Clicar no aviso abre o Painel com as
  notificações.
- **Sino piscando**: enquanto houver notificação não lida, o sino do Painel pisca até o
  painel de notificações abrir.
- **Link para a configuração que falta**: quando a Agenda, a OS ou o Resumo não carregam
  por falta de configuração — código de usuário do SankhyaOm, login do Sankhya ERP ou
  sessão da Experience —, a mensagem ganha o link **Abrir configuração**. O mesmo vale
  para a IDE não configurada (ou com caminho errado), o menu de atalhos vazio, o lembrete
  com e-mail marcado e SMTP incompleto e o e-mail não enviado no sino. Antes de abrir, o
  botão do topo onde a configuração fica — o cadeado de Credenciais Sankhya ou a
  engrenagem de Configurações — pisca, para você achá-lo da próxima vez; o modal abre já
  na aba e no campo certos. O **Abrir Configurações › Git** do AutoSync também pisca.
- **Carregamento da Agenda e da OS mais visível**: enquanto a consulta ao Sankhya roda,
  um indicador grande com **Atualizando da Sankhya…** cobre o calendário ou a lista de
  OS, no topo e no cadastro do cliente, e o conteúdo fica bloqueado até ela terminar. O
  cabeçalho da aba e a navegação entre abas continuam livres.
- **Kanban de tarefas nos projetos do cliente.** Com o documento de escopo (`.docx`,
  `.pdf`, `.md` ou `.txt`), o assistente de IA escolhido em **Configurações › IA**
  (Claude Code, Codex, OpenCode, Gemini CLI ou Cursor Agent) decompõe o escopo em
  tarefas; sem documento, o quadro começa vazio. Um kanban por projeto, com o nome
  dele, criado pelo **+** da seção **Kanban**; cinco colunas, arrastar e soltar e lista
  de verificação em cada tarefa.
- As tarefas ficam também num arquivo JSON na pasta do projeto, que o HUB SNK vigia e
  importa de volta, e num servidor MCP para agentes de IA. O quadro se atualiza sozinho
  quando o arquivo, o MCP ou a IA o mudam.
- A aba **Git** ganha o ícone de informação, com o que é o Git AutoSync e o link do
  repositório dele.

### Alterado

- **Primeira abertura**: com o cadastro de clientes vazio, o HUB SNK abre na aba
  **Clientes** e, para quem não é Terceiro, já com a janela de **Credenciais Sankhya**
  aberta.
- **Aba Git passa a se chamar Git AutoSync**, e o host e o token do GitLab saem de
  **Configurações › Git** para a engrenagem no canto superior direito da aba.
- **Configurações › IA**: assistente, modelo e nível de raciocínio lado a lado.
- **Alerta da agenda nasce sem e-mail**: em **Configurações › Avisos**, **Enviar por
  e-mail** vem desmarcado numa instalação nova. Quem já salvou a configuração mantém o
  que escolheu.
- **Sem o cartão abaixo do sino**: a notificação nova não abre mais o cartão que sumia
  sozinho no canto do Painel. Ela chega pelo aviso do Windows, pelo contador e pelo sino
  piscando, com o mesmo som.
- **Lembretes ganham aba própria**, no menu principal, entre **Contatos** e **Git**: a
  lista dos lembretes cadastrados, com **Novo lembrete**, editar e excluir, sai do botão
  **Lembretes** do sino e passa a ficar nela. As notificações dos lembretes continuam
  chegando no sino. Em **Configurações › Acessos**, a caixa **Lembretes** controla a aba
  e a seção do Resumo.
- **Cliente do contato criado pelo lembrete**: o **Adicionar contato** dos contatos em
  cópia do lembrete passa a mostrar o campo **Cliente**. Em lembrete de um cliente, ele
  oferece **Sem cliente** ou esse cliente, que já vem marcado; em lembrete sem cliente,
  qualquer cliente. Contato de outro cliente continua sem poder entrar em cópia de
  lembrete de um cliente. No cadastro de contato, a opção **Nenhum** passa a se chamar
  **Sem cliente**, como no filtro da aba Contatos.
- **Alerta da agenda passa a cobrar a tarefa, e não a OS**: em **Configurações › Avisos**,
  o alerta confere todos os eventos de hoje, e não só os que já terminaram, e avisa o
  evento de cliente cujo dia não tem tarefa nem OS na Experience. Tarefa aberta já conta
  como encaminhado. Novas opções:
  - **Periodicidade (minutos)**: de quanto em quanto tempo a rotina roda, no lugar dos 15
    minutos fixos. Padrão de fábrica: 120. A mudança vale em até um minuto.
  - **Monitorar também o próximo dia útil**: confere junto os eventos do próximo dia útil
    — numa sexta, os da segunda. Pula sábado e domingo, mas não feriados.
  - **Repetir o aviso a cada execução enquanto a pendência existir**: desmarcado, como
    vem, avisa uma vez por evento.

  O campo **Minutos após o fim do evento** deixa de existir, e o selo do Resumo passa de
  **Sem OS lançada** para **Sem tarefa na Experience**.

- **Página de perfil do instalador igual à aba Acessos**: o perfil vem numa lista, sem a
  descrição na frente de cada um, e logo abaixo ficam a caixa **Terceiro** e uma caixa
  por funcionalidade, do menu principal e do cadastro do cliente. Trocar o perfil marca o
  preset dele, e as caixas podem ser ajustadas antes de seguir; o que for desmarcado já
  nasce oculto no HUB SNK. Reinstalar abre a página com as escolhas da instalação
  anterior, e, como antes, nunca desfaz o que você ajustou depois em **Configurações ›
  Acessos**.
- Os perfis aparecem na ordem **Consultor**, **Analista**, **Gerente de Projetos** e
  **Desenvolvedor**, no instalador e na aba Acessos. O instalador novo começa em
  Consultor. O perfil **Gerente de projeto** passa a se chamar **Gerente de Projetos**.
- **O Git AutoSync não vem mais no instalador**: tem licença própria. Sem ele, a aba
  **Git** aparece acinzentada, com o botão **Instalar o Git AutoSync**, que confere se
  o Git está na máquina (sem ele, mostra onde baixá-lo) e baixa a versão mais recente
  do repositório do Git AutoSync. Instalado pelo HUB SNK, ele continua podendo sair
  junto na desinstalação.
- A aba **Git** não fica mais oculta por causa da escolha do Git AutoSync no
  instalador.

### Corrigido

- No cadastro do cliente, clicar várias vezes em **Adicionar nome completo** empilhava
  campos em branco: agora o botão leva ao campo em branco que já existe e para no limite
  de 20 nomes ([#86](https://github.com/CarlosSimao/hub-snk/issues/86)).
- A aba **OS** do cliente só achava a OS quando o nome da empresa na Experience era igual
  ao do cadastro, enquanto a aba **Agenda** aceitava um nome que começa com o outro: um
  cliente "Konica" via na Agenda os eventos da "KONICA MINOLTA BUSINESS SOLUTIONS DO
  BRASIL LTDA", mas não as OS dela. As duas abas passam a usar o mesmo critério.

## [2.2.1] - 2026-10-01

### Corrigido

- A atualização falhava com **"Falha ao desinstalar os arquivos do aplicativo antigo: 2"**
  quando algum programa aberto pelo HUB SNK — o WildFly da aba Local, um atalho, a IDE —
  continuava rodando: ele herdava a pasta da instalação como pasta de trabalho e a
  travava. O HUB SNK passa a rodar, e a abrir os programas, com a sua pasta de usuário.
  Um WildFly que já estava rodando antes desta versão precisa ser reiniciado uma vez.

## [2.2.0] - 2026-09-30

### Adicionado

- Todo e-mail enviado pelo HUB SNK — lembrete, aviso da agenda sem OS e e-mail de teste
  do SMTP — termina com uma linha discreta avisando que é um e-mail automático enviado
  pela ferramenta, com o link da página do projeto.

### Removido

- Os atalhos `Ctrl+1`, `Ctrl+2` e `Ctrl+3`, que alternavam entre o Painel, o SankhyaOm e
  a Experience. O menu **Guias** continua levando a cada uma pelo clique.

### Corrigido

- Sair do HUB SNK pela bandeja com o WhatsApp ou o Google Chat carregados não mostra
  mais o erro `Object has been destroyed`.

## [2.1.2] - 2026-09-30

### Alterado

- Aba **Sobre** das configurações: sai o card **Desenvolvido por**, e **Ajuda e Sugestões**
  mostra um item por linha — a issue no GitHub e o e-mail de contato.

## [2.1.1] - 2026-09-30

### Alterado

- **Git AutoSync desmarcado no instalador**: a caixa agora vem desmarcada. Quem não a
  marcar começa com a aba **Git** do menu e a seção **AutoSync** do cliente desligadas em
  **Configurações › Acessos**; dá para religá-las ali e instalar o Git AutoSync pela
  própria aba Git. Quem já usa o HUB SNK e atualiza mantém os acessos que tinha.

## [2.1.0] - 2026-09-30

### Adicionado

- **Git AutoSync no painel**: a aba **Git** do menu principal mostra e controla o commit
  e o push automáticos dos repositórios — situação da tarefa agendada, horários, rodar
  agora, mensagem do commit escrita por IA (com confirmação antes de ligar), pastas-raiz,
  histórico, log e, em cada repositório, **Commit**, **Push**, **Sincronizar** e
  **Merge Request**. **Adicionar todos os repositórios dos clientes** põe no AutoSync, de
  uma vez, os que têm pasta local. Quando uma ação falha, o bloco **Como resolver**
  explica o erro, traz os comandos para copiar e abre o terminal na pasta; nada é
  executado sozinho. Sem o Git AutoSync instalado, a aba oferece a instalação pelo
  pacote que veio com o HUB SNK. O HUB SNK nunca grava a configuração do AutoSync: tudo
  passa pelo próprio `git-autosync`.
- **Configurações › Git**: host e token do GitLab usados pelo Merge Request. O token vai
  para as variáveis de ambiente do seu usuário do Windows e não volta para a tela.
- **Buscar na página (`Ctrl+F`)**, em qualquer guia — Painel, SankhyaOm, Experience e
  bases de cliente —, como no Chrome: a barra abre no canto superior direito, busca
  enquanto você digita, também dentro dos frames, e mostra quantas ocorrências achou.
  `Enter` vai para a próxima, `Shift+Enter` para a anterior e `Esc` fecha. Não encontra
  texto dentro das telas Flash.
- **Painel de comunicação**: barra lateral com **WhatsApp Web**, **Gmail** e **Google
  Chat**, cada um aberto num painel por cima das guias, com login próprio que fica salvo.
  Mensagem nova gera aviso com contador no botão, som e notificação do Windows, e
  clicar na notificação abre o painel do serviço. A engrenagem da barra escolhe os
  botões que aparecem e se o WhatsApp e o Chat carregam escondidos ao abrir o HUB SNK
  (vem desligado: juntos, eles ocupam perto de 900 MB).
- **Busca rápida**: `Ctrl+K` (ou a lupa no topo do painel) abre uma caixa única que
  procura em clientes, bases, repositórios, links, projetos, contatos, atalhos e
  bases locais, sem ligar para acento nem maiúsculas. `Enter` abre o item — a base
  na guia com o login preenchido, o repositório na IDE, o atalho no programa — e
  `Ctrl+Enter` abre o cliente dele no painel. O que você abre por ali passa a
  aparecer primeiro. Respeita os acessos: o que está oculto não aparece na busca.
- **Atalho global `Ctrl+Shift+Espaço`**: traz o HUB SNK para a frente já com a busca
  aberta, com qualquer programa em foco.
- **Ajuda › Atalhos**, no menu ao lado da guia Painel: janela com todos os atalhos de
  teclado do aplicativo, da busca rápida e o global. A lista sai do próprio menu, então
  está sempre em dia com ele.
- **Ícone na bandeja do Windows**, com a busca rápida e duas caixas: **Atalho global**,
  que desliga o `Ctrl+Shift+Espaço` quando ele conflita com outro programa, e **Iniciar
  HUB SNK automaticamente**, que abre o HUB SNK junto com o Windows, escondido na
  bandeja. As duas escolhas valem para as próximas aberturas.
- **Conversar com o contato**: na aba Contatos e na do cliente, o contato com telefone
  ganha o botão **Conversar no WhatsApp**, e o com e-mail, **Escrever e-mail**. No
  aplicativo, os dois abrem no painel de comunicação: a conversa do número no WhatsApp
  Web e um e-mail novo no Gmail, já endereçado. Telefone sem código do país vale como
  brasileiro. Com o serviço desligado na engrenagem da barra, o botão abre no navegador.
- **Compatibilidade com Flash (Ruffle)**, no menu **Hub**: abre as telas Flex legadas do
  Sankhya Om, que pedem o Flash Player, no SankhyaOm e nas bases de cliente. Vem
  desligada: ligada, cada página do Sankhya carrega um script de 465 KB, e o motor
  (cerca de 14 MB) só é baixado pela tela que tiver conteúdo Flash. Desligada, nada é
  carregado. A troca vale para as telas abertas depois: a que já está aberta muda ao
  recarregar a guia.
- **Atualização automática**: o HUB SNK procura versão nova ao abrir e a cada 6 horas,
  baixa em segundo plano e avisa por notificação quando ela está pronta. Clique nela, ou
  em **Ajuda › Reiniciar para atualizar**, para instalar sem perder cadastro, perfil nem
  login; quem sai do programa sem reiniciar recebe a versão nova na saída. A caixa
  **Ajuda › Atualizar automaticamente** desliga tudo isso, e fica só o aviso do Painel.
  O Git AutoSync instalado não muda com a atualização automática.
- **Resumo do dia**, a nova tela inicial do Painel: os eventos da agenda de hoje (com o
  selo **Sem OS lançada** nos que o alerta da agenda já apontou), os lembretes que
  disparam ou já dispararam hoje, os repositórios com alguma pendência (os que precisam
  de ação primeiro), as OS do mês atual e do anterior que ainda não estão como
  **Concluído** e a versão nova do HUB SNK, quando houver. Cada item leva para onde se
  resolve, e cada seção some junto com a funcionalidade dela em **Configurações ›
  Acessos**. Só as OS vêm da Experience: a consulta roda ao abrir o Resumo e é
  reaproveitada até a próxima abertura, e cada seção aparece quando fica pronta, sem
  esperar as outras. As bases dos clientes ficam de fora.

### Alterado

- **A aba Repositórios do cliente passa a se chamar Git** e traz, no fim, a seção
  **AutoSync** com a situação e as ações do Git AutoSync para os repositórios dele. Em
  **Configurações › Acessos**, a caixa **Git** controla a aba e a caixa **AutoSync (na aba
  Git)**, só a seção.
- **Os lembretes saem do menu principal**: o botão **Lembretes** fica no painel de
  notificações (o sino) e abre a janela com a lista, o **Novo lembrete** e as ações de
  editar e excluir.
- **Fechar a janela esconde o HUB SNK na bandeja** em vez de encerrá-lo, para o atalho
  global e os avisos de mensagem nova continuarem valendo. Para sair, use _Hub_ ›
  _Sair_ ou o botão direito no ícone da bandeja.
- **A API passa a exigir o token do aplicativo** em todas as rotas, menos a
  `/api/healthz`. Antes, qualquer programa da máquina — inclusive de outro usuário
  do Windows no mesmo computador — lia o cadastro com as senhas das bases, dos
  bancos e do SMTP. O painel recebe o token do aplicativo por cookie e continua
  igual; chamadas de fora (scripts) precisam do cabeçalho `x-hub-token` — veja
  [Autenticação](docs/api.md#autenticação).

### Removido

- **Ajuda › Abrir o painel no navegador**: fora do aplicativo o painel não tem o
  token da API. Para desenvolver no navegador, o backend aceita `HUB_SEM_TOKEN=1`.

### Corrigido

- Depois de atualizar o HUB SNK, a desinstalação deixava de perguntar se removia o Git
  AutoSync: a marca de que foi o instalador quem o instalou ficava na pasta do programa,
  que toda atualização substitui. Ela passa a morar em `%LOCALAPPDATA%\HubSnk`, e a de
  uma instalação anterior é levada para lá na próxima atualização.

## [2.0.0] - 2026-09-29

Versão de quebra de compatibilidade (MAJOR): o HUB SNK passa a ser um aplicativo
desktop. Quem usa a versão 1 só precisa rodar o instalador novo — ele remove a
versão antiga e mantém o cadastro onde está.

### Adicionado

- **Aplicativo desktop (Electron)**, com instalador `HUB-SNK-Setup-<versão>.exe`
  por usuário, sem pedir administrador e sem exigir Node.js instalado. A janela
  tem as guias **Painel**, **Sankhya Om** e **Experience**, e cada base de cliente
  abre na sua própria guia, isolada das outras, com o login feito sozinho: o
  aplicativo preenche o usuário, avança para a etapa da senha, preenche a senha e
  clica em entrar.
- **Login automático no Sankhya Om e na Experience**: com a credencial salva, a
  guia que cai na tela de login entra sozinha, inclusive ao abrir o aplicativo.
  Se o Sankhya recusar a senha salva duas vezes seguidas, o login automático para,
  para não bloquear a conta, até a senha ser salva de novo em Credenciais Sankhya
  (ou o aplicativo ser reaberto).
- **Credenciais Sankhya**: usuário e senha do Sankhya Om e da Experience ficam no
  cofre do aplicativo (`safeStorage`, o cofre do sistema operacional), cifrados.
  A janela mostra a senha salva, com o olho para revelar o texto, e **Abrir guia**
  troca para a guia do sistema dentro do aplicativo. No topo dela fica **Meu
  código de usuário Sankhya OM**, com botão de salvar próprio: é ele que recorta a
  Agenda de Recursos para os seus eventos.
- **Acessos por perfil**: o instalador pergunta o perfil (Desenvolvedor,
  Consultor, Analista ou Gerente de projeto), e o preset dele oculta as abas que
  o perfil não usa. Em **Configurações › Acessos** dá para trocar o perfil e
  marcar ou desmarcar cada aba do menu principal e do cadastro do cliente. Salvar
  acessos alterados recarrega o Painel já com eles, sem fechar as guias do Sankhya
  e das bases.
- **Terceiro**, no instalador e em **Configurações › Acessos**: para quem não tem
  acesso ao Sankhya Om nem à Experience. Oculta Credenciais Sankhya, as abas
  Agenda e OS (do menu e do cliente), os nomes completos do cliente, o alerta da
  agenda e as guias **Sankhya Om** e **Experience** do aplicativo, que também
  deixa de logar sozinho nelas.
- **Git AutoSync no instalador**, opcional: commit e push automáticos dos
  repositórios, com tarefa diária, ícone na bandeja, atalhos, skill para os
  agentes de IA e entrada no PATH. A desinstalação pergunta se ele sai junto.
- **Agenda de Recursos e Experience** consultadas por janelas ocultas do
  aplicativo, que fazem o login web sozinhas com a credencial salva — sem Chrome
  separado e sem depender das guias que você está usando. A sessão da Experience
  é renovada antes de vencer.
- **Aba OS**, no menu principal e no cadastro do cliente: as Ordens de Serviço que
  você lançou na Experience, consultadas ao vivo mês a mês, com o horário, o
  intervalo e as tarefas realizadas de cada uma. A lista vai da mais recente para
  a mais antiga, com um agrupador por status à esquerda — quantidade do mês e uma
  cor por status; clicar filtra, e dá para marcar vários — e, à direita, o
  contador e o total de horas das OS visíveis. Na agenda, o evento com OS lançada
  ganha um selo com o status dela, nas mesmas cores.
- **Projetos no cadastro do cliente**, com anotações e links próprios, em cards
  que abrem recolhidos. E **agenda no cadastro do cliente**, com o vínculo por
  nome: os **nomes completos** do cliente (as razões sociais dele no Sankhya)
  casam o parceiro da agenda e a empresa das OS. No card de um evento da agenda
  geral, um botão vincula o parceiro a um cliente existente ou cadastra um novo.
- **SGBD do banco da base**: Oracle ou SQL Server e, no Oracle, a identificação
  por service name ou SID. A porta padrão acompanha o SGBD sem sobrescrever a que
  você digitou, e cada campo do banco ganha botão de copiar. Banco cadastrado
  antes é lido como Oracle por service name.
- **Importar .env**, na aba MCP das configurações: escolhe o `.env` do
  `sankhya-schema-mcp` e preenche o caminho e as variáveis com o conteúdo dele.
- **Onde os links abrem**, na aba Geral das configurações: uma escolha só, entre
  uma guia do HUB SNK e o navegador padrão do sistema, que vale para as bases, os
  repositórios, os links gerais e os links de projeto. Padrão: guia do HUB SNK.
- Links do painel que não estão no cadastro (GitHub, página de release) abrem no
  navegador do sistema.
- **F12** abre as ferramentas de desenvolvedor da guia ativa; Ctrl+Shift+I segue
  abrindo as da barra de guias.
- **Executável da IDE**, na aba Geral das configurações: o botão **Abrir IDE** de
  cada repositório passa a chamar o executável cadastrado ali, com a pasta como
  argumento — funciona com qualquer IDE (IntelliJ IDEA, VS Code, WebStorm, Rider
  e outras), em vez de só tentar descobrir o IntelliJ sozinho.
- **Painel de notificações**, no sino do topo: cada notificação nova aparece num
  cartão no canto direito, com som, e fica no painel até ser lida ou limpa.
- **SMTP**, em **Configurações › SMTP**, com botão de e-mail de teste: as
  notificações também podem sair por e-mail.
- **Alerta da agenda do dia sem OS lançada**, em **Configurações › Avisos**: a
  cada 15 minutos o HUB SNK confere os eventos de cliente de hoje na sua Agenda de
  Recursos e avisa, uma vez por evento, o que já terminou sem OS na Experience.
- **Lembretes**, no menu principal: resumo e texto livre numa data e hora ou
  recorrente por expressão cron (com modelos prontos e prévia das próximas
  ocorrências), opcionalmente ligados a um cliente e a um projeto dele, e com
  e-mail opcional. A notificação mostra o resumo em destaque e o texto abaixo; o
  e-mail tem o assunto `[HUB SNK] Lembrete - <resumo>` e corpo em HTML com a logo.
- **Contatos**, no menu principal e no cadastro do cliente: nome, cargo, telefone,
  e-mail e cliente opcional, com filtro por nome e por cliente. Um lembrete com
  e-mail pode copiar contatos: o destinatário do SMTP vai no "Para" e eles, em cópia.
- A aba **Sobre** das configurações ganha o e-mail de contato do autor, e o nome
  "HUB SNK" ali leva ao repositório no GitHub.

### Alterado

- A janela de **Configurações** ficou duas vezes mais larga, com as abas na ordem
  Geral, SMTP, Avisos, MCP, Atalhos, Acessos e Sobre, os campos lado a lado em
  Geral e MCP e o card **Ajuda e Sugestões** em Sobre. As variáveis do
  `sankhya-schema` na aba MCP ficam num grupo recolhível, fechado a cada abertura.
- O **repositório Git** deixa de ter nome próprio: a tela mostra a pasta do clone
  ou, sem ela, o fim da URL, e o caminho local passa a ser obrigatório no
  cadastro. O nome gravado antes é descartado sozinho, sem migração a rodar.
- O detalhe do cliente abre na aba **Bases** quando a Geral não tem anotações nem
  links.
- O menu do aplicativo (Hub, Guias, Janela, Ajuda) saiu da barra nativa e abre por
  um botão à esquerda da guia Painel, com os mesmos atalhos. O botão de recarregar
  foi redesenhado, e o texto de situação (backend, cookies do ERP, Experience)
  saiu da barra.
- O `hub-snk.env` deixa de ser lido. O backend escuta sempre em `127.0.0.1`, na
  porta 4100, e a ponte do aplicativo, na 4103. Para usar outras portas — uma
  segunda cópia ao lado da instalada, por exemplo —, defina `SANKHYA_HUB_URL` e
  `SANKHYA_DESKTOP_BRIDGE_PORT` antes de abrir o aplicativo.

### Removido

- A **PWA** e a janela `--app` do Edge ou do Chrome, com o service worker e o
  manifest.
- O **instalador por script** (`instalar-hub-snk.bat`/`.ps1`/`.sh`), os pacotes zip
  e tar.gz e os launchers `iniciar.vbs`/`iniciar.sh`.
- As variáveis `HUB_PERMITIR_REDE`, `HUB_NAVEGADOR` e `HUB_ABRIR_JANELA`. O
  `HUB_HOST` só aceita loopback.
- A distribuição para **macOS** e **Linux**: a versão 2 é só para Windows.

### Corrigido

- Salvar as variáveis do MCP com o caminho vazio dizia "Configurações salvas." e
  as descartava. Agora acusa o erro.
- Os balões de ajuda das legendas das configurações abriam abaixo do rodapé e
  criavam barra de rolagem.
- O balão de ajuda dos nomes completos do cliente abria abaixo do botão de
  adicionar, passava do rodapé da janela e criava barra de rolagem. Agora abre logo
  abaixo do rótulo.
- Base cadastrada em https cujo servidor rebaixa para http no redirecionamento
  deixava o login carregando para sempre na guia. Agora a guia volta para https.
- O seletor de pasta e de arquivo devolvia caminho com acento corrompido
  ("Área de Trabalho", "C:\Users\João"), e o caminho gravado não existia.
- Salvar ao mesmo tempo duas alterações da configuração, dos lembretes, dos
  contatos, das notificações ou do ambiente local podia perder uma delas.
- Os avisos disparados com um modal aberto ("Credencial salva", "X copiado",
  "Arquivo de exportação gerado") ficavam por baixo dele, ilegíveis.
- A barra "Marcar todas" da exportação aparecia vazia com uma única base, e
  "Manter todos os atuais / Substituir todos" apareciam sem conflito nenhum.
- Um erro ao gravar os nomes completos deixava o cliente já criado, e salvar de
  novo cadastrava um segundo.
- O script do WildFly não rodava com a pasta dele com espaço, e uma pasta com `&`
  no nome executava o texto depois do `&` como comando.
- O script padrão do terminal com `;` (`git fetch; git status`) era partido pelo
  Windows Terminal e abria com uma aba a mais.
- A importação de repositórios abria dois processos `git` por repositório de uma
  vez só — até mil numa pasta grande.

### Segurança

- O preenchimento automático só entrega usuário e senha a uma página do host
  esperado: a da própria base, ou `sankhya.com.br` para o Sankhya Om e a
  Experience. Antes, um redirecionamento ou um link clicado no meio do login
  recebia a credencial.
- O aplicativo instalado não usa um backend que não é dele: com a porta 4100
  ocupada por outro programa, avisa em vez de entregar o token do aplicativo a
  ele.
- Pop-up de uma base para outro site abre no navegador do sistema, e não numa
  janela do aplicativo sem barra de endereço.
- A senha do banco local deixa de ir na linha de comando do `docker exec`, que
  qualquer programa da máquina lê.
- Um remoto `https://usuario:token@...` importado deixa de levar o usuário e o
  token para o cadastro e para o arquivo exportado.

### Migração da versão 1

- O instalador encerra o servidor antigo, apaga o programa, o `hub-snk.env` e os
  atalhos antigos, e **não toca o cadastro** (`%LOCALAPPDATA%\HubSnk\dados`). O que
  estava na pasta do programa e não era dele vai para
  `%LOCALAPPDATA%\HubSnk\restos-da-versao-pwa-<data>`; o registro fica em
  `%LOCALAPPDATA%\HubSnk\remocao-da-versao-pwa.log`.
- Cadastro numa pasta escolhida à mão (`HUB_DADOS_DIR`) continua sendo usado.
- Uma porta diferente de 4100 no `hub-snk.env` deixa de valer, e o log da
  remoção avisa.

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

[não publicado]: https://github.com/CarlosSimao/hub-snk/compare/v2.6.0...HEAD
[2.6.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.5.0...v2.6.0
[2.5.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.3.0...v2.4.0
[2.3.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.2.1...v2.3.0
[2.2.1]: https://github.com/CarlosSimao/hub-snk/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.1.2...v2.2.0
[2.1.2]: https://github.com/CarlosSimao/hub-snk/compare/v2.1.1...v2.1.2
[2.1.1]: https://github.com/CarlosSimao/hub-snk/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/CarlosSimao/hub-snk/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/CarlosSimao/hub-snk/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/CarlosSimao/hub-snk/releases/tag/v1.0.0
