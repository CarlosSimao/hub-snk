/**
 * Traz as credenciais já guardadas pelo `hub-helper.ps1` para o cofre do shell.
 *
 * Sem isto, o primeiro boot depois da migração encontraria o cofre novo vazio e pediria
 * usuário e senha de novo — o blob DPAPI do helper não é legível pelo `safeStorage`
 * (mesma API do Windows por baixo, formatos diferentes). A ponte é o próprio helper:
 * enquanto ele ainda estiver instalado, `/credentials/:sistema/reveal` devolve o valor
 * em claro e o shell regrava no formato novo.
 *
 * Roda uma vez, só quando o cofre novo está vazio, e falha em silêncio: se o helper não
 * estiver no ar, a tela de credenciais continua funcionando e o usuário regrava.
 */
import { readFileSync } from 'node:fs';
import { ARQUIVO_TOKEN_HELPER, HELPER_URL } from './config';
import { gravar, gravarSessao, SISTEMAS, vazio, type Sistema } from './cofreCredenciais';
import { logEvento } from './log';

interface RespostaReveal {
  ok?: boolean;
  usuario?: string;
  senha?: string;
  sessao?: string;
  token?: string;
  expira?: string;
}

function tokenDoHelper(): string {
  try {
    return readFileSync(ARQUIVO_TOKEN_HELPER, 'utf8').trim();
  } catch {
    return '';
  }
}

async function revelarNoHelper(sistema: Sistema, token: string): Promise<RespostaReveal | null> {
  try {
    const resposta = await fetch(`${HELPER_URL}/credentials/${sistema}/reveal`, {
      headers: { 'x-hub-token': token },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resposta.ok) return null;
    return (await resposta.json()) as RespostaReveal;
  } catch {
    return null;
  }
}

export async function migrarCofreDoHelper(): Promise<void> {
  if (!vazio()) return;

  const token = tokenDoHelper();
  if (!token) return;

  let migrados = 0;
  for (const sistema of SISTEMAS) {
    const antiga = await revelarNoHelper(sistema, token);
    if (!antiga?.usuario) continue;

    if (antiga.senha) gravar(sistema, antiga.usuario, antiga.senha);
    // Sessão e token vão à parte: `gravar` preserva o que já existe, então a ordem
    // importa — senha primeiro, sessão depois.
    if (antiga.sessao || antiga.token) {
      gravarSessao(sistema, {
        usuario: antiga.usuario,
        sessao: antiga.sessao ?? '',
        token: antiga.token ?? '',
        expira: antiga.expira ?? '',
      });
    } else if (!antiga.senha) {
      continue;
    }
    migrados += 1;
  }

  // Nada de sistema/usuário no log: o que interessa é que houve migração.
  if (migrados) logEvento('cofre-migrado-do-helper', { sistemas: migrados });
}
