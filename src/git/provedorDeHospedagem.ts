import type { ProvedorGit } from '../tipos.ts';

/**
 * Leitura da URL de um remoto Git.
 *
 * O Git aceita dois formatos que não são URLs no mesmo sentido:
 * `https://host/grupo/projeto.git` e o atalho SSH `git@host:grupo/projeto.git`.
 * O segundo não passa por `new URL`, então é tratado por conta própria.
 */

const ATALHO_SSH = /^(?:[^@/\s]+@)?([^/:\s]+):(.+)$/;

export interface EnderecoDoRemoto {
  host: string;
  caminho: string;
}

/** O endereço só é usado para comparação, então a caixa não importa. */
function limparCaminho(caminho: string): string {
  return caminho
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .toLowerCase();
}

export function interpretarEnderecoDoRemoto(url: string): EnderecoDoRemoto | null {
  const bruto = url.trim();
  if (bruto === '') {
    return null;
  }

  if (bruto.includes('://')) {
    try {
      const endereco = new URL(bruto);
      return {
        host: endereco.hostname.toLowerCase(),
        caminho: limparCaminho(endereco.pathname),
      };
    } catch {
      return null;
    }
  }

  const atalho = ATALHO_SSH.exec(bruto);
  if (!atalho) {
    return null;
  }

  return {
    host: (atalho[1] as string).toLowerCase(),
    caminho: limparCaminho(atalho[2] as string),
  };
}

/**
 * Deduz o serviço de hospedagem pelo host do remoto.
 *
 * GitLab instalado no domínio do próprio cliente (`git.cliente.com.br`) não é
 * reconhecível por nome — nesse caso a resposta é `desconhecido`, e não um
 * palpite.
 */
export function detectarProvedor(url: string): ProvedorGit {
  const endereco = interpretarEnderecoDoRemoto(url);
  if (!endereco) {
    return 'desconhecido';
  }

  if (endereco.host === 'github.com' || endereco.host.endsWith('.github.com')) {
    return 'github';
  }

  if (endereco.host === 'gitlab.com' || endereco.host.includes('gitlab')) {
    return 'gitlab';
  }

  return 'desconhecido';
}

/**
 * Compara duas URLs de repositório ignorando protocolo, usuário, `.git` final e
 * diferença de maiúsculas — o que sobra é o par host + caminho, que é o que
 * define se as duas apontam para o mesmo lugar.
 *
 * Endereço ilegível não é tratado como divergência: sem conseguir interpretar
 * os dois lados, não há como afirmar que são diferentes.
 */
export function apontamParaOMesmoRepositorio(uma: string, outra: string): boolean {
  const primeira = interpretarEnderecoDoRemoto(uma);
  const segunda = interpretarEnderecoDoRemoto(outra);

  if (!primeira || !segunda) {
    return true;
  }

  return primeira.host === segunda.host && primeira.caminho === segunda.caminho;
}

/** Remoto configurado com token embutido na URL não pode aparecer na tela. */
export function mascararCredenciais(url: string): string {
  return url.replace(/\/\/[^/@\s]+@/, '//***@');
}

/** `origin` tem preferência; sem ele, vale o primeiro remoto declarado. Saída de `git remote -v`. */
export function escolherRemotoPrincipal(saidaDoGitRemote: string): string | null {
  const remotos = new Map<string, string>();

  for (const linha of saidaDoGitRemote.split('\n')) {
    const [nome, resto] = linha.split('\t');
    if (!nome || !resto) {
      continue;
    }

    const url = resto.replace(/\s+\([a-z]+\)$/, '').trim();
    if (url !== '' && !remotos.has(nome)) {
      remotos.set(nome, url);
    }
  }

  return remotos.get('origin') ?? remotos.values().next().value ?? null;
}
