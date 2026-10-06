import { join } from 'node:path';
import { gravarArquivoDeDados, lerArquivoDeDados } from '../repositorio/arquivo/arquivoDeDados.ts';
import { FilaDeOperacoes } from '../repositorio/arquivo/filaDeOperacoes.ts';

const NOME_DO_ARQUIVO = 'pastas.json';
const CHAVE_DO_CORPO = 'pastas';

/**
 * Pasta de cada cliente ou projeto no explorador, por chave (`cliente:<id>` ou
 * `projeto:<id do cliente>:<id do projeto>`).
 *
 * O caminho é da máquina — outra máquina que sincronize o cadastro tem pastas próprias —,
 * então o arquivo mora fora da pasta de dados, que pode estar num Drive sincronizado.
 */
export class PastasDoExplorador {
  readonly #caminhoDoArquivo: string;
  readonly #fila = new FilaDeOperacoes();
  #pastas: Record<string, string> | null = null;

  constructor(pastaDeEstado: string) {
    this.#caminhoDoArquivo = join(pastaDeEstado, NOME_DO_ARQUIVO);
  }

  async #ler(): Promise<Record<string, string>> {
    if (this.#pastas) return this.#pastas;
    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    const corpo = conteudo?.corpo;
    const pastas: Record<string, string> = {};
    if (typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo)) {
      for (const [chave, valor] of Object.entries(corpo)) {
        if (typeof valor === 'string' && valor) pastas[chave] = valor;
      }
    }
    this.#pastas = pastas;
    return pastas;
  }

  obter(chave: string): Promise<string | null> {
    return this.#fila.enfileirar(async () => (await this.#ler())[chave] ?? null);
  }

  /** `null` desvincula a pasta; os arquivos dela não são tocados. */
  definir(chave: string, pasta: string | null): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const pastas = { ...(await this.#ler()) };
      if (pasta) pastas[chave] = pasta;
      else delete pastas[chave];
      await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, pastas);
      this.#pastas = pastas;
    });
  }
}
