/**
 * Consulta da última release publicada no GitHub.
 *
 * O HUB SNK roda na máquina de cada pessoa e não tem como saber sozinho que
 * saiu versão nova. A API pública de releases responde isso sem autenticação —
 * o preço é o limite de 60 requisições por hora por IP, o que torna o cache
 * obrigatório e não um refinamento.
 */

import pacote from '../../package.json' with { type: 'json' };

const ENDERECO_DA_API_DO_GITHUB = 'https://api.github.com';
const TEMPO_LIMITE_MS = 5000;
const TEMPO_DE_VIDA_DO_ACERTO_MS = 6 * 60 * 60 * 1000;

/**
 * Falha também é guardada, por menos tempo: sem isso, uma máquina offline
 * gastaria os cinco segundos do tempo limite a cada abertura da tela.
 */
const TEMPO_DE_VIDA_DA_FALHA_MS = 15 * 60 * 1000;

/**
 * O `package.json` guarda `git+https://github.com/Dono/projeto.git`. A caixa do
 * dono e do projeto é preservada de propósito: o endereço vai direto para o
 * link que o usuário clica, e `interpretarEnderecoDoRemoto` — que já existe
 * para comparar remotos — normaliza tudo para minúsculas.
 */
const REGEX_DO_REPOSITORIO_NO_GITHUB = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i;

export interface UltimaVersaoPublicada {
  /** Tag da release, como está no GitHub — normalmente com o `v` na frente. */
  versao: string;
  /** Página da release, para o link do rodapé. */
  url: string;
}

interface EntradaDoCache {
  resultado: UltimaVersaoPublicada | null;
  expiraEm: number;
}

let cache: EntradaDoCache | null = null;

interface ReleaseDoGitHub {
  tag_name?: unknown;
  html_url?: unknown;
}

function montarCaminhoDaApi(urlDoRepositorio: string): string | null {
  const partes = REGEX_DO_REPOSITORIO_NO_GITHUB.exec(urlDoRepositorio.trim());
  if (!partes) {
    return null;
  }

  return `${ENDERECO_DA_API_DO_GITHUB}/repos/${partes[1]}/${partes[2]}/releases/latest`;
}

async function buscarNoGitHub(caminho: string): Promise<UltimaVersaoPublicada | null> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TEMPO_LIMITE_MS);

  try {
    const resposta = await fetch(caminho, {
      signal: controlador.signal,
      headers: {
        accept: 'application/vnd.github+json',
        /* A API do GitHub recusa requisição sem identificação do cliente. */
        'user-agent': `hub-snk/${pacote.version}`,
      },
    });

    /*
     * `404` é a resposta de repositório ainda sem release publicada, e `403` a
     * de limite de requisições estourado. Nenhuma das duas é defeito: ambas
     * significam apenas "não há versão a comparar agora".
     */
    if (!resposta.ok) {
      return null;
    }

    const release = (await resposta.json()) as ReleaseDoGitHub;
    if (typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') {
      return null;
    }

    return { versao: release.tag_name, url: release.html_url };
  } catch {
    /* Sem rede, com proxy no caminho ou fora do tempo limite: nada a comparar. */
    return null;
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * `null` quando não há release publicada ou quando o GitHub não pôde ser
 * consultado. A resposta fica em cache pelas próximas horas.
 */
export async function consultarUltimaVersaoPublicada(): Promise<UltimaVersaoPublicada | null> {
  if (cache && cache.expiraEm > Date.now()) {
    return cache.resultado;
  }

  const caminho = montarCaminhoDaApi(pacote.repository.url);
  const resultado = caminho === null ? null : await buscarNoGitHub(caminho);

  cache = {
    resultado,
    expiraEm:
      Date.now() + (resultado === null ? TEMPO_DE_VIDA_DA_FALHA_MS : TEMPO_DE_VIDA_DO_ACERTO_MS),
  };

  return resultado;
}
