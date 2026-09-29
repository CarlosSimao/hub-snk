/**
 * Serializa as operações de um repositório: cada uma só começa depois que a
 * anterior terminou, com sucesso ou erro. Sem a fila, duas requisições leem o
 * mesmo arquivo, alteram cópias diferentes e a última gravação apaga a outra.
 */
export class FilaDeOperacoes {
  #ultimaOperacao: Promise<unknown> = Promise.resolve();

  enfileirar<T>(tarefa: () => Promise<T>): Promise<T> {
    const resultado = this.#ultimaOperacao.then(tarefa, tarefa);
    // O erro chega a quem chamou por `resultado`; aqui só não pode travar a próxima da fila.
    this.#ultimaOperacao = resultado.catch(() => undefined);
    return resultado;
  }
}
