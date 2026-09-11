import { useMemo, useState } from 'react';
import { useResumoMes, type LinhaResumo } from '../../hooks/useResumoMes.ts';
import {
  DIAS_SEMANA,
  ROTULO_CRUZAMENTO,
  deslocarMes,
  mesAtual,
  montarGradeConsolidada,
  nomeDoMes,
  resumirMes,
  type DiaConsolidado,
  type ResumoMes,
  type StatusCliente,
} from '../../lib/calendario.ts';
import { Semaphore } from '../Semaphore.tsx';
import { TabBar, type Aba } from '../TabBar.tsx';
import type { Status } from '../../types.ts';

type Visao = 'calendario' | 'clientes';

const VISOES: Aba<Visao>[] = [
  { id: 'calendario', rotulo: 'Calendário', titulo: 'O mês inteiro, com todos os clientes juntos' },
  { id: 'clientes', rotulo: 'Por cliente', titulo: 'Um cartão de resumo para cada cliente' },
];

/** O semáforo do painel é o mesmo da Infra — reaproveita a leitura que já está no olho. */
const COMO_SEMAFORO: Record<StatusCliente, Status> = {
  ok: 'up',
  atencao: 'degraded',
  atraso: 'down',
};

export function AgendaMensal({ onAbrirCliente }: { onAbrirCliente: (clienteId: number) => void }) {
  const [mes, setMes] = useState(mesAtual);
  const [visao, setVisao] = useState<Visao>('calendario');
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const { linhas, carregando, erro, sessaoExpirada } = useResumoMes(mes);

  const resumos = useMemo(
    () =>
      linhas.map((linha) => ({
        linha,
        resumo: linha.agenda ? resumirMes(mes, linha.agenda, linha.eventos ?? []) : null,
      })),
    [linhas, mes],
  );

  const grade = useMemo(() => montarGradeConsolidada(mes, linhas), [mes, linhas]);
  const selecionado = grade.find((d) => d.dia === diaAberto);

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

      {resumos.length > 0 && <TabBar abas={VISOES} ativa={visao} onTrocar={setVisao} variante="sub" />}

      {visao === 'calendario' && resumos.length > 0 && (
        <article className="card">
          <div className="calendario calendario-geral">
            {DIAS_SEMANA.map((dia) => (
              <div className="cal-cabecalho" key={dia}>
                {dia}
              </div>
            ))}

            {grade.map((dia) => (
              <CelulaGeral
                key={dia.dia}
                dia={dia}
                aberto={dia.dia === diaAberto}
                onAbrir={() => setDiaAberto(dia.dia === diaAberto ? null : dia.dia)}
              />
            ))}
          </div>

          {selecionado && <DetalheGeral dia={selecionado} onAbrirCliente={onAbrirCliente} />}

          <p className="painel-nota calendario-nota">
            Cada dia mostra os clientes com algo nele. A cor vem do cruzamento entre a Agenda de
            Recursos do ERP e a Experience — clientes sem o parceiro amarrado no cadastro aparecem
            só pelo lado da Experience.
          </p>
        </article>
      )}

      {visao === 'clientes' &&
        resumos.map(({ linha, resumo }) => (
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

/** Um dia da visão consolidada: o número e quem teve trabalho nele. */
function CelulaGeral({
  dia,
  aberto,
  onAbrir,
}: {
  dia: DiaConsolidado;
  aberto: boolean;
  onAbrir: () => void;
}) {
  const classes = ['cal-dia', dia.doMes ? '' : 'fora', dia.hoje ? 'hoje' : '', aberto ? 'aberto' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={aberto}
      disabled={dia.clientes.length === 0}
      onClick={onAbrir}
    >
      <span className="cal-numero">{dia.numero}</span>
      <span className="cal-clientes">
        {dia.clientes.map((c) => (
          <i
            key={c.clienteId}
            className={`chip-cliente cruz-${c.cruzamento}`}
            title={`${c.nome} — ${ROTULO_CRUZAMENTO[c.cruzamento]}`}
          >
            {c.nome}
          </i>
        ))}
      </span>
    </button>
  );
}

function DetalheGeral({
  dia,
  onAbrirCliente,
}: {
  dia: DiaConsolidado;
  onAbrirCliente: (clienteId: number) => void;
}) {
  return (
    <div className="dia-detalhe">
      <h3>{new Date(`${dia.dia}T12:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'full' })}</h3>

      {dia.clientes.map((c) => (
        <div className="linha-agenda" key={c.clienteId}>
          <span className={`selo-cruzamento ${c.cruzamento}`}>
            <i className={`marca-cruzamento ${c.cruzamento}`} />
            {ROTULO_CRUZAMENTO[c.cruzamento]}
          </span>
          <span className="linha-titulo">{c.nome}</span>
          <span className="linha-meta">
            {[
              c.eventos ? `${c.eventos} evento(s)` : '',
              c.tarefas ? `${c.tarefas} tarefa(s)` : '',
              c.ordens ? `${c.ordens} OS` : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <button className="btn tiny ghost" onClick={() => onAbrirCliente(c.clienteId)}>
            Abrir
          </button>
        </div>
      ))}
    </div>
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
