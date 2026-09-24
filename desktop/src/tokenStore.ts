/**
 * Segredo compartilhado entre o shell desktop e o backend, nas duas direções (backend
 * pedindo a Agenda ao bridge; shell empurrando a sessão da Experience ao backend) — ver
 * "Decisão de transporte" no plano de Fase 2. Mesma ideia do `hub-helper.ps1`: gerado
 * no primeiro boot, lido depois. Nunca exposto à UI (nem local, nem remota).
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ARQUIVO_TOKEN_BRIDGE } from './config';

let tokenEmMemoria = '';

export function garantirToken(): string {
  if (tokenEmMemoria) return tokenEmMemoria;

  if (existsSync(ARQUIVO_TOKEN_BRIDGE)) {
    const existente = readFileSync(ARQUIVO_TOKEN_BRIDGE, 'utf8').trim();
    if (existente) {
      tokenEmMemoria = existente;
      return tokenEmMemoria;
    }
  }

  mkdirSync(dirname(ARQUIVO_TOKEN_BRIDGE), { recursive: true });
  const novo = randomBytes(32).toString('hex');
  writeFileSync(ARQUIVO_TOKEN_BRIDGE, novo, 'utf8');
  tokenEmMemoria = novo;
  return tokenEmMemoria;
}
