import { createReadStream, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Teto de bytes lidos do final do arquivo ao abrir a janela de log — evita
 * carregar um `server.log` de vários MB de uma vez só para mostrar as últimas
 * linhas.
 */
const TAMANHO_MAXIMO_INICIAL_EM_BYTES = 64 * 1024;

export function caminhoDoLogDaBase(caminhoWildfly: string): string {
  return join(caminhoWildfly, 'standalone', 'log', 'server.log');
}

export interface TrechoDeLog {
  conteudo: string;
  posicao: number;
}

/** Snapshot inicial: só o final do arquivo, até `TAMANHO_MAXIMO_INICIAL_EM_BYTES`. */
export async function lerFinalDoLog(caminho: string): Promise<TrechoDeLog> {
  if (!existsSync(caminho)) {
    return { conteudo: '', posicao: 0 };
  }

  const { size } = statSync(caminho);
  const inicio = Math.max(0, size - TAMANHO_MAXIMO_INICIAL_EM_BYTES);
  const conteudo = await lerTrecho(caminho, inicio, size);
  return { conteudo, posicao: size };
}

/**
 * Ponto de partida do acompanhamento quando o cliente retoma de uma pausa e
 * informa até onde já leu: continua exatamente dali. Posição maior que o
 * arquivo indica rotação/reinício do WildFly — nesse caso cai no snapshot do
 * final, porque o deslocamento antigo não corresponde mais a nada.
 */
export async function lerDesdePosicao(caminho: string, posicao: number): Promise<TrechoDeLog> {
  if (!existsSync(caminho)) {
    return { conteudo: '', posicao: 0 };
  }

  const { size } = statSync(caminho);
  if (posicao > size) {
    return lerFinalDoLog(caminho);
  }

  const conteudo = await lerTrecho(caminho, posicao, size);
  return { conteudo, posicao: size };
}

/**
 * O que foi adicionado ao arquivo desde `posicao`. Arquivo menor que
 * `posicao` indica rotação/reinício do WildFly — relê do começo em vez de
 * tentar continuar de um deslocamento que não existe mais.
 */
export async function lerNovoTrechoDoLog(caminho: string, posicao: number): Promise<TrechoDeLog> {
  if (!existsSync(caminho)) {
    return { conteudo: '', posicao: 0 };
  }

  const { size } = statSync(caminho);
  if (size === posicao) {
    return { conteudo: '', posicao };
  }

  const inicio = size < posicao ? 0 : posicao;
  const conteudo = await lerTrecho(caminho, inicio, size);
  return { conteudo, posicao: size };
}

function lerTrecho(caminho: string, inicio: number, fim: number): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    if (fim <= inicio) {
      resolver('');
      return;
    }

    const pedacos: Buffer[] = [];
    const leitura = createReadStream(caminho, { start: inicio, end: fim - 1 });
    leitura.on('data', (pedaco: string | Buffer) => {
      pedacos.push(typeof pedaco === 'string' ? Buffer.from(pedaco) : pedaco);
    });
    leitura.on('end', () => resolver(Buffer.concat(pedacos).toString('utf-8')));
    leitura.on('error', rejeitar);
  });
}
