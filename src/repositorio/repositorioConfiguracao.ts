import type { Atalho, ConfiguracaoGlobal } from '../tipos.ts';

/** Atalho que ainda não foi gravado não tem id: quem o cria é o repositório. */
export type DadosDeAtalho = Omit<Atalho, 'id'> & { id?: string };

export interface ConfiguracaoParaSalvar extends Omit<ConfiguracaoGlobal, 'atalhos'> {
  atalhos: DadosDeAtalho[];
}

/**
 * Contrato de persistência da configuração global.
 *
 * Separado de `RepositorioClientes` porque configuração e cadastro mudam por
 * motivos diferentes e vivem em arquivos diferentes.
 */
export interface RepositorioConfiguracao {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  ler(): Promise<ConfiguracaoGlobal>;
  salvar(configuracao: ConfiguracaoParaSalvar): Promise<ConfiguracaoGlobal>;
}
