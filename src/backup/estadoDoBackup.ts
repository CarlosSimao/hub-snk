import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * O que o backup lembra entre uma execução e outra, nesta máquina.
 *
 * `impressao` é o resumo dos dados no último backup feito (`impressaoDosDados`): com a
 * mesma impressão, nada mudou e não há o que copiar de novo.
 */
export interface EstadoDoBackup {
  local: {
    ultimoEm: string;
    impressao: string;
    /** Caminho do último arquivo gravado. */
    arquivo: string;
    erro: string;
  };
  drive: {
    ultimoEm: string;
    impressao: string;
    erro: string;
  };
}

const NOME_DO_ARQUIVO = 'estado.json';

function estadoInicial(): EstadoDoBackup {
  return {
    local: { ultimoEm: '', impressao: '', arquivo: '', erro: '' },
    drive: { ultimoEm: '', impressao: '', erro: '' },
  };
}

function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

function secao(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : {};
}

/** Arquivo próprio, fora da pasta de dados: o estado é da máquina e não entra no backup. */
export class ArquivoDeEstadoDoBackup {
  readonly #caminho: string;
  #estado: EstadoDoBackup | null = null;

  constructor(pastaDeEstado: string) {
    this.#caminho = join(pastaDeEstado, NOME_DO_ARQUIVO);
  }

  async ler(): Promise<EstadoDoBackup> {
    if (this.#estado) {
      return this.#estado;
    }

    let dados: Record<string, unknown> = {};
    try {
      dados = secao(JSON.parse(await readFile(this.#caminho, 'utf8')));
    } catch {
      // Sem arquivo ou ilegível, começa do zero: o pior que acontece é um backup a mais.
    }

    const local = secao(dados.local);
    const drive = secao(dados.drive);
    this.#estado = {
      local: {
        ultimoEm: texto(local.ultimoEm),
        impressao: texto(local.impressao),
        arquivo: texto(local.arquivo),
        erro: texto(local.erro),
      },
      drive: {
        ultimoEm: texto(drive.ultimoEm),
        impressao: texto(drive.impressao),
        erro: texto(drive.erro),
      },
    };
    return this.#estado;
  }

  async gravar(estado: EstadoDoBackup): Promise<void> {
    await mkdir(dirname(this.#caminho), { recursive: true });
    await writeFile(`${this.#caminho}.tmp`, JSON.stringify(estado, null, 2), 'utf8');
    await rename(`${this.#caminho}.tmp`, this.#caminho);
    this.#estado = estado;
  }

  /** Conta desconectada ou trocada: o que foi enviado à anterior não diz nada sobre a nova. */
  async esquecerDrive(): Promise<void> {
    const estado = await this.ler();
    await this.gravar({ ...estado, drive: estadoInicial().drive });
  }
}
