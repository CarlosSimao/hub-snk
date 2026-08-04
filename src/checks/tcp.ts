import { connect } from 'node:net';
import type { CheckConfig } from '../config.ts';
import type { CheckOutcome } from '../types.ts';

type TcpCheck = Extract<CheckConfig, { type: 'tcp' }>;

/** Porta aberta = handshake TCP completo. Nao fala protocolo nenhum em cima disso. */
export function runTcpCheck(cfg: TcpCheck): Promise<CheckOutcome> {
  const started = performance.now();

  return new Promise((resolve) => {
    const socket = connect({ host: cfg.host, port: cfg.port });
    let settled = false;

    const finish = (outcome: CheckOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(cfg.timeoutMs);

    socket.once('connect', () => {
      const latencyMs = Math.round(performance.now() - started);
      const slow = cfg.degradedAboveMs !== undefined && latencyMs > cfg.degradedAboveMs;
      finish({
        status: slow ? 'degraded' : 'up',
        latencyMs,
        message: slow ? `porta aberta, lenta (${latencyMs}ms)` : `porta ${cfg.port} aberta`,
        indicators: [{ id: 'latency', label: 'Handshake', value: latencyMs, unit: 'ms' }],
        components: [],
      });
    });

    socket.once('timeout', () =>
      finish({
        status: 'down',
        latencyMs: null,
        message: `timeout após ${cfg.timeoutMs}ms`,
        indicators: [],
        components: [],
      }),
    );

    socket.once('error', (err: NodeJS.ErrnoException) =>
      finish({
        status: 'down',
        latencyMs: null,
        message:
          err.code === 'ECONNREFUSED'
            ? `conexão recusada em ${cfg.host}:${cfg.port}`
            : err.code === 'ENOTFOUND'
              ? `host "${cfg.host}" não resolvido`
              : err.message,
        indicators: [],
        components: [],
      }),
    );
  });
}
