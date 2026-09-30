import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { lerTokenDoDesktop } from '../sankhya/ponteDoDesktop.ts';

/*
 * A proteção de origem barra páginas abertas no navegador, mas não outros
 * processos da máquina: qualquer programa local, inclusive o de outro usuário
 * do Windows (o loopback é compartilhado no RDS e na troca rápida de usuário),
 * leria as senhas do cadastro pela API. O token do shell fica num arquivo que só
 * o usuário do Windows lê, e passa a ser exigido em toda a API.
 *
 * O painel não conhece o token: o shell o grava como cookie `HttpOnly` na sessão
 * da guia do HUB SNK. O próprio shell, que não tem cookie, manda o cabeçalho.
 */

export const NOME_DO_COOKIE_DO_TOKEN = 'hub_token';

const PREFIXO_DA_API = '/api/';
/** A sonda de vida do shell roda antes de o token existir para o backend. */
const ROTAS_SEM_TOKEN = new Set(['/api/healthz']);

export interface OpcoesDaAutenticacaoDoPainel {
  arquivoTokenDoDesktop: string;
  /** Só para `npm run dev` no navegador, sem o shell — ver `HUB_SEM_TOKEN`. */
  desligada: boolean;
}

/**
 * Decide pela rota encontrada, não pela URL crua: uma variação de escrita
 * (`/%61pi/clientes`) que o roteador aceita não pode escapar da checagem.
 * Rota inexistente responde 404 sem expor nada.
 */
function rotaExigeToken(requisicao: FastifyRequest): boolean {
  const rota = requisicao.routeOptions.url;
  return rota !== undefined && rota.startsWith(PREFIXO_DA_API) && !ROTAS_SEM_TOKEN.has(rota);
}

function lerCookie(cabecalho: string | undefined, nome: string): string | undefined {
  const prefixo = `${nome}=`;
  return cabecalho
    ?.split(';')
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith(prefixo))
    ?.slice(prefixo.length);
}

function tokenRecebido(requisicao: FastifyRequest): string | undefined {
  const doCabecalho = requisicao.headers['x-hub-token'];
  if (typeof doCabecalho === 'string') {
    return doCabecalho;
  }

  return lerCookie(requisicao.headers.cookie, NOME_DO_COOKIE_DO_TOKEN);
}

/** Comparação em tempo constante: o tempo da resposta não revela o prefixo certo. */
function tokenConfere(recebido: string | undefined, esperado: string): boolean {
  if (recebido === undefined) {
    return false;
  }

  const bytesRecebidos = Buffer.from(recebido);
  const bytesEsperados = Buffer.from(esperado);
  return (
    bytesRecebidos.length === bytesEsperados.length &&
    timingSafeEqual(bytesRecebidos, bytesEsperados)
  );
}

/** Registrar depois da proteção de origem, que responde primeiro a quem vem de fora. */
export function registrarAutenticacaoDoPainel(
  servidor: FastifyInstance,
  { arquivoTokenDoDesktop, desligada }: OpcoesDaAutenticacaoDoPainel,
): void {
  if (desligada) {
    servidor.log.warn(
      'HUB_SEM_TOKEN=1: a API responde sem o token do shell. Use só em desenvolvimento.',
    );
    return;
  }

  servidor.addHook('onRequest', async (requisicao, resposta) => {
    if (!rotaExigeToken(requisicao)) {
      return;
    }

    let esperado: string;
    try {
      esperado = lerTokenDoDesktop(arquivoTokenDoDesktop);
    } catch (erro) {
      await resposta.status(503).send({ mensagem: (erro as Error).message });
      return resposta;
    }

    if (tokenConfere(tokenRecebido(requisicao), esperado)) {
      return;
    }

    requisicao.log.warn(
      `Requisição sem token válido recusada — ${requisicao.method} ${requisicao.url}.`,
    );
    await resposta.status(401).send({ mensagem: 'Token do HUB SNK ausente ou inválido.' });
    return resposta;
  });
}
