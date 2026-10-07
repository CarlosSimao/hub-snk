import type { Atalho, ConfiguracaoGlobal } from '../tipos.ts';

/** Atalho que ainda não foi gravado não tem id: quem o cria é o repositório. */
export type DadosDeAtalho = Omit<Atalho, 'id'> & { id?: string };

/**
 * `experiencePersonId` e `sankhyaOmCodUsu` ficam de fora: não têm campo na tela de
 * configuração (o CODUSU é digitado em Sankhya ID), então o formulário nunca
 * manda esses valores. Se entrassem aqui, `salvar()` — que grava o objeto inteiro —
 * apagaria o que `definirExperiencePersonId` e `definirSankhyaOmCodUsu` guardaram a
 * cada vez que o usuário só mudasse outro campo da tela.
 */
export interface ConfiguracaoParaSalvar extends Omit<
  ConfiguracaoGlobal,
  | 'atalhos'
  | 'experiencePersonId'
  | 'sankhyaOmCodUsu'
  | 'perfil'
  | 'funcionalidadesOcultas'
  | 'terceiro'
  | 'smtp'
  | 'alertaDaAgenda'
  | 'assistenteDeIa'
  | 'nomeDoUsuario'
  | 'empresaDoUsuario'
  | 'timeDoUsuario'
  | 'emailDoUsuario'
> {
  atalhos: DadosDeAtalho[];
  /** Ausentes, preservam o que está gravado: omitir não pode reexibir o que foi ocultado. */
  perfil?: ConfiguracaoGlobal['perfil'];
  funcionalidadesOcultas?: ConfiguracaoGlobal['funcionalidadesOcultas'];
  terceiro?: ConfiguracaoGlobal['terceiro'];
  /** Ausentes, preservam o que está gravado: omitir não pode apagar a senha do SMTP. */
  smtp?: ConfiguracaoGlobal['smtp'];
  alertaDaAgenda?: ConfiguracaoGlobal['alertaDaAgenda'];
  /** Ausente, preserva o assistente escolhido: uma tela antiga não manda o campo. */
  assistenteDeIa?: ConfiguracaoGlobal['assistenteDeIa'];
  /** Ausentes, preservam o que está gravado: uma tela antiga não manda os campos. */
  nomeDoUsuario?: ConfiguracaoGlobal['nomeDoUsuario'];
  empresaDoUsuario?: ConfiguracaoGlobal['empresaDoUsuario'];
  timeDoUsuario?: ConfiguracaoGlobal['timeDoUsuario'];
  emailDoUsuario?: ConfiguracaoGlobal['emailDoUsuario'];
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
  /** Escrita isolada do `CODUSU` do SankhyaOm, digitado em Sankhya ID. */
  definirSankhyaOmCodUsu(codusu: string): Promise<ConfiguracaoGlobal>;
}
