import type { Contato } from '../tipos.ts';

/** O que o usuário preenche; id e datas são da persistência. */
export type DadosDeContato = Omit<Contato, 'id' | 'criadoEm' | 'atualizadoEm'>;

export class ContatoNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Contato não encontrado: ${id}.`);
    this.name = 'ContatoNaoEncontradoError';
  }
}

/** Contrato de persistência dos contatos. */
export interface RepositorioContatos {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  listar(): Promise<Contato[]>;
  criar(dados: DadosDeContato): Promise<Contato>;
  atualizar(id: string, dados: DadosDeContato): Promise<Contato>;
  remover(id: string): Promise<void>;
  /** O cliente foi excluído: os contatos dele ficam, só que sem cliente. */
  desvincularDoCliente(clienteId: string): Promise<void>;
}
