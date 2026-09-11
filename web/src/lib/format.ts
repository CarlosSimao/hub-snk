import type { Indicator, Status } from '../types.ts';

export const STATUS_LABEL: Record<Status, string> = {
  up: 'operacional',
  degraded: 'degradado',
  down: 'fora do ar',
  unknown: 'sem dados',
};

export const SEVERITY_TITLE = {
  critical: '🔴 Fora do ar',
  warning: '🟡 Degradado',
  recovery: '🟢 Recuperado',
} as const;

const SEVERITY: Record<Status, number> = { up: 0, unknown: 1, degraded: 2, down: 3 };

export function worst(statuses: Status[]): Status {
  let result: Status = 'unknown';
  let seen = false;
  for (const s of statuses) {
    if (!seen || SEVERITY[s] > SEVERITY[result]) {
      result = s;
      seen = true;
    }
  }
  return seen ? result : 'unknown';
}

export function relativeTime(ts: number): string {
  if (!ts) return 'nunca';
  const seconds = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seconds < 5) return 'agora';
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

export function formatIndicator(indicator: Indicator): string {
  if (indicator.value === null || indicator.value === undefined) return '—';
  if (typeof indicator.value === 'number') {
    const digits = indicator.precision ?? 0;
    const formatted = indicator.value.toLocaleString('pt-BR', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    return indicator.unit ? `${formatted} ${indicator.unit}` : formatted;
  }
  return String(indicator.value);
}

export function plural(n: number, singular: string, plural_: string): string {
  return n > 1 ? plural_ : singular;
}
