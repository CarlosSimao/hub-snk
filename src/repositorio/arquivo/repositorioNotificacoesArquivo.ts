import { join } from 'node:path';
import type { Notificacao } from '../../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import { FilaDeOperacoes } from './filaDeOperacoes.ts';
import type { RepositorioNotificacoes } from '../repositorioNotificacoes.ts';

const NOME_DO_ARQUIVO = 'notificacoes.json';
const CHAVE_DO_CORPO = 'notificacoes';

/* O painel é um histórico curto, não um arquivo morto: a mais antiga sai quando passa disto. */
const LIMITE_DE_NOTIFICACOES = 200;

/* As chaves só precisam sobreviver ao dia do fato que as gerou; a folga cobre fuso e atraso. */
const DIAS_DE_RETENCAO_DAS_CHAVES = 7;
const MILISSEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;

interface DadosDoArquivo {
  lista: Notificacao[];
  /** Chave emitida -> ISO de quando foi emitida. */
  chavesEmitidas: Record<string, string>;
}

function ehObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function descartarChavesVencidas(
  chaves: Record<string, string>,
  agora: Date,
): Record<string, string> {
  const limite = agora.getTime() - DIAS_DE_RETENCAO_DAS_CHAVES * MILISSEGUNDOS_POR_DIA;
  return Object.fromEntries(
    Object.entries(chaves).filter(([, emitidaEm]) => Date.parse(emitidaEm) >= limite),
  );
}

/**
 * Notificações num arquivo JSON próprio, com a mesma escrita atômica dos demais
 * repositórios.
 */
export class RepositorioNotificacoesArquivo implements RepositorioNotificacoes {
  readonly #caminhoDoArquivo: string;
  #dados: DadosDoArquivo | null = null;
  readonly #fila = new FilaDeOperacoes();

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
  }

  async #ler(): Promise<DadosDoArquivo> {
    if (this.#dados) {
      return this.#dados;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    if (conteudo === null) {
      this.#dados = { lista: [], chavesEmitidas: {} };
      return this.#dados;
    }

    const corpo = ehObjeto(conteudo.corpo) ? conteudo.corpo : {};
    this.#dados = {
      lista: Array.isArray(corpo.lista) ? (corpo.lista as Notificacao[]) : [],
      chavesEmitidas: ehObjeto(corpo.chavesEmitidas)
        ? (corpo.chavesEmitidas as Record<string, string>)
        : {},
    };

    if (precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: this.#dados,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#dados;
  }

  async #gravar(dados: DadosDoArquivo): Promise<void> {
    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, dados);
    this.#dados = dados;
  }

  listar(): Promise<Notificacao[]> {
    return this.#fila.enfileirar(async () => {
      const dados = await this.#ler();
      return dados.lista;
    });
  }

  chaveJaEmitida(chave: string): Promise<boolean> {
    return this.#fila.enfileirar(async () => {
      const dados = await this.#ler();
      return chave in dados.chavesEmitidas;
    });
  }

  adicionar(notificacao: Notificacao): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const dados = await this.#ler();
      const chavesEmitidas = descartarChavesVencidas(dados.chavesEmitidas, new Date());
      chavesEmitidas[notificacao.chave] = notificacao.criadaEm;

      await this.#gravar({
        lista: [notificacao, ...dados.lista].slice(0, LIMITE_DE_NOTIFICACOES),
        chavesEmitidas,
      });
    });
  }

  marcarComoLidas(ids?: readonly string[]): Promise<Notificacao[]> {
    return this.#fila.enfileirar(async () => {
      const dados = await this.#ler();
      const alvos = ids ? new Set(ids) : null;
      const lista = dados.lista.map((notificacao) =>
        alvos === null || alvos.has(notificacao.id) ? { ...notificacao, lida: true } : notificacao,
      );

      await this.#gravar({ ...dados, lista });
      return lista;
    });
  }

  limpar(): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const dados = await this.#ler();
      await this.#gravar({ ...dados, lista: [] });
    });
  }
}
