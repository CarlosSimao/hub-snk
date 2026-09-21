/**
 * Execucao das "funcoes" declaradas por servico.
 *
 * Superficie deliberadamente estreita: `http` faz uma requisicao para a URL escrita no
 * YAML e `docker` chama start/stop/restart num container nomeado. Nao existe acao de
 * shell — o que o hub consegue disparar esta inteiramente descrito no `services.yaml`,
 * que e o arquivo que voce controla.
 */
import type { AppConfig } from './config.ts';
import type { DockerClient } from './docker.ts';
import type { Wildfly } from './wildfly.ts';
import type { CheckSnapshot } from './types.ts';
import { describeFetchError } from './checks/http.ts';

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Recorte da resposta HTTP, quando houver — util para depurar no proprio dashboard. */
  detail?: string;
}

/** Dispara um check fora do ciclo e devolve o resultado — o que `Engine.runNow` faz. */
export type RunCheck = (serviceId: string, checkId: string) => Promise<CheckSnapshot | null>;

export class ActionNotFoundError extends Error {}

async function chamarHttp(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: string | undefined,
  timeoutMs: number,
): Promise<ActionResult> {
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: method === 'GET' ? undefined : body,
      signal: AbortSignal.timeout(timeoutMs),
    });

    const responseBody = await res.text().catch(() => '');
    const ok = res.status >= 200 && res.status < 400;
    return {
      ok,
      message: ok ? `HTTP ${res.status}` : `HTTP ${res.status} — a chamada falhou`,
      detail: responseBody.slice(0, 500) || undefined,
    };
  } catch (err) {
    return { ok: false, message: describeFetchError(err, timeoutMs) };
  }
}

/** "Pronto" para o próximo passo: conectou, mesmo que degradado. `down`/`unknown` seguem esperando. */
function checkEstaPronto(snapshot: CheckSnapshot | null): boolean {
  return snapshot?.status === 'up' || snapshot?.status === 'degraded';
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarCheck(
  runCheck: RunCheck,
  serviceId: string,
  checkId: string,
  timeoutMs: number,
  pollMs: number,
): Promise<ActionResult> {
  const limite = Date.now() + timeoutMs;
  let ultimo: CheckSnapshot | null = null;

  while (Date.now() < limite) {
    ultimo = await runCheck(serviceId, checkId);
    if (checkEstaPronto(ultimo)) {
      return { ok: true, message: `"${checkId}" respondeu (${ultimo?.status})` };
    }
    await esperar(pollMs);
  }

  return {
    ok: false,
    message: `"${checkId}" não ficou pronto em ${Math.round(timeoutMs / 1000)}s (status: ${ultimo?.status ?? 'sem resultado'})`,
  };
}

export async function executeAction(
  config: AppConfig,
  serviceId: string,
  actionId: string,
  docker: DockerClient,
  runCheck: RunCheck,
  wildfly: Wildfly,
): Promise<ActionResult> {
  const service = config.services.find((s) => s.id === serviceId);
  if (!service) throw new ActionNotFoundError(`serviço "${serviceId}" não existe`);

  const action = service.actions.find((a) => a.id === actionId);
  if (!action) throw new ActionNotFoundError(`ação "${actionId}" não existe em "${serviceId}"`);

  if (action.type === 'link') {
    // Link e navegacao do cliente; o servidor nunca busca a URL.
    return { ok: true, message: 'link — abra pelo navegador' };
  }

  if (action.type === 'docker') {
    try {
      const message = await docker.run(action.container, action.operation);
      return { ok: true, message };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  if (action.type === 'http') {
    return chamarHttp(action.url, action.method, action.headers, action.body, action.timeoutMs);
  }

  if (action.type === 'wildfly') {
    const resultado = await wildfly.executar(action.operation);
    return { ok: resultado.ok, message: resultado.mensagem };
  }

  // sequence: passos executam em ordem, o primeiro que falhar interrompe o resto.
  for (const [indice, step] of action.steps.entries()) {
    const numero = indice + 1;
    let resultado: ActionResult;

    if (step.type === 'docker') {
      try {
        resultado = { ok: true, message: await docker.run(step.container, step.operation) };
      } catch (err) {
        resultado = { ok: false, message: (err as Error).message };
      }
    } else if (step.type === 'http') {
      resultado = await chamarHttp(step.url, step.method, step.headers, step.body, step.timeoutMs);
    } else if (step.type === 'wildfly') {
      const saida = await wildfly.executar(step.operation);
      resultado = { ok: saida.ok, message: saida.mensagem };
    } else {
      resultado = await esperarCheck(runCheck, serviceId, step.checkId, step.timeoutMs, step.pollMs);
    }

    if (!resultado.ok) {
      return { ok: false, message: `passo ${numero}/${action.steps.length} (${step.type}): ${resultado.message}` };
    }
  }

  return { ok: true, message: `${action.steps.length} passo(s) concluídos` };
}
