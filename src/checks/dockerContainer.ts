import type { CheckConfig } from '../config.ts';
import type { DockerClient } from '../docker.ts';
import { DockerUnavailableError } from '../docker.ts';
import type { CheckOutcome, Indicator, Status } from '../types.ts';
import { formatDuration } from './formatDuration.ts';

type DockerCheck = Extract<CheckConfig, { type: 'docker' }>;

export async function runDockerCheck(cfg: DockerCheck, docker: DockerClient): Promise<CheckOutcome> {
  const started = performance.now();

  try {
    const info = await docker.inspect(cfg.container, cfg.timeoutMs);
    const latencyMs = Math.round(performance.now() - started);

    if (!info) {
      return {
        status: 'down',
        latencyMs,
        message: `container "${cfg.container}" não existe`,
        indicators: [],
        components: [],
      };
    }

    const indicators: Indicator[] = [{ id: 'state', label: 'Estado', value: info.state }];

    if (info.startedAt && info.state === 'running') {
      const uptimeSeconds = (Date.now() - new Date(info.startedAt).getTime()) / 1000;
      indicators.push({ id: 'uptime', label: 'Uptime', value: formatDuration(uptimeSeconds) });
    }
    if (info.restartCount > 0) {
      // Reinicio acumulado e sinal de crash loop mesmo com o container verde agora.
      indicators.push({
        id: 'restarts',
        label: 'Restarts',
        value: info.restartCount,
        status: info.restartCount > 3 ? 'degraded' : 'up',
      });
    }
    if (info.health !== 'none') {
      indicators.push({ id: 'health', label: 'Healthcheck', value: info.health });
    }

    const { status, message } = judge(info.state, info.health, info.exitCode);
    return { status, latencyMs, message, indicators, components: [] };
  } catch (err) {
    const unavailable = err instanceof DockerUnavailableError;
    return {
      status: unavailable ? 'unknown' : 'down',
      latencyMs: null,
      message: unavailable
        ? 'socket do Docker não montado no hub — check indisponível'
        : (err as Error).message,
      indicators: [],
      components: [],
    };
  }
}

function judge(state: string, health: string, exitCode: number | null): { status: Status; message: string } {
  if (state === 'running') {
    if (health === 'unhealthy') return { status: 'down', message: 'rodando, mas HEALTHCHECK falhando' };
    if (health === 'starting') return { status: 'degraded', message: 'subindo (healthcheck em curso)' };
    return { status: 'up', message: health === 'healthy' ? 'rodando e saudável' : 'rodando' };
  }
  if (state === 'restarting') return { status: 'degraded', message: 'reiniciando' };
  if (state === 'paused') return { status: 'degraded', message: 'pausado' };
  if (state === 'created') return { status: 'degraded', message: 'criado, nunca iniciado' };
  if (state === 'exited') {
    return {
      status: 'down',
      message: exitCode === 0 ? 'parado (exit 0)' : `parado com exit ${exitCode ?? '?'}`,
    };
  }
  return { status: 'down', message: `estado "${state}"` };
}
