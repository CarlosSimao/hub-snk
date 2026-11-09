import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * O que o alerta da agenda lembra entre uma abertura do HUB e outra, nesta máquina.
 *
 * `ultimaVerificacaoEm` (ISO) faz a periodicidade valer mesmo depois de reabrir o HUB.
 * `emailsAoGestor` guarda `<evento>#<dia>` dos e-mails que já copiaram o gestor: um por
 * dia, mesmo com a repetição ligada ou o HUB reaberto.
 */
export interface EstadoDoAlertaDaAgenda {
  ultimaVerificacaoEm: string;
  emailsAoGestor: string[];
}

/** O que o verificador usa; o arquivo é só uma das formas de guardar. */
export interface GuardaDoEstadoDoAlerta {
  ler(): Promise<EstadoDoAlertaDaAgenda>;
  gravar(estado: EstadoDoAlertaDaAgenda): Promise<void>;
}

const NOME_DO_ARQUIVO = 'estado.json';

function secao(valor: unknown): Record<string, unknown> {
  return typeof valor === 'object' && valor !== null ? (valor as Record<string, unknown>) : {};
}

/** Arquivo próprio, fora da pasta de dados: o estado é da máquina e não entra no backup. */
export class ArquivoDeEstadoDoAlertaDaAgenda implements GuardaDoEstadoDoAlerta {
  readonly #caminho: string;
  #estado: EstadoDoAlertaDaAgenda | null = null;

  constructor(pastaDeEstado: string) {
    this.#caminho = join(pastaDeEstado, NOME_DO_ARQUIVO);
  }

  async ler(): Promise<EstadoDoAlertaDaAgenda> {
    if (this.#estado) {
      return this.#estado;
    }

    let dados: Record<string, unknown> = {};
    try {
      dados = secao(JSON.parse(await readFile(this.#caminho, 'utf8')));
    } catch {
      // Sem arquivo ou ilegível, começa do zero: o pior que acontece é uma verificação a mais.
    }

    this.#estado = {
      ultimaVerificacaoEm:
        typeof dados.ultimaVerificacaoEm === 'string' ? dados.ultimaVerificacaoEm : '',
      emailsAoGestor: Array.isArray(dados.emailsAoGestor)
        ? dados.emailsAoGestor.filter((item): item is string => typeof item === 'string')
        : [],
    };
    return this.#estado;
  }

  async gravar(estado: EstadoDoAlertaDaAgenda): Promise<void> {
    await mkdir(dirname(this.#caminho), { recursive: true });
    await writeFile(`${this.#caminho}.tmp`, JSON.stringify(estado, null, 2), 'utf8');
    await rename(`${this.#caminho}.tmp`, this.#caminho);
    this.#estado = estado;
  }
}
