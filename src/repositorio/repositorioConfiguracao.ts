import type { Atalho, ConfiguracaoGlobal } from '../tipos.ts';

/** Atalho que ainda não foi gravado não tem id: quem o cria é o repositório. */
export type DadosDeAtalho = Omit<Atalho, 'id'> & { id?: string };

/**
 * `experiencePersonId` fica de fora: não tem campo na tela de configuração, então o
 * formulário nunca manda esse valor. Se entrasse aqui, `salvar()` — que grava o
 * objeto inteiro — apagaria o que `definirExperiencePersonId` guardou a cada vez
 * que o usuário só mudasse outro campo da tela.
 */
export interface ConfiguracaoParaSalvar
  extends Omit<ConfiguracaoGlobal, 'atalhos' | 'experiencePersonId'> {
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
  /** Escrita isolada do `person_id` da Experience, fora do fluxo da tela de configuração. */
  definirExperiencePersonId(personId: string): Promise<ConfiguracaoGlobal>;
}
