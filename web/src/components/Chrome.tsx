import { plural, relativeTime } from '../lib/format.ts';
import type { Toast } from '../hooks/useToasts.ts';

/** Problemas de configuração/ambiente que valem aviso na tela (ex.: socket do Docker ausente). */
export function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;

  return (
    <section className="warnings">
      {warnings.map((warning) => (
        <div className="warning" key={warning}>
          <span>⚠</span>
          <span>{warning}</span>
        </div>
      ))}
    </section>
  );
}

export function Footer({ checks, generatedAt }: { checks: number; generatedAt: number }) {
  return (
    <footer className="footer">
      <span>
        {generatedAt
          ? `${checks} ${plural(checks, 'check', 'checks')} · atualizado ${relativeTime(generatedAt)}`
          : '—'}
      </span>
      <span className="legend">
        <i className="chip up" /> operacional
        <i className="chip degraded" /> degradado
        <i className="chip down" /> fora do ar
        <i className="chip unknown" /> sem dados
      </span>
    </footer>
  );
}

/*
 * Um alerta aparece de duas formas, ambas efêmeras: um toast no canto e uma
 * notificação do Windows. Não há feed com histórico na tela — quem quiser o
 * histórico consulta `GET /api/alerts`, que continua guardando 168h no SQLite.
 */
export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div className={`toast ${t.kind}`} key={t.id}>
          <div>{t.message}</div>
          {t.detail && <pre>{t.detail}</pre>}
        </div>
      ))}
    </div>
  );
}
