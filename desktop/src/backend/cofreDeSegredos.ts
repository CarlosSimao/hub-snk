/**
 * Segredos do backend que não são do Sankhya — hoje, a autorização do Google Drive —,
 * cifrados com o `safeStorage` do Electron (DPAPI no Windows).
 *
 * Arquivo próprio, separado do `credenciais.json`: remover o Sankhya ID regrava aquele
 * arquivo inteiro, e não pode levar junto a conexão com o Drive.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import { logEvento } from '../log';

/** O backend só guarda o que está nesta lista: o nome vem da URL da ponte. */
export const SEGREDOS = ['google-drive'] as const;
export type NomeDoSegredo = (typeof SEGREDOS)[number];

export function ehSegredoValido(valor: string): valor is NomeDoSegredo {
  return (SEGREDOS as readonly string[]).includes(valor);
}

type SegredosGravados = Partial<Record<NomeDoSegredo, string>>;

const ARQUIVO = join(app.getPath('userData'), 'segredos.json');

function ler(): SegredosGravados {
  if (!existsSync(ARQUIVO)) return {};
  try {
    return JSON.parse(readFileSync(ARQUIVO, 'utf8')) as SegredosGravados;
  } catch {
    // Arquivo ilegível vale como vazio: o usuário conecta a conta de novo pela tela.
    logEvento('segredos-ilegiveis');
    return {};
  }
}

/** Grava ao lado e renomeia por cima, como o cofre das credenciais. */
function gravarArquivo(segredos: SegredosGravados): void {
  mkdirSync(dirname(ARQUIVO), { recursive: true });
  const temporario = `${ARQUIVO}.tmp`;
  writeFileSync(temporario, JSON.stringify(segredos, null, 2), 'utf8');
  renameSync(temporario, ARQUIVO);
}

/**
 * `null` quando não há nada guardado, e também quando o valor não decifra: blob de outro
 * usuário do Windows (perfil recriado, arquivo copiado de outra máquina) não volta atrás.
 */
export function lerSegredo(nome: NomeDoSegredo): string | null {
  const cifrado = ler()[nome];
  if (!cifrado) return null;
  try {
    return safeStorage.decryptString(Buffer.from(cifrado, 'base64'));
  } catch {
    logEvento('segredo-decriptacao-falhou', { nome });
    return null;
  }
}

export function gravarSegredo(nome: NomeDoSegredo, valor: string): void {
  const segredos = ler();
  segredos[nome] = safeStorage.encryptString(valor).toString('base64');
  gravarArquivo(segredos);
}

export function removerSegredo(nome: NomeDoSegredo): void {
  const segredos = ler();
  delete segredos[nome];
  gravarArquivo(segredos);
}
