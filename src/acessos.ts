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

export function ehPerfilProfissional(valor: unknown): valor is PerfilProfissional {
  return (PERFIS_PROFISSIONAIS as readonly unknown[]).includes(valor);
}
