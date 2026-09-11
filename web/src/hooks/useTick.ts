import { useEffect, useState } from 'react';

/**
 * Contador que avança sozinho, só para forçar re-render.
 *
 * Os textos "há Xmin" envelhecem sem que nada aconteça no servidor — sem este tique
 * a tela mentiria até o próximo check disparar.
 */
export function useTick(ms: number): number {
  const [tique, setTique] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTique((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);

  return tique;
}
