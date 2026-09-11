import { useCallback, useEffect, useState } from 'react';
import type { AgendaExperience, EventoComRecurso } from '../types.ts';
import { requisitar } from '../lib/api.ts';

const VAZIA: AgendaExperience = { tarefas: [], ordens: [] };

export interface EstadoAgenda {
  agenda: AgendaExperience;
  /** Eventos da Agenda de Recursos do ERP, do snapshot importado. */
  eventos: EventoComRecurso[];
  carregando: boolean;
  erro: string | null;
  /** A sessão do Experience venceu — a tela oferece o caminho de recapturar. */
  sessaoExpirada: boolean;
  recarregar: () => Promise<void>;
}

/** Último dia do mês `YYYY-MM`. Dia 0 do seguinte evita tabela e ano bissexto. */
function ultimoDia(mes: string): string {
  const [ano, numero] = mes.split('-').map(Number);
  const dia = new Date(Date.UTC(ano!, numero!, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, '0')}`;
}

export function useAgenda(clienteId: number, mes: string, recursoUsuario: string): EstadoAgenda {
  const [agenda, setAgenda] = useState<AgendaExperience>(VAZIA);
  const [eventos, setEventos] = useState<EventoComRecurso[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);

  const buscar = useCallback(async () => {
    setCarregando(true);

    const busca = new URLSearchParams({ clienteId: String(clienteId), mes });
    const buscaErp = new URLSearchParams({
      de: `${mes}-01`,
      ate: ultimoDia(mes),
      usuario: recursoUsuario,
    });

    // A agenda do ERP é um snapshot local, então ela responde mesmo quando a Experience
    // está fora — e não deve desaparecer da tela por causa disso.
    const [experience, erp] = await Promise.all([
      requisitar<AgendaExperience & { sessaoExpirada?: boolean }>(`/api/experience/agenda?${busca}`),
      recursoUsuario
        ? requisitar<{ eventos: EventoComRecurso[] }>(`/api/agenda/eventos?${buscaErp}`)
        : Promise.resolve({ ok: true, status: 200, body: { eventos: [] } }),
    ]);

    if (experience.ok) {
      setAgenda({ tarefas: experience.body.tarefas ?? [], ordens: experience.body.ordens ?? [] });
      setErro(null);
      setSessaoExpirada(false);
    } else {
      setAgenda(VAZIA);
      setErro(experience.body.error ?? 'não consegui carregar a agenda');
      setSessaoExpirada(Boolean(experience.body.sessaoExpirada));
    }

    setEventos(erp.ok ? (erp.body.eventos ?? []) : []);
    setCarregando(false);
  }, [clienteId, mes, recursoUsuario]);

  useEffect(() => {
    void buscar();
  }, [buscar]);

  return { agenda, eventos, carregando, erro, sessaoExpirada, recarregar: buscar };
}
