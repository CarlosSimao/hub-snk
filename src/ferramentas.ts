/**
 * Abre uma pasta de repositorio na ferramenta que o usuario ja' usa: terminal,
 * IntelliJ IDEA ou Claude Code.
 *
 * Isto NAO passa pelo git-autosync — e' abrir programa numa pasta, e nada disso precisa
 * do autosync instalado. O terminal mora aqui porque o botao da aba Git ja' fazia isso
 * de dentro do `GitAutosyncCli`, e duas implementacoes do mesmo "abre terminal na pasta"
 * divergem na primeira correcao que uma recebe e a outra nao.
 *
 * ## Como nada aqui vira execucao de comando arbitrario
 *
 * O caminho vem do cadastro do cliente, que e' campo livre — tratado como dado, nunca
 * como comando:
 *
 *  - todo `spawn` recebe ARRAY de argumentos e `shell: false` (o padrao). Sem shell no
 *    caminho, `&`, `|` e `^` dentro do caminho sao so' caracteres do nome da pasta;
 *  - o executavel NUNCA vem do pedido: e' resolvido aqui, no PATH ou nos lugares
 *    conhecidos de instalacao;
 *  - a pasta precisa existir e ser diretorio, senao o pedido e' recusado antes de
 *    qualquer processo nascer;
 *  - o unico ponto onde um `cmd.exe` participa e' a retaguarda de quem nao tem o
 *    Windows Terminal (`#viaStart`), e la' o caminho passa por uma recusa extra de
 *    caracteres que o `cmd` reinterpreta (ver `FALLBACK_CMD`);
 *  - o caminho do `claude` viaja por variavel de ambiente, para nao existir operador de
 *    shell na linha de comando nem quando a retaguarda entra.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export const FERRAMENTAS = ['terminal', 'intellij', 'claude'] as const;
export type Ferramenta = (typeof FERRAMENTAS)[number];

export function ehFerramenta(valor: string): valor is Ferramenta {
  return (FERRAMENTAS as readonly string[]).includes(valor);
}

/** Pedido invalido — pasta que nao existe, tipo desconhecido. Vira 4xx. */
export class PedidoFerramentaError extends Error {}
/** A ferramenta nao esta instalada nesta maquina. Vira 4xx, com o que instalar. */
export class FerramentaIndisponivelError extends Error {}

/**
 * Caracteres que o `cmd.exe` reinterpreta na propria linha de comando, mesmo com o
 * argumento vindo em array. So' importam para o fallback que passa por `cmd /k`.
 */
const FALLBACK_CMD = /[&|<>^"%!\r\n]/;

const EH_WINDOWS = process.platform === 'win32';

/**
 * Nomes de arquivo de uma pasta, em minusculas. Memorizado porque a mesma pasta do PATH
 * e' consultada varias vezes numa unica resolucao.
 */
const conteudoDePasta = new Map<string, Set<string>>();

function arquivosDe(pasta: string): Set<string> {
  const memorizado = conteudoDePasta.get(pasta);
  if (memorizado) return memorizado;

  let nomes: Set<string>;
  try {
    nomes = new Set(readdirSync(pasta).map((nome) => nome.toLowerCase()));
  } catch {
    // Entrada do PATH que nao existe ou nao pode ser lida — o Windows tem varias.
    nomes = new Set();
  }
  conteudoDePasta.set(pasta, nomes);
  return nomes;
}

/**
 * Procura um executavel no PATH.
 *
 * Usa LISTAGEM da pasta, e nao `existsSync` em cada candidato, por um motivo especifico
 * do Windows: `wt.exe` e `pwsh.exe` em `%LOCALAPPDATA%\Microsoft\WindowsApps` sao
 * "app execution aliases" — reparse points de 0 byte que o `fs.existsSync` reporta como
 * INEXISTENTES, embora o `spawn` os execute normalmente. Com `existsSync`, o Windows
 * Terminal ficava invisivel para o hub mesmo estando instalado e no PATH, e o botao caia
 * na retaguarda do `cmd`. A listagem enxerga os dois.
 */
function noPath(nomes: string[]): string {
  const extensoes = EH_WINDOWS ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const pasta of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!pasta) continue;
    const arquivos = arquivosDe(pasta);
    for (const nome of nomes) {
      for (const extensao of extensoes) {
        const arquivo = `${nome}${extensao}`;
        if (arquivo && arquivos.has(arquivo.toLowerCase())) return join(pasta, arquivo);
      }
    }
  }
  return '';
}

/** Primeiro `<raiz>/<subpasta que casa>/<resto>` que existir. */
function procurarEmSubpastas(raiz: string, padrao: RegExp, resto: string[]): string {
  if (!existsSync(raiz)) return '';
  let filhas: string[];
  try {
    filhas = readdirSync(raiz, { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory() && padrao.test(entrada.name))
      // Decrescente: entre "IntelliJ IDEA 2025.2" e "2025.3", abre a mais nova.
      .map((entrada) => entrada.name)
      .sort()
      .reverse();
  } catch {
    return '';
  }
  for (const filha of filhas) {
    const alvo = join(raiz, filha, ...resto);
    if (existsSync(alvo)) return alvo;
  }
  return '';
}

export interface ResultadoFerramenta {
  /** Mensagem pronta para o toast: o que abriu e onde. */
  saida: string;
}

/** Quem cria o processo. Injetavel para o teste nao abrir janela de verdade. */
export type Lancador = (exe: string, args: string[], cwd: string, extraEnv?: Record<string, string>) => void;

const LANCADOR_PADRAO: Lancador = (exe, args, cwd, extraEnv) => {
  // `detached` + `unref`: a janela e' do usuario e tem que sobreviver ao hub — se o
  // filho morresse junto, fechar o painel fecharia o terminal aberto.
  spawn(exe, args, {
    cwd,
    env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();
};

export class Ferramentas {
  readonly #lancar: Lancador;

  /**
   * O lancador entra por parametro porque a alternativa e' um teste que ABRE PROGRAMA na
   * maquina de quem roda a suite: a primeira versao deste teste subiu um IntelliJ
   * apontado para a pasta temporaria que o proprio teste acabara' de apagar.
   */
  constructor(lancar: Lancador = LANCADOR_PADRAO) {
    this.#lancar = lancar;
  }

  /**
   * Terminal na pasta — o mesmo "Abrir no Terminal" que o Explorer do Windows oferece:
   * Windows Terminal com PowerShell, ja' na pasta.
   *
   * Duas decisoes vieram de medicao, nao de preferencia:
   *
   *  - **PowerShell, nao Git Bash.** A primeira versao preferia Git Bash; nesta maquina
   *    `C:\Program Files\Git\git-bash.exe` nao existe (o Git foi instalado sem ele), e o
   *    botao caia num caminho que ninguem pediu.
   *  - **`-w new` obrigatorio.** Sem isto, o `wt` entrega a pasta a' JANELA QUE JA'
   *    ESTAVA ABERTA, como uma aba nova atras de tudo — abriu, e parecia nao ter
   *    funcionado. `-w new` sempre traz janela propria.
   */
  #terminal(caminho: string): ResultadoFerramenta {
    if (EH_WINDOWS) {
      const powershell = this.#powershell();
      const wt = noPath(['wt']);
      if (wt) {
        return this.#soltar(wt, ['-w', 'new', '-d', caminho, powershell, '-NoLogo'], caminho, 'Terminal');
      }
      // Sem o Windows Terminal (Windows 10 sem a loja, imagem corporativa enxuta): o
      // `start` do `cmd` e' o que da' console proprio ao PowerShell — `spawn` com
      // `detached` sozinho o deixaria rodando sem janela nenhuma.
      return this.#viaStart([powershell, '-NoLogo'], caminho, 'Terminal');
    }

    const emulador = [
      { exe: 'gnome-terminal', args: (pasta: string) => ['--working-directory', pasta] },
      { exe: 'konsole', args: (pasta: string) => ['--workdir', pasta] },
      { exe: 'xfce4-terminal', args: (pasta: string) => ['--working-directory', pasta] },
      { exe: 'x-terminal-emulator', args: () => [] },
      { exe: 'xterm', args: () => [] },
    ].find((candidato) => noPath([candidato.exe]));

    if (!emulador) {
      throw new FerramentaIndisponivelError(
        'não achei um terminal gráfico nesta máquina (procurei gnome-terminal, konsole, xfce4-terminal, x-terminal-emulator e xterm)',
      );
    }
    return this.#soltar(noPath([emulador.exe]), emulador.args(caminho), caminho, emulador.exe);
  }

  /**
   * IntelliJ IDEA com a pasta aberta como projeto.
   *
   * O launcher de linha de comando do IntelliJ nao costuma estar no PATH (o "Add binary
   * to PATH" e' opcional e raramente marcado), entao os lugares de instalacao entram na
   * busca. Medido nesta maquina: nada de `idea`/`idea64` no PATH, e o binario em
   * `C:\Program Files\JetBrains\IntelliJ IDEA Community Edition 2025.2.6.2\bin`.
   */
  #intellij(caminho: string): ResultadoFerramenta {
    const exe = EH_WINDOWS ? this.#intellijWindows() : this.#intellijLinux();
    if (!exe) {
      throw new FerramentaIndisponivelError(
        EH_WINDOWS
          ? 'não achei o IntelliJ IDEA nesta máquina (procurei no PATH, nos scripts do JetBrains Toolbox e em Program Files\\JetBrains)'
          : 'não achei o IntelliJ IDEA nesta máquina (procurei `idea`/`idea.sh` no PATH e nos scripts do JetBrains Toolbox)',
      );
    }
    // A pasta vai como ARGUMENTO do IntelliJ, que e' como ele recebe "abra este projeto".
    return this.#soltar(exe, [caminho], caminho, 'IntelliJ IDEA');
  }

  #intellijWindows(): string {
    const noCaminho = noPath(['idea64', 'idea']);
    if (noCaminho) return noCaminho;

    const toolbox = join(homedir(), 'AppData', 'Local', 'JetBrains', 'Toolbox', 'scripts');
    for (const nome of ['idea.cmd', 'idea64.cmd', 'idea.bat']) {
      const alvo = join(toolbox, nome);
      if (existsSync(alvo)) return alvo;
    }

    const raizes = [
      'C:\\Program Files\\JetBrains',
      'C:\\Program Files (x86)\\JetBrains',
      join(homedir(), 'AppData', 'Local', 'Programs'),
      join(homedir(), 'AppData', 'Local', 'JetBrains'),
    ];
    for (const raiz of raizes) {
      const achado = procurarEmSubpastas(raiz, /intellij|idea/i, ['bin', 'idea64.exe']);
      if (achado) return achado;
    }
    return '';
  }

  #intellijLinux(): string {
    const noCaminho = noPath(['idea', 'idea.sh', 'intellij-idea-ultimate', 'intellij-idea-community']);
    if (noCaminho) return noCaminho;

    const toolbox = join(homedir(), '.local', 'share', 'JetBrains', 'Toolbox', 'scripts');
    for (const nome of ['idea', 'idea.sh']) {
      const alvo = join(toolbox, nome);
      if (existsSync(alvo)) return alvo;
    }

    for (const raiz of ['/opt', join(homedir(), '.local', 'share', 'JetBrains')]) {
      const achado = procurarEmSubpastas(raiz, /intellij|idea/i, ['bin', 'idea.sh']);
      if (achado) return achado;
    }
    return '';
  }

  /**
   * Claude Code numa sessao nova, na pasta do repositorio, com o CLI JA' RODANDO.
   *
   * Igual ao terminal (Windows Terminal + PowerShell, janela propria), com o `claude`
   * como comando inicial. O `-NoExit` e' o que importa depois: quando a sessao do Claude
   * termina, o PowerShell fica — sem isso a janela fecharia levando o que estava escrito
   * nela.
   *
   * O `claude` e' programa de CONSOLE: solto sem terminal ele roda invisivel e a sessao
   * nao serve para nada. Por isso nunca e' lancado direto.
   */
  #claude(caminho: string): ResultadoFerramenta {
    // `~/.local/bin` entra porque e' onde o instalador nativo do Claude Code deixa o
    // binario (medido nesta maquina), e ele nem sempre esta' no PATH que o hub herdou.
    const exe =
      noPath(['claude']) || this.#claudeNoPerfil(EH_WINDOWS ? '.local/bin/claude.exe' : '.local/bin/claude');

    if (!exe) {
      throw new FerramentaIndisponivelError(
        'não achei o Claude Code nesta máquina (procurei `claude` no PATH e em ~/.local/bin)',
      );
    }

    if (EH_WINDOWS) {
      const powershell = this.#powershell();

      /**
       * O caminho do `claude` viaja por VARIAVEL DE AMBIENTE, e o comando e'
       * `Start-Process`, nao `& '<caminho>'`.
       *
       * Os dois detalhes existem pelo mesmo motivo: o `&` do PowerShell e' operador do
       * `cmd` tambem, e a retaguarda abaixo passa por `cmd /c start`. A primeira versao
       * usava `& '<exe>'` e o botao do Claude morria com "o caminho não pode conter & |
       * < > ^" — falando do comando que o proprio hub montou, nao do caminho do usuario.
       * Com a variavel, nada que o `cmd` reinterprete entra na linha.
       */
      const comando = 'Start-Process -FilePath $env:SANKHYA_HUB_CLAUDE -NoNewWindow -Wait';
      const argsShell = [powershell, '-NoLogo', '-NoExit', '-Command', comando];
      const ambiente = { SANKHYA_HUB_CLAUDE: exe };

      const wt = noPath(['wt']);
      if (wt) {
        return this.#soltar(wt, ['-w', 'new', '-d', caminho, ...argsShell], caminho, 'Claude Code', ambiente);
      }
      return this.#viaStart(argsShell, caminho, 'Claude Code', ambiente);
    }

    const emulador = [
      { exe: 'gnome-terminal', args: (pasta: string, alvo: string) => ['--working-directory', pasta, '--', alvo] },
      { exe: 'konsole', args: (pasta: string, alvo: string) => ['--workdir', pasta, '-e', alvo] },
      { exe: 'xfce4-terminal', args: (pasta: string, alvo: string) => ['--working-directory', pasta, '-x', alvo] },
      { exe: 'xterm', args: (_pasta: string, alvo: string) => ['-e', alvo] },
    ].find((candidato) => noPath([candidato.exe]));

    if (!emulador) {
      throw new FerramentaIndisponivelError(
        'não achei um terminal gráfico para abrir o Claude Code (procurei gnome-terminal, konsole, xfce4-terminal e xterm)',
      );
    }
    return this.#soltar(noPath([emulador.exe]), emulador.args(caminho, exe), caminho, 'Claude Code');
  }

  #claudeNoPerfil(relativo: string): string {
    const alvo = join(homedir(), ...relativo.split(/[\\/]/));
    return existsSync(alvo) ? alvo : '';
  }

  /**
   * O PowerShell da maquina: `pwsh` (7+) quando instalado, senao o `powershell.exe` 5.1,
   * que existe em qualquer Windows. Caminho absoluto de proposito — o `wt` resolve o
   * programa no PATH DELE, nao no nosso, e um `pwsh` fora do PATH do terminal viraria
   * "não foi possível abrir" sem explicacao.
   */
  #powershell(): string {
    return (
      noPath(['pwsh']) ||
      noPath(['powershell']) ||
      join(process.env['WINDIR'] ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    );
  }

  /**
   * Retaguarda de quem nao tem o Windows Terminal: `cmd /c start "" <programa> ...`.
   *
   * O `start` existe aqui por um motivo tecnico, nao por gosto: programa de console
   * lancado com `detached` e sem terminal fica SEM JANELA (o Windows nao cria console
   * para processo destacado), e o `start` e' o que cria. Como a linha passa a ser
   * reinterpretada pelo `cmd`, o caminho e' recusado quando tem operador dele dentro —
   * e' o unico ponto do arquivo com essa restricao.
   */
  #viaStart(
    args: string[],
    cwd: string,
    rotulo: string,
    extraEnv?: Record<string, string>,
  ): ResultadoFerramenta {
    // So' o CAMINHO e' verificado: os argumentos sao montados aqui e nenhum deles tem
    // operador do `cmd` (foi por confundir as duas coisas que o botao do Claude recusava
    // o proprio comando que o hub acabara' de montar).
    if (FALLBACK_CMD.test(cwd)) {
      throw new PedidoFerramentaError(
        'sem o Windows Terminal instalado, o caminho do repositório não pode conter & | < > ^ " % !',
      );
    }
    const cmd = join(process.env['WINDIR'] ?? 'C:\\Windows', 'System32', 'cmd.exe');
    // O `""` e' o titulo da janela: sem ele o `start` toma o primeiro argumento entre
    // aspas como titulo e nao executa nada.
    return this.#soltar(cmd, ['/c', 'start', '""', ...args], cwd, rotulo, extraEnv);
  }

  #soltar(
    exe: string,
    args: string[],
    cwd: string,
    rotulo: string,
    extraEnv?: Record<string, string>,
  ): ResultadoFerramenta {
    this.#lancar(exe, args, cwd, extraEnv);
    return { saida: `${rotulo} aberto em ${cwd}` };
  }

  abrir(ferramenta: string, caminho: string): ResultadoFerramenta {
    if (!ehFerramenta(ferramenta)) {
      throw new PedidoFerramentaError(`ferramenta desconhecida: ${ferramenta || '(vazia)'}`);
    }

    // A listagem do PATH e' memorizada dentro de uma resolucao, nunca entre cliques:
    // senao instalar o IntelliJ (ou o Windows Terminal) com o hub aberto nao teria
    // efeito ate' alguem reiniciar o backend.
    conteudoDePasta.clear();

    const alvo = caminho.trim();
    if (!alvo) throw new PedidoFerramentaError('informe o caminho da pasta');

    let ehPasta = false;
    try {
      ehPasta = statSync(alvo).isDirectory();
    } catch {
      ehPasta = false;
    }
    if (!ehPasta) throw new PedidoFerramentaError(`pasta não encontrada: ${alvo}`);

    if (ferramenta === 'terminal') return this.#terminal(alvo);
    if (ferramenta === 'intellij') return this.#intellij(alvo);
    return this.#claude(alvo);
  }
}
