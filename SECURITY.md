# Segurança

## Como reportar uma falha

**Não abra uma issue.** O repositório é público, e a issue também seria.

Mande e-mail para <carlos.nascimento@sankhya.com.br> com o que você encontrou e,
se possível, como reproduzir. Respondo assim que possível — este é um projeto
mantido nas horas vagas, então não há prazo formal de resposta.

Versão suportada: a última publicada em
[Releases](https://github.com/CarlosSimao/hub-snk/releases). Correção de
segurança sai como PATCH sobre ela, não como retroporte para versões antigas.

## O que já é assumido — e não é falha

O HUB SNK é uma ferramenta local, e algumas decisões são deliberadas. Reportar
qualquer uma delas não é necessário; elas estão documentadas aqui de propósito.

**Não há autenticação.** Quem alcança a porta é o dono da máquina. Uma senha de
acesso protegeria de quem já tem acesso ao seu usuário do sistema operacional —
e essa pessoa poderia simplesmente ler o arquivo de dados direto no disco.

**As senhas ficam em texto puro** no arquivo de dados. Qualquer criptografia
exigiria a chave no mesmo disco que o arquivo cifrado, o que não protege de
nada. Quem tem acesso ao seu perfil tem acesso às duas coisas.

**A API abre programas do sistema operacional.** É a função do produto: abrir a
pasta do repositório, o terminal, a IDE, os atalhos cadastrados. O que a limita
é que o caminho executado sempre vem do que está gravado em disco — a requisição
manda o id do registro, nunca o comando. Não existe rota que execute algo que
você não tenha cadastrado antes pela tela.

**O campo Script padrão é interpretado pelo shell.** É essa a função dele. Ele
roda com as suas permissões, na pasta do repositório, e só executa o que você
mesmo digitou nas configurações.

## O que protege a API

Escutar em `127.0.0.1` não isola o programa do resto da internet, e é por isso
que existe uma camada a mais.

Qualquer página aberta no seu navegador consegue mandar requisições para o
endereço local. E um domínio configurado para resolver em `127.0.0.1` — DNS
rebinding — passa por origem legítima aos olhos do navegador. Como a API devolve
o cadastro inteiro e abre programas, isso bastaria para vazar as senhas de todos
os clientes a partir de uma aba qualquer.

Por isso, antes de chegar a qualquer rota, toda requisição tem dois cabeçalhos
conferidos:

- **`Host`** — precisa ser `127.0.0.1`, `localhost` ou `[::1]`, na porta em que
  o servidor está escutando. Um nome de domínio ali denuncia o rebinding.
- **`Origin`** — quando presente, precisa ser a própria origem do HUB SNK. É o
  que barra outra página chamando a API. Requisição sem `Origin` é aceita:
  navegação direta, a própria PWA carregando o shell e chamadas de linha de
  comando não mandam o cabeçalho, e o `Host` já foi conferido.

O que não passa recebe `403` e fica registrado no log do servidor.

## Quando essa proteção é desligada

Com `HUB_PERMITIR_REDE=1` e um `HUB_HOST` de rede, a conferência sai. Não há
lista de endereços válidos a comparar quando o acesso é pelo IP ou pelo nome da
máquina, e manter a checagem seria teatro. O servidor registra um aviso no log
ao subir nesse modo.

Nesse cenário, **qualquer máquina que alcance a porta lê as senhas de todos os
clientes e manda a sua máquina executar programas.** Só use em rede em que você
confia em cada participante, e de preferência nem assim.

Sem a variável, um `HUB_HOST` fora do loopback não sobe: o servidor para com uma
mensagem explicando o motivo. A exposição precisa ser um ato deliberado, não um
descuido de configuração.

## Um lembrete sobre backup

A pasta de dados sincronizada com Google Drive, OneDrive ou Dropbox sobe **como
está no disco**, com as senhas legíveis. Confira se ela não está compartilhada
com outras pessoas.

Vale o mesmo para o `.sankhya-mcp.env`, que guarda a senha do banco dentro do
repositório: o HUB SNK marca em vermelho o repositório em que esse arquivo está
sendo rastreado pelo Git, justamente para ele não ir junto no próximo push.
