/*
 * Tipo da base escondido no nome do favorito.
 *
 * O nome cadastrado no navegador quase sempre carrega o ambiente junto —
 * "COCA - PROD", "PROD - COCA", "(P) COCA", "COCA [T]". O marcador pode estar
 * no começo ou no fim, entre delimitadores ou solto, abreviado ou por extenso,
 * com ou sem acento. Reconhecê-lo já deixa o tipo preenchido na importação e
 * tira o ruído do nome do cliente.
 *
 * O módulo é puro de propósito — nada de DOM — porque o mesmo código precisa
 * rodar fora do navegador nos testes.
 */

/*
 * Do mais longo para o mais curto: a alternância do regex é resolvida na ordem
 * escrita, e "p" antes de "producao" só acharia o casamento certo por
 * retrocesso.
 */
const MARCADORES_DE_TIPO_DE_BASE = [
  {
    tipo: 'producao',
    marcadores: ['production', 'producao', 'produtivo', 'prod', 'prd', 'pro', 'pd', 'p'],
  },
  {
    tipo: 'teste',
    marcadores: [
      'homologacao',
      'homolog',
      'homol',
      'testes',
      'teste',
      'test',
      'hml',
      'hmg',
      'hom',
      'tst',
      'tes',
      'ts',
      't',
    ],
  },
];

/* O que separa o marcador do nome: espaço, hífen, barra, pipe e afins. */
const SEPARADORES = '[\\s\\-–—|·/:_]';
const ABERTURA = '[(\\[{]';
const FECHAMENTO = '[)\\]}]';

/* Sobra de pontuação depois de tirar o marcador: "H2F - [P]" não vira "H2F -". */
const SEPARADORES_NAS_PONTAS = /^[\s\-–—|·/:_]+|[\s\-–—|·/:_]+$/g;

const DIACRITICOS = /\p{Diacritic}/gu;

/**
 * Tira os acentos preservando o tamanho do texto.
 *
 * O casamento roda sobre a versão sem acento ("PRODUÇÃO" precisa bater com
 * "producao"), mas o nome devolvido é recortado do texto original — o que só
 * funciona se um caractere continuar valendo um caractere.
 */
function semAcentos(texto) {
  return Array.from(texto, (caractere) => caractere.normalize('NFD').replace(DIACRITICOS, '')).join(
    '',
  );
}

/**
 * Um padrão para o marcador no fim do nome e outro para o marcador no começo.
 *
 * Cada um aceita as duas escritas: entre delimitadores (`COCA (P)`, aí o
 * separador é opcional) ou solto (`COCA - PROD`, aí o separador é obrigatório —
 * sem ele "PRODUTOS" viraria marcador).
 */
function montarPadroes(marcadores) {
  const lista = marcadores.join('|');

  return [
    new RegExp(
      `^(?<nome>.+?)(?:${SEPARADORES}*${ABERTURA}\\s*(?:${lista})\\s*${FECHAMENTO}|${SEPARADORES}+(?:${lista}))${SEPARADORES}*$`,
      'di',
    ),
    new RegExp(
      `^(?:${ABERTURA}\\s*(?:${lista})\\s*${FECHAMENTO}${SEPARADORES}*|(?:${lista})${SEPARADORES}+)(?<nome>.+)$`,
      'di',
    ),
  ];
}

const PADROES_POR_TIPO = MARCADORES_DE_TIPO_DE_BASE.map(({ tipo, marcadores }) => ({
  tipo,
  padroes: montarPadroes(marcadores),
}));

/**
 * Separa o marcador de ambiente do nome do cliente.
 *
 * Devolve `{ nome, tipo }`; sem marcador reconhecido — ou quando sobraria um
 * nome vazio, como em "PROD" sozinho — o nome volta inteiro e o tipo em branco,
 * para o usuário escolher na tela.
 */
export function separarTipoDoNome(nomeDoFavorito) {
  const nomeComparavel = semAcentos(nomeDoFavorito);

  for (const { tipo, padroes } of PADROES_POR_TIPO) {
    for (const padrao of padroes) {
      const casamento = padrao.exec(nomeComparavel);
      if (!casamento) {
        continue;
      }

      const [inicio, fim] = casamento.indices.groups.nome;
      const nome = nomeDoFavorito.slice(inicio, fim).replace(SEPARADORES_NAS_PONTAS, '');
      if (nome) {
        return { nome, tipo };
      }
    }
  }

  return { nome: nomeDoFavorito, tipo: '' };
}
