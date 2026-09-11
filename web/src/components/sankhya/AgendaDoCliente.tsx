import { useMemo, useState } from 'react';
import type { Cliente } from '../../types.ts';
import { useAgenda } from '../../hooks/useAgenda.ts';
import {
  DIAS_SEMANA,
  deslocarMes,
  hojeIso,
  mesAtual,
  montarGrade,
  nomeDoMes,
  semAceite,
  type DiaAgenda,
} from '../../lib/calendario.ts';

export function AgendaDoCliente({ cliente }: { cliente: Cliente }) {
  const [mes, setMes] = useState(mesAtual);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);

  const { agenda, eventos, carregando, erro, sessaoExpirada } = useAgenda(
    cliente.id,
    mes,
    cliente.agendaRecursoUsuario,
  );

  const grade = useMemo(() => montarGrade(mes, agenda, eventos), [mes, agenda, eventos]);
  const selecionado = grade.find((d) => d.dia === diaAberto);

  if (erro) {
    return (
      <div className="warning">
        <span>⚠</span>
        <span>
          {erro}
          {sessaoExpirada && (
            <>
              <br />
              Vá em <strong>Sankhya › Credenciais</strong>, abra a janela de login e capture a
              sessão de novo.
            </>
          )}
        </span>
      </div>
    );
  }

  return (
    <article className="card detail-card">
      <div className="detail-head">
        <div className="card-title">
          <h2>{nomeDoMes(mes)}</h2>
          <p>
            {carregando
              ? 'carregando…'
              : `${agenda.tarefas.length} tarefa(s) em aberto · ${agenda.ordens.length} OS no mês` +
                (eventos.length ? ` · ${eventos.length} evento(s) na agenda do ERP` : '')}
          </p>
        </div>
        <div className="detail-actions">
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, -1))}>
            ‹
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(mesAtual())}>
            Hoje
          </button>
          <button className="btn tiny ghost" onClick={() => setMes(deslocarMes(mes, 1))}>
            ›
          </button>
        </div>
      </div>

      <div className="calendario">
        {DIAS_SEMANA.map((dia) => (
          <div className="cal-cabecalho" key={dia}>
            {dia}
          </div>
        ))}

        {grade.map((dia) => (
          <Celula
            key={dia.dia}
            dia={dia}
            aberto={dia.dia === diaAberto}
            onAbrir={() => setDiaAberto(dia.dia === diaAberto ? null : dia.dia)}
          />
        ))}
      </div>

      {selecionado && <DetalheDoDia dia={selecionado} />}

      <p className="painel-nota calendario-nota">
        {cliente.agendaRecursoUsuario
          ? 'Tarefas e OS vêm do Sankhya Experience; os eventos vêm do último snapshot importado da Agenda de Recursos do ERP.'
          : 'Só o Sankhya Experience: preencha "Recurso na Agenda (ERP)" no cadastro para cruzar também os eventos da agenda.'}
      </p>
    </article>
  );
}

function Celula({
  dia,
  aberto,
  onAbrir,
}: {
  dia: DiaAgenda;
  aberto: boolean;
  onAbrir: () => void;
}) {
  const vazio = !dia.tarefas.length && !dia.ordens.length && !dia.eventos.length;

  const classes = [
    'cal-dia',
    dia.doMes ? '' : 'fora',
    dia.hoje ? 'hoje' : '',
    dia.atrasado ? 'atrasado' : '',
    aberto ? 'aberto' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={aberto}
      disabled={vazio}
      title={dia.atrasado ? 'Tem tarefa atrasada ou OS de dia passado sem aceite' : undefined}
      onClick={onAbrir}
    >
      <span className="cal-numero">{dia.numero}</span>
      {!vazio && (
        <span className="cal-marcas">
          {dia.tarefas.length > 0 && <i className="marca tarefa">{dia.tarefas.length}</i>}
          {dia.ordens.length > 0 && <i className="marca ordem">{dia.ordens.length}</i>}
          {dia.eventos.length > 0 && <i className="marca evento">{dia.eventos.length}</i>}
        </span>
      )}
    </button>
  );
}

function DetalheDoDia({ dia }: { dia: DiaAgenda }) {
  const hoje = hojeIso();

  return (
    <div className="dia-detalhe">
      <h3>{new Date(`${dia.dia}T12:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'full' })}</h3>

      <h4>Ordens de serviço lançadas</h4>
      {dia.ordens.length === 0 && <p className="detail-empty">Nenhuma OS neste dia.</p>}
      {dia.ordens.map((ordem) => (
        <div className="linha-agenda" key={ordem.id}>
          <span className={`selo ${semAceite(ordem) ? 'falta' : 'ok'}`}>
            {ordem.statusAceite || 'sem aceite'}
          </span>
          <span className="linha-titulo">{ordem.descricao}</span>
          <span className="linha-meta">
            {ordem.horasFeitas} · OS {ordem.numeroSankhya || '—'}
          </span>
        </div>
      ))}

      {dia.eventos.length > 0 && (
        <>
          <h4>Agenda de Recursos (ERP)</h4>
          {dia.eventos.map((evento) => (
            <div className="linha-agenda" key={evento.id}>
              <i
                className="ponto-recurso"
                style={evento.corHex ? { background: evento.corHex } : undefined}
              />
              <span className="linha-titulo" title={evento.descrlonga || evento.descrabrev}>
                {evento.descrabrev || '(sem descrição)'}
                {evento.nomeparc && ` — ${evento.nomeparc}`}
              </span>
              <span className="linha-meta">
                {evento.allday === 'S' ? 'dia todo' : `${evento.inicio.slice(11, 16)}–${evento.fim.slice(11, 16)}`}
                {evento.confirmado === 'S' ? '' : ' · não confirmado'}
              </span>
            </div>
          ))}
        </>
      )}

      <h4>Tarefas</h4>
      {dia.tarefas.length === 0 && <p className="detail-empty">Nenhuma tarefa neste dia.</p>}
      {dia.tarefas.map((tarefa) => (
        <div className="linha-agenda" key={tarefa.id}>
          <span className={`selo ${tarefa.taskStatus === 'Atrasada' ? 'falta' : 'ok'}`}>
            {tarefa.taskStatus}
          </span>
          <span className="linha-titulo" title={tarefa.observacoes}>
            {tarefa.procedimento}
          </span>
          <span className="linha-meta">
            {tarefa.etapa} · {tarefa.horaInicio}–{tarefa.horaFim}
          </span>
        </div>
      ))}

      {/*
        A pergunta que a tela existe para responder: o que foi feito e ainda não virou OS.
        Só vale para dia passado — tarefa de hoje ou futura ainda não deveria ter OS.
      */}
      {dia.dia < hoje && dia.tarefas.length > 0 && dia.ordens.length === 0 && (
        <p className="aviso-sem-os">
          Dia passado com tarefa e nenhuma OS lançada. O botão de gerar OS entra na fase
          seguinte; por ora, lance pela tela da Experience.
        </p>
      )}
    </div>
  );
}
