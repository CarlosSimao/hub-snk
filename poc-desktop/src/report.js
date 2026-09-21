'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPORT_DIR = path.join(__dirname, '..', 'report');
const LOG_FILE = path.join(REPORT_DIR, 'eventos.log');
const RESULT_FILE = path.join(REPORT_DIR, 'resultados.json');

if (!fs.existsSync(REPORT_DIR)) fs.mkdirSync(REPORT_DIR, { recursive: true });

/**
 * Nunca grava valor de cookie, token, senha — só metadados. `email` entra aqui também:
 * respostas reais da API da Experience trazem contato de terceiro (aprovador do
 * cliente) com nome e e-mail — dado pessoal desnecessário ao diagnóstico, mesmo não
 * sendo credencial.
 */
const CHAVES_PROIBIDAS = /cookie|token|senha|password|authorization|jwt|^email$/i;

/**
 * JWT cru (três blocos base64url separados por ponto) OU `?token=...`/`&token=...` numa
 * URL, como o redirect de SSO da Experience manda. Não basta filtrar por nome de chave:
 * a URL inteira vem no campo `url`, que não bate em CHAVES_PROIBIDAS. E-mail em texto
 * livre (ex.: dentro de `aprovadores` ou observações copiadas) também é redigido.
 */
const JWT_EM_TEXTO = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const TOKEN_EM_QUERYSTRING = /([?&]token=)[^&\s]+/gi;
const EMAIL_EM_TEXTO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function redigirTexto(valor) {
  return valor
    .replace(JWT_EM_TEXTO, '[jwt-redigido]')
    .replace(TOKEN_EM_QUERYSTRING, '$1[redigido]')
    .replace(EMAIL_EM_TEXTO, '[email-redigido]');
}

function redigir(obj) {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return redigirTexto(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(redigir);
  const limpo = {};
  for (const [chave, valor] of Object.entries(obj)) {
    if (CHAVES_PROIBIDAS.test(chave)) {
      limpo[chave] = '[redigido]';
    } else {
      limpo[chave] = redigir(valor);
    }
  }
  return limpo;
}

function logEvento(evento, dados = {}) {
  const linha = {
    ts: new Date().toISOString(),
    evento,
    ...redigir(dados),
  };
  fs.appendFileSync(LOG_FILE, JSON.stringify(linha) + '\n', 'utf8');
  return linha;
}

function carregarResultados() {
  try {
    return JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT_RUN' | 'PENDENTE' */
function registrarResultado(testeId, status, detalhe = {}) {
  const resultados = carregarResultados();
  resultados[testeId] = {
    status,
    ts: new Date().toISOString(),
    ...redigir(detalhe),
  };
  fs.writeFileSync(RESULT_FILE, JSON.stringify(resultados, null, 2), 'utf8');
  logEvento('resultado-teste', { testeId, status, ...detalhe });
  return resultados[testeId];
}

module.exports = { logEvento, registrarResultado, carregarResultados, redigir, LOG_FILE, RESULT_FILE };
