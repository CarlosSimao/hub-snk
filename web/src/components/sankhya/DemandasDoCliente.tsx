import { useEffect, useState, type FormEvent } from 'react';
import type { Cliente, ClienteEntrada, SolicitacaoServico } from '../../types.ts';
import { requisitar } from '../../lib/api.ts';
import { listarIdsDemanda } from '../../lib/demandas.ts';
import type { Avisar } from '../../hooks/useToasts.ts';

/**
 * Os IDs das demandas do cliente, no cabeçalho do cartão: listar, acrescentar e tirar
 * sem abrir o Editar. Grava no mesmo campo do cadastro (`agendaDemandaId`, separado por
 * vírgula — ver `src/demandas.ts`).
 *
 * Cada chip mostra as horas da Solicitação de Serviços quando ela já foi lida do ERP.
 */
export function DemandasDoCliente({
  cliente,
  toast,
  onSalvarCliente,
}: {
  cliente: Cliente;
  toast: Avisar;
  onSalvarCliente: (entrada: ClienteEntrada) => Promise<unknown>;
}) {
  const ids = listarIdsDemanda(cliente.agendaDemandaId);
  const [novo, setNovo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [solicitacoes, setSolicitacoes] = useState<SolicitacaoServico[]>([]);

  const chave = ids.join(',');
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!chave) {
      setSolicitacoes([]);
      return;
    }
    let vivo = true;
    void requisitar<{ solicitacoes: SolicitacaoServico[] }>(`/api/solicitacoes?codigos=${chave}`).then(
      ({ ok, body }) => {
        if (vivo && ok) setSolicitacoes(body.solicitacoes ?? []);
      },
    );
    return () => {
      vivo = false;
    };
  }, [chave, versao]);

  const gravar = async (proximos: string[]) => {
    setSalvando(true);
    try {
      await onSalvarCliente({ ...cliente, agendaDemandaId: proximos.join(', ') });
    } finally {
      setSalvando(false);
    }
  };

  const adicionar = async (e: FormEvent) => {
    e.preventDefault();
    const entrada = listarIdsDemanda(novo);
    if (!entrada.length) {
      toast('Informe o número da demanda (código da Solicitação de Serviços)', 'err');
      return;
    }
    const proximos = [...new Set([...ids, ...entrada])];
    if (proximos.length === ids.length) {
      toast('Essa demanda já está vinculada', 'ok');
      setNovo('');
      return;
    }
    await gravar(proximos);
    setNovo('');
    // Demanda nova ainda não foi lida do ERP: busca agora, sem esperar a próxima janela
    // de 4 horas, para descrição, horas e anexos aparecerem logo.
    void requisitar('/api/agenda/sincronizar', { method: 'POST' }).then(() => setVersao((v) => v + 1));
  };

  return (
    <div className="demandas-cliente">
      {ids.length === 0 && <span className="painel-nota">nenhuma demanda vinculada</span>}
      {ids.map((id) => {
        const s = solicitacoes.find((x) => String(x.codigo) === id);
        return (
          <span className="chip-demanda-cliente" key={id} title={s?.descricao || 'Solicitação ainda não lida do ERP'}>
            ID <b>{id}</b>
            {s?.horasEstimadas != null && <span className="linha-meta"> · {s.horasEstimadas} h</span>}
            <button
              type="button"
              aria-label={`Desvincular a demanda ${id}`}
              title="Desvincular"
              disabled={salvando}
              onClick={() => void gravar(ids.filter((x) => x !== id))}
            >
              ×
            </button>
          </span>
        );
      })}
      <form className="demandas-cliente-novo" onSubmit={(e) => void adicionar(e)}>
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          placeholder="nova demanda"
          inputMode="numeric"
          aria-label="ID da nova demanda"
        />
        <button className="btn tiny ghost" type="submit" disabled={salvando || !novo.trim()}>
          + ID
        </button>
      </form>
    </div>
  );
}
