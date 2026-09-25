import { existsSync, mkdirSync, openSync, closeSync, fsyncSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function lerJson<T>(arquivo: string, padrao: T): T {
  if (!existsSync(arquivo)) return padrao;
  return JSON.parse(readFileSync(arquivo, 'utf8')) as T;
}

export function gravarJson(arquivo: string, valor: unknown): void {
  mkdirSync(dirname(arquivo), { recursive: true });
  const temporario = `${arquivo}.${process.pid}.tmp`;
  try {
    writeFileSync(temporario, JSON.stringify(valor), { encoding: 'utf8', flag: 'w' });
    // No Windows FlushFileBuffers exige handle com permissao de escrita.
    const fd = openSync(temporario, 'r+');
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporario, arquivo);
  } catch (erro) {
    try { unlinkSync(temporario); } catch { /* arquivo temporario ausente */ }
    throw erro;
  }
}
