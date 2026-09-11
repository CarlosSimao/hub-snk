import { useCallback, useEffect, useState } from 'react';
import type { AgendaExperience, Cliente, EventoComRecurso } from '../types.ts';
import { requisitar } from '../lib/api.ts';

export interface LinhaResumo {
  cliente: Cliente;
  agenda?: AgendaExperience;
  /** Eventos da Agenda de Recursos do ERP já recortados no parceiro deste cliente. */
  eventos?: EventoComRecurso[];
  /** Preenchido quando só ESTE cliente falhou — os outros continuam na tela. */
  erro?: string;
}

export function useResumoMes(mes: string) {
  const [linhas, setLinhas] = useState<LinhaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);

  const buscar = useCallback(async () => {
    setCarregando(true);
    const { ok, body } = await requisitar<{ clientes: LinhaResumo[]; sessaoExpirada?: boolean }>(
      `/api/experience/resumo?mes=${mes}`,
    );

    if (ok) {
      setLinhas(body.clientes ?? []);
      setErro(null);
      setSessaoExpirada(false);
    } else {
      setLinhas([]);
      setErro(body.error ?? 'não consegui carregar o resumo');
      setSessaoExpirada(Boolean(body.sessaoExpirada));
    }
    setCarregando(false);
  }, [mes]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  return { linhas, carregando, erro, sessaoExpirada, recarregar: buscar };
}
