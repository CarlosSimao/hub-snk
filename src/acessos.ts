import { PERFIS_PROFISSIONAIS, type Funcionalidade, type PerfilProfissional } from './tipos.ts';

/** Sem perfil escolhido — `npm run dev` ou instalação anterior aos acessos — nada fica oculto. */
export const PERFIL_PADRAO: PerfilProfissional = 'desenvolvedor';

/**
 * Preset de cada perfil, em funcionalidades ocultas. É o que a instalação aplica e o
 * que a aba Acessos marca ao trocar de perfil; depois disso o usuário ajusta à vontade.
 */
export const FUNCIONALIDADES_OCULTAS_POR_PERFIL: Readonly<
  Record<PerfilProfissional, readonly Funcionalidade[]>
> = {
  desenvolvedor: [],
  consultor: ['cliente.repositorios'],
  analista: ['cliente.repositorios'],
  'gerente-de-projeto': ['cliente.repositorios', 'local'],
};

/**
 * O que só funciona com as credenciais do Sankhya Om ou da Experience. Com o acesso de
 * terceiro, ficam ocultas por cima do que está marcado, sem alterar o que foi gravado:
 * desmarcar Terceiro devolve a tela ao que era.
 */
export const FUNCIONALIDADES_QUE_DEPENDEM_DO_SANKHYA: readonly Funcionalidade[] = [
  'agenda',
  'os',
  'cliente.agenda',
  'cliente.os',
];

export function ehPerfilProfissional(valor: unknown): valor is PerfilProfissional {
  return (PERFIS_PROFISSIONAIS as readonly unknown[]).includes(valor);
}
