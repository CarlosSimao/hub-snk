/**
 * `Promise.all` com teto de tarefas em andamento, na ordem de entrada. Cada
 * trabalhador puxa o próximo item até a lista acabar.
 *
 * Existe por causa dos processos `git`: disparar um por repositório de uma vez só,
 * num cadastro ou numa varredura grande, abriria centenas de processos juntos.
 */
export async function mapearComLimite<T, R>(
  itens: readonly T[],
  limite: number,
  transformar: (item: T) => Promise<R>,
): Promise<R[]> {
  const resultados = new Array<R>(itens.length);
  let proximo = 0;

  async function trabalhar(): Promise<void> {
    while (proximo < itens.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await transformar(itens[indice] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhar));
  return resultados;
}
