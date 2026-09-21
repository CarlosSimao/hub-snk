/**
 * Executa o git-autosync direto, sem o `hub-helper.ps1` — Fase 3 da migracao "sem
 * Docker".
 *
 * Implementa a MESMA assinatura do `HubHelper.requisitar`, e por isso o
 * `src/gitAutosync.ts` nao muda nem uma linha: ele so' recebe outro transporte. As rotas
 * roteadas aqui sao as mesmas que o helper atendia em `/git-autosync/*`.
 *
 * ## Duas instalacoes possiveis, e por que nunca chamamos o `.bat`
 *
 * A instalacao com Python na maquina deixa um launcher `git-autosync.bat` de duas
 * linhas:
 *
 *     @echo off
 *     "<...>\venv\Scripts\python.exe" "<...>\python\app.py" %*
 *
 * A instalacao standalone (PyInstaller, a que o instalador da Fase 4 distribui) nao tem
 * `.bat` nenhum: deixa `git-autosync.exe` na mesma pasta `bin`. Sao os dois formatos que
 * `resolverCli` entende, standalone primeiro — sem isso o hub nao acharia o autosync
 * justamente na maquina que o recebeu pelo instalador.
 *
 * Chamar o `.bat` passaria pelo `cmd.exe`, que reinterpreta `&`, `|`, `^` e `%` DENTRO
 * dos argumentos ja' entre aspas. Como o caminho do repositorio vem do painel, isso
 * transformaria esse caminho num vetor de execucao de comando arbitrario (a familia
 * BatBadBut, CVE-2024-24576). Resolvendo o `python.exe` (ou o `.exe` standalone, que e'
 * um binario de verdade) e chamando-o com array de argumentos, nenhum shell entra no
 * caminho. E' a mesma decisao que o helper tomou, pelo mesmo motivo — ver o comentario
 * de `Resolver-GitAutosync` no `hub-helper.ps1`.
 */
import { spawn } from 'node:child_process';
import { Ferramentas, PedidoFerramentaError } from './ferramentas.ts';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const PASTA_AUTOSYNC = join(homedir(), '.git-autosync');
const PASTA_BIN = join(PASTA_AUTOSYNC, 'bin');
const LAUNCHER = join(PASTA_BIN, 'git-autosync.bat');
/** Instalacao standalone: o mesmo binario serve de interface e de CLI. */
const EXECUTAVEL_STANDALONE = process.platform === 'win32' ? 'git-autosync.exe' : 'git-autosync';
const ARQUIVO_CONFIG = join(PASTA_AUTOSYNC, 'config.json');
const ARQUIVO_LOG = join(PASTA_AUTOSYNC, 'autosync.log');

/** Um `sync` num repositorio grande passa longe de qualquer timeout de consulta. */
const TIMEOUT_CLI_MS = 180_000;
const TIMEOUT_AGENDADOR_MS = 20_000;

const AGENTES_VALIDOS = ['auto', 'claude', 'codex', 'opencode'];
const HORARIO_VALIDO = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** Erro de uso — vira 4xx, nao "helper indisponivel". */
export class GitAutosyncUsoError extends Error {}
/** O CLI rodou e falhou, ou nem esta' instalado. */
export class GitAutosyncFalhouError extends Error {}

interface SaidaProcesso {
  codigo: number;
  saida: string;
}

function executar(comando: string, args: string[], timeoutMs: number): Promise<SaidaProcesso> {
  return new Promise((resolve) => {
    // Sem `shell: true` em lugar nenhum: e' o que mantem os argumentos literais.
    const processo = spawn(comando, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // Sem isto, o Python do venv escreve a saida no code page do console (cp1252 por
      // aqui) e ESTOURA ao encontrar emoji — o `status --json` do git-autosync tem
      // emoji em mensagem de commit, e a rota inteira falhava com
      // "'charmap' codec can't encode character". O helper define a mesma variavel,
      // pelo mesmo motivo.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    let saida = '';
    let expirou = false;

    const prazo = setTimeout(() => {
      expirou = true;
      processo.kill();
    }, timeoutMs);

    // stdout e stderr juntos: o git escreve bastante em stderr sem que seja erro, e o
    // motivo real de uma falha de push costuma sair por la'.
    processo.stdout?.on('data', (p: Buffer) => (saida += p.toString('utf8')));
    processo.stderr?.on('data', (p: Buffer) => (saida += p.toString('utf8')));

    processo.on('error', (err) => {
      clearTimeout(prazo);
      resolve({ codigo: -1, saida: err.message });
    });
    processo.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({
        codigo: expirou ? -1 : (codigo ?? -1),
        saida: expirou ? `o git-autosync passou de ${Math.round(timeoutMs / 1000)}s e foi encerrado` : saida,
      });
    });
  });
}

export interface CliResolvido {
  /** Executavel chamado direto, sem shell. */
  comando: string;
  /** Argumentos que vem ANTES dos do usuario — o `app.py`, so' na instalacao com venv. */
  prefixo: string[];
  modo: 'standalone' | 'venv';
}

/**
 * Onde esta' o git-autosync, ou `null` quando nao esta' instalado.
 *
 * A ordem e' standalone e depois launcher: numa maquina que tem os dois (instalou com
 * Python antes, recebeu o instalador depois), o binario e' o que o instalador atualiza.
 * O parametro continua sendo o caminho do `.bat` porque e' o que os testes e o
 * construtor passam; a pasta dele e' onde o `.exe` e' procurado.
 */
export function resolverCli(launcher = LAUNCHER): CliResolvido | null {
  const standalone = join(dirname(launcher), EXECUTAVEL_STANDALONE);
  if (existsSync(standalone)) return { comando: standalone, prefixo: [], modo: 'standalone' };

  if (!existsSync(launcher)) return null;

  for (const linha of readFileSync(launcher, 'utf8').split(/\r?\n/)) {
    const casou = /^\s*"([^"]+\.exe)"\s+"([^"]+\.py)"/.exec(linha);
    if (!casou) continue;
    const [, python, app] = casou as unknown as [string, string, string];
    if (existsSync(python) && existsSync(app)) return { comando: python, prefixo: [app], modo: 'venv' };
  }
  return null;
}

export class GitAutosyncCli {
  readonly #launcher: string;
  readonly #ferramentas: Ferramentas;

  constructor(launcher = LAUNCHER, ferramentas = new Ferramentas()) {
    this.#launcher = launcher;
    this.#ferramentas = ferramentas;
  }

  get instalado(): boolean {
    return resolverCli(this.#launcher) !== null;
  }

  async #cli(args: string[]): Promise<string> {
    const resolvido = resolverCli(this.#launcher);
    if (!resolvido) throw new GitAutosyncFalhouError('git-autosync não encontrado nesta máquina');

    const { codigo, saida } = await executar(resolvido.comando, [...resolvido.prefixo, ...args], TIMEOUT_CLI_MS);
    if (codigo !== 0) throw new GitAutosyncFalhouError(saida.trim() || `git-autosync saiu com código ${codigo}`);
    return saida;
  }

  async #cliJson<T>(args: string[]): Promise<T> {
    const saida = await this.#cli(args);
    try {
      return JSON.parse(saida) as T;
    } catch {
      throw new GitAutosyncFalhouError('saída do git-autosync não é JSON');
    }
  }

  /**
   * O agendamento que o sistema realmente tem.
   *
   * No Linux o autosync agenda por crontab (ver `scheduler.py` do git-autosync, que
   * marca as linhas dele com o comentario `# git-autosync`), e nao existe Agendador de
   * Tarefas para consultar. Cada linha marcada vira uma entrada com o mesmo formato que
   * a tela ja' desenha, com o horario do cron no lugar do "proxima execucao" — o cron
   * nao guarda historico de execucao, entao ultima execucao e resultado ficam vazios, e
   * quem sabe disso e' o `autosync.log`.
   */
  async #tarefas(): Promise<unknown[]> {
    if (process.platform !== 'win32') return this.#tarefasCron();

    const saida = await executar(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        // Lido do Agendador, e nao do `doctor`: o doctor percorre todos os repositorios
        // (git remote, branch) e leva segundos; a tela so' precisa saber se a tarefa
        // existe e quando roda de novo.
        // `@(...)` em vez de `-AsArray`: este e' o `powershell.exe` 5.1, onde essa flag
        // nao existe — com ela o comando falha inteiro e a lista de tarefas volta vazia,
        // como se nao houvesse agendamento nenhum.
        "@(Get-ScheduledTask | Where-Object { $_.TaskName -like 'GitAutoSync*' } | ForEach-Object { " +
          '$i = $null; try { $i = $_ | Get-ScheduledTaskInfo -ErrorAction Stop } catch {}; ' +
          '[pscustomobject]@{ nome = [string]$_.TaskName; estado = [string]$_.State; ' +
          "proximaExecucao = if ($i -and $i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }; " +
          "ultimaExecucao = if ($i -and $i.LastRunTime) { $i.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }; " +
          // [long] e nao [int]: o Agendador devolve HRESULT como 32 bits SEM sinal
          // (2147946720, por exemplo), que estoura Int32 e derruba a rota.
          'ultimoResultado = if ($i) { [long]$i.LastTaskResult } else { $null } } }) | ConvertTo-Json -Compress',
      ],
      TIMEOUT_AGENDADOR_MS,
    );

    if (!saida.saida.trim()) return [];
    try {
      const bruto = JSON.parse(saida.saida) as unknown;
      return Array.isArray(bruto) ? bruto : [bruto];
    } catch {
      return [];
    }
  }

  /** Linhas do crontab marcadas pelo git-autosync, no formato que a tela espera. */
  async #tarefasCron(): Promise<unknown[]> {
    const { codigo, saida } = await executar('crontab', ['-l'], TIMEOUT_AGENDADOR_MS);
    // Codigo diferente de zero aqui e' o normal de quem nao tem crontab nenhum: a tela
    // mostra "sem agendamento", e nao um erro.
    if (codigo !== 0 || !saida.trim()) return [];

    return saida
      .split(/\r?\n/)
      .filter((linha) => linha.trim().endsWith('# git-autosync'))
      .map((linha, indice) => {
        const campos = linha.trim().split(/\s+/);
        const minuto = campos[0] ?? '';
        const hora = campos[1] ?? '';
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

  #config(): unknown {
    if (!existsSync(ARQUIVO_CONFIG)) return null;
    try {
      return JSON.parse(readFileSync(ARQUIVO_CONFIG, 'utf8')) as unknown;
    } catch (err) {
      throw new GitAutosyncFalhouError(`config.json ilegível: ${(err as Error).message}`);
    }
  }

  #log(limite: number): string[] {
    if (!existsSync(ARQUIVO_LOG)) return [];
    try {
      const linhas = readFileSync(ARQUIVO_LOG, 'utf8').split(/\r?\n/);
      // Última linha vazia é artefato do `\n` final, não um evento.
      if (linhas.at(-1) === '') linhas.pop();
      return linhas.slice(-limite);
    } catch (err) {
      throw new GitAutosyncFalhouError(`autosync.log ilegível: ${(err as Error).message}`);
    }
  }

  /**
   * Abre um terminal na pasta do repositorio, para resolver o que o hub nao resolve
   * sozinho (conflito, remoto trocado, credencial expirada). Nao chama o CLI.
   */
  async #terminal(caminho: string, _tipo: string): Promise<{ saida: string }> {
    if (!existsSync(caminho)) throw new GitAutosyncUsoError(`pasta não encontrada: ${caminho}`);

    // Delegado a `src/ferramentas.ts`, que e' onde mora o "abre terminal na pasta" usado
    // tambem pelos atalhos do cartao do cliente. Havia duas implementacoes: esta preferia
    // Git Bash e resolvia executavel com `existsSync`, que NAO enxerga o `wt.exe` do
    // WindowsApps (alias de execucao de 0 byte). Uma delas ganhou correcao e a outra nao,
    // que e' exatamente o que duas implementacoes do mesmo comportamento produzem.
    //
    // O parametro `tipo` (cmd, git-bash) deixou de ser honrado: a tela nunca o enviou, e
    // a escolha agora e' a mesma do "Abrir no Terminal" do Windows.
    try {
      return this.#ferramentas.abrir('terminal', caminho);
    } catch (err) {
      if (err instanceof PedidoFerramentaError) throw new GitAutosyncUsoError(err.message);
      throw new GitAutosyncFalhouError((err as Error).message);
    }
  }

  /**
   * Mesma assinatura de `HubHelper.requisitar`, para o `src/gitAutosync.ts` nao saber
   * quem esta' do outro lado.
   */
  async requisitar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(caminho, 'http://local');
    const acao = url.pathname.split('/').filter(Boolean)[1] ?? '';
    const metodo = (init.method ?? 'GET').toUpperCase();
    const query = url.searchParams;

    let corpo: Record<string, unknown> = {};
    try {
      corpo = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
    } catch {
      corpo = {};
    }
    const texto = (chave: string) => (typeof corpo[chave] === 'string' ? (corpo[chave] as string) : '');
    const alvo = texto('caminho');

    // Toda acao que mexe num repositorio exige o caminho: sem `--repo`, o CLI opera
    // sobre o diretorio atual e commita o repositorio errado.
    const exigemCaminho = ['repos', 'commit', 'push', 'sync', 'mr', 'include', 'exclude', 'terminal'];
    if (exigemCaminho.includes(acao) && !alvo) throw new GitAutosyncUsoError('envie { caminho }');

    const comoDados = (dados: unknown) => ({ ok: true, dados }) as T;
    const comoSaida = (saida: string) => ({ ok: true, saida: saida.trim() }) as T;

    switch (`${metodo} ${acao}`) {
      case 'GET status':
        return comoDados(await this.#cliJson(['status', '--json']));

      case 'GET config':
        return comoDados(this.#config());

      case 'GET tarefas':
        return comoDados(await this.#tarefas());

      case 'GET log':
        return comoDados(this.#log(Number(query.get('limite') ?? 200) || 200));

      case 'GET history': {
        const args = ['history', '--json'];
        for (const chave of ['repo', 'since', 'limit']) {
          const valor = query.get(chave);
          if (valor) args.push(`--${chave}`, valor);
        }
        return comoDados(await this.#cliJson(args));
      }

      case 'GET preview': {
        const args = ['preview', '--json'];
        const repo = query.get('repo');
        if (repo) args.push('--repo', repo);
        return comoDados(await this.#cliJson(args));
      }

      case 'POST repos': {
        if (!existsSync(alvo)) throw new GitAutosyncUsoError(`pasta não encontrada: ${alvo}`);
        const tipo = texto('tipo') === 'root' ? 'root' : 'repo';
        return comoSaida(await this.#cli(['add', alvo, '--type', tipo]));
      }

      // Sem checar existencia: descadastrar pasta ja' apagada tem que funcionar.
      case 'DELETE repos':
        return comoSaida(await this.#cli(['remove', alvo]));

      // `exclude`/`include` nao sao `remove`/`add`: um alvo `root` varre a pasta inteira
      // e cada repo dentro dela entra sozinho. `remove` apagaria o alvo raiz e levaria
      // junto todos os outros repositorios daquela pasta.
      case 'POST exclude':
        return comoSaida(await this.#cli(['exclude', alvo]));

      case 'POST include':
        return comoSaida(await this.#cli(['include', alvo]));

      case 'POST commit': {
        const args = ['commit', '--repo', alvo];
        if (texto('mensagem')) args.push('--message', texto('mensagem'));
        return comoSaida(await this.#cli(args));
      }

      case 'POST push':
        return comoSaida(await this.#cli(['push', '--repo', alvo]));

      case 'POST sync': {
        const args = ['sync', '--repo', alvo];
        if (texto('mensagem')) args.push('--message', texto('mensagem'));
        return comoSaida(await this.#cli(args));
      }

      case 'POST mr': {
        const args = ['mr', '--repo', alvo];
        for (const [chave, flag] of [
          ['titulo', '--title'],
          ['target', '--target'],
          ['source', '--source'],
        ] as const) {
          if (texto(chave)) args.push(flag, texto(chave));
        }
        return comoSaida(await this.#cli(args));
      }

      case 'POST terminal':
        return { ok: true, ...(await this.#terminal(alvo, texto('tipo'))) } as T;

      case 'POST agendamento': {
        const horarios = Array.isArray(corpo['horarios']) ? (corpo['horarios'] as unknown[]).map(String) : [];
        // O CLI nao tem "sem horario": `set-schedule ""` sai com erro de argumento
        // obrigatorio. Quem quer parar o automatico desinstala a tarefa.
        if (!horarios.length) {
          throw new GitAutosyncUsoError(
            'informe ao menos um horário — para parar o automático, remova a tarefa do Agendador',
          );
        }
        for (const horario of horarios) {
          if (!HORARIO_VALIDO.test(horario)) {
            throw new GitAutosyncUsoError(`horário inválido: ${horario} — use HH:MM`);
          }
        }
        return comoSaida(await this.#cli(['set-schedule', horarios.join(',')]));
      }

      case 'POST instalar':
        return comoSaida(await this.#cli(['install']));

      case 'POST desinstalar':
        return comoSaida(await this.#cli(['uninstall']));

      case 'POST ia': {
        const ligada = Boolean(corpo['ligada']);
        const agente = texto('agente');
        if (agente && !AGENTES_VALIDOS.includes(agente)) {
          throw new GitAutosyncUsoError(`agente inválido: ${agente}`);
        }

        await this.#cli(['set-ai', ligada ? 'on' : 'off']);
        if (agente) await this.#cli(['set-agent', agente]);
        return { ok: true, ligada, agente } as T;
      }

      default:
        throw new GitAutosyncUsoError(`rota desconhecida: ${metodo} ${caminho}`);
    }
  }

  /** O `GitAutosync` chama isto antes de montar a visao da aba Git. */
  async disponivel(): Promise<boolean> {
    return this.instalado;
  }
}
