import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Lembrete } from '../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import {
  LembreteNaoEncontradoError,
  type DadosDeLembrete,
  type RepositorioLembretes,
} from './repositorioLembretes.ts';

const NOME_DO_ARQUIVO = 'lembretes.json';
const CHAVE_DO_CORPO = 'lembretes';

/**
 * Campo do outro tipo sai vazio: o lembrete único não carrega cron velho, nem o recorrente
 * data. Sem e-mail, não há a quem copiar: os contatos saem junto.
 */
function normalizarDados(dados: DadosDeLembrete): DadosDeLembrete {
  const unico = dados.tipo === 'unico';
  return {
    resumo: dados.resumo.trim(),
    texto: dados.texto.trim(),
    tipo: dados.tipo,
    dataHora: unico ? dados.dataHora : '',
    expressaoCron: unico ? '' : dados.expressaoCron.trim(),
    clienteId: dados.clienteId,
    projetoId: dados.clienteId === null ? null : dados.projetoId,
    enviarEmail: dados.enviarEmail,
    contatoIds: dados.enviarEmail ? [...new Set(dados.contatoIds)] : [],
    ativo: dados.ativo,
  };
}

/** Lembrete gravado antes do resumo e dos contatos não tem os campos: nascem vazios. */
function lerLembrete(bruto: Lembrete): Lembrete {
  return {
    ...bruto,
    resumo: typeof bruto.resumo === 'string' ? bruto.resumo : '',
    contatoIds: Array.isArray(bruto.contatoIds)
      ? bruto.contatoIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

/**
 * Só a mudança de quando dispara rearma o lembrete: corrigir o texto de um lembrete
 * único já disparado não pode fazê-lo disparar de novo. Religar um recorrente também
 * rearma, senão a ocorrência perdida enquanto esteve desligado dispararia na hora.
 */
function mudouOQuando(atual: Lembrete, dados: DadosDeLembrete): boolean {
  const religouRecorrente = dados.tipo === 'recorrente' && !atual.ativo && dados.ativo;
  return (
    religouRecorrente ||
    atual.tipo !== dados.tipo ||
    atual.dataHora !== dados.dataHora ||
    atual.expressaoCron !== dados.expressaoCron
  );
}

/**
 * Lembretes num arquivo JSON próprio, com a mesma escrita atômica dos demais
 * repositórios. Fica na pasta de dados porque é cadastro, como os clientes.
 */
export class RepositorioLembretesArquivo implements RepositorioLembretes {
  readonly #caminhoDoArquivo: string;
  #lembretes: Lembrete[] | null = null;

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
  }

  descartarCache(): void {
    this.#lembretes = null;
  }

  async #ler(): Promise<Lembrete[]> {
    if (this.#lembretes) {
      return this.#lembretes;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    if (conteudo === null) {
      this.#lembretes = [];
      return this.#lembretes;
    }

    this.#lembretes = Array.isArray(conteudo.corpo)
      ? (conteudo.corpo as Lembrete[]).map(lerLembrete)
      : [];

    if (precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: this.#lembretes,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#lembretes;
  }

  async #gravar(lembretes: Lembrete[]): Promise<void> {
    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, lembretes);
    this.#lembretes = lembretes;
  }

  async #substituir(id: string, alterar: (atual: Lembrete) => Lembrete): Promise<Lembrete> {
    const lembretes = await this.#ler();
    const atual = lembretes.find((lembrete) => lembrete.id === id);
    if (!atual) {
      throw new LembreteNaoEncontradoError(id);
    }

    const alterado = alterar(atual);
    await this.#gravar(lembretes.map((lembrete) => (lembrete.id === id ? alterado : lembrete)));
    return alterado;
  }

  async listar(): Promise<Lembrete[]> {
    return this.#ler();
  }

  async criar(dados: DadosDeLembrete): Promise<Lembrete> {
    const lembretes = await this.#ler();
    const agora = new Date().toISOString();
    const lembrete: Lembrete = {
      id: randomUUID(),
      ...normalizarDados(dados),
      ultimoDisparoEm: '',
      criadoEm: agora,
      atualizadoEm: agora,
    };

    await this.#gravar([...lembretes, lembrete]);
    return lembrete;
  }

  atualizar(id: string, dados: DadosDeLembrete): Promise<Lembrete> {
    return this.#substituir(id, (atual) => {
      const normalizados = normalizarDados(dados);
      return {
        ...atual,
        ...normalizados,
        ultimoDisparoEm: mudouOQuando(atual, normalizados) ? '' : atual.ultimoDisparoEm,
        atualizadoEm: new Date().toISOString(),
      };
    });
  }

  async remover(id: string): Promise<void> {
    const lembretes = await this.#ler();
    if (!lembretes.some((lembrete) => lembrete.id === id)) {
      throw new LembreteNaoEncontradoError(id);
    }

    await this.#gravar(lembretes.filter((lembrete) => lembrete.id !== id));
  }

  registrarDisparo(id: string, disparadoEm: Date): Promise<Lembrete> {
    return this.#substituir(id, (atual) => ({
      ...atual,
      ultimoDisparoEm: disparadoEm.toISOString(),
    }));
  }
}
