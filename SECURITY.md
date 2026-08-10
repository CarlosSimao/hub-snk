# Segurança

## Como reportar uma falha

**Não abra uma issue.** O repositório é público, e a issue também seria.

Mande e-mail para <carlos.nascimento@sankhya.com.br> com o que você encontrou e,
se possível, como reproduzir. Respondo assim que possível — este é um projeto
mantido nas horas vagas, então não há prazo formal de resposta.

Versão suportada: a última publicada em
[Releases](https://github.com/CarlosSimao/hub-snk/releases). Correção de
segurança sai como PATCH sobre ela, não como retroporte para versões antigas.

## O que não é falha

O HUB SNK é uma ferramenta local, e três decisões são deliberadas. Não precisa
reportá-las:

- **Não há autenticação.** Quem alcança a porta é o dono da máquina — e essa
  pessoa poderia ler o arquivo de dados direto no disco.
- **As senhas ficam em texto puro** no arquivo de dados. Qualquer criptografia
  exigiria a chave no mesmo disco que o arquivo cifrado, o que não protege de
  nada.
- **A API abre programas do sistema operacional**, e o campo _Script padrão_ é
  interpretado pelo shell. É a função do produto. O que limita: o caminho
  executado sempre vem do que está gravado em disco — a requisição manda o id do
  registro, nunca o comando.

O motivo de cada uma, e o que muda ao expor o servidor na rede, está no README,
em [Exposição na rede](README.md#exposição-na-rede).
