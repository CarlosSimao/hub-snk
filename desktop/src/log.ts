/**
 * Log com redação de segredo — porta de `poc-desktop/src/report.js`, sem a parte de
 * `resultados.json` (era só o arnês de teste da PoC). A redação por CONTEÚDO (não só
 * por nome de chave) existe porque um vazamento real aconteceu na PoC: o redirect de
 * SSO da Experience carrega o JWT na querystring, então o campo `url` (que não bate em
 * nenhum nome de chave proibido) também precisa ser varrido.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

const CHAVES_PROIBIDAS = /cookie|token|senha|password|authorization|jwt|^email$/i;
const JWT_EM_TEXTO = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
const TOKEN_EM_QUERYSTRING = /([?&]token=)[^&\s]+/gi;
const EMAIL_EM_TEXTO = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

function redigirTexto(valor: string): string {
  return valor
    .replace(JWT_EM_TEXTO, '[jwt-redigido]')
    .replace(TOKEN_EM_QUERYSTRING, '$1[redigido]')
    .replace(EMAIL_EM_TEXTO, '[email-redigido]');
}

function redigir(valor: unknown): unknown {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') return redigirTexto(valor);
  if (typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(redigir);
  const limpo: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    limpo[chave] = CHAVES_PROIBIDAS.test(chave) ? '[redigido]' : redigir(item);
  }
  return limpo;
}

/** Origem + caminho, sem querystring — evita logar token/segredo que viaje na URL. */
export function origemSemQuery(urlTexto: string): string {
  try {
    const u = new URL(urlTexto);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[url inválida]';
  }
}

let arquivoLog = '';
function caminhoLog(): string {
  if (!arquivoLog) {
    const pasta = join(app.getPath('userData'), 'log');
    if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
    arquivoLog = join(pasta, 'desktop.log');
  }
  return arquivoLog;
}

export function logEvento(evento: string, dados: Record<string, unknown> = {}): void {
  const linha = { ts: new Date().toISOString(), evento, ...(redigir(dados) as object) };
  try {
    appendFileSync(caminhoLog(), JSON.stringify(linha) + '\n', 'utf8');
  } catch {
    // Log e' diagnostico, nao pode derrubar o app por disco cheio/permissao.
  }
}
