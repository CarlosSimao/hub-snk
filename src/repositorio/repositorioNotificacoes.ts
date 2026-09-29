import type { Notificacao } from '../tipos.ts';

/**
 * Contrato de persistência das notificações do painel lateral.
 *
 * As chaves já emitidas vivem à parte da lista: limpar o painel não pode fazer a
 * verificação seguinte da agenda notificar de novo o mesmo evento do dia.
 */
export interface RepositorioNotificacoes {
  /** Da mais recente para a mais antiga. */
  listar(): Promise<Notificacao[]>;
  chaveJaEmitida(chave: string): Promise<boolean>;
  adicionar(notificacao: Notificacao): Promise<void>;
  /** Sem ids, marca todas. Devolve a lista já atualizada. */
  marcarComoLidas(ids?: readonly string[]): Promise<Notificacao[]>;
  /** Esvazia a lista, mas guarda as chaves emitidas. */
  limpar(): Promise<void>;
}
