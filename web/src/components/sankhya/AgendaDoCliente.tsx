import { useEffect, useMemo, useState } from 'react';
import type { AtuacaoCliente, Cliente, DetalheOrdem, OrdemExperience } from '../../types.ts';
import type { Avisar } from '../../hooks/useToasts.ts';
import { requisitar } from '../../lib/api.ts';
import { ModalGerarOs } from './ModalGerarOs.tsx';
import { useAgenda } from '../../hooks/useAgenda.ts';
import {
  DIAS_SEMANA,
  ROTULO_CRUZAMENTO,
  deslocarMes,
  hojeIso,
  mesAtual,
  montarGrade,
  nomeDoMes,
  resumirMes,
  semAceite,
  type DiaAgenda,
} from '../../lib/calendario.ts';

export function AgendaDoCliente({ cliente, toast }: { cliente: Cliente; toast: Avisar }) {
  const [mes, setMes] = useState(mesAtual);
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [gerandoOs, setGerandoOs] = useState(false);

  const { agenda, eventos, cruzada, carregando, erro, sessaoExpirada, recarregar } = useAgenda(
    cliente.id,
    mes,
    cliente.agendaRecursoUsuario,
    cliente.agendaCodparc,
  );

  const grade = useMemo(() => montarGrade(mes, agenda, eventos), [mes, agenda, eventos]);
  const resumo = useMemo(() => resumirMes(mes, agenda, eventos), [mes, agenda, eventos]);
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

      {cruzada && !carregando && <FaixaCruzamento resumo={resumo} />}
      {cruzada && <DiasDeAtuacao clienteId={cliente.id} mes={mes} />}

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

      {selecionado && (
        <DetalheDoDia dia={selecionado} onGerarOs={() => setGerandoOs(true)} />
      )}

      {selecionado && (
        <ModalGerarOs
          clienteId={cliente.id}
          dia={selecionado.dia}
          tarefas={selecionado.tarefas}
          aberto={gerandoOs}
          onFechar={() => setGerandoOs(false)}
          onCriada={() => void recarregar()}
          toast={toast}
        />
      )}

      <p className="painel-nota calendario-nota">
        {cruzada
          ? 'Tarefas e OS vêm do Sankhya Experience; os eventos vêm do último snapshot importado da Agenda de Recursos do ERP.'
          : 'Só o Sankhya Experience. Preencha "Recurso na Agenda (ERP)" e "Parceiro na Agenda (ERP)" no cadastro para cruzar com os dias em que você foi alocado neste cliente.'}
      </p>
    </article>
  );
}

/**
 * Todos os dias em que houve (ou haverá) atendimento a este cliente.
 *
 * Não se limita ao mês da tela de propósito: o calendário já responde "o que rolou em
 * setembro", e o que falta é a pergunta que ele não responde — "desde quando eu atendo
 * este cliente, e quando volto". Vem da Agenda de Recursos, recortada no parceiro.
 */
function DiasDeAtuacao({ clienteId, mes }: { clienteId: number; mes: string }) {
  const [atuacao, setAtuacao] = useState<AtuacaoCliente | null>(null);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    let cancelado = false;
    void requisitar<AtuacaoCliente>(`/api/clientes/${clienteId}/atuacao`).then(({ ok, body }) => {
      if (!cancelado) setAtuacao(ok ? ((body as AtuacaoCliente) ?? null) : null);
    });
    return () => {
      cancelado = true;
    };
  }, [clienteId]);

  if (!atuacao?.dias.length) return null;

  const hoje = hojeIso();
  const passados = atuacao.dias.filter((d) => d.dia < hoje);
  const futuros = atuacao.dias.filter((d) => d.dia >= hoje);

  return (
    <div className="atuacao">
      <button className="atuacao-resumo" type="button" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        <strong>{atuacao.dias.length} dia(s) de atuação</strong>
        <span>
          {passados.length} já {passados.length === 1 ? 'atendido' : 'atendidos'} · {futuros.length} pela frente
          {' · '}
          {atuacao.dias[0]?.dia} a {atuacao.dias[atuacao.dias.length - 1]?.dia}
        </span>
        <span className="atuacao-seta">{aberto ? '▴' : '▾'}</span>
      </button>

      {aberto && (
        <div className="atuacao-dias">
          {atuacao.dias.map((d) => (
            <span
              key={d.dia}
              // O mês na tela ganha destaque: é o recorte que o calendário ao lado mostra.
              className={`atuacao-dia${d.dia.slice(0, 7) === mes ? ' do-mes' : ''}${d.dia < hoje ? '' : ' futuro'}`}
              title={d.titulos.join(' · ') || undefined}
            >
              {d.dia.slice(8)}/{d.dia.slice(5, 7)}
              {d.eventos > 1 && <b>{d.eventos}</b>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O placar do cruzamento, acima do calendário.
 *
 * Só aparece com os dois lados cadastrados: sem um deles, o silêncio de um sistema é
 * cadastro incompleto e não pendência — anunciar "alocado sem OS" aí seria mentira.
 */
function FaixaCruzamento({ resumo }: { resumo: ReturnType<typeof resumirMes> }) {
  const itens = [
    { chave: 'casado', valor: resumo.diasCasados },
    { chave: 'alocado-sem-os', valor: resumo.diasAlocadosSemOs },
    { chave: 'os-sem-alocacao', valor: resumo.diasOsSemAlocacao },
  ] as const;

  return (
    <div className="faixa-cruzamento">
      {itens.map(({ chave, valor }) => (
        <span key={chave} className={`selo-cruzamento ${chave}${valor ? '' : ' zerado'}`}>
          <i className={`marca-cruzamento ${chave}`} />
          {valor} {ROTULO_CRUZAMENTO[chave]}
        </span>
      ))}
    </div>
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
    `cruz-${dia.cruzamento}`,
  ]
    .filter(Boolean)
    .join(' ');

  // As duas coisas que o dia pode ter a dizer, na ordem de urgência: atraso primeiro,
  // divergência entre os sistemas depois.
  const aviso = dia.atrasado
    ? 'Tem tarefa atrasada ou OS de dia passado sem aceite'
    : dia.cruzamento === 'alocado-sem-os' || dia.cruzamento === 'os-sem-alocacao'
      ? ROTULO_CRUZAMENTO[dia.cruzamento]
      : undefined;

  return (
    <button
      type="button"
      className={classes}
      aria-pressed={aberto}
      disabled={vazio}
      title={aviso}
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

/**
 * O texto de "Tarefas Realizadas" das OS de um dia, por `id` da OS.
 *
 * So do dia aberto: e uma requisicao da Experience por OS, e o mes inteiro custaria
 * uma centena delas para mostrar texto que ninguem esta olhando.
 */
function useTarefasRealizadas(ordens: OrdemExperience[]): Record<number, string> {
  const [textos, setTextos] = useState<Record<number, string>>({});
  const ids = ordens.map((ordem) => ordem.id).join(',');

  useEffect(() => {
    setTextos({});
    if (!ids) return;

    let cancelado = false;
    void requisitar<{ detalhes: DetalheOrdem[] }>(
      `/api/experience/os/detalhes?ids=${ids}`,
    ).then(({ ok, body }) => {
      // Silencioso de proposito: o texto e complemento da linha, e um aviso a cada
      // dia clicado com a sessao vencida seria ruido em cima de um erro que a propria
      // agenda ja anuncia.
      if (cancelado || !ok) return;
      setTextos(
        Object.fromEntries((body.detalhes ?? []).map((d) => [d.id, d.tarefasRealizadas])),
      );
    });

    return () => {
      cancelado = true;
    };
  }, [ids]);

  return textos;
}

function DetalheDoDia({ dia, onGerarOs }: { dia: DiaAgenda; onGerarOs: () => void }) {
  const hoje = hojeIso();
  const tarefasRealizadas = useTarefasRealizadas(dia.ordens);

  return (
    <div className="dia-detalhe">
      <h3>{new Date(`${dia.dia}T12:00:00`).toLocaleDateString('pt-BR', { dateStyle: 'full' })}</h3>

      <h4>Ordens de serviço lançadas</h4>
      {dia.ordens.length === 0 && <p className="detail-empty">Nenhuma OS neste dia.</p>}
      {dia.ordens.map((ordem) => (
        <div key={ordem.id}>
          <div className="linha-agenda">
            <span className={`selo ${semAceite(ordem) ? 'falta' : 'ok'}`}>
              {ordem.statusAceite || 'sem aceite'}
            </span>
            <span className="linha-titulo">{ordem.descricao}</span>
            <span className="linha-meta">
              {ordem.horasFeitas} · OS {ordem.numeroSankhya || '—'}
            </span>
          </div>
          {/* O que foi apontado no lançamento — é a resposta de "o que eu fiz nesse dia". */}
          {tarefasRealizadas[ordem.id] && (
            <p className="linha-apontamento">{tarefasRealizadas[ordem.id]}</p>
          )}
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
      {dia.tarefas.length > 0 && (
        <div className="form-acoes">
          {dia.dia < hoje && dia.ordens.length === 0 && (
            <span className="aviso-sem-os">Dia passado com tarefa e nenhuma OS lançada.</span>
          )}
          <span className="modal-acoes-spacer" />
          <button className="btn tiny" type="button" onClick={onGerarOs}>
            Gerar OS
          </button>
        </div>
      )}
    </div>
  );
}
