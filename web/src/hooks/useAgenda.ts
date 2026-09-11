import { useCallback, useEffect, useState } from 'react';
import type { AgendaExperience } from '../types.ts';
import { requisitar } from '../lib/api.ts';

const VAZIA: AgendaExperience = { tarefas: [], ordens: [] };

export interface EstadoAgenda {
  agenda: AgendaExperience;
  carregando: boolean;
  erro: string | null;
  /** A sessão do Experience venceu — a tela oferece o caminho de recapturar. */
  sessaoExpirada: boolean;
  recarregar: () => Promise<void>;
}

export function useAgenda(clienteId: number, mes: string): EstadoAgenda {
  const [agenda, setAgenda] = useState<AgendaExperience>(VAZIA);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);

  const buscar = useCallback(async () => {
    setCarregando(true);
    const busca = new URLSearchParams({ clienteId: String(clienteId), mes });
    const { ok, body } = await requisitar<AgendaExperience & { sessaoExpirada?: boolean }>(
      `/api/experience/agenda?${busca}`,
    );

    if (ok) {
      setAgenda({ tarefas: body.tarefas ?? [], ordens: body.ordens ?? [] });
      setErro(null);
      setSessaoExpirada(false);
    } else {
      setAgenda(VAZIA);
      setErro(body.error ?? 'não consegui carregar a agenda');
      setSessaoExpirada(Boolean(body.sessaoExpirada));
    }
    setCarregando(false);
  }, [clienteId, mes]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  return { agenda, carregando, erro, sessaoExpirada, recarregar: buscar };
}
