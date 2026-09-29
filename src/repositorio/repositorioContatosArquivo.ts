import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Contato } from '../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import {
  ContatoNaoEncontradoError,
  type DadosDeContato,
  type RepositorioContatos,
} from './repositorioContatos.ts';

const NOME_DO_ARQUIVO = 'contatos.json';
const CHAVE_DO_CORPO = 'contatos';

function normalizarDados(dados: DadosDeContato): DadosDeContato {
  return {
    nome: dados.nome.trim(),
    telefone: dados.telefone.trim(),
    email: dados.email.trim(),
    cargo: dados.cargo.trim(),
    clienteId: dados.clienteId,
  };
}

/**
 * Contatos num arquivo JSON próprio, com a mesma escrita atômica dos demais
 * repositórios. Fica na pasta de dados porque é cadastro, como os clientes.
 */
export class RepositorioContatosArquivo implements RepositorioContatos {
  readonly #caminhoDoArquivo: string;
  #contatos: Contato[] | null = null;

  constructor(diretorioDeDados: string) {
    this.#caminhoDoArquivo = join(diretorioDeDados, NOME_DO_ARQUIVO);
  }

  descartarCache(): void {
    this.#contatos = null;
  }

  async #ler(): Promise<Contato[]> {
    if (this.#contatos) {
      return this.#contatos;
    }

    const conteudo = await lerArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO);
    if (conteudo === null) {
      this.#contatos = [];
      return this.#contatos;
    }

    this.#contatos = Array.isArray(conteudo.corpo) ? (conteudo.corpo as Contato[]) : [];

    if (precisaMigrar(conteudo)) {
      await migrarArquivoDeDados({
        caminhoDoArquivo: this.#caminhoDoArquivo,
        chaveDoCorpo: CHAVE_DO_CORPO,
        corpo: this.#contatos,
        versaoDeOrigem: conteudo.versaoDeOrigem,
      });
    }

    return this.#contatos;
  }

  async #gravar(contatos: Contato[]): Promise<void> {
    await gravarArquivoDeDados(this.#caminhoDoArquivo, CHAVE_DO_CORPO, contatos);
    this.#contatos = contatos;
  }

  async listar(): Promise<Contato[]> {
    return this.#ler();
  }

  async criar(dados: DadosDeContato): Promise<Contato> {
    const contatos = await this.#ler();
    const agora = new Date().toISOString();
    const contato: Contato = {
      id: randomUUID(),
      ...normalizarDados(dados),
      criadoEm: agora,
      atualizadoEm: agora,
    };

    await this.#gravar([...contatos, contato]);
    return contato;
  }

  async atualizar(id: string, dados: DadosDeContato): Promise<Contato> {
    const contatos = await this.#ler();
    const atual = contatos.find((contato) => contato.id === id);
    if (!atual) {
      throw new ContatoNaoEncontradoError(id);
    }

    const alterado: Contato = {
      ...atual,
      ...normalizarDados(dados),
      atualizadoEm: new Date().toISOString(),
    };
    await this.#gravar(contatos.map((contato) => (contato.id === id ? alterado : contato)));
    return alterado;
  }

  async remover(id: string): Promise<void> {
    const contatos = await this.#ler();
    if (!contatos.some((contato) => contato.id === id)) {
      throw new ContatoNaoEncontradoError(id);
    }

    await this.#gravar(contatos.filter((contato) => contato.id !== id));
  }

  async desvincularDoCliente(clienteId: string): Promise<void> {
    const contatos = await this.#ler();
    if (!contatos.some((contato) => contato.clienteId === clienteId)) {
      return;
    }

    const agora = new Date().toISOString();
    await this.#gravar(
      contatos.map((contato) =>
        contato.clienteId === clienteId
          ? { ...contato, clienteId: null, atualizadoEm: agora }
          : contato,
      ),
    );
  }
}
