import { useState } from 'react';

/**
 * `true` quando esta página foi carregada pelo shell desktop (`desktop/src/tabs.ts`
 * abre a aba Hub com `?desktop=1`), nunca quando aberta num navegador comum. Lido uma
 * vez: a flag não muda durante a sessão da aba.
 */
export function useModoDesktop(): boolean {
  const [modoDesktop] = useState(() => new URLSearchParams(window.location.search).get('desktop') === '1');
  return modoDesktop;
}
