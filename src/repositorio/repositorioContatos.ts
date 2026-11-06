import type { Contato } from '../tipos.ts';

/**
 * O que o usuário preenche; id e datas são da persistência. Gestor e "Gerente" ausentes
 * valem sem gestor e desmarcado no cadastro, e mantidos na alteração.
 */
export type DadosDeContato = Omit<
  Contato,
  'id' | 'criadoEm' | 'atualizadoEm' | 'gestorId' | 'gerente'
> &
  Partial<Pick<Contato, 'gestorId' | 'gerente'>>;

export class ContatoNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Contato não encontrado: ${id}.`);
    this.name = 'ContatoNaoEncontradoError';
  }
}

/** Gestor que não existe, o próprio contato ou um subordinado dele. */
export class GestorInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'GestorInvalidoError';
  }
}

/** Contrato de persistência dos contatos. */
export interface RepositorioContatos {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  listar(): Promise<Contato[]>;
  /** Com gestor, o gestor fica com "Gerente" marcado. */
  criar(dados: DadosDeContato): Promise<Contato>;
  /** Com gestor, o gestor fica com "Gerente" marcado. */
  atualizar(id: string, dados: DadosDeContato): Promise<Contato>;
  /** Os subordinados do contato removido ficam sem gestor. */
  remover(id: string): Promise<void>;
  /** O cliente foi excluído: os contatos dele ficam, só que sem cliente. */
  desvincularDoCliente(clienteId: string): Promise<void>;
}
