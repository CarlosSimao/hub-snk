/**
 * Texto corrido de um PDF, sem dependência nova.
 *
 * Serve ao Codex e ao Cursor, que não leem PDF sozinhos: o texto extraído aqui vai
 * embutido no prompt, como o de um `.docx`. Os assistentes que leem PDF continuam
 * recebendo o arquivo original, que preserva tabelas e figuras melhor que isto.
 *
 * O alvo é o PDF de escopo que sai do Word, do Google Docs e de geradores de relatório:
 * objetos soltos ou em object streams, conteúdo em FlateDecode e fontes com tabela
 * `ToUnicode`. Não há OCR: PDF digitalizado, que é só imagem, não tem texto para dar.
 * PDF protegido por senha também é recusado.
 *
 * A ordem do texto é a dos operadores de cada página, que nos geradores comuns é a
 * ordem de leitura. Mudança de linha no PDF vira quebra de linha; o resto do layout
 * some, como no `.docx`.
 */
import { inflateSync, constants as constantesDoZlib } from 'node:zlib';

export class PdfIlegivelError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'PdfIlegivelError';
  }
}

const LIMITE_DE_PAGINAS = 1000;
const PROFUNDIDADE_MAXIMA = 8;
/** Deslocamento negativo no `TJ`, em milésimos de em, a partir do qual há um espaço. */
const AFASTAMENTO_QUE_VIRA_ESPACO = 180;
/** Folga horizontal, em frações do tamanho da fonte, que já separa duas palavras. */
const FOLGA_QUE_VIRA_ESPACO = 0.15;
/** Desvio vertical, em frações do tamanho da fonte, que já é outra linha. */
const DESVIO_QUE_VIRA_LINHA = 0.5;
/** Avanço usado quando a fonte não declara as larguras. */
const AVANCO_PADRAO = 500;

// --- valores do PDF -----------------------------------------------------------------

class Nome {
  readonly nome: string;

  constructor(nome: string) {
    this.nome = nome;
  }
}

class Referencia {
  readonly numero: number;

  constructor(numero: number) {
    this.numero = numero;
  }
}

class Operador {
  readonly operador: string;

  constructor(operador: string) {
    this.operador = operador;
  }
}

/** Cadeia de bytes do PDF, guardada como texto latin1 (um caractere por byte). */
class Cadeia {
  readonly bytes: string;

  constructor(bytes: string) {
    this.bytes = bytes;
  }
}

type Dicionario = Map<string, Valor>;

type Valor = number | boolean | null | Nome | Referencia | Operador | Cadeia | Valor[] | Dicionario;

const ESPACOS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIMITADORES = new Set('()<>[]{}/%'.split('').map((caractere) => caractere.charCodeAt(0)));

/** Lê valores e operadores um a um, de um objeto ou de um fluxo de conteúdo. */
class Leitor {
  readonly texto: string;
  posicao = 0;

  constructor(texto: string) {
    this.texto = texto;
  }

  #pularEspacos(): void {
    const { texto } = this;
    while (this.posicao < texto.length) {
      const codigo = texto.charCodeAt(this.posicao);
      if (ESPACOS.has(codigo)) {
        this.posicao += 1;
      } else if (codigo === 0x25) {
        // Comentário vai até o fim da linha.
        while (this.posicao < texto.length && !/[\r\n]/.test(texto[this.posicao] ?? '')) {
          this.posicao += 1;
        }
      } else {
        return;
      }
    }
  }

  /** O próximo valor completo, com arrays e dicionários montados; `undefined` no fim. */
  valor(): Valor | undefined {
    const token = this.#token();
    if (token === undefined) {
      return undefined;
    }
    if (token instanceof Operador) {
      if (token.operador === '[') {
        const itens: Valor[] = [];
        for (;;) {
          const item = this.valor();
          if (item === undefined || (item instanceof Operador && item.operador === ']')) {
            return itens;
          }
          itens.push(item);
        }
      }
      if (token.operador === '<<') {
        const dicionario: Dicionario = new Map();
        for (;;) {
          const chave = this.valor();
          if (chave === undefined || (chave instanceof Operador && chave.operador === '>>')) {
            return dicionario;
          }
          if (chave instanceof Nome) {
            const conteudo = this.valor();
            if (conteudo !== undefined) {
              dicionario.set(chave.nome, conteudo);
            }
          }
        }
      }
      return token;
    }
    // `n g R` é referência: olha adiante sem consumir se não for.
    if (typeof token === 'number' && Number.isInteger(token)) {
      const salva = this.posicao;
      const geracao = this.#token();
      const r = this.#token();
      if (typeof geracao === 'number' && r instanceof Operador && r.operador === 'R') {
        return new Referencia(token);
      }
      this.posicao = salva;
    }
    return token;
  }

  #token(): Valor | undefined {
    this.#pularEspacos();
    const { texto } = this;
    if (this.posicao >= texto.length) {
      return undefined;
    }
    const caractere = texto[this.posicao] as string;

    if (caractere === '(') {
      return this.#cadeiaLiteral();
    }
    if (caractere === '<') {
      if (texto[this.posicao + 1] === '<') {
        this.posicao += 2;
        return new Operador('<<');
      }
      const fim = texto.indexOf('>', this.posicao);
      const hexadecimal = texto
        .slice(this.posicao + 1, fim < 0 ? texto.length : fim)
        .replace(/[^0-9a-fA-F]/g, '');
      this.posicao = fim < 0 ? texto.length : fim + 1;
      return new Cadeia(bytesDoHexadecimal(hexadecimal));
    }
    if (caractere === '>' && texto[this.posicao + 1] === '>') {
      this.posicao += 2;
      return new Operador('>>');
    }
    if ('[]{}'.includes(caractere)) {
      this.posicao += 1;
      return new Operador(caractere);
    }
    if (caractere === '/') {
      this.posicao += 1;
      const inicio = this.posicao;
      while (this.posicao < texto.length && !this.#terminaPalavra(texto.charCodeAt(this.posicao))) {
        this.posicao += 1;
      }
      return new Nome(
        texto
          .slice(inicio, this.posicao)
          .replace(/#([0-9a-fA-F]{2})/g, (_, par: string) =>
            String.fromCharCode(parseInt(par, 16)),
          ),
      );
    }

    const inicio = this.posicao;
    while (this.posicao < texto.length && !this.#terminaPalavra(texto.charCodeAt(this.posicao))) {
      this.posicao += 1;
    }
    if (this.posicao === inicio) {
      // Delimitador solto, como um `)` fora de cadeia: pula para não travar.
      this.posicao += 1;
      return new Operador(caractere);
    }
    const palavra = texto.slice(inicio, this.posicao);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(palavra)) {
      return Number(palavra);
    }
    if (palavra === 'true' || palavra === 'false') {
      return palavra === 'true';
    }
    if (palavra === 'null') {
      return null;
    }
    return new Operador(palavra);
  }

  #terminaPalavra(codigo: number): boolean {
    return ESPACOS.has(codigo) || DELIMITADORES.has(codigo);
  }

  #cadeiaLiteral(): Cadeia {
    const { texto } = this;
    this.posicao += 1;
    let nivel = 1;
    let bytes = '';
    while (this.posicao < texto.length) {
      const caractere = texto[this.posicao] as string;
      this.posicao += 1;
      if (caractere === '\\') {
        const seguinte = texto[this.posicao] ?? '';
        this.posicao += 1;
        const escapes: Record<string, string> = {
          n: '\n',
          r: '\r',
          t: '\t',
          b: '\b',
          f: '\f',
          '(': '(',
          ')': ')',
          '\\': '\\',
        };
        if (seguinte in escapes) {
          bytes += escapes[seguinte];
        } else if (/[0-7]/.test(seguinte)) {
          let octal = seguinte;
          while (octal.length < 3 && /[0-7]/.test(texto[this.posicao] ?? '')) {
            octal += texto[this.posicao];
            this.posicao += 1;
          }
          bytes += String.fromCharCode(parseInt(octal, 8) & 0xff);
        } else if (seguinte === '\r') {
          // Barra no fim da linha emenda a cadeia na linha seguinte.
          if (texto[this.posicao] === '\n') this.posicao += 1;
        } else if (seguinte !== '\n') {
          bytes += seguinte;
        }
      } else if (caractere === '(') {
        nivel += 1;
        bytes += caractere;
      } else if (caractere === ')') {
        nivel -= 1;
        if (nivel === 0) {
          break;
        }
        bytes += caractere;
      } else {
        bytes += caractere;
      }
    }
    return new Cadeia(bytes);
  }

  /** Pula a imagem embutida (`BI ... ID <bytes> EI`), que é binária e confundiria a leitura. */
  pularImagemEmbutida(): void {
    const fim = /\sEI(?=[\s]|$)/g;
    fim.lastIndex = this.posicao;
    const achado = fim.exec(this.texto);
    this.posicao = achado ? achado.index + achado[0].length : this.texto.length;
  }
}

function bytesDoHexadecimal(hexadecimal: string): string {
  const par = hexadecimal.length % 2 ? `${hexadecimal}0` : hexadecimal;
  let bytes = '';
  for (let posicao = 0; posicao < par.length; posicao += 2) {
    bytes += String.fromCharCode(parseInt(par.slice(posicao, posicao + 2), 16));
  }
  return bytes;
}

// --- fluxos ---------------------------------------------------------------------------

function nomeDe(valor: Valor | undefined): string {
  return valor instanceof Nome ? valor.nome : '';
}

function descomprimir(dados: Buffer): Buffer {
  try {
    return inflateSync(dados);
  } catch {
    // Fluxo truncado ou com lixo no fim: aproveita o que der para descomprimir.
    return inflateSync(dados, { finishFlush: constantesDoZlib.Z_SYNC_FLUSH });
  }
}

function decodificarAscii85(dados: string): string {
  const limpo = dados.replace(/\s/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  let saida = '';
  let grupo: number[] = [];
  const despejar = (quantos: number) => {
    let valor = 0;
    for (const digito of grupo) valor = valor * 85 + digito;
    const bytes = [
      (valor >>> 24) & 0xff,
      (valor >>> 16) & 0xff,
      (valor >>> 8) & 0xff,
      valor & 0xff,
    ];
    saida += String.fromCharCode(...bytes.slice(0, quantos));
  };
  for (const caractere of limpo) {
    if (caractere === 'z' && grupo.length === 0) {
      saida += '\0\0\0\0';
      continue;
    }
    grupo.push(caractere.charCodeAt(0) - 33);
    if (grupo.length === 5) {
      despejar(4);
      grupo = [];
    }
  }
  if (grupo.length) {
    const quantos = grupo.length - 1;
    while (grupo.length < 5) grupo.push(84);
    despejar(quantos);
  }
  return saida;
}

/** O conteúdo do fluxo depois dos filtros, como latin1; `null` se o filtro não é de texto. */
function decodificarFluxo(dicionario: Dicionario, bruto: string): string | null {
  const filtro = dicionario.get('Filter');
  const filtros = (Array.isArray(filtro) ? filtro : filtro === undefined ? [] : [filtro]).map(
    (item) => nomeDe(item),
  );
  let dados = bruto;
  for (const nome of filtros) {
    if (nome === 'FlateDecode' || nome === 'Fl') {
      dados = descomprimir(Buffer.from(dados, 'latin1')).toString('latin1');
    } else if (nome === 'ASCIIHexDecode' || nome === 'AHx') {
      dados = bytesDoHexadecimal(dados.replace(/>.*$/s, '').replace(/[^0-9a-fA-F]/g, ''));
    } else if (nome === 'ASCII85Decode' || nome === 'A85') {
      dados = decodificarAscii85(dados);
    } else {
      // Imagem (DCT, JBIG2, CCITT) ou LZW antigo: nada de texto aí.
      return null;
    }
  }
  return dados;
}

// --- documento ------------------------------------------------------------------------

interface ObjetoBruto {
  /** O texto do objeto até o `stream`, ou o objeto inteiro. */
  corpo: string;
  fluxo?: string;
  valor?: Valor;
  fluxoDecodificado?: string | null;
}

class DocumentoPdf {
  readonly #objetos = new Map<number, ObjetoBruto>();

  readonly texto: string;

  constructor(texto: string) {
    this.texto = texto;
    this.#lerObjetos();
    this.#lerObjectStreams();
  }

  #lerObjetos(): void {
    const { texto } = this;
    const cabecalho = /(\d+)\s+(\d+)\s+obj\b/g;
    let achado: RegExpExecArray | null;
    while ((achado = cabecalho.exec(texto))) {
      const numero = Number(achado[1]);
      const inicio = achado.index + achado[0].length;
      const fimDoObjeto = texto.indexOf('endobj', inicio);
      const marcaDoFluxo = texto.indexOf('stream', inicio);
      const fim = fimDoObjeto < 0 ? texto.length : fimDoObjeto;

      if (marcaDoFluxo >= 0 && marcaDoFluxo < fim) {
        let inicioDoFluxo = marcaDoFluxo + 'stream'.length;
        if (texto[inicioDoFluxo] === '\r') inicioDoFluxo += 1;
        if (texto[inicioDoFluxo] === '\n') inicioDoFluxo += 1;
        const fimDoFluxo = texto.indexOf('endstream', inicioDoFluxo);
        const corte = fimDoFluxo < 0 ? texto.length : fimDoFluxo;
        // O `/Length` direto é exato; indireto ou ausente, vale o `endstream`.
        const corpo = texto.slice(inicio, marcaDoFluxo);
        // O `(?![\d.])` impede que `/Length 19 0 R` vire o tamanho direto `1`.
        const tamanho = /\/Length\s+(\d+)(?![\d.])(?!\s+\d+\s+R)/.exec(corpo);
        const tamanhoDireto = tamanho ? Number(tamanho[1]) : -1;
        const fluxo =
          tamanhoDireto >= 0 && inicioDoFluxo + tamanhoDireto <= corte
            ? texto.slice(inicioDoFluxo, inicioDoFluxo + tamanhoDireto)
            : texto.slice(inicioDoFluxo, corte).replace(/\r?\n$/, '');
        this.#objetos.set(numero, { corpo, fluxo });
        cabecalho.lastIndex = corte;
      } else {
        this.#objetos.set(numero, { corpo: texto.slice(inicio, fim) });
        cabecalho.lastIndex = fim;
      }
    }
  }

  /** PDF 1.5 em diante guarda a maior parte dos objetos dentro de fluxos (`/ObjStm`). */
  #lerObjectStreams(): void {
    for (const objeto of [...this.#objetos.values()]) {
      if (objeto.fluxo === undefined) {
        continue;
      }
      const dicionario = this.#valorDoObjeto(objeto);
      if (!(dicionario instanceof Map) || nomeDe(dicionario.get('Type')) !== 'ObjStm') {
        continue;
      }
      const conteudo = this.#fluxoDoObjeto(objeto);
      const quantos = dicionario.get('N');
      const primeiro = dicionario.get('First');
      if (conteudo === null || typeof quantos !== 'number' || typeof primeiro !== 'number') {
        continue;
      }
      const indice = conteudo.slice(0, primeiro).trim().split(/\s+/).map(Number);
      for (let posicao = 0; posicao < quantos; posicao += 1) {
        const numero = indice[posicao * 2];
        const deslocamento = indice[posicao * 2 + 1];
        const proximo = indice[posicao * 2 + 3];
        if (numero === undefined || deslocamento === undefined || this.#objetos.has(numero)) {
          continue;
        }
        const inicio = primeiro + deslocamento;
        const fim = proximo === undefined ? conteudo.length : primeiro + proximo;
        this.#objetos.set(numero, { corpo: conteudo.slice(inicio, fim) });
      }
    }
  }

  #valorDoObjeto(objeto: ObjetoBruto): Valor {
    if (objeto.valor === undefined) {
      objeto.valor = new Leitor(objeto.corpo).valor() ?? null;
    }
    return objeto.valor;
  }

  #fluxoDoObjeto(objeto: ObjetoBruto): string | null {
    if (objeto.fluxoDecodificado === undefined) {
      const dicionario = this.#valorDoObjeto(objeto);
      try {
        objeto.fluxoDecodificado =
          objeto.fluxo !== undefined && dicionario instanceof Map
            ? decodificarFluxo(dicionario, objeto.fluxo)
            : null;
      } catch {
        objeto.fluxoDecodificado = null;
      }
    }
    return objeto.fluxoDecodificado;
  }

  /** Segue a referência, se for uma; valor direto volta como está. */
  resolver(valor: Valor | undefined): Valor | undefined {
    let atual = valor;
    for (let saltos = 0; atual instanceof Referencia && saltos < PROFUNDIDADE_MAXIMA; saltos += 1) {
      const objeto = this.#objetos.get(atual.numero);
      atual = objeto ? this.#valorDoObjeto(objeto) : undefined;
    }
    return atual;
  }

  dicionario(valor: Valor | undefined): Dicionario | undefined {
    const resolvido = this.resolver(valor);
    return resolvido instanceof Map ? resolvido : undefined;
  }

  /** O conteúdo decodificado do fluxo apontado pela referência. */
  fluxo(valor: Valor | undefined): string | null {
    if (!(valor instanceof Referencia)) {
      return null;
    }
    const objeto = this.#objetos.get(valor.numero);
    return objeto ? this.#fluxoDoObjeto(objeto) : null;
  }

  /** As páginas na ordem do documento, com os recursos herdados dos nós de cima. */
  paginas(): { pagina: Dicionario; recursos: Dicionario | undefined }[] {
    const paginas: { pagina: Dicionario; recursos: Dicionario | undefined }[] = [];
    const raiz = [...this.texto.matchAll(/\/Root\s+(\d+)\s+\d+\s+R/g)].at(-1);
    const catalogo = raiz ? this.dicionario(new Referencia(Number(raiz[1]))) : undefined;
    const visitados = new Set<Dicionario>();

    const percorrer = (
      no: Dicionario | undefined,
      recursos: Dicionario | undefined,
      nivel: number,
    ) => {
      if (!no || visitados.has(no) || nivel > 64 || paginas.length >= LIMITE_DE_PAGINAS) {
        return;
      }
      visitados.add(no);
      const proprios = this.dicionario(no.get('Resources')) ?? recursos;
      const filhos = this.resolver(no.get('Kids'));
      if (Array.isArray(filhos)) {
        for (const filho of filhos) percorrer(this.dicionario(filho), proprios, nivel + 1);
      } else if (nomeDe(no.get('Type')) === 'Page' || no.has('Contents')) {
        paginas.push({ pagina: no, recursos: proprios });
      }
    };
    percorrer(this.dicionario(catalogo?.get('Pages')), undefined, 0);

    // Sem catálogo legível, as páginas na ordem dos objetos ainda dão o texto.
    if (!paginas.length) {
      for (const numero of [...this.#objetos.keys()].sort((a, b) => a - b)) {
        const objeto = this.dicionario(new Referencia(numero));
        if (objeto && nomeDe(objeto.get('Type')) === 'Page') {
          paginas.push({ pagina: objeto, recursos: this.dicionario(objeto.get('Resources')) });
        }
      }
    }
    return paginas;
  }
}

// --- fontes ---------------------------------------------------------------------------

interface Fonte {
  /** Bytes por código: 2 nas fontes compostas (`Type0`), como as que o Word grava. */
  largura: 1 | 2;
  mapa: Map<number, string> | null;
  /** Avanço do glifo, em milésimos do tamanho da fonte: é o que diz onde a palavra acaba. */
  avanco: (codigo: number) => number;
}

const DECODIFICADOR_WINDOWS_1252 = (() => {
  try {
    return new TextDecoder('windows-1252');
  } catch {
    return null;
  }
})();

function textoDoUtf16(bytes: string): string {
  let texto = '';
  for (let posicao = 0; posicao + 1 < bytes.length; posicao += 2) {
    texto += String.fromCharCode((bytes.charCodeAt(posicao) << 8) | bytes.charCodeAt(posicao + 1));
  }
  return texto;
}

function codigoDosBytes(bytes: string): number {
  let codigo = 0;
  for (const byte of bytes) codigo = codigo * 256 + byte.charCodeAt(0);
  return codigo;
}

/** A tabela `ToUnicode`: de código da fonte para texto. */
function lerMapaUnicode(cmap: string): { mapa: Map<number, string>; largura: 1 | 2 | null } {
  const mapa = new Map<number, string>();
  const espaco = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(cmap);
  const largura = espaco ? ((espaco[1] as string).length > 2 ? 2 : 1) : null;

  for (const bloco of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const par of (bloco[1] as string).matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) {
      mapa.set(
        codigoDosBytes(bytesDoHexadecimal(par[1] as string)),
        textoDoUtf16(bytesDoHexadecimal(par[2] as string)),
      );
    }
  }
  for (const bloco of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const corpo = bloco[1] as string;
    const faixa = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g;
    for (const item of corpo.matchAll(faixa)) {
      const inicio = codigoDosBytes(bytesDoHexadecimal(item[1] as string));
      const fim = codigoDosBytes(bytesDoHexadecimal(item[2] as string));
      const destino = item[3] as string;
      if (fim - inicio > 0xffff) continue;
      if (destino.startsWith('[')) {
        const lista = [...destino.matchAll(/<([0-9a-fA-F]*)>/g)];
        lista.forEach((elemento, deslocamento) => {
          mapa.set(inicio + deslocamento, textoDoUtf16(bytesDoHexadecimal(elemento[1] as string)));
        });
      } else {
        const base = bytesDoHexadecimal(destino.slice(1, -1));
        const ultimo = base.length - 1;
        for (let codigo = inicio; codigo <= fim; codigo += 1) {
          // O último byte do destino avança junto com o código.
          const avanco = base.charCodeAt(ultimo) + (codigo - inicio);
          const destinoDoCodigo = base.slice(0, ultimo) + String.fromCharCode(avanco & 0xff);
          mapa.set(codigo, textoDoUtf16(destinoDoCodigo));
        }
      }
    }
  }
  return { mapa, largura };
}

/** As larguras de `/W` das fontes compostas: `c [w1 w2 ...]` ou `c1 c2 w`. */
function lerLargurasCompostas(
  documento: DocumentoPdf,
  valor: Valor | undefined,
): Map<number, number> {
  const larguras = new Map<number, number>();
  const lista = documento.resolver(valor);
  if (!Array.isArray(lista)) {
    return larguras;
  }
  for (let posicao = 0; posicao < lista.length;) {
    const primeiro = documento.resolver(lista[posicao]);
    const segundo = documento.resolver(lista[posicao + 1]);
    if (typeof primeiro !== 'number') {
      posicao += 1;
    } else if (Array.isArray(segundo)) {
      segundo.forEach((largura, deslocamento) => {
        const resolvida = documento.resolver(largura);
        if (typeof resolvida === 'number') larguras.set(primeiro + deslocamento, resolvida);
      });
      posicao += 2;
    } else {
      const largura = documento.resolver(lista[posicao + 2]);
      if (
        typeof segundo === 'number' &&
        typeof largura === 'number' &&
        segundo - primeiro < 0x10000
      ) {
        for (let codigo = primeiro; codigo <= segundo; codigo += 1) larguras.set(codigo, largura);
      }
      posicao += 3;
    }
  }
  return larguras;
}

function lerFonte(documento: DocumentoPdf, valor: Valor | undefined): Fonte {
  const dicionario = documento.dicionario(valor);
  const composta = nomeDe(dicionario?.get('Subtype')) === 'Type0';

  let avanco: (codigo: number) => number;
  if (composta) {
    const descendentes = documento.resolver(dicionario?.get('DescendantFonts'));
    const descendente = documento.dicionario(
      Array.isArray(descendentes) ? descendentes[0] : undefined,
    );
    const larguras = lerLargurasCompostas(documento, descendente?.get('W'));
    const padrao = documento.resolver(descendente?.get('DW'));
    const avancoPadrao = typeof padrao === 'number' ? padrao : 1000;
    avanco = (codigo) => larguras.get(codigo) ?? avancoPadrao;
  } else {
    const primeiro = documento.resolver(dicionario?.get('FirstChar'));
    const larguras = documento.resolver(dicionario?.get('Widths'));
    const descritor = documento.dicionario(dicionario?.get('FontDescriptor'));
    const faltante = documento.resolver(descritor?.get('MissingWidth'));
    const avancoPadrao = typeof faltante === 'number' && faltante > 0 ? faltante : AVANCO_PADRAO;
    avanco = (codigo) => {
      if (!Array.isArray(larguras) || typeof primeiro !== 'number') return avancoPadrao;
      const largura = documento.resolver(larguras[codigo - primeiro]);
      return typeof largura === 'number' ? largura : avancoPadrao;
    };
  }

  const cmap = documento.fluxo(dicionario?.get('ToUnicode'));
  if (cmap) {
    const { mapa, largura } = lerMapaUnicode(cmap);
    return { largura: largura ?? (composta ? 2 : 1), mapa, avanco };
  }
  return { largura: composta ? 2 : 1, mapa: null, avanco };
}

/** Cada código da cadeia, com o texto que ele representa. */
function codigosDaCadeia(
  bytes: string,
  fonte: Fonte | undefined,
): { codigo: number; texto: string }[] {
  const largura = fonte?.largura ?? 1;
  const codigos: { codigo: number; texto: string }[] = [];
  const semMapa = !fonte?.mapa && largura === 1;
  for (let posicao = 0; posicao < bytes.length; posicao += largura) {
    const pedaco = bytes.slice(posicao, posicao + largura);
    const codigo = codigoDosBytes(pedaco);
    let texto = fonte?.mapa?.get(codigo);
    if (texto === undefined) {
      if (semMapa) {
        texto = DECODIFICADOR_WINDOWS_1252
          ? DECODIFICADOR_WINDOWS_1252.decode(Buffer.from(pedaco, 'latin1'))
          : pedaco;
      } else {
        texto = largura === 1 ? String.fromCharCode(codigo) : '';
      }
    }
    codigos.push({ codigo, texto });
  }
  return codigos;
}

// --- conteúdo das páginas -------------------------------------------------------------

class Escritor {
  readonly linhas: string[] = [];
  #linha = '';

  escrever(texto: string): void {
    this.#linha += texto;
  }

  espaco(): void {
    if (this.#linha && !this.#linha.endsWith(' ')) {
      this.#linha += ' ';
    }
  }

  quebrar(): void {
    this.linhas.push(this.#linha.replace(/\s+$/, ''));
    this.#linha = '';
  }

  terminar(): string {
    this.quebrar();
    return this.linhas.join('\n');
  }
}

type Matriz = [number, number, number, number, number, number];

const IDENTIDADE: Matriz = [1, 0, 0, 1, 0, 0];

/**
 * Lê os operadores de texto acompanhando onde cada glifo cai. Espaço e quebra de linha
 * saem da posição, e não do operador: há gerador que posiciona letra por letra, e
 * outro que parte uma palavra em vários blocos de texto.
 */
function lerConteudo(
  documento: DocumentoPdf,
  conteudo: string,
  recursos: Dicionario | undefined,
  escritor: Escritor,
  nivel: number,
): void {
  const fontes = new Map<string, Fonte>();
  const dicionarioDeFontes = documento.dicionario(recursos?.get('Font'));
  const fonteChamada = (nome: string): Fonte | undefined => {
    if (!fontes.has(nome) && dicionarioDeFontes?.has(nome)) {
      fontes.set(nome, lerFonte(documento, dicionarioDeFontes.get(nome)));
    }
    return fontes.get(nome);
  };

  let fonte: Fonte | undefined;
  let tamanho = 0;
  let espacamentoDeCaractere = 0;
  let espacamentoDePalavra = 0;
  let escalaHorizontal = 1;
  let entrelinha = 0;
  let matriz: Matriz = [...IDENTIDADE];
  let matrizDaLinha: Matriz = [...IDENTIDADE];
  /** Onde o último texto mostrado terminou, para comparar com o próximo. */
  let fim: { x: number; y: number } | null = null;

  const escala = () => Math.hypot(matriz[0], matriz[1]) * Math.abs(tamanho || 1);
  const alturaDaLinha = () => Math.hypot(matriz[2], matriz[3]) * Math.abs(tamanho || 1);

  const moverLinha = (tx: number, ty: number) => {
    const [a, b, c, d, e, f] = matrizDaLinha;
    matrizDaLinha = [a, b, c, d, e + tx * a + ty * c, f + tx * b + ty * d];
    matriz = [...matrizDaLinha];
  };

  const avancar = (deslocamento: number) => {
    matriz = [
      matriz[0],
      matriz[1],
      matriz[2],
      matriz[3],
      matriz[4] + deslocamento * matriz[0],
      matriz[5] + deslocamento * matriz[1],
    ];
  };

  const separarDoAnterior = () => {
    if (!fim) return;
    const altura = alturaDaLinha();
    // Desvio medido no eixo da linha: vale também para texto girado ou espelhado.
    const dx = matriz[4] - fim.x;
    const dy = matriz[5] - fim.y;
    const comprimento = Math.hypot(matriz[0], matriz[1]) || 1;
    const aoLongo = (dx * matriz[0] + dy * matriz[1]) / comprimento;
    const atravessado = (dy * matriz[0] - dx * matriz[1]) / comprimento;
    if (Math.abs(atravessado) > altura * DESVIO_QUE_VIRA_LINHA) {
      escritor.quebrar();
    } else if (Math.abs(aoLongo) > escala() * FOLGA_QUE_VIRA_ESPACO) {
      escritor.espaco();
    }
  };

  const mostrar = (bytes: string) => {
    separarDoAnterior();
    for (const { codigo, texto } of codigosDaCadeia(bytes, fonte)) {
      escritor.escrever(texto);
      const largura = (fonte?.avanco(codigo) ?? AVANCO_PADRAO) / 1000;
      const palavra =
        bytes.length && fonte?.largura !== 2 && codigo === 32 ? espacamentoDePalavra : 0;
      avancar((largura * tamanho + espacamentoDeCaractere + palavra) * escalaHorizontal);
    }
    fim = { x: matriz[4], y: matriz[5] };
  };

  const leitor = new Leitor(conteudo);
  let operandos: Valor[] = [];

  for (let valor = leitor.valor(); valor !== undefined; valor = leitor.valor()) {
    if (!(valor instanceof Operador)) {
      operandos.push(valor);
      continue;
    }
    const numeros = operandos.filter((item): item is number => typeof item === 'number');
    switch (valor.operador) {
      case 'BT':
        matriz = [...IDENTIDADE];
        matrizDaLinha = [...IDENTIDADE];
        break;
      case 'Tf':
        fonte = fonteChamada(nomeDe(operandos[0]));
        tamanho = numeros[0] ?? tamanho;
        break;
      case 'Tc':
        espacamentoDeCaractere = numeros[0] ?? 0;
        break;
      case 'Tw':
        espacamentoDePalavra = numeros[0] ?? 0;
        break;
      case 'Tz':
        escalaHorizontal = (numeros[0] ?? 100) / 100;
        break;
      case 'TL':
        entrelinha = numeros[0] ?? 0;
        break;
      case 'Td':
        moverLinha(numeros[0] ?? 0, numeros[1] ?? 0);
        break;
      case 'TD':
        entrelinha = -(numeros[1] ?? 0);
        moverLinha(numeros[0] ?? 0, numeros[1] ?? 0);
        break;
      case 'Tm':
        if (numeros.length >= 6) {
          matrizDaLinha = numeros.slice(0, 6) as Matriz;
          matriz = [...matrizDaLinha];
        }
        break;
      case 'T*':
        moverLinha(0, -entrelinha);
        break;
      case 'Tj': {
        const cadeia = operandos.at(-1);
        if (cadeia instanceof Cadeia) mostrar(cadeia.bytes);
        break;
      }
      case "'":
      case '"': {
        if (valor.operador === '"') {
          espacamentoDePalavra = numeros[0] ?? espacamentoDePalavra;
          espacamentoDeCaractere = numeros[1] ?? espacamentoDeCaractere;
        }
        moverLinha(0, -entrelinha);
        const cadeia = operandos.at(-1);
        if (cadeia instanceof Cadeia) mostrar(cadeia.bytes);
        break;
      }
      case 'TJ': {
        const lista = operandos.at(-1);
        if (!Array.isArray(lista)) break;
        for (const item of lista) {
          if (item instanceof Cadeia) {
            mostrar(item.bytes);
          } else if (typeof item === 'number') {
            if (item < -AFASTAMENTO_QUE_VIRA_ESPACO) escritor.espaco();
            avancar((-item / 1000) * tamanho * escalaHorizontal);
            if (fim) fim = { x: matriz[4], y: matriz[5] };
          }
        }
        break;
      }
      case 'Do': {
        // Form XObject: um pedaço de página reaproveitado, com recursos próprios.
        if (nivel >= PROFUNDIDADE_MAXIMA) break;
        const xobjetos = documento.dicionario(recursos?.get('XObject'));
        const referencia = xobjetos?.get(nomeDe(operandos[0]));
        const formulario = documento.dicionario(referencia);
        if (formulario && nomeDe(formulario.get('Subtype')) === 'Form') {
          const fluxo = documento.fluxo(referencia);
          if (fluxo) {
            const proprios = documento.dicionario(formulario.get('Resources')) ?? recursos;
            escritor.quebrar();
            lerConteudo(documento, fluxo, proprios, escritor, nivel + 1);
            fim = null;
          }
        }
        break;
      }
      case 'ID':
        leitor.pularImagemEmbutida();
        break;
      default:
        break;
    }
    operandos = [];
  }
}

/** O conteúdo da página: um fluxo só ou uma lista deles, lidos em sequência. */
function conteudoDaPagina(documento: DocumentoPdf, pagina: Dicionario): string {
  const conteudos = pagina.get('Contents');
  const resolvido = documento.resolver(conteudos);
  const referencias = Array.isArray(resolvido) ? resolvido : [conteudos];
  return referencias.map((referencia) => documento.fluxo(referencia) ?? '').join('\n');
}

export function textoDoPdf(arquivo: Buffer): string {
  const texto = arquivo.toString('latin1');
  if (!texto.startsWith('%PDF') && !texto.slice(0, 1024).includes('%PDF')) {
    throw new PdfIlegivelError('O arquivo não é um PDF.');
  }
  if (/\/Encrypt\s/.test(texto)) {
    throw new PdfIlegivelError('O PDF é protegido por senha: salve uma cópia sem proteção.');
  }

  const documento = new DocumentoPdf(texto);
  const paginas = documento.paginas();
  if (!paginas.length) {
    throw new PdfIlegivelError('Não encontrei páginas neste PDF.');
  }

  const textos = paginas.map(({ pagina, recursos }) => {
    const escritor = new Escritor();
    lerConteudo(documento, conteudoDaPagina(documento, pagina), recursos, escritor, 0);
    return escritor.terminar();
  });

  return textos
    .join('\n\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
