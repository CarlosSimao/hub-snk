import type { Cliente } from '../../types.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { DetalheRepo, mesmoCaminho } from '../git/DetalheRepo.tsx';
import { AvisoHelperFora } from '../git/PainelGit.tsx';

/**
 * O git do cliente: a mesma coisa da aba Git, mas já filtrada pela pasta cadastrada
 * nele — sem precisar procurar o repositório certo numa lista de treze.
 */
export function GitDoCliente({ cliente, toast }: { cliente: Cliente; toast: Avisar }) {
  const { visao, erro, carregando, ocupado, acao, definirAtivo, historico } = useGitAutosync(toast);

  if (!cliente.repositorioLocal) {
    return (
      <p className="detail-empty">
        Este cliente ainda não tem repositório local. Preencha o campo em Cadastro.
      </p>
    );
  }

  if (erro) return <AvisoHelperFora erro={erro} />;
  if (carregando) return <p className="detail-empty">Carregando…</p>;

  const repo = visao.repos.find((r) => mesmoCaminho(r.path, cliente.repositorioLocal));

  // A pasta está cadastrada no cliente mas o git-autosync nunca ouviu falar dela.
  if (!repo) {
    return (
      <div className="painel">
        <p className="painel-nota">
          <code>{cliente.repositorioLocal}</code> não está no git-autosync — nem como
          repositório próprio, nem dentro de uma pasta raiz vigiada. Nada é commitado
          automaticamente enquanto isso.
        </p>
        <div className="form-acoes">
          <span className="modal-acoes-spacer" />
          <button
            className="btn tiny"
            disabled={ocupado}
            onClick={() =>
              void definirAtivo(
                {
                  path: cliente.repositorioLocal,
                  alvo: cliente.repositorioLocal,
                  ativo: false,
                  alvoProprio: true,
                  estado: null,
                },
                true,
              )
            }
          >
            Adicionar ao autosync
          </button>
        </div>
      </div>
    );
  }

  return (
    <article className="card detail-card">
      <div className="detail-head">
        <div className="card-title">
          <h2>
            Git
            {!repo.ativo && <span className="badge-disabled">fora do agendamento</span>}
          </h2>
          <p title={repo.path}>{repo.path}</p>
          {repo.estado?.message && <p className="card-summary">{repo.estado.message}</p>}
        </div>
        <div className="detail-actions">
          <label className="campo-inline" title="Entra no agendamento automático">
            <input
              type="checkbox"
              checked={repo.ativo}
              disabled={ocupado}
              onChange={(e) => void definirAtivo(repo, e.target.checked)}
            />
            no autosync
          </label>
        </div>
      </div>

      <DetalheRepo
        repo={repo}
        ocupado={ocupado}
        onAcao={acao}
        carregarHistorico={historico}
        semCabecalho
      />
    </article>
  );
}
