/** Checagem simples de saúde do backend, para o indicador de status na barra local. */
import { HUB_URL } from './config';

export async function backendDisponivel(): Promise<boolean> {
  try {
    const resposta = await fetch(`${HUB_URL}/api/healthz`, { signal: AbortSignal.timeout(3000) });
    return resposta.ok;
  } catch {
    return false;
  }
}
