import { useCallback, useEffect, useState } from 'react';
import type { CommitAutosync, RepoAutosync, TarefaAutosync } from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import { sugerirFalha, type SugestaoFalha } from '../lib/gitSugestoes.ts';
import type { Avisar } from './useToasts.ts';

export interface VisaoAutosync {
  horarios: string[];
  /** O que o Agendador do Windows tem de fato — ver `Agendamento`. */
  tarefas: TarefaAutosync[];
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
  tarefas: [],
  ultimaExecucao: null,
  repos: [],
  ia: { ligada: false, agente: 'auto' },
};

export function useGitAutosync(toast: Avisar) {
  const [visao, setVisao] = useState<VisaoAutosync>(VAZIA);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  /** Falha da última ação por repositório, com sugestão — some ao repetir a ação com sucesso. */
  const [falhas, setFalhas] = useState<Record<string, SugestaoFalha & { mensagem: string }>>({});

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
          const mensagem = body.error ?? 'falhou sem detalhe';
          toast(`${tipo}: falhou`, 'err', mensagem);
          setFalhas((atuais) => ({
            ...atuais,
            [repo.path]: { mensagem, ...(sugerirFalha(mensagem) ?? { motivo: mensagem }) },
          }));
          return;
        }
        toast(`${tipo}: concluído`, 'ok', body.saida);
        // Ação seguinte deu certo: a falha anterior desse repositório deixou de valer.
        setFalhas((atuais) => {
          if (!(repo.path in atuais)) return atuais;
          const { [repo.path]: _descartada, ...resto } = atuais;
          return resto;
        });
        await recarregar();
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  /** Abre CMD ou Git Bash na pasta do repositório — não passa pelo CLI do git-autosync. */
  const abrirTerminal = useCallback(
    async (repo: RepoAutosync, tipo: 'cmd' | 'git-bash') => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar<{ saida: string }>('/api/git-autosync/terminal', {
          caminho: repo.path,
          tipo,
        });
        if (!ok) {
          toast('Não consegui abrir o terminal', 'err', body.error);
          return;
        }
        toast('Terminal aberto.', 'ok', body.saida);
      } finally {
        setOcupado(false);
      }
    },
    [toast],
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

  const definirHorarios = useCallback(
    async (horarios: string[]) => {
      setOcupado(true);
      try {
        const { ok, body } = await enviar('/api/git-autosync/agendamento', { horarios });
        if (!ok) {
          toast('Não consegui salvar os horários', 'err', body.error);
          return false;
        }
        await recarregar();
        // O CLI reinstala a tarefa junto com o `set-schedule`, entao nao ha passo extra.
        toast('Horários salvos. A tarefa do Agendador já usa os novos.');
        return true;
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  /**
   * Cria ou remove a tarefa no Agendador do Windows.
   *
   * A saída do CLI vai inteira para o toast pelo mesmo motivo das ações de repositório:
   * quando o Agendador recusa, o motivo está nela.
   */
  const definirInstalacao = useCallback(
    async (instalar: boolean) => {
      setOcupado(true);
      try {
        const rota = instalar ? 'instalar' : 'desinstalar';
        const { ok, body } = await enviar<{ saida: string }>(`/api/git-autosync/${rota}`, {});
        if (!ok) {
          toast(instalar ? 'Não consegui instalar a tarefa' : 'Não consegui remover a tarefa', 'err', body.error);
          return false;
        }
        await recarregar();
        toast(instalar ? 'Tarefa instalada no Agendador.' : 'Tarefa removida do Agendador.', 'ok', body.saida);
        return true;
      } finally {
        setOcupado(false);
      }
    },
    [recarregar, toast],
  );

  const [log, setLog] = useState<string[] | null>(null);
  const [logCarregando, setLogCarregando] = useState(false);

  /** Últimas linhas do `autosync.log` — texto simples gravado a cada rodada agendada. */
  const carregarLog = useCallback(async (limite = 200) => {
    setLogCarregando(true);
    try {
      const { ok, body } = await requisitar<{ linhas: string[] }>(
        `/api/git-autosync/log?limite=${limite}`,
      );
      setLog(ok ? (body.linhas ?? []) : []);
    } finally {
      setLogCarregando(false);
    }
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

  return {
    visao,
    erro,
    carregando,
    ocupado,
    acao,
    falhas,
    abrirTerminal,
    definirAtivo,
    definirHorarios,
    definirInstalacao,
    definirIa,
    historico,
    log,
    logCarregando,
    carregarLog,
    recarregar,
  };
}
