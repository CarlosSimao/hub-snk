import { useCallback, useEffect, useState } from 'react';
import type { SistemaSankhya, StatusCredencial } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

/**
 * Estado das credenciais do Sankhya. Nunca guarda senha — o backend so devolve nome de
 * usuario e se ha valor gravado, e o valor real vive cifrado fora do container.
 */
export function useCredenciais(toast: Avisar) {
  const [credenciais, setCredenciais] = useState<StatusCredencial[]>([]);
  const [erroHelper, setErroHelper] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  /**
   * Sobe a cada gravação/remoção bem-sucedida. A tela usa como `key` do formulário para
   * remontá-lo: os campos são não-controlados, então sem isso o usuário removido
   * continuaria escrito na caixa e a senha recém-gravada seguiria no DOM.
   */
  const [versao, setVersao] = useState(0);

  const recarregar = useCallback(async () => {
    const { ok, body } = await requisitar<{ credenciais: StatusCredencial[] }>(
      '/api/sankhya/credenciais',
    );
    if (ok) {
      setCredenciais(body.credenciais ?? []);
      setErroHelper(null);
    } else {
      // Helper fora do ar não é erro do hub: a tela explica o que fazer em vez de
      // mostrar um toast vermelho que some em 9 segundos.
      setCredenciais([]);
      setErroHelper(body.error ?? 'não consegui falar com o hub-helper');
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  const gravar = useCallback(
    async (sistema: SistemaSankhya, usuario: string, senha: string): Promise<boolean> => {
      const { ok, body } = await enviar(`/api/sankhya/credenciais/${sistema}`, { usuario, senha });
      if (!ok) {
        toast(body.error ?? 'Não consegui salvar a credencial', 'err');
        return false;
      }
      await recarregar();
      setVersao((n) => n + 1);
      toast('Credencial guardada — cifrada com DPAPI, fora do container.', 'ok');
      return true;
    },
    [recarregar, toast],
  );

  const remover = useCallback(
    async (sistema: SistemaSankhya): Promise<void> => {
      if (!window.confirm(`Apagar a credencial guardada de ${sistema}?`)) return;

      const { ok, body } = await requisitar(`/api/sankhya/credenciais/${sistema}`, {
        method: 'DELETE',
      });
      if (!ok) {
        toast(body.error ?? 'Não consegui remover a credencial', 'err');
        return;
      }
      await recarregar();
      setVersao((n) => n + 1);
      toast('Credencial removida.', 'ok');
    },
    [recarregar, toast],
  );

  return { credenciais, erroHelper, carregando, versao, gravar, remover };
}
