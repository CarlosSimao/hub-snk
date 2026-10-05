import { open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { mascararTexto } from './mascaramento.ts';

/** Quanto do FINAL de cada arquivo entra no relato: o problema quase sempre é recente. */
export const BYTES_POR_ARQUIVO = 512 * 1024;

const ARQUIVOS_DE_LOG = ['desktop.log', 'backend.log'] as const;

/**
 * Lê o final de um arquivo. Ausente ou ilegível devolve vazio: o relato segue sem
 * aquele trecho em vez de falhar por causa do log.
 */
export async function lerFinalDoArquivo(caminho: string, bytes: number): Promise<string> {
  try {
    const { size } = await stat(caminho);
    const inicio = Math.max(0, size - bytes);
    const arquivo = await open(caminho, 'r');
    try {
      const buffer = Buffer.alloc(size - inicio);
      await arquivo.read(buffer, 0, buffer.length, inicio);
      const texto = buffer.toString('utf8');
      // O corte cai no meio de uma linha; a primeira, incompleta, é descartada.
      return inicio > 0 ? texto.slice(texto.indexOf('\n') + 1) : texto;
    } finally {
      await arquivo.close();
    }
  } catch {
    return '';
  }
}

/**
 * Monta o texto de log que acompanha um relato: o final de cada arquivo, já mascarado,
 * com um cabeçalho dizendo de qual arquivo veio.
 *
 * É este texto, exatamente, que a tela mostra em "ver o que será enviado".
 */
export async function montarLogDeDiagnostico(pastaDeLog: string): Promise<string> {
  const trechos: string[] = [];
  for (const nome of ARQUIVOS_DE_LOG) {
    const conteudo = await lerFinalDoArquivo(join(pastaDeLog, nome), BYTES_POR_ARQUIVO);
    if (!conteudo.trim()) continue;
    trechos.push(`===== ${nome} =====\n${mascararTexto(conteudo).trimEnd()}`);
  }
  return trechos.join('\n\n');
}
