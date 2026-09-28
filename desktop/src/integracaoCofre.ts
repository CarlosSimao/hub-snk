import { app, safeStorage } from 'electron';
import { join } from 'node:path';
import { gravarJson, lerJson } from './integracaoArquivo';
import { disponivel } from './cofreCredenciais';
import { validarConfig } from './integracaoValidacao';

// `demandasNasHoras`: manda a demanda (ID da Solicitação de Serviços) de cada OS no
// horas.apontar e as demandas do ERP como demanda.upsert. Campo novo no contrato: fica
// desligado até o receptor confirmar que aceita.
// `painelV11`: campos e eventos do contrato de dashboards v1.1 (categoria e minutos da
// agenda, ausencias, janela de 4 meses, cancelamento, clientes automaticos, dia da OS,
// cargo e equipe). Desligado ate o receptor aceitar. `equipe` vai no usuario.upsert.
interface Gravado { habilitada: boolean; apiUrl: string; installationId: string; apiVersion: 1; chaveCifrada: string; ultimaValidacao: string; demandasNasHoras?: boolean; painelV11?: boolean; equipe?: string }
const vazio: Gravado = { habilitada: false, apiUrl: '', installationId: '', apiVersion: 1, chaveCifrada: '', ultimaValidacao: '', demandasNasHoras: false, painelV11: false, equipe: '' };
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
    apiVersion: 1 as const, temChave, ultimaValidacao: cfg.ultimaValidacao, demandasNasHoras: cfg.demandasNasHoras === true,
    painelV11: cfg.painelV11 === true, equipe: cfg.equipe ?? '' };
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
export function definirDemandasNasHoras(ligado: boolean): void { gravar({ ...ler(), demandasNasHoras: ligado }); }
export function definirPainelV11(ligado: boolean): void { gravar({ ...ler(), painelV11: ligado }); }
export function definirEquipe(equipe: string): void {
  const valor = equipe.trim().slice(0, 120);
  gravar({ ...ler(), equipe: valor });
}
export function removerChave(): void { gravar({ ...ler(), habilitada: false, chaveCifrada: '' }); }
export function validar(): void {
  const cfg = ler();
  validarConfig(cfg.apiUrl, cfg.installationId);
  if (!chave()) throw new Error('Chave da API pendente ou ilegivel');
  gravar({ ...cfg, ultimaValidacao: new Date().toISOString() });
}
