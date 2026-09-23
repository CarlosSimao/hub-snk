/**
 * Controle do WildFly do Sankhya — Fase 3 da migracao "sem Docker".
 *
 * Substitui `scripts/wildfly-helper.ps1` (porta 4100). O helper existia porque o hub
 * rodava num container Linux e nao enxerga processo Windows: SO e espaco de processo
 * diferentes, nao limitacao de codigo. Com o backend nativo (shell desktop), a barreira
 * some e o controle vira chamada de funcao.
 *
 * O que isso fecha: o helper escutava em TODAS as interfaces da maquina, SEM token —
 * qualquer aparelho da rede local derrubava o WildFly. Aqui nao ha porta.
 *
 * Em CONTAINER o comportamento antigo continua: delega ao helper por HTTP. Enquanto o
 * `docker-compose.yml` for um jeito suportado de rodar o hub, tirar isso quebraria quem
 * ainda usa. O sinal de container e' `/.dockerenv`, e nao mais a plataforma — com o hub
 * nativo no Linux, `platform !== 'win32'` passou a significar duas coisas diferentes.
 *
 * O que muda entre os dois sistemas nativos:
 *
 *  - script de inicializacao: `standalone.bat` (via `cmd.exe`, que o Node exige para
 *    `.bat`) contra `standalone.sh`, chamado direto;
 *  - deteccao do processo: no Windows a linha de comando exige um `powershell.exe`
 *    pontual, porque o Node nao expoe essa informacao; no Linux e' leitura de
 *    `/proc/<pid>/cmdline`, sem processo auxiliar nenhum;
 *  - encerramento: `SIGTERM` no Linux, que o WildFly trata como desligamento ordenado;
 *    no Windows todo sinal e' `TerminateProcess`.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { HubHelper } from './sankhya/helper.ts';

/** Casa a linha de comando do java.exe do WildFly entre outras JVMs da maquina. */
const FILTRO_PROCESSO = 'jboss-modules.jar';

const EH_WINDOWS = process.platform === 'win32';

/**
 * Nativo = o hub controla o processo do WildFly direto. Em container ele NAO enxerga
 * processo do host (outro SO, outro espaco de processos) e delega ao helper.
 *
 * O sinal deixou de ser a plataforma: com o hub rodando nativo no Linux, `platform` nao
 * distingue mais container de maquina do usuario. `/.dockerenv` distingue.
 */
export const NATIVO = EH_WINDOWS || !existsSync('/.dockerenv');

/** `standalone.bat` no Windows, `standalone.sh` no Linux — e o que marca a instalacao. */
export const SCRIPT_STANDALONE = EH_WINDOWS ? 'standalone.bat' : 'standalone.sh';

/** Instalacao padrao primeiro; o fallback cobre outro host, outro checkout. */
const PASTAS_PADRAO = EH_WINDOWS
  ? ['C:\\Sankhya\\wildfly_producao', 'C:\\wildfly_producao']
  : ['/opt/sankhya/wildfly_producao', '/opt/wildfly_producao', join(homedir(), 'wildfly_producao')];

const TIMEOUT_DETECCAO_MS = 15_000;
/** `kill` devolve antes de o SO liberar a porta; sem esperar, o start novo acha a 8080 ocupada. */
const ESPERA_MORTE_MS = 20_000;

/** Pasta informada pela tela que nao e' uma instalacao do WildFly. */
export class ConfigWildflyInvalidaError extends Error {}

export interface ResultadoWildfly {
  ok: boolean;
  mensagem: string;
  /** PIDs afetados, quando a operacao mexeu em processo — usado pela espera do restart. */
  pids?: number[];
}

/**
 * O processo ainda existe?
 *
 * Sinal 0 nao envia nada: so' pergunta ao SO se da' para sinalizar aquele PID. Custa
 * microssegundos, contra ~2s de um `powershell.exe` novo — e' o que torna a espera do
 * `reiniciar` util em vez de granular demais para servir.
 */
function processoVivo(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: existe, mas e' de outro usuario. Vivo para o que nos interessa.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export interface StatusWildfly extends ResultadoWildfly {
  pasta: string;
  bin: string;
  rodando: boolean;
  pids: number[];
}

export type OperacaoWildfly = 'iniciar' | 'parar' | 'reiniciar';

export interface ConfigWildfly {
  pasta: string;
  arquivoLog: string;
  /**
   * Iniciar com o console do WildFly a vista. Desligado por padrao: fechar essa janela
   * derruba o servidor. Serve para acompanhar um boot que falha antes de escrever no log.
   */
  mostrarConsole: boolean;
  /** Medido na hora — a tela avisa ANTES de o Iniciar falhar por caminho errado. */
  pastaExiste: boolean;
  logExiste: boolean;
}

export interface InstalacaoWildfly {
  pasta: string;
  arquivoLog: string;
}

/** Onde procurar instalacao: raiz das unidades comuns e a pasta Sankhya de cada uma. */
const RAIZES_BUSCA = EH_WINDOWS
  ? ['C:\\', 'C:\\Sankhya', 'D:\\', 'D:\\Sankhya']
  : ['/opt', '/opt/sankhya', '/srv', homedir()];

/**
 * Esta linha de comando e' de um java.exe DESTA instalacao do WildFly?
 *
 * Duas condicoes, e as duas importam:
 *
 *  - `jboss-modules.jar` separa um WildFly de qualquer outra JVM da maquina (o nome do
 *    processo e' `java.exe` para todas).
 *  - o caminho da instalacao precisa TERMINAR ali — separador de pasta, aspas, espaco
 *    ou fim da linha. Com um `contains` cru, quem tem `C:\wildfly_producao` e
 *    `C:\wildfly_producao2` lado a lado pararia os dois ao pedir para parar o primeiro,
 *    e o segundo cairia sem ninguem ter pedido.
 *
 * Os DOIS separadores entram no limite: no Linux o caminho e' `/opt/wildfly_producao`, e
 * exigir contrabarra deixaria `/opt/wildfly_producao2` passar pelo mesmo buraco que a
 * regra existe para fechar.
 */
export function casaInstalacao(linhaDeComando: string, raiz: string): boolean {
  if (!linhaDeComando.includes(FILTRO_PROCESSO)) return false;
  const escapada = raiz.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escapada}([\\\\/]|"|\\s|$)`, 'i').test(linhaDeComando);
}

/**
 * Como disparar o `standalone.bat` no Windows.
 *
 * Tres exigencias, e cada forma testada em 2026-09-23 com um `.bat` que imita o
 * `standalone.bat` (mesmo `echo | findstr` do comeco, depois fica vivo como servidor):
 *
 *  1. PASSAR do `echo(!SERVER_OPTS! | findstr ...` do inicio do script. Com
 *     `detached: true` esse pipe nunca termina e a janela fica parada no `findstr`.
 *  2. SOBREVIVER ao hub. Filho direto do backend morre junto: o Node poe os filhos num
 *     job do Windows que e' encerrado quando o backend sai — medido, o WildFly caia.
 *  3. Nao abrir console (a menos que pedido). Fechar essa janela no X, ou Ctrl+C nela,
 *     derruba o WildFly — console a vista e' convite ao acidente.
 *
 * Oculto: `Start-Process -WindowStyle Hidden` do PowerShell cumpre as tres (o VBScript
 * `Run ..., 0` tambem cumpre, mas depende do Windows Script Host, que politica
 * corporativa costuma desligar). O `cmd` nasce do PowerShell, que termina logo em
 * seguida — o WildFly fica fora da arvore do backend. Os caminhos vao por VARIAVEL DE
 * AMBIENTE, nunca interpolados no comando: aspas ou apostrofo na pasta nao quebram nada.
 * `windowsHide` no proprio `powershell.exe`, senao ele pisca uma janela.
 *
 * Com console: `start`, que abre um console proprio e independente, como o duplo-clique
 * — cumpre 1 e 2, e serve para acompanhar um boot que nao chega a escrever no log.
 * `windowsVerbatimArguments` e' o que faz o `cmd.exe` receber as aspas como escritas;
 * sem ele o Node as re-escapa e o script nem executa.
 *
 * `NOPAUSE`: o `standalone.bat` termina com `pause` sem ela, e o `cmd` ficaria preso
 * esperando uma tecla depois que o WildFly parasse — oculto, para sempre.
 */
export function comandoInicioWindows(
  bin: string,
  standalone: string,
  mostrarConsole: boolean,
): { comando: string; args: string[]; opcoes: SpawnOptions } {
  const env = { ...process.env, NOPAUSE: 'true', HUB_WF_BIN: bin, HUB_WF_BAT: standalone };

  if (mostrarConsole) {
    return {
      comando: 'cmd.exe',
      args: ['/c', `start "WildFly" /d "${bin}" "${standalone}"`],
      opcoes: { cwd: bin, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true, env },
    };
  }

  return {
    comando: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "Start-Process -FilePath cmd.exe -ArgumentList ('/c \"' + $env:HUB_WF_BAT + '\"') " +
        '-WorkingDirectory $env:HUB_WF_BIN -WindowStyle Hidden',
    ],
    opcoes: { cwd: bin, windowsHide: true, stdio: 'ignore', env },
  };
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Roda um comando e devolve a saida; `codigo !== 0` nao lanca, devolve o que veio. */
function executar(comando: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    const processo = spawn(comando, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let saida = '';
    const prazo = setTimeout(() => processo.kill(), timeoutMs);

    processo.stdout?.on('data', (pedaco: Buffer) => (saida += pedaco.toString('utf8')));
    processo.on('error', () => {
      clearTimeout(prazo);
      resolve('');
    });
    processo.on('close', () => {
      clearTimeout(prazo);
      resolve(saida);
    });
  });
}

export class Wildfly {
  readonly #arquivoConfig: string;
  readonly #helperUrl: string;
  readonly #hubHelper: HubHelper | undefined;
  readonly #nativo: boolean;

  /**
   * @param arquivoConfig `%APPDATA%\sankhya-hub\wildfly.json`, escrito pela tela de
   *   caminhos. Lido a cada chamada, nao no boot: trocar a instalacao pelo painel vale
   *   na hora.
   * @param helperUrl `wildfly-helper.ps1` (porta 4100): start/stop/restart. Fora do
   *   Windows apenas.
   * @param hubHelper `hub-helper.ps1` (porta 4102): e' quem responde `/wildfly/config` e
   *   `/wildfly/detectar`. Sao dois helpers diferentes, em portas diferentes — o
   *   primeiro controla o processo, o segundo le e grava os caminhos. Fora do Windows
   *   apenas.
   */
  constructor(arquivoConfig: string, helperUrl: string, hubHelper?: HubHelper) {
    this.#arquivoConfig = arquivoConfig;
    this.#helperUrl = helperUrl.replace(/\/$/, '');
    this.#hubHelper = hubHelper;
    this.#nativo = NATIVO;
  }

  /** Rotas de CONFIG, que moram no `hub-helper.ps1` (4102, com token). */
  #helperJson<T>(caminho: string, init: RequestInit = {}): Promise<T> {
    if (!this.#hubHelper) {
      throw new Error('sem hub-helper configurado para ler os caminhos do WildFly fora do Windows');
    }
    return this.#hubHelper.requisitar<T>(caminho, init, { timeoutMs: 45_000 });
  }

  /** `true` quando o controle e' local; `false` quando depende do helper por HTTP. */
  get nativo(): boolean {
    return this.#nativo;
  }

  /** Raiz da instalacao em uso agora — config valida, ou o primeiro padrao que existir. */
  pasta(): string {
    try {
      const config = JSON.parse(readFileSync(this.#arquivoConfig, 'utf8')) as { pasta?: string };
      const escolhida = (config.pasta ?? '').trim();
      if (escolhida && existsSync(join(escolhida, 'bin', SCRIPT_STANDALONE))) return escolhida;
    } catch {
      // Config ausente ou quebrada nao pode tirar o WildFly do ar: cai no padrao.
    }
    return PASTAS_PADRAO.find((pasta) => existsSync(join(pasta, 'bin'))) ?? PASTAS_PADRAO[0]!;
  }

  /** `server.log` da instalacao, ou o caminho explicito gravado na tela de caminhos. */
  arquivoLog(): string {
    try {
      const config = JSON.parse(readFileSync(this.#arquivoConfig, 'utf8')) as { arquivoLog?: string };
      const escolhido = (config.arquivoLog ?? '').trim();
      if (escolhido) return escolhido;
    } catch {
      // Segue para o caminho padrao da instalacao.
    }
    return join(this.pasta(), 'standalone', 'log', 'server.log');
  }

  /**
   * PIDs do java.exe DESTA instalacao.
   *
   * O nome do processo nao distingue uma JVM da outra, e o caminho e' o que separa um
   * WildFly de outro na mesma maquina. A comparacao exige que o caminho TERMINE ali
   * (barra, aspas, espaco ou fim): havendo `C:\wildfly_producao` e
   * `C:\wildfly_producao2`, um `contains` cru pararia os dois.
   */
  async pids(): Promise<number[]> {
    if (!this.#nativo) return [];
    if (!EH_WINDOWS) return this.#pidsLinux();

    const saida = await executar(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy', 'Bypass',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name = 'java.exe'\" | " +
          'Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress',
      ],
      TIMEOUT_DETECCAO_MS,
    );

    if (!saida.trim()) return [];

    let linhas: { ProcessId?: number; CommandLine?: string }[];
    try {
      const bruto = JSON.parse(saida) as unknown;
      // O PowerShell serializa lista de UM item como objeto, nao como array.
      linhas = Array.isArray(bruto) ? (bruto as typeof linhas) : [bruto as { ProcessId?: number; CommandLine?: string }];
    } catch {
      return [];
    }

    const raiz = this.pasta();

    return linhas
      .filter((linha) => casaInstalacao(linha.CommandLine ?? '', raiz))
      .map((linha) => linha.ProcessId ?? 0)
      .filter((pid) => pid > 0);
  }

  /**
   * PIDs no Linux, lidos de `/proc`.
   *
   * Aqui nao ha processo auxiliar nenhum: `/proc/<pid>/cmdline` E' a linha de comando, com
   * os argumentos separados por byte zero. No Windows a mesma informacao exige um
   * `powershell.exe` de ~2s, porque o Node nao expoe API para isso.
   */
  #pidsLinux(): number[] {
    const raiz = this.pasta();
    let entradas: string[];
    try {
      entradas = readdirSync('/proc');
    } catch {
      return [];
    }

    const achados: number[] = [];
    for (const entrada of entradas) {
      const pid = Number(entrada);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        // O zero separa argumentos; virando espaco, a linha fica igual a do Windows e a
        // mesma `casaInstalacao` serve para os dois.
        const linha = readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').trim();
        if (linha && casaInstalacao(linha, raiz)) achados.push(pid);
      } catch {
        // Processo que morreu entre a listagem e a leitura, ou de outro usuario.
      }
    }
    return achados;
  }

  async status(): Promise<StatusWildfly> {
    if (!this.#nativo) return this.#viaHelper<StatusWildfly>('/status');

    const pasta = this.pasta();
    const pids = await this.pids();
    return {
      ok: true,
      pasta,
      bin: join(pasta, 'bin'),
      rodando: pids.length > 0,
      pids,
      mensagem: pids.length ? `rodando (PID ${pids.join(', ')})` : 'parado',
    };
  }

  async iniciar(): Promise<ResultadoWildfly> {
    if (!this.#nativo) return this.#viaHelper<ResultadoWildfly>('/iniciar');

    const pids = await this.pids();
    if (pids.length) return { ok: true, mensagem: `já estava rodando (PID ${pids.join(', ')})` };

    const bin = join(this.pasta(), 'bin');
    const standalone = join(bin, SCRIPT_STANDALONE);
    if (!existsSync(standalone)) {
      return {
        ok: false,
        mensagem: `${SCRIPT_STANDALONE} não encontrado em ${bin} — informe a pasta do WildFly na aba Infra do hub`,
      };
    }

    // Sem esperar o fim: o WildFly segue rodando em segundo plano, inclusive depois que o
    // hub fecha. Como isso e' feito no Windows esta' em `comandoInicioWindows`.
    const { comando, args, opcoes } = EH_WINDOWS
      ? comandoInicioWindows(bin, standalone, this.#mostrarConsole())
      : { comando: standalone, args: [], opcoes: { cwd: bin, detached: true, stdio: 'ignore' as const } };
    const processo = spawn(comando, args, opcoes);
    processo.unref();

    return { ok: true, mensagem: 'disparado' };
  }

  async parar(): Promise<ResultadoWildfly> {
    if (!this.#nativo) return this.#viaHelper<ResultadoWildfly>('/parar');

    const pids = await this.pids();
    if (!pids.length) return { ok: true, mensagem: 'já estava parado' };

    for (const pid of pids) {
      try {
        // No Windows todo `kill` e' TerminateProcess e o sinal e' so' rotulo. No Linux o
        // sinal vale: `SIGTERM` e' o que o `standalone.sh` trata para desligar o servidor
        // com ordem (fecha conexoes, grava o log de shutdown) — `SIGKILL` levaria a JVM
        // no meio da escrita. Quem insiste em morrer e' encerrado pela espera do
        // `reiniciar`, que continua olhando os PIDs.
        process.kill(pid, EH_WINDOWS ? 'SIGKILL' : 'SIGTERM');
      } catch {
        // Morreu entre a listagem e agora — o objetivo ja foi alcancado.
      }
    }

    return { ok: true, mensagem: `encerrado (PID ${pids.join(', ')})`, pids };
  }

  async reiniciar(): Promise<ResultadoWildfly> {
    if (!this.#nativo) return this.#viaHelper<ResultadoWildfly>('/reiniciar');

    const parada = await this.parar();

    // Espera pelos PIDs que acabamos de matar, com `kill(pid, 0)` — e' instantaneo.
    // Re-listar pelo PowerShell aqui custaria ~2s por volta e transformaria a espera de
    // 20s em meia duzia de amostras.
    const limite = Date.now() + ESPERA_MORTE_MS;
    while (Date.now() < limite && (parada.pids ?? []).some(processoVivo)) {
      await esperar(200);
    }

    return this.iniciar();
  }

  executar(operacao: OperacaoWildfly): Promise<ResultadoWildfly> {
    if (operacao === 'iniciar') return this.iniciar();
    if (operacao === 'parar') return this.parar();
    return this.reiniciar();
  }

  /**
   * Caminhos escolhidos na tela, com a existencia medida agora.
   *
   * Em container, quem enxerga o disco do Windows e' o helper — o container veria os
   * caminhos como inexistentes e a tela acusaria erro no que esta' certo.
   */
  /** Lido a cada Iniciar, como os caminhos: mudar na tela vale na hora. */
  #mostrarConsole(): boolean {
    try {
      const salvo = JSON.parse(readFileSync(this.#arquivoConfig, 'utf8')) as { mostrarConsole?: unknown };
      return salvo.mostrarConsole === true;
    } catch {
      return false;
    }
  }

  async config(): Promise<ConfigWildfly> {
    if (!this.#nativo) {
      const corpo = await this.#helperJson<ConfigWildfly>('/wildfly/config');
      return corpo;
    }

    let pasta = '';
    let arquivoLog = '';
    let mostrarConsole = false;
    try {
      const salvo = JSON.parse(readFileSync(this.#arquivoConfig, 'utf8')) as Partial<ConfigWildfly>;
      pasta = (salvo.pasta ?? '').trim();
      arquivoLog = (salvo.arquivoLog ?? '').trim();
      mostrarConsole = salvo.mostrarConsole === true;
    } catch {
      // Sem config ainda: a tela nasce vazia, que e' o certo — nao inventamos caminho.
    }

    return {
      pasta,
      arquivoLog,
      mostrarConsole,
      pastaExiste: Boolean(pasta) && existsSync(join(pasta, 'bin', SCRIPT_STANDALONE)),
      logExiste: Boolean(arquivoLog) && existsSync(arquivoLog),
    };
  }

  /**
   * Grava os caminhos. Recusa pasta que nao e' instalacao do WildFly: descobrir isso
   * so' quando o Iniciar falha manda procurar defeito no lugar errado.
   */
  async gravarConfig(pasta: string, arquivoLog: string, mostrarConsole?: boolean): Promise<ConfigWildfly> {
    if (!this.#nativo) {
      return this.#helperJson<ConfigWildfly>('/wildfly/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pasta, arquivoLog, mostrarConsole }),
      });
    }

    const limpa = pasta.trim();
    let log = arquivoLog.trim();

    if (limpa && !existsSync(join(limpa, 'bin', SCRIPT_STANDALONE))) {
      throw new ConfigWildflyInvalidaError(
        `não achei bin/${SCRIPT_STANDALONE} em ${limpa} — essa pasta não é uma instalação do WildFly`,
      );
    }

    // Log em branco com pasta preenchida: o caminho padrao da instalacao e' o palpite
    // certo em 100% dos casos vistos, e poupa o usuario de digitar duas vezes.
    if (limpa && !log) log = join(limpa, 'standalone', 'log', 'server.log');

    mkdirSync(dirname(this.#arquivoConfig), { recursive: true });
    // Sem o valor na chamada, mantem o que estava: quem so' troca a pasta nao deve
    // religar o console sem ter pedido.
    const comConsole = mostrarConsole ?? this.#mostrarConsole();
    writeFileSync(
      this.#arquivoConfig,
      JSON.stringify({ pasta: limpa, arquivoLog: log, mostrarConsole: comConsole }, null, 2),
      'utf8',
    );

    return this.config();
  }

  /** Varre as raizes conhecidas atras de instalacoes, para nao digitar caminho na mao. */
  async detectar(): Promise<InstalacaoWildfly[]> {
    if (!this.#nativo) {
      const corpo = await this.#helperJson<{ instalacoes?: InstalacaoWildfly[] }>('/wildfly/detectar');
      return corpo.instalacoes ?? [];
    }

    const achados: InstalacaoWildfly[] = [];
    // Mesma instalacao alcancavel por dois caminhos (`C:\` e `C:\Sankhya`) apareceria
    // duas vezes, e a tela mostraria duas opcoes que fazem a mesma coisa.
    const vistos = new Set<string>();

    for (const raiz of RAIZES_BUSCA) {
      if (!existsSync(raiz)) continue;

      let filhas: string[];
      try {
        filhas = readdirSync(raiz, { withFileTypes: true })
          .filter((entrada) => entrada.isDirectory())
          .map((entrada) => join(raiz, entrada.name));
      } catch {
        continue; // Pasta de sistema sem permissao: segue para a proxima raiz.
      }

      for (const candidata of filhas) {
        if (!existsSync(join(candidata, 'bin', SCRIPT_STANDALONE))) continue;
        if (vistos.has(candidata.toLowerCase())) continue;
        vistos.add(candidata.toLowerCase());

        const log = join(candidata, 'standalone', 'log', 'server.log');
        achados.push({ pasta: candidata, arquivoLog: existsSync(log) ? log : '' });
      }
    }

    return achados;
  }

  /** Caminho antigo: hub em container falando com o helper por `host.docker.internal`. */
  async #viaHelper<T extends ResultadoWildfly>(rota: string): Promise<T> {
    try {
      const resposta = await fetch(`${this.#helperUrl}${rota}`, { signal: AbortSignal.timeout(30_000) });
      return (await resposta.json()) as T;
    } catch (err) {
      return {
        ok: false,
        mensagem: `não consegui falar com o helper do WildFly em ${this.#helperUrl}: ${(err as Error).message}`,
      } as T;
    }
  }
}
