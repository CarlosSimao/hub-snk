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
  consultor: ['cliente.repositorios', 'autosync', 'cliente.autosync', 'agenda.solicitacoes'],
  analista: ['cliente.repositorios', 'autosync', 'cliente.autosync', 'agenda.solicitacoes'],
  'gerente-de-projeto': [
    'cliente.repositorios',
    'local',
    'autosync',
    'cliente.autosync',
    'agenda.solicitacoes',
  ],
};

/**
 * O que existia até a v2.21.1, antes de o arquivo de configuração gravar quais
 * funcionalidades conhece. Lista congelada: funcionalidade nova não entra aqui.
 */
export const FUNCIONALIDADES_ANTERIORES_AO_REGISTRO: readonly Funcionalidade[] = [
  'local',
  'agenda',
  'kanban',
  'os',
  'lembretes',
  'contatos',
  'cliente.bases',
  'cliente.repositorios',
  'cliente.projetos',
  'cliente.agenda',
  'cliente.os',
  'cliente.contatos',
  'autosync',
  'cliente.autosync',
];

export function ehPerfilProfissional(valor: unknown): valor is PerfilProfissional {
  return (PERFIS_PROFISSIONAIS as readonly unknown[]).includes(valor);
}
