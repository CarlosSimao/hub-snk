import { useCallback, useEffect, useState } from 'react';
import type { Cliente, ClienteEntrada } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

export function useClientes(toast: Avisar) {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);

  const recarregar = useCallback(async () => {
    const { ok, body } = await requisitar<{ clientes: Cliente[] }>('/api/clientes');
    if (ok) setClientes(body.clientes ?? []);
    else toast(body.error ?? 'Não consegui carregar os clientes', 'err');
    setCarregando(false);
  }, [toast]);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  /** `id` nulo cria; preenchido atualiza. Devolve o cliente gravado, ou null se falhou. */
  const salvar = useCallback(
    async (id: number | null, entrada: ClienteEntrada): Promise<Cliente | null> => {
      const { ok, body } = id === null
        ? await enviar<Cliente>('/api/clientes', entrada)
        : await requisitar<Cliente>(`/api/clientes/${id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(entrada),
          });

      if (!ok) {
        toast(body.error ?? 'Não consegui salvar o cliente', 'err');
        return null;
      }
      await recarregar();
      toast(id === null ? 'Cliente cadastrado.' : 'Cliente atualizado.', 'ok');
      return body as Cliente;
    },
    [recarregar, toast],
  );

  const remover = useCallback(
    async (cliente: Cliente): Promise<boolean> => {
      if (!window.confirm(`Remover "${cliente.nome}" do cadastro?`)) return false;

      const { ok, body } = await requisitar(`/api/clientes/${cliente.id}`, { method: 'DELETE' });
      if (!ok) {
        toast(body.error ?? 'Não consegui remover o cliente', 'err');
        return false;
      }
      await recarregar();
      toast('Cliente removido.', 'ok');
      return true;
    },
    [recarregar, toast],
  );

  return { clientes, carregando, salvar, remover };
}
