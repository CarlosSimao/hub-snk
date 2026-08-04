/**
 * Utilitarios compartilhados pelos testes.
 *
 * A regra aqui e: nenhum teste da suite padrao toca a rede externa. Tudo que precisa
 * de um servidor sobe um em 127.0.0.1 numa porta efemera, e o teste espera o `listen`
 * antes de seguir — porta fixa daria colisao entre arquivos rodando em paralelo.
 */
import { createServer, type Server } from 'node:http';
import { createServer as createNetServer, type Server as NetServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSchema, type CheckConfig } from '../src/config.ts';

/**
 * Monta um check para teste PASSANDO PELO SCHEMA REAL.
 *
 * Montar o objeto na mao pareceria mais simples, mas os modulos de check contam com
 * os defaults que o Zod aplica (`expectStatus: []`, `headers: {}`, `ssl: 'auto'`...).
 * Sem o parse, o teste exercitaria uma config que nunca existe em producao — e foi
 * exatamente assim que a primeira versao destes testes quebrou.
 */
export function check<T extends CheckConfig['type']>(
  type: T,
  extra: Record<string, unknown>,
): Extract<CheckConfig, { type: T }> {
  return checkSchema.parse({
    id: 'c',
    name: 'Check',
    timeoutMs: 3000,
    type,
    ...extra,
  }) as Extract<CheckConfig, { type: T }>;
}

export interface Servidor<T> {
  port: number;
  server: T;
  close: () => Promise<void>;
}

async function ouvir<T extends Server | NetServer>(server: T): Promise<Servidor<T>> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('servidor sem porta');
  return {
    port: address.port,
    server,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Servidor HTTP cujo comportamento o teste controla via callback. */
export function servidorHttp(
  responder: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void,
): Promise<Servidor<Server>> {
  return ouvir(createServer(responder));
}

/** Servidor TCP que so aceita e fecha — para o check `tcp`. */
export function servidorTcp(): Promise<Servidor<NetServer>> {
  return ouvir(createNetServer((socket) => socket.end()));
}

/** Diretorio temporario descartavel, para o SQLite dos testes de store/engine. */
export function dirTemporario(): { path: string; remove: () => void } {
  const path = mkdtempSync(join(tmpdir(), 'sankhya-hub-test-'));
  return { path, remove: () => rmSync(path, { recursive: true, force: true }) };
}

/** Porta que ninguem esta escutando — para exercitar ECONNREFUSED de forma deterministica. */
export async function portaFechada(): Promise<number> {
  const s = await ouvir(createNetServer());
  const { port } = s;
  await s.close();
  return port;
}

export const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
