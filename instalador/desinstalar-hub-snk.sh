#!/bin/sh
# Remove o HUB SNK instalado para o usuário atual.
#
# O cadastro não é apagado: perder o cadastro por engano é irreversível, e
# reinstalar logo em seguida é o caso mais comum. O caminho dele é mostrado no
# fim, para quem quiser apagá-lo à mão.
#
# Uso: ./desinstalar-hub-snk.sh

set -eu

PASTA_DO_PROGRAMA=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PASTA_DE_DADOS_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/hub-snk"
ARQUIVO_DE_CONFIGURACAO="${XDG_CONFIG_HOME:-$HOME/.config}/hub-snk/hub-snk.env"
ATALHO="${XDG_DATA_HOME:-$HOME/.local/share}/applications/hub-snk.desktop"
ATALHO_DO_LOGON="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/hub-snk.desktop"

pasta_do_cadastro() {
    if [ -f "$ARQUIVO_DE_CONFIGURACAO" ]; then
        valor=$(sed -n 's/^HUB_DADOS_DIR=//p' "$ARQUIVO_DE_CONFIGURACAO" | tail -n 1)
        if [ -n "$valor" ]; then
            echo "$valor"
            return 0
        fi
    fi

    echo "$PASTA_DE_DADOS_BASE/dados"
}

if [ ! -f "$PASTA_DO_PROGRAMA/hub-snk.sh" ]; then
    echo 'Este script precisa rodar de dentro da pasta em que o HUB SNK foi instalado.' >&2
    exit 1
fi

printf '\n  HUB SNK — desinstalação\n'
printf '  Programa: %s\n\n' "$PASTA_DO_PROGRAMA"
printf 'Remover o HUB SNK desta máquina? [S/N] (padrão: N): '
read -r resposta || resposta=''

case "$(echo "$resposta" | tr '[:upper:]' '[:lower:]')" in
    s*) ;;
    *)
        echo 'Nada foi removido.'
        exit 0
        ;;
esac

CADASTRO=$(pasta_do_cadastro)

"$PASTA_DO_PROGRAMA/hub-snk.sh" parar > /dev/null 2>&1 || true

rm -f "$ATALHO" "$ATALHO_DO_LOGON" "$ARQUIVO_DE_CONFIGURACAO"
rm -f "$PASTA_DE_DADOS_BASE/hub-snk.log"

# A pasta é apagada de fora dela: este script está lá dentro, e um diretório de
# trabalho removido deixa o shell num estado que confunde os comandos seguintes.
cd "$HOME"
rm -rf "$PASTA_DO_PROGRAMA"

printf '\n  HUB SNK removido.\n'

if [ -d "$CADASTRO" ]; then
    printf '\n  Seu cadastro continua em:\n'
    printf '  %s\n' "$CADASTRO"
    printf '  Apague essa pasta à mão se não quiser mais guardá-lo.\n'
fi

printf '\n'
