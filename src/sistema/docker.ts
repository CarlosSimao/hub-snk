import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lancarPrimeiroQueSubir, type Candidato } from './lancarProcesso.ts';

/**
 * Controle de container Docker do banco de dados local — `docker start/stop/
 * restart` pelo nome do container, mais uma checagem de situação em dois
 * níveis: o container está rodando (`docker inspect`) e, se estiver, o banco
 * dentro dele responde login com as credenciais cadastradas (`docker exec` +
 * `sqlplus`, presente nas imagens Oracle usadas pelo Sankhya).
 *
 * Todo comando depende do daemon estar de pé, e o cliente `docker` não o sobe
 * sozinho — por isso as ações que ligam o banco garantem o daemon antes,
 * iniciando o Docker e esperando ele atender. O que é "iniciar o Docker" muda
 * de sistema: aplicativo no Windows e no macOS, serviço de usuário do systemd
 * no Linux.
 */

/*
 * Vale só para a checagem do daemon feita antes das ações manuais (ligar e
 * reiniciar container). As checagens de situação, que rodam periodicamente,
 * recebem o tempo limite da configuração global.
 */
const TEMPO_LIMITE_DA_CHECAGEM_DO_DAEMON_MS = 5000;
const INTERVALO_DE_ESPERA_DO_DAEMON_MS = 3000;
const TENTATIVAS_MAXIMAS_DE_ESPERA_DO_DAEMON = 60;

export class DockerComandoFalhouError extends Error {
  constructor(comando: string, saida: string) {
    super(`${comando} falhou: ${saida || 'sem saída'}`);
    this.name = 'DockerComandoFalhouError';
  }
}

export class DockerDesktopIndisponivelError extends Error {
  constructor(motivo: string) {
    super(`Não foi possível iniciar o Docker: ${motivo}`);
    this.name = 'DockerDesktopIndisponivelError';
  }
}

function executarEAguardar(
  argumentos: string[],
  opcoes: { tempoLimiteMs?: number; entradaPadrao?: string } = {},
): Promise<string> {
  const { tempoLimiteMs, entradaPadrao } = opcoes;

  return new Promise((resolver, rejeitar) => {
    const processo = spawn('docker', argumentos, { windowsHide: true });

    if (entradaPadrao !== undefined) {
      processo.stdin?.end(entradaPadrao);
    }

    let saida = '';
    let finalizadoPorTempoLimite = false;
    const temporizador = tempoLimiteMs
      ? setTimeout(() => {
          finalizadoPorTempoLimite = true;
          processo.kill();
        }, tempoLimiteMs)
      : null;

    processo.stdout?.on('data', (dado: Buffer) => {
      saida += dado.toString();
    });
    processo.stderr?.on('data', (dado: Buffer) => {
      saida += dado.toString();
    });

    processo.once('error', (erro) => {
      if (temporizador) clearTimeout(temporizador);
      rejeitar(erro);
    });

    processo.once('close', (codigo) => {
      if (temporizador) clearTimeout(temporizador);

      if (finalizadoPorTempoLimite) {
        rejeitar(new DockerComandoFalhouError(argumentos.join(' '), 'tempo limite excedido'));
        return;
      }

      if (codigo === 0) {
        resolver(saida.trim());
      } else {
        rejeitar(new DockerComandoFalhouError(argumentos.join(' '), saida.trim()));
      }
    });
  });
}

function esperar(tempoMs: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, tempoMs));
}

/**
 * O daemon responde `docker version` com a seção `Server` só quando está de
 * pé — com o Docker Desktop parado, o cliente falha ao abrir o named pipe.
 */
async function daemonEstaAtivo(): Promise<boolean> {
  try {
    const versaoDoServidor = await executarEAguardar(
      ['version', '--format', '{{.Server.Version}}'],
      { tempoLimiteMs: TEMPO_LIMITE_DA_CHECAGEM_DO_DAEMON_MS },
    );
    return versaoDoServidor !== '';
  } catch {
    return false;
  }
}

/**
 * Caminhos de instalação do Docker Desktop no Windows: o instalador atual é
 * por usuário (`Programs\DockerDesktop`), mas as instalações antigas ficam em
 * `Program Files` ou no `LOCALAPPDATA` sem `Programs`.
 */
function caminhosDoDockerDesktopNoWindows(): string[] {
  const dadosLocais = process.env.LOCALAPPDATA;
  const arquivosDeProgramas = process.env.ProgramFiles;

  const caminhos = [
    dadosLocais && join(dadosLocais, 'Programs', 'DockerDesktop', 'Docker Desktop.exe'),
    arquivosDeProgramas && join(arquivosDeProgramas, 'Docker', 'Docker', 'Docker Desktop.exe'),
    dadosLocais && join(dadosLocais, 'Docker', 'Docker Desktop.exe'),
  ];

  return caminhos.filter((caminho): caminho is string => Boolean(caminho));
}

/**
 * No Linux não há aplicativo para abrir: o Docker Desktop e o modo rootless são
 * serviços de usuário do systemd, e sobem sem root. Ficam nesta ordem porque o
 * `docker-desktop` é o caso equivalente ao dos outros dois sistemas.
 *
 * O Docker Engine instalado como serviço do sistema fica de fora de propósito:
 * subi-lo exige um privilégio que o HUB SNK não tem, e pedir senha numa janela
 * que ninguém está vendo não levaria a nada. Ele também costuma já estar no ar,
 * porque é habilitado no boot.
 */
const SERVICOS_DE_USUARIO_DO_LINUX = ['docker-desktop', 'docker'];

function candidatosParaIniciarODocker(): Candidato[] {
  if (process.platform === 'win32') {
    const executavel = caminhosDoDockerDesktopNoWindows().find((caminho) => existsSync(caminho));
    if (!executavel) {
      throw new DockerDesktopIndisponivelError(
        'executável do Docker Desktop não encontrado nos caminhos padrão de instalação.',
      );
    }

    return [{ comando: executavel, argumentos: [] }];
  }

  if (process.platform === 'darwin') {
    return [{ comando: 'open', argumentos: ['-a', 'Docker'] }];
  }

  if (process.platform === 'linux') {
    return SERVICOS_DE_USUARIO_DO_LINUX.map((servico) => ({
      comando: 'systemctl',
      argumentos: ['--user', 'start', servico],
    }));
  }

  throw new DockerDesktopIndisponivelError(
    `inicialização automática não suportada em ${process.platform}. Inicie o serviço do Docker manualmente.`,
  );
}

/**
 * Sobe o Docker e volta assim que ele deu sinal de ter iniciado — quem espera o
 * daemon atender é `garantirDaemonAtivo`.
 *
 * O aplicativo do Windows e do macOS continua vivo depois da resposta HTTP e
 * fica solto do servidor; o `systemctl` do Linux é o oposto, termina em
 * seguida, e o código de saída dele é o que separa serviço iniciado de unidade
 * inexistente. `lancarProcesso` cobre os dois casos.
 */
async function iniciarODocker(): Promise<void> {
  if (await lancarPrimeiroQueSubir(candidatosParaIniciarODocker())) {
    return;
  }

  throw new DockerDesktopIndisponivelError(
    process.platform === 'linux'
      ? 'nenhum serviço de usuário do Docker respondeu. Se o Docker Engine roda como serviço do sistema, ' +
          'suba-o com "sudo systemctl start docker".'
      : 'o Docker Desktop não chegou a iniciar.',
  );
}

/**
 * Sobe o Docker quando o daemon não responde e espera ele atender — a primeira
 * subida da VM leva bem mais que alguns segundos, então a espera é longa de
 * propósito. Sem isso, `docker start` falha com erro de named pipe.
 */
export async function garantirDaemonAtivo(): Promise<void> {
  if (await daemonEstaAtivo()) {
    return;
  }

  await iniciarODocker();

  for (let tentativa = 0; tentativa < TENTATIVAS_MAXIMAS_DE_ESPERA_DO_DAEMON; tentativa++) {
    await esperar(INTERVALO_DE_ESPERA_DO_DAEMON_MS);

    if (await daemonEstaAtivo()) {
      return;
    }
  }

  throw new DockerDesktopIndisponivelError(
    'o daemon não respondeu depois de iniciar o Docker Desktop. Verifique o Docker e tente novamente.',
  );
}

export async function iniciarContainer(container: string): Promise<void> {
  await garantirDaemonAtivo();
  await executarEAguardar(['start', container]);
}

export async function pararContainer(container: string): Promise<void> {
  await executarEAguardar(['stop', container]);
}

export async function reiniciarContainer(container: string): Promise<void> {
  await garantirDaemonAtivo();
  await executarEAguardar(['restart', container]);
}

/** `false` tanto para container parado quanto para container inexistente — não distingue os dois casos. */
export async function containerEstaRodando(
  container: string,
  tempoLimiteMs: number,
): Promise<boolean> {
  try {
    const saida = await executarEAguardar(
      ['inspect', '--format', '{{.State.Running}}', container],
      { tempoLimiteMs },
    );

    return saida === 'true';
  } catch {
    return false;
  }
}

/**
 * Login via `sqlplus` dentro do próprio container — evita adicionar driver
 * Oracle ao HUB SNK só para essa checagem. Assume listener ouvindo na mesma
 * porta cadastrada, dentro do container (`localhost:porta`).
 */
export async function bancoEstaAcessivel(
  dados: {
    container: string;
    porta: number;
    nomeDoServico: string;
    usuario: string;
    senha: string;
  },
  tempoLimiteMs: number,
): Promise<boolean> {
  const stringDeConexao = `${dados.usuario}/${dados.senha}@//localhost:${dados.porta}/${dados.nomeDoServico}`;

  try {
    const saida = await executarEAguardar(
      ['exec', '-i', dados.container, 'sqlplus', '-L', '-S', stringDeConexao],
      { tempoLimiteMs, entradaPadrao: 'select 1 from dual;\nexit;\n' },
    );
    return !/ORA-\d{4,5}/.test(saida);
  } catch {
    return false;
  }
}
