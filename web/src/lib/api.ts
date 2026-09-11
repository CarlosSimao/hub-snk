/**
 * Envelope fino sobre `fetch`.
 *
 * O corpo é sempre lido como JSON, mesmo em erro: as rotas do hub respondem
 * `{ error }` com 4xx e a mensagem delas é melhor que "HTTP 400" na tela.
 */
export interface Resposta<T> {
  ok: boolean;
  status: number;
  body: Partial<T> & { error?: string };
}

export async function requisitar<T>(path: string, init?: RequestInit): Promise<Resposta<T>> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as Partial<T> & { error?: string };
  return { ok: res.ok, status: res.status, body };
}

export function enviar<T>(path: string, corpo?: unknown): Promise<Resposta<T>> {
  return requisitar<T>(path, {
    method: 'POST',
    ...(corpo === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
  });
}

/** Todos os ids vêm do YAML e podem ter caractere que quebra o caminho. */
export function rotaCheck(serviceId: string, checkId: string, sufixo: string): string {
  return `/api/services/${encodeURIComponent(serviceId)}/checks/${encodeURIComponent(checkId)}/${sufixo}`;
}

export function rotaServico(serviceId: string, sufixo: string): string {
  return `/api/services/${encodeURIComponent(serviceId)}/${sufixo}`;
}
