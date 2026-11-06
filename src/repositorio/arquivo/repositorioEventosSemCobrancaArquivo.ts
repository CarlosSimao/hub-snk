import { join } from 'node:path';
import type { RepositorioEventosSemCobranca } from '../repositorioEventosSemCobranca.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import { FilaDeOperacoes } from './filaDeOperacoes.ts';

export const NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA = 'eventos-sem-cobranca.json';
const CHAVE_DO_CORPO = 'eventos';

/*
 * Marcações num arquivo JSON próprio, na pasta de dados: é decisão do usuário, como os
 * lembretes, e vai junto no backup. Sem limpeza das antigas: cada uma é um texto curto.
 */
export class RepositorioEventosSemCobrancaArquivo implements RepositorioEventosSemCobranca {
  readonly #caminhoDoArquivo: string;
  #eventos: Set<string> | null = null;
  readonly #fila = new FilaDeOperacoes();

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA);
  }

  descartarCache(): void {
    this.#eventos = null;
  }

  async #ler(): Promise<Set<string>> {
    if (this.#eventos) {
      return this.#eventos;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    const lidos = Array.isArray(conteudo?.corpo)
      ? conteudo.corpo.filter((item): item is string => typeof item === 'string')
      : [];
    this.#eventos = new Set(lidos);

    if (conteudo && precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: lidos,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#eventos;
  }

  listar(): Promise<Set<string>> {
    return this.#fila.enfileirar(async () => new Set(await this.#ler()));
  }

  definir(identificacao: string, naoCobrar: boolean): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const eventos = new Set(await this.#ler());
      if (naoCobrar === eventos.has(identificacao)) {
        return;
      }

      if (naoCobrar) {
        eventos.add(identificacao);
      } else {
        eventos.delete(identificacao);
      }
      await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, [...eventos]);
      this.#eventos = eventos;
    });
  }
}
