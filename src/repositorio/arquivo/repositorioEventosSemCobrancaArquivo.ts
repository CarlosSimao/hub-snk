import { join } from 'node:path';
import type { RepositorioEventosSemCobranca } from '../repositorioEventosSemCobranca.ts';
import { MODOS_DE_COBRANCA, type DecisaoDeCobranca, type ModoDeCobranca } from '../../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import { FilaDeOperacoes } from './filaDeOperacoes.ts';

export const NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA = 'eventos-sem-cobranca.json';
const CHAVE_DO_CORPO = 'eventos';

type DecisoesGravadas = Record<string, DecisaoDeCobranca>;

function ehModo(valor: unknown): valor is ModoDeCobranca {
  return MODOS_DE_COBRANCA.includes(valor as ModoDeCobranca);
}

/**
 * Até a v2.26.0 o corpo era a lista dos eventos sem cobrança: cada um vira `nao-cobrar`.
 * Decisão inválida é descartada, e o evento volta a ser cobrado normalmente.
 */
function lerDecisoes(corpo: unknown): Map<string, DecisaoDeCobranca> {
  if (Array.isArray(corpo)) {
    return new Map(
      corpo
        .filter((item): item is string => typeof item === 'string')
        .map((id) => [id, { modo: 'nao-cobrar', gestorConfirmadoId: null }]),
    );
  }
  if (typeof corpo !== 'object' || corpo === null) {
    return new Map();
  }

  const decisoes = new Map<string, DecisaoDeCobranca>();
  for (const [id, bruta] of Object.entries(corpo as Record<string, Partial<DecisaoDeCobranca>>)) {
    if (!ehModo(bruta?.modo)) continue;
    const gestorConfirmadoId =
      typeof bruta.gestorConfirmadoId === 'string' ? bruta.gestorConfirmadoId : null;
    if (bruta.modo === 'com-gestor' && !gestorConfirmadoId) continue;
    decisoes.set(id, {
      modo: bruta.modo,
      gestorConfirmadoId: bruta.modo === 'com-gestor' ? gestorConfirmadoId : null,
    });
  }
  return decisoes;
}

/*
 * Decisões num arquivo JSON próprio, na pasta de dados: é escolha do usuário, como os
 * lembretes, e vai junto no backup. Sem limpeza das antigas: cada uma é um texto curto.
 */
export class RepositorioEventosSemCobrancaArquivo implements RepositorioEventosSemCobranca {
  readonly #caminhoDoArquivo: string;
  #decisoes: Map<string, DecisaoDeCobranca> | null = null;
  readonly #fila = new FilaDeOperacoes();

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO_DOS_EVENTOS_SEM_COBRANCA);
  }

  descartarCache(): void {
    this.#decisoes = null;
  }

  async #ler(): Promise<Map<string, DecisaoDeCobranca>> {
    if (this.#decisoes) {
      return this.#decisoes;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    this.#decisoes = lerDecisoes(conteudo?.corpo);

    if (conteudo && precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: Object.fromEntries(this.#decisoes) satisfies DecisoesGravadas,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#decisoes;
  }

  listar(): Promise<Map<string, DecisaoDeCobranca>> {
    return this.#fila.enfileirar(async () => new Map(await this.#ler()));
  }

  definir(identificacao: string, decisao: DecisaoDeCobranca | null): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const decisoes = new Map(await this.#ler());
      if (decisao) {
        decisoes.set(identificacao, decisao);
      } else if (!decisoes.delete(identificacao)) {
        return;
      }

      const corpo: DecisoesGravadas = Object.fromEntries(decisoes);
      await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, corpo);
      this.#decisoes = decisoes;
    });
  }
}
