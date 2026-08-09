import { readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { executarGit } from '../git/executarGit.ts';
import { garantirQueEhPasta } from './pasta.ts';

/**
 * Varredura de repositórios Git já clonados na máquina.
 *
 * Serve à importação de repositórios locais: o usuário aponta pastas e o HUB SNK
 * descobre o que há de repositório dentro delas, com o remoto e a branch de
 * cada um, para que ele só precise escolher o cliente de cada repositório.
 */

/** Descer demais em uma pasta como `C:\` custa minutos e não acha nada útil. */
const PROFUNDIDADE_MAXIMA = 6;

/** Teto de segurança: uma pasta mal escolhida não pode travar o HUB SNK. */
const QUANTIDADE_MAXIMA_DE_REPOSITORIOS = 500;

/* Pastas grandes que nunca contêm um clone que interesse ao HUB SNK. */
const PASTAS_IGNORADAS = new Set([
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  '.idea',
  '.vscode',
  '.gradle',
  '.m2',
  'vendor',
  '__pycache__',
]);

const PASTA_DO_GIT = '.git';

/* Remoto SSH no formato curto: `git@github.com:organizacao/projeto.git`. */
const REMOTO_SSH_CURTO = /^(?:[^@\s]+@)?([^:\s/]+):(.+)$/;

const PROTOCOLOS_ACEITOS = ['http:', 'https:'];

export interface RepositorioLocalEncontrado {
  /** Pasta do clone na máquina. Identifica o repositório na tela. */
  caminho: string;
  nome: string;
  /**
   * Remoto convertido para http/https. Vazio quando o repositório não tem
   * remoto ou o remoto não é convertível — nesse caso não dá para importar.
   */
  url: string;
  /** `null` quando o repositório ainda não tem commit. */
  branch: string | null;
}

/**
 * Converte a URL do remoto para http/https.
 *
 * O cadastro do HUB SNK guarda URL de página de repositório, que é o que abre no
 * navegador; `ssh://` e `git@host:org/projeto.git` apontam para o mesmo lugar e
 * são convertidos. Protocolo desconhecido vira string vazia: melhor a tela
 * dizer "sem remoto utilizável" do que gravar um endereço que não abre.
 */
export function converterRemotoParaUrlHttp(remoto: string): string {
  const valor = remoto.trim();
  if (valor === '') {
    return '';
  }

  const semSufixo = valor.replace(/\.git$/, '');

  try {
    const endereco = new URL(semSufixo);
    if (PROTOCOLOS_ACEITOS.includes(endereco.protocol)) {
      return semSufixo;
    }
    if (endereco.protocol === 'ssh:') {
      return `https://${endereco.host}${endereco.pathname}`;
    }
    return '';
  } catch {
    const partes = REMOTO_SSH_CURTO.exec(semSufixo);
    if (!partes) {
      return '';
    }
    const [, host, caminho] = partes as unknown as [string, string, string];
    return `https://${host}/${caminho.replace(/^\/+/, '')}`;
  }
}

async function lerRemoto(caminho: string): Promise<string> {
  const resultado = await executarGit(caminho, ['config', '--get', 'remote.origin.url']);
  return resultado.sucesso ? converterRemotoParaUrlHttp(resultado.saida) : '';
}

/** `null` em repositório sem commit, onde o HEAD ainda não aponta para nada. */
async function lerBranch(caminho: string): Promise<string | null> {
  const resultado = await executarGit(caminho, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!resultado.sucesso) {
    return null;
  }

  const branch = resultado.saida.trim();
  return branch === '' || branch === 'HEAD' ? null : branch;
}

async function descreverRepositorio(caminho: string): Promise<RepositorioLocalEncontrado> {
  const [url, branch] = await Promise.all([lerRemoto(caminho), lerBranch(caminho)]);
  return { caminho, nome: basename(caminho), url, branch };
}

async function ehRepositorio(caminho: string): Promise<boolean> {
  try {
    const conteudo = await readdir(caminho, { withFileTypes: true });
    return conteudo.some((item) => item.name === PASTA_DO_GIT);
  } catch {
    return false;
  }
}

/**
 * Percorre a pasta acumulando os caminhos que têm `.git`.
 *
 * Achou repositório, para de descer: submódulo e worktree aninhada pertencem ao
 * repositório de cima e não são cadastro à parte no HUB SNK.
 */
async function coletarCaminhos(
  pasta: string,
  profundidade: number,
  encontrados: string[],
): Promise<void> {
  if (encontrados.length >= QUANTIDADE_MAXIMA_DE_REPOSITORIOS) {
    return;
  }

  if (await ehRepositorio(pasta)) {
    encontrados.push(pasta);
    return;
  }

  if (profundidade >= PROFUNDIDADE_MAXIMA) {
    return;
  }

  let conteudo;
  try {
    conteudo = await readdir(pasta, { withFileTypes: true });
  } catch {
    // Pasta sem permissão de leitura não interrompe a varredura das demais.
    return;
  }

  for (const item of conteudo) {
    if (!item.isDirectory() || PASTAS_IGNORADAS.has(item.name)) {
      continue;
    }
    await coletarCaminhos(join(pasta, item.name), profundidade + 1, encontrados);
  }
}

/**
 * Varre as pastas informadas e devolve os repositórios encontrados, ordenados
 * por nome e sem repetição — pastas que se sobrepõem não duplicam o resultado.
 *
 * Lança `PastaNaoEncontradaError` quando uma das pastas não existe.
 */
export async function varrerRepositoriosLocais(
  pastas: string[],
): Promise<RepositorioLocalEncontrado[]> {
  for (const pasta of pastas) {
    await garantirQueEhPasta(pasta);
  }

  const encontrados: string[] = [];
  for (const pasta of pastas) {
    await coletarCaminhos(pasta, 0, encontrados);
  }

  const unicos = [...new Set(encontrados)];
  const repositorios = await Promise.all(unicos.map(descreverRepositorio));
  return repositorios.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}
