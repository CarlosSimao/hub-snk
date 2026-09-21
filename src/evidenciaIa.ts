/**
 * Resumo de entrega gerado por agente de IA local — Fase 3 da migracao "sem Docker".
 *
 * Substitui `POST /ia/evidencia` do `hub-helper.ps1`. O desenho de seguranca e' o mesmo
 * do git-autosync ao gerar mensagem de commit, e as duas partes dele importam:
 *
 *  1. **O diff vai EMBUTIDO no prompt**, nunca "va ler o repositorio sozinho". O agente
 *     recebe texto, nao acesso.
 *  2. **O agente roda com `cwd` num diretorio temporario VAZIO**, nunca no repositorio
 *     de verdade — e com as ferramentas de arquivo/comando desligadas, quando o agente
 *     as tem.
 *
 * Nada disso protege contra um agente malicioso; protege contra o agente fazer besteira
 * com o repositorio ao tentar "ajudar", que e' o risco real.
 *
 * O commit e o diff nunca saem da maquina: so' o texto final volta para o hub.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

export type AgenteIa = 'auto' | 'claude' | 'codex' | 'opencode';

/** Mesma ordem de preferencia do git-autosync. */
const AGENTES: Exclude<AgenteIa, 'auto'>[] = ['claude', 'codex', 'opencode'];

/** Nome do agente OpenCode sem write/edit/bash/webfetch, criado por nos. */
const AGENTE_OPENCODE_SEGURO = 'hub-somente-leitura';

/**
 * Mesmo limite de `_generate_commit_message` no git-autosync: diff maior que isso
 * estoura o que os agentes locais aceitam bem de entrada.
 */
const LIMITE_DIFF = 12_000;
const TIMEOUT_AGENTE_MS = 120_000;
const TIMEOUT_GIT_MS = 30_000;

const DATA_VALIDA = /^\d{4}-\d{2}-\d{2}$/;

export class EvidenciaUsoError extends Error {}
export class EvidenciaFalhouError extends Error {}

interface Execucao {
  ok: boolean;
  saida: string;
}

/** Roda um processo com o prompt pelo stdin. Sem `shell` em lugar nenhum. */
function executar(
  executavel: string,
  args: string[],
  opcoes: { cwd: string; entrada?: string; timeoutMs: number },
): Promise<Execucao> {
  return new Promise((resolve) => {
    const processo = spawn(executavel, args, {
      cwd: opcoes.cwd,
      windowsHide: true,
      stdio: [opcoes.entrada === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    });

    let saida = '';
    let erro = '';
    let expirou = false;
    const prazo = setTimeout(() => {
      expirou = true;
      processo.kill();
    }, opcoes.timeoutMs);

    processo.stdout?.on('data', (p: Buffer) => (saida += p.toString('utf8')));
    processo.stderr?.on('data', (p: Buffer) => (erro += p.toString('utf8')));
    processo.on('error', () => {
      clearTimeout(prazo);
      resolve({ ok: false, saida: '' });
    });
    processo.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ ok: !expirou && codigo === 0, saida: saida || erro });
    });

    if (opcoes.entrada !== undefined && processo.stdin) {
      processo.stdin.end(opcoes.entrada, 'utf8');
    }
  });
}

/** Procura um executavel no PATH, testando as extensoes do Windows. */
function noPath(nome: string, extensoes = ['.exe', '.cmd', '.ps1', '']): string {
  for (const pasta of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!pasta) continue;
    for (const extensao of extensoes) {
      try {
        const alvo = join(pasta, nome + extensao);
        if (existsSync(alvo)) return alvo;
      } catch {
        // Entrada inválida no PATH.
      }
    }
  }
  return '';
}

function gitExe(): string {
  return noPath('git', ['.exe', '']);
}

/**
 * Qual agente vai rodar: o pedido (se instalado) ou o primeiro disponivel.
 *
 * `claude` costuma ser EXE de verdade; `codex` e `opencode` instalam como shim npm
 * (`.cmd`/`.ps1`), e para esses o que vale e' o entry point real — ver `#resolver`.
 */
export function resolverAgente(preferido: AgenteIa): Exclude<AgenteIa, 'auto'> | null {
  if (preferido && preferido !== 'auto') {
    return noPath(preferido) ? preferido : null;
  }
  return AGENTES.find((nome) => noPath(nome)) ?? null;
}

export function construirPrompt(log: string, diff: string): string {
  return (
    'Voce e uma agente deterministica e impessoal, especialista em analisar historico ' +
    'de codigo, responsavel por resumir para um CLIENTE NAO TECNICO o que foi entregue ' +
    'num periodo, a partir do log de commits e do diff abaixo. Nunca se refere a si ' +
    'mesma nem ao usuario, nunca opina sobre arquitetura ou qualidade de codigo fora ' +
    'do escopo. Responda somente em portugues do Brasil, em texto plano puro (sem ' +
    'markdown, sem crases, sem titulos, sem lista com marcadores).\n\n' +
    'Escreva de 1 a 3 paragrafos corridos descrevendo o que foi entregue, em ' +
    'linguagem de negocio (o que mudou para quem usa o sistema), sem jargao tecnico ' +
    "de git — nao mencione nome de arquivo, hash de commit nem termos como " +
    "'refactor'/'diff'/'commit'. Nao inclua nada alem do resumo (sem preambulo, sem " +
    `saudacao, sem assinatura).\n\ncommits:\n${log}\n\ndiff:\n${diff}`
  );
}

/**
 * Garante, so' por complemento (merge, nunca sobrescrevendo o resto do arquivo), um
 * agente OpenCode sem write/edit/bash/webfetch: gerar texto a partir de um prompt nao
 * deveria nunca poder mexer em arquivo ou rodar comando.
 */
function garantirAgenteOpencodeSeguro(): void {
  const arquivo = join(homedir(), '.config', 'opencode', 'opencode.json');
  try {
    mkdirSync(dirname(arquivo), { recursive: true });

    let dados: Record<string, unknown> = {};
    if (existsSync(arquivo)) {
      try {
        dados = JSON.parse(readFileSync(arquivo, 'utf8')) as Record<string, unknown>;
      } catch {
        dados = {};
      }
    }

    const agentes = (dados['agent'] ?? {}) as Record<string, unknown>;
    if (agentes[AGENTE_OPENCODE_SEGURO]) return;

    agentes[AGENTE_OPENCODE_SEGURO] = {
      description:
        'Gera texto a partir de um prompt, sem tocar em arquivos nem rodar comandos (usado pelo sankhya-hub).',
      permission: { write: 'deny', edit: 'deny', bash: 'deny', webfetch: 'deny' },
    };
    dados['agent'] = agentes;
    writeFileSync(arquivo, JSON.stringify(dados, null, 2), 'utf8');
  } catch {
    // Config do OpenCode e' conveniencia: sem ela o agente roda com o perfil padrao.
  }
}

async function rodarClaude(prompt: string, cwd: string): Promise<string> {
  const exe = noPath('claude', ['.exe', '']);
  if (!exe) return '';

  const { ok, saida } = await executar(
    exe,
    // Ferramentas desligadas: o agente aqui só escreve texto.
    ['-p', '--output-format', 'text', '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch'],
    { cwd, entrada: prompt, timeoutMs: TIMEOUT_AGENTE_MS },
  );
  return ok ? saida.trim() : '';
}

/**
 * `codex` no Windows instala como shim (`.cmd`/`.ps1`), nunca EXE: o shim so' encaminha
 * para `node_modules/@openai/codex/bin/codex.js`, rodado com `node.exe`. Chamar isso
 * direto evita reproduzir cmd.exe por cima do shim — mesmo principio do git-autosync.
 * A saida vem de arquivo (`-o`), nao do stdout.
 */
async function rodarCodex(prompt: string, cwd: string): Promise<string> {
  const shim = noPath('codex');
  const node = noPath('node', ['.exe', '']);
  if (!shim || !node) return '';

  const entrada = join(dirname(shim), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (!existsSync(entrada)) return '';

  const arquivoSaida = join(cwd, 'saida-codex.txt');
  await executar(
    node,
    [entrada, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', cwd, '-o', arquivoSaida, '-'],
    { cwd, entrada: prompt, timeoutMs: TIMEOUT_AGENTE_MS },
  );

  if (!existsSync(arquivoSaida)) return '';
  try {
    return readFileSync(arquivoSaida, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * `opencode` tambem instala como shim, mas o binario real e' um EXE proprio em
 * `node_modules/opencode-ai/bin/opencode.exe`, sem precisar de `node.exe` por cima.
 * A saida e' um evento JSON por linha; o texto e' o ultimo evento `type: 'text'`.
 */
async function rodarOpencode(prompt: string, cwd: string): Promise<string> {
  const shim = noPath('opencode');
  if (!shim) return '';

  garantirAgenteOpencodeSeguro();

  const real = join(dirname(shim), 'node_modules', 'opencode-ai', 'bin', 'opencode.exe');
  const exe = existsSync(real) ? real : shim;

  const { ok, saida } = await executar(
    exe,
    ['run', '--dir', cwd, '--agent', AGENTE_OPENCODE_SEGURO, '--format', 'json'],
    { cwd, entrada: prompt, timeoutMs: TIMEOUT_AGENTE_MS },
  );
  if (!ok) return '';

  let texto = '';
  for (const linha of saida.split(/\r?\n/)) {
    if (!linha.trim()) continue;
    try {
      const evento = JSON.parse(linha) as { type?: string; part?: { text?: string } };
      if (evento.type === 'text' && evento.part?.text) texto = evento.part.text;
    } catch {
      // Linha de progresso, não evento JSON.
    }
  }
  return texto.trim();
}

export class EvidenciaIa {
  /** Resumo do que foi feito no repositorio, no periodo, para um cliente nao tecnico. */
  async gerar(caminho: string, desde: string, ate: string, agentePreferido: AgenteIa): Promise<string> {
    if (!caminho || !existsSync(join(caminho, '.git'))) {
      throw new EvidenciaUsoError('caminho inválido — não é um repositório git');
    }
    if (!DATA_VALIDA.test(desde) || !DATA_VALIDA.test(ate)) {
      throw new EvidenciaUsoError('envie { desde, ate } em YYYY-MM-DD');
    }

    const git = gitExe();
    if (!git) throw new EvidenciaFalhouError('git não encontrado nesta máquina');

    const janela = [`--since=${desde} 00:00:00`, `--until=${ate} 23:59:59`];
    const log = (
      await executar(git, ['-C', caminho, 'log', ...janela, '--format=%h %ad %s', '--date=short'], {
        cwd: caminho,
        timeoutMs: TIMEOUT_GIT_MS,
      })
    ).saida.trim();

    if (!log) throw new EvidenciaUsoError('nenhum commit no período informado');

    let diff = (
      await executar(
        git,
        ['-C', caminho, 'log', ...janela, '-p', '--no-color', '--no-ext-diff', '--no-textconv'],
        { cwd: caminho, timeoutMs: TIMEOUT_GIT_MS },
      )
    ).saida;
    if (diff.length > LIMITE_DIFF) diff = `${diff.slice(0, LIMITE_DIFF)}\n...(diff truncado)...`;

    const agente = resolverAgente(agentePreferido);
    if (!agente) {
      throw new EvidenciaFalhouError(
        'nenhum agente de IA (claude/codex/opencode) disponível nesta máquina',
      );
    }

    // Diretorio isolado e vazio: o prompt ja' tem o diff embutido, o agente nunca precisa
    // (nem deveria poder) olhar o repositorio de verdade.
    const isolado = mkdtempSync(join(tmpdir(), 'hub-ia-'));
    try {
      const prompt = construirPrompt(log, diff);
      const texto =
        agente === 'claude'
          ? await rodarClaude(prompt, isolado)
          : agente === 'codex'
            ? await rodarCodex(prompt, isolado)
            : await rodarOpencode(prompt, isolado);

      if (!texto) throw new EvidenciaFalhouError(`agente '${agente}' não retornou texto`);
      return texto;
    } finally {
      rmSync(isolado, { recursive: true, force: true });
    }
  }
}
