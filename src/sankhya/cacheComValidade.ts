/**
 * Cache em memória por chave, com prazo de validade. Guarda a promessa, não o valor: duas
 * consultas da mesma chave ao mesmo tempo viram uma só. Consulta que falha não fica
 * guardada, para a próxima tentar de novo.
 */
export class CacheComValidade<Chave, Valor> {
  readonly #validadeMs: number;
  readonly #agora: () => number;
  readonly #entradas = new Map<Chave, { valor: Promise<Valor>; expiraEm: number }>();

  constructor(validadeMs: number, agora: () => number = Date.now) {
    this.#validadeMs = validadeMs;
    this.#agora = agora;
  }

  obter(chave: Chave, buscar: () => Promise<Valor>): Promise<Valor> {
    const entrada = this.#entradas.get(chave);
    if (entrada && entrada.expiraEm > this.#agora()) {
      return entrada.valor;
    }

    const valor = buscar();
    this.#entradas.set(chave, { valor, expiraEm: this.#agora() + this.#validadeMs });
    valor.catch(() => {
      // Só apaga se a entrada ainda for esta: um `descartarTudo` seguido de nova busca não perde a nova.
      if (this.#entradas.get(chave)?.valor === valor) {
        this.#entradas.delete(chave);
      }
    });
    return valor;
  }

  descartarTudo(): void {
    this.#entradas.clear();
  }
}
