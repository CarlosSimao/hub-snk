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
  const { visao, erro, carregando, ocupado, acao, definirAtivo, definirIa, historico, recarregar } =
    useGitAutosync(toast);
  const [modo, setModo] = useState<'repos' | 'historico'>('repos');
  const [dias, setDias] = useState<number | undefined>(7);

  if (erro) return <AvisoHelperFora erro={erro} />;

  return (
    <div className="git-page">
      <header className="git-page-head">
        <div>
          <h1>Repositórios</h1>
          <p>Revise execuções, controle o agendamento e mantenha cada remoto atualizado.</p>
        </div>
        <button className="btn ghost" disabled={carregando || ocupado} onClick={() => void recarregar()}>
          Atualizar
        </button>
      </header>

      <section className="git-overview" aria-label="Resumo do Git AutoSync">
        <Resumo valor={visao.repos.length} rotulo={plural(visao.repos.length, 'repositório', 'repositórios')} />
        <Resumo valor={visao.repos.filter((repo) => repo.ativo).length} rotulo="no autosync" />
        <Resumo
          valor={visao.repos.filter((repo) => repo.estado?.state === 'pending_push').length}
          rotulo="com push pendente"
          alerta
        />
        <div className="git-agenda">
          <span>Agendamento</span>
          <strong>{visao.horarios.length ? visao.horarios.join(', ') : 'não configurado'}</strong>
          <small>{visao.ultimaExecucao ? `última rodada ${visao.ultimaExecucao}` : 'sem execução registrada'}</small>
        </div>
      </section>

      <MensagemDoCommit ia={visao.ia} onDefinir={definirIa} ocupado={ocupado} />

      <div className="git-toolbar">
        <div className="git-view-switch" role="tablist" aria-label="Visão do Git">
          <button role="tab" aria-selected={modo === 'repos'} onClick={() => setModo('repos')}>
            Repositórios
          </button>
          <button role="tab" aria-selected={modo === 'historico'} onClick={() => setModo('historico')}>
            Histórico
          </button>
        </div>
        {modo === 'historico' && (
          <select value={dias ?? 0} onChange={(e) => setDias(Number(e.target.value) || undefined)}>
            <option value={2}>Hoje e ontem</option>
            <option value={7}>Últimos 7 dias</option>
            <option value={0}>Últimos 100 commits</option>
          </select>
        )}
      </div>

      {carregando ? (
        <p className="detail-empty">Carregando repositórios…</p>
      ) : visao.repos.length === 0 ? (
        <p className="detail-empty">Nenhum repositório configurado.</p>
      ) : (
        <section className={`git-repo-grid ${modo}`}>
          {visao.repos.map((repo) => (
            <article className="card git-repo-card" key={repo.path} data-git-state={estadoVisual(repo)}>
              <div className="git-repo-head">
                <div className="card-title">
                  <h2>{nomeCurto(repo.path)}</h2>
                  <p title={repo.path}>{repo.path}</p>
                  {!repo.alvoProprio && repo.alvo && <small>via pasta {repo.alvo}</small>}
                </div>
                <label className="git-autosync-toggle" title="Incluir no agendamento automático">
                  <input
                    type="checkbox"
                    checked={repo.ativo}
                    disabled={ocupado}
                    onChange={(e) => void definirAtivo(repo, e.target.checked)}
                  />
                  <span>{repo.ativo ? 'no autosync' : 'fora do autosync'}</span>
                </label>
              </div>
              <EstadoRepo repo={repo} />
            <DetalheRepo
              key={modo}
              repo={repo}
              ocupado={ocupado}
              onAcao={acao}
              carregarHistorico={historico}
              semCabecalho
              somenteHistorico={modo === 'historico'}
              ocultarHistorico={modo === 'repos'}
              historicoRecolhivel={modo === 'historico'}
              diasHistorico={modo === 'historico' ? dias : undefined}
              limiteHistorico={modo === 'historico' ? 100 : 5}
            />
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function Resumo({ valor, rotulo, alerta = false }: { valor: number; rotulo: string; alerta?: boolean }) {
  return <div className={`git-summary${alerta && valor ? ' alert' : ''}`}><strong>{valor}</strong><span>{rotulo}</span></div>;
}

function EstadoRepo({ repo }: { repo: import('../../types.ts').RepoAutosync }) {
  const estado = repo.estado;
  const visual = estadoVisual(repo);
  return (
    <div className="git-state-row">
      <span className={`git-state ${visual}`}>
        {visual === 'unknown' ? 'nunca sincronizado' : (ESTADO_ROTULO[visual] ?? visual)}
      </span>
      <span>{!estado ? 'sem execução registrada' : estado.hadChanges ? 'alterações processadas' : 'sem alterações na última rodada'}</span>
      <span>{estado?.lastPush ? `último push ${estado.lastPush}` : 'sem push registrado'}</span>
      {estado?.message && <p title={estado.message}>{estado.message.split('\n')[0]}</p>}
    </div>
  );
}

const AGENTES = [
  { valor: 'auto', rotulo: 'o primeiro que estiver instalado' },
  { valor: 'claude', rotulo: 'Claude' },
  { valor: 'codex', rotulo: 'Codex' },
  { valor: 'opencode', rotulo: 'OpenCode' },
];

/**
 * Quem escreve a mensagem do commit automático.
 *
 * Com a geração desligada o git-autosync nem tenta: comita com o texto fixo
 * `chore: auto-commit <data hora>`. É o que enche o histórico deles.
 *
 * Ligar manda o diff das alterações para o agente escolhido, que roda nesta máquina —
 * por isso a tela diz isso em vez de apresentar a opção como um detalhe de formatação.
 */
function MensagemDoCommit({
  ia,
  onDefinir,
  ocupado,
}: {
  ia: { ligada: boolean; agente: string };
  onDefinir: (ligada: boolean, agente: string) => Promise<void>;
  ocupado: boolean;
}) {
  return (
    <section className="git-ia">
      <div className="git-ia-texto">
        <strong>Mensagem do commit automático</strong>
        <small>
          {ia.ligada
            ? 'Gerada a partir do diff, no padrão Conventional Commits com emoji.'
            : 'Desligada — os commits saem como “chore: auto-commit” com data e hora.'}
        </small>
      </div>

      <div className="git-ia-controles">
        <label className="campo-inline">
          <input
            type="checkbox"
            checked={ia.ligada}
            disabled={ocupado}
            onChange={(e) => void onDefinir(e.target.checked, ia.agente)}
          />
          Gerar pelo diff
        </label>
        <select
          value={ia.agente}
          disabled={ocupado || !ia.ligada}
          onChange={(e) => void onDefinir(ia.ligada, e.target.value)}
        >
          {AGENTES.map((a) => (
            <option key={a.valor} value={a.valor}>
              {a.rotulo}
            </option>
          ))}
        </select>
      </div>

      {ia.ligada && (
        <p className="git-ia-nota">
          O diff das alterações é enviado ao agente escolhido, que roda nesta máquina.
        </p>
      )}
    </section>
  );
}

function estadoVisual(repo: import('../../types.ts').RepoAutosync): string {
  return repo.estado?.state ?? (repo.estado?.success === false ? 'failed' : 'unknown');
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
