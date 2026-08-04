/**
 * Overrides de intervalo e timeout por check, definidos pelo formulario "Configurações"
 * do painel.
 *
 * Mesmo padrao do `Cofre`/`Desativados`: arquivo proprio no `DATA_DIR`, escrita atomica
 * (tmp + rename), sobrevive a restart e a reload de config sem tocar no `services.yaml`
 * versionado. So guarda o que o usuario mudou explicitamente — ausencia de override usa
 * o valor definido no YAML.
 */
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ARQUIVO = 'configuracoes-check.json';

export interface OverrideCheck {
  intervalMs: number;
  timeoutMs: number;
}

export class ConfiguracoesCheck {
  readonly #caminho: string;
  /** `{ idDoProjeto: { idDoCheck: override } }` — mesmo espaco de nomes por projeto do Cofre. */
  #porProjeto: Record<string, Record<string, OverrideCheck>> = {};

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#caminho = join(dataDir, ARQUIVO);
    this.#carregar();
  }

  #carregar(): void {
    if (!existsSync(this.#caminho)) return;

    try {
      const bruto = JSON.parse(readFileSync(this.#caminho, 'utf8')) as unknown;
      if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return;

      for (const [serviceId, checks] of Object.entries(bruto as Record<string, unknown>)) {
        if (!checks || typeof checks !== 'object' || Array.isArray(checks)) continue;

        const limpos: Record<string, OverrideCheck> = {};
        for (const [checkId, override] of Object.entries(checks as Record<string, unknown>)) {
          const validado = validarOverride(override);
          if (validado) limpos[checkId] = validado;
        }
        if (Object.keys(limpos).length) this.#porProjeto[serviceId] = limpos;
      }
    } catch {
      // Arquivo ilegivel vira "nenhum override" — recuperavel, ao contrario de abortar
      // o boot do hub por causa de um JSON corrompido.
      this.#porProjeto = {};
    }
  }

  overridesDe(serviceId: string, checkId: string): OverrideCheck | undefined {
    return this.#porProjeto[serviceId]?.[checkId];
  }

  definir(serviceId: string, checkId: string, override: OverrideCheck): void {
    const atual = { ...this.#porProjeto[serviceId] };
    atual[checkId] = override;
    this.#porProjeto[serviceId] = atual;
    this.#persistir();
  }

  #persistir(): void {
    const temporario = `${this.#caminho}.tmp`;
    writeFileSync(temporario, JSON.stringify(this.#porProjeto, null, 2), 'utf8');
    renameSync(temporario, this.#caminho);
  }
}

function validarOverride(value: unknown): OverrideCheck | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Number.isInteger(v.intervalMs) || !Number.isInteger(v.timeoutMs)) return null;
  return { intervalMs: v.intervalMs as number, timeoutMs: v.timeoutMs as number };
}
