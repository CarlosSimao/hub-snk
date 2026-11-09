import type { DecisaoDeCobranca } from '../tipos.ts';

/**
 * O que o usuário decidiu para a cobrança de cada evento da agenda (`DecisaoDeCobranca`).
 * A identificação é a mesma da chave do alerta: `nuevento`, ou `codparc-inicio` para
 * evento sem número. Evento fora do mapa é cobrado normalmente.
 */
export interface RepositorioEventosSemCobranca {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  listar(): Promise<Map<string, DecisaoDeCobranca>>;
  /** `null` apaga a decisão: o evento volta a ser cobrado normalmente. */
  definir(identificacao: string, decisao: DecisaoDeCobranca | null): Promise<void>;
}
