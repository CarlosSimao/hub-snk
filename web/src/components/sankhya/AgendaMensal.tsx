import { useMemo, useState } from 'react';
import { useResumoMes, type LinhaResumo } from '../../hooks/useResumoMes.ts';
import {
  deslocarMes,
  mesAtual,
  nomeDoMes,
  resumirMes,
  type ResumoMes,
  type StatusCliente,
} from '../../lib/calendario.ts';
import { Semaphore } from '../Semaphore.tsx';
import type { Status } from '../../types.ts';

/** O semáforo do painel é o mesmo da Infra — reaproveita a leitura que já está no olho. */
const COMO_SEMAFORO: Record<StatusCliente, Status> = {
  ok: 'up',
  atencao: 'degraded',
  atraso: 'down',
};

export function AgendaMensal({ onAbrirCliente }: { onAbrirCliente: (clienteId: number) => void }) {
  const [mes, setMes] = useState(mesAtual);
  const { linhas, carregando, erro, sessaoExpirada } = useResumoMes(mes);

  const resumos = useMemo(
    () =>
      linhas.map((linha) => ({
        linha,
        resumo: linha.agenda ? resumirMes(mes, linha.agenda) : null,
      })),
    [linhas, mes],
  );

  const comAtraso = resumos.filter((r) => r.resumo?.status === 'atraso').length;
  const comAtencao = resumos.filter((r) => r.resumo?.status === 'atencao').length;

  return (
    <section className="painel">
      <div className="mensal-cabecalho">
        <div>
          <h2>{nomeDoMes(mes)}</h2>
          <p className="painel-nota">
            {carregando
              ? 'carregando…'
              : comAtraso || comAtencao
                ? `${comAtraso} cliente(s) com atraso · ${comAtencao} com trabalho sem OS`
                : `${resumos.length} cliente(s), nada pendente`}
          </p>
        </div>
        <div className="detail-actions">
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, -1))}>
            ‹
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(mesAtual())}>
            Mês atual
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, 1))}>
            ›
          </button>
        </div>
      </div>

      {erro && (
        <div className="warning">
          <span>⚠</span>
          <span>
            {erro}
            {sessaoExpirada && (
              <>
                <br />
                Vá em <strong>Credenciais</strong>, abra a janela de login e capture a sessão de
                novo.
              </>
            )}
          </span>
        </div>
      )}

      {!erro && !carregando && resumos.length === 0 && (
        <p className="detail-empty">
          Nenhum cliente cadastrado ainda — comece em <strong>Clientes</strong>.
        </p>
      )}

      {resumos.map(({ linha, resumo }) => (
        <CartaoCliente
          key={linha.cliente.id}
          linha={linha}
          resumo={resumo}
          onAbrir={() => onAbrirCliente(linha.cliente.id)}
        />
      ))}
    </section>
  );
}

function CartaoCliente({
  linha,
  resumo,
  onAbrir,
}: {
  linha: LinhaResumo;
  resumo: ResumoMes | null;
  onAbrir: () => void;
}) {
  return (
    <article className="card mensal-cliente" data-status={resumo ? COMO_SEMAFORO[resumo.status] : 'unknown'}>
      <div className="detail-head">
        {resumo ? (
          <Semaphore status={COMO_SEMAFORO[resumo.status]} extra="vertical" />
        ) : (
          <Semaphore status="unknown" extra="vertical" />
        )}

        <div className="card-title">
          <h2>{linha.cliente.nome}</h2>
          {linha.erro ? (
            <p className="card-summary">{linha.erro}</p>
          ) : (
            resumo && <p className="card-summary">{frase(resumo)}</p>
          )}
        </div>

        <div className="detail-actions">
          <button className="btn tiny ghost" onClick={onAbrir}>
            Abrir agenda
          </button>
        </div>
      </div>

      {resumo && (
        <div className="pills mensal-pills">
          <span className="pill">
            dias com atuação <b>{resumo.diasComAtuacao}</b>
          </span>
          <span className="pill">
            tarefas <b>{resumo.tarefas}</b>
          </span>
          <span className={`pill${resumo.tarefasAtrasadas ? ' bad' : ''}`}>
            atrasadas <b>{resumo.tarefasAtrasadas}</b>
          </span>
          <span className="pill">
            OS no mês <b>{resumo.ordens}</b>
          </span>
          <span className={`pill${resumo.diasSemOs ? ' warn' : ''}`}>
            dias sem OS <b>{resumo.diasSemOs}</b>
          </span>
        </div>
      )}
    </article>
  );
}

/** A frase que resume o cartão — o mesmo critério do semáforo, em português. */
function frase(resumo: ResumoMes): string {
  if (resumo.tarefasAtrasadas) {
    return `${resumo.tarefasAtrasadas} tarefa(s) atrasada(s)`;
  }
  if (resumo.status === 'atraso') {
    return 'OS de dia passado sem aceite gerado';
  }
  if (resumo.diasSemOs) {
    return `${resumo.diasSemOs} dia(s) com tarefa e nenhuma OS lançada`;
  }
  return resumo.diasComAtuacao ? 'tudo em dia no mês' : 'sem atuação no mês';
}
