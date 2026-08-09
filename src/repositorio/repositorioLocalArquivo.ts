import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BaseLocal, BancoLocal } from '../tipos.ts';
import {
  BaseLocalNaoEncontradaError,
  BancoLocalNaoEncontradoError,
  type DadosDeBancoLocal,
  type DadosDeBaseLocal,
  type RepositorioLocal,
} from './repositorioLocal.ts';

const NOME_DO_ARQUIVO = 'local.json';
const IDENTACAO_JSON = 2;

interface DadosDoArquivo {
  bases: BaseLocal[];
  bancos: BancoLocal[];
}

const ARQUIVO_INICIAL: DadosDoArquivo = { bases: [], bancos: [] };

/**
 * Bases e bancos locais num arquivo JSON próprio, com a mesma escrita atômica
 * usada nos demais repositórios (grava em `.tmp` e renomeia por cima).
 */
export class RepositorioLocalArquivo implements RepositorioLocal {
  readonly #caminhoDoArquivo: string;
  #dados: DadosDoArquivo | null = null;

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
  }

  descartarCache(): void {
    this.#dados = null;
  }

  async #ler(): Promise<DadosDoArquivo> {
    if (this.#dados) {
      return this.#dados;
    }

    let conteudo: string;
    try {
      conteudo = await readFile(this.#caminhoDoArquivo, 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        this.#dados = structuredClone(ARQUIVO_INICIAL);
        return this.#dados;
      }
      throw erro;
    }

    this.#dados = JSON.parse(conteudo) as DadosDoArquivo;
    return this.#dados;
  }

  async #gravar(dados: DadosDoArquivo): Promise<void> {
    await mkdir(dirname(this.#caminhoDoArquivo), { recursive: true });

    const caminhoTemporario = `${this.#caminhoDoArquivo}.tmp`;
    await writeFile(caminhoTemporario, JSON.stringify(dados, null, IDENTACAO_JSON), 'utf8');
    await rename(caminhoTemporario, this.#caminhoDoArquivo);

    this.#dados = dados;
  }

  async listarBases(): Promise<BaseLocal[]> {
    const dados = await this.#ler();
    return dados.bases;
  }

  async criarBase(dadosDaBase: DadosDeBaseLocal): Promise<BaseLocal> {
    const dados = await this.#ler();
    const agora = new Date().toISOString();

    const base: BaseLocal = {
      id: randomUUID(),
      nome: dadosDaBase.nome,
      caminhoWildfly: dadosDaBase.caminhoWildfly,
      porta: dadosDaBase.porta,
      criadoEm: agora,
      atualizadoEm: agora,
    };

    await this.#gravar({ ...dados, bases: [...dados.bases, base] });
    return base;
  }

  async atualizarBase(id: string, dadosDaBase: DadosDeBaseLocal): Promise<BaseLocal> {
    const dados = await this.#ler();
    const indice = dados.bases.findIndex((base) => base.id === id);
    if (indice === -1) {
      throw new BaseLocalNaoEncontradaError(id);
    }

    const base: BaseLocal = {
      ...dados.bases[indice]!,
      nome: dadosDaBase.nome,
      caminhoWildfly: dadosDaBase.caminhoWildfly,
      porta: dadosDaBase.porta,
      atualizadoEm: new Date().toISOString(),
    };

    const bases = [...dados.bases];
    bases[indice] = base;

    await this.#gravar({ ...dados, bases });
    return base;
  }

  async removerBase(id: string): Promise<void> {
    const dados = await this.#ler();
    if (!dados.bases.some((base) => base.id === id)) {
      throw new BaseLocalNaoEncontradaError(id);
    }

    await this.#gravar({ ...dados, bases: dados.bases.filter((base) => base.id !== id) });
  }

  async listarBancos(): Promise<BancoLocal[]> {
    const dados = await this.#ler();
    return dados.bancos;
  }

  async criarBanco(dadosDoBanco: DadosDeBancoLocal): Promise<BancoLocal> {
    const dados = await this.#ler();
    const agora = new Date().toISOString();

    const banco: BancoLocal = {
      id: randomUUID(),
      ...dadosDoBanco,
      criadoEm: agora,
      atualizadoEm: agora,
    };

    await this.#gravar({ ...dados, bancos: [...dados.bancos, banco] });
    return banco;
  }

  async atualizarBanco(id: string, dadosDoBanco: DadosDeBancoLocal): Promise<BancoLocal> {
    const dados = await this.#ler();
    const indice = dados.bancos.findIndex((banco) => banco.id === id);
    if (indice === -1) {
      throw new BancoLocalNaoEncontradoError(id);
    }

    const banco: BancoLocal = {
      ...dados.bancos[indice]!,
      ...dadosDoBanco,
      atualizadoEm: new Date().toISOString(),
    };

    const bancos = [...dados.bancos];
    bancos[indice] = banco;

    await this.#gravar({ ...dados, bancos });
    return banco;
  }

  async removerBanco(id: string): Promise<void> {
    const dados = await this.#ler();
    if (!dados.bancos.some((banco) => banco.id === id)) {
      throw new BancoLocalNaoEncontradoError(id);
    }

    await this.#gravar({ ...dados, bancos: dados.bancos.filter((banco) => banco.id !== id) });
  }
}
