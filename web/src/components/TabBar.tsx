export interface Aba<T extends string> {
  id: T;
  rotulo: string;
  titulo?: string;
}

interface Props<T extends string> {
  abas: Aba<T>[];
  ativa: T;
  onTrocar: (id: T) => void;
  /** `sub` é a variante menor, usada dentro de um painel que já está numa aba. */
  variante?: 'topo' | 'sub';
}

export function TabBar<T extends string>({ abas, ativa, onTrocar, variante = 'topo' }: Props<T>) {
  return (
    <nav className={`tabbar ${variante}`}>
      {abas.map((aba) => (
        <button
          key={aba.id}
          type="button"
          className={`tab${aba.id === ativa ? ' active' : ''}`}
          aria-pressed={aba.id === ativa}
          {...(aba.titulo ? { title: aba.titulo } : {})}
          onClick={() => onTrocar(aba.id)}
        >
          {aba.rotulo}
        </button>
      ))}
    </nav>
  );
}
