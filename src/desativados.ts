/**
 * Registro de projetos e checks com monitoramento desabilitado pelo painel.
 *
 * Mesmo padrao do `Cofre` (`segredos.ts`): arquivo proprio no `DATA_DIR`, escrita
 * atomica (tmp + rename), sobrevive a restart e a reload de config sem tocar no
 * `services.yaml` versionado.
 *
 * Desabilitar aqui e mais forte que `muted`: `muted` (campo do YAML) continua medindo
 * e so tira o check da conta do semaforo; isto para a execucao por completo — sem
 * timer, sem HTTP/TCP/etc, sem gravar amostra nova. O engine e quem decide o que fazer
 * com essa informacao; esta classe so guarda o estado.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ARQUIVO = 'desativados.json';

interface Documento {
  /** Ids de projeto com o monitoramento inteiro desabilitado. */
  services: string[];
  /** Ids de check desabilitado, indexados pelo id do projeto. */
  checks: Record<string, string[]>;
}

export class Desativados {
  readonly #caminho: string;
  #servicos = new Set<string>();
  #checks = new Map<string, Set<string>>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#caminho = join(dataDir, ARQUIVO);
    this.#carregar();
  }

  #carregar(): void {
    if (!existsSync(this.#caminho)) return;

    try {
      const bruto = JSON.parse(readFileSync(this.#caminho, 'utf8')) as Partial<Documento>;

      if (Array.isArray(bruto.services)) {
        this.#servicos = new Set(bruto.services.filter((id): id is string => typeof id === 'string'));
      }

      if (bruto.checks && typeof bruto.checks === 'object' && !Array.isArray(bruto.checks)) {
        for (const [serviceId, ids] of Object.entries(bruto.checks)) {
          if (!Array.isArray(ids)) continue;
          const limpos = ids.filter((id): id is string => typeof id === 'string');
          if (limpos.length) this.#checks.set(serviceId, new Set(limpos));
        }
      }
    } catch {
      // Arquivo ilegivel vira "nada desabilitado" — recuperavel, ao contrario de
      // abortar o boot do hub por causa de um JSON corrompido.
      this.#servicos = new Set();
      this.#checks = new Map();
    }
  }

  servicoDesabilitado(serviceId: string): boolean {
    return this.#servicos.has(serviceId);
  }

  checkDesabilitado(serviceId: string, checkId: string): boolean {
    return this.#checks.get(serviceId)?.has(checkId) ?? false;
  }

  definirServico(serviceId: string, desabilitado: boolean): void {
    if (desabilitado) this.#servicos.add(serviceId);
    else this.#servicos.delete(serviceId);
    this.#persistir();
  }

  definirCheck(serviceId: string, checkId: string, desabilitado: boolean): void {
    const atual = this.#checks.get(serviceId) ?? new Set<string>();

    if (desabilitado) atual.add(checkId);
    else atual.delete(checkId);

    if (atual.size) this.#checks.set(serviceId, atual);
    else this.#checks.delete(serviceId);

    this.#persistir();
  }

  #persistir(): void {
    const doc: Documento = {
      services: [...this.#servicos],
      checks: Object.fromEntries([...this.#checks].map(([id, s]) => [id, [...s]])),
    };

    const temporario = `${this.#caminho}.tmp`;
    writeFileSync(temporario, JSON.stringify(doc, null, 2), 'utf8');
    renameSync(temporario, this.#caminho);
  }
}
