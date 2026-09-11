import { useCallback, useEffect, useState } from 'react';
import type {
  BaseCliente,
  BaseClienteEntrada,
  CartaoCliente,
  LinkCliente,
  LinkClienteEntrada,
  RepoCliente,
  RepoClienteEntrada,
  StatusBase,
} from '../types.ts';
import { enviar, requisitar } from '../lib/api.ts';
import type { Avisar } from './useToasts.ts';

type EntradaBase = BaseClienteEntrada & { senha?: string };
type Colecao = 'bases' | 'repos' | 'links';

export function useCartaoCliente(clienteId: number, toast: Avisar) {
  const [cartao, setCartao] = useState<CartaoCliente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [statusBases, setStatusBases] = useState<Record<number, StatusBase>>({});
  const [medindo, setMedindo] = useState<ReadonlySet<number>>(new Set());

  const recarregar = useCallback(async () => {
    setCarregando(true);
    const { ok, body } = await requisitar<CartaoCliente>(`/api/clientes/${clienteId}/cartao`);
    if (ok) setCartao(body as CartaoCliente);
    else toast(body.error ?? 'Não consegui carregar o cartão do cliente.', 'err');
    setCarregando(false);
  }, [clienteId, toast]);

  useEffect(() => {
    setCartao(null);
    setStatusBases({});
    void recarregar();
  }, [recarregar]);

  const gravar = useCallback(async <T>(
    colecao: Colecao,
    itemId: number | null,
    entrada: unknown,
  ): Promise<T | null> => {
    const rota = `/api/clientes/${clienteId}/${colecao}${itemId === null ? '' : `/${itemId}`}`;
    const { ok, body } = itemId === null
      ? await enviar<T>(rota, entrada)
      : await requisitar<T>(rota, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(entrada),
        });
    if (!ok) {
      toast(body.error ?? 'Não consegui salvar o item.', 'err');
      return null;
    }
    await recarregar();
    toast('Cartão atualizado.', 'ok');
    return body as T;
  }, [clienteId, recarregar, toast]);

  const remover = useCallback(async (colecao: Colecao, id: number, rotulo: string) => {
    if (!window.confirm(`Remover ${rotulo}?`)) return false;
    const { ok, body } = await requisitar(`/api/clientes/${clienteId}/${colecao}/${id}`, {
      method: 'DELETE',
    });
    if (!ok) {
      toast(body.error ?? 'Não consegui remover o item.', 'err');
      return false;
    }
    await recarregar();
    toast('Item removido.', 'ok');
    return true;
  }, [clienteId, recarregar, toast]);

  const medirBase = useCallback(async (base: BaseCliente) => {
    setMedindo((atuais) => new Set(atuais).add(base.id));
    const { ok, body } = await enviar<StatusBase>(
      `/api/clientes/${clienteId}/bases/${base.id}/medir`,
    );
    setMedindo((atuais) => {
      const proximos = new Set(atuais);
      proximos.delete(base.id);
      return proximos;
    });
    if (!ok) {
      toast(body.error ?? 'Não consegui medir a base.', 'err');
      return;
    }
    const medida = body as StatusBase;
    setStatusBases((atuais) => ({ ...atuais, [base.id]: medida }));
    if (medida.versao && medida.versao !== base.versao) {
      setCartao((atual) => atual ? {
        ...atual,
        bases: atual.bases.map((item) => item.id === base.id ? { ...item, versao: medida.versao } : item),
      } : atual);
    }
  }, [clienteId, toast]);

  const revelarSenha = useCallback(async (base: BaseCliente): Promise<string | null> => {
    const { ok, body } = await enviar<{ senha: string }>(
      `/api/clientes/${clienteId}/bases/${base.id}/revelar`,
    );
    if (!ok || typeof body.senha !== 'string') {
      toast(body.error ?? 'Não consegui revelar a senha.', 'err');
      return null;
    }
    return body.senha;
  }, [clienteId, toast]);

  return {
    cartao,
    carregando,
    statusBases,
    medindo,
    recarregar,
    medirBase,
    revelarSenha,
    salvarBase: (base: BaseCliente | null, entrada: EntradaBase) =>
      gravar<BaseCliente>('bases', base?.id ?? null, entrada),
    salvarRepo: (repo: RepoCliente | null, entrada: RepoClienteEntrada) =>
      gravar<RepoCliente>('repos', repo?.id ?? null, entrada),
    salvarLink: (link: LinkCliente | null, entrada: LinkClienteEntrada) =>
      gravar<LinkCliente>('links', link?.id ?? null, entrada),
    removerBase: (base: BaseCliente) => remover('bases', base.id, `a base "${base.url}"`),
    removerRepo: (repo: RepoCliente) => remover('repos', repo.id, `o repositório "${repo.nome || repo.caminhoLocal}"`),
    removerLink: (link: LinkCliente) => remover('links', link.id, `o link "${link.titulo}"`),
  };
}
