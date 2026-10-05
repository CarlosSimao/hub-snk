/**
 * Log com redação de segredo. A redação por CONTEÚDO (não só por nome de chave) existe porque um vazamento real aconteceu na PoC: o redirect de
 * SSO da Experience carrega o JWT na querystring, então o campo `url` (que não bate em
 * nenhum nome de chave proibido) também precisa ser varrido.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
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

const TAMANHO_PARA_ROTACIONAR_EM_BYTES = 5 * 1024 * 1024;
const ARQUIVOS_ANTIGOS_MANTIDOS = 3;

/**
 * Rotação simples, feita uma vez a cada abertura do app: passou de 5 MB, o arquivo vira
 * `.1` (e o `.1` vira `.2`, até `.3`), e um novo começa vazio. Sem isso os dois logs
 * cresciam para sempre.
 *
 * Feita na abertura, e não durante o uso, porque o `backend.log` fica preso por um
 * stream enquanto o backend roda — no Windows, arquivo aberto não se renomeia.
 */
export function rotacionarLog(caminho: string): void {
  try {
    if (!existsSync(caminho) || statSync(caminho).size < TAMANHO_PARA_ROTACIONAR_EM_BYTES) return;
    rmSync(`${caminho}.${ARQUIVOS_ANTIGOS_MANTIDOS}`, { force: true });
    for (let numero = ARQUIVOS_ANTIGOS_MANTIDOS - 1; numero >= 1; numero -= 1) {
      if (existsSync(`${caminho}.${numero}`))
        renameSync(`${caminho}.${numero}`, `${caminho}.${numero + 1}`);
    }
    renameSync(caminho, `${caminho}.1`);
  } catch {
    // Rotação é limpeza: se falhar (arquivo em uso, permissão), o log segue no mesmo arquivo.
  }
}

let arquivoLog = '';
function caminhoLog(): string {
  if (!arquivoLog) {
    const pasta = join(app.getPath('userData'), 'log');
    if (!existsSync(pasta)) mkdirSync(pasta, { recursive: true });
    arquivoLog = join(pasta, 'desktop.log');
    rotacionarLog(arquivoLog);
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
