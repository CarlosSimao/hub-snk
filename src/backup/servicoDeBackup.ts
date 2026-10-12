/**
 * Backup dos dados do HUB SNK: o periódico, numa pasta do computador, e a cópia mantida
 * no Google Drive conectado. Os dois gravam o mesmo pacote (`pacoteDeDados.ts`) e só
 * quando os dados mudaram.
 *
 * A cópia do Drive é de mão única: o HUB SNK envia e nunca baixa sozinho. Trazer de
 * volta é a restauração, pedida na tela.
 */
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArquivoGuardado, ClienteDoDrive } from '../drive/clienteDoDrive.ts';
import type { SituacaoDaConta } from '../drive/contaDoGoogle.ts';
import type { DadosDeNotificacao } from '../notificacoes/centralDeNotificacoes.ts';
import { dataIsoLocal } from '../notificacoes/relogio.ts';
import { FilaDeOperacoes } from '../repositorio/arquivo/filaDeOperacoes.ts';
import type { ConfiguracaoDeBackup } from '../tipos.ts';
import { ArquivoDeEstadoDoBackup, type EstadoDoBackup } from './estadoDoBackup.ts';
import {
  conferirPacote,
  impressaoDosDados,
  montarPacote,
  type ManifestoDoPacote,
} from './pacoteDeDados.ts';
import {
  agendarRestauracao,
  cancelarRestauracao,
  restauracaoAgendada,
} from './restauracaoPendente.ts';

const INTERVALO_DA_CONFERENCIA_MS = 60_000;
const MILISSEGUNDOS_POR_HORA = 3_600_000;
/** Depois de uma falha, a próxima tentativa automática espera: pasta fora do ar não melhora em um minuto. */
const ESPERA_APOS_FALHA_MS = 10 * 60_000;
/** Menor espaço entre dois envios automáticos ao Drive, por mais que os dados mudem. */
const ESPERA_ENTRE_ENVIOS_AO_DRIVE_MS = 10 * 60_000;

const PREFIXO_DO_BACKUP = 'hub-snk-backup-';
const NOME_DE_BACKUP = /^hub-snk-backup-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/;
const NOME_DA_PASTA_NO_DRIVE = 'HUB SNK';
const TIPO_ZIP = 'application/zip';

export class BackupSemPastaError extends Error {
  constructor() {
    super('Escolha a pasta do backup antes de fazer um.');
    this.name = 'BackupSemPastaError';
  }
}

export class CopiaDoDriveNaoEncontradaError extends Error {
  constructor() {
    super('Esta cópia não está mais no Google Drive.');
    this.name = 'CopiaDoDriveNaoEncontradaError';
  }
}

export interface SituacaoDoBackup {
  configuracao: ConfiguracaoDeBackup;
  local: { ultimoEm: string; arquivo: string; erro: string };
  drive: { ultimoEm: string; erro: string; nomeDoArquivo: string };
  /** Backup escolhido para restaurar, à espera do reinício do HUB SNK. */
  restauracaoPendente: { geradoEm: string } | null;
}

interface Registrador {
  info(mensagem: string): void;
  warn(mensagem: string): void;
}

type DriveDoBackup = Pick<
  ClienteDoDrive,
  'garantirPastaDoHub' | 'listarArquivosGuardados' | 'enviarArquivo' | 'baixarArquivo'
>;

interface Dependencias {
  diretorioDeDados: string;
  pastaDeEstado: string;
  versaoDoAplicativo: string;
  /** Duas máquinas na mesma conta guardam cada uma a sua cópia, sem uma apagar a da outra. */
  nomeDaMaquina: string;
  lerConfiguracao: () => Promise<ConfiguracaoDeBackup>;
  conta: { situacao(): Promise<SituacaoDaConta> };
  drive: DriveDoBackup;
  agora: () => Date;
  registrador: Registrador;
  emitirNotificacao?: (dados: DadosDeNotificacao) => Promise<unknown>;
}

function doisDigitos(valor: number): string {
  return String(valor).padStart(2, '0');
}

/** `hub-snk-backup-AAAA-MM-DD-HHmm.zip`, no horário da máquina: a ordem dos nomes é a das datas. */
export function nomeDoBackup(data: Date): string {
  const hora = `${doisDigitos(data.getHours())}${doisDigitos(data.getMinutes())}`;
  return `${PREFIXO_DO_BACKUP}${dataIsoLocal(data)}-${hora}.zip`;
}

/** O nome da máquina vira parte do nome do arquivo no Drive: só o que não dá problema lá. */
export function nomeDaCopiaNoDrive(nomeDaMaquina: string): string {
  const limpo = nomeDaMaquina.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `hub-snk-dados-${limpo || 'computador'}.zip`;
}

function descreverErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

export class ServicoDeBackup {
  readonly #dependencias: Dependencias;
  readonly #estado: ArquivoDeEstadoDoBackup;
  /** Um backup por vez: dois ao mesmo tempo gravariam o estado um por cima do outro. */
  readonly #fila = new FilaDeOperacoes();
  #temporizador: NodeJS.Timeout | null = null;
  #impressaoDaConferenciaAnterior = '';
  #proximaTentativaLocalMs = 0;
  #proximaTentativaNoDriveMs = 0;

  constructor(dependencias: Dependencias) {
    this.#dependencias = dependencias;
    this.#estado = new ArquivoDeEstadoDoBackup(dependencias.pastaDeEstado);
  }

  iniciar(): void {
    this.#temporizador = setInterval(() => {
      void this.conferir().catch((erro: unknown) => {
        this.#dependencias.registrador.warn(`Conferência do backup falhou: ${descreverErro(erro)}`);
      });
    }, INTERVALO_DA_CONFERENCIA_MS);
    this.#temporizador.unref();
  }

  parar(): void {
    if (this.#temporizador) {
      clearInterval(this.#temporizador);
      this.#temporizador = null;
    }
  }

  /**
   * Uma rodada do agendador: faz o que está vencido e mudou. Falha de um dos dois não
   * impede o outro, e fica registrada no estado, para a tela mostrar.
   */
  conferir(): Promise<void> {
    return this.#fila.enfileirar(async () => {
      const { diretorioDeDados, lerConfiguracao, agora } = this.#dependencias;
      const configuracao = await lerConfiguracao();
      if (!this.#backupLocalLigado(configuracao) && !configuracao.espelharNoDrive) {
        return;
      }

      const impressao = await impressaoDosDados(diretorioDeDados);
      const estado = await this.#estado.ler();
      const agoraMs = agora().getTime();

      if (this.#backupLocalVencido(configuracao, estado, impressao, agoraMs)) {
        await this.#tentar('local', () => this.#gravarBackupLocal(configuracao));
      }

      // Só envia o que parou de mudar: no meio de uma sequência de gravações, cada
      // conferência subiria um pacote que a seguinte já deixaria velho.
      const estavel = impressao === this.#impressaoDaConferenciaAnterior;
      this.#impressaoDaConferenciaAnterior = impressao;
      if (
        configuracao.espelharNoDrive &&
        estavel &&
        impressao !== estado.drive.impressao &&
        agoraMs >= this.#proximaTentativaNoDriveMs &&
        (await this.#contaPodeGuardarCopia())
      ) {
        await this.#tentar('drive', () => this.#enviarCopiaAoDrive());
      }
    });
  }

  /** Pedido pela tela: grava agora, tenham os dados mudado ou não. */
  fazerBackupLocal(): Promise<{ arquivo: string }> {
    return this.#fila.enfileirar(async () => {
      const configuracao = await this.#dependencias.lerConfiguracao();
      if (!configuracao.pasta) {
        throw new BackupSemPastaError();
      }
      return this.#registrandoFalha('local', () => this.#gravarBackupLocal(configuracao));
    });
  }

  /** Pedido pela tela: envia agora, tenham os dados mudado ou não. */
  enviarAoDrive(): Promise<void> {
    return this.#fila.enfileirar(() =>
      this.#registrandoFalha('drive', () => this.#enviarCopiaAoDrive()),
    );
  }

  /** As cópias guardadas no Drive — uma por máquina que usa a conta. */
  async copiasNoDrive(): Promise<ArquivoGuardado[]> {
    const { drive } = this.#dependencias;
    return drive.listarArquivosGuardados(await drive.garantirPastaDoHub(NOME_DA_PASTA_NO_DRIVE));
  }

  /** Baixa a cópia do Drive e a deixa à espera do reinício. */
  async prepararRestauracaoDoDrive(idDoArquivo: string): Promise<ManifestoDoPacote> {
    // O id vem da requisição: só vale o de uma cópia que o HUB SNK guardou.
    const copias = await this.copiasNoDrive();
    if (!copias.some((copia) => copia.id === idDoArquivo)) {
      throw new CopiaDoDriveNaoEncontradaError();
    }
    return this.#agendar(await this.#dependencias.drive.baixarArquivo(idDoArquivo));
  }

  /** Deixa um arquivo de backup do computador à espera do reinício. */
  async prepararRestauracaoDoArquivo(caminho: string): Promise<ManifestoDoPacote> {
    return this.#agendar(await readFile(caminho));
  }

  async cancelarRestauracao(): Promise<void> {
    await cancelarRestauracao(this.#dependencias.pastaDeEstado);
  }

  /** Conta desconectada: a próxima conexão pode ser de outra conta, com outra pasta. */
  async esquecerDrive(): Promise<void> {
    await this.#fila.enfileirar(() => this.#estado.esquecerDrive());
  }

  async situacao(): Promise<SituacaoDoBackup> {
    const { lerConfiguracao, pastaDeEstado, nomeDaMaquina } = this.#dependencias;
    const [configuracao, estado, pendente] = await Promise.all([
      lerConfiguracao(),
      this.#estado.ler(),
      restauracaoAgendada(pastaDeEstado),
    ]);

    return {
      configuracao,
      local: {
        ultimoEm: estado.local.ultimoEm,
        arquivo: estado.local.arquivo,
        erro: estado.local.erro,
      },
      drive: {
        ultimoEm: estado.drive.ultimoEm,
        erro: estado.drive.erro,
        nomeDoArquivo: nomeDaCopiaNoDrive(nomeDaMaquina),
      },
      restauracaoPendente: pendente ? { geradoEm: pendente.geradoEm } : null,
    };
  }

  #backupLocalLigado(configuracao: ConfiguracaoDeBackup): boolean {
    return configuracao.ativo && configuracao.pasta !== '';
  }

  #backupLocalVencido(
    configuracao: ConfiguracaoDeBackup,
    estado: EstadoDoBackup,
    impressao: string,
    agoraMs: number,
  ): boolean {
    if (!this.#backupLocalLigado(configuracao) || agoraMs < this.#proximaTentativaLocalMs) {
      return false;
    }
    // Cópia idêntica à anterior só empurraria uma versão diferente para fora das mantidas.
    if (impressao === estado.local.impressao) {
      return false;
    }
    const ultimoMs = estado.local.ultimoEm ? Date.parse(estado.local.ultimoEm) : 0;
    return agoraMs - ultimoMs >= configuracao.intervaloHoras * MILISSEGUNDOS_POR_HORA;
  }

  async #contaPodeGuardarCopia(): Promise<boolean> {
    const conta = await this.#dependencias.conta.situacao();
    return conta.conectado && conta.podeGuardarCopia;
  }

  async #agendar(pacote: Buffer): Promise<ManifestoDoPacote> {
    const manifesto = conferirPacote(pacote);
    await agendarRestauracao(this.#dependencias.pastaDeEstado, pacote);
    return manifesto;
  }

  async #gravarBackupLocal(configuracao: ConfiguracaoDeBackup): Promise<{ arquivo: string }> {
    const { diretorioDeDados, versaoDoAplicativo, agora, registrador } = this.#dependencias;
    const momento = agora();
    // A impressão é tirada antes do pacote: o que mudar durante a montagem fica para o próximo.
    const impressao = await impressaoDosDados(diretorioDeDados);
    const pacote = await montarPacote({ diretorioDeDados, versaoDoAplicativo, agora: momento });

    await mkdir(configuracao.pasta, { recursive: true });
    const arquivo = join(configuracao.pasta, nomeDoBackup(momento));
    // Grava ao lado e renomeia: quem sincroniza a pasta com a nuvem nunca vê meio arquivo.
    await writeFile(`${arquivo}.tmp`, pacote);
    await rename(`${arquivo}.tmp`, arquivo);
    await this.#descartarBackupsAntigos(configuracao);

    const estado = await this.#estado.ler();
    await this.#estado.gravar({
      ...estado,
      local: { ultimoEm: momento.toISOString(), impressao, arquivo, erro: '' },
    });
    registrador.info(`Backup gravado em ${arquivo}`);
    return { arquivo };
  }

  /** Só os arquivos com o nome que o HUB SNK dá: o resto da pasta não é dele para apagar. */
  async #descartarBackupsAntigos(configuracao: ConfiguracaoDeBackup): Promise<void> {
    const backups = (await readdir(configuracao.pasta))
      .filter((nome) => NOME_DE_BACKUP.test(nome))
      .sort()
      .reverse();
    for (const nome of backups.slice(configuracao.copiasMantidas)) {
      await rm(join(configuracao.pasta, nome), { force: true });
    }
  }

  async #enviarCopiaAoDrive(): Promise<void> {
    const { diretorioDeDados, versaoDoAplicativo, nomeDaMaquina, drive, agora, registrador } =
      this.#dependencias;
    const momento = agora();
    const impressao = await impressaoDosDados(diretorioDeDados);
    const pacote = await montarPacote({ diretorioDeDados, versaoDoAplicativo, agora: momento });
    const nome = nomeDaCopiaNoDrive(nomeDaMaquina);

    /*
     * A pasta e o arquivo são procurados a cada envio, em vez de lembrados: o usuário
     * pode ter apagado um dos dois no Drive, e gravar por cima de um arquivo que está na
     * lixeira o deixaria lá, a caminho de ser excluído.
     */
    const idDaPasta = await drive.garantirPastaDoHub(NOME_DA_PASTA_NO_DRIVE);
    const existente = (await drive.listarArquivosGuardados(idDaPasta)).find(
      (arquivo) => arquivo.nome === nome,
    );
    await drive.enviarArquivo({
      idDaPasta,
      idDoArquivo: existente?.id,
      nome,
      tipo: TIPO_ZIP,
      conteudo: pacote,
    });

    await this.#estado.gravar({
      ...(await this.#estado.ler()),
      drive: { ultimoEm: momento.toISOString(), impressao, erro: '' },
    });
    registrador.info(`Cópia dos dados enviada ao Google Drive (${nome})`);
  }

  /** Falha de execução pedida pela tela: fica no estado e volta para quem pediu. */
  async #registrandoFalha<T>(tipo: 'local' | 'drive', acao: () => Promise<T>): Promise<T> {
    try {
      return await acao();
    } catch (erro) {
      await this.#gravarErro(tipo, descreverErro(erro));
      throw erro;
    }
  }

  /** Falha de execução automática: fica no estado, vira notificação e adia a próxima tentativa. */
  async #tentar(tipo: 'local' | 'drive', acao: () => Promise<unknown>): Promise<void> {
    const { agora, registrador } = this.#dependencias;
    try {
      await acao();
      if (tipo === 'drive') {
        this.#proximaTentativaNoDriveMs = agora().getTime() + ESPERA_ENTRE_ENVIOS_AO_DRIVE_MS;
      }
    } catch (erro) {
      const mensagem = descreverErro(erro);
      const proxima = agora().getTime() + ESPERA_APOS_FALHA_MS;
      if (tipo === 'local') {
        this.#proximaTentativaLocalMs = proxima;
      } else {
        this.#proximaTentativaNoDriveMs = proxima;
      }
      registrador.warn(`Backup (${tipo}) falhou: ${mensagem}`);
      await this.#gravarErro(tipo, mensagem);
      await this.#avisarFalha(tipo, mensagem);
    }
  }

  async #gravarErro(tipo: 'local' | 'drive', erro: string): Promise<void> {
    const estado = await this.#estado.ler();
    await this.#estado
      .gravar({ ...estado, [tipo]: { ...estado[tipo], erro } })
      .catch(() => undefined);
  }

  /** Uma notificação por dia e por tipo: a falha que se repete a cada dez minutos não vira enxurrada. */
  async #avisarFalha(tipo: 'local' | 'drive', mensagem: string): Promise<void> {
    const { emitirNotificacao, agora } = this.#dependencias;
    await emitirNotificacao?.({
      origem: 'sistema',
      chave: `backup-${tipo}-falhou:${dataIsoLocal(agora())}`,
      titulo:
        tipo === 'local'
          ? 'O backup dos dados não foi feito'
          : 'A cópia no Google Drive não foi atualizada',
      mensagem,
      enviarEmail: false,
    }).catch(() => undefined);
  }
}
