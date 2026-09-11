import { useEffect, useState } from 'react';
import type { CommitAutosync, RepoAutosync } from '../../types.ts';
import { plural } from '../../lib/format.ts';
import { useGitAutosync, type AcaoRepo } from '../../hooks/useGitAutosync.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

/** Só o nome da pasta: o caminho inteiro não cabe na coluna e a raiz é sempre a mesma. */
function nomeCurto(caminho: string): string {
  return caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho;
}

const ESTADO_ROTULO: Record<string, string> = {
  synced: 'sincronizado',
  pending_push: 'commit sem push',
  failed: 'falhou',
};

export function PainelGit({ toast }: { toast: Avisar }) {
  const { visao, erro, carregando, ocupado, acao, definirAtivo, historico } = useGitAutosync(toast);
  const [selecionadoPath, setSelecionadoPath] = useState<string | null>(null);

  const selecionado = visao.repos.find((r) => r.path === selecionadoPath);

  if (erro) {
    return (
      <div className="warning">
        <span>⚠</span>
        <span>
          {erro}
          <br />O git-autosync é executado pelo <code>hub-helper.ps1</code>; suba o helper e
          recarregue a página.
        </span>
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="project-list">
        <div className="project-list-head">
          {carregando
            ? 'carregando…'
            : `${visao.repos.length} ${plural(visao.repos.length, 'repositório', 'repositórios')}`}
        </div>

        <div className="project-list-items">
          {visao.repos.map((repo) => (
            <div
              key={repo.path}
              className={`project-item${repo.path === selecionadoPath ? ' active' : ''}${
                repo.ativo ? '' : ' disabled'
              }`}
            >
              {/*
                O checkbox fica fora do botão de seleção: um <button> dentro de outro é
                HTML inválido, e clicar para agendar não deve também trocar o detalhe.
              */}
              <input
                type="checkbox"
                checked={repo.ativo}
                disabled={ocupado}
                title={
                  repo.ativo
                    ? 'No agendamento automático — desmarque para tirar'
                    : 'Fora do agendamento — marque para incluir'
                }
                onChange={(e) => void definirAtivo(repo, e.target.checked)}
              />
              <button
                type="button"
                className="li-botao"
                aria-pressed={repo.path === selecionadoPath}
                onClick={() => setSelecionadoPath(repo.path)}
              >
                <div className="li-title">
                  <h2>{nomeCurto(repo.path)}</h2>
                  <p className="li-summary">
                    {repo.estado?.state
                      ? (ESTADO_ROTULO[repo.estado.state] ?? repo.estado.state)
                      : 'nunca sincronizado'}
                  </p>
                </div>
              </button>
            </div>
          ))}
        </div>

        <p className="painel-nota">
          Agendamento: {visao.horarios.length ? visao.horarios.join(', ') : 'nenhum'}
          {visao.ultimaExecucao && ` · última execução ${visao.ultimaExecucao}`}
        </p>
      </aside>

      <section className="detail">
        {selecionado ? (
          <DetalheRepo
            key={selecionado.path}
            repo={selecionado}
            ocupado={ocupado}
            onAcao={acao}
            carregarHistorico={historico}
          />
        ) : (
          <p className="detail-empty">Selecione um repositório ao lado.</p>
        )}
      </section>
    </div>
  );
}

function DetalheRepo({
  repo,
  ocupado,
  onAcao,
  carregarHistorico,
}: {
  repo: RepoAutosync;
  ocupado: boolean;
  onAcao: (tipo: AcaoRepo, repo: RepoAutosync, extra?: { mensagem?: string }) => Promise<void>;
  carregarHistorico: (repo: RepoAutosync) => Promise<CommitAutosync[]>;
}) {
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

  /** Push, sync e MR saem da máquina — confirmação antes, commit local não precisa. */
  const disparar = (tipo: AcaoRepo) => {
    const alcanceRemoto = tipo !== 'commit';
    if (alcanceRemoto && !window.confirm(`Executar "${tipo}" em ${nomeCurto(repo.path)}?`)) return;
    void onAcao(tipo, repo);
  };

  return (
    <article className="card detail-card">
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
    </article>
  );
}
