/**
 * Token do GitLab que o Git AutoSync usa no Merge Request.
 *
 * O autosync lê `GIT_AUTOSYNC_GITLAB_TOKEN` do ambiente, e só o aceita quando
 * `GIT_AUTOSYNC_GITLAB_HOST` também está definida e casa com o host do remoto
 * (`resolve_gitlab_token` do autosync). Por isso os dois andam juntos.
 *
 * Ficam nas variáveis de ambiente do usuário, e não no `configuracao.json`: a pasta de
 * dados pode estar sincronizada com a nuvem, e é do ambiente que o autosync lê — na
 * bandeja, na tarefa agendada e no CLI. O token nunca volta pela API.
 */
import { spawn } from 'node:child_process';
import { GitAutosyncFalhouError, GitAutosyncUsoError } from './cliDoAutosync.ts';

export const VARIAVEL_DO_TOKEN = 'GIT_AUTOSYNC_GITLAB_TOKEN';
export const VARIAVEL_DO_HOST = 'GIT_AUTOSYNC_GITLAB_HOST';

/** Mesmo critério do `normalize_host` do autosync: host e porta, sem protocolo nem caminho. */
export const FORMATO_DO_HOST_DO_GITLAB = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/;

export interface VariaveisDeAmbienteDoUsuario {
  ler(nome: string): Promise<string | null>;
  /** `null` apaga a variável. */
  gravar(nome: string, valor: string | null): Promise<void>;
}

export interface SituacaoDoGitlab {
  host: string;
  tokenDefinido: boolean;
}

const TEMPO_LIMITE_MS = 20_000;

/*
 * O valor viaja numa variável de ambiente do processo filho, e não na linha de
 * comando: argumento de processo aparece para qualquer programa que liste processos.
 */
const VARIAVEL_DO_VALOR = 'HUB_VALOR_DA_VARIAVEL';

function executarPowershell(comando: string, valor?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const processo = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', comando],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...(valor === undefined ? {} : { [VARIAVEL_DO_VALOR]: valor }) },
      },
    );
    let saida = '';
    let erro = '';
    const prazo = setTimeout(() => processo.kill(), TEMPO_LIMITE_MS);

    processo.stdout?.on('data', (parte: Buffer) => (saida += parte.toString('utf8')));
    processo.stderr?.on('data', (parte: Buffer) => (erro += parte.toString('utf8')));
    processo.on('error', (falha) => {
      clearTimeout(prazo);
      reject(new GitAutosyncFalhouError(`Não foi possível abrir o PowerShell: ${falha.message}`));
    });
    processo.on('close', (codigo) => {
      clearTimeout(prazo);
      if (codigo === 0) {
        resolve(saida.trim());
      } else {
        reject(
          new GitAutosyncFalhouError(
            erro.trim() || `Não foi possível gravar a variável de ambiente (código ${codigo}).`,
          ),
        );
      }
    });
  });
}

/**
 * Variáveis do usuário no Windows (`HKCU\Environment`). `SetEnvironmentVariable` com
 * escopo `User` avisa o sistema da mudança: programas abertos depois já as recebem.
 *
 * Também atualiza o `process.env` do HUB SNK, que foi herdado na largada: sem isso o
 * Merge Request pela tela só enxergaria o token depois de reabrir o aplicativo.
 */
export class VariaveisDeAmbienteDoWindows implements VariaveisDeAmbienteDoUsuario {
  async ler(nome: string): Promise<string | null> {
    const valor = await executarPowershell(
      `[Environment]::GetEnvironmentVariable('${nome}', 'User')`,
    );
    return valor === '' ? null : valor;
  }

  async gravar(nome: string, valor: string | null): Promise<void> {
    await executarPowershell(
      valor === null
        ? `[Environment]::SetEnvironmentVariable('${nome}', $null, 'User')`
        : `[Environment]::SetEnvironmentVariable('${nome}', $env:${VARIAVEL_DO_VALOR}, 'User')`,
      valor ?? undefined,
    );

    if (valor === null) {
      delete process.env[nome];
    } else {
      process.env[nome] = valor;
    }
  }
}

/** Fora do Windows não há onde gravar para o autosync: o perfil do shell é da pessoa. */
export class VariaveisDeAmbienteIndisponiveis implements VariaveisDeAmbienteDoUsuario {
  async ler(nome: string): Promise<string | null> {
    return process.env[nome] ?? null;
  }

  async gravar(): Promise<void> {
    throw new GitAutosyncUsoError(
      `Fora do Windows, defina ${VARIAVEL_DO_TOKEN} e ${VARIAVEL_DO_HOST} no perfil do shell.`,
    );
  }
}

export function criarVariaveisDeAmbienteDoUsuario(): VariaveisDeAmbienteDoUsuario {
  return process.platform === 'win32'
    ? new VariaveisDeAmbienteDoWindows()
    : new VariaveisDeAmbienteIndisponiveis();
}

export async function lerSituacaoDoGitlab(
  variaveis: VariaveisDeAmbienteDoUsuario,
): Promise<SituacaoDoGitlab> {
  const [host, token] = await Promise.all([
    variaveis.ler(VARIAVEL_DO_HOST),
    variaveis.ler(VARIAVEL_DO_TOKEN),
  ]);
  return { host: host ?? '', tokenDefinido: Boolean(token) };
}

/**
 * Grava o host e, quando informado, o token. Token ausente mantém o que já está
 * gravado: o campo da tela fica vazio de propósito, e vazio não quer dizer apagar.
 */
export async function definirGitlab(
  variaveis: VariaveisDeAmbienteDoUsuario,
  host: string,
  token?: string,
): Promise<SituacaoDoGitlab> {
  if (token === undefined && !(await variaveis.ler(VARIAVEL_DO_TOKEN))) {
    throw new GitAutosyncUsoError('Informe o token do GitLab.');
  }

  await variaveis.gravar(VARIAVEL_DO_HOST, host);
  if (token !== undefined) {
    await variaveis.gravar(VARIAVEL_DO_TOKEN, token);
  }
  return lerSituacaoDoGitlab(variaveis);
}

/** O host fica: sozinho ele não dá acesso a nada, e poupa digitar de novo. */
export async function removerTokenDoGitlab(
  variaveis: VariaveisDeAmbienteDoUsuario,
): Promise<SituacaoDoGitlab> {
  await variaveis.gravar(VARIAVEL_DO_TOKEN, null);
  return lerSituacaoDoGitlab(variaveis);
}
