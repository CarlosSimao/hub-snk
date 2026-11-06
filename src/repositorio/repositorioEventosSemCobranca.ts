/**
 * Eventos da agenda que o usuário marcou para o alerta não cobrar tarefa na Experience
 * (reunião interna, atendimento sem OS). A identificação é a mesma da chave do alerta:
 * `nuevento`, ou `codparc-inicio` para evento sem número.
 */
export interface RepositorioEventosSemCobranca {
  /** Mesmo motivo do `descartarCache` de `RepositorioClientes`: pasta sincronizada. */
  descartarCache(): void;

  listar(): Promise<Set<string>>;
  /** Idempotente: marcar o que já está marcado, ou desmarcar o que não está, não é erro. */
  definir(identificacao: string, naoCobrar: boolean): Promise<void>;
}
