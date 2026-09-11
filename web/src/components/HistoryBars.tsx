import type { HistoryPoint } from '../types.ts';
import { STATUS_LABEL } from '../lib/format.ts';

/** Barra de histórico: uma coluna por amostra, mais antiga à esquerda. */
export function HistoryBars({ history }: { history: HistoryPoint[] }) {
  return (
    <div className="bars">
      {history.map((point, indice) => {
        const quando = new Date(point.ts).toLocaleTimeString('pt-BR');
        const latencia = point.latencyMs === null ? 's/ resposta' : `${point.latencyMs}ms`;
        return (
          <i
            key={`${point.ts}-${indice}`}
            className={point.status}
            style={{ height: point.status === 'unknown' ? '40%' : '100%' }}
            title={`${quando} — ${STATUS_LABEL[point.status]}, ${latencia}`}
          />
        );
      })}
    </div>
  );
}
