/**
 * "Adicionar repositório" da aba Git.
 *
 * O que ele oferece são os repositórios cadastrados nos CLIENTES (Sankhya › Cliente ›
 * Cadastro), não uma pasta qualquer do disco. O caminho é esse de propósito: o cadastro
 * do cliente já é onde o repositório ganha nome, remoto e dono, e digitar um caminho
 * solto aqui criaria um segundo lugar onde repositório "existe" — com apelido diferente
 * do que a tela do cliente mostra.
 *
 * Cadastrar no cliente não mexe no git-autosync. Entrar no `config.json` acontece
 * quando alguém aperta o botão daqui (ou o "Adicionar ao autosync" da tela do cliente,
 * que faz a mesma chamada). Adicionar já deixa o repositório ativo: o `add` do CLI
 * grava e liga ao mesmo tempo, e o interruptor de cada card é que desliga depois.
 */
import { useCallback, useEffect, useState } from 'react';
import type { RepoAutosync, RepoCadastrado } from '../../types.ts';
import { requisitar } from '../../lib/api.ts';
import { mesmoCaminho, nomeCurto } from './DetalheRepo.tsx';

export function AdicionarRepositorio({
  jaNoAutosync,
  ocupado,
  onAdicionar,
}: {
  /** O que o git-autosync já conhece — some da lista, para não oferecer o que já está lá. */
  jaNoAutosync: RepoAutosync[];
  ocupado: boolean;
  onAdicionar: (repo: RepoAutosync, ativo: boolean) => Promise<void>;
}) {
  const [cadastrados, setCadastrados] = useState<RepoCadastrado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [escolhido, setEscolhido] = useState('');

  const carregar = useCallback(async () => {
    const { ok, body } = await requisitar<{ repos: RepoCadastrado[] }>('/api/repos-cadastrados');
    setCadastrados(ok ? (body.repos ?? []) : []);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const disponiveis = cadastrados.filter(
    (cadastrado) => !jaNoAutosync.some((repo) => mesmoCaminho(repo.path, cadastrado.caminhoLocal)),
  );

  // A escolha anterior pode ter acabado de entrar no autosync (ou sumido do cadastro).
  useEffect(() => {
    if (escolhido && !disponiveis.some((repo) => repo.caminhoLocal === escolhido)) setEscolhido('');
  }, [disponiveis, escolhido]);

  if (carregando) return null;

  if (!cadastrados.length) {
    return (
      <p className="painel-nota">
        Nenhum repositório cadastrado nos clientes. Cadastre um em Sankhya › Cliente ›
        Cadastro para poder adicioná-lo aqui.
      </p>
    );
  }

  if (!disponiveis.length) {
    return (
      <p className="painel-nota">
        Todos os repositórios cadastrados nos clientes já estão no git-autosync.
      </p>
    );
  }

  const porCliente = new Map<string, RepoCadastrado[]>();
  for (const repo of disponiveis) {
    const lista = porCliente.get(repo.clienteNome) ?? [];
    lista.push(repo);
    porCliente.set(repo.clienteNome, lista);
  }

  async function adicionar(): Promise<void> {
    if (!escolhido) return;
    await onAdicionar(
      {
        path: escolhido,
        alvo: escolhido,
        ativo: false,
        // Sempre alvo próprio: `root` mandaria o autosync varrer a pasta inteira e
        // trazer junto repositório de outro cliente que estivesse ao lado.
        alvoProprio: true,
        estado: null,
      },
      true,
    );
    setEscolhido('');
    await carregar();
  }

  return (
    <div className="git-adicionar">
      <label htmlFor="git-adicionar-repo">Adicionar repositório cadastrado</label>
      <select
        id="git-adicionar-repo"
        value={escolhido}
        disabled={ocupado}
        onChange={(e) => setEscolhido(e.target.value)}
      >
        <option value="">Escolha um repositório…</option>
        {[...porCliente].map(([cliente, repos]) => (
          <optgroup key={cliente} label={cliente}>
            {repos.map((repo) => (
              <option key={repo.id} value={repo.caminhoLocal} title={repo.caminhoLocal}>
                {repo.nome || nomeCurto(repo.caminhoLocal)} — {repo.caminhoLocal}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button className="btn" disabled={ocupado || !escolhido} onClick={() => void adicionar()}>
        Adicionar
      </button>
    </div>
  );
}
