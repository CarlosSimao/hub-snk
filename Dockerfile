# syntax=docker/dockerfile:1

# Debian slim, nao Alpine: o Oracle Instant Client e compilado contra glibc e nao roda
# em musl. A troca e o preco de falar com Oracle 11g — veja o estagio `oracle-client`.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY src ./src
# O painel React: `npm run build` roda tsc (backend, -> dist/) e vite (frontend, -> public/).
COPY web ./web
RUN npm run build

# -----------------------------------------------------------------------------
# Oracle Instant Client — habilita o Thick mode do node-oracledb.
#
# Por que Thick: o Thin mode (JavaScript puro, sem cliente nativo) so fala com Oracle
# 12.1 ou superior. Contra um 11g ele devolve NJS-138 e nao chega a testar credencial.
# O Thick faz o "test connection" de verdade — autentica e roda uma consulta.
#
# Por que a versao 19: e a ultima linha do Instant Client que ainda suporta bancos
# 11.2. O 21c e o 23ai exigem 12.1+, o mesmo limite do Thin — trocariam um problema
# pelo outro.
#
# `basiclite` em vez de `basic`: descarta os arquivos de mensagens de erro traduzidas,
# que nao usamos. Baixa em estagio proprio para o zip nao ficar numa camada da imagem.
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim AS oracle-client
ARG IC_URL=https://download.oracle.com/otn_software/linux/instantclient/1928000/instantclient-basiclite-linux.x64-19.28.0.0.0dbru.zip
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/oracle
RUN curl -fsSLo ic.zip "$IC_URL" \
 && unzip -q ic.zip \
 && mv instantclient_19_28 instantclient \
 && rm ic.zip \
 # Nada aqui e usado pelo hub e os arquivos sao grandes: o driver JDBC (Java), o
 # conector MySQL e os utilitarios de linha de comando.
 && rm -f instantclient/*jdbc* instantclient/*occi* instantclient/*mysql* \
           instantclient/adrci instantclient/genezi instantclient/uidrvci

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# curl serve o HEALTHCHECK; libaio e dependencia do Instant Client; tzdata para os
# timestamps baterem com o host.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl libaio1 tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY --from=oracle-client /opt/oracle/instantclient /opt/oracle/instantclient
# No Linux quem resolve as bibliotecas e o dynamic linker do sistema — o `libDir` do
# `initOracleClient()` nao basta e falha com DPI-1047. Registrar o diretorio no
# ldconfig e o que faz o Thick mode carregar.
RUN echo /opt/oracle/instantclient > /etc/ld.so.conf.d/oracle.conf && ldconfig

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY package.json ./
COPY config ./config

# O SQLite de historico e o cofre de credenciais vivem em volume; se o volume nao for
# montado, o diretorio existe.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/healthz || exit 1

CMD ["node", "dist/index.js"]
