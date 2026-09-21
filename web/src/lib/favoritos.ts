/**
 * Transforma favoritos do navegador em candidatos a cliente.
 *
 * Separado do componente por ser tudo heuristica sobre texto que o usuario escreveu
 * livremente — e a parte que erra, entao precisa ser testavel sem montar tela.
 */
import type { FavoritoNavegador } from '../types.ts';

export type AmbienteSugerido = 'producao' | 'teste' | 'homologacao';

/** Um cliente candidato, montado a partir de um ou mais favoritos do mesmo parceiro. */
export interface CandidatoCliente {
  /** Chave de agrupamento, derivada do host. Estavel entre recargas. */
  chave: string;
  nome: string;
  bases: { url: string; ambiente: AmbienteSugerido }[];
}

/**
 * Nome do cliente a partir do titulo do favorito.
 *
 * Os titulos vem como o navegador os salvou, carregando o nome do produto e o ambiente:
 * "Sankhya Om - Mustang quimica", "Global Parts - Producao". Tirar essas bordas e o que
 * faz dois favoritos do mesmo parceiro virarem um cliente so, com duas bases.
 */
export function nomeDoFavorito(titulo: string): string {
  let nome = titulo.trim();

  // Prefixo de produto, com ou sem separador.
  nome = nome.replace(/^\s*sankhya\s*(om|w)?\s*[-–|:]\s*/i, '');
  // Sufixo de ambiente e de tela, que nao fazem parte do nome do parceiro.
  //
  // O separador e opcional porque tirar o prefixo o leva junto: "Sankhya Om - Mustang
  // Teste" vira "Mustang Teste", e ali so sobra o espaco. Exigir o traco deixaria o
  // ambiente colado no nome e o parceiro nao agruparia com a propria producao.
  nome = nome.replace(
    /\s*[-–|:]?\s+(produ[cç][aã]o|prod|teste|test|homologa[cç][aã]o|homolog|hml|treinamento)\s*$/i,
    '',
  );
  nome = nome.replace(/\s*[-–|:]\s*(sankhya\s*(om|w)?|login|mge)\s*$/i, '');

  return nome.trim() || titulo.trim();
}

/** Producao e o padrao: so desce de degrau quando o titulo ou a URL dizem o contrario. */
export function ambienteDoFavorito(titulo: string, url: string): AmbienteSugerido {
  const alvo = `${titulo} ${url}`.toLowerCase();
  if (/homolog|\bhml\b/.test(alvo)) return 'homologacao';
  if (/teste|\btest\b|\bqas\b|treinamento/.test(alvo)) return 'teste';
  return 'producao';
}

/**
 * Chave do parceiro dentro de uma URL.
 *
 * E o primeiro rotulo do host, sem o sufixo de ambiente: `mustangpluron-teste` e
 * `mustangpluron` sao o mesmo cliente. Agrupar pelo host, e nao pelo nome, e o que
 * junta favoritos cujos titulos foram escritos de formas diferentes.
 */
export function chaveDoParceiro(url: string): string | null {
  let host: string;
  try {
    const endereco = new URL(url);
    // `new URL` aceita `javascript:` e `file:` sem reclamar, e nos dois o hostname sai
    // vazio — viraria uma chave em branco que agrupa tudo que nao e endereco web num
    // cliente so. Aqui a checagem e de protocolo, nao so de parse.
    if (endereco.protocol !== 'http:' && endereco.protocol !== 'https:') return null;
    host = endereco.hostname.toLowerCase();
    // Loopback nunca e endereco de parceiro: e ferramenta local que foi parar na mesma
    // pasta de favoritos. Oferecer como cliente so daria trabalho de desmarcar.
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
  } catch {
    return null;
  }
  if (!host) return null;

  const raiz = (host.split('.')[0] ?? host).replace(
    /[-_](teste|test|hml|homolog\w*|qas|dev)$/i,
    '',
  );
  return raiz || host;
}

/** Agrupa os favoritos por parceiro, em ordem alfabetica. */
export function agruparFavoritos(favoritos: FavoritoNavegador[]): CandidatoCliente[] {
  const porChave = new Map<string, CandidatoCliente>();

  for (const favorito of favoritos) {
    const chave = chaveDoParceiro(favorito.url);
    if (chave === null) continue;

    const base = {
      url: favorito.url,
      ambiente: ambienteDoFavorito(favorito.titulo, favorito.url),
    };
    const candidato = porChave.get(chave);

    if (candidato) {
      if (!candidato.bases.some((b) => b.url === base.url)) candidato.bases.push(base);
      // Entre dois titulos, o da producao descreve melhor o parceiro.
      if (base.ambiente === 'producao') candidato.nome = nomeDoFavorito(favorito.titulo);
      continue;
    }

    porChave.set(chave, { chave, nome: nomeDoFavorito(favorito.titulo), bases: [base] });
  }

  return [...porChave.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
