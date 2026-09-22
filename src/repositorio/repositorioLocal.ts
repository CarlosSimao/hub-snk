import type { BaseLocal, BancoLocal } from '../tipos.ts';

export interface DadosDeBaseLocal {
  nome: string;
  caminhoWildfly: string;
  porta: number;
}

export interface DadosDeBancoLocal {
  container: string;
  host: string;
  porta: number;
  nomeDoServico: string;
  usuario: string;
  senha: string;
}

/**
 * Contrato de persistência das bases e bancos locais — cadastros da máquina
 * do usuário, sem vínculo com cliente.
 */
export interface RepositorioLocal {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  listarBases(): Promise<BaseLocal[]>;
  criarBase(dados: DadosDeBaseLocal): Promise<BaseLocal>;
  atualizarBase(id: string, dados: DadosDeBaseLocal): Promise<BaseLocal>;
  removerBase(id: string): Promise<void>;

  listarBancos(): Promise<BancoLocal[]>;
  criarBanco(dados: DadosDeBancoLocal): Promise<BancoLocal>;
  atualizarBanco(id: string, dados: DadosDeBancoLocal): Promise<BancoLocal>;
  removerBanco(id: string): Promise<void>;
}

export class BaseLocalNaoEncontradaError extends Error {
  constructor(id: string) {
    super(`Base local não encontrada: ${id}`);
    this.name = 'BaseLocalNaoEncontradaError';
  }
}

export class BancoLocalNaoEncontradoError extends Error {
  constructor(id: string) {
    super(`Banco local não encontrado: ${id}`);
    this.name = 'BancoLocalNaoEncontradoError';
  }
}
