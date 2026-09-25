import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { gravarJson, lerJson } from './integracaoArquivo';
import { disponivel } from './cofreCredenciais';
import { validarConfig } from './integracaoValidacao';

interface Gravado { habilitada: boolean; apiUrl: string; installationId: string; apiVersion: 1; chaveCifrada: string; ultimaValidacao: string }
const vazio: Gravado = { habilitada: false, apiUrl: '', installationId: '', apiVersion: 1, chaveCifrada: '', ultimaValidacao: '' };
const arquivo = () => join(app.getPath('userData'), 'integracao-api.json');
const ler = (): Gravado => { try { return lerJson(arquivo(), vazio); } catch { return vazio; } };
const gravar = (valor: Gravado) => gravarJson(arquivo(), valor);

export function chave(): string {
  const cfg = ler();
  if (!cfg.chaveCifrada || !disponivel()) return '';
  try { return safeStorage.decryptString(Buffer.from(cfg.chaveCifrada, 'base64')); } catch { return ''; }
}
export function estado() {
  const cfg = ler();
  const temChave = Boolean(chave());
  return { habilitada: cfg.habilitada && temChave, apiUrl: cfg.apiUrl, installationId: cfg.installationId,
    apiVersion: 1 as const, temChave, ultimaValidacao: cfg.ultimaValidacao };
}
export function salvarConfig(apiUrl: string, installationId: string, habilitada: boolean): void {
  validarConfig(apiUrl, installationId);
  if (habilitada && !chave()) throw new Error('Chave da API pendente');
  const cfg = ler();
  gravar({ ...cfg, apiUrl, installationId, habilitada });
}
export function trocarChave(valor: string): void {
  if (!/^dsk_[A-Za-z0-9._:-]+$/.test(valor)) throw new Error('Chave deve iniciar com dsk_');
  if (!disponivel()) throw new Error('Criptografia do sistema indisponivel');
  let cifrada: string;
  try { cifrada = safeStorage.encryptString(valor).toString('base64'); }
  catch { gravar({ ...ler(), habilitada: false }); throw new Error('Falha ao cifrar chave'); }
  gravar({ ...ler(), habilitada: false, chaveCifrada: cifrada });
}
export function removerChave(): void { gravar({ ...ler(), habilitada: false, chaveCifrada: '' }); }
export function validar(): void {
  const cfg = ler();
  validarConfig(cfg.apiUrl, cfg.installationId);
  if (!chave()) throw new Error('Chave da API pendente ou ilegivel');
  gravar({ ...cfg, ultimaValidacao: new Date().toISOString() });
}
