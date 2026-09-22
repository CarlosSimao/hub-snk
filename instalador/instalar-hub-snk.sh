#!/bin/sh
# Instala o HUB SNK para o usuário atual, a partir do pacote descompactado.
#
# Instalação dentro do perfil: nada exige root, nada é escrito fora do $HOME.
#
# Cada pergunta já vem com o valor padrão entre colchetes — Enter aceita.
#
# Uso: ./instalar-hub-snk.sh

set -eu

PORTA_PADRAO=4100
HOST_PADRAO=127.0.0.1
REDE_BLOQUEADA=0
REDE_LIBERADA=1
NAVEGADOR_AUTOMATICO=auto
NAVEGADOR_PADRAO=padrao
PORTA_MINIMA=1
PORTA_MAXIMA=65535
VERSAO_MINIMA_DO_NODE=22.18
NODE_MAIOR_MINIMO=22
NODE_MENOR_MINIMO=18

PASTA_DO_PACOTE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PASTA_DE_DADOS_BASE="${XDG_DATA_HOME:-$HOME/.local/share}/hub-snk"
PASTA_DE_CONFIGURACAO="${XDG_CONFIG_HOME:-$HOME/.config}/hub-snk"
ARQUIVO_DE_CONFIGURACAO="$PASTA_DE_CONFIGURACAO/hub-snk.env"
DESTINO_PADRAO="$PASTA_DE_DADOS_BASE/programa"
DADOS_PADRAO="$PASTA_DE_DADOS_BASE/dados"

# O atalho e o início na sessão são a única parte que muda entre Linux e macOS:
# o `.desktop` do XDG não existe no macOS, que usa pacote `.app` e LaunchAgent.
SISTEMA=$(uname -s)
ATALHO="${XDG_DATA_HOME:-$HOME/.local/share}/applications/hub-snk.desktop"
ATALHO_DO_LOGON="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/hub-snk.desktop"
APLICATIVO_DO_MACOS="$HOME/Applications/HUB SNK.app"
AGENTE_DO_MACOS="$HOME/Library/LaunchAgents/com.hubsnk.servidor.plist"
ROTULO_DO_AGENTE=com.hubsnk.servidor

# ---------------------------------------------------------------------------
# Perguntas

perguntar() {
    rotulo=$1
    padrao=$2

    printf '%s [%s]: ' "$rotulo" "$padrao" >&2
    read -r resposta || resposta=''

    if [ -z "$resposta" ]; then
        echo "$padrao"
    else
        echo "$resposta"
    fi
}

# Devolve 0 para sim, 1 para não — o mesmo que um `if` espera.
#
# O padrão vai escrito por extenso, e não pela caixa da letra: quem lê [S/n]
# rápido não percebe que a maiúscula é a resposta de quem aperta Enter.
perguntar_sim_ou_nao() {
    rotulo=$1
    padrao=$2

    if [ "$padrao" = sim ]; then letra=S; else letra=N; fi

    printf '%s [S/N] (padrão: %s): ' "$rotulo" "$letra" >&2
    read -r resposta || resposta=''

    case "$(echo "$resposta" | tr '[:upper:]' '[:lower:]')" in
        s*) return 0 ;;
        n*) return 1 ;;
        *) [ "$padrao" = sim ] ;;
    esac
}

# ---------------------------------------------------------------------------
# Configuração já gravada
#
# Reinstalar não deve apagar o que foi escolhido antes: os valores gravados
# viram o padrão das perguntas, e Enter mantém tudo como estava.

valor_gravado() {
    chave=$1
    padrao=$2

    if [ ! -f "$ARQUIVO_DE_CONFIGURACAO" ]; then
        echo "$padrao"
        return 0
    fi

    valor=$(sed -n "s/^${chave}=//p" "$ARQUIVO_DE_CONFIGURACAO" | tail -n 1)
    if [ -z "$valor" ]; then echo "$padrao"; else echo "$valor"; fi
}

# ---------------------------------------------------------------------------
# Os cinco parâmetros

porta_valida() {
    case "$1" in
        '' | *[!0-9]*) return 1 ;;
    esac

    [ "$1" -ge "$PORTA_MINIMA" ] && [ "$1" -le "$PORTA_MAXIMA" ]
}

# O padrão é conferido antes do laço: vindo de um arquivo editado à mão, ele
# pode estar inválido, e aí Enter não sairia nunca daqui.
perguntar_porta() {
    padrao=$1
    porta_valida "$padrao" || padrao=$PORTA_PADRAO

    while :; do
        porta=$(perguntar 'Porta do servidor (HUB_PORTA)' "$padrao")

        if porta_valida "$porta"; then
            echo "$porta"
            return 0
        fi

        printf '  Informe um inteiro entre %s e %s.\n' "$PORTA_MINIMA" "$PORTA_MAXIMA" >&2
    done
}

# Escutar fora do loopback abre a API para a rede. Ela não tem autenticação,
# devolve as senhas do cadastro e abre programas da máquina — a liberação é
# pedida de propósito, na cara do usuário, nunca deduzida da resposta anterior.
#
# Sai como "endereço permitir_rede", separado por espaço.
perguntar_host() {
    endereco=$(perguntar 'Endereço em que o servidor escuta (HUB_HOST)' "$1")

    case "$endereco" in
        127.0.0.1 | ::1 | localhost)
            echo "$endereco $REDE_BLOQUEADA"
            return 0
            ;;
    esac

    {
        printf '\n  ATENÇÃO: %s expõe o HUB SNK para outras máquinas da rede.\n' "$endereco"
        printf '  O servidor não tem autenticação, devolve as senhas do cadastro pela API\n'
        printf '  e abre programas do seu computador. Quem alcançar a porta faz tudo isso.\n\n'
    } >&2

    if perguntar_sim_ou_nao '  Liberar mesmo assim (HUB_PERMITIR_REDE=1)?' nao; then
        echo "$endereco $REDE_LIBERADA"
    else
        printf '  Mantido no loopback.\n' >&2
        echo "$HOST_PADRAO $REDE_BLOQUEADA"
    fi
}

navegadores_disponiveis() {
    for navegador in google-chrome chromium microsoft-edge brave-browser; do
        if command -v "$navegador" > /dev/null 2>&1; then
            echo "$navegador"
        fi
    done

    [ -d '/Applications/Google Chrome.app' ] && echo 'google-chrome'
    return 0
}

# `padrao` abre em aba comum do navegador do sistema; `auto` deixa o launcher
# procurar um Chromium; um nome de comando fixa o navegador da janela. As três
# formas, e esta pergunta, são as mesmas do instalador do Windows — só muda a
# lista de navegadores, que sai do que existe em cada sistema.
#
# O padrão da primeira instalação é `padrao`: é a escolha que respeita o que a
# pessoa já usa. Quem prefere a janela sem abas escolhe na hora, e a escolha
# volta como padrão na próxima.
perguntar_navegador() {
    padrao=$1
    opcoes=$(printf '%s %s %s' "$NAVEGADOR_PADRAO" "$NAVEGADOR_AUTOMATICO" \
        "$(navegadores_disponiveis | tr '\n' ' ')")
    lista=$(echo "$opcoes" | tr -s ' ' | sed 's/ $//; s/ /, /g')

    # O navegador gravado pode ter saído da máquina desde a última instalação.
    if ! echo "$opcoes" | tr ' ' '\n' | grep -qx "$padrao"; then
        padrao=$NAVEGADOR_PADRAO
    fi

    {
        printf '\n  A janela do HUB SNK abre sem barra de endereço e sem abas nos navegadores\n'
        printf "  Chromium. Com '%s', abre em aba comum do navegador do sistema;\n" "$NAVEGADOR_PADRAO"
        printf "  com '%s', no primeiro Chromium encontrado na máquina.\n" "$NAVEGADOR_AUTOMATICO"
        printf '  Opções: %s\n' "$lista"
    } >&2

    while :; do
        escolhido=$(perguntar 'Navegador do HUB SNK (HUB_NAVEGADOR)' "$padrao")

        for opcao in $opcoes; do
            if [ "$escolhido" = "$opcao" ]; then
                echo "$escolhido"
                return 0
            fi
        done

        printf '  Escolha uma das opções: %s.\n' "$lista" >&2
    done
}

# ---------------------------------------------------------------------------
# Pré-requisito
#
# O Node não vem mais no pacote. Sem esta conferência, a falta dele só
# apareceria depois de tudo copiado, no primeiro clique do atalho.

conferir_node() {
    if ! command -v node > /dev/null 2>&1; then
        echo 'O Node.js não está instalado, ou não está no PATH.' >&2
        echo "O HUB SNK precisa da versão $VERSAO_MINIMA_DO_NODE ou mais nova: https://nodejs.org" >&2
        exit 1
    fi

    versao=$(node -v | sed 's/^v//')
    maior=${versao%%.*}
    resto=${versao#*.}
    menor=${resto%%.*}

    if [ "$maior" -lt "$NODE_MAIOR_MINIMO" ] ||
        { [ "$maior" -eq "$NODE_MAIOR_MINIMO" ] && [ "$menor" -lt "$NODE_MENOR_MINIMO" ]; }; then
        echo "Node $versao é antigo demais: o HUB SNK precisa da $VERSAO_MINIMA_DO_NODE ou mais nova." >&2
        echo 'A partir dela o Node roda arquivos .ts direto, sem etapa de build.' >&2
        exit 1
    fi

    printf 'Node %s encontrado.\n' "$versao"
}

# O launcher instalado depende do `pgrep` para saber se o servidor está no ar, e
# a falta dele não dá erro — dá resposta errada. Conferir aqui, e não só no
# launcher, evita descobrir isso depois de tudo copiado.
conferir_pgrep() {
    command -v pgrep > /dev/null 2>&1 && return 0

    echo 'O comando "pgrep" não está disponível.' >&2
    echo 'O HUB SNK precisa dele para saber se o servidor já está no ar.' >&2
    echo 'Instale o pacote "procps" da sua distribuição e tente de novo.' >&2
    exit 1
}

# ---------------------------------------------------------------------------
# Instalação

# O servidor no ar segura os arquivos que está usando: copiar por cima de uma
# instalação em execução deixa a cópia pela metade.
encerrar_servidor_instalado() {
    destino=$1
    [ -x "$destino/hub-snk.sh" ] || return 0

    printf 'Encerrando o HUB SNK que já estava rodando ...\n'
    "$destino/hub-snk.sh" parar > /dev/null 2>&1 || true
}

# Cada item é removido antes de ser copiado, em vez de fundido com o que já
# estava lá: copiar por cima não apaga o que a versão nova deixou de ter, e um
# arquivo removido do projeto sobreviveria dentro de `src` ou `public` — ocupando
# espaço no melhor caso, e sendo carregado por engano no pior.
#
# A remoção alcança só o que o pacote traz. A pasta de destino é digitada pelo
# usuário e pode ter outra coisa dentro; apagá-la inteira levaria junto o que não
# é nosso, e quem instalou numa pasta compartilhada perderia arquivo na primeira
# atualização.
copiar_programa() {
    destino=$1

    mkdir -p "$destino"

    # Instalar sobre a própria pasta do pacote apagaria a origem da cópia.
    if [ "$(CDPATH= cd -- "$destino" && pwd)" = "$PASTA_DO_PACOTE" ]; then
        printf 'A pasta de instalação é a própria pasta do pacote: nada a copiar.\n'
        return 0
    fi

    # O que veio no pacote é a lista inteira, menos os próprios instaladores.
    for item in "$PASTA_DO_PACOTE"/* "$PASTA_DO_PACOTE"/.[!.]*; do
        [ -e "$item" ] || continue
        nome=$(basename "$item")
        case "$nome" in
            instalar-hub-snk.sh) continue ;;
        esac
        rm -rf "$destino/$nome"
        cp -R "$item" "$destino/"
    done

    chmod +x "$destino/hub-snk.sh"
    [ -f "$destino/desinstalar-hub-snk.sh" ] && chmod +x "$destino/desinstalar-hub-snk.sh"
    return 0
}

gravar_configuracao() {
    mkdir -p "$PASTA_DE_CONFIGURACAO"

    cat > "$ARQUIVO_DE_CONFIGURACAO" <<FIM
# Configuração do HUB SNK, gravada pelo instalador.
# Editar à mão funciona: o launcher lê este arquivo a cada abertura.
# Uma variável de ambiente com o mesmo nome tem precedência sobre o valor daqui.

# Onde o programa foi instalado. Serve à desinstalação, que precisa saber qual
# pasta remover mesmo quando o script é chamado de outro lugar.
HUB_PROGRAMA_DIR=$6

HUB_PORTA=$1
HUB_HOST=$2
HUB_PERMITIR_REDE=$3
HUB_DADOS_DIR=$4
HUB_NAVEGADOR=$5
FIM
}

# O caminho vai entre aspas porque o `Exec` do XDG é dividido em espaços: uma
# pasta de instalação com espaço no nome quebraria o atalho sem elas.
gravar_atalho() {
    caminho=$1
    destino=$2
    argumento=$3

    mkdir -p "$(dirname "$caminho")"

    cat > "$caminho" <<FIM
[Desktop Entry]
Type=Application
Name=HUB SNK
Comment=Abre o HUB SNK em janela própria
Exec="$destino/hub-snk.sh" $argumento
Icon=$destino/public/img/icone-512.png
Terminal=false
Categories=Development;Utility;
FIM

    chmod +x "$caminho"
}

# ---------------------------------------------------------------------------
# Atalho e início na sessão do macOS
#
# O Finder e o Spotlight só enxergam aplicativo em pacote `.app`, e o início na
# sessão é um LaunchAgent — o `.desktop` e a pasta `autostart` do XDG não
# existem aqui. Tudo dentro do perfil, como no Linux: nada exige root.

# O pacote é o mínimo que o macOS aceita: um Info.plist e um executável que
# repassa a chamada ao launcher. Sem ícone próprio, porque um `.icns` exigiria
# uma etapa de conversão só para isto.
gravar_aplicativo_do_macos() {
    destino=$1
    conteudo="$APLICATIVO_DO_MACOS/Contents"

    rm -rf "$APLICATIVO_DO_MACOS"
    mkdir -p "$conteudo/MacOS"

    cat > "$conteudo/Info.plist" <<'FIM'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>
    <string>HUB SNK</string>
    <key>CFBundleDisplayName</key>
    <string>HUB SNK</string>
    <key>CFBundleIdentifier</key>
    <string>com.hubsnk.app</string>
    <key>CFBundleExecutable</key>
    <string>hub-snk</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
</dict>
</plist>
FIM

    cat > "$conteudo/MacOS/hub-snk" <<FIM
#!/bin/sh
exec "$destino/hub-snk.sh" abrir
FIM

    chmod +x "$conteudo/MacOS/hub-snk"
}

# O `launchctl` carrega o agente na hora, para o início na sessão valer sem
# precisar de logout. Best-effort: falhar aqui não invalida a instalação.
gravar_agente_do_macos() {
    destino=$1

    mkdir -p "$(dirname "$AGENTE_DO_MACOS")"

    cat > "$AGENTE_DO_MACOS" <<FIM
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$ROTULO_DO_AGENTE</string>
    <key>ProgramArguments</key>
    <array>
        <string>$destino/hub-snk.sh</string>
        <string>servidor</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
</dict>
</plist>
FIM

    launchctl unload "$AGENTE_DO_MACOS" > /dev/null 2>&1 || true
    launchctl load "$AGENTE_DO_MACOS" > /dev/null 2>&1 || true
}

remover_agente_do_macos() {
    [ -f "$AGENTE_DO_MACOS" ] || return 0

    launchctl unload "$AGENTE_DO_MACOS" > /dev/null 2>&1 || true
    rm -f "$AGENTE_DO_MACOS"
}

# ---------------------------------------------------------------------------
# Atalho e início na sessão, no mecanismo de cada sistema

aplicar_atalho() {
    criar=$1
    destino=$2

    if [ "$SISTEMA" = Darwin ]; then
        if [ "$criar" = sim ]; then
            gravar_aplicativo_do_macos "$destino"
        else
            rm -rf "$APLICATIVO_DO_MACOS"
        fi
        return 0
    fi

    if [ "$criar" = sim ]; then
        gravar_atalho "$ATALHO" "$destino" abrir
    else
        rm -f "$ATALHO"
    fi
}

# Início pela entrada de autostart do XDG no Linux e por LaunchAgent no macOS, e
# não por serviço de sistema: o HUB SNK abre o gerenciador de arquivos, o
# terminal e a IDE, e precisa da sessão gráfica do usuário.
aplicar_inicio_na_sessao() {
    iniciar=$1
    destino=$2

    if [ "$SISTEMA" = Darwin ]; then
        if [ "$iniciar" = sim ]; then
            gravar_agente_do_macos "$destino"
        else
            remover_agente_do_macos
        fi
        return 0
    fi

    if [ "$iniciar" = sim ]; then
        gravar_atalho "$ATALHO_DO_LOGON" "$destino" servidor
    else
        rm -f "$ATALHO_DO_LOGON"
    fi
}

# ---------------------------------------------------------------------------

if [ ! -f "$PASTA_DO_PACOTE/src/index.ts" ]; then
    echo 'Este script precisa rodar de dentro do pacote descompactado do HUB SNK.' >&2
    echo "Não encontrei o src/index.ts em $PASTA_DO_PACOTE." >&2
    exit 1
fi

conferir_node
conferir_pgrep

printf '\n  HUB SNK — instalação\n'
printf '  Enter aceita o valor entre colchetes.\n\n'

destino=$(perguntar 'Pasta de instalação' "$DESTINO_PADRAO")
porta=$(perguntar_porta "$(valor_gravado HUB_PORTA "$PORTA_PADRAO")")
host_e_rede=$(perguntar_host "$(valor_gravado HUB_HOST "$HOST_PADRAO")")
endereco=${host_e_rede% *}
permitir_rede=${host_e_rede#* }
dados=$(perguntar 'Pasta do cadastro (HUB_DADOS_DIR)' "$(valor_gravado HUB_DADOS_DIR "$DADOS_PADRAO")")
navegador=$(perguntar_navegador "$(valor_gravado HUB_NAVEGADOR "$NAVEGADOR_PADRAO")")

printf '\n'
if [ "$SISTEMA" = Darwin ]; then
    pergunta_do_atalho='Criar o aplicativo em ~/Applications?'
else
    pergunta_do_atalho='Criar atalho no menu de aplicativos?'
fi

if perguntar_sim_ou_nao "$pergunta_do_atalho" sim; then
    criar_atalho=sim
else
    criar_atalho=nao
fi

if perguntar_sim_ou_nao 'Iniciar o HUB SNK junto com a sessão?' nao; then
    iniciar_no_logon=sim
else
    iniciar_no_logon=nao
fi

printf '\n'
encerrar_servidor_instalado "$destino"
printf 'Copiando o programa para %s ...\n' "$destino"
copiar_programa "$destino"

gravar_configuracao "$porta" "$endereco" "$permitir_rede" "$dados" "$navegador" "$destino"
mkdir -p "$dados"

aplicar_atalho "$criar_atalho" "$destino"
aplicar_inicio_na_sessao "$iniciar_no_logon" "$destino"

printf '\n  HUB SNK instalado.\n'
printf '  Programa:      %s\n' "$destino"
printf '  Cadastro:      %s\n' "$dados"
printf '  Configuração:  %s\n' "$ARQUIVO_DE_CONFIGURACAO"
printf '  Endereço:      http://%s:%s\n\n' "$endereco" "$porta"

if perguntar_sim_ou_nao 'Abrir o HUB SNK agora?' sim; then
    "$destino/hub-snk.sh"
fi
