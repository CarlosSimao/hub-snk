import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgendaExperience,
  Cliente,
  EstadoSincronizacao,
  EventoComRecurso,
  SolicitacaoServico,
} from '../types.ts';
import { requisitar } from '../lib/api.ts';

export interface LinhaResumo {
  cliente: Cliente;
  agenda?: AgendaExperience;
  /** Eventos da Agenda de Recursos do ERP já recortados no parceiro deste cliente. */
  eventos?: EventoComRecurso[];
  /** IDs das demandas: as do cadastro e as citadas nos eventos do mês. */
  demandas?: string[];
  /** Solicitações de Serviços DS dessas demandas, do snapshot local. */
  solicitacoes?: SolicitacaoServico[];
  /** Preenchido quando só ESTE cliente falhou — os outros continuam na tela. */
  erro?: string;
}

export function useResumoMes(mes: string) {
  const [linhas, setLinhas] = useState<LinhaResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [sessaoExpirada, setSessaoExpirada] = useState(false);

  const [sincronizacao, setSincronizacao] = useState<EstadoSincronizacao | null>(null);
  const ultimaVista = useRef<number | null | undefined>(undefined);

  // `silencioso`: a recarga que vem da atualização automática não pisca "carregando".
  const buscar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
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

  // A agenda se atualiza sozinha no backend (ao abrir o DS e a cada 4h no expediente).
  // A tela só confere de minuto em minuto se chegou dado novo, e recarrega quando chega.
  useEffect(() => {
    let vivo = true;
    const conferir = async () => {
      const { ok, body } = await requisitar<EstadoSincronizacao>('/api/agenda/sincronizacao');
      if (!vivo || !ok) return;
      const estado = body as EstadoSincronizacao;
      setSincronizacao(estado);
      if (estado.ultimaEm && estado.ultimaEm !== ultimaVista.current) {
        // A primeira leitura só registra: o resumo acabou de ser carregado pelo mês.
        if (ultimaVista.current !== undefined) void buscar(true);
      }
      ultimaVista.current = estado.ultimaEm ?? null;
    };
    void conferir();
    const id = setInterval(() => void conferir(), 60_000);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [buscar]);

  /** Atualiza do ERP agora, sem esperar a próxima janela. */
  const atualizarDoErp = useCallback(async () => {
    setSincronizacao((s) => (s ? { ...s, rodando: true } : s));
    const { ok, body } = await requisitar<EstadoSincronizacao>('/api/agenda/sincronizar', { method: 'POST' });
    if (ok) {
      const estado = body as EstadoSincronizacao;
      setSincronizacao(estado);
      ultimaVista.current = estado.ultimaEm ?? null;
      await buscar(true);
    }
  }, [buscar]);

  return {
    linhas,
    carregando,
    erro,
    sessaoExpirada,
    recarregar: buscar,
    sincronizacao,
    atualizarDoErp,
  };
}
