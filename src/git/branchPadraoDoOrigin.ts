import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PREFIXO_DO_ORIGIN_HEAD = 'ref: refs/remotes/origin/';

/**
 * Branch padrão do remoto `origin`, lida do arquivo `.git/refs/remotes/origin/HEAD`.
 *
 * Lê o arquivo em vez de rodar o Git: a leitura acontece ao carregar o cadastro, para
 * cada repositório, e não pode abrir processo nem esperar rede. Sem o arquivo (clone
 * feito com `--no-checkout`, `git init` + `remote add`), devolve `null` e a branch
 * principal fica por informar.
 */
export async function lerBranchPadraoDoOrigin(caminhoLocal: string): Promise<string | null> {
  try {
    const conteudo = await readFile(
      join(caminhoLocal, '.git', 'refs', 'remotes', 'origin', 'HEAD'),
      'utf8',
    );
    const linha = conteudo.trim();
    const branch = linha.startsWith(PREFIXO_DO_ORIGIN_HEAD)
      ? linha.slice(PREFIXO_DO_ORIGIN_HEAD.length).trim()
      : '';

    return branch === '' ? null : branch;
  } catch {
    // Pasta sem `.git` ou sem o arquivo: é o caso comum, não uma falha.
    return null;
  }
}
