import type { Cliente, RepoCliente } from '../../types.ts';
import { useCartaoCliente } from '../../hooks/useCartaoCliente.ts';
import { useGitAutosync } from '../../hooks/useGitAutosync.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { DetalheRepo, mesmoCaminho } from '../git/DetalheRepo.tsx';
import { AvisoHelperFora } from '../git/PainelGit.tsx';

/**
 * O git do cliente: a mesma coisa da aba Git, mas já filtrada pelas pastas cadastradas
 * nele — sem precisar procurar o repositório certo numa lista de treze.
 *
 * Os repositórios vêm do cartão, não de um campo único do cadastro: um cliente tem
 * mais de um repositório (comissão, fiscal, integração) e escolher um deles para a
 * tela deixaria os outros sem commit automático e sem ninguém olhando.
 */
export function GitDoCliente({ cliente, toast }: { cliente: Cliente; toast: Avisar }) {
  const cartao = useCartaoCliente(cliente.id, toast);
  const git = useGitAutosync(toast);

  if (git.erro) return <AvisoHelperFora erro={git.erro} />;
  if (cartao.carregando || git.carregando) return <p className="detail-empty">Carregando…</p>;

  const repos = cartao.cartao?.repos ?? [];
  if (!repos.length) {
    return (
      <p className="detail-empty">
        Este cliente ainda não tem repositório cadastrado. Adicione um em Cadastro ›
        Repositórios.
      </p>
    );
  }

  return (
    <>
      {repos.map((repo) => (
        <RepoDoCliente key={repo.id} cadastrado={repo} git={git} />
      ))}
    </>
  );
}

function RepoDoCliente({
  cadastrado,
  git,
}: {
  cadastrado: RepoCliente;
  git: ReturnType<typeof useGitAutosync>;
}) {
  const { visao, ocupado, acao, falhas, abrirTerminal, definirAtivo, historico } = git;
  const repo = visao.repos.find((item) => mesmoCaminho(item.path, cadastrado.caminhoLocal));

  // A pasta está cadastrada no cliente mas o git-autosync nunca ouviu falar dela.
  if (!repo) {
    return (
      <div className="painel">
        <p className="painel-nota">
          <code>{cadastrado.caminhoLocal}</code> não está no git-autosync — nem como
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
                  path: cadastrado.caminhoLocal,
                  alvo: cadastrado.caminhoLocal,
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
            {cadastrado.nome || 'Git'}
            {!repo.ativo && <span className="badge-disabled">fora do agendamento</span>}
          </h2>
          <p title={repo.path}>{repo.path}</p>
          {cadastrado.remoto && <p title={cadastrado.remoto}>{cadastrado.remoto}</p>}
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
        falha={falhas[repo.path]}
        onAbrirTerminal={abrirTerminal}
        carregarHistorico={historico}
        semCabecalho
        diasHistorico={2}
        limiteHistorico={100}
        mostrarMonitor
      />
    </article>
  );
}
