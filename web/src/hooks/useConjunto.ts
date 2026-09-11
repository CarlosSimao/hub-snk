import { useCallback, useState } from 'react';

/**
 * Conjunto de chaves abertas (painel de info, painel de ações).
 *
 * Mora acima do componente que desenha o painel para sobreviver à troca de projeto —
 * abrir a explicação de um check, ir para outro projeto e voltar mantém o que estava aberto.
 */
export function useConjunto(): [ReadonlySet<string>, (chave: string) => void] {
  const [conjunto, setConjunto] = useState<ReadonlySet<string>>(() => new Set());

  const alternar = useCallback((chave: string) => {
    setConjunto((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(chave)) proximo.delete(chave);
      else proximo.add(chave);
      return proximo;
    });
  }, []);

  return [conjunto, alternar];
}
