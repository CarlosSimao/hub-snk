/**
 * Executa o Git AutoSync instalado na máquina.
 *
 * ## Por que nunca o `.bat`
 *
 * A instalação com Python deixa em `bin` um launcher de duas linhas:
 *
 *     @echo off
 *     "<...>\venv\Scripts\python.exe" "<...>\python\app.py" %*
 *
 * Chamá-lo passaria pelo `cmd.exe`, que reinterpreta `&`, `|`, `^` e `%` dentro de
 * argumentos já entre aspas. Como o caminho do repositório vem da tela, isso o
 * transformaria em vetor de execução de comando (família BatBadBut, CVE-2024-24576).
 * O launcher é lido só para achar o `python.exe` e o `app.py`, e esses são chamados
 * direto, com os argumentos em lista. A instalação standalone (a que o instalador do
 * HUB SNK distribui) já é um binário de verdade e dispensa isso.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GitAutosyncFalhouError,
  GitAutosyncNaoInstaladoError,
  PacoteDoAutosyncAusenteError,
  type CliDoAutosync,
  type ResultadoDoCli,
} from './cliDoAutosync.ts';
import { registrarDesinstalacaoJuntoDoHub } from './desinstalacaoJuntoDoHub.ts';
import type { PacoteBaixado } from './pacoteDoGithub.ts';
import type {
  ConfiguracaoDoAutosync,
  OpcoesDeInstalacao,
  StatusDoAutosync,
  TarefaDoAgendador,
} from './tiposDoAutosync.ts';

/** Um `sync` num repositório grande passa longe de qualquer tempo de consulta. */
const TEMPO_LIMITE_DO_CLI_MS = 180_000;
const TEMPO_LIMITE_DO_AGENDADOR_MS = 20_000;
/** A instalação copia binários e cria a tarefa; o Defender escaneando o `.exe` atrasa. */
const TEMPO_LIMITE_DA_INSTALACAO_MS = 300_000;

/** `git --version` é instantâneo; o prazo só cobre um PATH com unidade de rede lenta. */
const TEMPO_LIMITE_DO_GIT_MS = 15_000;

const ARQUIVO_DO_INSTALADOR = 'install-standalone.ps1';

export interface CliResolvido {
  /** Executável chamado direto, sem shell. */
  comando: string;
  /** Argumentos que vêm antes dos do usuário: o `app.py`, só na instalação com venv. */
  prefixo: string[];
  modo: 'standalone' | 'venv';
}

/**
 * Onde está o CLI, ou `null` quando não está instalado.
 *
 * Standalone primeiro: numa máquina que tem os dois (instalou com Python antes,
 * recebeu o instalador depois), o binário é o que o instalador mantém atualizado.
 */
export function resolverCli(
  pastaBin: string,
  plataforma: NodeJS.Platform = process.platform,
  existe: (caminho: string) => boolean = existsSync,
  lerTexto: (caminho: string) => string | null = lerTextoOuNulo,
): CliResolvido | null {
  const standalone = join(pastaBin, plataforma === 'win32' ? 'git-autosync.exe' : 'git-autosync');
  if (existe(standalone)) {
    return { comando: standalone, prefixo: [], modo: 'standalone' };
  }

  const launcher = join(pastaBin, 'git-autosync.bat');
  const conteudo = existe(launcher) ? lerTexto(launcher) : null;
  if (conteudo === null) {
    return null;
  }

  for (const linha of conteudo.split(/\r?\n/)) {
    const casou = /^\s*"([^"]+\.exe)"\s+"([^"]+\.py)"/.exec(linha);
    const python = casou?.[1];
    const app = casou?.[2];
    if (python && app && existe(python) && existe(app)) {
      return { comando: python, prefixo: [app], modo: 'venv' };
    }
  }

  return null;
}

function lerTextoOuNulo(caminho: string): string | null {
  try {
    return readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Roda um processo com os argumentos em lista e devolve código e saída.
 *
 * Nunca por um shell: é o que mantém literal um caminho com `& | ^ %` e espaços.
 * Estourou o prazo, o processo é morto e a saída vira o aviso de tempo.
 */
export function executarProcesso(
  comando: string,
  argumentos: readonly string[],
  tempoLimiteMs: number,
  ambiente: NodeJS.ProcessEnv,
): Promise<ResultadoDoCli> {
  return new Promise((resolve) => {
    const processo = spawn(comando, [...argumentos], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: ambiente,
    });
    let saida = '';
    let expirou = false;

    const prazo = setTimeout(() => {
      expirou = true;
      processo.kill();
    }, tempoLimiteMs);

    processo.stdout?.on('data', (parte: Buffer) => (saida += parte.toString('utf8')));
    processo.stderr?.on('data', (parte: Buffer) => (saida += parte.toString('utf8')));

    processo.on('error', (erro) => {
      clearTimeout(prazo);
      resolve({ codigo: -1, saida: erro.message });
    });
    processo.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve(
        expirou
          ? {
              codigo: -1,
              saida: `o git-autosync passou de ${Math.round(tempoLimiteMs / 1000)}s e foi encerrado`,
            }
          : { codigo: codigo ?? -1, saida },
      );
    });
  });
}

/*
 * Lido do Agendador, e não do `doctor`: o doctor percorre todos os repositórios e leva
 * segundos; a tela só precisa saber se a tarefa existe e quando roda.
 *
 * `@(...)` em vez de `-AsArray`, que não existe no `powershell.exe` 5.1. `[long]` e não
 * `[int]` no resultado: o Agendador devolve HRESULT sem sinal (2147946720, por exemplo),
 * que estoura Int32 e derruba o comando inteiro.
 */
const CONSULTA_DAS_TAREFAS =
  "@(Get-ScheduledTask | Where-Object { $_.TaskName -like 'GitAutoSync*' } | ForEach-Object { " +
  '$i = $null; try { $i = $_ | Get-ScheduledTaskInfo -ErrorAction Stop } catch {}; ' +
  '[pscustomobject]@{ nome = [string]$_.TaskName; estado = [string]$_.State; ' +
  "proximaExecucao = if ($i -and $i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }; " +
  "ultimaExecucao = if ($i -and $i.LastRunTime) { $i.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }; " +
  'ultimoResultado = if ($i) { [long]$i.LastTaskResult } else { $null } } }) | ConvertTo-Json -Compress';

const ARGUMENTOS_DO_POWERSHELL = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

export interface OpcoesDoCliDoAutosyncProcesso {
  /** `GIT_AUTOSYNC_HOME`, ou `~/.git-autosync`. */
  pasta: string;
  /**
   * Pasta com um pacote já extraído (`HUB_AUTOSYNC_PACOTE`), para testar um build do
   * autosync antes de publicá-lo. `null` é o normal: o pacote vem da Release.
   */
  pacote: string | null;
  /** Baixa e extrai o pacote da Release. Sem ele, só o `pacote` local serve. */
  baixarPacote?: () => Promise<PacoteBaixado>;
  /**
   * `%LOCALAPPDATA%\HubSnk` do app instalado, onde fica o que a desinstalação do HUB SNK
   * usa para remover o Git AutoSync junto. `null` em desenvolvimento: nada é registrado.
   */
  pastaDoInstalador?: string | null;
  plataforma?: NodeJS.Platform;
}

export class CliDoAutosyncProcesso implements CliDoAutosync {
  readonly #pasta: string;
  readonly #pacote: string | null;
  readonly #baixarPacote: (() => Promise<PacoteBaixado>) | null;
  readonly #pastaDoInstalador: string | null;
  readonly #plataforma: NodeJS.Platform;

  constructor(opcoes: OpcoesDoCliDoAutosyncProcesso) {
    this.#pasta = opcoes.pasta;
    this.#pacote = opcoes.pacote;
    this.#baixarPacote = opcoes.baixarPacote ?? null;
    this.#pastaDoInstalador = opcoes.pastaDoInstalador ?? null;
    this.#plataforma = opcoes.plataforma ?? process.platform;
  }

  get #pastaBin(): string {
    return join(this.#pasta, 'bin');
  }

  /*
   * `PYTHONIOENCODING`: sem ele, um autosync antigo escreve no code page do console e
   * estoura com "'charmap' codec" ao achar emoji numa mensagem de commit. O novo já
   * força UTF-8, mas a máquina pode ter o antigo.
   *
   * `GIT_AUTOSYNC_HOME` repassado explicitamente: o CLI e o HUB SNK precisam olhar a
   * mesma pasta, mesmo quando ela veio de outra origem que não o ambiente.
   */
  get #ambiente(): NodeJS.ProcessEnv {
    return { ...process.env, PYTHONIOENCODING: 'utf-8', GIT_AUTOSYNC_HOME: this.#pasta };
  }

  instalado(): boolean {
    return resolverCli(this.#pastaBin, this.#plataforma) !== null;
  }

  async versao(): Promise<string | null> {
    try {
      const texto = (await readFile(join(this.#pastaBin, 'VERSION'), 'utf8')).trim();
      return texto === '' ? null : texto;
    } catch {
      return null;
    }
  }

  async executar(
    argumentos: readonly string[],
    tempoLimiteMs = TEMPO_LIMITE_DO_CLI_MS,
  ): Promise<ResultadoDoCli> {
    const cli = resolverCli(this.#pastaBin, this.#plataforma);
    if (!cli) {
      throw new GitAutosyncNaoInstaladoError();
    }

    return executarProcesso(
      cli.comando,
      [...cli.prefixo, ...argumentos],
      tempoLimiteMs,
      this.#ambiente,
    );
  }

  lerConfiguracao(): Promise<ConfiguracaoDoAutosync | null> {
    return this.#lerJson<ConfiguracaoDoAutosync>('config.json');
  }

  lerStatus(): Promise<StatusDoAutosync | null> {
    return this.#lerJson<StatusDoAutosync>('status.json');
  }

  async lerLog(limite: number): Promise<string[]> {
    let texto: string;
    try {
      texto = await readFile(join(this.#pasta, 'autosync.log'), 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new GitAutosyncFalhouError(`autosync.log ilegível: ${(erro as Error).message}`);
    }

    const linhas = texto.split(/\r?\n/);
    /* A última linha vazia é o `\n` final, não um evento. */
    if (linhas.at(-1) === '') {
      linhas.pop();
    }
    return linhas.slice(-limite);
  }

  /**
   * Melhor esforço: sem o Agendador legível a tela perde o aviso de "tarefa não
   * instalada", mas o resto continua inteiro. Por isso falha vira lista vazia.
   */
  async listarTarefas(): Promise<TarefaDoAgendador[]> {
    return this.#plataforma === 'win32' ? this.#tarefasDoAgendador() : this.#tarefasDoCron();
  }

  async instalarPacote(opcoes: OpcoesDeInstalacao): Promise<ResultadoDoCli> {
    if (this.#plataforma !== 'win32') {
      throw new PacoteDoAutosyncAusenteError(
        'A instalação pelo HUB SNK é só para Windows. Instale o Git AutoSync pelo repositório dele.',
      );
    }

    const pacote = await this.#obterPacote();
    try {
      const argumentos = [
        ...ARGUMENTOS_DO_POWERSHELL,
        '-File',
        join(pacote.pasta, ARQUIVO_DO_INSTALADOR),
        '-Source',
        pacote.pasta,
      ];
      if (opcoes.horario) argumentos.push('-TaskTime', opcoes.horario);
      if (opcoes.bandeja) argumentos.push('-EnableTray');
      if (opcoes.atalhos) argumentos.push('-Shortcut');
      if (opcoes.skills) argumentos.push('-Skills');
      if (opcoes.path) argumentos.push('-AddToPath');

      const resultado = await executarProcesso(
        'powershell.exe',
        argumentos,
        TEMPO_LIMITE_DA_INSTALACAO_MS,
        this.#ambiente,
      );
      if (resultado.codigo === 0 && this.#pastaDoInstalador) {
        /* Melhor esforço: sem o registro, o autosync funciona; só não sai junto do Hub. */
        await registrarDesinstalacaoJuntoDoHub(
          this.#pastaDoInstalador,
          pacote.pasta,
          pacote.versao,
        ).catch(() => {});
      }
      return resultado;
    } finally {
      await pacote.descartar();
    }
  }

  async versaoDoGit(): Promise<string | null> {
    const resultado = await executarProcesso(
      'git',
      ['--version'],
      TEMPO_LIMITE_DO_GIT_MS,
      process.env,
    );
    return resultado.codigo === 0 ? resultado.saida.trim() : null;
  }

  /* O pacote local, quando apontado, vence a Release: é o build que se quer testar. */
  async #obterPacote(): Promise<PacoteBaixado> {
    if (this.#pacote && existsSync(join(this.#pacote, ARQUIVO_DO_INSTALADOR))) {
      return { pasta: this.#pacote, versao: null, descartar: async () => {} };
    }
    if (!this.#baixarPacote) {
      throw new PacoteDoAutosyncAusenteError();
    }
    return this.#baixarPacote();
  }

  async #lerJson<T>(nome: string): Promise<T | null> {
    let texto: string;
    try {
      texto = await readFile(join(this.#pasta, nome), 'utf8');
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new GitAutosyncFalhouError(`${nome} ilegível: ${(erro as Error).message}`);
    }

    try {
      /* O `atomic_json` do Python grava sem BOM, mas quem editou à mão pode ter posto um. */
      return JSON.parse(texto.replace(/^﻿/, '')) as T;
    } catch (erro) {
      throw new GitAutosyncFalhouError(`${nome} ilegível: ${(erro as Error).message}`);
    }
  }

  async #tarefasDoAgendador(): Promise<TarefaDoAgendador[]> {
    const { codigo, saida } = await executarProcesso(
      'powershell.exe',
      [...ARGUMENTOS_DO_POWERSHELL, '-Command', CONSULTA_DAS_TAREFAS],
      TEMPO_LIMITE_DO_AGENDADOR_MS,
      process.env,
    );
    if (codigo !== 0 || saida.trim() === '') {
      return [];
    }

    try {
      const bruto = JSON.parse(saida) as unknown;
      return (Array.isArray(bruto) ? bruto : [bruto]) as TarefaDoAgendador[];
    } catch {
      return [];
    }
  }

  /*
   * O autosync marca as linhas dele com `# git-autosync`. O cron não guarda histórico
   * de execução: última execução e resultado ficam vazios, e quem sabe é o log.
   */
  async #tarefasDoCron(): Promise<TarefaDoAgendador[]> {
    const { codigo, saida } = await executarProcesso(
      'crontab',
      ['-l'],
      TEMPO_LIMITE_DO_AGENDADOR_MS,
      process.env,
    );
    /* Código diferente de zero é o normal de quem não tem crontab nenhum. */
    if (codigo !== 0) {
      return [];
    }

    return saida
      .split(/\r?\n/)
      .filter((linha) => linha.trim().endsWith('# git-autosync'))
      .map((linha, indice) => {
        const [minuto = '', hora = ''] = linha.trim().split(/\s+/);
        const horario =
          /^\d+$/.test(minuto) && /^\d+$/.test(hora)
            ? `${hora.padStart(2, '0')}:${minuto.padStart(2, '0')}`
            : '';
        return {
          nome: `cron ${indice + 1}`,
          estado: 'Ready',
          proximaExecucao: horario ? `todo dia ${horario}` : '',
          ultimaExecucao: '',
          ultimoResultado: null,
        };
      });
  }
}
