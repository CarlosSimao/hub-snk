/**
 * Cliente do shell para o backend: empurra a sessão da Experience capturada na aba
 * (ver sessions.ts) para `Credenciais`/`SessaoDesktopStore` do lado do backend, e limpa
 * no logout real — ver src/routesSankhya.ts (`POST`/`DELETE /api/sankhya/desktop/sessao/:sistema`).
 * Usa o mesmo token do bridge (mesma direção de confiança, ver bridgeServer.ts).
 */
import { HUB_URL } from './config';
import { garantirToken } from './tokenStore';
import { logEvento } from './log';

/** `false` em qualquer falha (rede ou HTTP) — quem chama decide se tenta de novo. */
async function chamar(caminho: string, init: RequestInit): Promise<boolean> {
  try {
    const resposta = await fetch(`${HUB_URL}${caminho}`, {
      ...init,
      headers: { ...init.headers, 'x-hub-token': garantirToken() },
      signal: AbortSignal.timeout(10_000),
    });
    if (!resposta.ok) {
      logEvento('backend-push-falhou', { caminho, status: resposta.status });
      return false;
    }
    return true;
  } catch (err) {
    logEvento('backend-push-indisponivel', { caminho, erro: String(err) });
    return false;
  }
}

export function pushSessaoExperience(dados: { usuario: string; token: string; expira: string }): Promise<boolean> {
  return chamar('/api/sankhya/desktop/sessao/sankhya-experience', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(dados),
  });
}

export function limparSessaoExperience(): Promise<boolean> {
  return chamar('/api/sankhya/desktop/sessao/sankhya-experience', { method: 'DELETE' });
}
