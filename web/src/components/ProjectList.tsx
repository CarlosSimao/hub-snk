import type { ServiceSnapshot } from '../types.ts';
import { plural } from '../lib/format.ts';
import { Semaphore } from './Semaphore.tsx';
import { Avatar, ConfigPendente, Dots, ResumoServico } from './ServiceIdentity.tsx';

interface Props {
  services: ServiceSnapshot[];
  selecionado: string | null;
  onSelecionar: (serviceId: string) => void;
}

export function ProjectList({ services, selecionado, onSelecionar }: Props) {
  const total = services.length;
  const checks = services.reduce((soma, s) => soma + s.checks.length, 0);

  return (
    <aside className="project-list">
      <div className="project-list-head">
        {total} {plural(total, 'projeto', 'projetos')} · {checks} {plural(checks, 'check', 'checks')}
      </div>
      <div className="project-list-items">
        {services.map((service) => (
          <ProjectItem
            key={service.id}
            service={service}
            ativo={service.id === selecionado}
            onSelecionar={onSelecionar}
          />
        ))}
      </div>
    </aside>
  );
}

/** Linha compacta da lista lateral: identidade + resumo, sem o detalhe dos checks. */
function ProjectItem({
  service,
  ativo,
  onSelecionar,
}: {
  service: ServiceSnapshot;
  ativo: boolean;
  onSelecionar: (serviceId: string) => void;
}) {
  return (
    <button
      type="button"
      className={`project-item${service.disabled ? ' disabled' : ''}${ativo ? ' active' : ''}`}
      data-status={service.status}
      aria-pressed={ativo}
      onClick={() => onSelecionar(service.id)}
    >
      <Avatar service={service} />
      <div className="li-title">
        <h2>
          {service.name}
          <ConfigPendente service={service} />
        </h2>
        <p className="li-summary">
          <ResumoServico service={service} />
        </p>
      </div>
      <Dots service={service} />
      <Semaphore status={service.status} extra="vertical" />
    </button>
  );
}
