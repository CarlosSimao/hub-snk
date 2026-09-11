import type { HistoryPoint } from '../types.ts';

const LARGURA = 92;
const ALTURA = 24;

/**
 * Sparkline de latência com legenda.
 *
 * Escala no próprio conjunto — interessa a forma, não o valor absoluto; a legenda
 * existe porque sem ela o gráfico não diz o que está medindo.
 */
export function Sparkline({ history }: { history: HistoryPoint[] }) {
  const valores = history
    .map((p) => p.latencyMs)
    .filter((valor): valor is number => typeof valor === 'number');
  if (valores.length < 2) return null;

  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const amplitude = max - min || 1;

  const coords = valores.map((valor, indice) => {
    const x = (indice / (valores.length - 1)) * LARGURA;
    const y = ALTURA - ((valor - min) / amplitude) * (ALTURA - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linha = `M${coords.join(' L')}`;
  const area = `${linha} L${LARGURA},${ALTURA} L0,${ALTURA} Z`;

  return (
    <span
      className="spark-wrap"
      title="Latência das últimas amostras — mostra a tendência, a escala não é um valor absoluto"
    >
      <svg
        className="spark"
        viewBox={`0 0 ${LARGURA} ${ALTURA}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path className="area" d={area} />
        <path className="line" d={linha} />
      </svg>
      <i className="spark-caption">latência</i>
    </span>
  );
}
