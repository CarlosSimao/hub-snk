import type { Lembrete } from '../tipos.ts';

/** O que o usuário preenche; id, datas e disparo são da persistência. */
export type DadosDeLembrete = Omit<
  Lembrete,
  'id' | 'ultimoDisparoEm' | 'criadoEm' | 'atualizadoEm'
>;

export class LembreteNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Lembrete não encontrado: ${id}.`);
    this.name = 'LembreteNaoEncontradoError';
  }
}

/** Contrato de persistência dos lembretes. */
export interface RepositorioLembretes {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  listar(): Promise<Lembrete[]>;
  criar(dados: DadosDeLembrete): Promise<Lembrete>;
  /** Mudar a data, a expressão ou o tipo zera o último disparo: o novo quando conta do zero. */
  atualizar(id: string, dados: DadosDeLembrete): Promise<Lembrete>;
  remover(id: string): Promise<void>;
  registrarDisparo(id: string, disparadoEm: Date): Promise<Lembrete>;
}
