import { useEffect, useState } from 'react';
import type { CommitAutosync, RepoAutosync } from '../../types.ts';
import type { AcaoRepo } from '../../hooks/useGitAutosync.ts';

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
  carregarHistorico: (repo: RepoAutosync) => Promise<CommitAutosync[]>;
  /** Some com o cabeçalho quando quem embute já identificou o repositório (aba do cliente). */
  semCabecalho?: boolean;
}

export function DetalheRepo({ repo, ocupado, onAcao, carregarHistorico, semCabecalho }: Props) {
  const [commits, setCommits] = useState<CommitAutosync[] | null>(null);

  useEffect(() => {
    let cancelado = false;
    void carregarHistorico(repo).then((lista) => {
      if (!cancelado) setCommits(lista);
    });
    return () => {
      cancelado = true;
    };
  }, [repo, carregarHistorico]);

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

      <div className="actions-panel">
        <button className="btn tiny" disabled={ocupado} onClick={() => disparar('commit')}>
          Commit
        </button>
        <button className="btn tiny" disabled={ocupado} onClick={() => disparar('push')}>
          Push
        </button>
        <button className="btn tiny" disabled={ocupado} onClick={() => disparar('sync')}>
          Sync
        </button>
        <button
          className="btn tiny"
          disabled={ocupado}
          title="Merge request no GitLab — o CLI não abre pull request do GitHub"
          onClick={() => disparar('mr')}
        >
          MR
        </button>
      </div>

      <div className="historico">
        <h3>Últimos commits</h3>
        {commits === null && <p className="detail-empty">Carregando…</p>}
        {commits?.length === 0 && <p className="detail-empty">Nenhum commit no período.</p>}
        {commits?.map((commit) => (
          <div className="commit" key={commit.hash}>
            <code>{commit.hash.slice(0, 7)}</code>
            <span className="commit-msg">{commit.message.split('\n')[0]}</span>
            <span className="commit-data">{commit.date.slice(0, 10)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
