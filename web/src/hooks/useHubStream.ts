import { useCallback, useEffect, useRef, useState } from 'react';
import type { Alert, CheckSnapshot, HubSnapshot } from '../types.ts';
import { worst } from '../lib/format.ts';

const VAZIO: HubSnapshot = {
  generatedAt: 0,
  status: 'unknown',
  services: [],
  warnings: [],
  alerts: [],
};

export type EstadoConexao = 'connecting' | 'live' | 'down';

/** Quanto tempo a linha do check fica destacada depois de um delta. */
const FLASH_MS = 120;

function ouvir<T>(source: EventSource, nome: string, fn: (dado: T) => void): void {
  source.addEventListener(nome, (event) => fn(JSON.parse((event as MessageEvent<string>).data) as T));
}

/**
 * Estado do hub, alimentado pelo SSE.
 *
 * `snapshot` chega inteiro na conexão e a cada reload; `check` chega um por vez e
 * substitui só aquele check, recalculando o semáforo agregado do serviço — é o que
 * evita redesenhar a tela toda a cada ciclo.
 *
 * O modelo mora num ref além do state: `applyCheck` precisa ler o valor corrente na
 * hora do evento, e ler do state capturaria a versão do render que criou o listener.
 */
export function useHubStream(onAlert: (alert: Alert) => void) {
  const [model, setModel] = useState<HubSnapshot>(VAZIO);
  const [conexao, setConexao] = useState<EstadoConexao>('connecting');
  const [flashes, setFlashes] = useState<ReadonlySet<string>>(() => new Set());

  const modelRef = useRef<HubSnapshot>(VAZIO);
  const onAlertRef = useRef(onAlert);
  useEffect(() => {
    onAlertRef.current = onAlert;
  });

  const adotar = useCallback((proximo: HubSnapshot) => {
    modelRef.current = proximo;
    setModel(proximo);
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch('/api/state');
    if (!res.ok) return;
    adotar((await res.json()) as HubSnapshot);
  }, [adotar]);

  const piscar = useCallback((chave: string) => {
    setFlashes((atual) => new Set(atual).add(chave));
    setTimeout(() => {
      setFlashes((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
    }, FLASH_MS);
  }, []);

  const applyCheck = useCallback(
    (snapshot: CheckSnapshot) => {
      const atual = modelRef.current;
      const service = atual.services.find((s) => s.id === snapshot.serviceId);
      if (!service) return;

      const index = service.checks.findIndex((c) => c.checkId === snapshot.checkId);
      if (index === -1) {
        // Check novo (config recarregada): pede o snapshot completo em vez de remendar.
        void refresh();
        return;
      }

      const checks = service.checks.with(index, snapshot);
      const status = worst(checks.filter((c) => !c.muted && !c.disabled).map((c) => c.status));

      adotar({
        ...atual,
        generatedAt: Date.now(),
        services: atual.services.map((s) => (s.id === service.id ? { ...s, checks, status } : s)),
      });
      piscar(`${snapshot.serviceId}:${snapshot.checkId}`);
    },
    [adotar, piscar, refresh],
  );

  useEffect(() => {
    let desmontado = false;
    let retryDelay = 1000;
    let source: EventSource | null = null;
    let timer: number | undefined;

    const conectar = () => {
      const atual = new EventSource('/api/stream');
      source = atual;

      atual.addEventListener('open', () => {
        retryDelay = 1000;
        setConexao('live');
      });
      ouvir<HubSnapshot>(atual, 'snapshot', (snapshot) => {
        // `snapshot.alerts` chega e é ignorado de propósito: o painel só mostra alerta
        // ao vivo, pelo evento `alert`. Renderizar o histórico na conexão faria cada
        // refresh da página ressuscitar toasts de incidentes já resolvidos.
        adotar(snapshot);
        setConexao('live');
      });
      ouvir<CheckSnapshot>(atual, 'check', applyCheck);
      ouvir<Alert>(atual, 'alert', (alert) => onAlertRef.current(alert));

      atual.addEventListener('error', () => {
        if (desmontado) return;
        setConexao('down');
        atual.close();
        // Backoff até 15s — o hub pode estar reiniciando.
        timer = window.setTimeout(conectar, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      });
    };

    conectar();

    return () => {
      desmontado = true;
      clearTimeout(timer);
      source?.close();
    };
  }, [adotar, applyCheck]);

  return { model, conexao, flashes, applyCheck, refresh };
}
