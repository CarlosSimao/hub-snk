import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { NOME_DO_ARQUIVO_MCP } from '../sistema/arquivoMcp.ts';
import type { PendenciaGit, Severidade, SituacaoGit } from '../tipos.ts';
import { executarGit, GitIndisponivelError } from './executarGit.ts';
import {
  apontamParaOMesmoRepositorio,
  detectarProvedor,
  escolherRemotoPrincipal,
  mascararCredenciais,
} from './provedorDeHospedagem.ts';

/** Da mais grave para a menos grave; usada para ordenar e para agregar. */
export const ORDEM_DE_SEVERIDADE: Record<Severidade, number> = {
  erro: 0,
  atencao: 1,
  desconhecido: 2,
  ok: 3,
};

/**
 * Arquivos e pastas que o Git cria dentro do `.git` enquanto uma operação está
 * pela metade. A presença de qualquer um deles significa repositório travado no
 * meio do caminho.
 */
const MARCAS_DE_OPERACAO = [
  { marca: 'MERGE_HEAD', descricao: 'merge' },
  { marca: 'rebase-merge', descricao: 'rebase' },
  { marca: 'rebase-apply', descricao: 'rebase' },
  { marca: 'CHERRY_PICK_HEAD', descricao: 'cherry-pick' },
  { marca: 'REVERT_HEAD', descricao: 'revert' },
];

interface EstadoDaArvore {
  /** Nome da branch atual, apenas para exibição. `null` com o HEAD desanexado. */
  branch: string | null;
  semCommits: boolean;
  /** Falso quando a branch atual não segue nenhuma branch do remoto. */
  temUpstream: boolean;
  /** Commits que existem só aqui. Confiável sem rede: são commits locais. */
  commitsAFrente: number;
  rastreadosAlterados: number;
  naoRastreados: number;
  conflitos: number;
}

interface Coleta {
  arvore: EstadoDaArvore;
  urlDoRemoto: string | null;
  operacaoEmAndamento: string | null;
  itensNoStash: number;
  mcpRastreado: boolean;
}

export interface DadosDoRepositorio {
  caminhoLocal: string;
  urlCadastrada: string;
}

function criarPendencia(
  codigo: string,
  severidade: Severidade,
  mensagem: string,
  comandoSugerido?: string,
): PendenciaGit {
  return comandoSugerido
    ? { codigo, severidade, mensagem, comandoSugerido }
    : { codigo, severidade, mensagem };
}

function pluralizar(quantidade: number, singular: string, plural: string): string {
  return quantidade === 1 ? `${quantidade} ${singular}` : `${quantidade} ${plural}`;
}

async function existe(caminho: string): Promise<boolean> {
  try {
    await access(caminho);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lê o `+N` de `# branch.ab +N -M`. O `-M` fica de fora de propósito: sem
 * `fetch`, ele reflete a última sincronização e envelhece sem aviso.
 */
function lerCommitsAFrente(valor: string): number {
  const aFrente = valor.trim().split(/\s+/)[0] ?? '';

  if (!aFrente.startsWith('+')) {
    return 0;
  }

  const quantidade = Number.parseInt(aFrente.slice(1), 10);
  return Number.isNaN(quantidade) ? 0 : quantidade;
}

/**
 * Lê a saída de `git status --porcelain=v2 --branch`.
 *
 * O formato v2 é usado no lugar do v1 porque traz o nome da branch e a distância
 * para o upstream no mesmo texto do estado dos arquivos — uma chamada em vez de
 * três.
 */
function interpretarArvore(saida: string): EstadoDaArvore {
  const arvore: EstadoDaArvore = {
    branch: null,
    semCommits: false,
    temUpstream: false,
    commitsAFrente: 0,
    rastreadosAlterados: 0,
    naoRastreados: 0,
    conflitos: 0,
  };

  for (const linha of saida.split('\n')) {
    if (linha.startsWith('# branch.oid ')) {
      arvore.semCommits = linha.trim().endsWith('(initial)');
    } else if (linha.startsWith('# branch.head ')) {
      const valor = linha.slice('# branch.head '.length).trim();
      arvore.branch = valor === '(detached)' ? null : valor;
    } else if (linha.startsWith('# branch.upstream ')) {
      arvore.temUpstream = true;
    } else if (linha.startsWith('# branch.ab ')) {
      arvore.commitsAFrente = lerCommitsAFrente(linha.slice('# branch.ab '.length));
    } else if (linha.startsWith('1 ') || linha.startsWith('2 ')) {
      arvore.rastreadosAlterados += 1;
    } else if (linha.startsWith('u ')) {
      arvore.conflitos += 1;
    } else if (linha.startsWith('? ')) {
      arvore.naoRastreados += 1;
    }
  }

  return arvore;
}

async function detectarOperacaoEmAndamento(diretorioGit: string): Promise<string | null> {
  for (const { marca, descricao } of MARCAS_DE_OPERACAO) {
    if (await existe(join(diretorioGit, marca))) {
      return descricao;
    }
  }

  return null;
}

async function coletar(caminhoLocal: string, diretorioGit: string): Promise<Coleta> {
  const [status, remotos, stash, mcp, operacaoEmAndamento] = await Promise.all([
    executarGit(caminhoLocal, ['status', '--porcelain=v2', '--branch']),
    executarGit(caminhoLocal, ['remote', '-v']),
    executarGit(caminhoLocal, ['stash', 'list']),
    executarGit(caminhoLocal, ['ls-files', '--', NOME_DO_ARQUIVO_MCP]),
    detectarOperacaoEmAndamento(diretorioGit),
  ]);

  return {
    arvore: interpretarArvore(status.saida),
    urlDoRemoto: escolherRemotoPrincipal(remotos.saida),
    operacaoEmAndamento,
    itensNoStash: stash.saida.split('\n').filter((linha) => linha.trim() !== '').length,
    mcpRastreado: mcp.saida.trim() !== '',
  };
}

/* ------------------------- verificações individuais ----------------------- */

function verificarOperacaoEmAndamento(coleta: Coleta): PendenciaGit[] {
  if (!coleta.operacaoEmAndamento) {
    return [];
  }

  return [
    criarPendencia(
      'operacao-em-andamento',
      'erro',
      `Há um ${coleta.operacaoEmAndamento} em andamento, ainda não concluído.`,
      'git status',
    ),
  ];
}

function verificarConflitos(coleta: Coleta): PendenciaGit[] {
  const { conflitos } = coleta.arvore;
  if (conflitos === 0) {
    return [];
  }

  return [
    criarPendencia(
      'conflitos',
      'erro',
      `${pluralizar(conflitos, 'arquivo com conflito', 'arquivos com conflito')} não resolvido.`,
      'git status',
    ),
  ];
}

/**
 * O HUB SNK grava a senha do banco no `.sankhya-mcp.env` dentro da pasta do
 * repositório. Rastreado pelo Git, ele vai para o remoto no próximo push.
 */
function verificarArquivoDoMcp(coleta: Coleta): PendenciaGit[] {
  if (!coleta.mcpRastreado) {
    return [];
  }

  return [
    criarPendencia(
      'mcp-rastreado',
      'erro',
      `O ${NOME_DO_ARQUIVO_MCP} está rastreado pelo Git: a senha do banco vai para o remoto no próximo push.`,
      `git rm --cached ${NOME_DO_ARQUIVO_MCP}`,
    ),
  ];
}

function verificarRemoto(coleta: Coleta, urlCadastrada: string): PendenciaGit[] {
  if (!coleta.urlDoRemoto) {
    return [
      criarPendencia(
        'sem-remoto',
        'erro',
        'O repositório local não tem remoto vinculado: nada do que está aqui existe fora desta máquina.',
        `git remote add origin ${urlCadastrada}`,
      ),
    ];
  }

  if (apontamParaOMesmoRepositorio(coleta.urlDoRemoto, urlCadastrada)) {
    return [];
  }

  return [
    criarPendencia(
      'remoto-divergente',
      'atencao',
      `O remoto aponta para ${mascararCredenciais(coleta.urlDoRemoto)}, diferente da URL cadastrada no HUB SNK.`,
    ),
  ];
}

function verificarAlteracoesLocais(coleta: Coleta): PendenciaGit[] {
  const pendencias: PendenciaGit[] = [];
  const { rastreadosAlterados, naoRastreados } = coleta.arvore;

  if (rastreadosAlterados > 0) {
    pendencias.push(
      criarPendencia(
        'alteracoes-nao-commitadas',
        'atencao',
        `${pluralizar(rastreadosAlterados, 'arquivo rastreado alterado', 'arquivos rastreados alterados')} e não commitado.`,
        'git status --short',
      ),
    );
  }

  if (naoRastreados > 0) {
    pendencias.push(
      criarPendencia(
        'nao-rastreados',
        'atencao',
        `${pluralizar(naoRastreados, 'arquivo novo', 'arquivos novos')} fora do controle de versão e fora do .gitignore.`,
        'git status --short',
      ),
    );
  }

  return pendencias;
}

/**
 * Commit feito e push esquecido: o trabalho existe só nesta máquina. Só é
 * checado com remoto configurado — sem ele, `verificarRemoto` já acusou o
 * problema maior, e repetir a mesma causa em duas pendências só polui o selo.
 */
function verificarSincronizacaoComRemoto(coleta: Coleta): PendenciaGit[] {
  const { branch, semCommits, temUpstream, commitsAFrente } = coleta.arvore;

  if (!coleta.urlDoRemoto || semCommits || branch === null) {
    return [];
  }

  if (!temUpstream) {
    return [
      criarPendencia(
        'sem-upstream',
        'atencao',
        `A branch ${branch} não tem upstream: os commits dela só existem nesta máquina.`,
        `git push -u origin ${branch}`,
      ),
    ];
  }

  if (commitsAFrente === 0) {
    return [];
  }

  return [
    criarPendencia(
      'commits-nao-enviados',
      'atencao',
      `${pluralizar(commitsAFrente, 'commit local ainda não enviado', 'commits locais ainda não enviados')} ao remoto.`,
      'git push',
    ),
  ];
}

function verificarStash(coleta: Coleta): PendenciaGit[] {
  if (coleta.itensNoStash === 0) {
    return [];
  }

  return [
    criarPendencia(
      'stash-pendente',
      'atencao',
      `${pluralizar(coleta.itensNoStash, 'alteração guardada', 'alterações guardadas')} no stash, fora de qualquer commit.`,
      'git stash list',
    ),
  ];
}

/* ----------------------------- montagem final ----------------------------- */

function diagnosticar(coleta: Coleta, urlCadastrada: string): PendenciaGit[] {
  const pendencias = [
    ...verificarOperacaoEmAndamento(coleta),
    ...verificarConflitos(coleta),
    ...verificarArquivoDoMcp(coleta),
    ...verificarRemoto(coleta, urlCadastrada),
    ...verificarAlteracoesLocais(coleta),
    ...verificarSincronizacaoComRemoto(coleta),
    ...verificarStash(coleta),
  ];

  if (!coleta.arvore.semCommits) {
    return pendencias;
  }

  return [
    criarPendencia('sem-commits', 'atencao', 'O repositório ainda não tem nenhum commit.'),
    ...pendencias,
  ];
}

function montarSituacao(
  branchAtual: string | null,
  urlDoRemoto: string | null,
  pendencias: PendenciaGit[],
): SituacaoGit {
  const ordenadas = [...pendencias].sort(
    (uma, outra) => ORDEM_DE_SEVERIDADE[uma.severidade] - ORDEM_DE_SEVERIDADE[outra.severidade],
  );

  const severidade = ordenadas[0]?.severidade ?? 'ok';

  return {
    severidade,
    branchAtual,
    provedor: urlDoRemoto ? detectarProvedor(urlDoRemoto) : null,
    pendencias: ordenadas,
    verificadoEm: new Date().toISOString(),
  };
}

/**
 * Diagnóstico de um repositório local.
 *
 * Não lança: pasta apagada, pasta que não é repositório e Git ausente são
 * respostas do diagnóstico, não falhas dele. Uma exceção aqui derrubaria a
 * leitura dos outros repositórios da lista.
 *
 * Só lê o disco — nenhuma chamada de rede, nenhum `fetch`.
 */
export async function lerSituacaoDoRepositorio({
  caminhoLocal,
  urlCadastrada,
}: DadosDoRepositorio): Promise<SituacaoGit> {
  try {
    /*
     * A pasta é conferida antes de chamar o Git porque `spawn` com diretório de
     * trabalho inexistente falha com o mesmo `ENOENT` de executável ausente — os
     * dois casos ficariam indistinguíveis.
     */
    if (!(await existe(caminhoLocal))) {
      return montarSituacao(null, urlCadastrada, [
        criarPendencia(
          'pasta-ausente',
          'erro',
          `A pasta ${caminhoLocal} não existe: o clone foi apagado ou movido.`,
          `git clone ${urlCadastrada} "${caminhoLocal}"`,
        ),
      ]);
    }

    const diretorio = await executarGit(caminhoLocal, ['rev-parse', '--absolute-git-dir']);

    if (!diretorio.sucesso) {
      return montarSituacao(null, urlCadastrada, [
        criarPendencia(
          'sem-repositorio',
          'erro',
          `A pasta ${caminhoLocal} existe, mas não é um repositório Git.`,
          `git clone ${urlCadastrada} "${caminhoLocal}"`,
        ),
      ]);
    }

    const coleta = await coletar(caminhoLocal, diretorio.saida.trim());

    // Sem remoto configurado, o provedor ainda pode ser deduzido do cadastro.
    return montarSituacao(
      coleta.arvore.branch,
      coleta.urlDoRemoto ?? urlCadastrada,
      diagnosticar(coleta, urlCadastrada),
    );
  } catch (erro) {
    const mensagem =
      erro instanceof GitIndisponivelError
        ? erro.message
        : `Não foi possível verificar o repositório: ${(erro as Error).message}`;

    return montarSituacao(null, null, [
      criarPendencia('verificacao-falhou', 'desconhecido', mensagem),
    ]);
  }
}
