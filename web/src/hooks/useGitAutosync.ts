import { useCallback, useEffect, useState } from 'react';
import type { CommitAutosync, RepoAutosync } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

export interface VisaoAutosync {
  horarios: string[];
  ultimaExecucao: string | null;
  repos: RepoAutosync[];
  /** Quem escreve a mensagem do commit automático — ver `MensagemDoCommit`. */
  ia: { ligada: boolean; agente: string };
}

export type AcaoRepo = 'commit' | 'push' | 'sync' | 'mr';

export interface OpcoesHistorico {
  limite?: number;
  /** Inclui hoje e os N - 1 dias anteriores, usando o fuso local do navegador. */
  dias?: number;
}

const VAZIA: VisaoAutosync = {
  horarios: [],
  ultimaExecucao: null,
  repos: [],
  ia: { ligada: false, agente: 'auto' },
};

export function useGitAutosync(toast: Avisar) {
  const [visao, setVisao] = useState<VisaoAutosync>(VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const recarregar = useCallback(async () => {
    const { ok, body } = await requisitar<VisaoAutosync>('/api/git-autosync');
    if (ok) {
      setVisao(body as VisaoAutosync);
      setErro(null);
    } else {
      setVisao(VAZIA);
      setErro(body.error ?? 'não consegui falar com o git-autosync');
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar]);

  /**
   * Roda uma ação no repositório. A saída do CLI vai inteira para o toast: quando um
   * push falha, o motivo está lá (remoto inacessível, branch protegida) e resumir
   * esconderia justamente o que resolve.
   */
  const acao = useCallback(
    async (tipo: AcaoRepo, repo: RepoAutosync, extra?: { mensagem?: string; titulo?: string }) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<{ saida: string }>(`/api/git-autosync/${tipo}`, {
          caminho: repo.path,
          ...extra,
        });
        if (!ok) {
          toast(`${tipo}: falhou`, 'err', body.error);
          return;
        }
        toast(`${tipo}: concluído`, 'ok', body.saida);
        await recarregar();
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  const definirAtivo = useCallback(
    async (repo: RepoAutosync, ativo: boolean) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<{ saida: string }>('/api/git-autosync/ativo', {
          repo,
          ativo,
        });
        if (!ok) {
          toast('Não consegui alterar o agendamento', 'err', body.error);
          return;
        }
        await recarregar();
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  const historico = useCallback(async (
    repo: RepoAutosync,
    opcoes: OpcoesHistorico = {},
  ): Promise<CommitAutosync[]> => {
    const busca = new URLSearchParams({
      repo: repo.path,
      limite: String(opcoes.limite ?? 15),
    });
    const { ok, body } = await requisitar<{ commits: CommitAutosync[] }>(
      `/api/git-autosync/historico?${busca}`,
    );
    const commits = ok ? (body.commits ?? []) : [];
    if (!opcoes.dias) return commits;

    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    inicio.setDate(inicio.getDate() - (opcoes.dias - 1));
    return commits.filter((commit) => new Date(commit.date).getTime() >= inicio.getTime());
  }, []);

  const definirIa = useCallback(
    async (ligada: boolean, agente: string) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar('/api/git-autosync/ia', { ligada, agente });
        if (!ok) {
          toast('Não consegui alterar como a mensagem é escrita', 'err', body.error);
          return;
        }
        await recarregar();
        toast(
          ligada
            ? 'A mensagem passa a ser gerada a partir do diff.'
            : 'Os commits automáticos voltam ao texto fixo.',
        );
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  return { visao, erro, carregando, ocupado, acao, definirAtivo, definirIa, historico, recarregar };
}
