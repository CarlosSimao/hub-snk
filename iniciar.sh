#!/bin/sh
# Inicia o HUB SNK em segundo plano (Linux/macOS).
# Antes de subir, encerra a instância anterior que ainda estiver escutando na porta.
# Para parar: pkill -f "node src/index.ts"

cd "$(dirname "$0")" || exit 1

PORTA="${HUB_PORTA:-4100}"
SEGUNDOS_ATE_FORCAR=1

pids_escutando_na_porta() {
    if command -v lsof > /dev/null 2>&1; then
        lsof -ti "tcp:$PORTA" -sTCP:LISTEN 2>/dev/null
    elif command -v fuser > /dev/null 2>&1; then
        fuser "$PORTA/tcp" 2>/dev/null
    else
        # Sem uma das duas, não há como descobrir quem está na porta. O aviso
        # existe para o npm start abaixo não falhar sem explicação.
        echo "Nem lsof nem fuser encontrados: a instância anterior não pôde ser verificada." >&2
    fi
}

# Encerra apenas processos node na porta — é o HUB SNK esquecido em segundo
# plano. Qualquer outro programa na porta é deixado em paz: nesse caso o
# npm start falha e o motivo fica registrado no iniciar.log.
encerrar_instancia_anterior() {
    for pid in $(pids_escutando_na_porta); do
        comando=$(ps -p "$pid" -o comm= 2>/dev/null)

        case "$comando" in
            *node*)
                # Encerramento normal primeiro; o -9 só entra se ele for ignorado.
                kill "$pid" 2>/dev/null
                sleep "$SEGUNDOS_ATE_FORCAR"
                if kill -0 "$pid" 2>/dev/null; then
                    kill -9 "$pid" 2>/dev/null
                fi
                echo "Instância anterior do HUB SNK encerrada (PID $pid)."
                ;;
            *)
                echo "A porta $PORTA está ocupada por '$comando' (PID $pid), que não é o HUB SNK — nada foi encerrado."
                ;;
        esac
    done
}

encerrar_instancia_anterior

if [ ! -d node_modules ]; then
    npm install
fi

nohup npm start > iniciar.log 2>&1 &
disown

echo "HUB SNK iniciado em segundo plano (PID $!). Log: iniciar.log"
