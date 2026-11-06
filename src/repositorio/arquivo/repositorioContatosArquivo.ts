import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Contato } from '../../tipos.ts';
import {
  gravarArquivoDeDados,
  lerArquivoDeDados,
  migrarArquivoDeDados,
  precisaMigrar,
} from './arquivoDeDados.ts';
import { FilaDeOperacoes } from './filaDeOperacoes.ts';
import {
  ContatoNaoEncontradoError,
  GestorInvalidoError,
  type DadosDeContato,
  type RepositorioContatos,
} from '../repositorioContatos.ts';

const NOME_DO_ARQUIVO = 'contatos.json';
const CHAVE_DO_CORPO = 'contatos';

type CamposDoUsuario = Omit<Contato, 'id' | 'criadoEm' | 'atualizadoEm'>;

function normalizarDados(dados: DadosDeContato, atual?: Contato): CamposDoUsuario {
  return {
    nome: dados.nome.trim(),
    telefone: dados.telefone.trim(),
    email: dados.email.trim(),
    cargo: dados.cargo.trim(),
    clienteId: dados.clienteId,
    gestorId: dados.gestorId !== undefined ? dados.gestorId : (atual?.gestorId ?? null),
    gerente: dados.gerente ?? atual?.gerente ?? false,
  };
}

/** Arquivo de antes do gestor: os contatos chegam sem os dois campos. */
function lerContato(contato: Contato): Contato {
  return {
    ...contato,
    gestorId: typeof contato.gestorId === 'string' ? contato.gestorId : null,
    gerente: contato.gerente === true,
  };
}

/**
 * Sobe a cadeia a partir do gestor: chegar no próprio contato é ciclo. O conjunto de
 * visitados protege de ciclo que já esteja no arquivo, editado fora do HUB.
 */
function validarGestor(contatos: Contato[], contatoId: string | null, gestorId: string): void {
  if (gestorId === contatoId) {
    throw new GestorInvalidoError('O contato não pode ser gestor de si mesmo.');
  }
  const porId = new Map(contatos.map((contato) => [contato.id, contato]));
  const visitados = new Set<string>();
  for (let atual = porId.get(gestorId); atual; atual = porId.get(atual.gestorId ?? '')) {
    if (atual.id === contatoId) {
      throw new GestorInvalidoError('O gestor escolhido é subordinado deste contato.');
    }
    if (visitados.has(atual.id)) {
      return;
    }
    visitados.add(atual.id);
  }
  if (!porId.has(gestorId)) {
    throw new GestorInvalidoError('Gestor não encontrado.');
  }
}

/** Quem vira gestor de alguém fica com "Gerente" marcado. */
function marcarGerente(contatos: Contato[], gestorId: string | null, agora: string): Contato[] {
  return contatos.map((contato) =>
    contato.id === gestorId && !contato.gerente
      ? { ...contato, gerente: true, atualizadoEm: agora }
      : contato,
  );
}

/**
 * Contatos num arquivo JSON próprio, com a mesma escrita atômica dos demais
 * repositórios. Fica na pasta de dados porque é cadastro, como os clientes.
 */
export class RepositorioContatosArquivo implements RepositorioContatos {
  readonly #caminhoDoArquivo: string;
  #contatos: Contato[] | null = null;
  readonly #fila = new FilaDeOperacoes();

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

    this.#contatos = Array.isArray(conteudo.corpo)
      ? (conteudo.corpo as Contato[]).map(lerContato)
      : [];

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

  listar(): Promise<Contato[]> {
    return this.#fila.enfileirar(async () => {
      return this.#ler();
    });
  }

  criar(dados: DadosDeContato): Promise<Contato> {
    return this.#fila.enfileirar(async () => {
      const contatos = await this.#ler();
      const agora = new Date().toISOString();
      const contato: Contato = {
        id: randomUUID(),
        ...normalizarDados(dados),
        criadoEm: agora,
        atualizadoEm: agora,
      };
      if (contato.gestorId !== null) {
        validarGestor(contatos, null, contato.gestorId);
      }

      await this.#gravar(marcarGerente([...contatos, contato], contato.gestorId, agora));
      return contato;
    });
  }

  atualizar(id: string, dados: DadosDeContato): Promise<Contato> {
    return this.#fila.enfileirar(async () => {
      const contatos = await this.#ler();
      const atual = contatos.find((contato) => contato.id === id);
      if (!atual) {
        throw new ContatoNaoEncontradoError(id);
      }

      const agora = new Date().toISOString();
      const alterado: Contato = {
        ...atual,
        ...normalizarDados(dados, atual),
        atualizadoEm: agora,
      };
      if (alterado.gestorId !== null) {
        validarGestor(contatos, id, alterado.gestorId);
      }

      const comAlterado = contatos.map((contato) => (contato.id === id ? alterado : contato));
      await this.#gravar(marcarGerente(comAlterado, alterado.gestorId, agora));
      return alterado;
    });
  }

  remover(id: string): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const contatos = await this.#ler();
      if (!contatos.some((contato) => contato.id === id)) {
        throw new ContatoNaoEncontradoError(id);
      }

      const agora = new Date().toISOString();
      await this.#gravar(
        contatos
          .filter((contato) => contato.id !== id)
          .map((contato) =>
            contato.gestorId === id ? { ...contato, gestorId: null, atualizadoEm: agora } : contato,
          ),
      );
    });
  }

  desvincularDoCliente(clienteId: string): Promise<void> {
    return this.#fila.enfileirar(async () => {
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
    });
  }
}
