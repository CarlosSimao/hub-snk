import { useCallback, useRef, useState } from 'react';

export type TipoToast = 'ok' | 'err';

export interface Toast {
  id: number;
  message: string;
  kind: TipoToast;
  detail?: string;
}

export type Avisar = (message: string, kind?: TipoToast, detail?: string) => void;

export function useToasts(): { toasts: Toast[]; toast: Avisar } {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const ultimoId = useRef(0);

  const toast = useCallback<Avisar>((message, kind = 'ok', detail) => {
    const id = (ultimoId.current += 1);
    setToasts((atual) => [...atual, { id, message, kind, ...(detail ? { detail } : {}) }]);
    // Erro fica mais tempo: costuma trazer um `detail` que vale ler.
    setTimeout(() => setToasts((atual) => atual.filter((t) => t.id !== id)), kind === 'err' ? 9000 : 5000);
  }, []);

  return { toasts, toast };
}
