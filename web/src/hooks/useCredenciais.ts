import { useCallback, useEffect, useState } from 'react';
import type { SistemaSankhya, StatusCredencial, StatusNavegador } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

const SEM_NAVEGADOR: StatusNavegador = {
  navegador: false,
  disponiveis: [],
  aberto: false,
  abas: [],
  telas: [],
};

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

  const [navegador, setNavegador] = useState<StatusNavegador>(SEM_NAVEGADOR);

  const recarregar = useCallback(async () => {
    const [credencial, janela] = await Promise.all([
      requisitar<{ credenciais: StatusCredencial[] }>('/api/sankhya/credenciais'),
      requisitar<StatusNavegador>('/api/sankhya/navegador'),
    ]);

    if (credencial.ok) {
      setCredenciais(credencial.body.credenciais ?? []);
      setErroHelper(null);
    } else {
      // Helper fora do ar não é erro do hub: a tela explica o que fazer em vez de
      // mostrar um toast vermelho que some em 9 segundos.
      setCredenciais([]);
      setErroHelper(credencial.body.error ?? 'não consegui falar com o hub-helper');
    }

    setNavegador(janela.ok ? (janela.body as StatusNavegador) : SEM_NAVEGADOR);
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

  const abrirNavegador = useCallback(
    async (sistema: SistemaSankhya, opcoes: { tela?: string; navegador?: string } = {}) => {
      const { ok, body } = await enviar<{ url: string }>(
        `/api/sankhya/navegador/abrir/${sistema}`,
        opcoes,
      );
      if (!ok) {
        toast('Não consegui abrir o navegador', 'err', body.error);
        return;
      }
      toast(
        opcoes.tela
          ? 'Guia aberta na tela pedida.'
          : 'Guia aberta — faça o login nela e volte aqui para capturar a sessão.',
        'ok',
      );
      await recarregar();
    },
    [recarregar, toast],
  );

  const capturarSessao = useCallback(
    async (sistema: SistemaSankhya) => {
      const { ok, body } = await enviar<{ cookies: number }>(
        `/api/sankhya/navegador/capturar/${sistema}`,
      );
      if (!ok) {
        toast('Não consegui capturar a sessão', 'err', body.error);
        return;
      }
      await recarregar();
      setVersao((n) => n + 1);
      toast(`Sessão capturada (${body.cookies} cookies), cifrada com DPAPI.`, 'ok');
    },
    [recarregar, toast],
  );

  return {
    credenciais,
    navegador,
    erroHelper,
    carregando,
    versao,
    gravar,
    remover,
    abrirNavegador,
    capturarSessao,
    recarregar,
  };
}
