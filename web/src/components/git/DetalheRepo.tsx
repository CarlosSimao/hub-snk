import { useEffect, useState } from 'react';
import type { CommitAutosync, HistoryPoint, RepoAutosync } from '../../types.ts';
import type { AcaoRepo, OpcoesHistorico } from '../../hooks/useGitAutosync.ts';
import { HistoryBars } from '../HistoryBars.tsx';

/** Só o nome da pasta: o caminho inteiro não cabe na coluna e a raiz é sempre a mesma. */
export function nomeCurto(caminho: string): string {
  return caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;
}

/** Caminho do Windows: compara sem diferenciar maiúsculas nem `/` de `\`. */
export function mesmoCaminho(a: string, b: string): boolean {
  const normalizar = (c: string) => c.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  return normalizar(a) === normalizar(b);
}

interface Props {
  repo: RepoAutosync;
  ocupado: boolean;
  onAcao: (tipo: AcaoRepo, repo: RepoAutosync) => Promise<void>;
  carregarHistorico: (
    repo: RepoAutosync,
    opcoes?: OpcoesHistorico,
  ) => Promise<CommitAutosync[]>;
  /** Some com o cabeçalho quando quem embute já identificou o repositório (aba do cliente). */
  semCabecalho?: boolean;
  somenteHistorico?: boolean;
  diasHistorico?: number;
  limiteHistorico?: number;
  mostrarMonitor?: boolean;
  ocultarHistorico?: boolean;
  historicoRecolhivel?: boolean;
}

export function DetalheRepo({
  repo,
  ocupado,
  onAcao,
  carregarHistorico,
  semCabecalho,
  somenteHistorico = false,
  diasHistorico,
  limiteHistorico = 15,
  mostrarMonitor = false,
  ocultarHistorico = false,
  historicoRecolhivel = false,
}: Props) {
  const [commits, setCommits] = useState<CommitAutosync[] | null>(null);
  const [historicoAberto, setHistoricoAberto] = useState(!historicoRecolhivel);

  useEffect(() => {
    let cancelado = false;
    if (ocultarHistorico || !historicoAberto) {
      setCommits([]);
      return;
    }
    setCommits(null);
    void carregarHistorico(repo, { dias: diasHistorico, limite: limiteHistorico }).then((lista) => {
      if (!cancelado) setCommits(lista);
    });
    return () => {
      cancelado = true;
    };
  }, [repo, carregarHistorico, diasHistorico, limiteHistorico, ocultarHistorico, historicoAberto]);

  /** Push, sync e MR saem da máquina — confirmação antes; commit é local e não precisa. */
  const disparar = (tipo: AcaoRepo) => {
    if (tipo !== 'commit' && !window.confirm(`Executar "${tipo}" em ${nomeCurto(repo.path)}?`)) {
      return;
    }
    void onAcao(tipo, repo);
  };

  return (
    <>
      {!semCabecalho && (
        <div className="detail-head">
          <div className="card-title">
            <h2>
              {nomeCurto(repo.path)}
              {!repo.ativo && <span className="badge-disabled">fora do agendamento</span>}
            </h2>
            <p title={repo.path}>{repo.path}</p>
            {repo.estado?.message && <p className="card-summary">{repo.estado.message}</p>}
          </div>
        </div>
      )}

      {!somenteHistorico && (
        <div className="git-actions">
          <button className="git-action" disabled={ocupado} onClick={() => disparar('commit')}>
            <strong>Commitar</strong>
            <span>salvar alterações localmente</span>
          </button>
          <button className="git-action" disabled={ocupado} onClick={() => disparar('push')}>
            <strong>Push</strong>
            <span>enviar commits existentes</span>
          </button>
          <button
            className="git-action primary"
            disabled={ocupado}
            onClick={() => disparar('sync')}
          >
            <strong>Sincronizar</strong>
            <span>commitar e enviar</span>
          </button>
          <button
            className="git-action"
            disabled={ocupado}
            title="Merge request no GitLab — o CLI não abre pull request do GitHub"
            onClick={() => disparar('mr')}
          >
            <strong>Criar MR</strong>
            <span>abrir merge request no GitLab</span>
          </button>
        </div>
      )}

      {historicoRecolhivel && !ocultarHistorico && (
        <button
          className="git-history-toggle"
          type="button"
          aria-expanded={historicoAberto}
          onClick={() => setHistoricoAberto((aberto) => !aberto)}
        >
          {historicoAberto ? 'Ocultar commits' : 'Ver commits'} <span aria-hidden="true">{historicoAberto ? '⌃' : '⌄'}</span>
        </button>
      )}

      {!ocultarHistorico && historicoAberto && <div className="historico">
        <div className="historico-titulo">
          <h3>{diasHistorico === 2 ? 'Hoje e ontem' : 'Últimos commits'}</h3>
          {commits && <span>{commits.length} commit{commits.length === 1 ? '' : 's'}</span>}
        </div>
        {mostrarMonitor && commits && <MonitorCommits commits={commits} />}
        {commits === null && <p className="detail-empty">Carregando…</p>}
        {commits?.length === 0 && <p className="detail-empty">Nenhum commit no período.</p>}
        {commits?.map((commit) => (
          <div className="commit" key={commit.hash}>
            <code>{commit.hash.slice(0, 7)}</code>
            <span className="commit-msg">{commit.message.split('\n')[0]}</span>
            <span className="commit-data">{formatarDataCommit(commit.date)}</span>
          </div>
        ))}
      </div>}
    </>
  );
}

function formatarDataCommit(valor: string): string {
  const data = new Date(valor);
  const hoje = new Date();
  const ontem = new Date();
  ontem.setDate(hoje.getDate() - 1);
  const chave = data.toLocaleDateString('pt-BR');
  const dia =
    chave === hoje.toLocaleDateString('pt-BR')
      ? 'hoje'
      : chave === ontem.toLocaleDateString('pt-BR')
        ? 'ontem'
        : chave;
  return `${dia}, ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function MonitorCommits({ commits }: { commits: CommitAutosync[] }) {
  const agora = new Date();
  const inicio = new Date(agora);
  inicio.setDate(inicio.getDate() - 1);
  inicio.setHours(0, 0, 0, 0);

  const history: HistoryPoint[] = Array.from({ length: 25 + agora.getHours() }, (_, indice) => {
    const comeco = inicio.getTime() + indice * 60 * 60 * 1000;
    const fim = comeco + 60 * 60 * 1000;
    const quantidade = commits.filter((commit) => {
      const ts = new Date(commit.date).getTime();
      return ts >= comeco && ts < fim;
    }).length;
    return { ts: comeco, status: quantidade ? 'up' : 'unknown', latencyMs: null };
  });

  return (
    <div className="git-monitor" aria-label="Atividade de commits por hora, ontem e hoje">
      <HistoryBars history={history} />
      <div className="git-monitor-legenda"><span>ontem</span><span>hoje</span></div>
    </div>
  );
}
