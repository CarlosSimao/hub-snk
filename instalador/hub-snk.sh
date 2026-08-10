#!/bin/sh
# Inicia o HUB SNK a partir do pacote baixado, em segundo plano.
#
# O Node vem junto no pacote: não é preciso ter Node instalado na máquina.
#
# Uso:
#   ./hub-snk.sh          inicia e abre no navegador
#   ./hub-snk.sh servidor  inicia sem abrir o navegador
#   ./hub-snk.sh parar     encerra o servidor deste pacote

set -eu

PASTA_DO_PACOTE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NODE_DO_PACOTE="$PASTA_DO_PACOTE/node"
ARQUIVO_DE_CONFIGURACAO="${XDG_CONFIG_HOME:-$HOME/.config}/hub-snk/hub-snk.env"
TENTATIVAS_ATE_DESISTIR=40
ESPERA_ENTRE_TENTATIVAS=0.25

# Lê o hub-snk.env gravado pelo instalador. Variável já definida no ambiente
# vence o arquivo: dá para testar outra porta ou outro navegador sem reinstalar.
# O arquivo não é interpretado pelo shell — um valor com espaço ou com $ vira
# texto, não comando.
carregar_configuracao() {
    [ -f "$ARQUIVO_DE_CONFIGURACAO" ] || return 0

    while IFS= read -r linha || [ -n "$linha" ]; do
        case "$linha" in
            '#'* | '') continue ;;
            *=*) ;;
            *) continue ;;
        esac

        chave=${linha%%=*}
        valor=${linha#*=}

        case "$chave" in
            HUB_*) ;;
            *) continue ;;
        esac

        if [ -z "$(eval "printf '%s' \"\${$chave:-}\"")" ]; then
            export "$chave=$valor"
        fi
    done < "$ARQUIVO_DE_CONFIGURACAO"
}

carregar_configuracao

PORTA="${HUB_PORTA:-4100}"
ENDERECO="http://${HUB_HOST:-127.0.0.1}:$PORTA"

# Os dados ficam fora da pasta do pacote: trocar de versão é apagar esta pasta e
# descompactar a nova, e o cadastro não pode ir junto.
if [ -z "${HUB_DADOS_DIR:-}" ]; then
    HUB_DADOS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/hub-snk/dados"
    export HUB_DADOS_DIR
fi

PASTA_DE_ESTADO=$(dirname "$HUB_DADOS_DIR")
ARQUIVO_DE_LOG="$PASTA_DE_ESTADO/hub-snk.log"

mkdir -p "$HUB_DADOS_DIR"

# O bit de execução se perde quando o pacote é descompactado por algumas
# ferramentas gráficas; restaurá-lo é mais barato que explicar o erro.
[ -x "$NODE_DO_PACOTE" ] || chmod +x "$NODE_DO_PACOTE" 2>/dev/null || true

pids_do_pacote() {
    pgrep -f "^$NODE_DO_PACOTE " 2>/dev/null || true
}

servidor_no_ar() {
    [ -n "$(pids_do_pacote)" ]
}

parar_servidor() {
    pids=$(pids_do_pacote)
    if [ -z "$pids" ]; then
        echo "O HUB SNK deste pacote não está rodando."
        return 0
    fi

    for pid in $pids; do
        kill "$pid" 2>/dev/null || true
    done
    echo "HUB SNK encerrado."
}

iniciar_servidor() {
    if servidor_no_ar; then
        return 0
    fi

    cd "$PASTA_DO_PACOTE"
    nohup "$NODE_DO_PACOTE" src/index.ts >> "$ARQUIVO_DE_LOG" 2>&1 &

    tentativa=0
    while [ "$tentativa" -lt "$TENTATIVAS_ATE_DESISTIR" ]; do
        if servidor_no_ar; then
            return 0
        fi
        sleep "$ESPERA_ENTRE_TENTATIVAS"
        tentativa=$((tentativa + 1))
    done

    echo "O HUB SNK não subiu. O motivo está em $ARQUIVO_DE_LOG" >&2
    return 1
}

# Janela sem barra de endereço e sem abas, como a PWA instalada. Sem nenhum
# navegador Chromium encontrado, resta o navegador padrão, em aba comum.
#
# HUB_NAVEGADOR escolhe entre os três caminhos: um comando fixo, `auto` para
# procurar, `padrao` para ir direto ao navegador do sistema. O navegador fixado
# que sumiu da máquina cai na procura, em vez de deixar de abrir.
abrir_janela() {
    navegador_escolhido="${HUB_NAVEGADOR:-auto}"

    if [ "$navegador_escolhido" = padrao ]; then
        abrir_no_navegador_padrao
        return 0
    fi

    if [ "$navegador_escolhido" != auto ] &&
        command -v "$navegador_escolhido" > /dev/null 2>&1; then
        "$navegador_escolhido" --app="$ENDERECO" > /dev/null 2>&1 &
        return 0
    fi

    for navegador in google-chrome chromium microsoft-edge brave-browser; do
        if command -v "$navegador" > /dev/null 2>&1; then
            "$navegador" --app="$ENDERECO" > /dev/null 2>&1 &
            return 0
        fi
    done

    if [ -d "/Applications/Google Chrome.app" ]; then
        open -na "Google Chrome" --args --app="$ENDERECO"
        return 0
    fi

    abrir_no_navegador_padrao
}

abrir_no_navegador_padrao() {
    if command -v xdg-open > /dev/null 2>&1; then
        xdg-open "$ENDERECO" > /dev/null 2>&1 &
    elif command -v open > /dev/null 2>&1; then
        open "$ENDERECO"
    else
        echo "Abra $ENDERECO no seu navegador."
    fi
}

case "${1:-abrir}" in
    parar)
        parar_servidor
        ;;
    servidor)
        iniciar_servidor
        echo "HUB SNK no ar em $ENDERECO"
        ;;
    abrir)
        iniciar_servidor
        abrir_janela
        ;;
    *)
        echo "Uso: $0 [abrir|servidor|parar]" >&2
        exit 1
        ;;
esac
