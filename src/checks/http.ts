import type { CheckConfig } from '../config.ts';
import type { CheckOutcome, Indicator } from '../types.ts';

type HttpCheck = Extract<CheckConfig, { type: 'http' }>;

/** Aceita o status como sucesso: lista explicita quando houver, senao qualquer 2xx/3xx. */
function statusAccepted(code: number, expected: number[]): boolean {
  if (expected.length) return expected.includes(code);
  return code >= 200 && code < 400;
}

export async function runHttpCheck(cfg: HttpCheck): Promise<CheckOutcome> {
  const started = performance.now();
  const indicators: Indicator[] = [];

  try {
    const res = await fetch(cfg.url, {
      method: cfg.method,
      headers: cfg.headers,
      body: cfg.method === 'POST' ? cfg.body : undefined,
      signal: AbortSignal.timeout(cfg.timeoutMs),
      redirect: 'follow',
    });

    // Le o corpo so quando precisa; caso contrario descarta para nao vazar socket.
    let body = '';
    if (cfg.expectBodyContains) {
      body = await res.text();
    } else {
      await res.body?.cancel().catch(() => {});
    }

    const latencyMs = Math.round(performance.now() - started);

    indicators.push({ id: 'latency', label: 'Latência', value: latencyMs, unit: 'ms' });
    indicators.push({ id: 'status', label: 'HTTP', value: res.status });

    const length = res.headers.get('content-length');
    if (length) {
      indicators.push({
        id: 'size',
        label: 'Resposta',
        value: Number(length) / 1024,
        unit: 'KB',
        precision: 1,
      });
    }

    if (!statusAccepted(res.status, cfg.expectStatus)) {
      const wanted = cfg.expectStatus.length ? cfg.expectStatus.join('/') : '2xx/3xx';
      return {
        status: 'down',
        latencyMs,
        message: `HTTP ${res.status} (esperado ${wanted})`,
        indicators,
        components: [],
      };
    }

    if (cfg.expectBodyContains && !body.includes(cfg.expectBodyContains)) {
      return {
        status: 'down',
        latencyMs,
        message: `corpo não contém "${cfg.expectBodyContains}"`,
        indicators,
        components: [],
      };
    }

    const slow = cfg.degradedAboveMs !== undefined && latencyMs > cfg.degradedAboveMs;
    return {
      status: slow ? 'degraded' : 'up',
      latencyMs,
      message: slow ? `HTTP ${res.status}, lento (${latencyMs}ms)` : `HTTP ${res.status}`,
      indicators,
      components: [],
    };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: null,
      message: describeFetchError(err, cfg.timeoutMs),
      indicators,
      components: [],
    };
  }
}

/** Traduz o erro cru do fetch/undici em algo acionavel na tela. */
export function describeFetchError(err: unknown, timeoutMs: number): string {
  const error = err as Error & { cause?: { code?: string }; name?: string };
  if (error?.name === 'TimeoutError') return `timeout após ${timeoutMs}ms`;
  const code = error?.cause?.code;
  if (code === 'ECONNREFUSED') return 'conexão recusada — serviço fora do ar?';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host não resolvido';
  if (code === 'ECONNRESET') return 'conexão encerrada pelo servidor';
  if (code === 'CERT_HAS_EXPIRED') return 'certificado TLS expirado';
  return error?.message || 'falha desconhecida';
}
