import { useState } from 'react';
import { plural } from '../../lib/format.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { DetalheRepo, nomeCurto } from './DetalheRepo.tsx';

const ESTADO_ROTULO: Record<string, string> = {
  synced: 'sincronizado',
  pending_push: 'commit sem push',
  failed: 'falhou',
};

export function PainelGit({ toast }: { toast: Avisar }) {
  const { visao, erro, carregando, ocupado, acao, definirAtivo, historico } = useGitAutosync(toast);
  const [selecionadoPath, setSelecionadoPath] = useState<string | null>(null);

  const selecionado = visao.repos.find((r) => r.path === selecionadoPath);

  if (erro) return <AvisoHelperFora erro={erro} />;

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
          <article className="card detail-card">
            <DetalheRepo
              key={selecionado.path}
              repo={selecionado}
              ocupado={ocupado}
              onAcao={acao}
              carregarHistorico={historico}
            />
          </article>
        ) : (
          <p className="detail-empty">Selecione um repositório ao lado.</p>
        )}
      </section>
    </div>
  );
}

export function AvisoHelperFora({ erro }: { erro: string }) {
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
