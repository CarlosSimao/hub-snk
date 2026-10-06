/**
 * Explorador de arquivos locais de um cliente ou projeto: lê e altera o conteúdo de UMA
 * pasta raiz escolhida pelo usuário, sem nunca sair dela.
 *
 * O frontend só fala em caminhos relativos à raiz. Aqui cada um é conferido duas vezes:
 * lexicalmente (`..`, caminho absoluto) e pelo caminho real no disco, porque um atalho
 * (link simbólico ou junção) dentro da pasta poderia apontar para fora dela.
 */
import { mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class CaminhoForaDaPastaError extends Error {
  constructor() {
    super('O caminho está fora da pasta do explorador.');
    this.name = 'CaminhoForaDaPastaError';
  }
}

export class NomeInvalidoError extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'NomeInvalidoError';
  }
}

export class ItemNaoEncontradoError extends Error {
  constructor() {
    super('O arquivo ou a pasta não existe mais.');
    this.name = 'ItemNaoEncontradoError';
  }
}

export class ItemJaExisteError extends Error {
  constructor(nome: string) {
    super(`Já existe um item chamado "${nome}" nesta pasta.`);
    this.name = 'ItemJaExisteError';
  }
}

export interface ItemDaPasta {
  nome: string;
  tipo: 'pasta' | 'arquivo';
  /** Bytes; zero para pasta. */
  tamanho: number;
  modificadoEm: string;
}

/** Pastas enormes (node_modules) travariam a tela: a lista é cortada e avisa. */
const LIMITE_DE_ITENS = 2_000;
const CARACTERES_PROIBIDOS_NO_NOME = /[<>:"/\\|?*\u0000-\u001f]/;
const NOMES_RESERVADOS_DO_WINDOWS = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export function validarNome(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) throw new NomeInvalidoError('Informe um nome.');
  if (limpo === '.' || limpo === '..' || CARACTERES_PROIBIDOS_NO_NOME.test(limpo)) {
    throw new NomeInvalidoError('O nome não pode ter / \\ : * ? " < > | nem ser "." ou "..".');
  }
  if (NOMES_RESERVADOS_DO_WINDOWS.test(limpo) || limpo.endsWith('.')) {
    throw new NomeInvalidoError('Este nome não é aceito pelo Windows.');
  }
  return limpo;
}

function dentroDe(raiz: string, alvo: string): boolean {
  const caminho = relative(raiz, alvo);
  return caminho === '' || (!caminho.startsWith('..') && !isAbsolute(caminho));
}

/** Caminho absoluto de `relativo` dentro de `raiz`; recusa o que escapa dela. */
export async function resolverDentro(raiz: string, relativo: string): Promise<string> {
  const base = resolve(raiz);
  const alvo = resolve(base, relativo.split('/').join(sep));
  if (isAbsolute(relativo) || !dentroDe(base, alvo)) throw new CaminhoForaDaPastaError();

  // O que existe é conferido pelo caminho real; o que ainda vai ser criado, pelo do pai.
  const baseReal = await realpath(base);
  let existente = alvo;
  for (;;) {
    try {
      const real = await realpath(existente);
      if (!dentroDe(baseReal, real)) throw new CaminhoForaDaPastaError();
      break;
    } catch (erro) {
      if (erro instanceof CaminhoForaDaPastaError) throw erro;
      const pai = dirname(existente);
      if (pai === existente) break;
      existente = pai;
    }
  }
  return alvo;
}

export async function listarPasta(
  raiz: string,
  relativo: string,
): Promise<{ itens: ItemDaPasta[]; cortada: boolean }> {
  const pasta = await resolverDentro(raiz, relativo);
  let entradas;
  try {
    entradas = await readdir(pasta, { withFileTypes: true });
  } catch {
    throw new ItemNaoEncontradoError();
  }
  const itens: ItemDaPasta[] = [];
  for (const entrada of entradas.slice(0, LIMITE_DE_ITENS)) {
    try {
      const informacoes = await stat(join(pasta, entrada.name));
      itens.push({
        nome: entrada.name,
        tipo: informacoes.isDirectory() ? 'pasta' : 'arquivo',
        tamanho: informacoes.isDirectory() ? 0 : informacoes.size,
        modificadoEm: informacoes.mtime.toISOString(),
      });
    } catch {
      // Atalho quebrado ou arquivo em uso: some da lista em vez de derrubá-la.
    }
  }
  itens.sort((a, b) =>
    a.tipo === b.tipo ? a.nome.localeCompare(b.nome, 'pt-BR') : a.tipo === 'pasta' ? -1 : 1,
  );
  return { itens, cortada: entradas.length > LIMITE_DE_ITENS };
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await stat(caminho);
    return true;
  } catch {
    return false;
  }
}

export async function criarPasta(raiz: string, relativo: string, nome: string): Promise<void> {
  const destino = join(await resolverDentro(raiz, relativo), validarNome(nome));
  if (await existe(destino)) throw new ItemJaExisteError(nome.trim());
  await mkdir(destino);
}

/** Cria o arquivo; nunca sobrescreve um que já exista. */
export async function criarArquivo(
  raiz: string,
  relativo: string,
  nome: string,
  conteudo: Buffer = Buffer.alloc(0),
): Promise<void> {
  const destino = join(await resolverDentro(raiz, relativo), validarNome(nome));
  try {
    await writeFile(destino, conteudo, { flag: 'wx' });
  } catch (erro) {
    if ((erro as NodeJS.ErrnoException).code === 'EEXIST') throw new ItemJaExisteError(nome.trim());
    throw erro;
  }
}

export async function renomear(raiz: string, relativo: string, novoNome: string): Promise<void> {
  const origem = await resolverDentro(raiz, relativo);
  if (origem === resolve(raiz)) throw new CaminhoForaDaPastaError();
  if (!(await existe(origem))) throw new ItemNaoEncontradoError();
  const destino = join(dirname(origem), validarNome(novoNome));
  if (destino === origem) return;
  if (await existe(destino)) throw new ItemJaExisteError(novoNome.trim());
  await rename(origem, destino);
}

/** Exclusão definitiva: a tela pede confirmação antes. A raiz nunca é apagada. */
export async function excluir(raiz: string, relativo: string): Promise<void> {
  const alvo = await resolverDentro(raiz, relativo);
  if (alvo === resolve(raiz)) throw new CaminhoForaDaPastaError();
  if (!(await existe(alvo))) throw new ItemNaoEncontradoError();
  await rm(alvo, { recursive: true, force: true });
}
