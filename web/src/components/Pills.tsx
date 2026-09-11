import type { Component, Indicator } from '../types.ts';
import { formatIndicator } from '../lib/format.ts';

export function IndicatorPills({ indicators }: { indicators: Indicator[] }) {
  if (!indicators.length) return null;

  return (
    <div className="pills">
      {indicators.map((indicator) => {
        const tom =
          indicator.status === 'down' ? 'bad' : indicator.status === 'degraded' ? 'warn' : '';
        const temBarra = Boolean(indicator.max) && typeof indicator.value === 'number';
        const preenchido = temBarra
          ? Math.min(100, ((indicator.value as number) / indicator.max!) * 100).toFixed(1)
          : '0';

        return (
          <span className={`pill ${tom}`} key={indicator.id}>
            {indicator.label}{' '}
            {temBarra && (
              <span className="meter">
                <span style={{ width: `${preenchido}%` }} />
              </span>
            )}
            <b>
              {formatIndicator(indicator)}
              {temBarra ? ` / ${indicator.max}` : ''}
            </b>
          </span>
        );
      })}
    </div>
  );
}

export function ComponentPills({ components }: { components: Component[] }) {
  if (!components.length) return null;

  return (
    <div className="components">
      {components.map((component) => (
        <span
          className="component"
          key={component.id}
          data-status={component.status}
          {...(component.detail ? { title: component.detail } : {})}
        >
          <i />
          {component.label}
        </span>
      ))}
    </div>
  );
}
