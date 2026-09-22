import { stat } from 'node:fs/promises';

export class PastaNaoEncontradaError extends Error {
  constructor(caminho: string) {
    super(`A pasta não existe ou não é um diretório: ${caminho}`);
    this.name = 'PastaNaoEncontradaError';
  }
}

export async function garantirQueEhPasta(caminho: string): Promise<void> {
  try {
    const informacoes = await stat(caminho);
    if (!informacoes.isDirectory()) {
      throw new PastaNaoEncontradaError(caminho);
    }
  } catch (erro) {
    if (erro instanceof PastaNaoEncontradaError) {
      throw erro;
    }
    throw new PastaNaoEncontradaError(caminho);
  }
}
